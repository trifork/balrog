import assert from "node:assert/strict";
import { test } from "node:test";
import { setImmediate } from "node:timers/promises";
import { once } from "node:events";
import { createServer } from "node:http";
import { Schema } from "effect";
import WebSocket from "ws";
import type { Plugin } from "@opencode/plugin";
import type { Info, ToolContext } from "@opencode/plugin/promise/tool";
import { registerLiveToolExplanations } from "../plugin/v2/live-explanations.js";
import v2 from "../plugin/v2/index.js";
import { Recorder } from "../plugin/shared/recorder.js";
import { SessionAnalyzer } from "../server/analyzer.js";
import { SQLiteEventStore } from "../server/event-store.js";
import { LogReceiver } from "../server/log-receiver.js";
import { LogViewer } from "../server/viewer.js";

const toolContext = (id = "call-1", sessionID = "ses_live") => ({
  id, sessionID, messageID: "message-1", signal: new AbortController().signal,
}) as ToolContext;

function harness(input: Info["input"], execute: Info["execute"]) {
  const original: Info & { id: string } = { id: "read", name: "read", description: "Read a file.", input, execute };
  let tool = { ...original };
  let transform: Parameters<Plugin.Context["tool"]["transform"]>[0];
  let disposed = false;
  const records: Array<{ tag: string; sessionID: string | null; event: Record<string, unknown> }> = [];
  const registration = async () => ({ dispose: async () => {} });
  const replay = () => {
    tool = { ...original };
    transform({
      list: () => [tool],
      get: () => tool,
      update: (_id, update) => update(tool),
      add: () => assert.fail("Live explanations must not register reporting tools"),
      namespace: () => assert.fail("Live explanations must not register namespaces"),
      remove: () => assert.fail("Live explanations must not remove tools"),
    });
  };
  const context = {
    app: { version: "2.2.0" }, location: {}, options: { liveToolExplanations: true },
    permission: { hook: registration }, skill: { transform: registration }, command: { transform: registration },
    tool: { transform: async (callback: typeof transform) => {
      transform = callback;
      replay();
      return { dispose: async () => { disposed = true; } };
    } },
    session: new Proxy({}, { get: () => () => assert.fail("Live explanations must not use session APIs") }),
    experimental: { generate: new Proxy({}, { get: () => () => assert.fail("Live explanations must not call models") }) },
    event: { async *subscribe() {} },
  } as unknown as Plugin.Context;
  const recorder = { record: async (tag: string, sessionID: string | null, event: object) => {
    records.push({ tag, sessionID, event: event as Record<string, unknown> });
  } };
  return { context, recorder, records, replay, get tool() { return tool; }, get disposed() { return disposed; }, original };
}

const objectInput = () => ({ type: "object", properties: { path: { type: "string" } }, required: ["path"], additionalProperties: false });
const data = (record: { event: Record<string, unknown> }) => record.event["data"] as Record<string, unknown>;

test("live explanations add a short optional purpose, strip it from execution, and leave results unchanged", async () => {
  const result = { content: "Setup instructions", metadata: { title: "README" } };
  const inputs: unknown[] = [];
  const input = objectInput();
  const snapshot = structuredClone(input);
  const h = harness(input, async (args) => { inputs.push(args); return result; });
  const registration = await registerLiveToolExplanations(h.context, h.recorder);
  const schema = h.tool.input as Record<string, unknown>;
  assert.deepEqual(schema["required"], ["path"]);
  const field = (schema["properties"] as Record<string, Record<string, unknown>>)["__balrogReason"];
  assert.equal(field.type, "string");
  assert.ok(String(field.description).length < 100);
  assert.equal(h.tool.description, h.original.description);
  assert.deepEqual(input, snapshot);
  assert.equal(await h.tool.execute({ path: "README.md", __balrogReason: "Check setup." }, toolContext()), result);
  await registration.dispose();
  assert.deepEqual(inputs, [{ path: "README.md" }]);
  assert.deepEqual(h.records.map(({ tag }) => tag), ["balrog.tool.intent"]);
  assert.equal(data(h.records[0]).reason, "Check setup.");
  assert.equal(data(h.records[0]).source, "agent");
});

