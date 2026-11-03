import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import type { Plugin } from "@opencode/plugin";
import type { SessionContext } from "@opencode/plugin/promise/session";
import type { Info, ToolContext, ToolEditor } from "@opencode/plugin/promise/tool";
import v2 from "../plugin/v2/index.js";
import { SessionAnalyzer } from "../server/analyzer.js";
import type { LogEvent } from "../server/log-receiver.js";

const contextFor = (id: string, sessionID = "session-1") => ({
  sessionID, id, messageID: "message-1", agent: "build",
  signal: new AbortController().signal, progress: async () => {},
}) as unknown as ToolContext;

async function setup(t: TestContext, execute: Info["execute"] = async () => ({
  content: [{ type: "text", text: "MyDemoService.cs" }],
})) {
  const records: LogEvent[] = [];
  const analyzer = new SessionAnalyzer();
  t.mock.method(globalThis, "fetch", async (_url: unknown, options: RequestInit) => {
    const record = JSON.parse(String(options.body)) as LogEvent;
    records.push(record);
    analyzer.process(record);
    return new Response(null, { status: 200 });
  });
  const tools = new Map<string, Info & { id: string }>();
  tools.set("glob", {
    id: "glob", name: "glob", description: "Find files", execute,
    input: { type: "object", properties: { pattern: { type: "string" } }, required: ["pattern"] },
  });
  tools.set("execute", {
    id: "execute", name: "execute", description: "Code Mode wrapper", input: { type: "object" },
    execute: async (input, context) => {
      const value = input as { callID: string; outcome: string; alsoWork?: boolean };
      if (value.alsoWork) {
        await tools.get("glob")!.execute({ pattern: "*.cs", __balrogReason: "Find another service" }, context);
      }
      await tools.get("balrog_reportOutcome")!.execute({ callID: value.callID, outcome: value.outcome }, context);
      return { content: "Reported" };
    },
  });
  const hooks: Array<(event: SessionContext) => void> = [];
  const pluginContext = {
    app: { version: "2.2.0" }, location: {}, options: {},
    tool: { async transform(callback: (editor: ToolEditor) => void) {
      callback({
        list: () => [...tools.values()], get: (id) => tools.get(id), namespace: () => {},
        add: (tool: Info) => {
          const id = tool.options?.namespace ? `${tool.options.namespace}_${tool.name}` : tool.name;
          tools.set(id, { ...tool, id });
        },
        update: (id, update) => { const tool = tools.get(id); if (tool) update(tool); },
        remove: (id) => { tools.delete(id); },
      });
      return { dispose: async () => {} };
    } },
    session: { async hook(name: string, callback: (event: SessionContext) => void) {
      assert.equal(name, "context");
      hooks.push(callback);
      return { dispose: async () => {} };
    } },
    event: { async *subscribe() {} },
    skill: { transform: async () => ({ dispose: async () => {} }) },
    command: { transform: async () => ({ dispose: async () => {} }) },
  } as unknown as Plugin.Context;
  const dispose = await v2.setup(pluginContext);
  t.after(async () => { if (typeof dispose === "function") await dispose(); });
  const modelRequest = (sessionID = "session-1", codeModeOnly = false) => {
    const available = [...tools].filter(([, tool]) => !codeModeOnly || tool.options?.codemode !== true);
    const event = { sessionID, system: [], tools: Object.fromEntries(available.map(([id, tool]) => [id, {
      description: tool.description, input: tool.input,
    }])) } as unknown as SessionContext;
    for (const hook of hooks) hook(event);
    return event.system.map((part) => part.type === "text" ? part.text : "").join("\n");
  };
  return { tools, records, analyzer, modelRequest };
}

