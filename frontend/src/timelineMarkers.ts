import { eventKind } from "./EventCard";
import type { ReceivedEvent } from "./useViewer";

type TimelineIcon = "hammer" | "fileEdit" | "filePlus" | "fileMinus" | "terminal" | "prompt";
type FileIcon = Extract<TimelineIcon, "fileEdit" | "filePlus" | "fileMinus">;

export interface TimelineMarker {
  icon?: TimelineIcon;
  label: string;
  color: string;
  summary: string;
  isPrompt: boolean;
}

const icons: Record<TimelineIcon, { label: string; color: string }> = {
  hammer: { label: "Tool call", color: "#e6b479" },
  fileEdit: { label: "File edit", color: "#9bbbe6" },
  filePlus: { label: "File creation", color: "#8acba4" },
  fileMinus: { label: "File deletion", color: "#ed8e8e" },
  terminal: { label: "Command execution", color: "#e6b479" },
  prompt: { label: "User prompt", color: "#b7a0e9" },
};

const operations: Record<string, FileIcon> = {
  add: "filePlus", added: "filePlus", create: "filePlus", created: "filePlus", creation: "filePlus",
  edit: "fileEdit", edited: "fileEdit", update: "fileEdit", updated: "fileEdit", modify: "fileEdit", modified: "fileEdit", change: "fileEdit", changed: "fileEdit",
  delete: "fileMinus", deleted: "fileMinus", deletion: "fileMinus", remove: "fileMinus", removed: "fileMinus", unlink: "fileMinus",
};

const object = (value: unknown): Record<string, unknown> | undefined => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
const text = (...values: unknown[]) => values.find((value): value is string => typeof value === "string" && Boolean(value.trim()));
const operationIcon = (value: unknown) => typeof value === "string" && Object.hasOwn(operations, value.toLowerCase()) ? operations[value.toLowerCase()] : undefined;
const toolCallTags = new Set(["session.tool.called", "tool.execute.before"]);
const commandCallTags = new Set(["command.execute.before", "session.shell.started"]);

function patchIcon(value: unknown): FileIcon | undefined {
  if (typeof value !== "string") return undefined;
  const changes = new Set([...value.matchAll(/^\*{3} (Add|Update|Delete) File:/gm)].map((match) => operationIcon(match[1])));
  changes.delete(undefined);
  return changes.size > 1 ? "fileEdit" : changes.values().next().value;
}

function fileChangesIcon(value: unknown): FileIcon | undefined {
  if (!Array.isArray(value)) return undefined;
  const changes = new Set(value.map((item) => {
    const file = object(item);
    return operationIcon(file?.type ?? file?.action ?? file?.status);
  }).filter((icon): icon is FileIcon => Boolean(icon)));
  return changes.size > 1 ? "fileEdit" : changes.values().next().value;
}

function eventSummary(message: ReceivedEvent, data: Record<string, unknown>, args: Record<string, unknown>, metadata: Record<string, unknown> | undefined) {
  const patch = text(args.patchText, args.patch_text, args.patch);
  const files = Array.isArray(metadata?.files) ? metadata.files : [];
  const paths = [...new Set([
    text(args.filePath, args.file_path, args.path, data.filePath, data.path, data.file),
    ...files.map((value) => {
      const file = object(value);
      return text(file?.relativePath, file?.filePath, file?.path);
    }),
    ...[...(patch ?? "").matchAll(/^\*{3} (?:Add|Update|Delete) File: (.+)\r?$/gm)].map((match) => match[1].trim()),
  ].filter((path): path is string => Boolean(path)))];
  const fileSummary = paths.length ? `${paths.slice(0, 3).join(" · ")}${paths.length > 3 ? ` · +${paths.length - 3} files` : ""}` : undefined;
  const error = object(data.error);
  const result = object(data.result);
  const item = object(data.item);
  const itemPayload = object(item?.payload);
  const parts = Array.isArray(object(data.output)?.parts) ? object(data.output)?.parts as unknown[] : [];
  const promptText = text(itemPayload?.text, ...parts.map((part) => object(part)?.text));
  const value = text(
    error?.message, object(error?.data)?.message, data.error,
    message.command, data.command, args.command, fileSummary,
    message.content, promptText, data.text, data.content, data.message, result?.content,
    data.summary, data.title, object(data.info)?.title, object(data.session)?.title,
    args.description, args.query, args.pattern, data.description, data.reason, data.status,
  );
  if (!value) return undefined;
  const summary = value.replace(/\s+/g, " ").trim();
  return summary.length > 220 ? `${summary.slice(0, 217).trimEnd()}…` : summary;
}

