import { useEffect, useLayoutEffect, useMemo, useState } from "react";
import { EventCard, eventKind } from "./EventCard";
import { Icon } from "./Icon";
import { StatusDot } from "./StatusDot";
import type { ReceivedEvent } from "./useViewer";

interface Props {
  events: ReceivedEvent[];
  selectedSession: string;
  sessionTitle?: string;
  eventIDs?: ReadonlySet<number>;
  activeEventID?: number;
  cutoffEventID?: number;
  onVisibleEventsChange?: (events: ReceivedEvent[]) => void;
  jumpRequest?: { id: number };
}

export function EventFeed({ events, selectedSession, sessionTitle, eventIDs, activeEventID, cutoffEventID, onVisibleEventsChange, jumpRequest }: Props) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [collapse, setCollapse] = useState({ defaultValue: true, overrides: new Map<number, boolean>() });
  const query = search.trim().toLowerCase();
  const matching = useMemo(() => events.filter((message) => {
    const tag = String(message.event.tag ?? "event");
    const kind = eventKind(tag);
    const isTool = /tool/i.test(tag);
    const sessionID = message.session?.sessionID || message.event.sessionID || "";
    return (!selectedSession || sessionID === selectedSession)
      && (!eventIDs || eventIDs.has(message.id))
      && (!query || JSON.stringify(message.event).toLowerCase().includes(query))
      && (filter === "all" || (filter === "tool" ? isTool
        : filter === "other" ? !isTool && (kind === "other" || kind === "success")
        : filter === kind));
  }).reverse(), [events, selectedSession, query, filter, eventIDs]);
  const visible = useMemo(() => cutoffEventID === undefined ? matching : matching.filter((message) => message.id <= cutoffEventID), [matching, cutoffEventID]);

  const isCollapsed = (id: number) => collapse.overrides.get(id) ?? collapse.defaultValue;
  const contentEvents = visible.filter((message) => typeof message.content === "string");
  const allCollapsed = contentEvents.length > 0 ? contentEvents.every((message) => isCollapsed(message.id)) : collapse.defaultValue;
  const filtered = events.length > 0 || Boolean(selectedSession || query || filter !== "all");
  const visibleIDs = new Set(visible.map((message) => message.id));

  useLayoutEffect(() => {
    if (!jumpRequest) return;
    setSearch("");
    setFilter("all");
  }, [jumpRequest]);

  useEffect(() => {
    onVisibleEventsChange?.([...matching].reverse());
  }, [matching, onVisibleEventsChange]);

  useEffect(() => {
    setCollapse((previous) => previous.defaultValue === allCollapsed ? previous : {
      defaultValue: allCollapsed,
      overrides: new Map(events.map((message) => [message.id, previous.overrides.get(message.id) ?? previous.defaultValue])),
    });
  }, [allCollapsed, events]);

  const collapseAll = () => {
    setCollapse((previous) => {
      const overrides = new Map(previous.overrides);
      for (const message of events) {
        if (!overrides.has(message.id)) overrides.set(message.id, previous.defaultValue);
      }
      for (const message of contentEvents) overrides.set(message.id, !allCollapsed);
      return { defaultValue: !allCollapsed, overrides };
    });
  };

  const toggle = (id: number) => setCollapse((previous) => ({
    ...previous,
    overrides: new Map(previous.overrides).set(id, !(previous.overrides.get(id) ?? previous.defaultValue)),
  }));

  return (
    <section aria-label="Event activity">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5"><h2 id="feed-title" className="truncate text-[15px] font-semibold tracking-[-0.2px]">{selectedSession ? sessionTitle || "Session activity" : "Event stream"}</h2><span id="visible-count" className="rounded-[5px] border border-[#303137] bg-[#242529] px-[7px] font-mono text-[10px] leading-5 text-[#9999a4]">{visible.length.toLocaleString()}</span></div>
        <span className="text-[10px] text-[#7e7f89] max-[480px]:hidden">Newest events first</span>
      </div>
      <div className="mb-5.5 flex flex-wrap items-center gap-2.5 max-[480px]:gap-2">
        <label className="flex min-w-0 flex-[1_1_220px] items-center gap-[9px] rounded-[7px] border border-line bg-panel px-3 text-[#7e7f89] focus-within:border-[#ff9a6680] max-[480px]:basis-full"><Icon name="search" className="size-[15px]" /><input id="event-search" className="h-[38px] min-w-0 w-full border-0 bg-transparent text-[12px] text-ink outline-none placeholder:text-[#777884]" type="search" placeholder="Search events, commands, or content…" aria-label="Search events" autoComplete="off"
          value={search} onChange={(event) => setSearch(event.target.value)} onKeyDown={(event) => { if (event.key === "Escape") setSearch(""); }} /></label>
        <select id="event-filter" className="h-10 min-w-0 max-w-[155px] rounded-[7px] border border-line bg-panel pr-[30px] pl-3 text-[11px] text-[#c4c4ce] max-[480px]:max-w-none max-[480px]:flex-1" aria-label="Filter event type" value={filter} onChange={(event) => setFilter(event.target.value)}>
          <option value="all">All event types</option><option value="prompt">Prompts &amp; messages</option><option value="tool">Tool activity</option><option value="error">Errors</option><option value="other">Session &amp; system</option>
        </select>
        <button id="collapse-all" className="h-10 bg-panel px-[13px] text-[11px] whitespace-nowrap" type="button" disabled={!contentEvents.length} onClick={collapseAll}>{allCollapsed ? "Expand all" : "Collapse all"}</button>
      </div>
      <div id="events" className="relative" role="region" aria-label="Session events">
        {!visible.length && <div id="empty" className="flex min-h-[290px] flex-col items-center justify-center rounded-[10px] border border-dashed border-[#35363c] bg-[radial-gradient(ellipse_at_50%_10%,#ff9a6605,transparent_70%)] px-5 py-10 text-center">
          <div className="mb-4.5 grid size-[50px] place-items-center rounded-[14px] border border-[#ff9a6626] bg-[#ff9a6609] text-accent"><Icon name="activity" className="size-6" /></div>
          <h3 className="mb-1.5 text-[15px] font-[550]">{filtered ? "No matching events" : "Ready when you are"}</h3>
          <p className="max-w-[340px] text-[12px] text-muted">{filtered ? "Try another search or event type, or choose a different session." : "Waiting for events… Start an OpenCode session and watch your agent's activity unfold here."}</p>
          {!filtered && <code className="mt-5 rounded-[5px] border border-line bg-[#1b1c20] px-3 py-1.5 font-mono text-[11px] text-[#a8a8b3]">$ opencode</code>}
        </div>}
        {[...events].reverse().map((message) => <EventCard key={message.id} message={message} collapsed={isCollapsed(message.id)} hidden={!visibleIDs.has(message.id)} active={message.id === activeEventID} sessionSelected={Boolean(selectedSession)} onToggle={() => toggle(message.id)} />)}
      </div>
      <footer className="mt-5.5 flex justify-between gap-2.5 border-t border-line pt-4 text-[10px] text-[#747580] max-[480px]:flex-col"><span className="flex items-center gap-[7px]"><StatusDot />{cutoffEventID === undefined ? "Events appear automatically. No refresh needed." : "Playback paused. New events are still being recorded."}</span><span>Built for a little more observability.</span></footer>
    </section>
  );
}
