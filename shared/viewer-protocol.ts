import type { SessionSummary } from "../server/analyzer.js";
import type { LogEvent } from "../server/log-receiver.js";

export type { SessionSummary };

export interface ViewerMessage {
  id: number;
  event: LogEvent;
  content?: string;
  command?: string;
  sessionTitle?: string;
  session?: SessionSummary;
}

export type ViewerRequest = { type: "snapshot.request" };

export type ViewerResponse =
  | { type: "snapshot"; sessions: SessionSummary[]; events: ViewerMessage[] }
  | { type: "event"; message: ViewerMessage }
  | { type: "error"; message: string };