function describeEvent(message: ReceivedEvent) {
  const envelope = message.event as unknown as Record<string, unknown>;
  const tag = text(envelope.tag) ?? "event";
  const payload = object(envelope[tag]);
  const nativeEvent = object(payload?.event) ?? payload;
  const data = object(nativeEvent?.data) ?? nativeEvent ?? {};
  const input = object(data.input);
  const output = object(data.output);
  const args = object(data.args) ?? object(input?.args) ?? object(output?.args) ?? input ?? {};
  const native = object(data.native);
  const result = object(data.result);
  const metadata = object(data.metadata) ?? object(result?.metadata) ?? object(output?.metadata);
  const tool = text(data.tool, data.name, input?.tool, native?.tool, native?.name);
  const toolName = tool?.split(/__|[./:]/).at(-1)?.toLowerCase().replace(/[-_\s]/g, "");
  const isTool = /(?:^|\.)tool(?:\.|$)/i.test(tag);
  const isFile = /(?:^|\.)(?:file|filesystem)(?:\.|$)/i.test(tag);
  const isToolCall = toolCallTags.has(tag.toLowerCase());
  const isCommandCall = commandCallTags.has(tag.toLowerCase());
  const isFileOperation = /^(?:file\.(?:edited|created|deleted|added|removed|updated|modified)|filesystem\.changed)$/i.test(tag);
  const showsIcon = isToolCall || isCommandCall || isFileOperation;
  const callID = text(data.callID, data.toolCallID, input?.callID, data.id);
  const sessionID = text(envelope.sessionID, data.sessionID, input?.sessionID, message.session?.sessionID);
  const item = object(data.item);
  const userMessage = object(data.message) ?? object(output?.message) ?? object(data.info);
  const role = text(data.role, userMessage?.role, input?.role);
  const isPrompt = tag === "session.inbox.enqueued" ? item?.type === "user"
    : tag === "chat.message" ? role !== "assistant"
    : /^session\.prompt(?:\.submitted)?$/i.test(tag) || role === "user" && /^(?:session\.text\.(?:started|ended)|message\.(?:created|updated))$/i.test(tag);
  const promptID = text(data.inboxID, data.messageID, userMessage?.id) ?? String(message.id);
  const promptKey = isPrompt ? JSON.stringify([envelope.pluginID, sessionID, promptID]) : undefined;
  const key = isTool && callID ? JSON.stringify([envelope.pluginID, sessionID, callID]) : undefined;
  let icon: TimelineIcon | undefined;

  if (isTool || isFile) {
    icon = fileChangesIcon(metadata?.files)
      ?? patchIcon(args.patchText ?? args.patch_text ?? args.patch)
      ?? operationIcon(data.action ?? data.operation ?? args.operation);
    if (!icon && isFile) icon = operationIcon(data.type) ?? operationIcon(data.event) ?? tag.split(".").map(operationIcon).find(Boolean);
    if (!icon && /^(?:delete|deletefile|removefile|unlink)$/.test(toolName ?? "")) icon = "fileMinus";
    if (!icon && /^(?:edit|editfile|multiedit|strreplace|strreplaceeditor|patch|applypatch)$/.test(toolName ?? "")) icon = "fileEdit";
    if (!icon && ["oldString", "old_string", "oldText", "old_text", "edits"].some((field) => field in args)) icon = "fileEdit";
    if (!icon && /^(?:write|writefile|create|createfile)$/.test(toolName ?? "")) icon = metadata?.exists === true || args.exists === true ? "fileEdit" : "filePlus";
    if (!icon && text(args.filePath, args.path, args.file_path) && ("content" in args || "contents" in args)) icon = metadata?.exists === true || args.exists === true ? "fileEdit" : "filePlus";
    if (!icon && (text(message.command, data.command, args.command) || /^(?:bash|shell|terminal|exec|execute|runcommand|powershell|cmd)$/.test(toolName ?? ""))) icon = "terminal";
  }
  if (!icon && isCommandCall) icon = "terminal";

  return { tag, key, icon, isToolCall, showsIcon, tool, promptKey, summary: eventSummary(message, data, args, metadata) };
}

export function timelineMarkers(events: ReceivedEvent[]): TimelineMarker[] {
  const descriptions = events.map(describeEvent);
  const calls = new Map<string, TimelineIcon>();
  const seenPrompts = new Set<string>();
  for (const description of descriptions) {
    if (description.key && description.icon) calls.set(description.key, description.icon);
  }
  return descriptions.map(({ tag, key, icon, isToolCall, showsIcon, tool, promptKey, summary }) => {
    const isPrompt = Boolean(promptKey && !seenPrompts.has(promptKey));
    if (promptKey) seenPrompts.add(promptKey);
    icon = showsIcon ? (key ? calls.get(key) : undefined) ?? icon ?? (isToolCall ? "hammer" : undefined) : undefined;
    if (isPrompt) icon = "prompt";
    const kind = eventKind(tag);
    const label = icon ? `${icons[icon].label}${tool && !isPrompt ? ` · ${tool}` : ""}` : tag;
    const color = kind === "error" ? "#ed8e8e" : icon ? icons[icon].color
      : kind === "prompt" ? "#b7a0e9" : kind === "success" ? "#8acba4" : "#686a75";
    return { icon, label, color, isPrompt, summary: summary ?? tag.replace(/[._-]+/g, " ").replace(/^./, (letter) => letter.toUpperCase()) };
  });
}
