import assert from "node:assert/strict";
import { test } from "node:test";
import { SessionAnalyzer } from "../server/analyzer.js";
import type { LogEvent } from "../server/log-receiver.js";
import { LogViewer } from "../server/viewer.js";

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

test("tool executions endpoint defaults to the latest active session and handles missing sessions", async (t) => {
  const analyzer = new SessionAnalyzer();
  const viewer = new LogViewer(analyzer);
  await new Promise<void>((resolve) => viewer.listen(0, "localhost", resolve));
  t.after(() => viewer.close());
  const address = viewer.address();
  assert.ok(address && typeof address !== "string");
  const endpoint = `http://localhost:${address.port}/api/tool-executions`;

  assert.deepEqual(await (await fetch(endpoint)).json(), { sessionID: null, executions: [] });
  analyzer.process(nativeEvent("session.created", "older", 100, {}));
  analyzer.process(nativeEvent("session.created", "latest / session", 200, {}));
  // Delayed events do not make an older session the latest active session.
  analyzer.process(nativeEvent("session.renamed", "older", 150, { title: "Older" }));
  assert.deepEqual(await (await fetch(endpoint)).json(), {
    sessionID: "latest / session", executions: [],
  });
  const explicit = await fetch(`${endpoint}?session=${encodeURIComponent("latest / session")}`);
  assert.equal(explicit.status, 200);
  assert.deepEqual(await explicit.json(), { sessionID: "latest / session", executions: [] });

  // Resolve timestamp ties by the last received activity, not session creation order.
  analyzer.process(nativeEvent("session.renamed", "older", 200, { title: "Active again" }));
  assert.equal((await (await fetch(endpoint)).json()).sessionID, "older");
  analyzer.process(nativeEvent("session.renamed", "latest / session", 200, { title: "Also active" }));
  assert.equal((await (await fetch(endpoint)).json()).sessionID, "latest / session");
  const missing = await fetch(`${endpoint}?session=unknown`);
  assert.equal(missing.status, 404);
  assert.deepEqual(await missing.json(), { error: "Session not found" });
  assert.equal((await fetch(endpoint, { method: "POST" })).status, 404);
});

