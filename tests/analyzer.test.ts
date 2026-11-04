import assert from "node:assert/strict";
import { test } from "node:test";
import type { LogEvent } from "../server/log-receiver.js";
import { SessionAnalyzer } from "../server/analyzer.js";

function logEvent(tag: string, sessionID: string, payload: object): LogEvent {
  return {
    tag,
    sessionID,
    pluginID: "plugin-1",
    apiVersion: "v2",
    [tag]: { event: { type: tag, data: { sessionID, ...payload } } },
  } as unknown as LogEvent;
}

function timedEvent(tag: string, sessionID: string, created: number, payload: object): LogEvent {
  return {
    tag, sessionID, pluginID: "plugin-1", apiVersion: "v2",
    [tag]: { type: tag, created, data: { sessionID, ...payload } },
  } as unknown as LogEvent;
}

test("analyzer tracks session metadata and updates titles on rename", () => {
  const analyzer = new SessionAnalyzer();
  analyzer.process(logEvent("session.created", "session-1", {
    title: "Initial title",
  }));
  analyzer.process(logEvent("session.tool.called", "session-1", {
    tool: "read",
  }));

  assert.equal(analyzer.getSessionTitle("session-1"), "Initial title");
  assert.deepEqual(analyzer.getSession("session-1"), {
    sessionID: "session-1",
    title: "Initial title",
    pluginID: "plugin-1",
    apiVersion: "v2",
    eventCount: 2,
    lastEventTag: "session.tool.called",
    lastEventAt: analyzer.getSession("session-1")?.lastEventAt,
    tags: ["session.created", "session.tool.called"],
  });

  analyzer.process(logEvent("session.renamed", "session-1", {
    title: "Updated title",
  }));
  assert.equal(analyzer.getSessionTitle("session-1"), "Updated title");
  assert.equal(analyzer.getSession("missing"), undefined);
});

test("analyzer preserves parent relationships from native and wrapped creation events", () => {
  const analyzer = new SessionAnalyzer();
  analyzer.process(timedEvent("session.created", "child-1", 1, {
    parentID: "parent", title: "First subagent",
  }));
  analyzer.process(logEvent("session.created", "child-2", {
    parentID: "parent", title: "Second subagent",
  }));
  analyzer.process(logEvent("session.renamed", "child-1", { title: "Renamed subagent" }));
  analyzer.process(logEvent("session.tool.success", "child-1", {
    metadata: { sessionID: "another-session" },
  }));
  assert.equal(analyzer.getSession("child-1")?.parentID, "parent");
  assert.equal(analyzer.getSession("child-1")?.title, "Renamed subagent");
  assert.equal(analyzer.getSessions().find((session) => session.sessionID === "child-2")?.parentID, "parent");
});

test("analyzer ignores empty and self-referencing parent IDs", () => {
  const analyzer = new SessionAnalyzer();
  for (const parentID of [undefined, "", "  ", "session-1"]) {
    analyzer.process(logEvent("session.created", "session-1", { parentID }));
  }
  assert.equal(analyzer.getSession("session-1")?.parentID, undefined);
});

test("analyzer can read session IDs and titles from the event payload", () => {
  const analyzer = new SessionAnalyzer();
  analyzer.process({
    tag: "session.renamed",
    sessionID: null,
    pluginID: "plugin-1",
    apiVersion: "v2",
    "session.renamed": {
      event: {
        type: "session.renamed",
        data: { sessionID: "session-2", title: "Payload title" },
      },
    },
  } as unknown as LogEvent);

  assert.equal(analyzer.getSessionTitle("session-2"), "Payload title");
});

test("analyzer correlates successful tools with their calls", () => {
  const analyzer = new SessionAnalyzer();
  const called = logEvent("session.tool.called", "session-1", {
    id: "call-1",
    tool: "shell",
    input: { command: "npm test" },
  });
  const succeeded = logEvent("session.tool.success", "session-1", {
    id: "call-1",
    content: [{ type: "text", text: "tests passed" }],
  });

  analyzer.process(called);
  analyzer.process(succeeded);

  assert.deepEqual(analyzer.getToolCall(succeeded), {
    sessionID: "session-1",
    callID: "call-1",
    tool: "shell",
    command: "npm test",
    input: { command: "npm test" },
  });
});

