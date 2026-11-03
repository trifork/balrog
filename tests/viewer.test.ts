import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import { connect as connectTCP } from "node:net";
import { test, type TestContext } from "node:test";
import WebSocket from "ws";
import { SessionAnalyzer } from "../server/analyzer.js";
import { LogReceiver, type LogEvent } from "../server/log-receiver.js";
import { LogViewer } from "../server/viewer.js";
import type { ViewerResponse } from "../shared/viewer-protocol.js";

function nativeEvent(tag: string, sessionID: string, created: number, data: object): LogEvent {
  return {
    tag, sessionID, pluginID: "plugin-viewer", apiVersion: "v2",
    [tag]: { event: { type: tag, created, data: { sessionID, ...data } } },
  } as unknown as LogEvent;
}

test("tool executions endpoint correlates tool names, arguments, context and results", async (t) => {
  const analyzer = new SessionAnalyzer();
  const viewer = new LogViewer(analyzer);
  await new Promise<void>((resolve) => viewer.listen(0, "localhost", resolve));
  t.after(() => viewer.close());
  const address = viewer.address();
  assert.ok(address && typeof address !== "string");
  const origin = `http://localhost:${address.port}`;

  for (const event of [
    nativeEvent("session.text.ended", "session-1", 100, {
      assistantMessageID: "message-1", text: "Run the tests to check the change.",
    }),
    nativeEvent("session.tool.input.started", "session-1", 110, {
      assistantMessageID: "message-1", id: "call-1", name: "shell",
    }),
    nativeEvent("session.tool.called", "session-1", 120, {
      assistantMessageID: "message-1", id: "call-1", input: { command: "npm test" },
    }),
    nativeEvent("session.tool.success", "session-1", 150, {
      id: "call-1", content: [{ type: "text", text: "All tests passed" }],
    }),
  ]) analyzer.process(event);

  const response = await fetch(`${origin}/api/tool-executions?session=session-1`);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Content-Type"), "application/json; charset=utf-8");
  assert.deepEqual(await response.json(), {
    sessionID: "session-1",
    skills: [],
    executions: [{
      callID: "call-1",
      command: { name: "shell", args: { command: "npm test" } },
      startedAt: 120,
      completedAt: 150,
      reason: "Run the tests to check the change.",
      outcome: null,
      result: [{ type: "text", text: "All tests passed" }],
    }],
  });
  analyzer.process(nativeEvent("balrog.tool.outcome", "session-1", 160, {
    id: "call-1", reportCallID: "report-1", outcome: "The tests passed; no regression was detected by this suite.",
  }));
  const updated = await (await fetch(`${origin}/api/tool-executions?session=session-1`)).json();
  assert.equal(updated.executions[0].outcome, "The tests passed; no regression was detected by this suite.");
  assert.deepEqual(updated.executions[0].result, [{ type: "text", text: "All tests passed" }]);
});

test("tool executions endpoint includes delivered, tool-loaded and native skill observations", async (t) => {
  const { analyzer, origin } = await startViewer(t);
  const events = [
    nativeEvent("session.inbox.enqueued", "skills", 100, {
      inboxID: "prompt", item: { type: "user", payload: { skills: [{ id: "find-skills", name: "Find Skills" }] } },
    }),
    nativeEvent("session.inbox.delivered", "skills", 200, { inboxID: "prompt" }),
    nativeEvent("session.tool.input.started", "skills", 300, { id: "load", name: "skill" }),
    nativeEvent("session.tool.called", "skills", 350, { id: "read", tool: "read", input: { path: "README.md" } }),
    nativeEvent("session.tool.success", "skills", 360, { id: "read", result: "Documentation" }),
    nativeEvent("session.tool.called", "skills", 400, { id: "load", input: { id: "opencode" } }),
    nativeEvent("session.tool.success", "skills", 500, { id: "load", result: "Skill instructions" }),
    nativeEvent("session.skill.activated", "skills", 600, { id: "review", name: "Review" }),
  ];
  events.forEach((value) => analyzer.process(value));
  const response = await fetch(`${origin}/api/tool-executions?session=skills`);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  const body = await response.json();
  assert.deepEqual(body.skills, [
    { id: "review", name: "Review", activatedAt: 600, timestampSource: "event", source: "native" },
    { id: "opencode", name: "opencode", activatedAt: 500, timestampSource: "event", source: "tool", callID: "load" },
    { id: "find-skills", name: "Find Skills", activatedAt: 200, timestampSource: "event", source: "prompt", inboxID: "prompt" },
  ]);
  assert.deepEqual(body.executions, [{
    callID: "load", command: { name: "skill", args: { id: "opencode" } },
    startedAt: 400, completedAt: 500, reason: null, outcome: null, result: "Skill instructions",
  }, {
    callID: "read", command: { name: "read", args: { path: "README.md" } },
    startedAt: 350, completedAt: 360, reason: null, outcome: null, result: "Documentation",
  }]);
  assert.deepEqual((await (await fetch(`${origin}/api/tool-executions`)).json()).executions, body.executions);
  assert.deepEqual((await (await fetch(`${origin}/api/tool-executions`)).json()).skills, body.skills);
  analyzer.process(nativeEvent("session.created", "other", 700, {}));
  assert.deepEqual((await (await fetch(`${origin}/api/tool-executions`)).json()).executions, []);
  assert.deepEqual((await (await fetch(`${origin}/api/tool-executions`)).json()).skills, []);
});

