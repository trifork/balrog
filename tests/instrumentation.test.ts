import assert from "node:assert/strict";
import { test } from "node:test";
import type { Plugin } from "@opencode/plugin";
import type { Info, ToolContext } from "@opencode/plugin/promise/tool";
import { Effect, Schema } from "effect";
import v2 from "../plugin/v2/index.js";
import { SessionAnalyzer } from "../server/analyzer.js";
import type { LogEvent } from "../server/log-receiver.js";
import { LogViewer } from "../server/viewer.js";

const callContext = {
  sessionID: "session-1", messageID: "message-1", id: "call-1", agent: "build",
  signal: new AbortController().signal, progress: async () => {},
} as unknown as ToolContext;

test("V2 requires explicit tool intent, records it per call and passes only original arguments to the executor", async (t) => {
  const fetchHTTP = globalThis.fetch;
  const records: LogEvent[] = [];
  t.mock.method(globalThis, "fetch", async (_url: unknown, options: RequestInit) => {
    records.push(JSON.parse(String(options.body)));
    return new Response(null, { status: 200 });
  });
  const originalSchema = {
    type: "object", properties: { path: { type: "string" } },
    required: ["path"], additionalProperties: false,
  };
  const result = { content: "File contents", metadata: { lines: 10 } };
  const inputs: unknown[] = [];
  const tool: Info & { id: string } = {
    id: "read", name: "read", description: "Read a file", input: originalSchema,
    options: { permission: "read", codemode: true },
    execute: async (input, context) => {
      inputs.push(input);
      assert.equal(context, callContext);
      return result;
    },
  };
  const context = {
    app: { version: "2.2.0" }, location: {}, options: {},
    permission: { hook: async () => ({ dispose: async () => {} }) },
    tool: {
      async transform(callback: (editor: unknown) => void) {
        const editor = { namespace: () => {}, add: () => {}, list: () => [tool], update: (_id: string, update: (draft: Info) => void) => update(tool) };
        callback(editor);
        callback(editor);
        return { dispose: async () => {} };
      },
    },
    session: { hook: async () => ({ dispose: async () => {} }) },
    skill: { transform: async () => ({ dispose: async () => {} }) },
    command: { transform: async () => ({ dispose: async () => {} }) },
    event: { async *subscribe() {} },
  } as unknown as Plugin.Context;
  const dispose = await v2.setup(context);
  t.after(async () => { if (typeof dispose === "function") await dispose(); });

  const schema = tool.input as Record<string, any>;
  assert.deepEqual(schema.required, ["path", "__balrogReason"]);
  assert.equal(schema.properties.__balrogReason.type, "string");
  const reasonDescription = schema.properties.__balrogReason.description as string;
  assert.match(reasonDescription, /State what this specific call will inspect or change/);
  assert.match(reasonDescription, /Distinguish selection from verification/);
  assert.match(reasonDescription, /describe it as a candidate and name what remains to be verified/);
  assert.match(reasonDescription, /Do not imply a search, comparison, or established property/);
  assert.match(reasonDescription, /that prior evidence does not support/);
  assert.ok(reasonDescription.includes('Misleading: "Find a small command to use as an implementation example."'));
  assert.ok(reasonDescription.includes("Call: list Commands/Urls."));
  assert.ok(reasonDescription.includes('Precise: "Inspect the selected Urls folder for a candidate command example; its size and suitability are not yet verified."'));
  assert.ok(tool.description.includes(reasonDescription));
  assert.deepEqual(originalSchema.properties, { path: { type: "string" } });
  assert.deepEqual(tool.options, { permission: "read", codemode: true });
  const args = { path: "README.md", __balrogReason: "Read the setup instructions before changing installation." };
  const annotated = await tool.execute(args, callContext);
  assert.ok(Array.isArray(annotated.content));
  assert.deepEqual(annotated.content[0], { type: "text", text: "File contents" });
  assert.equal(annotated.metadata?.lines, 10);
  assert.deepEqual(result, { content: "File contents", metadata: { lines: 10 } });
  assert.deepEqual(inputs, [{ path: "README.md" }]);
  assert.equal(args.__balrogReason, "Read the setup instructions before changing installation.");
  for (const reason of [undefined, null, "", " \n\t", 42]) {
    await assert.rejects(tool.execute({ path: "README.md", __balrogReason: reason }, callContext),
      /Provide a non-empty __balrogReason/);
  }
  assert.equal(inputs.length, 1, "calls without intent must not reach the original executor");
  const intent = records.find((record) => record.tag === "balrog.tool.intent");
  assert.ok(intent);
  const analyzer = new SessionAnalyzer();
  analyzer.process({
    tag: "session.tool.called", sessionID: "session-1", pluginID: "test", apiVersion: "v2",
    "session.tool.called": { created: 100, data: { id: "call-1", input: args } },
  } as unknown as LogEvent);
  analyzer.process(intent);
  assert.deepEqual(analyzer.getToolExecutions("session-1")[0].command, {
    name: "read", args: { path: "README.md" },
  });
  assert.equal(analyzer.getToolExecutions("session-1")[0].reason,
    "Read the setup instructions before changing installation.");
  const viewer = new LogViewer(analyzer);
  await new Promise<void>((resolve) => viewer.listen(0, "localhost", resolve));
  t.after(() => viewer.close());
  const address = viewer.address();
  assert.ok(address && typeof address !== "string");
  const response = await fetchHTTP(`http://localhost:${address.port}/api/tool-executions?session=session-1`);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.executions[0].reason, "Read the setup instructions before changing installation.");
  assert.deepEqual(body.executions[0].command.args, { path: "README.md" });
});

