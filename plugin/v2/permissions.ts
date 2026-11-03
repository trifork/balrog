import { realpath } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import type { Plugin } from "@opencode/plugin";
import WebSocket from "ws";
import {
  isPermissionCommand,
  permissionKey,
  type NativePermission,
  type PermissionCommand,
  type PermissionDecision,
  type PluginPermissionMessage,
} from "../../shared/permission-protocol.js";
import { isSensitiveFile } from "./sensitive-files.js";

export const SENSITIVE_READ_MESSAGE = "Sensitive file read requires approval in Balrog.";

type OpenCodeEvent = ReturnType<Plugin.Context["event"]["subscribe"]> extends AsyncIterable<infer Event> ? Event : never;

interface GateResult {
  decision: PermissionDecision;
  message?: string;
}

interface ReadGate {
  request: NativePermission;
  resolve: (result: GateResult) => void;
}

export class SensitiveReadPermissions {
  private readonly requests = new Map<string, NativePermission>();
  private readonly gates = new Map<string, ReadGate>();
  private readonly replying = new Set<string>();
  private socket?: WebSocket;
  private retry?: ReturnType<typeof setTimeout>;
  private registration?: { dispose(): Promise<void> };
  private disposed = false;
  private revision = 0;
  private delay = 1_000;
  private readonly endpoint?: string;

  constructor(private readonly ctx: Plugin.Context, private readonly pluginID: string, logEndpoint: string) {
    if (logEndpoint) {
      const url = new URL("/permissions", logEndpoint);
      if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("Expected an HTTP(S) logEndpoint");
      url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
      this.endpoint = url.href;
    }
  }

  async start(): Promise<void> {
    this.registration = await this.ctx.permission.hook("evaluate", async (event) => {
      if (event.action !== "read" || event.effect === "deny") return;
      let sensitive = event.resources.some(isSensitiveFile);
      if (!sensitive) {
        const targets = await Promise.all(event.resources.map(async (resource) => {
          try {
            return await realpath(resolve(this.ctx.location.directory, resource));
          } catch {
            return resource;
          }
        }));
        sensitive = targets.some(isSensitiveFile);
      }
      if (sensitive) {
        const session = await this.ctx.session.get({ sessionID: event.sessionID });
        if (session.location.directory !== this.ctx.location.directory) return;
        if (this.disposed || !this.endpoint) {
          event.effect = "deny";
          event.message = "Sensitive reads require Balrog approval, but the approval connection is disabled.";
          return;
        }
        event.effect = "ask";
        event.message = SENSITIVE_READ_MESSAGE;
        const result = await this.requireApproval(event.sessionID, event.resources);
        event.effect = result.decision === "once" && !this.disposed ? "allow" : "deny";
        if (event.effect === "deny") event.message = result.message ?? "Sensitive file read rejected in Balrog.";
      }
    });
    this.connect();
  }

  observe(event: OpenCodeEvent): void {
    if (this.disposed || event.location && event.location.directory !== this.ctx.location.directory) return;
    if (event.type === "permission.asked") {
      const request = event.data;
      if (request.action !== "read" || request.message !== SENSITIVE_READ_MESSAGE) return;
      const pending: NativePermission = {
        sessionID: request.sessionID,
        requestID: request.id,
        resources: [...request.resources],
        message: request.message,
      };
      this.requests.set(this.key(pending), pending);
    } else if (event.type === "permission.replied") {
      this.requests.delete(this.key(event.data));
    } else if (event.type === "session.execution.interrupted" || event.type === "session.deleted") {
      for (const [key, request] of this.requests) {
        if (request.sessionID === event.data.sessionID) this.requests.delete(key);
      }
      for (const [key, gate] of this.gates) {
        if (gate.request.sessionID === event.data.sessionID) {
          this.finishGate(key, { decision: "reject", message: "Sensitive read cancelled because the session stopped." });
        }
      }
    } else {
      return;
    }
    this.revision += 1;
    this.sync();
  }

  async close(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    for (const key of this.gates.keys()) {
      this.finishGate(key, { decision: "reject", message: "Sensitive read cancelled because the Balrog plugin unloaded. Retry the read after reload." });
    }
    clearTimeout(this.retry);
    this.socket?.terminate();
    this.requests.clear();
    await this.registration?.dispose();
  }

