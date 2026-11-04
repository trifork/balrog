import assert from "node:assert/strict";
import { test } from "node:test";
import { SessionAnalyzer } from "../server/analyzer.js";
import type { LogEvent } from "../server/log-receiver.js";
import { applyActivityUpdate, type SessionActivity } from "../shared/activity-protocol.js";

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

test("grep matches use the same normalized paths as explicit reads and changes", () => {
  const analyzer = new SessionAnalyzer();
  analyzer.process({
    tag: "initialize", sessionID: null, pluginID: "plugin-1",
    initialize: { context: { directory: "/workspace" } },
  } as unknown as LogEvent);
  call(analyzer, "functions.grep", "grep", { path: "/workspace/src", pattern: "needle" });
  analyzer.process(event("session.tool.success", { id: "grep", content: [{
    type: "text", text: "Found 3 matches\n/workspace/src/app.ts:\n  Line 1: needle\nsrc/app.ts:\n  Line 2: needle\n./src/other.ts:\n  Line 3: needle",
  }] }));
  const grep = analyzer.getSessionActivity("session-1")!.items.find((item) => item.kind === "file.grep")!;
  assert.equal(grep.kind, "file.grep");
  if (grep.kind === "file.grep") {
    assert.deepEqual(grep.matchedFiles, ["src/app.ts", "src/other.ts"]);
    assert.equal(grep.status, "completed");
    assert.equal(grep.workspaceRoot, "/workspace");
  }
});

test("canonical operations retain the workspace used for path normalization", () => {
  const analyzer = new SessionAnalyzer();
  analyzer.process({
    tag: "initialize", sessionID: null, pluginID: "plugin-1",
    initialize: { context: { location: { directory: "/workspace" } } },
  } as unknown as LogEvent);
  for (const [id, path] of [["inside", "/workspace/src/app.ts"], ["outside", "/workspace-other/config.ts"], ["parent", "../shared/helper.ts"]]) {
    call(analyzer, "read", id, { path });
    const completion = event("session.tool.success", { id });
    analyzer.process(completion);
    const update = analyzer.getActivityUpdates(completion);
    assert.ok(update);
    assert.ok(update.items.filter((item) => item.kind === "file.read").every((item) => item.workspaceRoot === "/workspace"));
  }
  const items = analyzer.getSessionActivity("session-1")!.items.filter((item) => item.kind === "file.read");
  assert.deepEqual(items.map((item) => item.kind === "file.read" && item.path), [
    "src/app.ts", "/workspace-other/config.ts", "../shared/helper.ts",
  ]);
  assert.ok(items.every((item) => item.workspaceRoot === "/workspace"));
  analyzer.process({
    tag: "initialize", sessionID: null, pluginID: "plugin-1",
    initialize: { context: { directory: "/other-workspace" } },
  } as unknown as LogEvent);
  assert.deepEqual(analyzer.getSessionActivity("session-1")!.items.filter((item) => item.kind === "file.read"), items);
});

test("native call locations survive split tool events and can complete missing workspace context", () => {
  const analyzer = new SessionAnalyzer();
  const located = (tag: string, data: object, directory: string): LogEvent => ({
    tag, sessionID: "session-1", pluginID: "plugin-1",
    [tag]: { type: tag, location: { directory }, data: { sessionID: "session-1", ...data } },
  } as unknown as LogEvent);
  analyzer.process(located("session.tool.input.started", { id: "grep", name: "grep" }, "C:\\repo"));
  analyzer.process(event("session.tool.called", { id: "grep", input: { path: "C:/repo/src", pattern: "needle" } }));
  analyzer.process(event("session.tool.success", { id: "grep", content: [{
    type: "text", text: "Found 2 matches\nC:/repo/src/app.ts:\n  Line 1: needle\nD:/shared/app.ts:\n  Line 2: needle",
  }] }));
  const grep = analyzer.getSessionActivity("session-1")!.items.find((item) => item.kind === "file.grep");
  assert.ok(grep?.kind === "file.grep");
  assert.equal(grep.workspaceRoot, "C:/repo");
  assert.deepEqual(grep.matchedFiles, ["src/app.ts", "D:/shared/app.ts"]);
  call(analyzer, "read", "late-context", { path: "/etc/config" });
  const pending = analyzer.getSessionActivity("session-1")!.items.find((item) => item.source.callID === "late-context");
  assert.equal(pending?.workspaceRoot, undefined);
  analyzer.process(located("session.tool.success", { id: "late-context" }, "/workspace"));
  const completed = analyzer.getSessionActivity("session-1")!.items.find((item) => item.id === pending?.id);
  assert.equal(completed?.workspaceRoot, "/workspace");
  assert.equal(pending?.workspaceRoot, undefined, "later context must not mutate historical pending activity");
});

