import assert from "node:assert/strict";
import { EventEmitter, on } from "node:events";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test, type TestContext } from "node:test";
import { setImmediate } from "node:timers/promises";
import type { Hooks, PluginInput } from "@opencode-ai/plugin";
import type { Plugin } from "@opencode/plugin";
import { Host } from "@opencode/plugin/host";
import { createPluginSources } from "@opencode/plugin/source";
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

function captureLogs(t: TestContext, deliver?: (record: LogRecord) => Promise<void>) {
  const records: LogRecord[] = [];
  t.mock.method(globalThis, "fetch", async (url: RequestInfo | URL, options: RequestInit) => {
    assert.equal(url, "http://localhost:5001/log");
    assert.equal(options.method, "POST");
    assert.equal(new Headers(options.headers).get("Content-Type"), "application/json");
    const record = JSON.parse(String(options.body));
    records.push(record);
    await deliver?.(record);
    return new Response(null, { status: 200 });
  });
  return records;
}

function liveV2Events() {
  const bus = new EventEmitter();
  const subscriptions = new Set<AbortSignal>();
  const context = (directory: string, options: Record<string, unknown> = {}) => ({
    app: { version: "2.2.0" },
    location: { directory, project: { id: directory } },
    options,
    permission: { hook: async () => ({ dispose: async () => {} }) },
    tool: { transform: async () => ({ dispose: async () => {} }) },
    session: { hook: async () => ({ dispose: async () => {} }) },
    skill: { transform: async () => ({ dispose: async () => {} }) },
    command: { transform: async () => ({ dispose: async () => {} }) },
    event: {
      async *subscribe({ signal }: { signal: AbortSignal }) {
        subscriptions.add(signal);
        try {
          for await (const [event] of on(bus, "event", { signal })) yield event;
        } finally {
          subscriptions.delete(signal);
        }
      },
    },
  }) as unknown as Plugin.Context;
  return { bus, subscriptions, context };
}

test("V2 directory discovers both recorder and sidebar entrypoints", () => {
  const directory = fileURLToPath(new URL("../plugin/v2/", import.meta.url));
  const entrypoints = Host.resolve({ directory });

  assert.equal(entrypoints.server, new URL("../plugin/v2/index.ts", import.meta.url).href);
  assert.equal(entrypoints.tui, new URL("../plugin/v2/tui.ts", import.meta.url).href);
});

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
    created: records[0].created,
  });
  assert.equal(records[1].pluginID, recorder.pluginID);
  assert.equal(typeof records[0].created, "number");
  assert.equal(records[1].sessionID, "session-1");
  assert.notEqual(new Recorder("v1").pluginID, recorder.pluginID);
});

for (const failure of ["http", "network", "timeout", "disabled"] as const) {
  test(`recorder writes JSON lines to logPath on ${failure}`, async (t) => {
    const directory = await mkdtemp(join(tmpdir(), "balrog-test-"));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const logPath = join(directory, "balrog.json");
    const fetchMock = t.mock.method(globalThis, "fetch", async () => {
      if (failure === "network") throw new TypeError("fetch failed");
      if (failure === "timeout") throw new DOMException("Timed out", "TimeoutError");
      return new Response(null, { status: 503 });
    });
    const recorder = new Recorder("v2", {
      logPath,
      ...(failure === "disabled" ? { logEndpoint: "" } : {}),
    });

    await recorder.record("initialize", null, { context: {} });
    await recorder.record("session.prompt", "session-1", { event: { text: "hello" } });

    const lines = (await readFile(logPath, "utf8")).trim().split("\n");
    assert.equal(lines.length, 2);
    assert.equal(JSON.parse(lines[0]).apiVersion, "v2");
    assert.equal(JSON.parse(lines[1]).sessionID, "session-1");
    assert.equal(fetchMock.mock.callCount(), failure === "disabled" ? 0 : 2);
  });
}

