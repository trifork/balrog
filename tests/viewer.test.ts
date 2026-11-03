import assert from "node:assert/strict";
import { once } from "node:events";
import { connect as connectTCP } from "node:net";
import { test, type TestContext } from "node:test";
import WebSocket from "ws";
import { SessionAnalyzer } from "../server/analyzer.js";
import type { LogEvent } from "../server/log-receiver.js";
import { LogViewer } from "../server/viewer.js";
import type { ViewerResponse } from "../shared/viewer-protocol.js";

async function startViewer(t: TestContext) {
  const analyzer = new SessionAnalyzer();
  const viewer = new LogViewer(analyzer);
  await new Promise<void>((resolve) => viewer.listen(0, "localhost", resolve));
  t.after(() => viewer.close());
  const address = viewer.address();
  assert.ok(address && typeof address !== "string");
  const origin = `http://localhost:${address.port}`;
  const publish = (tag: string, data: Record<string, unknown> = {}) => {
    const event = {
      tag, sessionID: "session-viewer", pluginID: "plugin-viewer", apiVersion: "v2",
      [tag]: { type: tag, data: { sessionID: "session-viewer", ...data } },
    } as unknown as LogEvent;
    analyzer.process(event);
    viewer.publish(event);
    return event;
  };
  const connect = async () => {
    const socket = new WebSocket(`${origin.replace("http", "ws")}/ws`, { origin });
    t.after(() => socket.terminate());
    await once(socket, "open");
    return socket;
  };
  return { viewer, analyzer, origin, publish, connect };
}

async function request(socket: WebSocket, body: unknown): Promise<ViewerResponse> {
  const response = once(socket, "message");
  socket.send(typeof body === "string" ? body : JSON.stringify(body));
  const [data] = await response;
  return JSON.parse(String(data));
}

test("viewer serves built React assets and preserves the session HTTP API", { timeout: 5_000 }, async (t) => {
  const { origin, publish } = await startViewer(t);
  const page = await fetch(`${origin}/?session=session-viewer`);
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.match(html, /Balrog log events/);
  assert.match(html, /id="root"/);
  assert.doesNotMatch(html, /EventSource|createElement\('article'\)/);
  const scriptPath = html.match(/src="([^"]+\.js)"/)?.[1];
  assert.ok(scriptPath);
  const script = await fetch(`${origin}${scriptPath}`);
  assert.equal(script.status, 200);
  assert.match(script.headers.get("content-type")!, /javascript/);
  const cssPath = html.match(/href="([^"]+\.css)"/)?.[1];
  assert.ok(cssPath);
  assert.equal((await fetch(`${origin}${cssPath}`)).status, 200);
  for (const pathname of ["/missing", "/server/viewer.ts", "/assets/%2e%2e%2f%2e%2e%2fpackage.json", "/%00", "/events"]) {
    assert.equal((await fetch(`${origin}${pathname}`)).status, 404);
  }
  assert.equal((await fetch(origin, { method: "POST" })).status, 405);
  publish("session.renamed", { title: "Viewer session" });
  const sessions = await (await fetch(`${origin}/api/sessions`)).json();
  assert.equal(sessions[0].title, "Viewer session");
  const session = await fetch(`${origin}/api/sessions/session-viewer`);
  assert.equal((await session.json()).title, "Viewer session");
  assert.equal((await fetch(`${origin}/api/sessions/missing`)).status, 404);
});

test("WebSocket snapshots and live updates preserve raw events and display enrichment", { timeout: 5_000 }, async (t) => {
  const { connect, publish } = await startViewer(t);
  const first = publish("session.text.ended", { text: "hello" });
  publish("session.renamed", { title: "Viewer session" });
  publish("session.tool.called", { id: "call-1", input: { command: "npm test\n-- --verbose" } });
  publish("session.tool.success", { id: "call-1", result: { content: [{ type: "text", text: "tool output" }] } });
  const socket = await connect();
  const snapshot = await request(socket, { type: "snapshot.request" });
  assert.equal(snapshot.type, "snapshot");
  if (snapshot.type !== "snapshot") return;
  assert.equal(snapshot.events.length, 4);
  assert.equal(snapshot.sessions[0].title, "Viewer session");
  assert.deepEqual(snapshot.events[0].event, first);
  assert.equal(snapshot.events[0].content, "hello");
  assert.equal(snapshot.events[2].content, "npm test\n-- --verbose");
  assert.equal(snapshot.events[2].command, "npm test");
  assert.equal(snapshot.events[3].content, "tool output");
  assert.equal(snapshot.events[3].command, "npm test");
  assert.equal(new Set(snapshot.events.map((event) => event.id)).size, 4);
  const pushed = once(socket, "message");
  const next = publish("session.execution.succeeded");
  const [data] = await pushed;
  const live = JSON.parse(String(data));
  assert.equal(live.type, "event");
  assert.deepEqual(live.message.event, next);
  assert.equal(live.message.session.eventCount, 5);
  assert.equal(live.message.id, 5);
});

