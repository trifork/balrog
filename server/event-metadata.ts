import type { LogEvent } from "./log-receiver.js";

export function asObject(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

export function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

export function eventMetadata(event: LogEvent, receivedAt = Date.now()) {
  const envelope = event as unknown as Record<string, unknown>;
  const tag = text(envelope["tag"]) ?? "";
  const payload = asObject(envelope[tag]);
  const native = asObject(payload?.["event"]) ?? payload;
  const data = asObject(native?.["data"]);
  const isTimestamp = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
  const source = isTimestamp(native?.["created"]) ? native["created"] : envelope["created"];
  return {
    envelope, tag, payload, native, data,
    timestamp: isTimestamp(source) ? source : receivedAt,
    timestampSource: isTimestamp(native?.["created"]) ? "event" as const
      : isTimestamp(envelope["created"]) ? "recorded" as const : "received" as const,
    sessionID: text(envelope["sessionID"]) ?? text(data?.["sessionID"]),
  };
}
