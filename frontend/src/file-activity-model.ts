import type { FileTouch, PromptActivity } from "../../server/file-activity";
import type { ViewerMessage } from "../../shared/viewer-protocol";

export type ActivityMode = "all" | "reads" | "changes";

export interface ActivityPrompt {
  key: string;
  activity: PromptActivity;
  files: Map<string, FileTouch[]>;
  eventIDs: Set<number>;
  fileEventIDs: Map<string, Set<number>>;
  pluginID: string;
  timestamp?: number;
}

export const actionLabels = {
  read: "Read", modified: "Edit", written: "Write", created: "Added", deleted: "Deleted",
};

const object = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : undefined;

function callIdentity(message: ViewerMessage) {
  const envelope = message.event as unknown as Record<string, unknown>;
  const payload = object(envelope[String(envelope.tag)]);
  const native = object(payload?.event) ?? payload;
  const data = object(native?.data) ?? native;
  const callID = data?.id ?? data?.callID ?? object(payload?.input)?.callID;
  const sessionID = message.session?.sessionID ?? envelope.sessionID ?? data?.sessionID;
  if (!String(envelope.tag).includes("tool.") || typeof callID !== "string") return;
  return JSON.stringify([envelope.pluginID ?? "", sessionID, callID]);
}

export function groupTouches(touches: FileTouch[]): Map<string, FileTouch[]> {
  const files = new Map<string, FileTouch[]>();
  for (const touch of touches) {
    const entries = files.get(touch.path) ?? [];
    // A snapshot replaces prior state; duplicate hooks must not inflate operations.
    if (!entries.some((entry) => entry.callID === touch.callID && entry.action === touch.action)) entries.push(touch);
    files.set(touch.path, entries);
  }
  return files;
}

/** Preserve first-seen prompt order while replacing snapshots, including undo updates. */
export function collectActivity(events: ViewerMessage[], selectedSession: string): ActivityPrompt[] {
  const retained = new Map<string, ActivityPrompt>();
  for (const message of events) {
    for (const activity of [
      ...(message.fileActivity ? [message.fileActivity] : []),
      ...(message.fileActivityUpdates ?? []),
    ]) {
      if (selectedSession && activity.sessionID !== selectedSession) continue;
      const key = JSON.stringify([activity.sessionID, activity.id]);
      let prompt = retained.get(key);
      if (!prompt) {
        prompt = {
          key, activity, files: new Map(), eventIDs: new Set(), fileEventIDs: new Map(),
          pluginID: message.event.pluginID,
          timestamp: Number.isFinite(message.event.created) ? message.event.created : undefined,
        };
        retained.set(key, prompt);
      }
      const files = groupTouches(activity.files);
      for (const path of new Set([...prompt.files.keys(), ...files.keys()])) {
        if (JSON.stringify(prompt.files.get(path)) !== JSON.stringify(files.get(path))) {
          const ids = prompt.fileEventIDs.get(path) ?? new Set<number>();
          ids.add(message.id);
          prompt.fileEventIDs.set(path, ids);
        }
      }
      prompt.activity = activity;
      prompt.files = files;
      prompt.eventIDs.add(message.id);
    }
  }

  // Include tool-start and outcome events even when they carried no snapshot.
  const calls = new Map<string, Array<{ prompt: ActivityPrompt; path: string }>>();
  for (const prompt of retained.values()) {
    for (const [path, touches] of prompt.files) {
      for (const callID of new Set(touches.map((touch) => touch.callID))) {
        const key = JSON.stringify([prompt.pluginID, prompt.activity.sessionID, callID]);
        const entries = calls.get(key) ?? [];
        entries.push({ prompt, path });
        calls.set(key, entries);
      }
    }
  }
  for (const message of events) {
    const key = callIdentity(message);
    if (!key) continue;
    for (const { prompt, path } of calls.get(key) ?? []) {
      prompt.eventIDs.add(message.id);
      const ids = prompt.fileEventIDs.get(path) ?? new Set<number>();
      ids.add(message.id);
      prompt.fileEventIDs.set(path, ids);
    }
  }
  return [...retained.values()];
}

export function matchesMode(touch: FileTouch, mode: ActivityMode): boolean {
  return mode === "all" || (mode === "reads" ? touch.action === "read" : touch.action !== "read");
}

export function operationCount(touches: FileTouch[], mode: ActivityMode = "all"): number {
  return new Set(touches.filter((touch) => touch.outcome === "success" && matchesMode(touch, mode)
    && (mode !== "changes" || !touch.reverted)).map((touch) => touch.callID)).size;
}

export const heatLevel = (count: number) => count === 0 ? 0 : count === 1 ? 1 : count <= 3 ? 2 : count <= 7 ? 3 : 4;
export const metricLabel = (mode: ActivityMode) => mode === "reads" ? "successful reads" : mode === "changes" ? "unreverted changes" : "successful operations";
export const fileName = (path: string) => path.slice(path.lastIndexOf("/") + 1);
export const folderName = (path: string) => path.includes("/") ? path.slice(0, path.lastIndexOf("/")) || "/" : ".";
export const promptNumber = (index: number) => String(index + 1).padStart(2, "0");

export function actionLabel(touch: FileTouch): string {
  return `${actionLabels[touch.action]}${touch.outcome === "success" ? "" : ` (${touch.outcome})`}${touch.reverted ? " (Reverted)" : ""}`;
}

export function actionBadges(touches: FileTouch[]): FileTouch[] {
  return [...new Map(touches.map((touch) => [`${touch.action}/${touch.outcome}/${Boolean(touch.reverted)}`, touch])).values()];
}
