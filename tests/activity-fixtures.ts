import type { PromptActivity as TrackedPrompt } from "../server/file-activity.js";
import type { SessionActivityItem, SessionActivityUpdate } from "../shared/activity-protocol.js";

/** Build canonical wire fixtures while keeping UI scenarios readable. */
export function createActivityUpdates() {
  const retained = new Map<string, SessionActivityItem>();
  const touches = new Map<string, string>();
  return (eventID: number, ...prompts: TrackedPrompt[]): SessionActivityUpdate => {
    const items: SessionActivityItem[] = [];
    const removedIDs: string[] = [];
    for (const prompt of prompts) {
      const id = JSON.stringify(["test", prompt.sessionID, prompt.id]);
      const previous = retained.get(id);
      const base = {
        id, timestamp: previous?.timestamp ?? 1_700_000_000_000 + eventID,
        timestampSource: "recorded" as const, source: { tag: "session.prompt", pluginID: "test" },
        startEventID: previous?.startEventID ?? eventID,
        eventIDs: [...new Set([...(previous?.eventIDs ?? []), eventID])],
      };
      items.push({ ...base, kind: "prompt", phase: "active", text: prompt.text });
      const present = new Set<string>();
      for (const touch of prompt.files) {
        const key = JSON.stringify([id, touch.callID, touch.path, touch.action]);
        if (present.has(key)) continue;
        present.add(key);
        const previousTouch = retained.get(key);
        const changed = touches.get(key) !== JSON.stringify(touch);
        const operation = {
          ...base, id: key, promptID: id, path: touch.path,
          source: { tag: "session.tool.called", pluginID: "test", callID: touch.callID },
          startEventID: previousTouch?.startEventID ?? eventID,
          eventIDs: [...new Set([...(previousTouch?.eventIDs ?? []), ...(changed ? [eventID] : [])])],
          status: touch.outcome === "success" ? "completed" as const : touch.outcome === "failed" ? "failed" as const : "pending" as const,
        };
        items.push(touch.action === "read" ? { ...operation, kind: "file.read" } : {
          ...operation, kind: "file.change",
          action: touch.action === "written" ? "modified" : touch.action,
          operation: touch.action === "written" ? "written" : undefined, reverted: touch.reverted,
        });
        touches.set(key, JSON.stringify(touch));
      }
      for (const item of retained.values()) {
        if ((item.kind === "file.change" || item.kind === "file.read") && item.promptID === id && !present.has(item.id)) removedIDs.push(item.id);
      }
    }
    for (const item of items) retained.set(item.id, item);
    for (const id of removedIDs) retained.delete(id);
    return { sessionID: prompts[0].sessionID, items, ...(removedIDs.length ? { removedIDs } : {}) };
  };
}