test("activity correlates V2 tool names, calls and results with source timestamps", () => {
  const analyzer = new SessionAnalyzer();
  call(analyzer, "read", "call-1", { path: "README.md", description: "Check the documentation" });
  const pending = analyzer.getSessionActivity("session-1")!.items.find((item) => item.kind === "file.read")!;
  assert.equal(pending.kind, "file.read");
  if (pending.kind !== "file.read") return;
  assert.equal(pending.status, "pending");
  assert.equal(pending.timestamp, 1_700_000_000_000);
  assert.equal(pending.timestampSource, "event");
  assert.equal(pending.source.callID, "call-1");
  assert.equal(pending.source.messageID, "message-1");
  assert.equal(pending.source.tool, "read");
  assert.equal(pending.path, "README.md");
  assert.deepEqual(pending.rationale, { text: "Check the documentation", source: "description" });
  analyzer.process(event("session.tool.success", { id: "call-1" }, 1_700_000_000_500, true));
  const completed = analyzer.getSessionActivity("session-1")!.items.find((item) => item.kind === "file.read")!;
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
  const [read, grep] = analyzer.getSessionActivity("session-1")!.items.filter((item) => item.kind !== "prompt");
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
    assert.deepEqual(grep.matchedFiles, ["C:/project/src/a.ts"]);
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
  const items = analyzer.getSessionActivity("session-1")!.items.filter((item) => item.kind !== "prompt");
  assert.deepEqual(items.map((item) => item.kind === "file.change" ? [item.path, item.action, item.status] : null), [
    ["new.ts", "created", "failed"], ["old.ts", "deleted", "failed"],
    ["moved.ts", "created", "failed"], ["gone.ts", "deleted", "failed"],
  ]);
  assert.equal(new Set(items.map((item) => item.id)).size, 4);
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
  assert.equal(activity.schemaVersion, 2);
  assert.equal(activity.sessionID, "session-1");
  assert.deepEqual(activity.items.map((item) => [item.kind, "text" in item && item.text]), [
    ["prompt", "Fix the bug"],
  ]);
  assert.equal(activity.items[0].source.messageID, undefined);
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
  assert.equal(items.filter((item) => item.kind === "file.read").length, 2);
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
    tag: "tool.execute.after", sessionID: "v1-session", pluginID: "v1-plugin", created: 456,
    "tool.execute.after": { input: { callID: "read-1", tool: "read" }, output: {} },
  } as unknown as LogEvent);
  const item = analyzer.getSessionActivity("v1-session")!.items.find((item) => item.kind === "file.read")!;
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
  assert.deepEqual(analyzer.getSessionActivity("session-1")!.items.filter((item) => item.kind !== "prompt"), []);
});

test("successful file updates are confirmed only after completion", () => {
  const analyzer = new SessionAnalyzer();
  call(analyzer, "edit", "edit-1", { filePath: "a.ts" });
  call(analyzer, "write", "write-1", { filePath: "b.ts" });
  call(analyzer, "patch", "patch-1", { patchText: "*** Delete File: c.ts" });
  for (const id of ["edit-1", "write-1", "patch-1"]) {
    analyzer.process(event("session.tool.success", { id }));
  }
  assert.deepEqual(analyzer.getSessionActivity("session-1")!.items.filter((item) => item.kind !== "prompt").map((item) =>
    item.kind === "file.change" ? [item.path, item.action, item.status] : null), [
    ["a.ts", "modified", "completed"], ["b.ts", "modified", "completed"], ["c.ts", "deleted", "completed"],
  ]);
});

test("canonical updates replay to the HTTP model with stable identities and trace references", () => {
    const trace = [
      event("session.inbox.enqueued", {
        inboxID: "user-1", item: { type: "user", payload: { text: "Read a file" } },
      }, 100),
      event("session.inbox.delivered", { inboxID: "user-1" }, 110),
      event("session.tool.input.started", { id: "read-1", name: "read", assistantMessageID: "assistant-1" }, 120),
      event("session.tool.called", { id: "read-1", input: { path: "README.md" } }, 130),
      event("session.tool.success", { id: "read-1" }, 140),
    ];
    const analyzer = new SessionAnalyzer();
    let replay: SessionActivity[] = [];
    for (const value of trace) {
      analyzer.process(value);
      const update = analyzer.getActivityUpdates(value);
      if (update) replay = applyActivityUpdate(replay, update);
    }
    const heatmap = analyzer.getSessionActivity("session-1")!;
    assert.deepEqual(replay, [heatmap]);
    const prompt = heatmap.items.find((item) => item.kind === "prompt")!;
    const read = heatmap.items.find((item) => item.kind === "file.read")!;
    assert.equal(prompt.kind === "prompt" && prompt.phase, "active");
    assert.equal(prompt.startEventID, 2);
    assert.equal(read.kind === "file.read" && read.promptID, prompt.id);
    assert.deepEqual(read.eventIDs, [3, 4, 5]);
    assert.equal(read.source.callID, "read-1");
    assert.equal(read.source.messageID, "assistant-1");
    const restored = new SessionAnalyzer();
    trace.forEach((value) => restored.process(structuredClone(value)));
    assert.deepEqual(restored.getSessionActivity("session-1"), heatmap);
    const isolated = new SessionAnalyzer();
    isolated.process(event("session.created", {}));
    trace.forEach((value) => isolated.process(structuredClone(value)));
    assert.deepEqual(isolated.getSessionActivity("session-1")!.items.map((item) => item.id), heatmap.items.map((item) => item.id));
  });

