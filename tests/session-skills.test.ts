import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { SessionAnalyzer } from "../server/analyzer.js";
import { SQLiteEventStore } from "../server/event-store.js";
import type { LogEvent } from "../server/log-receiver.js";

function event(tag: string, data: object, created = 100, sessionID = "session-1", wrapped = false, eventID?: string): LogEvent {
  const native = { type: tag, created, data: { sessionID, ...data }, ...(eventID ? { id: eventID } : {}) };
  return { tag, sessionID, [tag]: wrapped ? { event: native } : native } as unknown as LogEvent;
}

function attachment(inboxID: string, skills: unknown[] = [{ id: "review", name: "Review", text: "Review carefully." }]) {
  return event("session.inbox.enqueued", { inboxID, item: { type: "user", payload: { text: "@review", skills } } });
}

function call(callID: string, skillID = "review", sessionID = "session-1") {
  return [
    event("session.tool.input.started", { id: callID, name: "skill" }, 110, sessionID),
    event("session.tool.called", { id: callID, input: { id: skillID } }, 120, sessionID),
  ];
}

test("prompt skills activate on delivery, not admission, cancellation, or @mention text", () => {
  const analyzer = new SessionAnalyzer();
  analyzer.process(attachment("queued"));
  analyzer.process(attachment("cancelled"));
  analyzer.process(event("session.inbox.cancelled", { inboxID: "cancelled" }));
  analyzer.process(attachment("empty", [null, "review", {}, { id: " " }]));
  analyzer.process(event("session.inbox.delivered", { inboxID: "empty" }));
  analyzer.process(event("session.inbox.enqueued", {
    inboxID: "mention", item: { type: "user", payload: { text: "@review" } },
  }));
  analyzer.process(event("session.inbox.delivered", { inboxID: "mention" }));
  assert.deepEqual(analyzer.getSkillActivations("session-1"), []);
  const delivered = event("session.inbox.delivered", { inboxID: "queued" }, 200, "session-1", true, "delivery-1");
  analyzer.process(delivered);
  analyzer.process(delivered);
  // Even duplicate delivery evidence with no event ID must not create another activation.
  analyzer.process(event("session.inbox.delivered", { inboxID: "queued" }, 201));
  assert.deepEqual(analyzer.getSkillActivations("session-1"), [{
    id: "review", name: "Review", activatedAt: 200, timestampSource: "event",
    source: "prompt", inboxID: "queued", eventID: "delivery-1",
  }]);
});

test("prompt extraction preserves repeated invocations and supports delayed admission evidence", () => {
  const analyzer = new SessionAnalyzer();
  analyzer.process(event("session.inbox.delivered", { inboxID: "first" }, 200));
  analyzer.process(attachment("first", [{ id: "review" }, { id: "review" }, { id: "test", name: "Testing" }]));
  analyzer.process(attachment("second"));
  analyzer.process(event("session.inbox.delivered", { inboxID: "second" }, 300));
  analyzer.process(event("session.inbox.delivered", { inboxID: "queued" }, 400, "other"));
  assert.deepEqual(analyzer.getSkillActivations("session-1").map(({ id, name, inboxID }) => [id, name, inboxID]), [
    ["review", "Review", "second"], ["review", "review", "first"], ["test", "Testing", "first"],
  ]);
  assert.deepEqual(analyzer.getSkillActivations("other"), []);
  assert.deepEqual(analyzer.getSkillActivations("missing"), []);
});