test("agent can report a completed call's outcome without replacing its raw result or starting a reporting loop", async (t) => {
  const { tools, records, analyzer, modelRequest } = await setup(t);
  const reporter = tools.get("balrog_reportOutcome");
  assert.ok(reporter, "the plugin must register the reporting tool");
  assert.doesNotMatch(modelRequest(), /call-1/);
  const result = await tools.get("glob")!.execute({
    pattern: "**/*Service.cs", __balrogReason: "Find an example service.",
  }, contextFor("call-1"));
  analyzer.process({
    tag: "session.tool.success", sessionID: "session-1", pluginID: "test", apiVersion: "v2",
    "session.tool.success": { created: 100, data: { id: "call-1", content: result.content, metadata: result.metadata } },
  } as unknown as LogEvent);
  const instructions = modelRequest();
  assert.match(instructions, /balrog_reportOutcome/);
  assert.match(instructions, /call-1/);
  assert.match(instructions, /Find an example service/);
  await reporter.execute({ callID: "call-1", outcome: "Found MyDemoService as an example service." }, contextFor("report-1"));
  assert.equal(analyzer.getToolExecutions("session-1")[0].outcome,
    "Found MyDemoService as an example service.");
  assert.deepEqual(analyzer.getToolExecutions("session-1")[0].result,
    [{ type: "text", text: "MyDemoService.cs" }]);
  assert.equal(records.filter((event) => event.tag === "balrog.tool.outcome").length, 1);
  assert.doesNotMatch(modelRequest(), /call-1|report-1/);
  assert.doesNotMatch(JSON.stringify(reporter.input), /__balrogReason/);
});

test("Code Mode requests receive pending call IDs even when the reporter is not directly exposed", async (t) => {
  const { tools, modelRequest } = await setup(t);
  await tools.get("glob")!.execute({
    pattern: "*.cs", __balrogReason: "Find an example service",
  }, contextFor("call-with-hidden-id"));
  const instructions = modelRequest("session-1", true);
  assert.match(instructions, /call-with-hidden-id/);
  assert.match(instructions, /tools\.balrog\.reportOutcome/);
});

test("completed tool results expose their call IDs and reporting instructions without another lookup call", async (t) => {
  const { tools } = await setup(t);
  const result = await tools.get("glob")!.execute({
    pattern: "*.cs", __balrogReason: "Find an example service",
  }, contextFor("call-visible-to-agent"));
  assert.ok(Array.isArray(result.content));
  const texts = result.content.filter((part) => part.type === "text").map((part) => part.text);
  assert.equal(texts[0], "MyDemoService.cs");
  assert.match(texts.at(-1)!, /call-visible-to-agent/);
  assert.match(texts.at(-1)!, /tools\.balrog\.reportOutcome/);
  assert.match(texts.at(-1)!, /Find an example service/);
});

test("outcome reports reject blank values, unknown calls, other sessions and unfinished calls", async (t) => {
  let finish!: (value: { content: string }) => void;
  const result = new Promise<{ content: string }>((resolve) => { finish = resolve; });
  const { tools, records, modelRequest } = await setup(t, async () => result);
  const reporter = tools.get("balrog_reportOutcome")!;
  const running = tools.get("glob")!.execute({
    pattern: "**/*Service.cs", __balrogReason: "Find an example service.",
  }, contextFor("call-1"));
  await assert.rejects(reporter.execute({ callID: "call-1", outcome: "Premature claim" }, contextFor("report-1")),
    /completed instrumented call in this session/);
  assert.doesNotMatch(modelRequest(), /call-1/);
  finish({ content: "MyDemoService.cs" });
  await running;
  for (const outcome of [undefined, null, "", " \t\n", 42]) {
    await assert.rejects(reporter.execute({ callID: "call-1", outcome }, contextFor("report-1")),
      /non-empty callID and outcome/);
  }
  await assert.rejects(reporter.execute({ callID: "unknown", outcome: "Found a service" }, contextFor("report-1")));
  await assert.rejects(reporter.execute({ callID: "call-1", outcome: "Wrong session" }, contextFor("report-1", "session-2")));
  await assert.rejects(reporter.execute({ callID: "report-1", outcome: "Report about a report" }, contextFor("report-2")));
  assert.equal(records.filter((event) => event.tag === "balrog.tool.outcome").length, 0);
  assert.match(modelRequest(), /call-1/);
});

