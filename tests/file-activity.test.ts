import assert from "node:assert/strict";
import { test } from "node:test";
import { FileActivityTracker } from "../server/file-activity.js";
import type { LogEvent } from "../server/log-receiver.js";

function event(tag: string, data: Record<string, unknown>, sessionID = "s1", wrapped = false): LogEvent {
  const native = { type: tag, data };
  return {
    tag, sessionID, pluginID: "p1",
    [tag]: wrapped ? { event: native } : native,
  } as unknown as LogEvent;
}

function hook(tag: string, input: Record<string, unknown>, output: Record<string, unknown>): LogEvent {
  return { tag, sessionID: "s1", pluginID: "p1", [tag]: { input, output } } as unknown as LogEvent;
}

test("tracks V2 prompt delivery and tool names, without treating assistant text as a prompt", () => {
  const tracker = new FileActivityTracker();
  assert.equal(tracker.process(event("session.inbox.enqueued", {
    inboxID: "i1", item: { type: "user", payload: { text: "Read the code" } },
  })), undefined);
  const prompt = tracker.process(event("session.inbox.delivered", { inboxID: "i1" }))!;
  assert.equal(prompt.text, "Read the code");
  assert.equal(tracker.process(event("session.execution.started", {})), undefined);
  assert.equal(tracker.process(event("session.text.ended", { text: "Let me check" })), undefined);
  tracker.process(event("session.tool.input.started", { id: "c1", name: "read" }));
  const pending = tracker.process(event("session.tool.called", { id: "c1", input: { filePath: "src/app.ts" } }))!;
  assert.equal(pending.id, prompt.id);
  assert.deepEqual(pending.files, [{ path: "src/app.ts", action: "read", outcome: "pending", callID: "c1" }]);
  const done = tracker.process(event("session.tool.success", { id: "c1" }))!;
  assert.equal(done.files[0].outcome, "success");
  assert.equal(pending.files[0].outcome, "pending", "replay snapshots must not mutate");
});

test("correlates late outcomes with the original prompt and isolates sessions", () => {
  const tracker = new FileActivityTracker();
  const first = tracker.process(event("session.prompt", { text: "First" }, "s1", true))!;
  tracker.process(event("session.tool.called", { id: "same", tool: "edit", input: { filePath: "a.ts" } }));
  tracker.process(event("session.prompt", { text: "Second" }));
  tracker.process(event("session.prompt", { text: "Other session" }, "s2"));
  tracker.process(event("session.tool.called", { id: "same", tool: "read", input: { filePath: "b.ts" } }, "s2"));
  const failure = tracker.process(event("session.tool.failed", { id: "same" }))!;
  assert.equal(failure.id, first.id);
  assert.equal(failure.files[0].outcome, "failed");
  const other = tracker.process(event("session.tool.success", { id: "same" }, "s2"))!;
  assert.equal(other.sessionID, "s2");
  assert.equal(other.files[0].path, "b.ts");
  assert.equal(other.files[0].outcome, "success");
});

test("handles V1 hooks, windows paths, repeated calls, and write ambiguity", () => {
  const tracker = new FileActivityTracker();
  tracker.process({
    tag: "initialize", sessionID: null, pluginID: "p1",
    initialize: { context: { directory: "C:\\repo" } },
  } as unknown as LogEvent);
  const prompt = tracker.process(hook("chat.message", {}, { parts: [{ type: "text", text: "Update config" }] }))!;
  assert.equal(prompt.text, "Update config");
  const input = { tool: "write", callID: "c1", args: { filePath: "C:\\repo\\src\\config.ts" } };
  const pending = tracker.process(hook("tool.execute.before", input, { args: input.args }))!;
  assert.equal(pending.id, prompt.id);
  assert.equal(pending.files[0].path, "src/config.ts");
  assert.equal(pending.files[0].action, "written");
  const repeated = tracker.process(hook("tool.execute.before", input, { args: input.args }))!;
  assert.equal(repeated.files.length, 1);
  const done = tracker.process(hook("tool.execute.after", input, {}))!;
  assert.equal(done.files[0].outcome, "success");
});

