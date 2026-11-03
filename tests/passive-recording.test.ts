import assert from "node:assert/strict";
import { test } from "node:test";
import { setImmediate } from "node:timers/promises";
import type { Plugin } from "@opencode/plugin";
import v2 from "../plugin/v2/index.js";

test("V2 records tool events without changing tools, injecting instructions, or registering outcome reporters", async (t) => {
  const records: Array<Record<string, unknown>> = [];
  t.mock.method(globalThis, "fetch", async (_url: unknown, options: RequestInit) => {
    records.push(JSON.parse(String(options.body)));
    return new Response(null, { status: 200 });
  });
  const events = [
    { type: "session.tool.called", data: { sessionID: "ses_passive", id: "read-1", input: { path: "README.md" } } },
    { type: "session.tool.success", data: { sessionID: "ses_passive", id: "read-1", content: "File contents" } },
  ];
  const registration = async () => ({ dispose: async () => {} });
  const context = {
    app: { version: "2.2.0" }, location: {}, options: {},
    permission: { hook: registration },
    tool: { transform: async () => assert.fail("Passive recording must not transform or register tools") },
    session: { hook: async () => assert.fail("Passive recording must not inject model instructions") },
    skill: { transform: registration }, command: { transform: registration },
    event: { async *subscribe() { yield* events; } },
  } as unknown as Plugin.Context;
  const dispose = await v2.setup(context);
  await setImmediate();
  if (typeof dispose === "function") await dispose();
  assert.deepEqual(records.slice(1).map((record) => record[String(record.tag)]), events);
  assert.deepEqual(records.map((record) => record.tag), ["initialize", "session.tool.called", "session.tool.success"]);
});
