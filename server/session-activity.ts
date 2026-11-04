import type { LogEvent } from "./log-receiver.js";
import { asObject, eventMetadata, text } from "./event-metadata.js";
import { FileActivityTracker, type PromptActivity as TrackedPrompt } from "./file-activity.js";
import {
  applyActivityUpdate,
  type ActivityBase,
  type FileGrepActivity,
  type PromptActivity,
  type SessionActivity,
  type SessionActivityItem,
  type SessionActivityUpdate,
} from "../shared/activity-protocol.js";

export type * from "../shared/activity-protocol.js";

interface Call {
  tool?: string;
  input: Record<string, unknown>;
  base: ActivityBase;
  eventIDs: number[];
  completed?: boolean;
  root?: string;
}

/** One projection supplies HTTP, live updates, and historical activity replay. */
export class SessionActivityAnalyzer {
  private readonly tracker = new FileActivityTracker();
  private heatmaps: SessionActivity[] = [];
  private readonly calls = new Map<string, Call>();
  private readonly promptIDs = new Map<string, string>();
  private readonly touchStates = new Map<string, string>();
  private readonly updates = new WeakMap<LogEvent, SessionActivityUpdate>();
  private readonly seen = new Set<string>();
  private sequence = 0;

  process(event: LogEvent): void {
    const eventReference = ++this.sequence;
    const meta = eventMetadata(event);
    const { sessionID, tag, native, payload } = meta;
    if (!sessionID) {
      this.tracker.processAll(event);
      return;
    }
    const pluginID = text(meta.envelope["pluginID"]) ?? "";
    const eventID = text(native?.["id"]);
    const scope = JSON.stringify([pluginID, sessionID]);
    if (eventID) {
      const key = JSON.stringify([scope, eventID]);
      if (this.seen.has(key)) return;
      this.seen.add(key);
    }
    const data = meta.data ?? {};
    const input = asObject(payload?.["input"]);
    const callID = text(data["callID"]) ?? text(data["toolCallID"]) ?? text(data["id"]) ?? text(input?.["callID"]);
    const callKey = JSON.stringify([scope, callID]);
    const messageID = text(data["assistantMessageID"]) ?? text(data["messageID"]);
    const workspaceRoot = this.tracker.getWorkspaceRoot(pluginID, text(asObject(native?.["location"])?.["directory"]));
    const base: ActivityBase = {
      id: eventID ?? JSON.stringify([pluginID, sessionID, "event", eventReference]),
      timestamp: meta.timestamp, timestampSource: meta.timestampSource,
      source: { tag, pluginID, eventID, messageID },
      startEventID: eventReference, eventIDs: [eventReference],
      ...(workspaceRoot ? { workspaceRoot } : {}),
    };
    const items = new Map(this.heatmaps.find((entry) => entry.sessionID === sessionID)?.items.map((item) => [item.id, item]));
    const changed = new Map<string, SessionActivityItem>();
    const removedIDs: string[] = [];
    const save = (item: SessionActivityItem) => {
      items.set(item.id, item);
      changed.set(item.id, item);
    };
    const inboxID = text(data["inboxID"]);
    const queuedID = JSON.stringify([pluginID, sessionID, "inbox", inboxID ?? eventID ?? eventReference]);
    if (tag === "session.inbox.enqueued") {
      const item = asObject(data["item"]);
      const prompt = asObject(item?.["payload"]);
      if (item?.["type"] === "user") {
        save({
          ...base, id: queuedID, kind: "prompt", phase: "queued",
          text: typeof prompt?.["text"] === "string" ? prompt["text"] : "(File-only prompt)",
          files: Array.isArray(prompt?.["files"]) ? prompt["files"] : undefined,
        });
      }
    }
    let call = this.calls.get(callKey);
    const before = tag === "session.tool.called" || tag === "tool.execute.before";
    const after = tag === "session.tool.success" || tag === "session.tool.failed" || tag === "tool.execute.after";
    if (callID && (tag === "session.tool.input.started" || before || after)) {
      if (!call || call.completed && !after) {
        call = { base, input: {}, eventIDs: [] };
        this.calls.set(callKey, call);
      }
      call.eventIDs.push(eventReference);
      call.root = text(asObject(native?.["location"])?.["directory"]) ?? call.root;
      const callWorkspaceRoot = this.tracker.getWorkspaceRoot(pluginID, call.root);
      if (callWorkspaceRoot && !call.base.workspaceRoot) call.base = { ...call.base, workspaceRoot: callWorkspaceRoot };
      call.tool = text(data["name"]) ?? text(data["tool"]) ?? text(input?.["tool"]) ?? call.tool;
      if (before) {
        call.input = asObject(data["input"]) ?? asObject(asObject(payload?.["output"])?.["args"]) ?? asObject(input?.["args"]) ?? {};
        call.base = {
          ...base,
          ...(callWorkspaceRoot ? { workspaceRoot: callWorkspaceRoot } : {}),
          source: { ...base.source, callID, tool: call.tool, messageID: messageID ?? call.base.source.messageID },
        };
        const rationale = text(call.input["rationale"]) ?? text(call.input["description"]);
        if (rationale) call.base.rationale = {
          text: rationale, source: text(call.input["rationale"]) ? "rationale" : "description",
        };
      }
    }
    const snapshots = this.tracker.processAll(event);
    for (const snapshot of snapshots) {
      let promptID = this.promptIDs.get(snapshot.id);
      if (!promptID) {
        promptID = tag === "session.inbox.delivered" && inboxID && items.has(queuedID) ? queuedID : snapshot.id;
        this.promptIDs.set(snapshot.id, promptID);
      }
      const previous = items.get(promptID);
      const queued = tag === "session.inbox.delivered" && inboxID ? items.get(queuedID) : undefined;
      if (queued?.kind === "prompt" && queued.id !== promptID) {
        items.delete(queued.id);
        changed.delete(queued.id);
        removedIDs.push(queued.id);
      }
      const prompt: PromptActivity = {
        ...(previous?.kind === "prompt" ? previous : base),
        id: promptID, kind: "prompt", phase: "active", text: snapshot.text,
        ...(queued?.kind === "prompt" ? { files: queued.files } : {}),
        timestamp: previous?.kind === "prompt" && previous.phase === "active" ? previous.timestamp : meta.timestamp,
        timestampSource: previous?.kind === "prompt" && previous.phase === "active" ? previous.timestampSource : meta.timestampSource,
        // Delivery, not queue admission, is the prompt's playback boundary.
        startEventID: previous?.kind === "prompt" && previous.phase === "active" ? previous.startEventID : eventReference,
        eventIDs: [...new Set([...(previous?.eventIDs ?? []), ...(queued?.eventIDs ?? []), eventReference])],
      };
      save(prompt);
      this.projectFiles(snapshot, prompt, items, save, removedIDs, eventReference, scope, after ? call : undefined, data, meta.timestamp);
      if (call && (before || after) && call.tool?.split(/[._]/).at(-1)?.toLowerCase() === "grep") {
        const id = JSON.stringify([promptID, callID, "grep"]);
        const previousGrep = items.get(id);
        const pattern = text(call.input["pattern"]);
        if (pattern) {
          const grep: FileGrepActivity = {
            ...call.base, id, promptID, kind: "file.grep",
            eventIDs: [...call.eventIDs], status: after ? tag === "session.tool.failed" ? "failed" : "completed" : "pending",
            pattern, scope: text(call.input["path"]), include: text(call.input["include"]),
            matchedFiles: previousGrep?.kind === "file.grep" ? previousGrep.matchedFiles : [],
          };
          if (after) {
            grep.completedAt = meta.timestamp;
            if (tag === "session.tool.failed" || asObject(data["metadata"])?.["status"] === "error") {
              grep.status = "failed";
              grep.error = data["error"];
            } else {
              grep.matchedFiles = [...new Set(matchedFiles(contentText(data["content"]))
                .map((path) => this.tracker.normalizeFilePath(path, pluginID, call.root)))];
            }
          }
          save(grep);
        }
      }
      if (after && call) call.completed = true;
    }
    const update: SessionActivityUpdate = {
      sessionID, items: structuredClone([...changed.values()]),
      ...(removedIDs.length ? { removedIDs } : {}),
    };
    if (changed.size || removedIDs.length) {
      this.heatmaps = applyActivityUpdate(this.heatmaps, update);
      this.updates.set(event, update);
    } else if (!this.heatmaps.some((entry) => entry.sessionID === sessionID)) {
      this.heatmaps.push({ schemaVersion: 2, sessionID, items: [] });
    }
  }

