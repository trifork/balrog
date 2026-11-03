import { SessionAnalyzer } from "./analyzer.js";
import { eventMetadata } from "./event-metadata.js";
import type { LogEvent } from "./log-receiver.js";

/** A read-only replay of one session, including evidence from before compaction. */
export function conversationSnapshot(records: LogEvent[], sessionID: string, before?: number) {
  const sessionEvents = records.filter((event) => eventMetadata(event).sessionID === sessionID);
  const timestamp = (event: LogEvent) => {
    const meta = eventMetadata(event);
    return meta.timestampSource === "received" ? undefined : meta.timestamp;
  };
  const events = sessionEvents
    .filter((event) => before === undefined || timestamp(event) === undefined || timestamp(event)! < before)
    .sort((left, right) => (timestamp(left) ?? Infinity) - (timestamp(right) ?? Infinity));
  // Replay only the selected evidence, not the live analyzer's later results.
  const analyzer = new SessionAnalyzer();
  for (const event of events) analyzer.process(event);
  // The live analyzer can use receipt time. A historical export must not assign
  // the time of this HTTP request to events whose original time is unknown.
  const started = new Set<string>();
  for (const event of events) {
    const execution = analyzer.getToolExecution(event);
    if (!execution) continue;
    if (event.tag === "session.tool.called" && !started.has(execution.callID)) {
      execution.startedAt = timestamp(event) ?? null;
      started.add(execution.callID);
    }
    if (event.tag === "session.tool.success" || event.tag === "session.tool.failed") {
      execution.completedAt = timestamp(event) ?? null;
    }
  }
  const pluginIDs = new Set(events.map((event) => event.pluginID));
  const contexts = records.filter((event) => event.tag === "initialize" && pluginIDs.has(event.pluginID)
    && (before === undefined || timestamp(event) === undefined || timestamp(event)! < before));
  return {
    sessionID,
    events,
    executions: analyzer.getToolExecutions(sessionID)
      .sort((left, right) => (left.startedAt ?? Infinity) - (right.startedAt ?? Infinity)),
    recording: {
      source: "recorded-events",
      limits: "Only events received by Balrog are available. Earlier or unrecorded conversation, attachment contents, and hidden model reasoning may be unavailable.",
      before: before ?? null,
      unknownTimestampEvents: events.filter((event) => timestamp(event) === undefined).length,
      excludedByCutoff: sessionEvents.length - events.length,
      contexts,
    },
  };
}
