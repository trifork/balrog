import type { ViewerMessage } from "../../shared/viewer-protocol";
import { collectActivity } from "./file-activity-model";

export interface AccessReason {
  key: string | null;
  label: string;
  explanation: string;
}

function reasonTitle(reason: string) {
  const first = reason.split(/(?<=[.!?])\s|\n/)[0].replace(/\s+/g, " ").trim();
  return first.length > 64 ? `${first.slice(0, 61).trimEnd()}…` : first;
}

export function reasonMap(events: ViewerMessage[], selectedSession: string) {
  const prompts = collectActivity(events, selectedSession);
  const latest = new Map<string, string | null>();
  for (const message of events) {
    if (!message.execution) continue;
    const sessionID = message.session?.sessionID ?? message.event.sessionID;
    latest.set(JSON.stringify([sessionID, message.execution.callID]), message.execution.reason?.trim() || null);
  }
  const reasons = new Map<string | null, AccessReason>();
  const promptEntries = prompts.map((prompt) => {
    const files = new Map<string, AccessReason[]>();
    for (const [path, touches] of prompt.files) {
      const entries = new Set<AccessReason>();
      for (const touch of touches) {
        const key = latest.get(JSON.stringify([prompt.activity.sessionID, touch.callID])) ?? null;
        let reason = reasons.get(key);
        if (!reason) {
          reason = {
            key, label: key ? reasonTitle(key) : "No recorded reason",
            explanation: key ?? "No reason was recorded for this file access. Calls after a retro snapshot cutoff are not covered by that assessment.",
          };
          reasons.set(key, reason);
        }
        entries.add(reason);
      }
      files.set(path, [...entries]);
    }
    return { prompt, files };
  });
  return { prompts: promptEntries };
}
