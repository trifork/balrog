import { useEffect, useState } from "react";
import { ActivitySummary } from "./ActivitySummary";
import { EventFeed } from "./EventFeed";
import { Icon } from "./Icon";
import { SessionSidebar } from "./SessionSidebar";
import { useViewer } from "./useViewer";

const sessionFromURL = () => new URL(window.location.href).searchParams.get("session") || "";

export function App() {
  const { events, sessions, status, error } = useViewer();
  const [selected, setSelected] = useState(sessionFromURL);
  const sessionTitle = sessions.find((session) => session.sessionID === selected)?.title;
  const toolCount = events.filter(({ event }) => event.tag === "session.tool.called" || String(event.tag) === "tool.execute.before").length;

  useEffect(() => {
    const onPopState = () => setSelected(sessionFromURL());
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  const selectSession = (sessionID: string) => {
    if (selected === sessionID) return;
    const url = new URL(window.location.href);
    if (sessionID) url.searchParams.set("session", sessionID);
    else url.searchParams.delete("session");
    window.history.pushState(null, "", url);
    setSelected(sessionID);
  };

  return (
    <div className="app" data-connection={status}>
      <SessionSidebar sessions={sessions} eventCount={events.length} selected={selected} onSelect={selectSession} status={status} />
      <div className="main">
        <header className="topbar">
          <div className="breadcrumb"><Icon name="layers" /><span>Workspace</span><span>/</span><span>Overview</span></div>
          <div className="topbar-note"><Icon name="shield" />Local-first. Just your machine.</div>
        </header>
        <main className="dashboard">
          <div className="page-heading">
            <div><p className="eyebrow">Your agent, under the hood</p><h1>Activity overview</h1><p className="description">Every prompt, tool call, and moment in between.</p></div>
            <div className="live-badge" role="status"><span className="status-dot" /><span>{status === "live" ? "Live stream" : status === "connecting" ? "Connecting" : "Reconnecting"}</span></div>
          </div>
          {error && <p role="alert">{error}</p>}
          <ActivitySummary events={events.length} sessions={sessions.length} tools={toolCount} />
          <EventFeed events={events} selectedSession={selected} sessionTitle={sessionTitle} />
        </main>
      </div>
    </div>
  );
}
