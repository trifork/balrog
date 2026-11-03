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

function edit(tracker: FileActivityTracker, id: string, before: string, after: string, sessionID = "s1") {
  tracker.process(event("session.tool.called", {
    id, tool: "edit", input: { path: "src/app.ts", oldString: before, newString: after },
  }, sessionID));
  return tracker.process(event("session.tool.success", { id }, sessionID))!;
}

test("successful inverse edits are reverted without treating failures or assistant text as reversions", () => {
  const tracker = new FileActivityTracker();
  tracker.process(event("session.prompt", { text: "Try a change", messageID: "user" }));
  const original = edit(tracker, "edit", "old", "new");
  assert.equal(tracker.process(event("session.text.ended", { text: "I reverted the edit" })), undefined);
  assert.equal(original.files[0].reverted, undefined);
  const pending = tracker.process(event("session.tool.called", {
    id: "undo", tool: "edit", input: { path: "src/app.ts", oldString: "new", newString: "old" },
  }))!;
  assert.equal(pending.files[0].reverted, undefined);
  const failed = tracker.process(event("session.tool.failed", { id: "undo" }))!;
  assert.equal(failed.files[0].reverted, undefined);
  const reversed = edit(tracker, "retry", "new", "old");
  assert.deepEqual(reversed.files.map((file) => file.reverted), [true, undefined, true]);
  assert.equal(original.files[0].reverted, undefined);
  assert.equal(original.files[0].outcome, "success");
  const reapplied = edit(tracker, "reapply", "old", "new");
  assert.equal(reapplied.files.at(-1)?.reverted, undefined);
});

test("recognizes inverse edit chains without confusing unrelated changes or sessions", () => {
  const tracker = new FileActivityTracker();
  edit(tracker, "a", "", "one");
  edit(tracker, "b", "one", "two");
  const reversed = edit(tracker, "c", "two", "");
  assert.ok(reversed.files.every((file) => file.reverted));
  edit(tracker, "other", "x", "y", "s2");
  const differentSession = edit(tracker, "not-undo", "y", "x");
  assert.equal(differentSession.files.at(-1)?.reverted, undefined);
  edit(tracker, "intervening", "unrelated", "change");
  const uncertain = edit(tracker, "not-provable", "x", "y");
  assert.equal(uncertain.files.at(-1)?.reverted, undefined);
});

test("inverse patches update the original prompt without reverting other files", () => {
  const tracker = new FileActivityTracker();
  const first = tracker.process(event("session.prompt", { text: "Change two files" }))!;
  tracker.process(event("session.tool.called", {
    id: "patch", tool: "patch",
    input: { patchText: "*** Begin Patch\n*** Update File: src/app.ts\n@@\n context\n-old\n+new\n*** Update File: src/other.ts\n@@\n-before\n+after\n*** End Patch" },
  }));
  const saved = tracker.process(event("session.tool.success", { id: "patch" }))!;
  const second = tracker.process(event("session.prompt", { text: "Undo one file" }))!;
  tracker.process(event("session.tool.called", {
    id: "undo", tool: "apply_patch",
    input: { patchText: "*** Begin Patch\n*** Update File: src/app.ts\n@@\n context\n-new\n+old\n*** End Patch" },
  }));
  const updates = tracker.processAll(event("session.tool.success", { id: "undo" }));
  assert.deepEqual(new Set(updates.map((prompt) => prompt.id)), new Set([first.id, second.id]));
  const original = updates.find((prompt) => prompt.id === first.id)!;
  assert.equal(original.files[0].reverted, true);
  assert.equal(original.files[1].reverted, undefined);
  assert.equal(updates.find((prompt) => prompt.id === second.id)?.files[0].reverted, true);
  assert.ok(saved.files.every((file) => !file.reverted));
});

