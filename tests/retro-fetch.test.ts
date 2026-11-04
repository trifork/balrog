import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { test, type TestContext } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);
const script = fileURLToPath(new URL("../skills/retro/scripts/fetch-session.mjs", import.meta.url));

async function endpoint(t: TestContext, body: unknown, status = 200) {
  const requests: string[] = [];
  const server = createServer((request, response) => {
    requests.push(request.url ?? "");
    response.writeHead(status, { "Content-Type": "application/json" });
    response.end(JSON.stringify(body));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  return { requests, baseURL: `http://127.0.0.1:${address.port}` };
}

test("retro retrieval always supplies a session and preserves evidence while sorting startedAt ascending", async (t) => {
  const payload = {
    sessionID: "ses_fixture",
    events: [{ tag: "session.text.ended", "session.text.ended": { data: { text: "Check the build" } } }],
    recording: { source: "recorded-events", before: null, unknownTimestampEvents: 1, excludedByCutoff: 0 },
    executions: [
      { callID: "late", startedAt: 30, createdAt: 1, reason: "Check the build", outcome: "Build passed" },
      { callID: "early", startedAt: 10, createdAt: 999, capability: "Read file", reason: "Inspect A | B.\nSuitability is not verified.", outcome: "Found \"CandidateA\"; not verified." },
      { callID: "tie", startedAt: 10, reason: "Read guidance", outcome: null },
      { callID: "unknown", startedAt: null, reason: null, outcome: null },
    ],
  };
  const { requests, baseURL } = await endpoint(t, payload);
  const { stdout } = await run(process.execPath, [script, "--session", "ses_fixture", "--base-url", baseURL]);
  const result = JSON.parse(stdout);
  assert.deepEqual(requests, ["/api/sessions/ses_fixture/conversation"]);
  assert.deepEqual(result.events, payload.events);
  assert.deepEqual(result.recording, payload.recording);
  assert.deepEqual(result.executions.map((entry: { callID: string }) => entry.callID), ["early", "tie", "late", "unknown"]);
  assert.deepEqual(result.executions[0], payload.executions[1]);
  assert.equal(result.executions[1].outcome, null);
});

test("retro retrieval requests one server-side cutoff for the whole conversation", async (t) => {
  const { requests, baseURL } = await endpoint(t, {
    events: [], recording: { source: "recorded-events", before: 20, excludedByCutoff: 2, unknownTimestampEvents: 1 },
    sessionID: "ses_fixture", executions: [
      { callID: "before", startedAt: 10 },
      { callID: "unknown", startedAt: null },
    ],
  });
  const { stdout } = await run(process.execPath, [script, "--session", "ses_fixture", "--base-url", baseURL, "--before", "20"]);
  const result = JSON.parse(stdout);
  assert.deepEqual(result.executions.map((entry: { callID: string }) => entry.callID), ["before", "unknown"]);
  assert.deepEqual(requests, ["/api/sessions/ses_fixture/conversation?before=20"]);
  assert.equal(result.recording.excludedByCutoff, 2);
});

test("retro retrieval reports unknown sessions rather than falling back to the latest", async (t) => {
  const { requests, baseURL } = await endpoint(t, { error: "Session not found" }, 404);
  await assert.rejects(run(process.execPath, [script, "--session", "ses_missing", "--base-url", baseURL]),
    (error: unknown) => error instanceof Error && "stderr" in error && /404/.test(String(error.stderr)));
  assert.deepEqual(requests, ["/api/sessions/ses_missing/conversation"]);
});

test("retro retrieval rejects a mismatched session and malformed execution records", async (t) => {
  for (const payload of [
    { sessionID: "ses_other", executions: [] },
    { sessionID: "ses_fixture", executions: [null] },
    { sessionID: "ses_fixture", executions: [] },
    { sessionID: "ses_fixture", executions: [], events: [null], recording: { source: "recorded-events", before: null } },
    { sessionID: "ses_fixture", executions: [], events: [], recording: { source: "recorded-events", before: 123 } },
  ]) {
    const { requests, baseURL } = await endpoint(t, payload);
    await assert.rejects(run(process.execPath, [script, "--session", "ses_fixture", "--base-url", baseURL]));
    assert.deepEqual(requests, ["/api/sessions/ses_fixture/conversation"]);
  }
});

test("retro retrieval refuses to guess a session when no ID is supplied", async () => {
  await assert.rejects(run(process.execPath, [script]),
    (error: unknown) => error instanceof Error && "stderr" in error && /Supply --session/.test(String(error.stderr)));
});
