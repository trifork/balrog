import type { SessionSummary, ToolExecution } from "../server/analyzer.js";
import type { SessionActivity, SessionActivityUpdate } from "./activity-protocol.js";
import type { LogEvent } from "../server/log-receiver.js";
import type { PendingPermission, PermissionReply } from "./permission-protocol.js";

export type { SessionSummary };

export interface ViewerMessage {
  id: number;
  event: LogEvent;
  activityUpdates?: SessionActivityUpdate;
  content?: string;
  command?: string;
  execution?: ToolExecution;
  sessionTitle?: string;
  session?: SessionSummary;
}

export type ViewerRequest = { type: "snapshot.request" } | PermissionReply;

export type ViewerResponse =
  | { type: "snapshot"; sessions: SessionSummary[]; events: ViewerMessage[]; heatmaps: SessionActivity[]; permissions: PendingPermission[] }
  | { type: "event"; message: ViewerMessage }
  | { type: "permissions"; permissions: PendingPermission[] }
  | { type: "error"; message: string };