test("instrumentation preserves Effect tool parameters and delegates validation, defaults and errors to the original executor", async (t) => {
  t.mock.method(globalThis, "fetch", async () => new Response(null, { status: 200 }));
  const input = Schema.Struct({
    path: Schema.String,
    timeout: Schema.Int.pipe(Schema.withDecodingDefaultKey(Effect.succeed(30))),
    attempts: Schema.NumberFromString,
  });
  const failure = new Error("Original tool failed");
  let received: unknown;
  const tool: Info & { id: string } = {
    id: "read", name: "read", description: "Read", input,
    execute: async (args) => {
      received = await Schema.decodeUnknownPromise(input)(args);
      if ((received as { path: string }).path === "fail") throw failure;
      return { content: "Done" };
    },
  };
  const context = {
    app: { version: "2.2.0" }, location: {}, options: {},
    permission: { hook: async () => ({ dispose: async () => {} }) },
    tool: { async transform(callback: (editor: unknown) => void) {
      callback({ namespace: () => {}, add: () => {}, list: () => [tool], update: (_id: string, update: (draft: Info) => void) => update(tool) });
      return { dispose: async () => {} };
    } },
    session: { hook: async () => ({ dispose: async () => {} }) },
    skill: { transform: async () => ({ dispose: async () => {} }) },
    command: { transform: async () => ({ dispose: async () => {} }) },
    event: { async *subscribe() {} },
  } as unknown as Plugin.Context;
  const dispose = await v2.setup(context);
  t.after(async () => { if (typeof dispose === "function") await dispose(); });
  const schema = tool.input as Record<string, any>;
  assert.equal(schema.properties.path.type, "string");
  assert.equal(schema.properties.timeout.type, "integer");
  assert.deepEqual(schema.required, ["path", "attempts", "__balrogReason"]);
  await tool.execute({ path: "README.md", attempts: "3", __balrogReason: "Read the instructions" }, callContext);
  assert.deepEqual(received, { path: "README.md", timeout: 30, attempts: 3 });
  await assert.rejects(tool.execute({ path: "fail", attempts: "1", __balrogReason: "Test error propagation" }, callContext),
    (error) => error === failure);
  await assert.rejects(tool.execute({ path: 123, __balrogReason: "Test validation" }, callContext));
});

test("instrumentation extends closed referenced and standard schemas without changing shared definitions", async (t) => {
  t.mock.method(globalThis, "fetch", async () => new Response(null, { status: 200 }));
  const originalSchema = {
    $ref: "#/$defs/Args",
    $defs: {
      Args: {
        type: "object", properties: { path: { type: "string" } },
        required: ["path"], additionalProperties: false, maxProperties: 1,
      },
    },
  };
  const snapshots = structuredClone(originalSchema);
  const tools: Array<Info & { id: string }> = [
    { id: "ref", name: "ref", description: "Referenced schema", input: originalSchema, execute: async () => ({}) },
    {
      id: "standard", name: "standard", description: "Standard schema",
      input: {
        "~standard": {
          version: 1, vendor: "test", validate: (value: unknown) => ({ value }),
          jsonSchema: { input: () => ({
            type: "object", oneOf: [
              { properties: { path: { type: "string" } }, required: ["path"], additionalProperties: false },
              { properties: { pattern: { type: "string" } }, required: ["pattern"], additionalProperties: false },
            ],
          }) },
        },
      } as unknown as Info["input"],
      execute: async () => ({}),
    },
  ];
  const context = {
    app: { version: "2.2.0" }, location: {}, options: {},
    permission: { hook: async () => ({ dispose: async () => {} }) },
    tool: { async transform(callback: (editor: unknown) => void) {
      callback({ namespace: () => {}, add: () => {}, list: () => tools, update: (id: string, update: (draft: Info) => void) => update(tools.find((tool) => tool.id === id)!) });
      return { dispose: async () => {} };
    } },
    session: { hook: async () => ({ dispose: async () => {} }) },
    skill: { transform: async () => ({ dispose: async () => {} }) },
    command: { transform: async () => ({ dispose: async () => {} }) },
    event: { async *subscribe() {} },
  } as unknown as Plugin.Context;
  const dispose = await v2.setup(context);
  t.after(async () => { if (typeof dispose === "function") await dispose(); });
  const referenced = tools[0].input as Record<string, any>;
  assert.equal(referenced.$defs.Args.properties.path.type, "string");
  assert.equal(referenced.$defs.Args.properties.__balrogReason.type, "string");
  assert.equal(referenced.$defs.Args.maxProperties, 2);
  assert.deepEqual(originalSchema, snapshots);
  const standard = tools[1].input as Record<string, any>;
  assert.deepEqual(standard.oneOf[0].required, ["path", "__balrogReason"]);
  assert.deepEqual(standard.oneOf[1].required, ["pattern", "__balrogReason"]);
});