test("skill tools require correlated names, arguments and successful completion", () => {
  const analyzer = new SessionAnalyzer();
  for (const id of ["success", "pending", "failed", "error"]) call(id).forEach((value) => analyzer.process(value));
  analyzer.process(event("session.tool.failed", { id: "failed", error: { message: "Missing skill" } }, 200));
  analyzer.process(event("session.tool.success", { id: "error", metadata: { status: "error" } }, 200));
  analyzer.process(event("session.tool.success", { id: "unknown" }, 200));
  analyzer.process(event("session.tool.called", { id: "ambiguous", input: { id: "review" } }));
  analyzer.process(event("session.tool.success", { id: "ambiguous" }, 200));
  assert.deepEqual(analyzer.getSkillActivations("session-1"), []);
  const success = event("session.tool.success", {
    id: "success", content: [{ type: "text", text: "<skill_content>Review carefully.</skill_content>" }],
  }, 250, "session-1", true);
  const original = structuredClone(success);
  analyzer.process(success);
  analyzer.process(success);
  assert.deepEqual(success, original);
  assert.deepEqual(analyzer.getSkillActivations("session-1"), [{
    id: "review", name: "review", activatedAt: 250, timestampSource: "event", source: "tool", callID: "success",
  }]);
  assert.equal(analyzer.getToolExecutions("session-1").find((value) => value.callID === "success")?.command.name, "skill");
});

test("skill correlation tolerates delayed names and arguments, isolates sessions, and returns snapshots", () => {
  const analyzer = new SessionAnalyzer();
  analyzer.process(event("session.tool.success", { id: "shared" }, 300));
  const [name, input] = call("shared");
  analyzer.process(input);
  assert.deepEqual(analyzer.getSkillActivations("session-1"), []);
  analyzer.process(name);
  const snapshot = analyzer.getSkillActivations("session-1");
  snapshot[0].name = "Changed by consumer";
  call("shared", "other", "session-2").forEach((value) => analyzer.process(value));
  assert.deepEqual(analyzer.getSkillActivations("session-2"), []);
  analyzer.process(event("session.tool.success", { id: "shared" }, 400, "session-2"));
  assert.equal(analyzer.getSkillActivations("session-1")[0].name, "review");
  assert.equal(analyzer.getSkillActivations("session-2")[0].id, "other");
  call("again").forEach((value) => analyzer.process(value));
  analyzer.process(event("session.tool.success", { id: "again" }, 500));
  assert.deepEqual(analyzer.getSkillActivations("session-1").map((value) => value.callID), ["again", "shared"]);
});

test("native observations accept native and wrapped events, deduplicate event IDs, and do not guess overlap", () => {
  const analyzer = new SessionAnalyzer();
  call("call").forEach((value) => analyzer.process(value));
  analyzer.process(event("session.tool.success", { id: "call" }, 200));
  for (const wrapped of [false, true]) {
    const native = event("session.skill.activated", { id: "review", name: "Review", text: "Instructions" },
      wrapped ? 400 : 300, "session-1", wrapped, wrapped ? "event-2" : "event-1");
    analyzer.process(native);
    analyzer.process(native);
  }
  analyzer.process(event("session.skill.activated", { id: {}, name: " " }));
  assert.deepEqual(analyzer.getSkillActivations("session-1").map(({ source, activatedAt }) => [source, activatedAt]), [
    ["native", 400], ["native", 300], ["tool", 200],
  ]);
  assert.equal(analyzer.getToolExecutions("session-1").length, 1);
});

test("legacy skill hooks support name arguments and recorded timestamp fallback", () => {
  const analyzer = new SessionAnalyzer();
  analyzer.process({
    tag: "tool.execute.before", sessionID: "legacy", created: 100,
    "tool.execute.before": { input: { callID: "call", tool: "skill" }, output: { args: { name: "review" } } },
  } as unknown as LogEvent);
  analyzer.process({
    tag: "tool.execute.after", sessionID: "legacy", created: 200,
    "tool.execute.after": { input: { callID: "call", tool: "skill" }, output: {} },
  } as unknown as LogEvent);
  assert.deepEqual(analyzer.getSkillActivations("legacy"), [{
    id: "review", name: "review", activatedAt: 200, timestampSource: "recorded", source: "tool", callID: "call",
  }]);
  const before = Date.now();
  analyzer.process({ tag: "session.skill.activated", sessionID: "untimed",
    "session.skill.activated": { data: { id: "review" } } } as unknown as LogEvent);
  const [activation] = analyzer.getSkillActivations("untimed");
  assert.equal(activation.timestampSource, "received");
  assert.ok(activation.activatedAt >= before && activation.activatedAt <= Date.now());
});

