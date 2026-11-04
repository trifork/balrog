import { beforeEach, expect, test } from "vitest";
import { createActivityUpdates } from "../../tests/activity-fixtures";
import type { PromptActivity } from "../../server/file-activity";
import type { LogEvent } from "../../server/log-receiver";
import type { ViewerMessage } from "../../shared/viewer-protocol";
import type { FileGrepActivity, SessionActivity } from "../../shared/activity-protocol";
import { actionBadges, actionLabel, aggregateActivity, changeBreakdown, collectActivity, collectHeatmapActivity, fileActivityRows, fileWorkspace, groupWorkspacePaths, operationCount } from "./file-activity-model";

let activityUpdates: ReturnType<typeof createActivityUpdates>;
beforeEach(() => { activityUpdates = createActivityUpdates(); });

const message = (id: number, activity: PromptActivity, ...updates: PromptActivity[]): ViewerMessage => ({
  id, event: { tag: "session.prompt", pluginID: "test", sessionID: activity.sessionID } as unknown as LogEvent,
  activityUpdates: activityUpdates(id, activity, ...updates),
});

test("classifies normalized file paths against their recorded workspace without guessing missing roots", () => {
  for (const [path, root, expected] of [
    ["src/app.ts", "/workspace", "workspace"],
    ["README.md", undefined, "workspace"],
    ["/workspace/src/app.ts", "/workspace", "workspace"],
    ["/workspace-other/app.ts", "/workspace", "outside"],
    ["../shared/app.ts", "/workspace", "outside"],
    ["..", "/workspace", "outside"],
    ["/etc/config", "/workspace", "outside"],
    ["/unknown/app.ts", undefined, "unknown"],
    ["/etc/config", "/", "workspace"],
    ["C:/repo/src/app.ts", "C:\\repo", "workspace"],
    ["C:/repo-other/app.ts", "C:\\repo", "outside"],
    ["D:/repo/app.ts", "C:/repo", "outside"],
    ["C:/repo/app.ts", undefined, "unknown"],
    ["C:app.ts", "C:/repo", "unknown"],
  ] as const) expect(fileWorkspace(path, root)).toBe(expected);
});

test("workspace groups preserve canonical context for reads, changes, grep matches and historical playback", () => {
  const initial = activityUpdates(1, { id: "1", sessionID: "s1", text: "Read workspace files", files: [
    { path: "src/app.ts", action: "read", outcome: "success", callID: "read" },
    { path: "/etc/config", action: "modified", outcome: "success", callID: "edit" },
  ] });
  initial.items = initial.items.map((item) => ({ ...item, workspaceRoot: "/workspace" }));
  const grep: FileGrepActivity = {
    id: "grep", promptID: initial.items[0].id, kind: "file.grep", status: "completed", workspaceRoot: "/workspace",
    timestamp: 2, timestampSource: "recorded", startEventID: 2, eventIDs: [2],
    source: { tag: "session.tool.called", pluginID: "test", callID: "grep" },
    pattern: "needle", matchedFiles: ["src/matched.ts", "../shared/helper.ts"],
  };
  const first: ViewerMessage = {
    id: 1, event: { tag: "session.prompt", sessionID: "s1", pluginID: "test" } as unknown as LogEvent,
    activityUpdates: initial,
  };
  const second: ViewerMessage = { ...first, id: 2, activityUpdates: { sessionID: "s1", items: [grep] } };
  const before = collectActivity([first], "s1");
  const after = collectActivity([first, second], "s1");
  expect(groupWorkspacePaths(before, ["src/app.ts", "/etc/config"]).map((group) => [group.label, group.paths])).toEqual([
    ["Outside workspace", ["/etc/config"]], ["In workspace", ["src/app.ts"]],
  ]);
  expect(groupWorkspacePaths(after, ["../shared/helper.ts", "/etc/config", "src/app.ts", "src/matched.ts"]).map((group) => [group.label, group.paths])).toEqual([
    ["Outside workspace", ["../shared/helper.ts", "/etc/config"]], ["In workspace", ["src/app.ts", "src/matched.ts"]],
  ]);
  expect(aggregateActivity(after)!.fileWorkspaces.get("../shared/helper.ts")).toBe("outside");
  expect(groupWorkspacePaths(after, ["src/matched.ts"]).map((group) => group.label)).toEqual(["In workspace"]);
});

