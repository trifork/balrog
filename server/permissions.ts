import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import { WebSocket, WebSocketServer } from "ws";
import {
  isPluginPermissionMessage,
  permissionKey,
  type PendingPermission,
  type PermissionCommand,
  type PermissionReply,
} from "../shared/permission-protocol.js";
import { isLoopbackHost } from "./loopback.js";

interface Peer {
  socket: WebSocket;
  pluginID?: string;
  requests: Map<string, PendingPermission>;
}

interface InFlight {
  peer: Peer;
  key: string;
  finish: (error?: string) => void;
}

export class PermissionBroker {
  private readonly sockets = new WebSocketServer({ noServer: true, maxPayload: 262_144 });
  private readonly peers = new Set<Peer>();
  private readonly commands = new Map<string, InFlight>();
  private readonly listeners = new Set<() => void>();
  private readonly heartbeat: ReturnType<typeof setInterval>;

  constructor() {
    const alive = new WeakSet<WebSocket>();
    this.heartbeat = setInterval(() => {
      for (const { socket } of this.peers) {
        if (!alive.delete(socket)) socket.terminate();
        else socket.ping();
      }
    }, 15_000);
    this.heartbeat.unref();
    this.sockets.on("connection", (socket) => {
      const peer: Peer = { socket, requests: new Map() };
      this.peers.add(peer);
      alive.add(socket);
      socket.on("pong", () => alive.add(socket));
      socket.on("error", () => socket.terminate());
      socket.on("close", () => {
        this.peers.delete(peer);
        for (const command of [...this.commands.values()]) {
          if (command.peer === peer) command.finish("OpenCode plugin disconnected; approval was not confirmed");
        }
        this.changed();
      });
      socket.on("message", (data, binary) => {
        try {
          const message: unknown = binary ? undefined : JSON.parse(data.toString());
          if (!isPluginPermissionMessage(message)) throw new Error("Invalid plugin message");
          if (message.type === "permissions.sync") {
            if (peer.pluginID && peer.pluginID !== message.pluginID) throw new Error("Plugin identity changed");
            if ([...this.peers].some((other) => other !== peer && other.pluginID === message.pluginID)) {
              throw new Error("Plugin already connected");
            }
            peer.pluginID = message.pluginID;
            const requests = new Map<string, PendingPermission>();
            for (const request of message.requests) {
              const identity = { ...request, pluginID: message.pluginID };
              const key = permissionKey(identity);
              if (requests.has(key)) throw new Error("Duplicate request");
              requests.set(key, { ...identity, status: peer.requests.get(key)?.status ?? "pending" });
            }
            peer.requests = requests;
            this.changed();
          } else {
            const command = this.commands.get(message.commandID);
            if (!command || command.peer !== peer) throw new Error("Unknown permission command");
            command.finish(message.error);
          }
        } catch {
          socket.close(1008, "Invalid permission bridge message");
        }
      });
    });
  }

  attach(server: Server): void {
    server.on("upgrade", (request, socket, head) => {
      if (request.url !== "/permissions") return;
      if (!isLoopbackHost(request.headers.host) || request.headers.origin !== undefined) {
        socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
        return;
      }
      this.sockets.handleUpgrade(request, socket, head, (client) => this.sockets.emit("connection", client));
    });
  }

  list(): PendingPermission[] {
    return [...this.peers].flatMap((peer) => [...peer.requests.values()]);
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async reply(reply: PermissionReply): Promise<void> {
    const key = permissionKey(reply);
    const peer = [...this.peers].find((item) => item.pluginID === reply.pluginID);
    const request = peer?.requests.get(key);
    if (!peer || !request || peer.socket.readyState !== WebSocket.OPEN) {
      throw new Error("Permission request is no longer available");
    }
    if (request.status !== "pending") throw new Error("Permission reply is already in progress");
    const commandID = randomUUID();
    const command: PermissionCommand = { ...reply, commandID };
    request.status = "replying";
    this.changed();
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        finish("OpenCode did not confirm the permission reply; check its native prompt");
        peer.socket.terminate();
      }, 15_000);
      const finish = (error?: string) => {
        clearTimeout(timer);
        this.commands.delete(commandID);
        if (error) {
          const current = peer.requests.get(key);
          if (current) current.status = "pending";
          reject(new Error(error));
        } else {
          peer.requests.delete(key);
          resolve();
        }
        this.changed();
      };
      this.commands.set(commandID, { peer, key, finish });
      peer.socket.send(JSON.stringify(command), (error) => {
        if (error && this.commands.has(commandID)) finish("Could not send the permission reply to OpenCode");
      });
    });
  }

  close(): void {
    clearInterval(this.heartbeat);
    for (const command of [...this.commands.values()]) command.finish("Permission bridge stopped");
    for (const peer of this.peers) peer.socket.terminate();
    this.peers.clear();
    this.sockets.close();
    this.changed();
    this.listeners.clear();
  }

  private changed(): void {
    for (const listener of this.listeners) listener();
  }
}
