import type { SessionSummary, ToolExecution } from "../server/analyzer.js";
import type { PromptActivity } from "../server/file-activity.js";
import type { LogEvent } from "../server/log-receiver.js";
import type { PendingPermission, PermissionReply } from "./permission-protocol.js";

export type { SessionSummary };

export interface ViewerMessage {
  id: number;
  event: LogEvent;
  fileActivity?: PromptActivity;
  fileActivityUpdates?: PromptActivity[];
  content?: string;
  command?: string;
  execution?: ToolExecution;
  sessionTitle?: string;
  session?: SessionSummary;
}

export type ViewerRequest = { type: "snapshot.request" } | PermissionReply;

export type ViewerResponse =
  | { type: "snapshot"; sessions: SessionSummary[]; events: ViewerMessage[]; permissions: PendingPermission[] }
  | { type: "event"; message: ViewerMessage }
  | { type: "permissions"; permissions: PendingPermission[] }
  | { type: "error"; message: string };