test("analyzer keeps one row per execution, sorts by call time and preserves failures and running calls", () => {
  const analyzer = new SessionAnalyzer();
  for (const event of [
    timedEvent("session.text.ended", "session-1", 10, {
      assistantMessageID: "message-1", text: "Check the build.",
    }),
    timedEvent("session.tool.input.started", "session-1", 11, { id: "only-input", name: "read" }),
    timedEvent("session.tool.called", "session-1", 20, {
      id: "call-1", assistantMessageID: "message-1", input: { command: "npm test" },
    }),
    timedEvent("session.tool.called", "session-1", 30, {
      id: "call-2", assistantMessageID: "message-2", input: { path: "README.md" },
    }),
    timedEvent("session.tool.failed", "session-1", 40, {
      id: "call-1", error: { type: "Error", message: "Tests failed" },
      content: [{ type: "text", text: "1 failed test" }],
    }),
    // Replayed call events must not reset completion or create another row.
    timedEvent("session.tool.called", "session-1", 20, {
      id: "call-1", assistantMessageID: "message-1", input: { command: "npm test" },
    }),
    // Names may arrive after the call, including when a partial log is replayed.
    timedEvent("session.tool.input.started", "session-1", 15, { id: "call-1", name: "shell" }),
    timedEvent("session.tool.called", "session-2", 50, {
      id: "call-1", name: "glob", input: { pattern: "*.ts" },
    }),
  ]) analyzer.process(event);

  assert.deepEqual(analyzer.getToolExecutions("session-1"), [
    {
      callID: "call-2", command: { name: null, args: { path: "README.md" } },
      startedAt: 30, completedAt: null, reason: null, outcome: null, result: null,
    },
    {
      callID: "call-1", command: { name: "shell", args: { command: "npm test" } },
      startedAt: 20, completedAt: 40, reason: null, outcome: null,
      result: {
        error: { type: "Error", message: "Tests failed" },
        content: [{ type: "text", text: "1 failed test" }],
      },
    },
  ]);
  assert.deepEqual(analyzer.getToolExecutions("session-2"), [{
    callID: "call-1", command: { name: "glob", args: { pattern: "*.ts" } },
    startedAt: 50, completedAt: null, reason: null, outcome: null, result: null,
  }]);
});

test("analyzer exposes partially recorded executions without inventing their missing start or arguments", () => {
  const analyzer = new SessionAnalyzer();
  analyzer.process(timedEvent("session.tool.success", "partial", 70, {
    id: "call-1", content: [{ type: "text", text: "Done" }],
  }));
  assert.deepEqual(analyzer.getToolExecutions("partial"), [{
    callID: "call-1", command: { name: null, args: null },
    startedAt: null, completedAt: 70, reason: null, outcome: null,
    result: [{ type: "text", text: "Done" }],
  }]);

  analyzer.process(timedEvent("session.tool.called", "partial", 60, {
    id: "call-1", name: "shell", input: { command: "npm test", description: "Verify the changes" },
  }));
  assert.deepEqual(analyzer.getToolExecutions("partial"), [{
    callID: "call-1",
    command: { name: "shell", args: { command: "npm test", description: "Verify the changes" } },
    startedAt: 60, completedAt: 70, reason: null, outcome: null,
    result: [{ type: "text", text: "Done" }],
  }]);
});