test("canonical changes preserve inverse edits, undo, redo and immutable historical updates", () => {
    const analyzer = new SessionAnalyzer();
    const recorded: LogEvent[] = [];
    const publish = (tag: string, data: object) => {
      const value = event(tag, data, 100 + recorded.length);
      recorded.push(value);
      analyzer.process(value);
      return analyzer.getActivityUpdates(value);
    };
    publish("session.prompt", { text: "Edit", messageID: "user-1" });
    publish("session.tool.called", {
      id: "edit", tool: "edit", assistantMessageID: "assistant-1",
      input: { path: "app.ts", oldString: "old", newString: "new" },
    });
    const original = publish("session.tool.success", { id: "edit" })!;
    publish("session.prompt", { text: "Reverse", messageID: "user-2" });
    publish("session.tool.called", {
      id: "reverse", tool: "edit", assistantMessageID: "assistant-2",
      input: { path: "app.ts", oldString: "new", newString: "old" },
    });
    const inverse = publish("session.tool.success", { id: "reverse" })!;
    const changes = inverse.items.filter((item) => item.kind === "file.change");
    assert.equal(changes.length, 2);
    assert.ok(changes.every((item) => item.reverted));
    assert.ok(changes.every((item) => item.eventIDs.includes(6)));
    assert.ok(original.items.filter((item) => item.kind === "file.change").every((item) => !item.reverted));
    publish("session.revert.staged", { revert: { messageID: "user-2" } });
    const undone = analyzer.getSessionActivity("session-1")!.items.filter((item) => item.kind === "file.change");
    assert.deepEqual(undone.map((item) => Boolean(item.reverted)), [false, true]);
    publish("session.revert.cleared", {});
    const restored = new SessionAnalyzer();
    recorded.forEach((value) => restored.process(structuredClone(value)));
    assert.deepEqual(restored.getSessionActivity("session-1"), analyzer.getSessionActivity("session-1"));
  });

test("directory reads are removed by canonical deltas and fallback delivery keeps one active prompt", () => {
    const analyzer = new SessionAnalyzer();
    let replay: SessionActivity[] = [];
    const trace = [
      event("session.execution.started", {}, 100),
      event("session.inbox.enqueued", { inboxID: "i1", item: { type: "user", payload: { text: "Explore" } } }, 110),
      event("session.inbox.delivered", { inboxID: "i1" }, 120),
      event("session.tool.input.started", { id: "directory", name: "read" }, 130),
      event("session.tool.called", { id: "directory", input: { path: "src" } }, 140),
      event("session.tool.success", { id: "directory", content: [{ type: "text", text: "Read directory src\napp.ts" }] }, 150),
    ];
    for (const value of trace) {
      analyzer.process(value);
      const update = analyzer.getActivityUpdates(value);
      if (update) replay = applyActivityUpdate(replay, update);
    }
    const items = analyzer.getSessionActivity("session-1")!.items;
    assert.equal(items.length, 1);
    assert.equal(items[0].kind === "prompt" && items[0].text, "Explore");
    assert.equal(items[0].startEventID, 1);
    assert.deepEqual(replay, [analyzer.getSessionActivity("session-1")]);
    assert.equal(analyzer.getActivityUpdates(trace.at(-1)!)!.removedIDs!.length, 1);
  });

test("plugin scopes isolate native call identities and completion failures stay failed", () => {
    const analyzer = new SessionAnalyzer();
    for (const pluginID of ["plugin-a", "plugin-b"]) {
      for (const value of [
        event("session.prompt", { text: pluginID }),
        event("session.tool.called", { id: "same", tool: "read", input: { file_path: `${pluginID}.ts` } }),
        event("session.tool.success", { id: "same", metadata: { status: "error" }, error: "Denied" }),
      ]) analyzer.process({ ...value, pluginID });
    }
    const reads = analyzer.getSessionActivity("session-1")!.items.filter((item) => item.kind === "file.read");
    assert.equal(reads.length, 2);
    assert.notEqual(reads[0].id, reads[1].id);
    assert.notEqual(reads[0].promptID, reads[1].promptID);
    assert.ok(reads.every((item) => item.status === "failed" && item.error === "Denied"));
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