test("tool executions endpoint defaults to the latest active session and handles missing sessions", async (t) => {
  const analyzer = new SessionAnalyzer();
  const viewer = new LogViewer(analyzer);
  await new Promise<void>((resolve) => viewer.listen(0, "localhost", resolve));
  t.after(() => viewer.close());
  const address = viewer.address();
  assert.ok(address && typeof address !== "string");
  const endpoint = `http://localhost:${address.port}/api/tool-executions`;

  assert.deepEqual(await (await fetch(endpoint)).json(), { sessionID: null, executions: [], skills: [] });
  analyzer.process(nativeEvent("session.created", "older", 100, {}));
  analyzer.process(nativeEvent("session.created", "latest / session", 200, {}));
  // Delayed events do not make an older session the latest active session.
  analyzer.process(nativeEvent("session.renamed", "older", 150, { title: "Older" }));
  assert.deepEqual(await (await fetch(endpoint)).json(), {
    sessionID: "latest / session", executions: [], skills: [],
  });
  const explicit = await fetch(`${endpoint}?session=${encodeURIComponent("latest / session")}`);
  assert.equal(explicit.status, 200);
  assert.deepEqual(await explicit.json(), { sessionID: "latest / session", executions: [], skills: [] });

  // Resolve timestamp ties by the last received activity, not session creation order.
  analyzer.process(nativeEvent("session.renamed", "older", 200, { title: "Active again" }));
  assert.equal((await (await fetch(endpoint)).json()).sessionID, "older");
  analyzer.process(nativeEvent("session.renamed", "latest / session", 200, { title: "Also active" }));
  assert.equal((await (await fetch(endpoint)).json()).sessionID, "latest / session");
  const missing = await fetch(`${endpoint}?session=unknown`);
  assert.equal(missing.status, 404);
  assert.deepEqual(await missing.json(), { error: "Session not found" });
  assert.equal((await fetch(endpoint, { method: "POST" })).status, 405);
});

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

test("one server receives events and serves the live viewer", { timeout: 5_000 }, async (t) => {
  const server = createServer();
  const analyzer = new SessionAnalyzer();
  const receiver = new LogReceiver(undefined, server);
  const viewer = new LogViewer(analyzer, undefined, server);
  receiver.subscribe((event) => {
    analyzer.process(event);
    viewer.publish(event);
  });
  await new Promise<void>((resolve) => server.listen(0, "localhost", resolve));
  t.after(async () => {
    await viewer.close();
    await receiver.close();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const origin = `http://localhost:${address.port}`;

  const page = await fetch(origin);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /id="root"/);
  const event = nativeEvent("session.renamed", "shared-server", 100, { title: "Shared port" });
  const logged = await fetch(`${origin}/log`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(event),
  });
  assert.equal(logged.status, 200);
  assert.deepEqual(await logged.json(), { ok: true });

  const socket = new WebSocket(`${origin.replace("http", "ws")}/ws`, { origin });
  t.after(() => socket.terminate());
  await once(socket, "open");
  const snapshot = await request(socket, { type: "snapshot.request" });
  assert.equal(snapshot.type, "snapshot");
  if (snapshot.type !== "snapshot") return;
  assert.equal(snapshot.sessions[0].title, "Shared port");
  assert.deepEqual(snapshot.events[0].event, event);
});

test("viewer streams the same command evidence as retro and refreshes it in snapshots", async (t) => {
  const { publish, connect, origin } = await startViewer(t);
  publish("session.tool.input.started", { id: "call-1", name: "read" });
  publish("session.tool.called", { id: "call-1", input: { path: "README.md", __balrogReason: "Read the project overview." } });
  const socket = await connect();
  const snapshot = await request(socket, { type: "snapshot.request" });
  assert.equal(snapshot.type, "snapshot");
  if (snapshot.type !== "snapshot") return;
  const recorded = (await (await fetch(`${origin}/api/tool-executions?session=session-viewer`)).json()).executions[0];
  assert.deepEqual(snapshot.events[1].execution, recorded);

  const incoming = once(socket, "message");
  publish("balrog.tool.outcome", { callID: "call-1", outcome: "Found setup instructions.\nNo code changed." });
  const live = JSON.parse(String((await incoming)[0])) as ViewerResponse;
  assert.equal(live.type, "event");
  if (live.type !== "event") return;
  assert.equal(live.message.execution?.outcome, "Found setup instructions.\nNo code changed.");
  const refreshed = await request(socket, { type: "snapshot.request" });
  if (refreshed.type !== "snapshot") throw new Error("Expected snapshot");
  assert.deepEqual(refreshed.events[1].execution, live.message.execution);
});