test("viewer serves a page and streams events without writing log files", async (t) => {
  const analyzer = new SessionAnalyzer();
  const viewer = new LogViewer(analyzer);
  await new Promise<void>((resolve) => viewer.listen(0, "localhost", resolve));
  t.after(() => viewer.close());

  const address = viewer.address();
  assert.ok(address && typeof address !== "string");
  const origin = `http://localhost:${address.port}`;

  const page = await fetch(origin);
  assert.equal(page.status, 200);
  const pageText = await page.text();
  assert.match(pageText, /Balrog log events/);
  assert.match(pageText, /Activity overview/);
  assert.match(pageText, /aria-label="Activity summary"/);
  assert.match(pageText, /id="total-events"/);
  assert.match(pageText, /id="total-sessions"/);
  assert.match(pageText, /id="total-tools"/);
  assert.match(pageText, /type="search"[^>]+aria-label="Search events"/);
  assert.match(pageText, /id="event-filter" aria-label="Filter event type"/);
  assert.match(pageText, /search\.addEventListener\('input', updateView\)/);
  assert.match(pageText, /eventFilter\.addEventListener\('change', updateView\)/);
  assert.match(pageText, /card\.hidden = !matchesFilters\(card\)/);
  assert.match(pageText, /No matching events/);
  assert.match(pageText, /tabs\.addEventListener\('keydown'/);
  assert.match(pageText, /aria-orientation/);
  assert.match(pageText, /@media \(max-width: 760px\)/);
  const pageScript = pageText.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  assert.ok(pageScript, "viewer page should contain its client script");
  assert.doesNotThrow(() => new Function(pageScript));
  assert.match(pageText, /id="session-tabs"/);
  assert.match(pageText, /All sessions/);
  assert.match(pageText, /const sessionFromURL =/);
  assert.match(pageText, /searchParams\.get\('session'\)/);
  assert.match(pageText, /searchParams\.set\('session', selectedSession\)/);
  assert.match(pageText, /searchParams\.delete\('session'\)/);
  assert.match(pageText, /window\.history\.pushState/);
  assert.match(pageText, /window\.addEventListener\('popstate'/);
  assert.match(pageText, /if \(meta\) meta\.hidden = Boolean\(selectedSession\)/);
  assert.match(pageText, /id="collapse-all"/);
  assert.match(pageText, /Collapse all/);
  assert.match(pageText, /const setCardCollapsed =/);
  assert.match(pageText, /className = 'event-collapse'/);
  assert.match(pageText, /const hasContent = typeof message\.content === 'string'/);
  assert.match(pageText, /if \(hasContent\) \{/);
  assert.match(pageText, /querySelectorAll\('article\.has-content'\)/);
  assert.match(pageText, /article\.collapsed > \.content \{ display: none; \}/);
  assert.doesNotMatch(pageText, /article\.collapsed > :not\(header\)/);
  assert.match(pageText, /control\.textContent = collapsed \? '▸' : '▾'/);
  assert.match(pageText, /heading\.append\(collapse\)/);
  assert.match(pageText, /heading\.append\(tag, time, meta\)/);
  assert.match(pageText, /meta\.hidden = Boolean\(selectedSession\)/);
  assert.match(pageText, /if \(hasContent\) setCardCollapsed\(card, collapseNewEvents\)/);
  assert.match(pageText, /fetch\('\/api\/sessions'\)/);
  assert.doesNotMatch(pageText, /messageContent/);
  assert.match(pageText, /message\.content/);
  assert.match(pageText, /message\.command/);
  assert.match(pageText, /className = 'command'/);
  assert.match(pageText, /body\.classList\.add\('tool-content'\)/);
  assert.match(pageText, /const rawEventDetails =/);
  assert.match(pageText, /details\.open = false/);
  assert.match(pageText, /summary\.textContent = 'Raw event'/);
  assert.match(pageText, /card\.append\(rawEventDetails\(event\)\)/);
  assert.doesNotMatch(pageText, /hiddenFields|humanReadable|isIdentifier/);
  assert.doesNotMatch(pageText, /No readable details/);
  assert.doesNotMatch(pageScript, /existing\.textContent = message\.sessionTitle/);
  assert.match(pageText, /JSON\.stringify\(event, null, 2\)/);
  assert.doesNotMatch(pageText, /message\.sessionTitle \|\| event\.sessionID/);

  const pageWithSession = await fetch(`${origin}/?session=session-viewer`);
  assert.equal(pageWithSession.status, 200);
  assert.match(await pageWithSession.text(), /Balrog log events/);

  const event = {
    tag: "session.prompt",
    sessionID: "session-viewer",
    pluginID: "plugin-viewer",
    apiVersion: "v2",
    "session.prompt": { event: { text: "hello" } },
  } as unknown as LogEvent;
  analyzer.process(event);
  viewer.publish(event);

  const stream = await fetch(`${origin}/events`);
  assert.equal(
    stream.headers.get("Content-Type"),
    "text/event-stream; charset=utf-8",
  );
  const reader = stream.body?.getReader();
  assert.ok(reader);
  const chunk = await reader.read();
  const streamText = new TextDecoder().decode(chunk.value);
  assert.match(streamText, /session-viewer/);
  const streamMessage = JSON.parse(streamText.match(/data: (.+)\n\n/)![1]);
  assert.equal(streamMessage.content, "hello");
  await reader.cancel();

  const renamedEvent = {
    tag: "session.renamed",
    sessionID: "session-viewer",
    pluginID: "plugin-viewer",
    apiVersion: "v2",
    "session.renamed": {
      event: {
        type: "session.renamed",
        data: { sessionID: "session-viewer", title: "Viewer session" },
      },
    },
  } as unknown as LogEvent;
  analyzer.process(renamedEvent);
  viewer.publish(renamedEvent);
  const toolSuccessEvent = {
    tag: "session.tool.success",
    sessionID: "session-viewer",
    pluginID: "plugin-viewer",
    apiVersion: "v2",
    "session.tool.success": {
      type: "session.tool.success",
      data: {
        sessionID: "session-viewer",
        id: "call-1",
        content: [{ type: "text", text: "tool output" }],
      },
    },
  } as unknown as LogEvent;
  const toolCalledEvent = {
    tag: "session.tool.called",
    sessionID: "session-viewer",
    pluginID: "plugin-viewer",
    apiVersion: "v2",
    "session.tool.called": {
      type: "session.tool.called",
      data: {
        sessionID: "session-viewer",
        id: "call-1",
        input: { command: "npm test\n-- --verbose" },
      },
    },
  } as unknown as LogEvent;
  analyzer.process(toolCalledEvent);
  viewer.publish(toolCalledEvent);
  analyzer.process(toolSuccessEvent);
  viewer.publish(toolSuccessEvent);
  const replay = await fetch(`${origin}/events`);
  const replayReader = replay.body?.getReader();
  assert.ok(replayReader);
  const replayDecoder = new TextDecoder();
  let replayText = "";
  while ((replayText.match(/data: /g) ?? []).length < 4) {
    const replayChunk = await replayReader.read();
    assert.ok(!replayChunk.done, "event stream closed before replaying all events");
    replayText += replayDecoder.decode(replayChunk.value, { stream: true });
  }
  await replayReader.cancel();
  const replayMessages = replayText.split("\n\n").filter(Boolean).map((frame) =>
    JSON.parse(frame.slice("data: ".length)));
  assert.equal(replayMessages[0].content, "hello");
  assert.equal(Object.hasOwn(replayMessages[1], "content"), false);
  assert.equal(replayMessages[2].content, "npm test\n-- --verbose");
  assert.equal(replayMessages[2].command, "npm test");
  assert.equal(replayMessages[3].content, "tool output");
  assert.equal(replayMessages[3].command, "npm test");

  const session = await fetch(`${origin}/api/sessions/session-viewer`);
  assert.equal(session.status, 200);
  assert.equal((await session.json()).title, "Viewer session");
});

test("viewer replays every event loaded before a browser connects", async (t) => {
  const viewer = new LogViewer();
  await new Promise<void>((resolve) => viewer.listen(0, "localhost", resolve));
  t.after(() => viewer.close());

  const address = viewer.address();
  assert.ok(address && typeof address !== "string");
  const origin = `http://localhost:${address.port}`;
  for (let index = 0; index < 600; index += 1) {
    const sessionID = `session-${index}`;
    viewer.publish({
      tag: "session.execution.started",
      sessionID,
      pluginID: "plugin-viewer",
      apiVersion: "v2",
      "session.execution.started": { event: { data: { sessionID } } },
    } as unknown as LogEvent);
  }

  const response = await fetch(`${origin}/events`);
  const reader = response.body?.getReader();
  assert.ok(reader);
  const decoder = new TextDecoder();
  let streamText = "";
  while ((streamText.match(/data: /g) ?? []).length < 600) {
    const chunk = await reader.read();
    assert.ok(!chunk.done, "event stream closed before all saved events were replayed");
    streamText += decoder.decode(chunk.value, { stream: true });
  }
  await reader.cancel();

  assert.equal((streamText.match(/data: /g) ?? []).length, 600);
});