test("extracts multi-file patches including renames and retains failed attempts", () => {
  const tracker = new FileActivityTracker();
  tracker.process(event("session.prompt", { text: "Refactor" }));
  tracker.process(event("session.tool.called", {
    id: "patch", tool: "apply_patch",
    input: { patchText: "*** Begin Patch\n*** Add File: src/new.ts\n+hello\n*** Update File: src/old.ts\n*** Move to: src/renamed.ts\n*** Delete File: src/gone.ts\n*** End Patch" },
  }));
  const result = tracker.process(event("session.tool.failed", { id: "patch" }))!;
  assert.deepEqual(result.files.map(({ path, action, outcome }) => ({ path, action, outcome })), [
    { path: "src/new.ts", action: "created", outcome: "failed" },
    { path: "src/old.ts", action: "deleted", outcome: "failed" },
    { path: "src/renamed.ts", action: "created", outcome: "failed" },
    { path: "src/gone.ts", action: "deleted", outcome: "failed" },
  ]);
});

test("labels missing prompts, normalizes paths, and does not infer files from shell output", () => {
  const tracker = new FileActivityTracker();
  const fallback = tracker.process(event("session.execution.started", {}))!;
  assert.equal(fallback.text, "Execution (prompt text unavailable)");
  const shell = tracker.process(event("session.tool.called", {
    id: "shell", tool: "bash", input: { command: "touch src/file.ts" },
  }))!;
  assert.equal(shell.files.length, 0);
  const read = tracker.process(event("session.tool.called", {
    id: "read", tool: "read", input: { filePath: "./src/../README.md" },
  }))!;
  assert.equal(read.files[0].path, "README.md");
  const next = tracker.process(event("session.execution.started", {}))!;
  assert.notEqual(next.id, fallback.id);
  assert.equal(next.files.length, 0);
});

test("queued prompts do not steal active tool attribution", () => {
  const tracker = new FileActivityTracker();
  const first = tracker.process(event("session.prompt", { text: "Active" }))!;
  tracker.process(event("session.inbox.enqueued", {
    inboxID: "next", item: { type: "user", payload: { text: "Queued" } },
  }));
  const active = tracker.process(event("session.tool.called", { id: "c", tool: "read", input: { filePath: "a.ts" } }))!;
  assert.equal(active.id, first.id);
  const next = tracker.process(event("session.inbox.delivered", { inboxID: "next" }))!;
  assert.equal(next.text, "Queued");
  assert.equal(next.files.length, 0);
});

test("delivery after execution starts replaces an empty fallback instead of duplicating the prompt", () => {
  const tracker = new FileActivityTracker();
  const execution = tracker.process(event("session.execution.started", {}))!;
  tracker.process(event("session.inbox.enqueued", {
    inboxID: "i1", item: { type: "user", payload: { text: "Delivered during execution" } },
  }));
  const delivered = tracker.process(event("session.inbox.delivered", { inboxID: "i1" }))!;
  assert.equal(delivered.id, execution.id);
  assert.equal(delivered.text, "Delivered during execution");
  tracker.process(event("session.execution.succeeded", {}));
  const next = tracker.process(event("session.execution.started", {}))!;
  assert.notEqual(next.id, delivered.id);
  assert.equal(next.text, "Execution (prompt text unavailable)");
});

test("tracks native V2 path inputs without a tool name on called or success events", () => {
  const tracker = new FileActivityTracker();
  tracker.process(event("session.execution.started", {}));
  tracker.process(event("session.inbox.enqueued", {
    inboxID: "i1", item: { type: "user", payload: { text: "Explain the architecture" } },
  }));
  const prompt = tracker.process(event("session.inbox.delivered", { inboxID: "i1" }))!;
  for (const [id, path] of [["c1", "/workspace/ROLES.md"], ["c2", "src/roles.ts"]]) {
    tracker.process(event("session.tool.input.started", { id, name: "read" }));
    const pending = tracker.process(event("session.tool.called", {
      id, input: { path }, executed: false,
    }))!;
    assert.equal(pending.id, prompt.id);
    assert.equal(pending.files.at(-1)?.path, path);
    assert.equal(pending.files.at(-1)?.outcome, "pending");
    const done = tracker.process(event("session.tool.success", {
      id, content: [{ type: "text", text: "File contents" }], metadata: { truncated: false }, executed: false,
    }))!;
    assert.equal(done.files.at(-1)?.outcome, "success");
  }
});