test("viewer replays immutable file activity snapshots and pushes live outcomes", { timeout: 5_000 }, async (t) => {
  const { connect, publish } = await startViewer(t);
  publish("session.prompt", { text: "Edit one file" });
  publish("session.tool.input.started", { id: "c1", name: "patch" });
  publish("session.tool.called", {
    id: "c1", input: { patchText: "*** Begin Patch\n*** Update File: src/app.ts\n@@\n-old\n+new\n*** End Patch" },
  });
  publish("session.tool.success", { id: "c1" });
  publish("session.prompt", { text: "Next prompt" });
  const socket = await connect();
  const snapshot = await request(socket, { type: "snapshot.request" });
  assert.equal(snapshot.type, "snapshot");
  if (snapshot.type !== "snapshot") return;
  assert.equal(snapshot.events.length, 5);
  const activities = snapshot.events.flatMap((message) => message.fileActivity ? [message.fileActivity] : []);
  assert.equal(activities[0].text, "Edit one file");
  assert.deepEqual(activities[0].files, []);
  assert.equal(activities[1].files[0].outcome, "pending");
  assert.equal(activities[2].files[0].outcome, "success");
  assert.equal(activities[2].files[0].path, "src/app.ts");
  assert.equal(activities[0].id, activities[2].id);
  assert.notEqual(activities[3].id, activities[2].id);
  assert.deepEqual(activities[3].files, []);
  assert.deepEqual(await request(socket, { type: "snapshot.request" }), snapshot);

  const pushed = once(socket, "message");
  publish("session.tool.called", { id: "c2", tool: "read", input: { path: "README.md" } });
  const [data] = await pushed;
  const live: ViewerResponse = JSON.parse(String(data));
  assert.equal(live.type, "event");
  if (live.type !== "event") return;
  assert.equal(live.message.id, 6);
  assert.equal(live.message.fileActivity?.id, activities[3].id);
  assert.equal(live.message.fileActivity?.files[0].path, "README.md");
  assert.equal(live.message.fileActivity?.files[0].outcome, "pending");
  const completed = once(socket, "message");
  publish("session.tool.failed", { id: "c2" });
  const [completedData] = await completed;
  const outcome: ViewerResponse = JSON.parse(String(completedData));
  assert.equal(outcome.type, "event");
  if (outcome.type !== "event") return;
  assert.equal(outcome.message.fileActivity?.files[0].outcome, "failed");
  assert.equal(live.message.fileActivity?.files[0].outcome, "pending");
});

test("snapshots replay all 600 events and repeat without mutating retained history", { timeout: 5_000 }, async (t) => {
  const { connect, publish } = await startViewer(t);
  for (let index = 0; index < 600; index += 1) publish("session.execution.started");
  const socket = await connect();
  const first = await request(socket, { type: "snapshot.request" });
  assert.equal(first.type, "snapshot");
  if (first.type !== "snapshot") return;
  assert.equal(first.events.length, 600);
  const second = await request(socket, { type: "snapshot.request" });
  assert.deepEqual(second, first);
  socket.close();
  const reconnected = await connect();
  assert.deepEqual(await request(reconnected, { type: "snapshot.request" }), first);
});

test("invalid requests return errors, and only requested subscriptions receive events", { timeout: 5_000 }, async (t) => {
  const { connect, publish } = await startViewer(t);
  const socket = await connect();
  publish("session.execution.started");
  for (const body of ["not json", null, [], {}, { type: "unknown" }]) {
    const response = await request(socket, body);
    assert.equal(response.type, "error");
  }
  const snapshot = await request(socket, { type: "snapshot.request" });
  assert.equal(snapshot.type, "snapshot");
  if (snapshot.type === "snapshot") assert.equal(snapshot.events.length, 1);
});

test("viewer rejects cross-origin WebSocket upgrades", { timeout: 5_000 }, async (t) => {
  const { origin } = await startViewer(t);
  const socket = new WebSocket(`${origin.replace("http", "ws")}/ws`, { origin: "https://untrusted.example" });
  const error = await new Promise<Error>((resolve) => socket.once("error", resolve));
  assert.match(error.message, /403/);
});

test("malformed HTTP and WebSocket request targets return 400 without stopping the viewer", { timeout: 5_000 }, async (t) => {
  const { viewer, origin } = await startViewer(t);
  const address = viewer.address();
  assert.ok(address && typeof address !== "string");
  for (const connection of ["close", "Upgrade\r\nUpgrade: websocket"]) {
    const socket = connectTCP(address.port, "localhost");
    t.after(() => socket.destroy());
    await once(socket, "connect");
    socket.end(`GET //[ HTTP/1.1\r\nHost: localhost\r\nConnection: ${connection}\r\n\r\n`);
    let response = "";
    for await (const chunk of socket) response += chunk.toString();
    assert.match(response, /^HTTP\/1\.1 400/);
  }
  assert.equal((await fetch(`${origin}/api/sessions`)).status, 200);
});

test("viewer shutdown closes active WebSockets", { timeout: 5_000 }, async () => {
  const viewer = new LogViewer();
  await new Promise<void>((resolve) => viewer.listen(0, "localhost", resolve));
  const address = viewer.address();
  assert.ok(address && typeof address !== "string");
  const socket = new WebSocket(`ws://localhost:${address.port}/ws`);
  await once(socket, "open");
  const closed = once(socket, "close");
  await viewer.close();
  await closed;
});
