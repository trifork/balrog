import { expect, test } from "vitest";
import type { PromptActivity } from "../../server/file-activity";
import type { LogEvent } from "../../server/log-receiver";
import type { ViewerMessage } from "../../shared/viewer-protocol";
import { aggregateActivity, changeBreakdown, collectActivity, operationCount } from "./file-activity-model";

const message = (id: number, activity: PromptActivity): ViewerMessage => ({
  id, event: { tag: "session.prompt", pluginID: "test", sessionID: activity.sessionID } as unknown as LogEvent,
  fileActivity: activity,
});

test("prompt boundaries retain their original event when snapshots or undo updates arrive", () => {
  const first: PromptActivity = { id: "1", sessionID: "s1", text: "First", files: [] };
  const second = { ...first, id: "2", text: "Second" };
  const prompts = collectActivity([
    message(10, first), message(20, second),
    { ...message(30, second), fileActivityUpdates: [{ ...first, text: "First updated" }] },
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
