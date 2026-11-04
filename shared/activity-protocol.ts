export interface ActivitySource {
  tag: string;
  pluginID: string;
  eventID?: string;
  callID?: string;
  messageID?: string;
  tool?: string;
}

export interface ActivityBase {
  id: string;
  timestamp: number;
  timestampSource: "event" | "recorded" | "received";
  source: ActivitySource;
  startEventID: number;
  eventIDs: number[];
  rationale?: { text: string; source: "rationale" | "description" };
}

export interface OperationActivity extends ActivityBase {
  promptID: string;
  status: "pending" | "completed" | "failed";
  completedAt?: number;
  error?: unknown;
}

export interface FileReadActivity extends OperationActivity {
  kind: "file.read";
  path: string;
  offset?: number;
  limit?: number;
}

export interface FileChangeActivity extends OperationActivity {
  kind: "file.change";
  path: string;
  action: "created" | "modified" | "deleted";
  operation?: "written";
  movedTo?: string;
  reverted?: boolean;
}

export interface FileGrepActivity extends OperationActivity {
  kind: "file.grep";
  scope?: string;
  pattern: string;
  include?: string;
  matchedFiles: string[];
}

export interface PromptActivity extends ActivityBase {
  kind: "prompt";
  phase: "queued" | "active";
  text: string;
  files?: unknown[];
}

export type SessionActivityItem = FileReadActivity | FileChangeActivity | FileGrepActivity | PromptActivity;

export interface SessionActivity {
  schemaVersion: 2;
  sessionID: string;
  items: SessionActivityItem[];
}

export interface SessionActivityUpdate {
  sessionID: string;
  items: SessionActivityItem[];
  removedIDs?: string[];
}

export function applyActivityUpdate(heatmaps: SessionActivity[], update: SessionActivityUpdate): SessionActivity[] {
  const previous = heatmaps.find((heatmap) => heatmap.sessionID === update.sessionID);
  const items = new Map(previous?.items.map((item) => [item.id, item]));
  for (const id of update.removedIDs ?? []) items.delete(id);
  for (const item of update.items) items.set(item.id, item);
  const heatmap: SessionActivity = {
    schemaVersion: 2, sessionID: update.sessionID,
    items: [...items.values()].sort((a, b) => a.timestamp - b.timestamp || a.startEventID - b.startEventID),
  };
  return previous
    ? heatmaps.map((entry) => entry.sessionID === update.sessionID ? heatmap : entry)
    : [...heatmaps, heatmap];
}