test("native undo uses the message boundary and reported files; redo restores only undo markings", () => {
  const tracker = new FileActivityTracker();
  tracker.process({
    tag: "initialize", sessionID: null, pluginID: "p1",
    initialize: { context: { directory: "/workspace" } },
  } as unknown as LogEvent);
  const prompts = [];
  for (const number of [1, 2]) {
    tracker.process(event("session.inbox.enqueued", {
      inboxID: `user-${number}`, item: { type: "user", payload: { text: `Prompt ${number}` } },
    }));
    prompts.push(tracker.process(event("session.inbox.delivered", { inboxID: `user-${number}` }))!);
    tracker.process(event("session.tool.input.started", { id: `c${number}`, name: "edit", assistantMessageID: `assistant-${number}` }));
    tracker.process(event("session.tool.called", {
      id: `c${number}`, assistantMessageID: `assistant-${number}`, input: { path: "/workspace/src/app.ts" },
    }));
    tracker.process(event("session.tool.success", { id: `c${number}` }));
  }
  const undone = tracker.processAll(event("session.revert.staged", {
    revert: { messageID: "user-2", files: [{ file: "/workspace/src/app.ts", patch: "", status: "modified" }] },
  }, "s1", true));
  assert.equal(undone.length, 1);
  assert.equal(undone[0].id, prompts[1].id);
  assert.equal(undone[0].files[0].reverted, true);
  const redone = tracker.processAll(event("session.revert.cleared", {}));
  assert.equal(redone[0].files[0].reverted, undefined);
  assert.equal(undone[0].files[0].reverted, true);
  const all = tracker.processAll(event("session.revert.staged", { revert: { messageID: "user-1" } }));
  assert.equal(all.length, 2);
  assert.ok(all.every((prompt) => prompt.files[0].reverted));
  tracker.process(event("session.revert.committed", { to: "user-1" }));
  assert.deepEqual(tracker.processAll(event("session.revert.cleared", {})), []);
});

test("unknown undo boundaries never guess; reads, failures and other plugins are not reverted", () => {
  const tracker = new FileActivityTracker();
  tracker.process(event("session.prompt", { text: "Read and edit", messageID: "user" }));
  tracker.process(event("session.tool.called", { id: "r", tool: "read", input: { path: "src/app.ts" } }));
  tracker.process(event("session.tool.success", { id: "r" }));
  edit(tracker, "edit", "old", "new");
  assert.deepEqual(tracker.processAll(event("session.revert.staged", { revert: { messageID: "missing" } })), []);
  const foreign = { ...event("session.revert.staged", { revert: { messageID: "user" } }), pluginID: "other" } as LogEvent;
  assert.deepEqual(tracker.processAll(foreign), []);
  const undone = tracker.process(event("session.revert.staged", { revert: { messageID: "user" } }))!;
  assert.equal(undone.files[0].reverted, undefined);
  assert.equal(undone.files[1].reverted, true);
});

test("V1 inverse edits retain their replacement information through completion", () => {
  const tracker = new FileActivityTracker();
  tracker.process(hook("chat.message", {}, { parts: [{ text: "Try edits" }] }));
  for (const [id, old_string, new_string] of [["c1", "old", "new"], ["c2", "new", "old"]]) {
    const input = { tool: "edit", callID: id, args: { path: "src/app.ts", old_string, new_string } };
    tracker.process(hook("tool.execute.before", input, { args: input.args }));
    const done = tracker.process(hook("tool.execute.after", input, {}))!;
    assert.ok(done.files.every((file) => file.outcome === "success"));
    if (id === "c2") assert.ok(done.files.every((file) => file.reverted));
  }
});

test("native undo of an inverse edit makes the original edit active again, including after replay", () => {
  const events = [
    event("session.prompt", { text: "Change", messageID: "user-1" }),
    event("session.tool.called", {
      id: "c1", tool: "edit", assistantMessageID: "a1",
      input: { path: "src/app.ts", oldString: "old", newString: "new" },
    }),
    event("session.tool.success", { id: "c1" }),
    event("session.prompt", { text: "Undo", messageID: "user-2" }),
    event("session.tool.called", {
      id: "c2", tool: "edit", assistantMessageID: "a2",
      input: { path: "src/app.ts", oldString: "new", newString: "old" },
    }),
    event("session.tool.success", { id: "c2" }),
    event("session.revert.staged", { revert: { messageID: "user-2" } }),
    event("session.revert.cleared", {}),
  ];
  const replay = () => {
    const tracker = new FileActivityTracker();
    return events.map((record) => tracker.processAll(record));
  };
  const snapshots = replay();
  assert.ok(snapshots[5].every((prompt) => prompt.files.every((file) => file.reverted)));
  const undone = [...new Map(snapshots.slice(0, 7).flat().map((prompt) => [prompt.id, prompt])).values()];
  assert.equal(undone.find((prompt) => prompt.text === "Change")?.files[0].reverted, undefined);
  assert.equal(undone.find((prompt) => prompt.text === "Undo")?.files[0].reverted, true);
  const redone = snapshots[7];
  assert.equal(redone.length, 1);
  assert.equal(redone[0].text, "Change");
  assert.equal(redone[0].files[0].reverted, true);
  assert.equal(undone.find((prompt) => prompt.text === "Undo")?.files[0].reverted, true);
  assert.deepEqual(replay(), snapshots);
});

