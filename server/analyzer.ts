import type { LogEvent } from "./log-receiver.js";
import { eventMetadata } from "./event-metadata.js";
import { SessionActivityAnalyzer, type SessionActivity } from "./session-activity.js";
import { SessionSkillAnalyzer, type SkillActivation } from "./session-skills.js";
import { OUTCOME_HINT_METADATA, OUTCOME_TOOL_ID } from "../plugin/shared/tracing.js";

export interface SessionSummary {
  sessionID: string;
  title?: string;
  pluginID?: string;
  apiVersion?: string;
  eventCount: number;
  lastEventTag: string;
  lastEventAt: number;
  tags: string[];
}

export interface ToolCallSummary {
  sessionID: string;
  callID: string;
  tool?: string;
  command?: string;
  input?: unknown;
}

export interface ToolExecution {
  callID: string;
  command: { name: string | null; args: unknown };
  startedAt: number | null;
  completedAt: number | null;
  reason: string | null;
  outcome: string | null;
  result: unknown;
}

interface MutableSessionSummary extends Omit<SessionSummary, "tags"> {
  tags: Set<string>;
}

function asObject(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function successfulResult(data: Record<string, unknown> | undefined, callID: string): unknown {
  const result = data?.["result"];
  if (result !== undefined && result !== null) return result;
  const content = data?.["content"] ?? data?.["output"] ?? null;
  const hint = asObject(asObject(data?.["metadata"])?.[OUTCOME_HINT_METADATA]);
  if (Array.isArray(content) && hint?.["callID"] === callID && typeof hint["text"] === "string") {
    const last = asObject(content.at(-1));
    if (last?.["type"] === "text" && last["text"] === hint["text"]) return content.slice(0, -1);
  }
  return content;
}

/** Accumulates queryable metadata from the stream of received log events. */
export class SessionAnalyzer {
  private readonly sessions = new Map<string, MutableSessionSummary>();
  private readonly toolCalls = new Map<string, ToolCallSummary>();
  private readonly activity = new SessionActivityAnalyzer();
  private readonly skills = new SessionSkillAnalyzer();
  private readonly toolNames = new Map<string, string>();
  private readonly executions = new Map<string, Map<string, ToolExecution>>();
  private readonly context = new Map<string, Map<string, string>>();

  getSessionID(event: LogEvent): string | undefined {
    const envelope = event as unknown as Record<string, unknown>;
    const tag = nonEmptyString(envelope["tag"]);
    const taggedPayload = tag ? asObject(envelope[tag]) : undefined;
    const nativeEvent = asObject(taggedPayload?.["event"]) ?? taggedPayload;
    const data = asObject(nativeEvent?.["data"]);
    return nonEmptyString(envelope["sessionID"])
      ?? nonEmptyString(data?.["sessionID"]);
  }

  process(event: LogEvent): void {
    this.activity.process(event);
    this.skills.process(event);
    const envelope = event as unknown as Record<string, unknown>;
    const tag = nonEmptyString(envelope["tag"]);
    if (!tag) return;

    const taggedPayload = asObject(envelope[tag]);
    const nativeEvent = asObject(taggedPayload?.["event"]) ?? taggedPayload;
    const data = asObject(nativeEvent?.["data"]);
    const sessionID = this.getSessionID(event);
    if (!sessionID) return;

    const now = eventMetadata(event).timestamp;
    let session = this.sessions.get(sessionID);
    if (!session) {
      session = {
        sessionID,
        pluginID: nonEmptyString(envelope["pluginID"]),
        apiVersion: nonEmptyString(envelope["apiVersion"]),
        eventCount: 0,
        lastEventTag: tag,
        lastEventAt: now,
        tags: new Set<string>(),
      };
      this.sessions.set(sessionID, session);
    }

    session.eventCount += 1;
    session.lastEventTag = tag;
    session.lastEventAt = Math.max(session.lastEventAt, now);
    if (now === session.lastEventAt) {
      this.sessions.delete(sessionID);
      this.sessions.set(sessionID, session);
    }
    session.tags.add(tag);
    session.pluginID = nonEmptyString(envelope["pluginID"]) ?? session.pluginID;
    session.apiVersion = nonEmptyString(envelope["apiVersion"]) ?? session.apiVersion;

    const title = this.extractTitle(tag, data);
    if (title) session.title = title;

    const messageID = nonEmptyString(data?.["assistantMessageID"]) ?? "";
    if (tag === "session.execution.started") this.context.delete(sessionID);
    if (tag === "session.text.ended" && data?.["role"] !== "user") {
      const text = nonEmptyString(data?.["text"]);
      if (text) {
        const messages = this.context.get(sessionID) ?? new Map<string, string>();
        messages.set(messageID, text);
        this.context.set(sessionID, messages);
      }
    }

    const callID = this.getCallID(data);
    if (callID) {
      const key = this.toolCallKey(sessionID, callID);
      const tool = nonEmptyString(data?.["name"])
        ?? nonEmptyString(data?.["tool"])
        ?? this.toolNames.get(key);
      if (tool === OUTCOME_TOOL_ID) {
        this.toolNames.set(key, tool);
        this.executions.get(sessionID)?.delete(callID);
        this.toolCalls.delete(key);
        return;
      }
    }
    if (tag === "balrog.tool.outcome" && callID) {
      const outcome = nonEmptyString(data?.["outcome"]);
      if (outcome) this.ensureExecution(sessionID, callID).outcome = outcome;
    }
    if (tag === "balrog.tool.intent" && callID) {
      const execution = this.ensureExecution(sessionID, callID);
      execution.reason = nonEmptyString(data?.["reason"]) ?? execution.reason;
      execution.command.name = nonEmptyString(data?.["tool"]) ?? execution.command.name;
    }
    if (tag === "session.tool.input.started" && callID) {
      const name = nonEmptyString(data?.["name"]);
      if (name) {
        const key = this.toolCallKey(sessionID, callID);
        this.toolNames.set(key, name);
        const call = this.toolCalls.get(key);
        if (call) call.tool = name;
        const execution = this.executions.get(sessionID)?.get(callID);
        if (execution) execution.command.name = name;
      }
    }

    if (tag === "session.tool.called") {
      if (callID) {
        const input = data?.["input"];
        const inputObject = asObject(input);
        const { __balrogReason: recordedReason, ...args } = inputObject ?? {};
        const tool = this.toolNames.get(this.toolCallKey(sessionID, callID))
          ?? nonEmptyString(data?.["name"])
          ?? nonEmptyString(data?.["tool"]);
        this.toolCalls.set(this.toolCallKey(sessionID, callID), {
          sessionID,
          callID,
          tool,
          command: nonEmptyString(data?.["command"])
            ?? nonEmptyString(inputObject?.["command"]),
          input,
        });
        const execution = this.ensureExecution(sessionID, callID);
        if (execution.startedAt === null) {
          execution.command = {
            name: tool ?? execution.command.name,
            args: inputObject ? args : input ?? null,
          };
          execution.startedAt = now;
          execution.reason = execution.reason
            ?? nonEmptyString(recordedReason)
            ?? nonEmptyString(data?.["reason"])
            ?? nonEmptyString(inputObject?.["description"])
            ?? this.context.get(sessionID)?.get(messageID)
            ?? null;
        }
      }
    }

    if ((tag === "session.tool.success" || tag === "session.tool.failed") && callID) {
      const execution = this.ensureExecution(sessionID, callID);
      execution.completedAt = now;
      execution.result = tag === "session.tool.failed"
        ? { error: data?.["error"] ?? null, content: data?.["content"] ?? null }
        : successfulResult(data, callID);
    }
  }

  getSessionTitle(sessionID: string): string | undefined {
    return this.sessions.get(sessionID)?.title;
  }

  getSessionActivity(sessionID: string): SessionActivity | undefined {
    return this.activity.getSession(sessionID);
  }

  getSession(sessionID: string): SessionSummary | undefined {
    const session = this.sessions.get(sessionID);
    return session ? this.toSummary(session) : undefined;
  }

  getSessions(): SessionSummary[] {
    return [...this.sessions.values()]
      .reverse()
      .sort((left, right) => right.lastEventAt - left.lastEventAt)
      .map((session) => this.toSummary(session));
  }

  getToolExecutions(sessionID: string): ToolExecution[] {
    return [...(this.executions.get(sessionID)?.values() ?? [])]
      .sort((left, right) => (right.startedAt ?? -Infinity) - (left.startedAt ?? -Infinity));
  }

  getSkillActivations(sessionID: string): SkillActivation[] {
    return this.skills.getActivations(sessionID);
  }

  getToolCall(event: LogEvent): ToolCallSummary | undefined {
    const envelope = event as unknown as Record<string, unknown>;
    const tag = nonEmptyString(envelope["tag"]);
    const taggedPayload = tag ? asObject(envelope[tag]) : undefined;
    const nativeEvent = asObject(taggedPayload?.["event"]) ?? taggedPayload;
    const data = asObject(nativeEvent?.["data"]);
    const sessionID = this.getSessionID(event);
    const callID = this.getCallID(data);
    if (!sessionID || !callID) return undefined;
    return this.toolCalls.get(this.toolCallKey(sessionID, callID));
  }

  getToolExecution(event: LogEvent): ToolExecution | undefined {
    const tag = event.tag;
    const payload = asObject((event as unknown as Record<string, unknown>)[tag]);
    const nativeEvent = asObject(payload?.["event"]) ?? payload;
    const sessionID = this.getSessionID(event);
    const callID = this.getCallID(asObject(nativeEvent?.["data"]));
    return sessionID && callID ? this.executions.get(sessionID)?.get(callID) : undefined;
  }

  private extractTitle(
    tag: string,
    data: Record<string, unknown> | undefined,
  ): string | undefined {
    if (tag !== "session.renamed" && tag !== "session.created") return undefined;

    const info = asObject(data?.["info"]);
    const session = asObject(data?.["session"]);
    return nonEmptyString(data?.["title"])
      ?? nonEmptyString(info?.["title"])
      ?? nonEmptyString(session?.["title"]);
  }

  private getCallID(data: Record<string, unknown> | undefined): string | undefined {
    return nonEmptyString(data?.["id"])
      ?? nonEmptyString(data?.["callID"])
      ?? nonEmptyString(data?.["toolCallID"]);
  }

  private toolCallKey(sessionID: string, callID: string): string {
    return `${sessionID}\0${callID}`;
  }

  private ensureExecution(sessionID: string, callID: string): ToolExecution {
    let executions = this.executions.get(sessionID);
    if (!executions) {
      executions = new Map<string, ToolExecution>();
      this.executions.set(sessionID, executions);
    }
    let execution = executions.get(callID);
    if (!execution) {
      execution = {
        callID,
        command: { name: this.toolNames.get(this.toolCallKey(sessionID, callID)) ?? null, args: null },
        startedAt: null,
        completedAt: null,
        reason: null,
        outcome: null,
        result: null,
      };
      executions.set(callID, execution);
    }
    return execution;
  }

  private toSummary(session: MutableSessionSummary): SessionSummary {
    return {
      ...session,
      tags: [...session.tags],
    };
  }
}
