import { beforeEach, expect, test } from "vitest";
import { createActivityUpdates } from "../../tests/activity-fixtures";
import type { PromptActivity } from "../../server/file-activity";
import type { LogEvent } from "../../server/log-receiver";
import type { ViewerMessage } from "../../shared/viewer-protocol";
import type { FileGrepActivity, SessionActivity } from "../../shared/activity-protocol";
import { actionBadges, actionLabel, aggregateActivity, changeBreakdown, collectActivity, collectHeatmapActivity, operationCount } from "./file-activity-model";

let activityUpdates: ReturnType<typeof createActivityUpdates>;
beforeEach(() => { activityUpdates = createActivityUpdates(); });

const message = (id: number, activity: PromptActivity, ...updates: PromptActivity[]): ViewerMessage => ({
  id, event: { tag: "session.prompt", pluginID: "test", sessionID: activity.sessionID } as unknown as LogEvent,
  activityUpdates: activityUpdates(id, activity, ...updates),
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