test("workspace rows form a nested directory tree with stable collapse keys and descendant counts", () => {
  const paths = ["README.md", "src/app.ts", "src/features/auth/login.ts", "src/features/cart.ts", "tests/app.test.ts"];
  const rows = fileActivityRows(paths, "workspace", new Set());
  expect(rows.map((row) => [row.kind, row.path, row.depth])).toEqual([
    ["folder", "src", 0], ["folder", "src/features", 1], ["folder", "src/features/auth", 2],
    ["file", "src/features/auth/login.ts", 3], ["file", "src/features/cart.ts", 2], ["file", "src/app.ts", 1],
    ["folder", "tests", 0], ["file", "tests/app.test.ts", 1], ["file", "README.md", 0],
  ]);
  expect(rows.flatMap((row) => row.kind === "folder" ? [[row.label, row.count]] : [])).toEqual([
    ["src/", 3], ["features/", 2], ["auth/", 1], ["tests/", 1],
  ]);
  const folder = rows.find((row) => row.kind === "folder" && row.path === "src/features");
  expect(folder?.kind).toBe("folder");
  if (folder?.kind !== "folder") throw new Error("Missing features directory");
  const collapsed = fileActivityRows(paths, "workspace", new Set([folder.key]));
  expect(collapsed.map((row) => row.path)).toEqual(["src", "src/features", "src/app.ts", "tests", "tests/app.test.ts", "README.md"]);
  const external = fileActivityRows(["../shared/auth/login.ts"], "outside", new Set());
  expect(external[0]).toMatchObject({ kind: "folder", label: "../shared/auth/", depth: 0 });
});

test("unknown and conflicting workspace contexts stay explicit across sessions", () => {
  const fixture = (sessionID: string, workspaceRoot?: string): SessionActivity => {
    const update = activityUpdates(1, { id: "1", sessionID, text: "Read a file", files: [
      { path: "/shared/app.ts", action: "read", outcome: "success", callID: "read" },
    ] });
    return { schemaVersion: 2, sessionID, items: update.items.map((item) => ({ ...item, workspaceRoot })) };
  };
  const unknown = collectHeatmapActivity([fixture("unknown")], "");
  expect(groupWorkspacePaths(unknown, ["/shared/app.ts"])[0].label).toBe("Workspace unknown");
  const mixed = collectHeatmapActivity([fixture("inside", "/shared"), fixture("outside", "/workspace")], "");
  expect(groupWorkspacePaths(mixed, ["/shared/app.ts"])[0].label).toBe("Workspace unknown");
  expect(groupWorkspacePaths(collectHeatmapActivity([fixture("outside", "/workspace")], "outside"), ["/shared/app.ts"])[0].label).toBe("Outside workspace");
});

test("grep matched files count as reads without inflating changes or repeated matches", () => {
  const prompt: PromptActivity = { id: "1", sessionID: "s1", text: "Search files", files: [
    { path: "app.ts", action: "read", outcome: "success", callID: "read" },
    { path: "changed.ts", action: "modified", outcome: "success", callID: "edit" },
  ] };
  const initial = activityUpdates(1, prompt);
  const grep: FileGrepActivity = {
    id: "grep", promptID: initial.items[0].id, kind: "file.grep", status: "completed",
    timestamp: 2, timestampSource: "recorded", startEventID: 2, eventIDs: [2, 3, 4],
    source: { tag: "session.tool.called", pluginID: "test", callID: "grep" },
    pattern: "needle", scope: "src", matchedFiles: ["app.ts", "match.ts", "app.ts"],
  };
  const heatmap: SessionActivity = { schemaVersion: 2, sessionID: "s1", items: [...initial.items, grep] };
  const [collected] = collectHeatmapActivity([heatmap], "s1");
  expect([...collected.files.keys()].sort()).toEqual(["app.ts", "changed.ts", "match.ts"]);
  const touches = collected.files.get("app.ts")!;
  expect(operationCount(touches, "reads")).toBe(2);
  expect(operationCount(touches, "all")).toBe(2);
  expect(operationCount(touches, "changes")).toBe(0);
  expect(operationCount(collected.files.get("match.ts")!, "reads")).toBe(1);
  expect(changeBreakdown(collected.activity.files)).toEqual({ created: 0, edited: 1, deleted: 0, total: 1 });
  expect(actionBadges(touches).map(actionLabel)).toEqual(["Read", "Grep match"]);
  expect(collected.fileEventIDs.get("match.ts")).toEqual(new Set([2, 3, 4]));
  expect(collectHeatmapActivity([heatmap], "other")).toEqual([]);
  const [repeated] = collectHeatmapActivity([{
    ...heatmap, items: [...heatmap.items, { ...grep, id: "grep-again", source: { ...grep.source, callID: "grep-again" } }],
  }], "s1");
  expect(operationCount(repeated.files.get("app.ts")!, "reads")).toBe(3);
  expect(operationCount(repeated.files.get("match.ts")!, "reads")).toBe(2);
});