  private connect(): void {
    if (!this.endpoint || this.disposed) return;
    const socket = new WebSocket(this.endpoint, { handshakeTimeout: 5_000, maxPayload: 16_384 });
    this.socket = socket;
    socket.on("error", () => socket.terminate());
    socket.on("open", () => {
      this.delay = 1_000;
      void this.refresh(socket).catch(() => socket.terminate());
    });
    socket.on("close", () => {
      if (this.disposed) return;
      this.retry = setTimeout(() => this.connect(), this.delay);
      this.retry.unref();
      this.delay = Math.min(this.delay * 2, 10_000);
    });
    socket.on("message", (data, binary) => {
      try {
        const message: unknown = binary ? undefined : JSON.parse(data.toString());
        if (!isPermissionCommand(message) || message.pluginID !== this.pluginID) throw new Error("Invalid reply");
        void this.reply(socket, message);
      } catch {
        socket.close(1008, "Invalid permission reply");
      }
    });
  }

  private async refresh(socket: WebSocket): Promise<void> {
    const revision = this.revision;
    const sessions = new Set<string>();
    let cursor: string | undefined;
    do {
      const page = await this.ctx.session.list(cursor ? { cursor } : { directory: this.ctx.location.directory, limit: 100 });
      for (const session of page.data) {
        if (session.location.directory === this.ctx.location.directory) sessions.add(session.id);
      }
      cursor = page.cursor.next ?? undefined;
      if (this.disposed || socket !== this.socket || socket.readyState !== WebSocket.OPEN) return;
    } while (cursor);
    const requests = (await Promise.all([...sessions].map((sessionID) => this.ctx.permission.list({ sessionID })))).flat();
    if (this.disposed || socket !== this.socket || socket.readyState !== WebSocket.OPEN) return;
    if (revision !== this.revision) return this.refresh(socket);
    this.requests.clear();
    for (const request of requests) {
      if (request.action !== "read" || request.message !== SENSITIVE_READ_MESSAGE) continue;
      const pending: NativePermission = {
        sessionID: request.sessionID, requestID: request.id,
        resources: [...request.resources], message: request.message,
      };
      this.requests.set(this.key(pending), pending);
    }
    this.sync();
  }

  private async reply(socket: WebSocket, command: PermissionCommand): Promise<void> {
    const key = this.key(command);
    if (!this.disposed && this.gates.has(key)) {
      this.finishGate(key, { decision: command.decision });
      this.send(socket, { type: "permission.result", commandID: command.commandID });
      return;
    }
    let error: string | undefined;
    if (!this.requests.has(key) || this.replying.has(key)) {
      this.send(socket, { type: "permission.result", commandID: command.commandID, error: "Permission request is no longer available or is already being answered" });
      return;
    }
    this.replying.add(key);
    try {
      const identity = { sessionID: command.sessionID, requestID: command.requestID };
      const native = await this.ctx.permission.get(identity);
      if (this.disposed || !this.requests.has(key) || native.action !== "read"
        || native.message !== SENSITIVE_READ_MESSAGE || native.id !== command.requestID
        || native.sessionID !== command.sessionID) throw new Error("Permission request is no longer available");
      await this.ctx.permission.reply({ ...identity, decision: command.decision });
      this.requests.delete(key);
      this.revision += 1;
      this.sync();
    } catch (cause) {
      error = cause instanceof Error ? cause.message.slice(0, 16_384) : "OpenCode permission reply failed";
    } finally {
      this.replying.delete(key);
    }
    this.send(socket, { type: "permission.result", commandID: command.commandID, ...(error ? { error } : {}) });
  }

  private key(identity: { sessionID: string; requestID: string }): string {
    return permissionKey({ ...identity, pluginID: this.pluginID });
  }

  private sync(): void {
    if (this.socket) this.send(this.socket, {
      type: "permissions.sync", pluginID: this.pluginID,
      requests: [...this.requests.values(), ...[...this.gates.values()].map((gate) => gate.request)],
    });
  }

  private requireApproval(sessionID: string, resources: readonly string[]): Promise<GateResult> {
    return new Promise((resolve) => {
      const request: NativePermission = {
        sessionID, requestID: `balrog_${randomUUID()}`, resources: [...resources], message: SENSITIVE_READ_MESSAGE,
      };
      this.gates.set(this.key(request), { request, resolve });
      this.sync();
    });
  }

  private finishGate(key: string, result: GateResult): void {
    const gate = this.gates.get(key);
    if (!gate) return;
    this.gates.delete(key);
    gate.resolve(result);
    this.sync();
  }

  private send(socket: WebSocket, message: PluginPermissionMessage): void {
    if (!this.disposed && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(message), (error) => { if (error) socket.terminate(); });
    }
  }
}
