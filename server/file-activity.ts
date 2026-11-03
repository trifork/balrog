import { posix } from "node:path";
import type { LogEvent } from "./log-receiver.js";

type FileAction = "read" | "modified" | "written" | "created" | "deleted";
type Outcome = "pending" | "success" | "failed";

export interface FileTouch {
  path: string;
  action: FileAction;
  outcome: Outcome;
  callID: string;
  reverted?: boolean;
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
  messages: Map<string, number>;
  messageID?: string;
  history: RecordedChange[];
  staged: Map<RecordedChange, boolean>;
  revertStaged: boolean;
}

interface Replacement {
  before: string;
  after: string;
  anchor: string;
  all: boolean;
}

interface RecordedChange {
  prompt: PromptActivity;
  file: FileTouch;
  messageID?: string;
  edits?: Replacement[];
  undoReverted: boolean;
}

interface ToolCall {
  tool?: string;
  prompt?: PromptActivity;
  messageID?: string;
}

type ExtractedFile = Pick<FileTouch, "path" | "action"> & { edits?: Replacement[] };

function normalizePath(value: string, root?: string): string {
  const path = posix.normalize(value.replaceAll("\\", "/"));
  const base = root ? posix.normalize(root.replaceAll("\\", "/")).replace(/\/$/, "") : undefined;
  return base && path.startsWith(`${base}/`) ? path.slice(base.length + 1) : path;
}

function replacement(args: Record<string, unknown> | undefined): Replacement | undefined {
  const before = args?.oldString ?? args?.old_string;
  const after = args?.newString ?? args?.new_string;
  if (typeof before !== "string" || typeof after !== "string" || before === after) return undefined;
  return { before, after, anchor: "replace", all: args?.replaceAll === true || args?.replace_all === true };
}

function patchEdits(lines: string[]): Replacement[] | undefined {
  const edits: Replacement[] = [];
  let before: string[] = [];
  let after: string[] = [];
  let anchor = "patch:";
  const flush = () => {
    if (before.join("\n") !== after.join("\n")) {
      edits.push({ before: before.join("\n"), after: after.join("\n"), anchor, all: false });
    }
    before = [];
    after = [];
  };
  for (const line of lines) {
    if (line.startsWith("@@")) {
      flush();
      anchor = `patch:${line.slice(2)}`;
    } else if (line.startsWith(" ")) {
      before.push(line.slice(1));
      after.push(line.slice(1));
    } else if (line.startsWith("-")) {
      before.push(line.slice(1));
    } else if (line.startsWith("+")) {
      after.push(line.slice(1));
    } else if (line && line !== "*** End of File" && line !== "*** End Patch") {
      return undefined;
    }
  }
  flush();
  return edits.length ? edits : undefined;
}

/** Tracks explicit file-tool activity; shell commands are deliberately not inferred. */
export class FileActivityTracker {
  private sequence = 0;
  private readonly sessions = new Map<string, SessionActivity>();
  private readonly inbox = new Map<string, string>();
  private readonly calls = new Map<string, ToolCall>();
  private readonly edits = new WeakMap<FileTouch, Replacement[]>();
  private readonly roots = new Map<string, string>();
  private updates: PromptActivity[] = [];

  processAll(event: LogEvent): PromptActivity[] {
    this.process(event);
    return this.updates;
  }