test("grep does not claim reads for pending searches, failures, empty results or the search scope", () => {
  const initial = activityUpdates(1, { id: "1", sessionID: "s1", text: "Search", files: [] });
  const grep: FileGrepActivity = {
    id: "grep", promptID: initial.items[0].id, kind: "file.grep", status: "pending",
    timestamp: 2, timestampSource: "recorded", startEventID: 2, eventIDs: [2, 3],
    source: { tag: "session.tool.called", pluginID: "test", callID: "grep" },
    pattern: "needle", scope: "src", matchedFiles: ["unconfirmed.ts"],
  };
  for (const result of [grep, { ...grep, status: "failed" as const }, { ...grep, status: "completed" as const, matchedFiles: [] }]) {
    const [prompt] = collectHeatmapActivity([{ schemaVersion: 2, sessionID: "s1", items: [...initial.items, result] }], "");
    expect(prompt.files.size).toBe(0);
    expect(prompt.eventIDs).toEqual(new Set([1, 2, 3]));
  }
});

test("prompt boundaries retain their original event when snapshots or undo updates arrive", () => {
  const first: PromptActivity = { id: "1", sessionID: "s1", text: "First", files: [] };
  const second = { ...first, id: "2", text: "Second" };
  const prompts = collectActivity([
    message(10, first), message(20, second),
    message(30, second, { ...first, text: "First updated" }),
  ], "");
  expect(prompts.map((prompt) => prompt.startEventID)).toEqual([10, 20]);
  expect(prompts.map((prompt) => prompt.activity.text)).toEqual(["First updated", "Second"]);
});

test("session summaries merge latest snapshots and isolate repeated call IDs across prompts and sessions", () => {
  const first: PromptActivity = { id: "1", sessionID: "s1", text: "First", files: [
    { path: "app.ts", action: "modified", outcome: "pending", callID: "same" },
  ] };
  const second: PromptActivity = { ...first, id: "2", text: "Second", files: [
    { path: "app.ts", action: "created", outcome: "success", callID: "same" },
  ] };
  const other: PromptActivity = { ...first, sessionID: "s2", files: [
    { path: "app.ts", action: "deleted", outcome: "success", callID: "same" },
  ] };
  const events = [message(1, first), message(2, second), message(3, other), message(4, {
    ...first, files: first.files.map((file) => ({ ...file, outcome: "success" as const })),
  })];
  const summary = aggregateActivity(collectActivity(events, ""))!;
  expect(operationCount(summary.files.get("app.ts")!)).toBe(3);
  expect(summary.eventIDs).toEqual(new Set([1, 2, 3, 4]));
  expect(summary.fileEventIDs.get("app.ts")).toEqual(new Set([1, 2, 3, 4]));
  expect(operationCount(aggregateActivity(collectActivity(events, "s1"))!.files.get("app.ts")!)).toBe(2);
  expect(aggregateActivity([])).toBeUndefined();
});

test("change proportions count confirmed unreverted file operations rather than reads or attempts", () => {
  const counts = changeBreakdown([
    { path: "a.ts", action: "created", outcome: "success", callID: "a" },
    { path: "a.ts", action: "created", outcome: "success", callID: "a" },
    { path: "b.ts", action: "modified", outcome: "success", callID: "b" },
    { path: "c.ts", action: "written", outcome: "success", callID: "c" },
    { path: "d.ts", action: "deleted", outcome: "success", callID: "d" },
    { path: "read.ts", action: "read", outcome: "success", callID: "read" },
    { path: "pending.ts", action: "created", outcome: "pending", callID: "pending" },
    { path: "failed.ts", action: "deleted", outcome: "failed", callID: "failed" },
    { path: "undone.ts", action: "modified", outcome: "success", callID: "undone", reverted: true },
  ]);
  expect(counts).toEqual({ created: 1, edited: 2, deleted: 1, total: 4 });
  expect(changeBreakdown([])).toEqual({ created: 0, edited: 0, deleted: 0, total: 0 });
});
