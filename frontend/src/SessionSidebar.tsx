import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import type { SessionSummary } from "../../shared/viewer-protocol";
import { Icon } from "./Icon";
import type { ViewerState } from "./useViewer";

interface Props {
  sessions: SessionSummary[];
  eventCount: number;
  selected: string;
  onSelect: (sessionID: string) => void;
  status: ViewerState["status"];
}

export function SessionSidebar({ sessions, eventCount, selected, onSelect, status }: Props) {
  const tabs = useRef<HTMLElement>(null);
  const [horizontal, setHorizontal] = useState(false);
  const items = [
    { sessionID: "", title: "All sessions", eventCount },
    ...[...sessions].sort((a, b) => b.lastEventAt - a.lastEventAt),
  ];
  const focusable = items.some((item) => item.sessionID === selected) ? selected : "";

  useEffect(() => {
    const media = window.matchMedia("(max-width: 760px)");
    const update = () => setHorizontal(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  const navigate = (event: KeyboardEvent<HTMLElement>) => {
    const buttons = Array.from(tabs.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]') ?? []);
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (index < 0) return;
    let next: number;
    if (event.key === "ArrowDown" || event.key === "ArrowRight") next = (index + 1) % buttons.length;
    else if (event.key === "ArrowUp" || event.key === "ArrowLeft") next = (index + buttons.length - 1) % buttons.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = buttons.length - 1;
    else return;
    event.preventDefault();
    onSelect(buttons[next].dataset.sessionId!);
    buttons[next].focus();
  };

  return (
    <aside className="sidebar" aria-label="Workspace">
      <div className="brand">
        <div className="brand-mark"><Icon name="flame" /></div>
        <div><div className="brand-name">balrog<span className="brand-accent">.</span></div><div className="brand-subtitle">See what happens.</div></div>
      </div>
      <div className="workspace"><Icon name="terminal" /><span>Local workspace</span><span>LOCAL</span></div>
      <div className="sidebar-label"><span>Sessions</span><span>{sessions.length.toLocaleString()}</span></div>
      <nav id="session-tabs" ref={tabs} aria-label="Sessions" role="tablist" aria-orientation={horizontal ? "horizontal" : "vertical"} onKeyDown={navigate}>
        {items.map((item) => (
          <button className="session-tab" type="button" role="tab" key={item.sessionID}
            data-session-id={item.sessionID} aria-selected={selected === item.sessionID}
            tabIndex={focusable === item.sessionID ? 0 : -1} title={item.sessionID || "All sessions"}
            onClick={() => onSelect(item.sessionID)}>
            <span className="session-title">{item.title || item.sessionID}</span>
            <small>{item.eventCount.toLocaleString()}</small>
          </button>
        ))}
      </nav>
      <div className="sidebar-footer">
        <div className="connection"><span className="status-dot" /><span id="status" role="status">
          {status === "live" ? "Connected to OpenCode stream" : status === "connecting" ? "Connecting…" : "Reconnecting…"}
        </span></div>
        <p>OpenCode event stream</p>
      </div>
    </aside>
  );
}
