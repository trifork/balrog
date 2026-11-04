import assert from "node:assert/strict";
import { test } from "node:test";
import { FileActivityTracker } from "../server/file-activity.js";
import type { LogEvent } from "../server/log-receiver.js";

function event(tag: string, pluginID: string, data: object, sessionID = "s1"): LogEvent {
  return {
    tag, pluginID, sessionID, apiVersion: "v2",
    [tag]: { type: tag, data: { sessionID, ...data } },
  } as unknown as LogEvent;
}

test("V2 session state spans plugin instances without mixing sessions or late tool outcomes", () => {
  const tracker = new FileActivityTracker();
  const prompts = new Map<string, string>();
  for (const sessionID of ["s1", "s2"]) {
    tracker.process(event("session.execution.started", "application", {}, sessionID));
    tracker.process(event("session.inbox.enqueued", "application", {
      inboxID: "shared-inbox", item: { type: "user", payload: { text: sessionID } },
    }, sessionID));
    const prompt = tracker.process(event("session.inbox.delivered", "workspace", { inboxID: "shared-inbox" }, sessionID))!;
    assert.equal(prompt.text, sessionID);
    prompts.set(sessionID, prompt.id);
    tracker.process(event("session.tool.input.started", "workspace", { id: "shared-call", name: "read" }, sessionID));
    tracker.process(event("session.tool.called", "application", {
      id: "shared-call", input: { path: `${sessionID}.md` },
    }, sessionID));
  }
  tracker.process(event("session.inbox.enqueued", "application", {
    inboxID: "next", item: { type: "user", payload: { text: "Next prompt" } },
  }));
  const next = tracker.process(event("session.inbox.delivered", "workspace", { inboxID: "next" }))!;
  assert.notEqual(next.id, prompts.get("s1"));
  for (const sessionID of ["s2", "s1"]) {
    const done = tracker.process(event("session.tool.success", "another-workspace", { id: "shared-call" }, sessionID))!;
    assert.equal(done.id, prompts.get(sessionID));
    assert.deepEqual(done.files, [{ path: `${sessionID}.md`, action: "read", callID: "shared-call", outcome: "success" }]);
  }
});

test("legacy activity remains isolated by plugin instance", () => {
  const tracker = new FileActivityTracker();
  const legacy = (pluginID: string, data: object) => ({
    tag: "session.tool.called", pluginID, sessionID: "s1", apiVersion: "v1",
    "session.tool.called": { data },
  }) as unknown as LogEvent;
  tracker.process(legacy("one", { id: "shared-call", tool: "read", input: { path: "one.md" } }));
  const second = tracker.process(legacy("two", { id: "shared-call", tool: "read", input: { path: "two.md" } }))!;
  assert.deepEqual(second.files.map((file) => file.path), ["two.md"]);
});
