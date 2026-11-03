import { createServer, type Server } from "node:http";
import { WebSocket, WebSocketServer } from "ws";
import type { ViewerMessage, ViewerResponse } from "../shared/viewer-protocol.js";
import { isPermissionReply } from "../shared/permission-protocol.js";
import { SessionAnalyzer } from "./analyzer.js";
import { receiveAssessments } from "./assessments.js";
import { conversationSnapshot } from "./conversation.js";
import { eventContent } from "./event-content.js";
import { FileActivityTracker, type PromptActivity } from "./file-activity.js";
import { serveFrontend } from "./frontend.js";
import type { LogEvent } from "./log-receiver.js";
import type { PermissionBroker } from "./permissions.js";
import { isLoopbackHost } from "./loopback.js";

interface RetainedEvent {
  event: LogEvent;
  fileActivity?: PromptActivity;
  fileActivityUpdates?: PromptActivity[];
}

export class LogViewer {
  private readonly events: RetainedEvent[] = [];
  private readonly fileActivity = new FileActivityTracker();
  private readonly subscribers = new Set<WebSocket>();
  private readonly sockets = new WebSocketServer({ noServer: true, maxPayload: 16_384 });
  private readonly server: Server;
  private readonly ownsServer: boolean;
  private readonly unsubscribePermissions?: () => void;

  constructor(private readonly analyzer = new SessionAnalyzer(), private readonly permissions?: PermissionBroker, server?: Server,
    private readonly persistAssessment?: (event: LogEvent) => void) {
    this.unsubscribePermissions = permissions?.subscribe(() => {
      for (const client of this.subscribers) this.send(client, { type: "permissions", permissions: permissions.list() });
    });
    this.ownsServer = server === undefined;
    this.server = server ?? createServer();
    this.server.on("request", (request, response) => {
      if (!this.ownsServer && request.url === "/log") return;
      if (!isLoopbackHost(request.headers.host)) {
        response.writeHead(403);
        response.end("Forbidden host");
        return;
      }
      let pathname: string;
      try {
        pathname = new URL(request.url ?? "/", "http://localhost").pathname;
      } catch {
        response.writeHead(400);
        response.end("Invalid request URL");
        return;
      }
      if (pathname.startsWith("/api/sessions/") && pathname.endsWith("/assessments")) {
        void receiveAssessments(request, response,
          pathname.slice("/api/sessions/".length, -"/assessments".length), this.analyzer, (event) => {
            this.persistAssessment?.(event);
            this.analyzer.process(event);
            this.publish(event);
          });
        return;
      }
      if (request.method !== "GET") {
        response.writeHead(405, { Allow: "GET" });
        response.end("Method not allowed");
        return;
      }
      if (pathname === "/api/sessions") {
        response.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        response.end(JSON.stringify(this.analyzer.getSessions()));
        return;
      }

      if (request.method === "GET" && request.url?.split("?", 1)[0] === "/api/tool-executions") {
        const url = new URL(request.url, "http://localhost");
        const requestedSession = url.searchParams.get("session");
        const sessionID = requestedSession || this.analyzer.getSessions()[0]?.sessionID || null;
        const missing = sessionID !== null && !this.analyzer.getSession(sessionID);
        response.writeHead(missing ? 404 : 200, {
          "Content-Type": "application/json; charset=utf-8",
          "Cache-Control": "no-store",
        });
        response.end(JSON.stringify(missing ? { error: "Session not found" } : {
          sessionID,
          executions: sessionID ? this.analyzer.getToolExecutions(sessionID) : [],
          skills: sessionID ? this.analyzer.getSkillActivations(sessionID) : [],
        }));
        return;
      }

      if (pathname.startsWith("/api/sessions/") && pathname.endsWith("/conversation")) {
        const reply = (status: number, body: unknown) => {
          response.writeHead(status, {
            "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store",
          });
          response.end(JSON.stringify(body));
        };
        let sessionID: string;
        try {
          sessionID = decodeURIComponent(pathname.slice("/api/sessions/".length, -"/conversation".length));
        } catch {
          reply(400, { error: "Invalid session ID" });
          return;
        }
        const cutoff = new URL(request.url!, "http://localhost").searchParams.get("before");
        const before = cutoff === null ? undefined : Number(cutoff);
        if (cutoff !== null && (!cutoff.trim() || !Number.isSafeInteger(before) || before! < 0)) {
          reply(400, { error: "before must be a non-negative Unix-millisecond timestamp" });
          return;
        }
        if (!this.analyzer.getSession(sessionID)) {
          reply(404, { error: "Session not found" });
          return;
        }
        reply(200, conversationSnapshot(this.events.map(({ event }) => event), sessionID, before));
        return;
      }

      if (
        pathname.startsWith("/api/sessions/") &&
        (pathname.endsWith("/summary") || pathname.endsWith("/heatmap"))
      ) {
        let sessionID: string;
        const heatmap = pathname.endsWith("/heatmap");
        const suffix = heatmap ? "/heatmap" : "/summary";
        try {
          sessionID = decodeURIComponent(
            pathname.slice("/api/sessions/".length, -suffix.length),
          );
        } catch {
          response.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
          response.end(JSON.stringify({ error: "Invalid session ID" }));
          return;
        }
        const session = heatmap
          ? this.analyzer.getSessionActivity(sessionID)
          : this.analyzer.getSession(sessionID);
        response.writeHead(session ? 200 : 404, {
          "Content-Type": "application/json; charset=utf-8",
        });
        response.end(JSON.stringify(session ?? { error: "Session not found" }));
        return;
      }

      void serveFrontend(pathname, response);
    });

    this.server.on("upgrade", (request, socket, head) => {
      const reject = (status: string) => {
        socket.end(`HTTP/1.1 ${status}\r\nConnection: close\r\n\r\n`);
      };
      if (!isLoopbackHost(request.headers.host)) {
        reject("403 Forbidden");
        return;
      }
      let pathname: string;
      try {
        pathname = new URL(request.url ?? "/", "http://localhost").pathname;
      } catch {
        reject("400 Bad Request");
        return;
      }
      if (pathname === "/permissions") return;
      if (pathname !== "/ws") {
        reject("404 Not Found");
        return;
      }
      if (request.headers.origin) {
        try {
          const origin = new URL(request.headers.origin);
          if (!["http:", "https:"].includes(origin.protocol) || origin.host !== request.headers.host) {
            reject("403 Forbidden");
            return;
          }
        } catch {
          reject("403 Forbidden");
          return;
        }
      }
      this.sockets.handleUpgrade(request, socket, head, (client) => {
        this.sockets.emit("connection", client);
      });
    });

    this.sockets.on("connection", (client) => {
      client.on("error", () => {
        this.subscribers.delete(client);
        client.terminate();
      });
      client.on("close", () => this.subscribers.delete(client));
      client.on("message", (data, binary) => {
        try {
          const request: unknown = binary ? undefined : JSON.parse(data.toString());
          if (isPermissionReply(request)) {
            if (!this.permissions || !this.subscribers.has(client)) throw new Error("Permission bridge unavailable");
            void this.permissions.reply(request).catch((error: unknown) => {
              this.send(client, { type: "error", message: error instanceof Error ? error.message : "Permission reply failed" });
            });
            return;
          }
          if (!request || typeof request !== "object" || !("type" in request) || request.type !== "snapshot.request") {
            throw new Error("Invalid request");
          }
          this.send(client, {
            type: "snapshot",
            sessions: this.analyzer.getSessions(),
            events: this.events.map((entry, index) => this.message(entry, index + 1)),
            permissions: this.permissions?.list() ?? [],
          });
          this.subscribers.add(client);
        } catch {
          this.send(client, { type: "error", message: "Expected a snapshot.request or valid permission.reply JSON message" });
        }
      });
    });
  }