test("committed native undo stays reverted when a later undo is cleared", () => {
  const tracker = new FileActivityTracker();
  tracker.process(event("session.prompt", { text: "Change", messageID: "user" }));
  edit(tracker, "edit", "old", "new");
  tracker.process(event("session.revert.staged", { revert: { messageID: "user" } }));
  tracker.process(event("session.revert.committed", { to: "user" }));
  assert.deepEqual(tracker.processAll(event("session.revert.staged", { revert: { messageID: "user" } })), []);
  assert.deepEqual(tracker.processAll(event("session.revert.cleared", {})), []);
});

test("empty native file lists and partial-message undo do not mark unrelated edits", () => {
  const tracker = new FileActivityTracker();
  tracker.process(event("session.prompt", { text: "Change", messageID: "user" }));
  for (const id of ["part1", "part2"]) {
    tracker.process(event("session.tool.called", {
      id, tool: "edit", assistantMessageID: "assistant", input: { path: `${id}.ts` },
    }));
    tracker.process(event("session.tool.success", { id }));
  }
  assert.deepEqual(tracker.processAll(event("session.revert.staged", {
    revert: { messageID: "user", files: [] },
  })), []);
  assert.deepEqual(tracker.processAll(event("session.revert.committed", { to: "user" })), []);
  const part = tracker.process(event("session.revert.staged", {
    revert: { messageID: "assistant", partID: "part2" },
  }))!;
  assert.equal(part.files[0].reverted, undefined);
  assert.equal(part.files[1].reverted, true);
  const unknown = tracker.process(event("session.revert.staged", {
    revert: { messageID: "assistant", partID: "unknown" },
  }))!;
  assert.ok(unknown.files.every((file) => !file.reverted));
});

test("multiedits reverse only when every replacement and replace-all mode match", () => {
  const tracker = new FileActivityTracker();
  for (const [id, edits] of [
    ["c1", [{ oldString: "a", newString: "b" }, { oldString: "c", newString: "d" }]],
    ["c2", [{ oldString: "b", newString: "a" }, { oldString: "d", newString: "c" }]],
  ] as const) {
    tracker.process(event("session.tool.called", { id, tool: "multiedit", input: { path: "src/app.ts", edits } }));
    const result = tracker.process(event("session.tool.success", { id }))!;
    if (id === "c2") assert.ok(result.files.every((file) => file.reverted));
  }
  tracker.process(event("session.tool.called", {
    id: "all", tool: "edit", input: { path: "src/app.ts", oldString: "a", newString: "b", replaceAll: true },
  }));
  tracker.process(event("session.tool.success", { id: "all" }));
  const uncertain = edit(tracker, "single", "b", "a");
  assert.equal(uncertain.files.at(-1)?.reverted, undefined);
});

test("a native committed revert can mark changes without a preceding staged event", () => {
  const tracker = new FileActivityTracker();
  tracker.process(event("session.prompt", { text: "Change", messageID: "user" }));
  const original = edit(tracker, "edit", "old", "new");
  const committed = tracker.process(event("session.revert.committed", { to: "user" }))!;
  assert.equal(committed.files[0].reverted, true);
  assert.equal(original.files[0].reverted, undefined);
  assert.deepEqual(tracker.processAll(event("session.revert.cleared", {})), []);
});

test("does not infer reversions from recorded Git status or shell cleanup", () => {
  const tracker = new FileActivityTracker();
  tracker.process({
    tag: "initialize", sessionID: null, pluginID: "p1",
    initialize: { context: { directory: "/workspace" } },
  } as unknown as LogEvent);
  tracker.process(event("session.prompt", { text: "Optimize a service", messageID: "user" }));
  const original = edit(tracker, "edit", "generated", "restored");
  for (const [id, command, output] of [
    ["dirty", "git status --short", " M src/app.ts\n"],
    ["script", "python3 cleanup.py", "(no output)"],
    ["restore", "git restore -- src/app.ts", "(no output)"],
    ["clean", "git status --short", "(no output)"],
  ]) {
    tracker.process(event("session.tool.input.started", { id, name: "shell" }));
    tracker.process(event("session.tool.called", { id, input: { command } }));
    const updates = tracker.processAll(event("session.tool.success", {
      id, content: [{ type: "text", text: output }],
      metadata: { status: "completed", truncated: false, exit: 0 },
    }));
    assert.equal(updates.length, 1);
    assert.equal(updates[0].files.length, 1);
    assert.equal(updates[0].files[0].reverted, undefined);
  }
  assert.equal(original.files[0].reverted, undefined);
});
