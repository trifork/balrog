import { createServer, type Server } from "node:http";
import type { OpenCodeEvent } from "@opencode/protocol/groups/event";
import type { PermissionBroker } from "./permissions.js";
import { isLoopbackHost } from "./loopback.js";

interface LogMetadata {
  /** Recorder observation time in Unix milliseconds (older logs may omit it). */
  created?: number;
  apiVersion: "v2";
  pluginID: string;
  sessionID: string | null;
}

interface LogLocation {
  directory: string;
  workspaceID?: string;
  project: {
    id: string;
    directory: string;
    canonical: string;
  };
}

export interface InitPluginEvent extends LogMetadata {
  tag: "initialize";
  sessionID: null;
  initialize: {
    context: {
      location: LogLocation;
      version: string;
    };
  };
}

type OpenCodeEventLog<Event extends OpenCodeEvent = OpenCodeEvent> =
  Event extends OpenCodeEvent
    ? LogMetadata & { tag: Event["type"] } & Record<Event["type"], Event>
    : never;

type EventLogEvent = OpenCodeEventLog;

export interface ToolIntentLog extends LogMetadata {
  tag: "balrog.tool.intent";
  "balrog.tool.intent": {
    type: "balrog.tool.intent";
    created: number;
    data: {
      sessionID: string;
      assistantMessageID: string;
      id: string;
      tool: string;
      reason: string;
    };
  };
}

export interface ToolOutcomeLog extends LogMetadata {
  tag: "balrog.tool.outcome";
  "balrog.tool.outcome": {
    type: "balrog.tool.outcome";
    created: number;
    data: {
      sessionID: string;
      assistantMessageID: string;
      id: string;
      reportCallID: string;
      outcome: string;
    };
  };
}

export interface ToolAssessmentLog extends LogMetadata {
  tag: "balrog.tool.assessed";
  "balrog.tool.assessed": {
    type: "balrog.tool.assessed";
    created: number;
    data: { sessionID: string; id: string; reason: string; outcome: string };
  };
}

export type LogEvent = InitPluginEvent | EventLogEvent | ToolIntentLog | ToolOutcomeLog | ToolAssessmentLog;
export type LogEventListener = (event: LogEvent) => void;

/** Receives log events over HTTP and publishes each valid event to subscribers. */
export class LogReceiver {
  private readonly listeners = new Set<LogEventListener>();
  private readonly server: Server;
  private readonly ownsServer: boolean;

  constructor(private readonly permissions?: PermissionBroker, server?: Server) {
    this.ownsServer = server === undefined;
    this.server = server ?? createServer();
    this.server.on("request", async (request, response) => {
      const reply = (status: number, body: object) => {
        response.writeHead(status, { "Content-Type": "application/json" });
        response.end(JSON.stringify(body));
      };

      if (request.url !== "/log") {
        if (this.ownsServer) reply(404, { error: "Not found" });
        return;
      }

      if (!isLoopbackHost(request.headers.host)) {
        reply(403, { error: "Forbidden host" });
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
    permissions?.attach(this.server);
  }

  subscribe(listener: LogEventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  listen(port: number, host: string, callback?: () => void): void {
    this.server.listen(port, host, callback);
  }

  address() {
    return this.server.address();
  }

  close(): Promise<void> {
    this.permissions?.close();
    if (!this.ownsServer) return Promise.resolve();
    return new Promise((resolve, reject) => {
      this.server.close((error) => error ? reject(error) : resolve());
    });
  }
}
