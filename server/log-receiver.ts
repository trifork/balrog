import { createServer, type Server } from "node:http";

export type LogEvent = Record<string, unknown>;
export type LogEventListener = (event: LogEvent) => void;

/** Receives log events over HTTP and publishes each valid event to subscribers. */
export class LogReceiver {
  private readonly listeners = new Set<LogEventListener>();
  private readonly server: Server;

  constructor() {
    this.server = createServer(async (request, response) => {
      const reply = (status: number, body: object) => {
        response.writeHead(status, { "Content-Type": "application/json" });
        response.end(JSON.stringify(body));
      };

      if (request.url !== "/log") {
        reply(404, { error: "Not found" });
        return;
      }

      if (request.method !== "POST") {
        response.setHeader("Allow", "POST");
        reply(405, { error: "Method not allowed" });
        return;
      }

      try {
        const chunks: Buffer[] = [];
        for await (const chunk of request) {
          chunks.push(Buffer.from(chunk));
        }

        const event: unknown = JSON.parse(
          Buffer.concat(chunks).toString("utf8"),
        );
        if (
          event === null ||
          typeof event !== "object" ||
          Array.isArray(event)
        ) {
          reply(400, { error: "Expected a JSON object" });
          return;
        }

        for (const listener of this.listeners) {
          listener(event as LogEvent);
        }
        reply(200, { ok: true });
      } catch {
        reply(400, { error: "Invalid JSON or incomplete request" });
      }
    });
  }

  subscribe(listener: LogEventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  listen(port: number, host: string, callback?: () => void): void {
    this.server.listen(port, host, callback);
  }
}
