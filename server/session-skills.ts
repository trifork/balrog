import type { LogEvent } from "./log-receiver.js";
import { asObject, eventMetadata, text } from "./event-metadata.js";

export interface SkillActivation {
  id: string;
  name: string;
  activatedAt: number;
  timestampSource: "event" | "recorded" | "received";
  source: "prompt" | "tool" | "native";
  inboxID?: string;
  callID?: string;
  eventID?: string;
}

type Observation = Pick<SkillActivation, "activatedAt" | "timestampSource" | "eventID">;
type Skill = Pick<SkillActivation, "id" | "name">;

interface SkillCall {
  tool?: string;
  skill?: Skill;
  completion?: Observation;
  succeeded?: boolean;
}

interface SkillInbox {
  skills?: Skill[];
  delivery?: Observation;
}

interface SessionSkills {
  calls: Map<string, SkillCall>;
  inbox: Map<string, SkillInbox>;
  native: SkillActivation[];
  seen: Set<string>;
}

const skillTags = new Set([
  "session.skill.activated", "session.inbox.enqueued", "session.inbox.delivered",
  "session.tool.input.started", "session.tool.called", "session.tool.success", "session.tool.failed",
  "tool.execute.before", "tool.execute.after",
]);

/** Observed loads, not a claim that instructions remain active or are followed. */
export class SessionSkillAnalyzer {
  private readonly sessions = new Map<string, SessionSkills>();

  process(event: LogEvent): void {
    const meta = eventMetadata(event);
    const { sessionID, tag, native, payload } = meta;
    if (!sessionID || !skillTags.has(tag)) return;
    let session = this.sessions.get(sessionID);
    if (!session) {
      session = { calls: new Map(), inbox: new Map(), native: [], seen: new Set() };
      this.sessions.set(sessionID, session);
    }
    const eventID = text(native?.["id"]);
    if (eventID) {
      if (session.seen.has(eventID)) return;
      session.seen.add(eventID);
    }
    const observation: Observation = {
      activatedAt: meta.timestamp, timestampSource: meta.timestampSource,
      ...(eventID ? { eventID } : {}),
    };
    const data = meta.data ?? asObject(payload?.["input"]) ?? {};
    if (tag === "session.skill.activated") {
      const skill = skillIdentity(data);
      if (skill) session.native.push({ ...skill, ...observation, source: "native" });
      return;
    }
    if (tag.startsWith("session.inbox.")) {
      const inboxID = text(data["inboxID"]);
      if (!inboxID) return;
      const inbox = session.inbox.get(inboxID) ?? {};
      session.inbox.set(inboxID, inbox);
      if (tag === "session.inbox.delivered") {
        inbox.delivery ??= observation;
      } else {
        const item = asObject(data["item"]);
        const skills = asObject(item?.["payload"])?.["skills"];
        if (item?.["type"] === "user" && Array.isArray(skills)) {
          inbox.skills ??= skills.flatMap((value) => {
            const skill = skillIdentity(asObject(value));
            return skill ? [skill] : [];
          });
        }
      }
      return;
    }
    const callID = text(data["callID"]) ?? text(data["toolCallID"]) ?? text(data["id"]);
    if (!callID) return;
    const call = session.calls.get(callID) ?? {};
    session.calls.set(callID, call);
    call.tool = text(data["name"]) ?? text(data["tool"]) ?? call.tool;
    if (tag === "session.tool.called" || tag === "tool.execute.before") {
      const input = asObject(data["input"]) ?? asObject(asObject(payload?.["output"])?.["args"]);
      call.skill ??= skillIdentity(input);
    }
    if (tag === "session.tool.success" || tag === "session.tool.failed" || tag === "tool.execute.after") {
      if (!call.completion) {
        call.completion = observation;
        const metadata = asObject(data["metadata"]) ?? asObject(asObject(payload?.["output"])?.["metadata"]);
        call.succeeded = tag !== "session.tool.failed" && metadata?.["status"] !== "error";
      }
    }
  }

  getActivations(sessionID: string): SkillActivation[] {
    const session = this.sessions.get(sessionID);
    if (!session) return [];
    const skills = [...session.native];
    for (const [inboxID, inbox] of session.inbox) {
      if (!inbox.delivery) continue;
      const seen = new Set<string>();
      for (const skill of inbox.skills ?? []) {
        if (seen.has(skill.id)) continue;
        seen.add(skill.id);
        skills.push({ ...skill, ...inbox.delivery, source: "prompt", inboxID });
      }
    }
    for (const [callID, call] of session.calls) {
      if (call.tool?.split(/[._]/).at(-1) === "skill" && call.skill && call.succeeded && call.completion) {
        skills.push({ ...call.skill, ...call.completion, source: "tool", callID });
      }
    }
    return structuredClone(skills.sort((a, b) => b.activatedAt - a.activatedAt));
  }
}

function skillIdentity(value: Record<string, unknown> | undefined): Skill | undefined {
  const id = text(value?.["id"]) ?? text(value?.["name"]);
  return id ? { id, name: text(value?.["name"]) ?? id } : undefined;
}
