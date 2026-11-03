import { createServer, type Server } from "node:http";
import { WebSocket, WebSocketServer } from "ws";
import type { ViewerMessage, ViewerResponse } from "../shared/viewer-protocol.js";
import { SessionAnalyzer } from "./analyzer.js";
import { eventContent } from "./event-content.js";
import { serveFrontend } from "./frontend.js";
import type { LogEvent } from "./log-receiver.js";

export class LogViewer {
  private readonly events: LogEvent[] = [];
  private readonly subscribers = new Set<WebSocket>();
  private readonly sockets = new WebSocketServer({ noServer: true, maxPayload: 16_384 });
  private readonly server: Server;

  constructor(private readonly analyzer = new SessionAnalyzer()) {
    this.server = createServer((request, response) => {
      if (request.method !== "GET") {
        response.writeHead(405, { Allow: "GET" });
        response.end("Method not allowed");
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
      if (pathname === "/api/sessions") {
        response.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        response.end(JSON.stringify(this.analyzer.getSessions()));
        return;
      }

      if (pathname.startsWith("/api/sessions/")) {
        let sessionID: string;
        try {
          sessionID = decodeURIComponent(pathname.slice("/api/sessions/".length));
        } catch {
          response.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
          response.end(JSON.stringify({ error: "Invalid session ID" }));
          return;
        }
        const session = this.analyzer.getSession(sessionID);
        response.writeHead(session ? 200 : 404, { "Content-Type": "application/json; charset=utf-8" });
        response.end(JSON.stringify(session ?? { error: "Session not found" }));
        return;
      }

      void serveFrontend(pathname, response);
    });

    this.server.on("upgrade", (request, socket, head) => {
      const reject = (status: string) => {
        socket.end(`HTTP/1.1 ${status}\r\nConnection: close\r\n\r\n`);
      };
      let pathname: string;
      try {
        pathname = new URL(request.url ?? "/", "http://localhost").pathname;
      } catch {
        reject("400 Bad Request");
        return;
      }
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
          if (!request || typeof request !== "object" || !("type" in request) || request.type !== "snapshot.request") {
            throw new Error("Invalid request");
          }
          this.send(client, {
            type: "snapshot",
            sessions: this.analyzer.getSessions(),
            events: this.events.map((event, index) => this.message(event, index + 1)),
          });
          this.subscribers.add(client);
        } catch {
          this.send(client, { type: "error", message: "Expected a snapshot.request JSON message" });
        }
      });
    });
  }

  publish(event: LogEvent): void {
    this.events.push(event);
    if (!this.subscribers.size) return;
    const message = this.message(event, this.events.length);
    for (const client of this.subscribers) this.send(client, { type: "event", message });
  }

  listen(port: number, host: string, callback?: () => void): void {
    this.server.listen(port, host, callback);
  }

  close(): Promise<void> {
    for (const client of this.sockets.clients) client.terminate();
    this.subscribers.clear();
    this.sockets.close();
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

  private message(event: LogEvent, id: number): ViewerMessage {
    const sessionID = this.analyzer.getSessionID(event);
    return {
      id,
      event,
      content: eventContent(event),
      command: this.analyzer.getToolCall(event)?.command?.split(/\r?\n/, 1)[0],
      sessionTitle: sessionID ? this.analyzer.getSessionTitle(sessionID) : undefined,
      session: sessionID ? this.analyzer.getSession(sessionID) : undefined,
    };
  }
}