test("successful delivery also writes to logPath", async (t) => {
  captureLogs(t);
  const directory = await mkdtemp(join(tmpdir(), "balrog-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const logPath = join(directory, "balrog.json");
  const recorder = new Recorder("v2", { logPath });
  await recorder.record("initialize", null, {});
  const lines = (await readFile(logPath, "utf8")).trim().split("\n");
  assert.equal(lines.length, 1);
  assert.equal(JSON.parse(lines[0]).tag, "initialize");
});

test("endpoint failures do not write a file when logPath is unset", async (t) => {
  const fetchMock = t.mock.method(globalThis, "fetch", async () => {
    throw new TypeError("fetch failed");
  });
  const recorder = new Recorder("v2");

  await recorder.record("initialize", null, {});

  assert.equal(fetchMock.mock.callCount(), 1);
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

test("V2 subscribes to native events and records them without modifying them", async (t) => {
  const records = captureLogs(t);
  const events = [
    {
      type: "session.tool.input.started",
      data: {
        sessionID: "session-1", assistantMessageID: "message-1",
        id: "call-1", name: "read",
      },
    },
    {
      type: "session.tool.called",
      data: {
        sessionID: "session-1", id: "call-1", executed: false,
        assistantMessageID: "message-1", input: { filePath: "README.md" },
      },
    },
    {
      type: "session.tool.success",
      data: {
        sessionID: "session-1", tool: "read", id: "call-1",
        status: "completed", result: { content: "contents" },
      },
    },
    {
      type: "session.tool.failed",
      data: {
        sessionID: "session-1", tool: "read", id: "call-1",
        status: "error", error: { message: "Read failed" },
      },
    },
    {
      type: "session.text.started",
      data: {
        sessionID: "session-1", messageID: "message-2",
        text: "hello", role: "user",
      },
    },
    {
      type: "session.revert.staged",
      data: { sessionID: "session-1", revert: { messageID: "message-2", files: [] } },
    },
    {
      type: "session.revert.cleared",
      data: { sessionID: "session-1" },
    },
    {
      type: "session.revert.committed",
      data: { sessionID: "session-1", to: "message-2" },
    },
  ];
  const snapshots = structuredClone(events);
  let subscriptionSignal: AbortSignal | undefined;
  const context = {
    app: { version: "2.2.0" },
    location: { directory: "C:/project", project: { id: "project-1" } },
    options: {},
    permission: { hook: async () => ({ dispose: async () => {} }) },
    tool: { transform: async () => ({ dispose: async () => {} }) },
    session: { hook: async () => ({ dispose: async () => {} }) },
    skill: { transform: async () => ({ dispose: async () => {} }) },
    command: { transform: async () => ({ dispose: async () => {} }) },
    event: {
      async *subscribe(options: { types?: string[]; signal: AbortSignal }) {
        assert.equal(options.types, undefined);
        subscriptionSignal = options.signal;
        for (const event of events) {
          yield event;
        }
      },
    },
  } as unknown as Plugin.Context;

  assert.equal(v2.id, "opencode-balrog");
  const dispose = await v2.setup(context);
  if (typeof dispose !== "function") {
    throw new Error("Expected V2 setup to return a cleanup function");
  }
  await setImmediate();
  await dispose();

  assert.ok(subscriptionSignal);
  assert.equal(subscriptionSignal.aborted, true);
  assert.deepEqual(events, snapshots);
  assert.deepEqual(records[0].initialize, {
    context: { location: context.location, version: "2.2.0" },
  });
  assert.deepEqual(records.slice(1).map((record) => record[record.tag]),
    snapshots);
  assert.deepEqual(records.slice(1).map((record) => record.tag),
    events.map((event) => event.type));
  assert.deepEqual(records.slice(1).map((record) => record.sessionID),
    events.map((event) => event.data.sessionID));
  assert.ok(records.every((record) => record.apiVersion === "v2"));
  assert.ok(records.every((record) => record.pluginID === records[0].pluginID));
});

test("V2 plugin options configure the log endpoint and log path", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "balrog-v2-options-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const logPath = join(directory, "custom-log.jsonl");
  const logEndpoint = "http://localhost:5002/custom-log";
  t.mock.method(globalThis, "fetch", async (url: RequestInfo | URL) => {
    assert.equal(url, logEndpoint);
    return new Response(null, { status: 503 });
  });

  const context = {
    app: { version: "2.2.0" },
    location: { directory: "C:/project", project: { id: "project-1" } },
    options: { logEndpoint, logPath },
    permission: { hook: async () => ({ dispose: async () => {} }) },
    tool: { transform: async () => ({ dispose: async () => {} }) },
    session: { hook: async () => ({ dispose: async () => {} }) },
    skill: { transform: async () => ({ dispose: async () => {} }) },
    command: { transform: async () => ({ dispose: async () => {} }) },
    event: {
      async *subscribe() {},
    },
  } as unknown as Plugin.Context;

  const dispose = await v2.setup(context);
  if (typeof dispose !== "function") {
    throw new Error("Expected V2 setup to return a cleanup function");
  }
  await dispose();

  const lines = (await readFile(logPath, "utf8")).trim().split("\n");
  assert.equal(lines.length, 1);
  assert.equal(JSON.parse(lines[0]).tag, "initialize");
  assert.equal(JSON.parse(lines[0]).apiVersion, "v2");
});

test("V2 locations share one event consumer and transfer ownership on unload", async (t) => {
  const records = captureLogs(t);
  const { bus, subscriptions, context } = liveV2Events();
  const first = context("C:/first");
  const second = context("C:/second");
  const disposeFirst = await v2.setup(first);
  assert.equal(typeof disposeFirst, "function");
  t.after(() => disposeFirst!());
  const sources = createPluginSources(async () => {});
  t.after(() => sources.dispose());
  const loaded = await sources.read(new URL("../plugin/v2/index.ts", import.meta.url).href);
  const { default: reloaded } = loaded.module as { default: typeof v2 };
  const disposeSecond = await reloaded.setup(second);
  assert.equal(typeof disposeSecond, "function");
  t.after(() => disposeSecond!());
  const initialized = records.filter((record) => record.tag === "initialize");
  const events = [
    { type: "session.text.started", location: first.location, data: { sessionID: "session-first", text: "first" } },
    { type: "session.text.started", location: second.location, data: { sessionID: "session-second", text: "second" } },
    { type: "config.updated", data: {} },
  ];
  for (const event of events) bus.emit("event", event);
  await setImmediate();

  assert.deepEqual(records.slice(2).map((record) => record[record.tag]), events);
  assert.equal(records[2].pluginID, initialized[0].pluginID);
  assert.equal(records[3].pluginID, initialized[1].pluginID);
  assert.equal(subscriptions.size, 1);

  await disposeFirst!();
  assert.equal(subscriptions.size, 1);
  const afterUnload = { ...events[1], data: { sessionID: "session-second", text: "after unload" } };
  bus.emit("event", afterUnload);
  await setImmediate();
  assert.deepEqual(records.at(-1)?.[afterUnload.type], afterUnload);
  assert.equal(records.at(-1)?.pluginID, initialized[1].pluginID);
  assert.equal(records.length, 6);

  await disposeSecond!();
  assert.equal(subscriptions.size, 0);

  const disposeReloaded = await reloaded.setup(second);
  assert.equal(typeof disposeReloaded, "function");
  t.after(() => disposeReloaded!());
  assert.equal(subscriptions.size, 1);
  const afterReload = { ...afterUnload, data: { sessionID: "session-second", text: "after reload" } };
  bus.emit("event", afterReload);
  await setImmediate();
  assert.deepEqual(records.at(-1)?.[afterReload.type], afterReload);
  assert.equal(records.at(-1)?.pluginID, records.at(-2)?.pluginID);
  await disposeReloaded!();
  assert.equal(subscriptions.size, 0);
});

test("V2 handover preserves queued events while another location's write is blocked", async (t) => {
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => { release = resolve; });
  const records = captureLogs(t, async (record) => {
    if (record.sessionID === "blocked") await blocked;
  });
  const { bus, context } = liveV2Events();
  const owner = context("C:/owner");
  const other = context("C:/other");
  const disposeOwner = await v2.setup(owner);
  const disposeOther = await v2.setup(other);
  t.after(async () => {
    release();
    await disposeOwner!();
    await disposeOther!();
  });
  const emit = (sessionID: string) => bus.emit("event", {
    type: "session.text.started", location: other.location, data: { sessionID, text: sessionID },
  });
  emit("blocked");
  await setImmediate();
  emit("queued");
  const unloading = disposeOwner!();
  await setImmediate();
  emit("after-handover");
  release();
  await unloading;
  await setImmediate();
  await disposeOther!();

  assert.deepEqual(records.filter((record) => record.tag === "session.text.started")
    .map((record) => record.sessionID), ["blocked", "queued", "after-handover"]);
});

test("V2 reports a location's write failure without stopping healthy locations", async (t) => {
  const records = captureLogs(t);
  const directory = await mkdtemp(join(tmpdir(), "balrog-v2-failed-write-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const logPath = join(directory, "log.jsonl");
  const { bus, context } = liveV2Events();
  const healthy = context("C:/healthy");
  const failing = context("C:/failing", { logPath });
  const disposeHealthy = await v2.setup(healthy);
  t.after(() => disposeHealthy!());
  const disposeFailing = await v2.setup(failing);
  t.after(() => Promise.resolve(disposeFailing!()).catch(() => {}));
  await rm(logPath);
  await mkdir(logPath);
  bus.emit("event", {
    type: "session.text.started", location: failing.location, data: { sessionID: "failed", text: "failed" },
  });
  await setImmediate();
  await assert.rejects(async () => { await disposeFailing!(); }, { code: "EISDIR" });
  bus.emit("event", {
    type: "session.text.started", location: healthy.location, data: { sessionID: "healthy", text: "healthy" },
  });
  await setImmediate();
  await disposeHealthy!();

  assert.equal(records.at(-1)?.sessionID, "healthy");
});
