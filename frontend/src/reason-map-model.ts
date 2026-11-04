import type { ViewerMessage } from "../../shared/viewer-protocol";
import { collectActivity } from "./file-activity-model";

export interface AccessReason {
  key: string | null;
  label: string;
  explanation: string;
  outcomes: string[];
  callIDs: string[];
}

function reasonTitle(reason: string) {
  const first = reason.split(/(?<=[.!?])\s|\n/)[0].replace(/\s+/g, " ").trim();
  return first.length > 64 ? `${first.slice(0, 61).trimEnd()}…` : first;
}

export function reasonMap(events: ViewerMessage[], selectedSession: string) {
  const prompts = collectActivity(events, selectedSession);
  const latest = new Map<string, { reason: string | null; outcome: string | null }>();
  for (const message of events) {
    if (!message.execution) continue;
    const sessionID = message.session?.sessionID ?? message.event.sessionID;
    latest.set(JSON.stringify([sessionID, message.execution.callID]), {
      reason: message.execution.reason?.trim() || null,
      outcome: message.execution.outcome?.trim() || null,
    });
  }
  const promptEntries = prompts.map((prompt) => {
    const files = new Map<string, AccessReason[]>();
    for (const [path, touches] of prompt.files) {
      const entries = new Map<string | null, AccessReason>();
      for (const touch of touches) {
        const execution = latest.get(JSON.stringify([prompt.activity.sessionID, touch.callID]));
        const key = execution?.reason ?? null;
        let reason = entries.get(key);
        if (!reason) {
          reason = {
            key, label: key ? reasonTitle(key) : "No recorded reason",
            explanation: key ?? "No reason was recorded for this file access. Calls after a retro snapshot cutoff are not covered by that assessment.",
            outcomes: [],
            callIDs: [],
          };
          entries.set(key, reason);
        }
        if (execution?.outcome && !reason.outcomes.includes(execution.outcome)) reason.outcomes.push(execution.outcome);
        if (!reason.callIDs.includes(touch.callID)) reason.callIDs.push(touch.callID);
      }
      files.set(path, [...entries.values()]);
    }
    return { prompt, files };
  });
  return { prompts: promptEntries };
}
