import { expect, test } from "vitest";
import type { LogEvent } from "../../server/log-receiver";
import type { ViewerMessage } from "../../shared/viewer-protocol";
import { createActivityUpdates } from "../../tests/activity-fixtures";
import { collectActivity } from "./file-activity-model";
import { collectSubagentStarts, subagentsByPrompt } from "./subagent-model";

const created = (id: number, sessionID: string, parentID: string, timestamp?: number, wrapped = false): ViewerMessage => {
  const native = { type: "session.created", created: timestamp, data: { sessionID, parentID } };
  return { id, event: { tag: "session.created", sessionID, "session.created": wrapped ? { event: native } : native } as unknown as LogEvent };
};

function prompts() {
  const update = createActivityUpdates();
  return collectActivity([10, 20].map((id) => ({
    id, event: {} as LogEvent,
    activityUpdates: update(id, { id: String(id), sessionID: "parent", text: `Prompt ${id}`, files: [] }),
  })), "parent");
}

test("numbers distinct subagents chronologically per parent, supporting wrapped events and timestamp ties", () => {
  const events = [created(30, "second", "parent", 200), created(40, "first", "parent", 100, true),
    created(50, "third", "parent", 200), created(60, "other-child", "other", 300),
    created(70, "first", "parent", 100), created(80, "self", "self", 400)];
  expect(collectSubagentStarts(events).map(({ sessionID, label }) => [sessionID, label])).toEqual([
    ["first", "S1"], ["second", "S2"], ["third", "S3"], ["other-child", "S1"],
  ]);
});

test("attributes starts to their parent's active prompt, not another session or a future prompt", () => {
  const base = 1_700_000_000_000;
  const starts = collectSubagentStarts([
    created(2, "before", "parent", base + 2),
    created(12, "first", "parent", base + 12),
    created(15, "second", "parent", base + 15),
    created(20, "third", "parent", base + 20),
    created(25, "foreign", "other", base + 25),
  ]);
  const columns = prompts();
  const result = subagentsByPrompt(columns, starts);
  expect(result.get(columns[0].key)?.map((start) => start.sessionID)).toEqual(["first", "second"]);
  expect(result.get(columns[1].key)?.map((start) => start.sessionID)).toEqual(["third"]);
  const historical = subagentsByPrompt(columns, starts, 12);
  expect(historical.get(columns[0].key)?.map((start) => start.label)).toEqual(["S2"]);
  expect(historical.has(columns[1].key)).toBe(false);
});

test("missing timestamps use recorded event order without inventing a start time", () => {
  const starts = collectSubagentStarts([created(12, "first", "parent"), created(22, "second", "parent")]);
  expect(starts.map((start) => [start.label, start.timestamp])).toEqual([["S1", undefined], ["S2", undefined]]);
  const columns = prompts();
  expect(subagentsByPrompt(columns, starts).get(columns[1].key)?.[0].sessionID).toBe("second");
});

test("equal prompt and creation timestamps respect event order", () => {
  const columns = prompts().map((prompt) => ({ ...prompt, timestamp: 100 }));
  const starts = collectSubagentStarts([created(15, "child", "parent", 100)]);
  const result = subagentsByPrompt(columns, starts);
  expect(result.get(columns[0].key)?.[0].label).toBe("S1");
  expect(result.has(columns[1].key)).toBe(false);
});