test("SQLite replay reconstructs the same skill observations without synthetic events", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "balrog-skill-replay-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const filename = join(directory, "events.sqlite");
  const events = [attachment("inbox"), event("session.inbox.delivered", { inboxID: "inbox" }, 200),
    ...call("call"), event("session.tool.success", { id: "call" }, 300),
    event("session.skill.activated", { id: "review", name: "Review" }, 400)];
  const live = new SessionAnalyzer();
  const store = new SQLiteEventStore(filename);
  try {
    for (const value of events) {
      store.append(value);
      live.process(value);
    }
  } finally {
    store.close();
  }
  const reopened = new SQLiteEventStore(filename);
  try {
    const replay = new SessionAnalyzer();
    assert.deepEqual(reopened.readAll(), events);
    reopened.readAll().forEach((value) => replay.process(value));
    assert.deepEqual(replay.getSkillActivations("session-1"), live.getSkillActivations("session-1"));
    assert.deepEqual(replay.getToolExecutions("session-1"), live.getToolExecutions("session-1"));
  } finally {
    reopened.close();
  }
});

test("skill observations leave tool execution contents and newest-first ordering unchanged", () => {
  const analyzer = new SessionAnalyzer();
  call("load").forEach((value) => analyzer.process(value));
  analyzer.process(event("session.tool.called", { id: "read", tool: "read", input: { path: "README.md" } }, 150));
  analyzer.process(event("session.tool.success", { id: "read", result: "Documentation" }, 180));
  analyzer.process(event("session.tool.success", { id: "load", result: "Instructions" }, 300));
  analyzer.process(event("balrog.tool.intent", { id: "load", reason: "Load review guidance" }, 310));
  analyzer.process(event("balrog.tool.outcome", { id: "load", outcome: "Loaded review instructions" }, 320));
  analyzer.process(attachment("first"));
  analyzer.process(event("session.inbox.delivered", { inboxID: "first" }, 100));
  analyzer.process(attachment("again"));
  analyzer.process(event("session.inbox.delivered", { inboxID: "again" }, 200));
  analyzer.process(event("session.skill.activated", { id: "native" }, 250));
  analyzer.process(event("session.tool.success", { id: "partial" }, 400));
  call("pending").forEach((value) => analyzer.process(value));
  call("failed").forEach((value) => analyzer.process(value));
  analyzer.process(event("session.tool.failed", { id: "failed", error: "Unavailable" }, 350));

  const executions = analyzer.getToolExecutions("session-1");
  assert.deepEqual(executions.map((row) => [row.callID, row.startedAt]), [
    ["read", 150], ["load", 120], ["pending", 120], ["failed", 120], ["partial", null],
  ]);
  assert.deepEqual(executions[1], {
    callID: "load", command: { name: "skill", args: { id: "review" } },
    startedAt: 120, completedAt: 300, reason: "Load review guidance",
    outcome: "Loaded review instructions", result: "Instructions",
  });
  for (const row of executions) {
    assert.equal(Object.hasOwn(row, "kind"), false);
    assert.equal(Object.hasOwn(row, "skill"), false);
  }
  assert.equal(analyzer.getSkillActivations("session-1").length, 4);
  assert.deepEqual(analyzer.getToolExecutions("missing"), []);
});

test("legacy skill observations do not fabricate tool execution rows", () => {
  const analyzer = new SessionAnalyzer();
  for (const stage of ["before", "after"]) {
    const tag = `tool.execute.${stage}`;
    analyzer.process({ tag, sessionID: "legacy", created: stage === "before" ? 100 : 200,
      [tag]: { input: { callID: "legacy-call", tool: "skill" }, output: { args: { name: "review" } } },
    } as unknown as LogEvent);
  }
  assert.deepEqual(analyzer.getToolExecutions("legacy"), []);
  assert.deepEqual(analyzer.getSkillActivations("legacy"), [{
    id: "review", name: "review", callID: "legacy-call", activatedAt: 200,
    timestampSource: "recorded", source: "tool",
  }]);
});