test("missing purposes do not reject tools, request reports, or invent an intent", async () => {
  let calls = 0;
  const h = harness(objectInput(), async () => { calls++; return {}; });
  const registration = await registerLiveToolExplanations(h.context, h.recorder);
  await h.tool.execute({ path: "README.md" }, toolContext());
  await registration.dispose();
  assert.equal(calls, 1);
  assert.deepEqual(h.records, []);
});

test("purposes are bounded and tool errors retain identity without generating outcomes", async () => {
  const error = new Error("Unavailable ".repeat(1_000));
  const h = harness(objectInput(), async () => { throw error; });
  const registration = await registerLiveToolExplanations(h.context, h.recorder);
  await assert.rejects(h.tool.execute({ path: "README.md", __balrogReason: "x".repeat(1_000) }, toolContext()), (actual) => actual === error);
  await registration.dispose();
  assert.ok(String(data(h.records[0]).reason).length <= 160);
  assert.deepEqual(h.records.map(({ tag }) => tag), ["balrog.tool.intent"]);
});

test("recorder failures cannot prevent execution or replace its result or error", async () => {
  const result = { content: "Done" };
  const error = new Error("Original failure");
  let calls = 0;
  const h = harness(objectInput(), async () => { if (++calls === 2) throw error; return result; });
  await registerLiveToolExplanations(h.context, { record: async () => { throw new Error("Disk full"); } });
  assert.equal(await h.tool.execute({ path: "README.md", __balrogReason: "Read." }, toolContext()), result);
  await assert.rejects(h.tool.execute({ path: "README.md" }, toolContext("call-2")), (actual) => actual === error);
  assert.equal(calls, 2);
});

test("Effect codecs preserve decoding and validation after removing tracing metadata", async () => {
  const inputs: unknown[] = [];
  const h = harness(Schema.Struct({ count: Schema.NumberFromString }), async (input) => { inputs.push(input); return {}; });
  await registerLiveToolExplanations(h.context, h.recorder);
  await h.tool.execute({ count: "42", __balrogReason: "Inspect the count." }, toolContext());
  assert.deepEqual(inputs, [{ count: 42 }]);
  await assert.rejects(h.tool.execute({ count: 42 }, toolContext("invalid")));
  assert.equal(inputs.length, 1);
});

test("decoder failures record only intent without invoking the executor or generating outcomes", async () => {
  let calls = 0;
  const h = harness(Schema.Struct({ count: Schema.NumberFromString }), async () => { calls++; return {}; });
  const registration = await registerLiveToolExplanations(h.context, h.recorder);
  await assert.rejects(h.tool.execute({ count: 42, __balrogReason: "Check the count." }, toolContext()));
  await registration.dispose();
  assert.equal(calls, 0);
  assert.deepEqual(h.records.map(({ tag }) => tag), ["balrog.tool.intent"]);
  assert.equal(data(h.records[0]).reason, "Check the count.");
});

test("throwing result and error getters cannot change tool behavior", async () => {
  const result = { content: "Done", metadata: { get exit() { throw new Error("Metadata unavailable"); } } };
  const h = harness(objectInput(), async () => result);
  const registration = await registerLiveToolExplanations(h.context, h.recorder);
  assert.equal(await h.tool.execute({ path: "README.md" }, toolContext()), result);
  await registration.dispose();
  assert.deepEqual(h.records, []);
  const error = { get message() { throw new Error("Message unavailable"); } };
  const failed = harness(objectInput(), async () => { throw error; });
  const failureRegistration = await registerLiveToolExplanations(failed.context, failed.recorder);
  await assert.rejects(failed.tool.execute({ path: "README.md" }, toolContext()), (actual) => actual === error);
  await failureRegistration.dispose();
  assert.deepEqual(failed.records, []);
});

test("projectable Standard Schema inputs preserve their original validator", async () => {
  const inputs: unknown[] = [];
  const input = { "~standard": {
    version: 1 as const, vendor: "test", jsonSchema: { input: () => objectInput() },
    validate: async (value: unknown) => ({ value: { ...(value as object), decoded: true } }),
  } };
  const h = harness(input, async (args) => { inputs.push(args); return {}; });
  await registerLiveToolExplanations(h.context, h.recorder);
  await h.tool.execute({ path: "README.md", __balrogReason: "Read." }, toolContext());
  assert.deepEqual(inputs, [{ path: "README.md", decoded: true }]);
});

