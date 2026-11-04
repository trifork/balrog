import assert from "node:assert/strict";
import { once } from "node:events";
import { test } from "node:test";
import WebSocket from "ws";
import { SessionAnalyzer } from "../server/analyzer.js";
import { SQLiteEventStore } from "../server/event-store.js";
import type { LogEvent } from "../server/log-receiver.js";
import { LogViewer } from "../server/viewer.js";

test("retro assessments update the HTTP and live timeline views and survive replay without changing raw calls", async (t) => {
  const store = new SQLiteEventStore(":memory:");
  const analyzer = new SessionAnalyzer();
  const viewer = new LogViewer(analyzer, undefined, undefined, (event) => store.append(event));
  await new Promise<void>((resolve) => viewer.listen(0, "127.0.0.1", resolve));
  t.after(async () => { await viewer.close(); store.close(); });
  const address = viewer.address();
  assert.ok(address && typeof address !== "string");
  const origin = `http://127.0.0.1:${address.port}`;
  const original = {
    tag: "session.tool.called", sessionID: "ses_target", pluginID: "plugin", apiVersion: "v2",
    "session.tool.called": { type: "session.tool.called", created: 10,
      data: { sessionID: "ses_target", id: "call-1", tool: "read", input: { path: "README.md" } } },
  } as unknown as LogEvent;
  store.append(original);
  analyzer.process(original);
  viewer.publish(original);
  const socket = new WebSocket(`${origin.replace("http", "ws")}/ws`, { origin });
  await once(socket, "open");
  const snapshot = once(socket, "message");
  socket.send(JSON.stringify({ type: "snapshot.request" }));
  await snapshot;
  const update = once(socket, "message");
  const assessment = { callID: "call-1", capability: "Read file", reason: "Inferred: find setup instructions.", outcome: "unknown" };
  const response = await fetch(`${origin}/api/sessions/ses_target/assessments`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ assessments: [assessment] }),
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { sessionID: "ses_target", updated: 1 });
  const message = JSON.parse(String((await update)[0]));
  assert.equal(message.type, "event");
  assert.equal(message.message.execution.callID, "call-1");
  assert.equal(message.message.execution.reason, assessment.reason);
  assert.equal(message.message.execution.capability, "Read file");
  const body = await (await fetch(`${origin}/api/tool-executions?session=ses_target`)).json();
  assert.equal(body.executions[0].reason, assessment.reason);
  assert.equal(body.executions[0].capability, "Read file");
  assert.equal(body.executions[0].outcome, "unknown");
  assert.equal(body.executions[0].startedAt, 10);
  assert.deepEqual(store.readAll()[0], original);
  const replay = new SessionAnalyzer();
  for (const event of store.readAll()) replay.process(event);
  assert.deepEqual(replay.getToolExecutions("ses_target"), body.executions);
  const second = await fetch(`${origin}/api/sessions/ses_target/assessments`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ assessments: [{ ...assessment, reason: "Find lifecycle documentation.", outcome: "Later confirmation: instructions found." }] }),
  });
  assert.equal(second.status, 200);
  const updated = await (await fetch(`${origin}/api/tool-executions?session=ses_target`)).json();
  assert.equal(updated.executions.length, 1);
  assert.equal(updated.executions[0].outcome, "Later confirmation: instructions found.");
  assert.equal(updated.executions[0].capability, "Read file");
  assert.equal(updated.executions[0].reason, "Find lifecycle documentation.");
  const legacy = await fetch(`${origin}/api/sessions/ses_target/assessments`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ assessments: [{ callID: "call-1", reason: "Find lifecycle documentation.", outcome: "Documentation found." }] }),
  });
  assert.equal(legacy.status, 200);
  const preserved = await (await fetch(`${origin}/api/tool-executions?session=ses_target`)).json();
  assert.equal(preserved.executions[0].capability, "Read file");
  assert.equal(preserved.executions[0].reason, "Find lifecycle documentation.");
  const historical = await (await fetch(`${origin}/api/sessions/ses_target/conversation?before=11`)).json();
  assert.deepEqual(historical.events, [original]);
  assert.equal(historical.executions[0].reason, null);
  assert.equal(historical.executions[0].capability, undefined);
  socket.close();
});

