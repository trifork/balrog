import assert from "node:assert/strict";
import { test } from "node:test";
import { SessionAnalyzer } from "../server/analyzer.js";
import type { LogEvent } from "../server/log-receiver.js";

function event(tag: string, data: object, created = 1_700_000_000_000, wrapped = false): LogEvent {
  const native = { type: tag, created, data: { sessionID: "session-1", ...data } };
  return {
    tag, sessionID: "session-1", pluginID: "plugin-1", apiVersion: "v2",
    [tag]: wrapped ? { event: native } : native,
  } as unknown as LogEvent;
}

function call(analyzer: SessionAnalyzer, name: string, id: string, input: object) {
  analyzer.process(event("session.tool.input.started", { id, name, assistantMessageID: "message-1" }));
  analyzer.process(event("session.tool.called", { id, input, assistantMessageID: "message-1" }));
}

test("activity correlates V2 tool names, calls and results with source timestamps", () => {
  const analyzer = new SessionAnalyzer();
  call(analyzer, "read", "call-1", { path: "README.md", description: "Check the documentation" });
  const pending = analyzer.getSessionActivity("session-1")!.items[0];
  assert.equal(pending.kind, "file.read");
  if (pending.kind !== "file.read") return;
  assert.equal(pending.status, "pending");
  assert.equal(pending.timestamp, 1_700_000_000_000);
  assert.equal(pending.timestampSource, "event");
  assert.equal(Object.hasOwn(pending.source, "callID"), false);
  assert.equal(Object.hasOwn(pending.source, "messageID"), false);
  assert.equal(pending.source.tool, "read");
  assert.equal(pending.path, "README.md");
  assert.deepEqual(pending.rationale, { text: "Check the documentation", source: "description" });
  analyzer.process(event("session.tool.success", { id: "call-1" }, 1_700_000_000_500, true));
  const completed = analyzer.getSessionActivity("session-1")!.items[0];
  assert.equal("status" in completed && completed.status, "completed");
  assert.equal("completedAt" in completed && completed.completedAt, 1_700_000_000_500);
  assert.equal(pending.status, "pending", "queries must return independent snapshots");
  assert.equal(analyzer.getToolCall(event("session.tool.success", { id: "call-1" }))?.tool, "read");
});

test("activity extracts reads and grep search scopes without pretending to know all scanned files", () => {
  const analyzer = new SessionAnalyzer();
  call(analyzer, "functions.read", "read-1", { path: "README.md", offset: 10, limit: 20 });
  call(analyzer, "grep", "grep-1", { path: "src", pattern: "hello", include: "*.ts" });
  analyzer.process(event("session.tool.success", {
    id: "grep-1", content: [{ type: "text", text: "Found 2 matches\nC:\\project\\src\\a.ts:\n  Line 1: hello\nC:\\project\\src\\a.ts:\n  Line 2: hello" }],
  }));
  const [read, grep] = analyzer.getSessionActivity("session-1")!.items;
  assert.equal(read.kind, "file.read");
  if (read.kind === "file.read") {
    assert.equal(read.path, "README.md");
    assert.equal(read.offset, 10);
    assert.equal(read.limit, 20);
    assert.equal(read.rationale, undefined);
  }
  assert.equal(grep.kind, "file.grep");
  if (grep.kind === "file.grep") {
    assert.equal(grep.scope, "src");
    assert.equal(grep.include, "*.ts");
    assert.deepEqual(grep.matchedFiles, ["C:\\project\\src\\a.ts"]);
    assert.equal(grep.status, "completed");
  }
});

test("activity extracts patch creation, modification, deletion and moves and preserves failures", () => {
  const analyzer = new SessionAnalyzer();
  call(analyzer, "apply_patch", "patch-1", {
    patchText: "*** Begin Patch\n*** Add File: new.ts\n+hello\n*** Update File: old.ts\n*** Move to: moved.ts\n@@\n-old\n+new\n*** Delete File: gone.ts\n*** End Patch",
    rationale: "Implement the requested fix",
  });
  analyzer.process(event("session.tool.failed", { id: "patch-1", error: { message: "Patch rejected" } }, 1_700_000_000_100));
  const items = analyzer.getSessionActivity("session-1")!.items;
  assert.deepEqual(items.map((item) => item.kind === "file.change" ? [item.path, item.action, item.status] : null), [
    ["new.ts", "created", "failed"], ["old.ts", "modified", "failed"], ["gone.ts", "deleted", "failed"],
  ]);
  assert.equal(new Set(items.map((item) => item.id)).size, 3);
  assert.equal(items[1].kind === "file.change" && items[1].movedTo, "moved.ts");
  assert.deepEqual(items[0].rationale, { text: "Implement the requested fix", source: "rationale" });
  assert.deepEqual("error" in items[0] && items[0].error, { message: "Patch rejected" });
});

