import { useEffect, useState } from "react";
import { EventFeed } from "./EventFeed";
import { Icon } from "./Icon";
import { SessionTabs } from "./SessionTabs";
import { useViewer } from "./useViewer";

const sessionFromURL = () => new URL(window.location.href).searchParams.get("session") || "";

export function App() {
  const { events, sessions, status, error } = useViewer();
  const [selected, setSelected] = useState(sessionFromURL);
  const sessionTitle = sessions.find((session) => session.sessionID === selected)?.title;

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
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark"><Icon name="flame" /></div>
          <div className="brand-name">balrog<span className="brand-accent">.</span></div>
        </div>
        <SessionTabs sessions={sessions} selected={selected} onSelect={selectSession} />
        <div className="live-badge" role="status"><span className="status-dot" /><span>{status === "live" ? "Live stream" : status === "connecting" ? "Connecting" : "Reconnecting"}</span></div>
      </header>
      <main className="dashboard">
        {error && <p role="alert">{error}</p>}
        <EventFeed events={events} selectedSession={selected} sessionTitle={sessionTitle} />
      </main>
    </div>
  );
}