test("analyzer preserves historical explicit reasons but leaves retrospective inference to retro", (t) => {
  t.mock.method(Date, "now", () => 1_700_000_000_000);
  const analyzer = new SessionAnalyzer();
  analyzer.process(logEvent("session.text.ended", "session-1", {
    assistantMessageID: "message-1", text: "Check the changes.",
  }));
  analyzer.process(logEvent("session.tool.called", "session-1", {
    id: "call-1", assistantMessageID: "message-1", name: "shell",
    input: { command: "npm test", description: "Run regression tests" },
  }));
  analyzer.process(logEvent("session.tool.called", "session-1", {
    id: "call-2", assistantMessageID: "message-1", reason: "Check compilation",
    input: { command: "npm run typecheck", description: "Type check" },
  }));
  analyzer.process(logEvent("session.execution.started", "session-1", {}));
  analyzer.process(logEvent("session.tool.called", "session-1", {
    id: "call-3", assistantMessageID: "message-1", input: {},
  }));
  const executions = analyzer.getToolExecutions("session-1");
  assert.deepEqual(executions.map((execution) => execution.reason), [
    null, "Check compilation", null,
  ]);
  assert.equal(executions[0].startedAt, 1_700_000_000_000);
});

test("analyzer attaches replayed outcomes by session and call ID and hides reporting-tool executions", () => {
  const analyzer = new SessionAnalyzer();
  for (const event of [
    timedEvent("balrog.tool.outcome", "session-1", 40, {
      id: "call-1", reportCallID: "report-1", outcome: "Found MyDemoService.",
    }),
    timedEvent("session.tool.called", "session-2", 10, { id: "call-1", name: "glob", input: {} }),
    timedEvent("session.tool.called", "session-1", 20, { id: "call-1", name: "glob", input: {} }),
    timedEvent("session.tool.success", "session-1", 30, {
      id: "call-1", content: [{ type: "text", text: "MyDemoService.cs" }],
    }),
    timedEvent("session.tool.input.started", "session-1", 35, { id: "report-1", name: "balrog_reportOutcome" }),
    timedEvent("session.tool.called", "session-1", 36, {
      id: "report-1", input: { callID: "call-1", outcome: "Found MyDemoService." },
    }),
    timedEvent("session.tool.success", "session-1", 45, {
      id: "report-1", content: [{ type: "text", text: "Outcome recorded" }],
    }),
    // A name arriving after a partial reporting-tool result must also remove that row.
    timedEvent("session.tool.success", "session-1", 50, { id: "report-2", content: [] }),
    timedEvent("session.tool.input.started", "session-1", 46, { id: "report-2", name: "balrog_reportOutcome" }),
  ]) analyzer.process(event);
  const executions = analyzer.getToolExecutions("session-1");
  assert.equal(executions.length, 1);
  assert.equal(executions[0].callID, "call-1");
  assert.equal(executions[0].outcome, "Found MyDemoService.");
  assert.equal(executions[0].completedAt, 30);
  assert.equal(analyzer.getToolExecutions("session-2")[0].outcome, null);
  analyzer.process(timedEvent("balrog.tool.outcome", "session-1", 60, {
    id: "call-1", outcome: "   ", reportCallID: "invalid-report",
  }));
  assert.equal(executions[0].outcome, "Found MyDemoService.");
});

test("analyzer removes only the footer attested by metadata for the matching call", () => {
  const analyzer = new SessionAnalyzer();
  const content = [
    { type: "text", text: "MyDemoService.cs" },
    { type: "text", text: "Balrog outcome reporting: call-1" },
  ];
  for (const [id, metadata] of [
    ["call-1", { __balrogOutcomeHint: { callID: "call-1", text: content[1].text } }],
    ["call-2", { __balrogOutcomeHint: { callID: "call-1", text: content[1].text } }],
    ["call-3", {}],
  ] as const) {
    analyzer.process(timedEvent("session.tool.success", "session-1", 100, { id, content, metadata }));
  }
  const calls = new Map(analyzer.getToolExecutions("session-1").map((call) => [call.callID, call]));
  assert.deepEqual(calls.get("call-1")?.result, [content[0]]);
  assert.deepEqual(calls.get("call-2")?.result, content);
  assert.deepEqual(calls.get("call-3")?.result, content);
  assert.equal(content.length, 2);
});
