import { eventMetadata, text } from "../../server/event-metadata";
import type { ViewerMessage } from "../../shared/viewer-protocol";
import type { ActivityPrompt } from "./file-activity-model";

export interface SubagentStart {
  sessionID: string;
  parentID: string;
  label: string;
  timestamp?: number;
  startEventID: number;
}

/** Number distinct child sessions by creation time, never by their latest activity. */
export function collectSubagentStarts(events: ViewerMessage[]): SubagentStart[] {
  const starts = new Map<string, SubagentStart>();
  for (const message of events) {
    const metadata = eventMetadata(message.event, message.id);
    if (metadata.tag !== "session.created") continue;
    const sessionID = metadata.sessionID;
    const parentID = text(metadata.data?.["parentID"]);
    if (!sessionID || !parentID || sessionID === parentID || starts.has(sessionID)) continue;
    starts.set(sessionID, {
      sessionID, parentID, label: "", timestamp: metadata.timestampSource === "received" ? undefined : metadata.timestamp, startEventID: message.id,
    });
  }
  const counts = new Map<string, number>();
  return [...starts.values()].sort((a, b) => a.timestamp !== undefined && b.timestamp !== undefined
    ? a.timestamp - b.timestamp || a.startEventID - b.startEventID : a.startEventID - b.startEventID)
    .map((start) => {
      const number = (counts.get(start.parentID) ?? 0) + 1;
      counts.set(start.parentID, number);
      return { ...start, label: `S${number}` };
    });
}

/** Associate starts only with prompts in their parent, respecting historical playback. */
export function subagentsByPrompt(prompts: ActivityPrompt[], starts: SubagentStart[], cutoffEventID?: number) {
  const result = new Map<string, SubagentStart[]>();
  for (const start of starts) {
    if (cutoffEventID !== undefined && start.startEventID > cutoffEventID) continue;
    const prompt = prompts.filter((prompt) => prompt.activity.sessionID === start.parentID
      && (prompt.timestamp === undefined || start.timestamp === undefined ? prompt.startEventID <= start.startEventID
        : prompt.timestamp < start.timestamp || (prompt.timestamp === start.timestamp && prompt.startEventID <= start.startEventID)))
      .sort((a, b) => a.timestamp !== undefined && b.timestamp !== undefined
        ? b.timestamp - a.timestamp || b.startEventID - a.startEventID : b.startEventID - a.startEventID)[0];
    if (!prompt) continue;
    const children = result.get(prompt.key) ?? [];
    children.push(start);
    result.set(prompt.key, children);
  }
  return result;
}
