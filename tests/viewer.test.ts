import assert from "node:assert/strict";
import { test } from "node:test";
import { SessionAnalyzer } from "../server/analyzer.js";
import type { LogEvent } from "../server/log-receiver.js";
import { LogViewer } from "../server/viewer.js";

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