  private projectFiles(
    snapshot: TrackedPrompt,
    prompt: PromptActivity,
    items: Map<string, SessionActivityItem>,
    save: (item: SessionActivityItem) => void,
    removedIDs: string[],
    eventReference: number,
    scope: string,
    completedCall: Call | undefined,
    data: Record<string, unknown>,
    timestamp: number,
  ): void {
    const retained = new Set<string>();
    for (const touch of snapshot.files) {
      const id = JSON.stringify([prompt.id, touch.callID, touch.path, touch.action]);
      retained.add(id);
      const previous = items.get(id);
      const call = this.calls.get(JSON.stringify([scope, touch.callID]));
      const state = JSON.stringify(touch);
      const changed = this.touchStates.get(id) !== state;
      const eventIDs = [...new Set([
        ...(previous?.eventIDs ?? []), ...(call?.eventIDs ?? []), ...(changed ? [eventReference] : []),
      ])];
      if (!changed && previous && eventIDs.length === previous.eventIDs.length) continue;
      const base = previous ?? call?.base ?? prompt;
      const workspaceRoot = base.workspaceRoot ?? call?.base.workspaceRoot;
      const operation = {
        ...base, id, promptID: prompt.id, path: touch.path, eventIDs,
        ...(workspaceRoot ? { workspaceRoot } : {}),
        source: { ...base.source, callID: touch.callID },
        status: touch.outcome === "success" ? "completed" as const : touch.outcome === "failed" ? "failed" as const : "pending" as const,
      };
      const item: SessionActivityItem = touch.action === "read"
        ? { ...operation, kind: "file.read",
          offset: typeof call?.input["offset"] === "number" ? call.input["offset"] : undefined,
          limit: typeof call?.input["limit"] === "number" ? call.input["limit"] : undefined }
        : { ...operation, kind: "file.change",
          action: touch.action === "written" ? "modified" : touch.action,
          operation: touch.action === "written" ? "written" : undefined, reverted: touch.reverted };
      if (completedCall === call && touch.outcome !== "pending") {
        item.completedAt = timestamp;
        if (touch.outcome === "failed") item.error = data["error"];
      }
      this.touchStates.set(id, state);
      save(item);
    }
    for (const item of items.values()) {
      if ((item.kind === "file.read" || item.kind === "file.change") && item.promptID === prompt.id && !retained.has(item.id)) {
        items.delete(item.id);
        removedIDs.push(item.id);
        this.touchStates.delete(item.id);
      }
    }
  }

  getSession(sessionID: string): SessionActivity | undefined {
    const heatmap = this.heatmaps.find((entry) => entry.sessionID === sessionID);
    return heatmap ? structuredClone(heatmap) : undefined;
  }

  getSessions(): SessionActivity[] {
    return structuredClone(this.heatmaps);
  }

  getUpdates(event: LogEvent): SessionActivityUpdate | undefined {
    const update = this.updates.get(event);
    return update ? structuredClone(update) : undefined;
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
  const lines = output.split(/\r?\n/);
  return [...new Set(lines.flatMap((line, index) => {
    const match = /^(\S.*):$/.exec(line);
    return match && /^\s+Line \d+:/.test(lines[index + 1] ?? "") ? [match[1]] : [];
  }))];
}