test("does not count a confirmed V2 directory read as a touched file", () => {
  const tracker = new FileActivityTracker();
  tracker.process(event("session.prompt", { text: "Inspect workspace" }));
  tracker.process(event("session.tool.input.started", { id: "dir", name: "read" }));
  tracker.process(event("session.tool.called", { id: "dir", input: { path: "/workspace" } }));
  const directory = tracker.process(event("session.tool.success", {
    id: "dir", content: [{ type: "text", text: "Read directory /workspace, entries 1-2\nsrc/\nREADME.md" }],
  }))!;
  assert.deepEqual(directory.files, []);
});

for (const tool of ["edit", "write"]) {
  test(`accepts path for ${tool} while retaining failed outcomes`, () => {
    const tracker = new FileActivityTracker();
    tracker.process(event("session.prompt", { text: "Update config" }));
    tracker.process(event("session.tool.input.started", { id: "c1", name: tool }));
    const pending = tracker.process(event("session.tool.called", {
      id: "c1", input: { path: "src/config.ts" },
    }))!;
    assert.equal(pending.files[0].action, tool === "edit" ? "modified" : "written");
    const failed = tracker.process(event("session.tool.failed", { id: "c1" }))!;
    assert.equal(failed.files[0].outcome, "failed");
  });
}

test("tracks native V2 patch edits under the delivered prompt through completion", () => {
  const tracker = new FileActivityTracker();
  tracker.process(event("session.execution.started", {}));
  tracker.process(event("session.inbox.enqueued", {
    inboxID: "change", item: { type: "user", payload: { text: "Change the poll interval to 120 milliseconds" } },
  }));
  const prompt = tracker.process(event("session.inbox.delivered", { inboxID: "change" }))!;
  tracker.process(event("session.tool.input.started", { id: "patch-call", name: "patch" }));
  const pending = tracker.process(event("session.tool.called", {
    id: "patch-call",
    input: {
      patchText: "*** Begin Patch\n*** Update File: /workspace/Services/RabbitMQService.cs\n@@\n-    private static readonly TimeSpan PublishRecoveryPollInterval = TimeSpan.FromMilliseconds(500);\n+    private static readonly TimeSpan PublishRecoveryPollInterval = TimeSpan.FromMilliseconds(120);\n*** End Patch",
    },
    executed: false,
  }))!;
  assert.equal(pending.id, prompt.id);
  assert.deepEqual(pending.files, [{
    path: "/workspace/Services/RabbitMQService.cs", action: "modified", outcome: "pending", callID: "patch-call",
  }]);
  const done = tracker.process(event("session.tool.success", {
    id: "patch-call", executed: false,
    metadata: { files: [{ file: "Services/RabbitMQService.cs" }] },
    content: [{ type: "text", text: "Success. Updated the following files:\nM Services/RabbitMQService.cs" }],
  }))!;
  assert.equal(done.id, prompt.id);
  assert.equal(done.files.length, 1);
  assert.equal(done.files[0].action, "modified");
  assert.equal(done.files[0].outcome, "success");
  assert.equal(pending.files[0].outcome, "pending");
});

for (const tool of ["patch", "apply_patch"]) {
  test(`tracks multi-file ${tool} failures without confirming changes`, () => {
    const tracker = new FileActivityTracker();
    tracker.process(event("session.prompt", { text: "Update files" }));
    tracker.process(event("session.tool.input.started", { id: "c1", name: tool }));
    tracker.process(event("session.tool.called", {
      id: "c1",
      input: { patchText: "*** Begin Patch\n*** Add File: src/new.ts\n+hello\n*** Update File: src/old.ts\n@@\n-old\n+new\n*** Delete File: src/gone.ts\n*** End Patch" },
    }));
    const result = tracker.process(event("session.tool.failed", { id: "c1" }))!;
    assert.deepEqual(result.files.map(({ action, outcome }) => ({ action, outcome })), [
      { action: "created", outcome: "failed" },
      { action: "modified", outcome: "failed" },
      { action: "deleted", outcome: "failed" },
    ]);
  });
}
