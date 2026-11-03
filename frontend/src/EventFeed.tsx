import { useEffect, useMemo, useState } from "react";
import { EventCard, eventKind } from "./EventCard";
import { Icon } from "./Icon";
import type { ReceivedEvent } from "./useViewer";

interface Props {
  events: ReceivedEvent[];
  selectedSession: string;
  sessionTitle?: string;
}

export function EventFeed({ events, selectedSession, sessionTitle }: Props) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [collapse, setCollapse] = useState({ defaultValue: false, overrides: new Map<number, boolean>() });
  const query = search.trim().toLowerCase();
  const visible = useMemo(() => events.filter((message) => {
    const tag = String(message.event.tag ?? "event");
    const kind = eventKind(tag);
    const isTool = /tool/i.test(tag);
    const sessionID = message.session?.sessionID || message.event.sessionID || "";
    return (!selectedSession || sessionID === selectedSession)
      && (!query || JSON.stringify(message.event).toLowerCase().includes(query))
      && (filter === "all" || (filter === "tool" ? isTool
        : filter === "other" ? !isTool && (kind === "other" || kind === "success")
        : filter === kind));
  }).reverse(), [events, selectedSession, query, filter]);

  const isCollapsed = (id: number) => collapse.overrides.get(id) ?? collapse.defaultValue;
  const contentEvents = visible.filter((message) => typeof message.content === "string");
  const allCollapsed = contentEvents.length > 0 && contentEvents.every((message) => isCollapsed(message.id));
  const filtered = events.length > 0 || Boolean(selectedSession || query || filter !== "all");
  const visibleIDs = new Set(visible.map((message) => message.id));

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
      <div className="feed-heading">
        <div className="feed-title"><h2 id="feed-title">{selectedSession ? sessionTitle || "Session activity" : "Event stream"}</h2><span id="visible-count">{visible.length.toLocaleString()}</span></div>
        <span className="feed-note">Newest events first</span>
      </div>
      <div className="toolbar">
        <label className="search"><Icon name="search" /><input id="event-search" type="search" placeholder="Search events, commands, or content…" aria-label="Search events" autoComplete="off"
          value={search} onChange={(event) => setSearch(event.target.value)} onKeyDown={(event) => { if (event.key === "Escape") setSearch(""); }} /></label>
        <select id="event-filter" aria-label="Filter event type" value={filter} onChange={(event) => setFilter(event.target.value)}>
          <option value="all">All event types</option><option value="prompt">Prompts &amp; messages</option><option value="tool">Tool activity</option><option value="error">Errors</option><option value="other">Session &amp; system</option>
        </select>
        <button id="collapse-all" type="button" disabled={!contentEvents.length} onClick={collapseAll}>{allCollapsed ? "Expand all" : "Collapse all"}</button>
      </div>
      <div id="events" role="tabpanel" aria-label="Session events">
        {!visible.length && <div id="empty">
          <div className="empty-icon"><Icon name="activity" /></div>
          <h3>{filtered ? "No matching events" : "Ready when you are"}</h3>
          <p>{filtered ? "Try another search or event type, or choose a different session." : "Waiting for events… Start an OpenCode session and watch your agent's activity unfold here."}</p>
          {!filtered && <code>$ opencode</code>}
        </div>}
        {[...events].reverse().map((message) => <EventCard key={message.id} message={message} collapsed={isCollapsed(message.id)} hidden={!visibleIDs.has(message.id)} sessionSelected={Boolean(selectedSession)} onToggle={() => toggle(message.id)} />)}
      </div>
      <footer className="feed-footer"><span><span className="status-dot" />Events appear automatically. No refresh needed.</span><span>Built for a little more observability.</span></footer>
    </section>
  );
}
