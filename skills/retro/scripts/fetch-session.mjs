import { parseArgs } from "node:util";

async function main() {
  const { values } = parseArgs({
    options: {
      session: { type: "string" },
      "base-url": { type: "string", default: "http://localhost:5001" },
      before: { type: "string" },
    },
    allowPositionals: false,
    strict: true,
  });
  if (!values.session || !/^ses_[A-Za-z0-9_-]+$/.test(values.session)) {
    throw new Error("Supply --session <session-id>. Resolve the current session from runtime context, not Balrog's latest session.");
  }
  const before = values.before === undefined ? undefined : Number(values.before);
  if (before !== undefined && (!Number.isSafeInteger(before) || before < 0)) {
    throw new Error("--before must be a non-negative Unix-millisecond timestamp.");
  }
  const baseURL = values["base-url"].endsWith("/") ? values["base-url"] : `${values["base-url"]}/`;
  const url = new URL(`api/sessions/${encodeURIComponent(values.session)}/conversation`, baseURL);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
    throw new Error("--base-url must be an HTTP(S) URL without embedded credentials.");
  }
  if (before !== undefined) url.searchParams.set("before", String(before));
  const response = await fetch(url, { signal: AbortSignal.timeout(10_000), redirect: "error" });
  if (!response.ok) throw new Error(`Balrog returned HTTP ${response.status} for session ${values.session}. No other session was selected.`);
  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new Error("Balrog did not return valid JSON.");
  }
  if (payload?.sessionID !== values.session) throw new Error("Balrog returned a different or missing session ID.");
  if (!Array.isArray(payload.events) || payload.events.some((event) =>
    !event || typeof event !== "object" || Array.isArray(event) || typeof event.tag !== "string")
    || payload.recording?.source !== "recorded-events" || payload.recording.before !== (before ?? null)) {
    throw new Error("Balrog returned an invalid conversation snapshot or cutoff.");
  }
  if (!Array.isArray(payload.executions) || payload.executions.some((entry) =>
    !entry || typeof entry !== "object" || Array.isArray(entry) || typeof entry.callID !== "string" || !entry.callID.trim())) {
    throw new Error("Balrog returned an invalid executions array.");
  }
  const startedAt = (entry) => typeof entry.startedAt === "number" && Number.isFinite(entry.startedAt)
    ? entry.startedAt : undefined;
  const executions = payload.executions
    .slice()
    .sort((left, right) => {
      const a = startedAt(left) ?? Infinity;
      const b = startedAt(right) ?? Infinity;
      return a === b ? 0 : a < b ? -1 : 1;
    });
  console.log(JSON.stringify({
    ...payload,
    executions,
    review: {
      fetchedAt: new Date().toISOString(),
      cutoffBefore: before ?? null,
    },
  }, null, 2));
}

main().catch((error) => {
  console.error(`Balrog retro: ${error instanceof Error ? error.message : "Unable to read the session."}`);
  process.exitCode = 1;
});