test("activity records prompts on durable admission, ignores assistant text, and deduplicates event IDs", () => {
  const analyzer = new SessionAnalyzer();
  const prompt = event("session.inbox.enqueued", {
    inboxID: "prompt-1", item: { type: "user", payload: { text: "Fix the bug", files: [{ name: "screenshot.png" }] } },
  });
  const native = (prompt as unknown as Record<string, Record<string, unknown>>)["session.inbox.enqueued"];
  native["id"] = "event-prompt";
  analyzer.process(prompt);
  analyzer.process(prompt);
  analyzer.process(event("session.inbox.enqueued", { item: { type: "compaction", payload: {} } }));
  analyzer.process(event("session.text.started", { assistantMessageID: "assistant-1", ordinal: 0 }));
  const ended = event("session.text.ended", { assistantMessageID: "assistant-1", ordinal: 0, text: "Fixed it." }, 1_700_000_000_200);
  analyzer.process(ended);
  analyzer.process(ended);
  const activity = analyzer.getSessionActivity("session-1")!;
  assert.equal(activity.schemaVersion, 1);
  assert.equal(activity.sessionID, "session-1");
  assert.deepEqual(activity.items.map((item) => [item.kind, "text" in item && item.text]), [
    ["prompt", "Fix the bug"],
  ]);
  assert.equal(Object.hasOwn(activity.items[0].source, "messageID"), false);
  assert.equal(activity.items[0].source.eventID, "event-prompt");
  assert.equal(activity.items[0].rationale, undefined);
});

test("activity keeps sessions and repeated calls separate and sorts by event time", () => {
  const analyzer = new SessionAnalyzer();
  analyzer.process(event("session.inbox.enqueued", { item: { type: "user", payload: { text: "Later" } } }, 200));
  analyzer.process(event("session.inbox.enqueued", { item: { type: "user", payload: { text: "Earlier" } } }, 100, true));
  analyzer.process({ ...event("session.inbox.enqueued", {
    sessionID: "session-2", item: { type: "user", payload: { text: "Other session" } },
  }, 150), sessionID: "session-2" } as LogEvent);
  call(analyzer, "read", "read-1", { path: "same.ts" });
  call(analyzer, "read", "read-2", { path: "same.ts" });
  const items = analyzer.getSessionActivity("session-1")!.items;
  assert.deepEqual(items.slice(0, 2).map((item) => "text" in item && item.text), ["Earlier", "Later"]);
  assert.equal(items.length, 4);
  assert.equal(analyzer.getSessionActivity("session-2")!.items.length, 1);
  assert.equal(analyzer.getSessionActivity("missing"), undefined);
});

test("activity uses recorded timestamps for legacy V1 hooks and updates only one operation", () => {
  const analyzer = new SessionAnalyzer();
  const before = {
    tag: "tool.execute.before", sessionID: "v1-session", apiVersion: "v1", pluginID: "v1-plugin", created: 123,
    "tool.execute.before": {
      input: { sessionID: "v1-session", callID: "read-1", tool: "read" },
      output: { args: { filePath: "a.ts" } },
    },
  } as unknown as LogEvent;
  analyzer.process(before);
  analyzer.process({
    tag: "tool.execute.after", sessionID: "v1-session", created: 456,
    "tool.execute.after": { input: { callID: "read-1", tool: "read" }, output: {} },
  } as unknown as LogEvent);
  const [item] = analyzer.getSessionActivity("v1-session")!.items;
  assert.equal(item.timestamp, 123);
  assert.equal(item.timestampSource, "recorded");
  assert.equal(item.kind === "file.read" && item.status, "completed");
  assert.equal("completedAt" in item && item.completedAt, 456);
});

test("activity excludes commands and does not guess ambiguous tool names in old V2 logs", () => {
  const analyzer = new SessionAnalyzer();
  analyzer.process(event("session.tool.called", { id: "unknown", input: { path: "a.ts" } }));
  analyzer.process(event("session.tool.called", { id: "command", input: { command: "git status" } }));
  call(analyzer, "shell", "shell-1", { command: "cat a.ts" });
  analyzer.process(event("session.tool.success", { id: "shell-1" }));
  call(analyzer, "bash", "bash-1", { command: "echo hello" });
  analyzer.process(event("session.text.ended", { text: "Assistant response" }));
  assert.deepEqual(analyzer.getSessionActivity("session-1")!.items, []);
});

test("successful file updates are confirmed only after completion", () => {
  const analyzer = new SessionAnalyzer();
  call(analyzer, "edit", "edit-1", { filePath: "a.ts" });
  call(analyzer, "write", "write-1", { filePath: "b.ts" });
  call(analyzer, "patch", "patch-1", { patchText: "*** Delete File: c.ts" });
  for (const id of ["edit-1", "write-1", "patch-1"]) {
    analyzer.process(event("session.tool.success", { id }));
  }
  assert.deepEqual(analyzer.getSessionActivity("session-1")!.items.map((item) =>
    item.kind === "file.change" ? [item.path, item.action, item.status] : null), [
    ["a.ts", "modified", "completed"], ["b.ts", "modified", "completed"], ["c.ts", "deleted", "completed"],
  ]);
});

test("attachment-only prompts retain their files and untimestamped history labels its fallback", () => {
  const analyzer = new SessionAnalyzer();
  const admitted = event("session.inbox.enqueued", {
    item: { type: "user", payload: { text: "", files: [{ name: "screenshot.png" }] } },
  });
  delete (admitted as unknown as Record<string, Record<string, unknown>>)["session.inbox.enqueued"]["created"];
  const before = Date.now();
  analyzer.process(admitted);
  const [item] = analyzer.getSessionActivity("session-1")!.items;
  assert.equal(item.timestampSource, "received");
  assert.ok(item.timestamp >= before && item.timestamp <= Date.now());
  assert.equal(item.kind, "prompt");
  if (item.kind === "prompt") {
    assert.equal(item.text, "");
    assert.deepEqual(item.files, [{ name: "screenshot.png" }]);
  }
});
