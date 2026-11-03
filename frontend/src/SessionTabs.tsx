import { useEffect, useRef, type KeyboardEvent } from "react";
import type { SessionSummary } from "../../shared/viewer-protocol";

interface Props {
  sessions: SessionSummary[];
  selected: string;
  onSelect: (sessionID: string) => void;
}

const revealTab = (button: HTMLButtonElement) => {
  const tabs = button.parentElement;
  if (!tabs) return;
  const bounds = tabs.getBoundingClientRect();
  const tab = button.getBoundingClientRect();
  if (tab.left < bounds.left) tabs.scrollLeft -= bounds.left - tab.left;
  else if (tab.right > bounds.right) tabs.scrollLeft += tab.right - bounds.right;
};

export function SessionTabs({ sessions, selected, onSelect }: Props) {
  const tabs = useRef<HTMLElement>(null);
  const items = [
    { sessionID: "", title: "All sessions" },
    ...[...sessions].sort((a, b) => b.lastEventAt - a.lastEventAt),
  ];
  const focusable = items.some((item) => item.sessionID === selected) ? selected : "";

  useEffect(() => {
    const active = tabs.current?.querySelector<HTMLButtonElement>('[aria-selected="true"]');
    if (active) revealTab(active);
  }, [selected, sessions]);

  const navigate = (event: KeyboardEvent<HTMLElement>) => {
    const buttons = Array.from(tabs.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]') ?? []);
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (index < 0) return;
    let next: number;
    if (event.key === "ArrowRight") next = (index + 1) % buttons.length;
    else if (event.key === "ArrowLeft") next = (index + buttons.length - 1) % buttons.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = buttons.length - 1;
    else return;
    event.preventDefault();
    onSelect(buttons[next].dataset.sessionId!);
    buttons[next].focus({ preventScroll: true });
  };

  return (
    <nav id="session-tabs" ref={tabs} aria-label="Sessions" role="tablist" aria-orientation="horizontal" onKeyDown={navigate}>
      {items.map((item) => (
        <button className="session-tab" type="button" role="tab" key={item.sessionID}
          data-session-id={item.sessionID} aria-selected={selected === item.sessionID} aria-controls="events"
          tabIndex={focusable === item.sessionID ? 0 : -1} title={item.title || item.sessionID}
          onFocus={(event) => revealTab(event.currentTarget)} onClick={() => onSelect(item.sessionID)}>
          <span className="session-title">{item.title || item.sessionID}</span>
        </button>
      ))}
    </nav>
  );
}
