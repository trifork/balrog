import type { LogEvent } from "./log-receiver.js";
import { asObject, eventMetadata, text } from "./event-metadata.js";

export interface ActivitySource {
  tag: string;
  eventID?: string;
  tool?: string;
}

export interface ActivityBase {
  id: string;
  /** Unix milliseconds. */
  timestamp: number;
  timestampSource: "event" | "recorded" | "received";
  source: ActivitySource;
  /** Only explicitly supplied explanations; never inferred model reasoning. */
  rationale?: { text: string; source: "rationale" | "description" };
}

export interface OperationActivity extends ActivityBase {
  status: "pending" | "completed" | "failed";
  completedAt?: number;
  error?: unknown;
}

export interface FileReadActivity extends OperationActivity {
  kind: "file.read";
  path: string;
  offset?: number;
  limit?: number;
}

export interface FileChangeActivity extends OperationActivity {
  kind: "file.change";
  path: string;
  /** Updated and modified are represented by the same action. */
  action: "created" | "modified" | "deleted";
  movedTo?: string;
}

export interface FileGrepActivity extends OperationActivity {
  kind: "file.grep";
  /** Search target, not a claim that every file beneath it was scanned. */
  scope?: string;
  pattern: string;
  include?: string;
  matchedFiles: string[];
}

export interface PromptActivity extends ActivityBase {
  kind: "prompt";
  text: string;
  files?: unknown[];
}

export type SessionActivityItem = FileReadActivity
  | FileChangeActivity | FileGrepActivity | PromptActivity;

export interface SessionActivity {
  schemaVersion: 1;
  sessionID: string;
  /** Chronological timeline; repeated operations remain separate items. */
  items: SessionActivityItem[];
}

interface Call {
  tool?: string;
  items: SessionActivityItem[];
}

/** Projects the recorded trace, without executing commands or reading project files. */
export class SessionActivityAnalyzer {
  private readonly sessions = new Map<string, SessionActivityItem[]>();
  private readonly calls = new Map<string, Call>();
  private readonly seen = new Set<string>();
  private sequence = 0;

  process(event: LogEvent): void {
    const meta = eventMetadata(event);
    const { sessionID, tag, native, payload } = meta;
    if (!sessionID) return;
    if (!this.sessions.has(sessionID)) this.sessions.set(sessionID, []);
    const eventID = text(native?.["id"]);
    if (eventID) {
      const key = `${sessionID}\0${eventID}`;
      if (this.seen.has(key)) return;
      this.seen.add(key);
    }
    const data = meta.data ?? asObject(payload?.["input"]) ?? {};
    const callID = text(data["callID"]) ?? text(data["toolCallID"]) ?? text(data["id"]);
    const key = `${sessionID}\0${callID}`;
    const base: ActivityBase = {
      id: eventID ?? `activity-${++this.sequence}`,
      timestamp: meta.timestamp,
      timestampSource: meta.timestampSource,
      source: { tag, eventID },
    };
    const add = (item: SessionActivityItem) => this.sessions.get(sessionID)!.push(item);

    if (tag === "session.tool.input.started") {
      this.calls.set(key, { tool: text(data["name"]), items: this.calls.get(key)?.items ?? [] });
      return;
    }

    if (tag === "session.tool.called" || tag === "tool.execute.before") {
      const previous = this.calls.get(key);
      if (previous?.items.length) return;
      const input = asObject(data["input"]) ?? asObject(asObject(payload?.["output"])?.["args"]) ?? {};
      const tool = text(data["tool"]) ?? previous?.tool;
      base.source.tool = tool;
      const rationale = text(input["rationale"]) ?? text(input["description"]);
      if (rationale) base.rationale = {
        text: rationale, source: text(input["rationale"]) ? "rationale" : "description",
      };
      const items = this.toolItems(base, tool, input);
      items.forEach(add);
      if (callID) this.calls.set(key, { tool, items });
      return;
    }

    if (tag === "session.tool.success" || tag === "session.tool.failed" || tag === "tool.execute.after") {
      const call = this.calls.get(key);
      if (!call) return;
      const metadata = asObject(data["metadata"]);
      const failed = tag === "session.tool.failed" || metadata?.["status"] === "error";
      for (const item of call.items) {
        if (!("status" in item)) continue;
        item.status = failed ? "failed" : "completed";
        item.completedAt = meta.timestamp;
        if (failed) item.error = data["error"];
        if (item.kind === "file.grep" && !failed) {
          const output = contentText(data["content"]);
          item.matchedFiles = matchedFiles(output);
        }
      }
      return;
    }

    if (tag === "session.inbox.enqueued") {
      const item = asObject(data["item"]);
      const prompt = asObject(item?.["payload"]);
      if (item?.["type"] === "user" && typeof prompt?.["text"] === "string") {
        add({ ...base, kind: "prompt", text: prompt["text"], files: Array.isArray(prompt["files"]) ? prompt["files"] : undefined });
      }
    } else if (tag === "chat.message") {
      const output = asObject(payload?.["output"]);
      add({ ...base, kind: "prompt", text: contentText(output?.["parts"]) });
    }
  }

  getSession(sessionID: string): SessionActivity | undefined {
    const items = this.sessions.get(sessionID);
    return items ? {
      schemaVersion: 1, sessionID,
      items: structuredClone([...items].sort((a, b) => a.timestamp - b.timestamp)),
    } : undefined;
  }

  private toolItems(base: ActivityBase, tool: string | undefined, input: Record<string, unknown>): SessionActivityItem[] {
    const operation = { ...base, status: "pending" as const };
    const name = tool?.split(/[._]/).at(-1);
    const path = text(input["filePath"]) ?? text(input["path"]);
    if (name === "read" && path) {
      return [{ ...operation, kind: "file.read", path,
        offset: typeof input["offset"] === "number" ? input["offset"] : undefined,
        limit: typeof input["limit"] === "number" ? input["limit"] : undefined }];
    }
    if (name === "grep" && text(input["pattern"])) {
      return [{ ...operation, kind: "file.grep", scope: path, pattern: String(input["pattern"]),
        include: text(input["include"]), matchedFiles: [] }];
    }
    if ((name === "edit" || name === "write") && path) {
      // A write can overwrite an existing file; do not claim creation without evidence.
      return [{ ...operation, kind: "file.change", path, action: "modified" }];
    }
    if (name === "patch") {
      const patch = text(input["patchText"]) ?? text(input["patch"]);
      if (!patch) return [];
      const changes: FileChangeActivity[] = [];
      for (const line of patch.split(/\r?\n/)) {
        const header = /^\*\*\* (Add|Update|Delete) File: (.+)$/.exec(line);
        if (header) changes.push({ ...operation, id: `${base.id}:${changes.length}`,
          kind: "file.change", path: header[2],
          action: header[1] === "Add" ? "created" : header[1] === "Delete" ? "deleted" : "modified" });
        const move = /^\*\*\* Move to: (.+)$/.exec(line);
        if (move && changes.length) changes.at(-1)!.movedTo = move[1];
      }
      return changes;
    }
    return [];
  }
}

function contentText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.flatMap((part) => {
    const value = asObject(part);
    return value?.["type"] === "text" && typeof value["text"] === "string" ? [value["text"]] : [];
  }).join("\n");
}

function matchedFiles(output: string): string[] {
  // OpenCode grep emits path headings followed by indented line previews.
  const lines = output.split(/\r?\n/);
  return [...new Set(lines.flatMap((line, index) => {
    const match = /^(\S.*):$/.exec(line);
    return match && /^\s+Line \d+:/.test(lines[index + 1] ?? "") ? [match[1]] : [];
  }))];
}
