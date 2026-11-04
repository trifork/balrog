import type { IncomingMessage, ServerResponse } from "node:http";
import type { SessionAnalyzer } from "./analyzer.js";
import type { ToolAssessmentLog } from "./log-receiver.js";

interface Assessment { callID: string; reason: string; outcome: string; capability?: string }

function isAssessment(value: unknown): value is Assessment {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const entry = value as Record<string, unknown>;
  return ["callID", "reason", "outcome"].every((key) => typeof entry[key] === "string" && entry[key].trim())
    && (!Object.hasOwn(entry, "capability") || (typeof entry.capability === "string" && Boolean(entry.capability.trim())));
}

/** Accept a validated retrospective batch; raw tool events remain untouched. */
export async function receiveAssessments(
  request: IncomingMessage, response: ServerResponse, encodedSessionID: string,
  analyzer: SessionAnalyzer, record: (event: ToolAssessmentLog) => void,
): Promise<void> {
  const reply = (status: number, body: object) => {
    response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
    response.end(JSON.stringify(body));
  };
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    reply(405, { error: "Method not allowed" });
    return;
  }
  if (request.headers.origin) {
    try {
      const origin = new URL(request.headers.origin);
      if (!["http:", "https:"].includes(origin.protocol) || origin.host !== request.headers.host) throw new Error();
    } catch {
      reply(403, { error: "Forbidden origin" });
      return;
    }
  }
  if (request.headers["content-type"]?.split(";", 1)[0]?.trim().toLowerCase() !== "application/json") {
    reply(415, { error: "Expected application/json" });
    return;
  }
  let sessionID: string;
  try { sessionID = decodeURIComponent(encodedSessionID); }
  catch { reply(400, { error: "Invalid session ID" }); return; }
  if (!analyzer.getSession(sessionID)) {
    reply(404, { error: "Session not found" });
    return;
  }
  let body: unknown;
  try {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of request) {
      const buffer = Buffer.from(chunk);
      size += buffer.length;
      if (size > 1_048_576) { reply(413, { error: "Assessment batch exceeds 1 MiB" }); return; }
      chunks.push(buffer);
    }
    body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch { reply(400, { error: "Invalid JSON or incomplete request" }); return; }
  const assessments: unknown = body && typeof body === "object" && !Array.isArray(body)
    ? (body as Record<string, unknown>)["assessments"] : undefined;
  if (!Array.isArray(assessments) || !assessments.every(isAssessment)) {
    reply(400, { error: "Expected assessments containing non-empty callID, reason and outcome strings; capability must be a non-empty string when supplied" });
    return;
  }
  const calls = new Map(analyzer.getToolExecutions(sessionID).map((execution) => [execution.callID, execution]));
  if (new Set(assessments.map((entry) => entry.callID)).size !== assessments.length) {
    reply(400, { error: "Duplicate callID in assessment batch" });
    return;
  }
  if (assessments.some((entry) => !calls.has(entry.callID))) {
    reply(404, { error: "Tool call not found in target session" });
    return;
  }
  try {
    for (const { callID, reason, outcome, capability } of assessments) {
      const created = Date.now();
      record({
        tag: "balrog.tool.assessed", sessionID, pluginID: "balrog-retro", apiVersion: "v2", created,
        "balrog.tool.assessed": { type: "balrog.tool.assessed", created, data: {
          sessionID, id: callID, reason, outcome, ...(capability === undefined ? {} : { capability }),
        } },
      });
    }
    reply(200, { sessionID, updated: assessments.length });
  } catch { reply(500, { error: "Unable to record assessments" }); }
}