test("parallel outcomes stay associated with their calls and sessions and can be corrected explicitly", async (t) => {
  const { tools, analyzer, modelRequest } = await setup(t);
  const glob = tools.get("glob")!;
  await Promise.all([
    glob.execute({ pattern: "*.cs", __balrogReason: "Find a service" }, contextFor("call-1")),
    glob.execute({ pattern: "*Tests.cs", __balrogReason: "Find its tests" }, contextFor("call-2")),
    glob.execute({ pattern: "*.ts", __balrogReason: "Find a TypeScript module" }, contextFor("call-1", "session-2")),
  ]);
  assert.doesNotMatch(modelRequest(), /TypeScript module/);
  const reporter = tools.get("balrog_reportOutcome")!;
  await Promise.all([
    reporter.execute({ callID: "call-2", outcome: "No matching tests found" }, contextFor("report-1")),
    reporter.execute({ callID: "call-1", outcome: "Found MyDemoService" }, contextFor("report-2")),
    reporter.execute({ callID: "call-1", outcome: "Found service.ts" }, contextFor("report-3", "session-2")),
  ]);
  const outcomes = new Map(analyzer.getToolExecutions("session-1").map((call) => [call.callID, call.outcome]));
  assert.equal(outcomes.get("call-1"), "Found MyDemoService");
  assert.equal(outcomes.get("call-2"), "No matching tests found");
  assert.equal(analyzer.getToolExecutions("session-2")[0].outcome, "Found service.ts");
  await reporter.execute({ callID: "call-1", outcome: "Found MyDemoService.cs as the service example" }, contextFor("report-4"));
  assert.equal(analyzer.getToolExecutions("session-1").find((call) => call.callID === "call-1")?.outcome,
    "Found MyDemoService.cs as the service example");
  assert.doesNotMatch(modelRequest(), /call-1|call-2/);
});

test("failed calls retain their original errors and are prompted for an honest outcome", async (t) => {
  const failure = new Error("Directory is unavailable");
  const { tools, modelRequest, analyzer } = await setup(t, async () => { throw failure; });
  await assert.rejects(tools.get("glob")!.execute({
    pattern: "**/*Service.cs", __balrogReason: "Find an example service.",
  }, contextFor("call-1")), (error) => error === failure);
  assert.match(modelRequest(), /"status":"error"/);
  assert.match(modelRequest("session-1", true), /call-1/);
  assert.equal(analyzer.getToolExecutions("session-1")[0].outcome, null);
  await tools.get("balrog_reportOutcome")!.execute({
    callID: "call-1", outcome: "Could not find a service because the directory was unavailable.",
  }, contextFor("report-1"));
  assert.equal(analyzer.getToolExecutions("session-1")[0].outcome,
    "Could not find a service because the directory was unavailable.");
});

test("reporting-only Code Mode wrappers do not prompt for outcomes about outcomes", async (t) => {
  const { tools, modelRequest } = await setup(t);
  await tools.get("glob")!.execute({ pattern: "*.cs", __balrogReason: "Find a service" }, contextFor("call-1"));
  await tools.get("execute")!.execute({
    callID: "call-1", outcome: "Found MyDemoService", __balrogReason: "Record the finding",
  }, contextFor("report-envelope"));
  assert.doesNotMatch(modelRequest(), /call-1|report-envelope/);
  // An envelope that also does ordinary work must still be summarized.
  await tools.get("execute")!.execute({
    callID: "call-1", outcome: "Found MyDemoService", alsoWork: true, __balrogReason: "Find another example and record the earlier finding",
  }, contextFor("mixed-envelope"));
  assert.match(modelRequest(), /mixed-envelope/);
});
