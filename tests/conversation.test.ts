import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { SessionAnalyzer } from "../server/analyzer.js";
import type { LogEvent } from "../server/log-receiver.js";
import { LogViewer } from "../server/viewer.js";

function event(tag: string, created: number | undefined, data: object, sessionID = "ses_target"): LogEvent {
  return {
    tag, sessionID, pluginID: "plugin-1", apiVersion: "v2",
    [tag]: { type: tag, ...(created === undefined ? {} : { created }), data: { sessionID, ...data } },
  } as unknown as LogEvent;
}

async function setup(t: TestContext) {
  const analyzer = new SessionAnalyzer();
  const viewer = new LogViewer(analyzer);
  await new Promise<void>((resolve) => viewer.listen(0, "127.0.0.1", resolve));
  t.after(() => viewer.close());
  const address = viewer.address();
  assert.ok(address && typeof address !== "string");
  return {
    url: `http://127.0.0.1:${address.port}/api/sessions/ses_target/conversation`,
    publish(record: LogEvent) { analyzer.process(record); viewer.publish(record); },
  };
}

test("conversation endpoint returns the recorded conversation and tool evidence in one session-isolated snapshot", async (t) => {
  const { url, publish } = await setup(t);
  const records = [
    event("session.inbox.enqueued", 10, { item: { type: "user", payload: { text: "Fix the build" } } }),
    event("session.text.ended", 20, { assistantMessageID: "m1", text: "I will check compilation." }),
    event("session.tool.input.started", 21, { id: "c1", name: "shell" }),
    event("session.tool.called", 22, { id: "c1", input: { command: "npm run build" } }),
    event("session.tool.failed", 30, { id: "c1", error: { message: "Compilation failed" }, content: "Missing type" }),
    event("session.compaction.ended", 40, { summary: "Build fails due to a missing type." }),
    event("session.text.ended", 50, { assistantMessageID: "m2", text: "The build failed." }),
  ];
  // Delayed delivery must not change conversation order.
  for (const record of [records[0], records[2], records[1], ...records.slice(3)]) publish(record);
  publish(event("session.text.ended", 25, { text: "Other session secret" }, "ses_other"));
  const response = await fetch(url);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  const snapshot = await response.json();
  assert.equal(snapshot.sessionID, "ses_target");
  assert.deepEqual(snapshot.events, records);
  assert.equal(snapshot.executions.length, 1);
  assert.equal(snapshot.executions[0].command.name, "shell");
  assert.equal(snapshot.executions[0].reason, null);
  assert.equal(snapshot.executions[0].outcome, null);
  assert.deepEqual(snapshot.executions[0].result, { error: { message: "Compilation failed" }, content: "Missing type" });
  assert.equal(snapshot.recording.source, "recorded-events");
  assert.match(snapshot.recording.limits, /unrecorded/i);
  assert.doesNotMatch(JSON.stringify(snapshot), /Other session secret/);
});

test("conversation cutoff applies to messages and tool results, retains unknown times, and does not mutate live evidence", async (t) => {
  const { url, publish } = await setup(t);
  const before = event("session.tool.called", 10, { id: "c1", name: "read", input: { path: "README.md" } });
  const unknown = event("session.text.ended", undefined, { text: "Unknown time" });
  for (const record of [before, unknown,
    event("session.tool.success", 20, { id: "c1", content: "Future result" }),
    event("session.text.ended", 30, { text: "Review-time commentary" }),
  ]) publish(record);
  const snapshot = await (await fetch(`${url}?before=20`)).json();
  assert.deepEqual(snapshot.events, [before, unknown]);
  assert.equal(snapshot.executions[0].completedAt, null);
  assert.equal(snapshot.executions[0].result, null);
  assert.equal(snapshot.recording.unknownTimestampEvents, 1);
  assert.equal(snapshot.recording.excludedByCutoff, 2);
  const full = await (await fetch(url)).json();
  assert.equal(full.events.length, 4);
  assert.equal(full.executions[0].result, "Future result");
});

test("conversation endpoint rejects invalid cutoffs and unknown sessions without selecting another session", async (t) => {
  const { url, publish } = await setup(t);
  publish(event("session.created", 1, {}));
  for (const cutoff of ["", "-1", "1.5", "NaN", "9007199254740992"]) {
    assert.equal((await fetch(`${url}?before=${cutoff}`)).status, 400);
  }
  assert.equal((await fetch(url.replace("ses_target", "ses_missing"))).status, 404);
  assert.equal((await fetch(url.replace("ses_target", "%ZZ"))).status, 400);
  assert.equal((await fetch(url, { method: "POST" })).status, 405);
  assert.deepEqual((await (await fetch(url)).json()).executions, []);
});

test("conversation snapshots preserve unknown call times and stable timestamp ties without inventing recording times", async (t) => {
  const { url, publish } = await setup(t);
  const first = event("session.text.ended", 10, { text: "First" });
  const second = event("session.text.ended", 10, { text: "Second" });
  const called = event("session.tool.called", undefined, { id: "unknown", name: "read", input: { path: "README.md" } });
  const completed = event("session.tool.success", undefined, { id: "unknown", content: "File contents" });
  for (const record of [first, second, called, completed]) publish(record);
  const snapshot = await (await fetch(`${url}?before=20`)).json();
  assert.deepEqual(snapshot.events, [first, second, called, completed]);
  assert.equal(snapshot.executions[0].startedAt, null);
  assert.equal(snapshot.executions[0].completedAt, null);
  assert.equal(snapshot.executions[0].result, "File contents");
  assert.equal(snapshot.recording.unknownTimestampEvents, 2);
  assert.deepEqual(await (await fetch(`${url}?before=20`)).json(), snapshot);
});

test("conversation snapshots include all recorded turns and associated initialization contexts across compaction", async (t) => {
  const { url, publish } = await setup(t);
  const initialization = {
    tag: "initialize", sessionID: null, pluginID: "plugin-1", apiVersion: "v2", created: 1,
    initialize: { context: { location: { directory: "C:/project" }, version: "2.2.0" } },
  } as unknown as LogEvent;
  publish(initialization);
  publish({ ...initialization, pluginID: "other-plugin", initialize: { context: { secret: "Unrelated initialization" } } } as unknown as LogEvent);
  for (let index = 0; index < 600; index++) {
    publish(event("session.text.ended", 10 + index, { text: `Turn ${index}` }));
  }
  publish(event("session.compaction.ended", 610, { summary: "Summary" }));
  const snapshot = await (await fetch(url)).json();
  assert.equal(snapshot.events.length, 601);
  assert.equal(snapshot.events[0]["session.text.ended"].data.text, "Turn 0");
  assert.equal(snapshot.events[600].tag, "session.compaction.ended");
  assert.deepEqual(snapshot.recording.contexts, [initialization]);
  assert.doesNotMatch(JSON.stringify(snapshot), /Unrelated initialization/);
});
