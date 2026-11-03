import type { LogEvent } from "./log-receiver.js";

export function eventContent(event: LogEvent): string | undefined {
  const envelope = event as unknown as Record<string, unknown>;
  const tag = typeof envelope["tag"] === "string" ? envelope["tag"] : "";
  if (
    tag !== "session.tool.called" &&
    tag !== "session.tool.success" &&
    !/(prompt|message|session\.text\.(?:ended|delta)|session\.synthetic)/i.test(tag)
  ) {
    return undefined;
  }

  let payload = envelope[tag];
  if (payload && typeof payload === "object" && "event" in payload) {
    payload = (payload as Record<string, unknown>)["event"];
  }
  const data = payload && typeof payload === "object" && "data" in payload
    ? (payload as Record<string, unknown>)["data"]
    : payload;
  const dataObject = data && typeof data === "object"
    ? data as Record<string, unknown>
    : undefined;
  const payloadObject = payload && typeof payload === "object"
    ? payload as Record<string, unknown>
    : undefined;
  const result = dataObject?.["result"];
  const resultObject = result && typeof result === "object"
    ? result as Record<string, unknown>
    : undefined;
  const input = dataObject?.["input"];
  const inputObject = input && typeof input === "object"
    ? input as Record<string, unknown>
    : undefined;
  const content = tag === "session.tool.called"
    ? dataObject?.["command"] ?? inputObject?.["command"] ?? payloadObject?.["command"]
    : dataObject?.["text"]
      ?? dataObject?.["content"]
      ?? dataObject?.["output"]
      ?? dataObject?.["parts"]
      ?? resultObject?.["content"]
      ?? result
      ?? payloadObject?.["content"];

  let rendered: string | undefined;
  if (typeof content === "string") rendered = content || undefined;
  if (Array.isArray(content)) {
    rendered = content.map((part) => {
      if (typeof part === "string") return part;
      if (!part || typeof part !== "object") return "";
      const partText = (part as Record<string, unknown>)["text"];
      return typeof partText === "string" ? partText : "";
    }).filter(Boolean).join("\n") || undefined;
  }
  if (rendered === undefined && content !== undefined && content !== null) {
    rendered = typeof content === "object" ? JSON.stringify(content, null, 2) : String(content);
  }
  return rendered;
}