test("assessment endpoint rejects invalid batches and cross-session calls before writing anything", async (t) => {
  const analyzer = new SessionAnalyzer();
  const saved: LogEvent[] = [];
  const viewer = new LogViewer(analyzer, undefined, undefined, (event) => saved.push(event));
  await new Promise<void>((resolve) => viewer.listen(0, "127.0.0.1", resolve));
  t.after(() => viewer.close());
  const address = viewer.address();
  assert.ok(address && typeof address !== "string");
  const origin = `http://127.0.0.1:${address.port}`;
  for (const [sessionID, id] of [["ses_target", "call-1"], ["ses_other", "other-call"]]) {
    analyzer.process({ tag: "session.tool.called", sessionID, pluginID: "test", apiVersion: "v2",
      "session.tool.called": { data: { sessionID, id, tool: "read", input: {} } } } as unknown as LogEvent);
  }
  const assessment = { callID: "call-1", reason: "Inferred purpose", outcome: "unknown" };
  const post = (body: string, session = "ses_target", headers = {}) => fetch(`${origin}/api/sessions/${session}/assessments`, {
    method: "POST", headers: { "Content-Type": "application/json", ...headers }, body,
  });
  for (const invalid of [null, [], {}, { assessments: [null] }, { assessments: [{ ...assessment, reason: " " }] },
    { assessments: [{ ...assessment, outcome: 123 }] }, { assessments: [assessment, assessment] },
    ...[null, 123, "", "  ", {}, []].map((capability) => ({ assessments: [{ ...assessment, capability }] })),
    { assessments: [assessment, { ...assessment, callID: "other-call", capability: false }] }]) {
    assert.equal((await post(JSON.stringify(invalid))).status, 400);
  }
  assert.equal((await post("{")).status, 400);
  assert.equal((await post(JSON.stringify({ assessments: [assessment] }), "ses_missing")).status, 404);
  assert.equal((await post(JSON.stringify({ assessments: [assessment] }), "%ZZ")).status, 400);
  assert.equal((await post(JSON.stringify({ assessments: [assessment, { ...assessment, callID: "other-call" }] }))).status, 404);
  assert.equal((await post(JSON.stringify({ assessments: [assessment] }), "ses_target", { Origin: "http://attacker.example" })).status, 403);
  assert.equal((await post("{}", "ses_target", { "Content-Type": "text/plain" })).status, 415);
  assert.equal((await post(JSON.stringify({ assessments: [{ ...assessment, reason: "x".repeat(1_048_576) }] }))).status, 413);
  const get = await fetch(`${origin}/api/sessions/ses_target/assessments`);
  assert.equal(get.status, 405);
  assert.equal(get.headers.get("Allow"), "POST");
  assert.deepEqual(saved, []);
  assert.equal(analyzer.getToolExecutions("ses_target")[0].reason, null);
  const empty = await post(JSON.stringify({ assessments: [] }));
  assert.deepEqual(await empty.json(), { sessionID: "ses_target", updated: 0 });
});

test("assessment storage failures do not update the live execution", async (t) => {
  const analyzer = new SessionAnalyzer();
  const viewer = new LogViewer(analyzer, undefined, undefined, () => { throw new Error("Disk full"); });
  analyzer.process({ tag: "session.tool.called", sessionID: "ses_target", pluginID: "test", apiVersion: "v2",
    "session.tool.called": { data: { sessionID: "ses_target", id: "call-1", tool: "read", input: {} } } } as unknown as LogEvent);
  await new Promise<void>((resolve) => viewer.listen(0, "127.0.0.1", resolve));
  t.after(() => viewer.close());
  const address = viewer.address();
  assert.ok(address && typeof address !== "string");
  const response = await fetch(`http://127.0.0.1:${address.port}/api/sessions/ses_target/assessments`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ assessments: [{ callID: "call-1", reason: "Purpose", outcome: "unknown" }] }),
  });
  assert.equal(response.status, 500);
  assert.equal(analyzer.getToolExecutions("ses_target")[0].reason, null);
});