  process(event: LogEvent): PromptActivity | undefined {
    this.updates = [];
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
      session = {
        awaitingExecution: false, executing: false, fallback: false,
        messages: new Map(), history: [], staged: new Map(), revertStaged: false,
      };
      this.sessions.set(scope, session);
    }
    const snapshot = (prompt: PromptActivity) => {
      const copy = structuredClone(prompt);
      this.updates.push(copy);
      return copy;
    };
    const root = text(object(native?.location)?.directory) ?? this.roots.get(pluginID);
    if (tag.startsWith("session.revert.")) {
      const changed = this.revert(session, tag, data, root);
      return [...changed].map(snapshot)[0];
    }
    const messageID = text(data?.assistantMessageID) ?? text(data?.messageID)
      ?? (tag === "session.inbox.delivered" ? text(data?.inboxID) : undefined);
    if (messageID) {
      if (!session.messages.has(messageID)) session.messages.set(messageID, session.messages.size);
      session.messageID = messageID;
    }
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
      this.calls.set(key, { tool: text(data?.name), prompt: session.current, messageID: session.messageID });
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
    const call: ToolCall = {
      tool, prompt,
      messageID: previous?.messageID ?? messageID ?? session.messageID,
    };
    this.calls.set(key, call);
    const outcome: Outcome = tag === "session.tool.failed" ? "failed" : after ? "success" : "pending";
    if (before || !prompt.files.some((file) => file.callID === callID)) {
      for (const { edits, ...file } of this.extractFiles(tool, args, root)) {
        if (!prompt.files.some((existing) => existing.callID === callID && existing.path === file.path && existing.action === file.action)) {
          const touch = { ...file, callID, outcome };
          prompt.files.push(touch);
          if (edits) this.edits.set(touch, edits);
        }
      }
    }
    const changed = new Set([prompt]);
    if (after) {
      if (tool?.toLowerCase() === "read" && partsText(data?.content)?.startsWith("Read directory ")) {
        prompt.files = prompt.files.filter((file) => file.callID !== callID);
      }
      for (const file of prompt.files) {
        if (file.callID !== callID) continue;
        file.outcome = outcome;
        if (outcome === "success" && file.action !== "read" && !session.history.some((change) => change.file === file)) {
          const change: RecordedChange = {
            prompt, file, messageID: call.messageID, edits: this.edits.get(file),
            undoReverted: false,
          };
          this.detectInverse(session.history, change, changed);
          session.history.push(change);
        }
      }
      this.calls.delete(key);
    }
    return [...changed].map(snapshot)[0];
  }

  private detectInverse(history: RecordedChange[], change: RecordedChange, changed: Set<PromptActivity>): void {
    const edits = change.edits;
    if (!edits) return;
    let before = edits.map((edit) => edit.before);
    const chain = [change];
    for (let index = history.length - 1; index >= 0; index--) {
      const previous = history[index];
      if (previous.file.path !== change.file.path || previous.file.reverted) continue;
      if (!previous.edits || previous.edits.length !== edits.length
        || !previous.edits.every((edit, position) => edit.after === before[position]
          && edit.anchor === edits[position].anchor && edit.all === edits[position].all)) break;
      chain.push(previous);
      before = previous.edits.map((edit) => edit.before);
      if (!edits.every((edit, position) => edit.after === before[position])) continue;
      for (const reversed of chain) {
        reversed.file.reverted = true;
        changed.add(reversed.prompt);
      }
      return;
    }
  }

  private revert(
    session: SessionActivity,
    tag: string,
    data: Record<string, unknown> | undefined,
    root: string | undefined,
  ): Set<PromptActivity> {
    const finish = () => {
      const previous = session.history.map((change) => Boolean(change.file.reverted));
      const changed = new Set<PromptActivity>();
      const history: RecordedChange[] = [];
      for (const change of session.history) {
        if (change.undoReverted) change.file.reverted = true;
        else delete change.file.reverted;
      }
      // Undoing a reversing edit can make the original change active again.
      for (const change of session.history) {
        if (!change.undoReverted) this.detectInverse(history, change, new Set());
        history.push(change);
      }
      for (const [index, change] of session.history.entries()) {
        if (previous[index] !== Boolean(change.file.reverted)) changed.add(change.prompt);
      }
      return changed;
    };
    if (tag === "session.revert.cleared") {
      for (const [change, previous] of session.staged) change.undoReverted = previous;
      session.staged.clear();
      session.revertStaged = false;
      return finish();
    }
    if (tag === "session.revert.committed" && session.revertStaged) {
      session.staged.clear();
      session.revertStaged = false;
      return new Set();
    }
    if (tag !== "session.revert.staged" && tag !== "session.revert.committed") return new Set();
    const info = object(data?.revert);
    const target = text(info?.messageID) ?? text(data?.to);
    const boundary = target ? session.messages.get(target) : undefined;
    if (boundary === undefined) {
      if (tag === "session.revert.staged") session.revertStaged = true;
      return new Set();
    }
    const partID = text(info?.partID);
    const part = partID ? session.history.findIndex((change) => change.messageID === target && change.file.callID === partID) : -1;
    const files = Array.isArray(info?.files)
      ? new Set(info.files.flatMap((file) => {
        const path = text(object(file)?.file);
        return path ? [normalizePath(path, root)] : [];
      })) : undefined;
    for (const [change, previous] of session.staged) change.undoReverted = previous;
    session.staged.clear();
    session.revertStaged = tag === "session.revert.staged";
    for (const [index, change] of session.history.entries()) {
      const order = change.messageID ? session.messages.get(change.messageID) : undefined;
      if (order === undefined || order < boundary || (files && !files.has(change.file.path))) continue;
      if (order === boundary && partID && (part < 0 || index < part)) continue;
      if (tag === "session.revert.staged") session.staged.set(change, change.undoReverted);
      change.undoReverted = true;
    }
    return finish();
  }

  private extractFiles(
    tool: string | undefined,
    args: Record<string, unknown> | undefined,
    root: string | undefined,
  ): ExtractedFile[] {
    const name = tool?.toLowerCase();
    const action: FileAction | undefined = name === "read" ? "read"
      : name === "edit" || name === "multiedit" ? "modified"
      : name === "write" ? "written" : undefined;
    if (action) {
      const path = text(args?.filePath) ?? text(args?.file_path) ?? text(args?.path);
      if (!path) return [];
      const single = replacement(args);
      const multiple = Array.isArray(args?.edits) ? args.edits.map((edit) => replacement(object(edit))) : [];
      const edits = single ? [single] : multiple.length && multiple.every((edit) => edit !== undefined) ? multiple : undefined;
      return [{ path: normalizePath(path, root), action, edits: action === "modified" ? edits : undefined }];
    }
    if (name !== "apply_patch" && name !== "patch") return [];
    const patch = text(args?.patchText) ?? text(args?.patch);
    if (!patch) return [];
    const files: ExtractedFile[] = [];
    let current: ExtractedFile | undefined;
    let lines: string[] = [];
    const flush = () => {
      if (current?.action === "modified") current.edits = patchEdits(lines);
      lines = [];
    };
    for (const line of patch.split(/\r?\n/)) {
      const match = /^\*\*\* (Add|Update|Delete) File: (.+)$/.exec(line);
      if (match) {
        flush();
        current = {
          path: normalizePath(match[2], root),
          action: match[1] === "Add" ? "created" : match[1] === "Delete" ? "deleted" : "modified",
        };
        files.push(current);
        continue;
      }
      const move = /^\*\*\* Move to: (.+)$/.exec(line);
      if (move && files.length) {
        files[files.length - 1].action = "deleted";
        files.push({ path: normalizePath(move[1], root), action: "created" });
        current = undefined;
      } else {
        lines.push(line);
      }
    }
    flush();
    return files;
  }
}
