import type { ReceivedEvent } from "./useViewer";

export function eventKind(tag: string): string {
  if (/error|fail/i.test(tag)) return "error";
  if (/prompt|message|session\.text|session\.synthetic/i.test(tag)) return "prompt";
  if (/success|completed/i.test(tag)) return "success";
  return /tool/i.test(tag) ? "tool" : "other";
}

interface Props {
  message: ReceivedEvent;
  collapsed: boolean;
  sessionSelected: boolean;
  hidden: boolean;
  onToggle: () => void;
}

export function EventCard({ message, collapsed, sessionSelected, hidden, onToggle }: Props) {
  const { event, content, command, sessionTitle, receivedAt } = message;
  const tag = String(event.tag ?? "event");
  const hasContent = typeof content === "string";
  const action = collapsed ? "Expand event" : "Collapse event";

  return (
    <article className={`${hasContent ? "has-content" : ""}${collapsed ? " collapsed" : ""}`} data-kind={eventKind(tag)} hidden={hidden}>
      <header>
        {hasContent && <button className="event-collapse" type="button" title={action} aria-label={action} aria-expanded={!collapsed} onClick={onToggle}>{collapsed ? "▸" : "▾"}</button>}
        <strong>{tag}</strong>
        <time dateTime={new Date(receivedAt).toISOString()}>{new Date(receivedAt).toLocaleTimeString()}</time>
        <span className="meta" hidden={sessionSelected}>{sessionTitle || ""}</span>
        {typeof command === "string" && <code className="command" title={command}>{command}</code>}
      </header>
      {hasContent && <div className={`content${tag.startsWith("session.tool.") ? " tool-content" : ""}`} hidden={collapsed}>{content}</div>}
      <details><summary>Raw event</summary><pre>{JSON.stringify(event, null, 2)}</pre></details>
    </article>
  );
}
