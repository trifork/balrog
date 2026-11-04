import type { ToolExecution } from "../../server/analyzer";
import type { ViewerMessage } from "../../shared/viewer-protocol";

const object = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
const text = (value: unknown) => typeof value === "string" && value.trim() ? value.trim() : undefined;

interface Attempt {
  key: string;
  sessionID: string;
  promptKey?: string;
  execution: ToolExecution;
  completion?: ViewerMessage;
}

const toolCapabilities: Record<string, string> = {
  read: "Read file", readfile: "Read file",
  write: "Write file", writefile: "Write file", createfile: "Write file",
  edit: "Edit file", editfile: "Edit file", multiedit: "Edit files",
  patch: "Apply file patch", applypatch: "Apply file patch",
  glob: "Find files", grep: "Search file contents",
  shell: "Run shell command", bash: "Run shell command", powershell: "Run shell command",
  terminal: "Run shell command", exec: "Run shell command", runcommand: "Run shell command",
  execute: "Execute code", webfetch: "Fetch URL", websearch: "Search web",
  skill: "Load skill", question: "Ask user",
};

function capabilityLabel(execution: ToolExecution) {
  const assessed = text(execution.capability);
  if (assessed) return assessed.toLowerCase() === "unknown" ? "Unknown capability" : assessed;
  const tool = execution.command.name?.split(/[./:]|__/).at(-1)?.toLowerCase().replace(/[-_\s]/g, "");
  return tool && Object.hasOwn(toolCapabilities, tool) ? toolCapabilities[tool] : "Unknown capability";
}

function errorText(value: unknown): string | undefined {
  return text(value) ?? text(object(value)?.message) ?? text(object(object(value)?.data)?.message);
}

function outputText(value: unknown): string | undefined {
  if (typeof value === "string") return text(value);
  if (Array.isArray(value)) return value.map((part) => outputText(part)).filter(Boolean).join("\n") || undefined;
  const data = object(value);
  if (!data) return;
  return text(data.stderr) ?? text(data.text) ?? outputText(data.content)
    ?? outputText(data.output) ?? text(data.stdout) ?? outputText(data.result);
}

function exitCode(value: unknown): number | undefined {
  const data = object(value);
  if (!data) return;
  for (const code of [data.exitCode, data.exit_code, data.exit]) {
    if (typeof code === "number" && Number.isInteger(code)) return code;
  }
  return exitCode(data.metadata) ?? exitCode(data.result) ?? exitCode(data.output);
}

function eventData(message: ViewerMessage | undefined) {
  if (!message) return;
  const envelope = message.event as unknown as Record<string, unknown>;
  const payload = object(envelope[String(envelope.tag)]);
  const native = object(payload?.event) ?? payload;
  return object(native?.data) ?? native;
}

function result(attempt: Attempt) {
  const { execution } = attempt;
  const data = eventData(attempt.completion);
  const result = object(data?.result) ?? object(execution.result);
  const error = errorText(data?.error) ?? errorText(result?.error);
  const output = outputText(data) ?? outputText(execution.result);
  const tool = execution.command.name?.split(/[./:]|__/).at(-1)?.toLowerCase();
  const runsCode = Boolean(text(object(execution.command.args)?.command))
    || /^(?:shell|bash|powershell|terminal|exec|execute|runcommand)$/.test(tool ?? "");
  const marker = runsCode ? output?.match(/^(?:Process\s+)?exited with code\s+(-?\d+)\.?\s*$/im) : undefined;
  const code = exitCode(data) ?? exitCode(execution.result) ?? (marker ? Number(marker[1]) : undefined);
  const failed = String(attempt.completion?.event.tag) === "session.tool.failed";
  if (failed || error || result?.isError === true || data?.isError === true || (code !== undefined && code !== 0)) {
    const message = error ?? output ?? (code !== undefined && code !== 0 ? `Command exited with code ${code}` : "Tool call failed");
    return { status: "error", text: `error: ${message.replace(/^error:\s*/i, "")}` };
  }
  if (!attempt.completion && execution.completedAt === null) return { status: "pending", text: "Pending" };
  return { status: "ok", text: "ok" };
}

export function toolUsage(events: ViewerMessage[], selectedSession: string) {
  const attempts = new Map<string, Attempt>();
  for (const message of events) {
    const execution = message.execution;
    if (!execution) continue;
    const sessionID = message.session?.sessionID ?? message.event.sessionID ?? "";
    if (selectedSession && selectedSession !== sessionID) continue;
    const key = JSON.stringify([sessionID, execution.callID]);
    const previous = attempts.get(key);
    attempts.set(key, {
      key, sessionID, execution,
      promptKey: message.activityUpdates?.items.find((item) => item.kind === "prompt" && item.phase === "active" && item.eventIDs.includes(message.id))?.id ?? previous?.promptKey,
      completion: ["session.tool.success", "session.tool.failed"].includes(String(message.event.tag)) ? message : previous?.completion,
    });
  }
  return [...attempts.values()]
    .filter(({ execution }) => execution.command.name?.split(/[./:]|__/).at(-1) !== "balrog_reportOutcome")
    .sort((a, b) => (a.execution.startedAt ?? Infinity) - (b.execution.startedAt ?? Infinity))
    .map((attempt) => {
      const { execution } = attempt;
      const args = object(execution.command.args);
      return {
        key: attempt.key, sessionID: attempt.sessionID, promptKey: attempt.promptKey,
        capability: capabilityLabel(execution),
        tool: execution.command.name ?? "Unknown tool",
        command: text(args?.command) ?? `${execution.command.name ?? "Unknown tool"} ${JSON.stringify(execution.command.args, null, 2) ?? "null"}`,
        result: result(attempt),
      };
    });
}

export function groupToolUsage(attempts: ReturnType<typeof toolUsage>) {
  const groups = new Map<string, { tool: string; invocations: typeof attempts }>();
  for (const attempt of attempts) {
    const key = attempt.tool;
    const group = groups.get(key) ?? { tool: attempt.tool, invocations: [] };
    group.invocations.push(attempt);
    groups.set(key, group);
  }
  const failed = (attempt: typeof attempts[number]) => attempt.result.status === "error";
  return [...groups.values()]
    .map((group) => ({ ...group, invocations: group.invocations.sort((a, b) => Number(failed(b)) - Number(failed(a))) }))
    .sort((a, b) => Number(b.invocations.some(failed)) - Number(a.invocations.some(failed)));
}
