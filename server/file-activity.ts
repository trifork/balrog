import { posix } from "node:path";
import type { LogEvent } from "./log-receiver.js";

type FileAction = "read" | "modified" | "written" | "created" | "deleted";
type Outcome = "pending" | "success" | "failed";

export interface FileTouch {
  path: string;
  action: FileAction;
  outcome: Outcome;
  callID: string;
}

export interface PromptActivity {
  id: string;
  sessionID: string;
  text: string;
  files: FileTouch[];
}

function object(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function partsText(value: unknown): string | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.map((part) => text(object(part)?.text) ?? "").filter(Boolean).join("\n") || undefined;
}

interface SessionActivity {
  current?: PromptActivity;
  awaitingExecution: boolean;
  executing: boolean;
  fallback: boolean;
}

/** Tracks explicit file-tool activity; shell commands are deliberately not inferred. */
export class FileActivityTracker {
  private sequence = 0;
  private readonly sessions = new Map<string, SessionActivity>();
  private readonly inbox = new Map<string, string>();
  private readonly calls = new Map<string, { tool?: string; prompt?: PromptActivity }>();
  private readonly roots = new Map<string, string>();

  process(event: LogEvent): PromptActivity | undefined {
    const envelope = object(event)!;
    const tag = text(envelope.tag);
    if (!tag) return undefined;
    const payload = object(envelope[tag]);
    const native = object(payload?.event) ?? payload;
    const data = object(native?.data) ?? native;
    const pluginID = text(envelope.pluginID) ?? "";
    if (tag === "initialize") {
      const context = object(payload?.context);
      const root = text(object(context?.location)?.directory) ?? text(context?.directory);
      if (root) this.roots.set(pluginID, root);
      return undefined;
    }
    const sessionID = text(envelope.sessionID) ?? text(data?.sessionID);
    if (!sessionID) return undefined;
    const scope = JSON.stringify([pluginID, sessionID]);
    let session = this.sessions.get(scope);
    if (!session) {
      session = { awaitingExecution: false, executing: false, fallback: false };
      this.sessions.set(scope, session);
    }
    const snapshot = (prompt: PromptActivity) => structuredClone(prompt);
    const start = (label: string, fallback = false) => {
      session.current = { id: String(++this.sequence), sessionID, text: label, files: [] };
      session.fallback = fallback;
      return session.current;
    };
    const inboxID = text(data?.inboxID);
    if (tag === "session.inbox.enqueued" && inboxID) {
      const item = object(data?.item);
      if (item?.type === "user") {
        this.inbox.set(JSON.stringify([scope, inboxID]), text(object(item.payload)?.text) ?? "(File-only prompt)");
      }
      return undefined;
    }
    if (tag === "session.inbox.delivered" && inboxID) {
      const key = JSON.stringify([scope, inboxID]);
      const label = this.inbox.get(key);
      this.inbox.delete(key);
      if (!label) return undefined;
      session.awaitingExecution = !session.executing;
      if (session.fallback && session.current && session.current.files.length === 0) {
        session.current.text = label;
        session.fallback = false;
        return snapshot(session.current);
      }
      return snapshot(start(label));
    }
    if (tag === "chat.message" || tag === "session.prompt") {
      const output = object(payload?.output);
      const label = text(data?.text) ?? partsText(data?.parts) ?? partsText(output?.parts) ?? "(Prompt text unavailable)";
      session.awaitingExecution = !session.executing;
      return snapshot(start(label));
    }
    if (tag === "session.execution.started") {
      session.executing = true;
      if (session.awaitingExecution) {
        session.awaitingExecution = false;
        return undefined;
      }
      return snapshot(start("Execution (prompt text unavailable)", true));
    }
    if (tag === "session.execution.succeeded" || tag === "session.execution.failed") {
      session.executing = false;
      session.awaitingExecution = false;
      return undefined;
    }

    const input = object(payload?.input);
    const callID = text(data?.id) ?? text(data?.callID) ?? text(input?.callID);
    if (!callID) return undefined;
    const key = JSON.stringify([scope, callID]);
    const previous = this.calls.get(key);
    if (tag === "session.tool.input.started") {
      this.calls.set(key, { tool: text(data?.name), prompt: session.current });
      return undefined;
    }
    const before = tag === "session.tool.called" || tag === "tool.execute.before";
    const after = tag === "session.tool.success" || tag === "session.tool.failed" || tag === "tool.execute.after";
    if (!before && !after) return undefined;
    const tool = text(data?.tool) ?? text(input?.tool) ?? previous?.tool;
    const args = tag.startsWith("tool.execute.")
      ? object(object(payload?.output)?.args) ?? object(input?.args)
      : object(data?.input);
    let prompt = previous?.prompt ?? session.current;
    if (!prompt) prompt = start("Unattributed activity (prompt not recorded)");
    this.calls.set(key, { tool, prompt });
    const outcome: Outcome = tag === "session.tool.failed" ? "failed" : after ? "success" : "pending";
    if (before || !prompt.files.some((file) => file.callID === callID)) {
      const root = text(object(native?.location)?.directory) ?? this.roots.get(pluginID);
      for (const file of this.extractFiles(tool, args, root)) {
        if (!prompt.files.some((existing) => existing.callID === callID && existing.path === file.path && existing.action === file.action)) {
          prompt.files.push({ ...file, callID, outcome });
        }
      }
    }
    if (after) {
      if (tool?.toLowerCase() === "read" && partsText(data?.content)?.startsWith("Read directory ")) {
        prompt.files = prompt.files.filter((file) => file.callID !== callID);
      }
      for (const file of prompt.files) {
        if (file.callID === callID) file.outcome = outcome;
      }
      this.calls.delete(key);
    }
    return snapshot(prompt);
  }

  private extractFiles(
    tool: string | undefined,
    args: Record<string, unknown> | undefined,
    root: string | undefined,
  ): Array<{ path: string; action: FileAction }> {
    const normalize = (value: string) => {
      const path = posix.normalize(value.replaceAll("\\", "/"));
      const base = root ? posix.normalize(root.replaceAll("\\", "/")).replace(/\/$/, "") : undefined;
      return base && path.startsWith(`${base}/`) ? path.slice(base.length + 1) : path;
    };
    const name = tool?.toLowerCase();
    const action: FileAction | undefined = name === "read" ? "read"
      : name === "edit" || name === "multiedit" ? "modified"
      : name === "write" ? "written" : undefined;
    if (action) {
      const path = text(args?.filePath) ?? text(args?.file_path) ?? text(args?.path);
      return path ? [{ path: normalize(path), action }] : [];
    }
    if (name !== "apply_patch" && name !== "patch") return [];
    const patch = text(args?.patchText) ?? text(args?.patch);
    if (!patch) return [];
    const files: Array<{ path: string; action: FileAction }> = [];
    for (const line of patch.split(/\r?\n/)) {
      const match = /^\*\*\* (Add|Update|Delete) File: (.+)$/.exec(line);
      if (match) files.push({
        path: normalize(match[2]),
        action: match[1] === "Add" ? "created" : match[1] === "Delete" ? "deleted" : "modified",
      });
      const move = /^\*\*\* Move to: (.+)$/.exec(line);
      if (move && files.length) {
        files[files.length - 1].action = "deleted";
        files.push({ path: normalize(move[1]), action: "created" });
      }
    }
    return files;
  }
}