test("viewer serves built React assets and preserves the session HTTP API", { timeout: 5_000 }, async (t) => {
  const { origin, publish } = await startViewer(t);
  const page = await fetch(`${origin}/?session=session-viewer`);
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.match(html, /<title>Balrog — File heatmap<\/title>/);
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
  const session = await fetch(`${origin}/api/sessions/session-viewer/summary`);
  assert.equal(session.status, 200);
  assert.equal((await session.json()).title, "Viewer session");
  assert.equal((await fetch(`${origin}/api/sessions/session-viewer`)).status, 404);
  assert.equal((await fetch(`${origin}/api/sessions/missing/summary`)).status, 404);

  const activity = await fetch(`${origin}/api/sessions/session-viewer/heatmap`);
  assert.equal(activity.status, 200);
  const activityJSON = await activity.json();
  assert.equal(activityJSON.schemaVersion, 1);
  assert.equal(activityJSON.sessionID, "session-viewer");
  assert.deepEqual(activityJSON.items, []);
  assert.equal((await fetch(`${origin}/api/sessions/missing/heatmap`)).status, 404);
  assert.equal((await fetch(`${origin}/api/sessions/session-viewer/activity`)).status, 404);
});

test("heatmap API includes only prompts and file access from a mixed trace", async (t) => {
  const analyzer = new SessionAnalyzer();
  const viewer = new LogViewer(analyzer);
  await new Promise<void>((resolve) => viewer.listen(0, "localhost", resolve));
  t.after(() => viewer.close());
  const address = viewer.address();
  assert.ok(address && typeof address !== "string");
  const events = [
    { type: "session.inbox.enqueued", data: { item: { type: "user", payload: { text: "Review README.md" } } } },
    { type: "session.tool.called", data: { id: "read-1", tool: "read", input: { path: "README.md" } } },
    { type: "session.tool.success", data: { id: "read-1" } },
    { type: "session.tool.called", data: { id: "shell-1", tool: "shell", input: { command: "git status" } } },
    { type: "session.text.ended", data: { text: "Review complete" } },
  ];
  for (const [index, event] of events.entries()) {
    analyzer.process({
      tag: event.type, sessionID: "mixed-session", pluginID: "plugin-1", apiVersion: "v2",
      [event.type]: { ...event, created: 100 + index, data: { sessionID: "mixed-session", ...event.data } },
    } as unknown as LogEvent);
  }
  const response = await fetch(`http://localhost:${address.port}/api/sessions/mixed-session/heatmap`);
  assert.equal(response.status, 200);
  const activity = await response.json();
  assert.deepEqual(activity.items.map((item: { kind: string }) => item.kind), ["prompt", "file.read"]);
  assert.equal(activity.items[0].text, "Review README.md");
  assert.equal(activity.items[1].path, "README.md");
  assert.equal(activity.items[1].status, "completed");
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

test("native undo and redo push updates for all affected prompts and survive reconnects", { timeout: 5_000 }, async (t) => {
  const { connect, publish } = await startViewer(t);
  for (const index of [1, 2]) {
    publish("session.prompt", { text: `Prompt ${index}`, messageID: `user-${index}` });
    publish("session.tool.called", { id: `c${index}`, tool: "edit", input: { path: `src/file${index}.ts` } });
    publish("session.tool.success", { id: `c${index}` });
  }
  const socket = await connect();
  const original = await request(socket, { type: "snapshot.request" });
  assert.equal(original.type, "snapshot");
  const pushed = once(socket, "message");
  publish("session.revert.staged", { revert: { messageID: "user-1" } });
  const [data] = await pushed;
  const live: ViewerResponse = JSON.parse(String(data));
  assert.equal(live.type, "event");
  if (live.type !== "event") return;
  const updates = [live.message.fileActivity!, ...live.message.fileActivityUpdates ?? []];
  assert.equal(updates.length, 2);
  assert.ok(updates.every((prompt) => prompt.files[0].reverted));
  const reconnected = await connect();
  const snapshot = await request(reconnected, { type: "snapshot.request" });
  assert.equal(snapshot.type, "snapshot");
  if (snapshot.type !== "snapshot" || original.type !== "snapshot") return;
  assert.deepEqual(snapshot.events.at(-1), live.message);
  assert.equal(original.events[2].fileActivity?.files[0].reverted, undefined);
  const cleared = once(socket, "message");
  publish("session.revert.cleared");
  const [clearedData] = await cleared;
  const redo: ViewerResponse = JSON.parse(String(clearedData));
  assert.equal(redo.type, "event");
  if (redo.type !== "event") return;
  assert.equal(redo.message.fileActivity?.files[0].reverted, undefined);
  assert.equal(redo.message.fileActivityUpdates?.[0].files[0].reverted, undefined);
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
