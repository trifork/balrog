import type { FileTouch, PromptActivity } from "../../server/file-activity";
import type { ViewerMessage } from "../../shared/viewer-protocol";
import { applyActivityUpdate, type SessionActivity } from "../../shared/activity-protocol";

export type ActivityMode = "all" | "reads" | "changes";

export interface ActivityPrompt {
  key: string;
  activity: PromptActivity;
  files: Map<string, FileTouch[]>;
  eventIDs: Set<number>;
  fileEventIDs: Map<string, Set<number>>;
  pluginID: string;
  apiVersion?: string;
  startEventID: number;
  timestamp?: number;
}

export const actionLabels = {
  read: "Read", modified: "Edit", written: "Write", created: "Added", deleted: "Deleted",
};

export function groupTouches(touches: FileTouch[]): Map<string, FileTouch[]> {
  const files = new Map<string, FileTouch[]>();
  for (const touch of touches) {
    const entries = files.get(touch.path) ?? [];
    // A snapshot replaces prior state; duplicate hooks must not inflate operations.
    if (!entries.some((entry) => entry.callID === touch.callID && entry.action === touch.action && entry.via === touch.via)) entries.push(touch);
    files.set(touch.path, entries);
  }
  return files;
}

export function activityAtEvents(events: ViewerMessage[]): SessionActivity[] {
  return events.reduce<SessionActivity[]>((heatmaps, message) => message.activityUpdates
    ? applyActivityUpdate(heatmaps, message.activityUpdates) : heatmaps, []);
}

export function collectActivity(events: ViewerMessage[], selectedSession: string): ActivityPrompt[] {
  return collectHeatmapActivity(activityAtEvents(events), selectedSession);
}

/** Project canonical heatmap items without inspecting raw tool events. */
export function collectHeatmapActivity(heatmaps: SessionActivity[], selectedSession: string): ActivityPrompt[] {
  const retained = new Map<string, ActivityPrompt>();
  const sessions = heatmaps.filter((heatmap) => !selectedSession || heatmap.sessionID === selectedSession);
  for (const { sessionID, items } of sessions) {
    for (const item of items) {
      if (item.kind !== "prompt" || item.phase !== "active") continue;
      retained.set(item.id, {
        key: item.id, activity: { id: item.id, sessionID, text: item.text, files: [] },
        files: new Map(), eventIDs: new Set(item.eventIDs), fileEventIDs: new Map(),
        pluginID: item.source.pluginID, startEventID: item.startEventID, timestamp: item.timestamp,
      });
    }
    for (const item of items) {
      if (item.kind === "prompt") continue;
      const prompt = retained.get(item.promptID);
      if (!prompt || !item.source.callID) continue;
      for (const id of item.eventIDs) prompt.eventIDs.add(id);
      const paths = item.kind === "file.grep" ? item.status === "completed" ? item.matchedFiles : [] : [item.path];
      for (const path of new Set(paths)) {
        prompt.activity.files.push({
          path, callID: item.source.callID,
          action: item.kind === "file.change" ? item.operation ?? item.action : "read",
          outcome: item.status === "completed" ? "success" : item.status === "failed" ? "failed" : "pending",
          ...(item.kind === "file.grep" ? { via: "grep" as const } : {}),
          ...(item.kind === "file.change" && item.reverted ? { reverted: true } : {}),
        });
        const ids = prompt.fileEventIDs.get(path) ?? new Set<number>();
        for (const id of item.eventIDs) ids.add(id);
        prompt.fileEventIDs.set(path, ids);
      }
    }
  }
  for (const prompt of retained.values()) prompt.files = groupTouches(prompt.activity.files);
  return [...retained.values()].filter((prompt) => prompt.activity.text !== "Execution (prompt text unavailable)")
    .sort((a, b) => a.startEventID - b.startEventID);
}

export function aggregateActivity(prompts: ActivityPrompt[]): ActivityPrompt | undefined {
  if (!prompts.length) return undefined;
  const files = new Map<string, FileTouch[]>();
  const eventIDs = new Set<number>();
  const fileEventIDs = new Map<string, Set<number>>();
  for (const prompt of prompts) {
    for (const [path, touches] of prompt.files) {
      const entries = files.get(path) ?? [];
      entries.push(...touches.map((touch) => ({
        ...touch, callID: JSON.stringify([prompt.pluginID, prompt.key, touch.callID]),
      })));
      files.set(path, entries);
    }
    for (const id of prompt.eventIDs) eventIDs.add(id);
    for (const [path, ids] of prompt.fileEventIDs) {
      const retained = fileEventIDs.get(path) ?? new Set<number>();
      for (const id of ids) retained.add(id);
      fileEventIDs.set(path, retained);
    }
  }
  const sessionIDs = new Set(prompts.map((prompt) => prompt.activity.sessionID));
  return {
    key: "session-overview", pluginID: "", startEventID: prompts[0].startEventID,
    activity: {
      id: "session-overview", sessionID: sessionIDs.size === 1 ? prompts[0].activity.sessionID : "",
      text: "All prompts", files: [...files.values()].flat(),
    },
    files, eventIDs, fileEventIDs,
  };
}

export function changeBreakdown(touches: FileTouch[]) {
  const counts = { created: 0, edited: 0, deleted: 0, total: 0 };
  const seen = new Set<string>();
  for (const touch of touches) {
    if (touch.outcome !== "success" || touch.reverted || touch.action === "read") continue;
    const key = JSON.stringify([touch.path, touch.callID, touch.action]);
    if (seen.has(key)) continue;
    seen.add(key);
    const kind = touch.action === "created" ? "created" : touch.action === "deleted" ? "deleted" : "edited";
    counts[kind] += 1;
    counts.total += 1;
  }
  return counts;
}

export function matchesMode(touch: FileTouch, mode: ActivityMode): boolean {
  return mode === "all" || (mode === "reads" ? touch.action === "read" : touch.action !== "read");
}

export function operationCount(touches: FileTouch[], mode: ActivityMode = "all"): number {
  return new Set(touches.filter((touch) => touch.outcome === "success" && matchesMode(touch, mode)
    && (mode !== "changes" || !touch.reverted)).map((touch) => touch.callID)).size;
}

export const heatLevel = (count: number) => count === 0 ? 0 : count === 1 ? 1 : count <= 3 ? 2 : count <= 7 ? 3 : 4;
export const metricLabel = (mode: ActivityMode) => mode === "reads" ? "successful reads and grep matches" : mode === "changes" ? "unreverted changes" : "successful operations";
export const fileName = (path: string) => path.slice(path.lastIndexOf("/") + 1);
export const folderName = (path: string) => path.includes("/") ? path.slice(0, path.lastIndexOf("/")) || "/" : ".";
export const promptNumber = (index: number) => String(index + 1).padStart(2, "0");

export function actionLabel(touch: FileTouch): string {
  const label = touch.action === "read" && touch.via === "grep" ? "Grep match" : actionLabels[touch.action];
  return `${label}${touch.outcome === "success" ? "" : ` (${touch.outcome})`}${touch.reverted ? " (Reverted)" : ""}`;
}

export const actionBadgeKey = (touch: FileTouch) => `${touch.action}/${touch.via ?? ""}/${touch.outcome}/${Boolean(touch.reverted)}`;

export function actionBadges(touches: FileTouch[]): FileTouch[] {
  return [...new Map(touches.map((touch) => [actionBadgeKey(touch), touch])).values()];
}
