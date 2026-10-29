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
