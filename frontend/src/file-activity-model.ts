import type { FileTouch, PromptActivity } from "../../server/file-activity";
import type { ViewerMessage } from "../../shared/viewer-protocol";
import { applyActivityUpdate, type SessionActivity } from "../../shared/activity-protocol";

export type ActivityMode = "all" | "reads" | "changes";
export type FileWorkspace = "workspace" | "outside" | "unknown";

export interface ActivityPrompt {
  key: string;
  activity: PromptActivity;
  files: Map<string, FileTouch[]>;
  eventIDs: Set<number>;
  fileEventIDs: Map<string, Set<number>>;
  fileWorkspaces: Map<string, FileWorkspace>;
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
        files: new Map(), eventIDs: new Set(item.eventIDs), fileEventIDs: new Map(), fileWorkspaces: new Map(),
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
        prompt.fileWorkspaces.set(path, mergeWorkspace(prompt.fileWorkspaces.get(path), fileWorkspace(path, item.workspaceRoot)));
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
  const fileWorkspaces = new Map<string, FileWorkspace>();
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
    for (const [path, workspace] of prompt.fileWorkspaces) {
      fileWorkspaces.set(path, mergeWorkspace(fileWorkspaces.get(path), workspace));
    }
  }
  const sessionIDs = new Set(prompts.map((prompt) => prompt.activity.sessionID));
  return {
    key: "session-overview", pluginID: "", startEventID: prompts[0].startEventID,
    activity: {
      id: "session-overview", sessionID: sessionIDs.size === 1 ? prompts[0].activity.sessionID : "",
      text: "All prompts", files: [...files.values()].flat(),
    },
    files, eventIDs, fileEventIDs, fileWorkspaces,
  };
}

export function fileWorkspace(path: string, root?: string): FileWorkspace {
  const normalized = path.replaceAll("\\", "/");
  if (normalized === ".." || normalized.startsWith("../")) return "outside";
  if (/^(?:[a-z]:)?\//i.test(normalized)) {
    if (!root) return "unknown";
    const base = root.replaceAll("\\", "/").replace(/\/+$/, "");
    return normalized === base || normalized.startsWith(`${base}/`) ? "workspace" : "outside";
  }
  if (/^[a-z]:/i.test(normalized) || normalized.startsWith("~/")) return "unknown";
  return "workspace";
}

function mergeWorkspace(previous: FileWorkspace | undefined, next: FileWorkspace): FileWorkspace {
  return previous === undefined || previous === next ? next : "unknown";
}

export function groupWorkspacePaths(prompts: ActivityPrompt[], paths: string[]) {
  const workspaces = new Map<string, FileWorkspace>();
  for (const prompt of prompts) {
    for (const [path, workspace] of prompt.fileWorkspaces) {
      workspaces.set(path, mergeWorkspace(workspaces.get(path), workspace));
    }
  }
  return ([
    { workspace: "outside", label: "Outside workspace" },
    { workspace: "workspace", label: "In workspace" },
    { workspace: "unknown", label: "Workspace unknown" },
  ] as const).map((group) => ({
    ...group, paths: paths.filter((path) => workspaces.get(path) === group.workspace),
  })).filter((group) => group.paths.length > 0);
}

export type FileActivityRow =
  | { kind: "folder"; path: string; key: string; label: string; depth: number; count: number }
  | { kind: "file"; path: string; depth: number };

export function fileActivityRows(paths: string[], workspace: FileWorkspace, collapsed: ReadonlySet<string>): FileActivityRow[] {
  const rows: FileActivityRow[] = [];
  const folderKey = (path: string) => JSON.stringify([workspace, path]);
  if (workspace !== "workspace") {
    for (const folder of new Set(paths.map(folderName))) {
      const files = paths.filter((path) => folderName(path) === folder);
      const key = folderKey(folder);
      rows.push({ kind: "folder", path: folder, key, label: folder === "/" ? "/" : `${folder}/`, depth: 0, count: files.length });
      if (!collapsed.has(key)) rows.push(...files.map((path) => ({ kind: "file" as const, path, depth: 1 })));
    }
    return rows;
  }
  interface Directory {
    path: string;
    name: string;
    folders: Map<string, Directory>;
    files: string[];
    count: number;
  }
  const directory = (path: string, name: string): Directory => ({ path, name, folders: new Map(), files: [], count: 0 });
  const root = directory("", "");
  for (const path of new Set(paths)) {
    const parts = path.split("/");
    let parent = root;
    for (let index = 0; index < parts.length - 1; index++) {
      const name = parts[index];
      let child = parent.folders.get(name);
      if (!child) {
        child = directory(parts.slice(0, index + 1).join("/") || "/", name);
        parent.folders.set(name, child);
      }
      child.count++;
      parent = child;
    }
    parent.files.push(path);
  }
  const visit = (parent: Directory, depth: number) => {
    for (const child of [...parent.folders.values()].sort((a, b) => a.name.localeCompare(b.name))) {
      const key = folderKey(child.path);
      rows.push({ kind: "folder", path: child.path, key, label: `${child.name}/`, depth, count: child.count });
      if (!collapsed.has(key)) visit(child, depth + 1);
    }
    for (const path of parent.files.sort((a, b) => a.localeCompare(b))) rows.push({ kind: "file", path, depth });
  };
  visit(root, 0);
  return rows;
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
