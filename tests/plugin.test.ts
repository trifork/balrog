import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import type { Hooks, PluginInput } from "@opencode-ai/plugin";
import type { Plugin } from "@opencode/plugin";
import { BalrogPlugin as legacyPlugin } from "../plugin/opencode-balrog.js";
import { Recorder } from "../plugin/shared/recorder.js";
import v1 from "../plugin/v1/index.js";
import v2 from "../plugin/v2/index.js";

interface LogRecord {
  tag: string;
  sessionID: string | null;
  pluginID: string;
  apiVersion: "v1" | "v2";
  [tag: string]: unknown;
}

function captureLogs(t: TestContext) {
  const records: LogRecord[] = [];
  t.mock.method(globalThis, "fetch", async (url: RequestInfo | URL, options: RequestInit) => {
    assert.equal(url, "http://localhost:5001/log");
    assert.equal(options.method, "POST");
    assert.equal(new Headers(options.headers).get("Content-Type"), "application/json");
    records.push(JSON.parse(String(options.body)));
    return new Response(null, { status: 200 });
  });
  return records;
}

test("recorder posts the envelope and keeps a stable per-instance ID", async (t) => {
  const records = captureLogs(t);
  const recorder = new Recorder("v1");
  await recorder.record("initialize", null, { context: {} });
  await recorder.record("tool.execute.before", "session-1", { input: {} });

  assert.deepEqual(records[0], {
    initialize: { context: {} },
    tag: "initialize",
    sessionID: null,
    pluginID: recorder.pluginID,
    apiVersion: "v1",
  });
  assert.equal(records[1].pluginID, recorder.pluginID);
  assert.equal(records[1].sessionID, "session-1");
  assert.notEqual(new Recorder("v1").pluginID, recorder.pluginID);
});

for (const failure of ["http", "network", "timeout", "disabled"] as const) {
  test(`recorder writes JSON lines on ${failure} fallback`, async (t) => {
    const directory = await mkdtemp(join(tmpdir(), "balrog-test-"));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const fallbackPath = join(directory, "balrog.json");
    const fetchMock = t.mock.method(globalThis, "fetch", async () => {
      if (failure === "network") throw new TypeError("fetch failed");
      if (failure === "timeout") throw new DOMException("Timed out", "TimeoutError");
      return new Response(null, { status: 503 });
    });
    const recorder = new Recorder("v2", {
      fallbackPath,
      ...(failure === "disabled" ? { url: "" } : {}),
    });

    await recorder.record("initialize", null, { context: {} });
    await recorder.record("session.prompt", "session-1", { event: { text: "hello" } });

    const lines = (await readFile(fallbackPath, "utf8")).trim().split("\n");
    assert.equal(lines.length, 2);
    assert.equal(JSON.parse(lines[0]).apiVersion, "v2");
    assert.equal(JSON.parse(lines[1]).sessionID, "session-1");
    assert.equal(fetchMock.mock.callCount(), failure === "disabled" ? 0 : 2);
  });
}

test("successful delivery does not create a fallback file", async (t) => {
  captureLogs(t);
  const directory = await mkdtemp(join(tmpdir(), "balrog-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const recorder = new Recorder("v2", { fallbackPath: join(directory, "balrog.json") });
  await recorder.record("initialize", null, {});
  assert.deepEqual(await readdir(directory), []);
});

test("V1 preserves its hooks, payloads, and legacy entrypoint", async (t) => {
  const records = captureLogs(t);
  assert.equal(legacyPlugin, v1);
  const context = {
    directory: "C:/project",
    project: { id: "project-1" },
    client: { secret: "not logged" },
    $: () => undefined,
  } as unknown as PluginInput;
  const hooks = await v1(context);
  const toolInput = { tool: "read", sessionID: "session-1", callID: "call-1" };
  const toolOutput = { args: { filePath: "README.md" } };
  await hooks["tool.execute.before"]!(toolInput, toolOutput);
  await hooks["tool.execute.after"]!(
    { ...toolInput, args: toolOutput.args },
    { title: "Read", output: "file contents", metadata: {} },
  );
  await hooks["command.execute.before"]!(
    { command: "review", sessionID: "session-1", arguments: "" },
    { parts: [] },
  );
  const chatOutput: Parameters<NonNullable<Hooks["chat.message"]>>[1] = {
    message: {
      id: "message-1", role: "user", sessionID: "session-1",
      time: { created: 1 }, agent: "build",
      model: { providerID: "test", modelID: "test" },
    },
    parts: [],
  };
  await hooks["chat.message"]!({ sessionID: "session-1" }, chatOutput);

  assert.deepEqual(records.map((record) => record.tag), [
    "initialize", "tool.execute.before", "tool.execute.after",
    "command.execute.before", "chat.message",
  ]);
  assert.deepEqual(records[0].initialize, {
    context: { ...context, client: null, $: null },
  });
  assert.deepEqual(records[1]["tool.execute.before"], {
    input: toolInput, output: toolOutput,
  });
  assert.deepEqual(records[4]["chat.message"], {
    input: { sessionID: "session-1" }, output: chatOutput,
  });
  assert.ok(records.every((record) => record.apiVersion === "v1"));
  assert.ok(records.every((record) => record.pluginID === records[0].pluginID));
});

test("V2 registers native tool and prompt hooks without modifying events", async (t) => {
  const records = captureLogs(t);
  // The host normally supplies the context and owns registration disposal.
  const hooks = new Map<string, (event: object) => Promise<void>>();
  const context = {
    app: { version: "2.2.0" },
    location: { directory: "C:/project", project: { id: "project-1" } },
    tool: {
      async hook(name: string, callback: (event: object) => Promise<void>) {
        hooks.set(`tool.${name}`, callback);
        return { async dispose() {} };
      },
    },
    session: {
      async hook(name: string, callback: (event: object) => Promise<void>) {
        hooks.set(`session.${name}`, callback);
        return { async dispose() {} };
      },
    },
  } as unknown as Plugin.Context;

  assert.equal(v2.id, "opencode-balrog");
  await v2.setup(context);
  assert.deepEqual([...hooks.keys()], [
    "tool.execute.before", "tool.execute.after", "session.prompt",
  ]);

  const before = {
    sessionID: "session-1", tool: "read", id: "call-1",
    messageID: "message-1", agent: "build", input: { filePath: "README.md" },
  };
  const completed = { ...before, status: "completed", result: { content: "contents" } };
  const failed = { ...before, status: "error", error: { message: "Read failed" } };
  const prompt = {
    sessionID: "session-1", messageID: "message-2",
    prompt: { text: "hello" }, delivery: "steer",
  };
  const snapshots = structuredClone([before, completed, failed, prompt]);
  await hooks.get("tool.execute.before")!(before);
  await hooks.get("tool.execute.after")!(completed);
  await hooks.get("tool.execute.after")!(failed);
  await hooks.get("session.prompt")!(prompt);

  assert.deepEqual([before, completed, failed, prompt], snapshots);
  assert.deepEqual(records[0].initialize, {
    context: { location: context.location, version: "2.2.0" },
  });
  assert.deepEqual(records.slice(1).map((record) => record[record.tag]),
    snapshots.map((event) => ({ event })));
  assert.equal(records[4].tag, "session.prompt");
  assert.ok(records.every((record) => record.apiVersion === "v2"));
  assert.ok(records.every((record) => record.pluginID === records[0].pluginID));
});