test("unsupported and reserved-field schemas remain unmodified", async () => {
  for (const input of [
    { type: "string" },
    { type: "object", properties: { __balrogReason: { type: "number" } } },
    { type: "object", patternProperties: { ".*": { type: "number" } } },
    { type: "object", const: { path: "README.md" } },
    { type: "object", enum: [{ path: "README.md" }] },
    { ...objectInput(), if: { required: ["mode"] }, then: { required: ["flag"] } },
    { ...objectInput(), dependentRequired: { path: ["__balrogReason"] } },
    { ...objectInput(), required: ["__balrogReason"] },
    { $ref: "https://example.com/input.json" },
    { "~standard": { version: 1 as const, vendor: "test", validate: (value: unknown) => ({ value }) } },
  ]) {
    const execute = async () => ({});
    const h = harness(input, execute);
    await registerLiveToolExplanations(h.context, h.recorder);
    assert.equal(h.tool.input, input);
    assert.equal(h.tool.execute, execute);
  }
});

test("root references, closed object branches and property constraints retain their original semantics", async () => {
  const input = {
    $ref: "#/$defs/args",
    $defs: { args: { ...objectInput(), minProperties: 1, maxProperties: 1, propertyNames: { const: "path" } } },
  };
  const h = harness(input, async () => ({}));
  await registerLiveToolExplanations(h.context, h.recorder);
  const schema = h.tool.input as typeof input;
  assert.deepEqual(schema.$defs.args.required, ["path"]);
  assert.equal(schema.$defs.args.minProperties, undefined);
  assert.equal(schema.$defs.args.maxProperties, undefined);
  assert.deepEqual((schema.$defs.args as Record<string, unknown>)["allOf"], [{
    if: { required: ["__balrogReason"] }, then: { minProperties: 2, maxProperties: 2 }, else: { minProperties: 1, maxProperties: 1 },
  }]);
  assert.deepEqual(schema.$defs.args.propertyNames, { anyOf: [{ const: "path" }, { const: "__balrogReason" }] });
  assert.equal(input.$defs.args.maxProperties, 1);
  h.replay();
  assert.deepEqual(h.tool.input, schema);
});

test("nested Code Mode calls sharing an ID produce one outer intent and no outcomes", async () => {
  let depth = 0;
  const seen: unknown[] = [];
  const h = harness(objectInput(), async (args, context) => {
    seen.push(args);
    if (depth++ === 0) await h.tool.execute({ path: "inner", __balrogReason: "Nested." }, context);
    return { content: "Done" };
  });
  const registration = await registerLiveToolExplanations(h.context, h.recorder);
  await h.tool.execute({ path: "outer", __balrogReason: "Outer." }, toolContext());
  await registration.dispose();
  assert.deepEqual(seen, [{ path: "outer" }, { path: "inner" }]);
  assert.deepEqual(h.records.map(({ tag }) => tag), ["balrog.tool.intent"]);
  assert.equal(data(h.records[0]).reason, "Outer.");
});

test("parallel call IDs and identical IDs in different sessions retain separate explanations", async () => {
  const h = harness(objectInput(), async () => { await setImmediate(); return { content: "Done" }; });
  const registration = await registerLiveToolExplanations(h.context, h.recorder);
  await Promise.all([
    h.tool.execute({ path: "a", __balrogReason: "A." }, toolContext("same", "first")),
    h.tool.execute({ path: "b", __balrogReason: "B." }, toolContext("other", "first")),
    h.tool.execute({ path: "c", __balrogReason: "C." }, toolContext("same", "second")),
  ]);
  await registration.dispose();
  assert.equal(h.records.filter(({ tag }) => tag === "balrog.tool.intent").length, 3);
  assert.equal(h.records.filter(({ tag }) => tag === "balrog.tool.outcome").length, 0);
});

test("slow recording never delays the tool and pending writes are drained on disposal", async () => {
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => { release = resolve; });
  const h = harness(objectInput(), async () => ({ content: "Done" }));
  const registration = await registerLiveToolExplanations(h.context, { record: () => blocked });
  try {
    const finished = await Promise.race([
      h.tool.execute({ path: "README.md", __balrogReason: "Read." }, toolContext()).then(() => true),
      setImmediate().then(() => false),
    ]);
    assert.equal(finished, true);
  } finally {
    release();
    await registration.dispose();
  }
});

