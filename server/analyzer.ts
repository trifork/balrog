import type { LogEvent } from "./log-receiver.js";

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

/** Accumulates queryable metadata from the stream of received log events. */
export class SessionAnalyzer {
  private readonly sessions = new Map<string, MutableSessionSummary>();
  private readonly toolCalls = new Map<string, ToolCallSummary>();

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
    const envelope = event as unknown as Record<string, unknown>;
    const tag = nonEmptyString(envelope["tag"]);
    if (!tag) return;

    const taggedPayload = asObject(envelope[tag]);
    const nativeEvent = asObject(taggedPayload?.["event"]) ?? taggedPayload;
    const data = asObject(nativeEvent?.["data"]);
    const sessionID = this.getSessionID(event);
    if (!sessionID) return;

    const now = Date.now();
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
    session.lastEventAt = now;
    session.tags.add(tag);
    session.pluginID = nonEmptyString(envelope["pluginID"]) ?? session.pluginID;
    session.apiVersion = nonEmptyString(envelope["apiVersion"]) ?? session.apiVersion;

    const title = this.extractTitle(tag, data);
    if (title) session.title = title;

    if (tag === "session.tool.called") {
      const callID = this.getCallID(data);
      if (callID) {
        const input = data?.["input"];
        const inputObject = asObject(input);
        this.toolCalls.set(this.toolCallKey(sessionID, callID), {
          sessionID,
          callID,
          tool: nonEmptyString(data?.["tool"]),
          command: nonEmptyString(data?.["command"])
            ?? nonEmptyString(inputObject?.["command"]),
          input,
        });
      }
    }
  }

  getSessionTitle(sessionID: string): string | undefined {
    return this.sessions.get(sessionID)?.title;
  }

  getSession(sessionID: string): SessionSummary | undefined {
    const session = this.sessions.get(sessionID);
    return session ? this.toSummary(session) : undefined;
  }

  getSessions(): SessionSummary[] {
    return [...this.sessions.values()]
      .sort((left, right) => right.lastEventAt - left.lastEventAt)
      .map((session) => this.toSummary(session));
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

  private toSummary(session: MutableSessionSummary): SessionSummary {
    return {
      ...session,
      tags: [...session.tags],
    };
  }
}
