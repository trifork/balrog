import type { ReceivedEvent } from "./useViewer";

export function eventKind(tag: string): string {
  if (/error|fail/i.test(tag)) return "error";
  if (/prompt|message|session\.text|session\.synthetic|session\.inbox\.enqueued/i.test(tag)) return "prompt";
  if (/success|completed/i.test(tag)) return "success";
  return /tool/i.test(tag) ? "tool" : "other";
}

interface Props {
  message: ReceivedEvent;
  collapsed: boolean;
  sessionSelected: boolean;
  hidden: boolean;
  active?: boolean;
  onToggle: () => void;
}

export function EventCard({ message, collapsed, sessionSelected, hidden, active, onToggle }: Props) {
  const { event, content, command, sessionTitle, receivedAt } = message;
  const tag = String(event.tag ?? "event");
  const hasContent = typeof content === "string";
  const action = collapsed ? "Expand event" : "Collapse event";

  return (
    <article id={`event-${message.id}`} className="relative mb-3 overflow-hidden rounded-[9px] border border-line bg-panel [--event-color:#a8acba] hover:border-[#414249] data-[kind=prompt]:[--event-color:#b7a0e9] data-[kind=tool]:[--event-color:#e6b479] data-[kind=success]:[--event-color:#8acba4] data-[kind=error]:[--event-color:#ed8e8e] data-[active=true]:border-[#ff9a66b3] data-[active=true]:shadow-[0_0_0_1px_#ff9a661a]" data-kind={eventKind(tag)} data-active={active || undefined} hidden={hidden}>
      <header className="relative flex min-h-[52px] flex-wrap items-center gap-2.5 py-[13px] pr-28 pl-[17px] before:size-1.5 before:shrink-0 before:rounded-full before:bg-[var(--event-color)] before:shadow-[0_0_0_4px_color-mix(in_srgb,var(--event-color)_7%,transparent)] before:content-[''] max-[760px]:gap-[9px] max-[760px]:pl-[13px] max-[480px]:pr-[95px]">
        {hasContent && <button className="w-4 shrink-0 border-0 bg-transparent p-0 text-[12px] leading-none text-[#8d8e98] hover:bg-transparent hover:text-white" type="button" title={action} aria-label={action} aria-expanded={!collapsed} onClick={onToggle}>{collapsed ? "▸" : "▾"}</button>}
        <strong className="font-code text-[11px] leading-[1.5] font-medium wrap-anywhere text-[color:var(--event-color)]">{tag}</strong>
        <time className="ml-auto font-mono text-[10px] leading-[1.5] text-[#858690] tabular-nums max-[480px]:ml-4" dateTime={new Date(receivedAt).toISOString()}>{new Date(receivedAt).toLocaleTimeString()}</time>
        <span className="max-w-[180px] truncate text-[10px] text-[#92939e] max-[1100px]:max-w-[100px] max-[760px]:hidden" hidden={sessionSelected}>{sessionTitle || ""}</span>
        {typeof command === "string" && <code className="min-w-0 basis-full truncate pl-4 font-mono text-[11px] leading-[1.5] text-[#a5a6b0]" title={command}>{command}</code>}
      </header>
      {hasContent && <div className={`mx-4 mb-4 max-h-[420px] overflow-auto rounded-[6px] border border-[#ffffff06] bg-[#121315] px-[17px] py-[15px] leading-[1.8] wrap-anywhere whitespace-pre-wrap max-[480px]:mx-2.5 max-[480px]:mb-2.5 max-[480px]:p-3 ${tag.startsWith("session.tool.") ? "font-code text-[11px] text-[#b6b9c3]" : "text-[12px] text-[#c7c7d0]"}`} hidden={collapsed}>{content}</div>}
      <details><summary className="absolute top-[18px] right-[17px] cursor-pointer text-[10px] whitespace-nowrap text-[#9697a1] hover:text-accent max-[480px]:right-3">Raw event</summary><pre className="m-0 w-full overflow-auto border-t border-line bg-[#131416] px-5 py-4.5 font-code text-[11px] leading-[1.7] wrap-anywhere whitespace-pre-wrap text-[#a6a7b3]">{JSON.stringify(event, null, 2)}</pre></details>
    </article>
  );
}