test("V2 wires live explanations only for explicit opt-in and disposes the transform", async (t) => {
  t.mock.method(globalThis, "fetch", async () => new Response(null, { status: 200 }));
  const h = harness(objectInput(), async () => ({ content: "Done" }));
  const dispose = await v2.setup(h.context);
  await setImmediate();
  assert.notEqual(h.tool.execute, h.original.execute);
  if (typeof dispose === "function") await dispose();
  assert.equal(h.disposed, true);
  for (const option of [undefined, false, "true"]) {
    const passive = harness(objectInput(), async () => ({}));
    (passive.context.options as Record<string, unknown>).liveToolExplanations = option;
    const stop = await v2.setup(passive.context);
    await setImmediate();
    assert.equal(passive.tool.execute, passive.original.execute);
    if (typeof stop === "function") await stop();
  }
});

test("live reasons stream without outcomes and retrospective outcomes remain queryable and survive SQLite replay", async (t) => {
  const server = createServer();
  const analyzer = new SessionAnalyzer();
  const store = new SQLiteEventStore(":memory:");
  const receiver = new LogReceiver(undefined, server);
  const viewer = new LogViewer(analyzer, undefined, server, (event) => store.append(event));
  receiver.subscribe((event) => { store.append(event); analyzer.process(event); viewer.publish(event); });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    await viewer.close();
    await receiver.close();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    store.close();
  });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const origin = `http://127.0.0.1:${address.port}`;
  const recorder = new Recorder("v2", { logEndpoint: `${origin}/log` });
  const rawInput = { path: "README.md", __balrogReason: "Check setup." };
  const result = { content: "Setup instructions" };
  const h = harness(objectInput(), async () => result);
  const registration = await registerLiveToolExplanations(h.context, recorder);
  t.after(() => registration.dispose());
  const recordNative = (tag: string, extra: object) => recorder.record(tag, "ses_live", {
    type: tag, created: Date.now(), data: { sessionID: "ses_live", id: "call-1", ...extra },
  });
  await recordNative("session.tool.called", { name: "read", input: rawInput });
  const socket = new WebSocket(`${origin.replace("http", "ws")}/ws`, { origin });
  t.after(() => socket.terminate());
  await once(socket, "open");
  const snapshot = once(socket, "message");
  socket.send(JSON.stringify({ type: "snapshot.request" }));
  await snapshot;
  const update = new Promise<Record<string, unknown>>((resolve) => {
    socket.on("message", (value) => {
      const message = JSON.parse(String(value));
      if (message.message?.event.tag === "balrog.tool.intent") resolve(message.message.execution);
    });
  });
  assert.equal(await h.tool.execute(rawInput, toolContext()), result);
  await registration.dispose();
  const live = await update;
  assert.equal(live.reasonSource, "agent");
  assert.equal(live.outcome, null);
  assert.equal(live.outcomeSource, undefined);
  await recordNative("session.tool.success", { content: result.content });
  const response = await (await fetch(`${origin}/api/tool-executions?session=ses_live`)).json();
  assert.equal(response.executions[0].reason, "Check setup.");
  assert.equal(response.executions[0].result, result.content);
  assert.equal(response.executions[0].outcome, null);
  assert.equal(store.readAll().some((event) => event.tag === "balrog.tool.outcome"), false);
  const assessment = await fetch(`${origin}/api/sessions/ses_live/assessments`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ assessments: [{ callID: "call-1", outcome: "Found the setup requirements in README.md." }] }),
  });
  assert.equal(assessment.status, 200);
  const retrospective = await (await fetch(`${origin}/api/tool-executions?session=ses_live`)).json();
  assert.equal(retrospective.executions[0].reason, "Check setup.");
  assert.equal(retrospective.executions[0].reasonSource, "agent");
  assert.equal(retrospective.executions[0].outcome, "Found the setup requirements in README.md.");
  assert.equal(retrospective.executions[0].outcomeSource, "retrospective");
  const conversation = await (await fetch(`${origin}/api/sessions/ses_live/conversation`)).json();
  assert.deepEqual(conversation.executions, retrospective.executions);
  assert.deepEqual(conversation.events[0]["session.tool.called"].data.input, rawInput);
  const replay = new SessionAnalyzer();
  store.readAll().forEach((event) => replay.process(event));
  assert.deepEqual(replay.getToolExecutions("ses_live"), retrospective.executions);
});