  publish(event: LogEvent): void {
    const [fileActivity, ...updates] = this.fileActivity.processAll(event);
    const entry = { event, fileActivity, fileActivityUpdates: updates.length ? updates : undefined };
    this.events.push(entry);
    if (!this.subscribers.size) return;
    const message = this.message(entry, this.events.length);
    for (const client of this.subscribers) this.send(client, { type: "event", message });
  }

  listen(port: number, host: string, callback?: () => void): void {
    this.server.listen(port, host, callback);
  }

  close(): Promise<void> {
    this.unsubscribePermissions?.();
    for (const client of this.sockets.clients) client.terminate();
    this.subscribers.clear();
    this.sockets.close();
    if (!this.ownsServer) return Promise.resolve();
    return new Promise((resolve, reject) => {
      this.server.close((error) => error ? reject(error) : resolve());
    });
  }

  address() {
    return this.server.address();
  }

  private send(client: WebSocket, response: ViewerResponse): void {
    if (client.readyState === WebSocket.OPEN) client.send(JSON.stringify(response));
  }

  private message({ event, fileActivity, fileActivityUpdates }: RetainedEvent, id: number): ViewerMessage {
    const sessionID = this.analyzer.getSessionID(event);
    return {
      id,
      event,
      fileActivity,
      fileActivityUpdates,
      content: eventContent(event),
      command: this.analyzer.getToolCall(event)?.command?.split(/\r?\n/, 1)[0],
      execution: this.analyzer.getToolExecution(event),
      sessionTitle: sessionID ? this.analyzer.getSessionTitle(sessionID) : undefined,
      session: sessionID ? this.analyzer.getSession(sessionID) : undefined,
    };
  }
}
