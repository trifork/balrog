import { useEffect, useRef, type KeyboardEvent } from "react";
import type { SessionSummary } from "../../shared/viewer-protocol";

interface Props {
  sessions: SessionSummary[];
  selected: string;
  selectedSessions?: string[] | null;
  onSelect: (sessionID: string, toggle?: boolean) => void;
}

const revealTab = (button: HTMLButtonElement) => {
  const tabs = button.parentElement;
  if (!tabs) return;
  const bounds = tabs.getBoundingClientRect();
  const tab = button.getBoundingClientRect();
  if (tab.left < bounds.left) tabs.scrollLeft -= bounds.left - tab.left;
  else if (tab.right > bounds.right) tabs.scrollLeft += tab.right - bounds.right;
};

export function SessionTabs({ sessions, selected, selectedSessions, onSelect }: Props) {
  const tabs = useRef<HTMLElement>(null);
  const items = [
    { sessionID: "", title: "All sessions" },
    ...sessions.filter((session) => !session.parentID).sort((a, b) => b.lastEventAt - a.lastEventAt),
  ];
  const focus = selectedSessions?.[0] ?? selected;
  const focusable = items.some((item) => item.sessionID === focus) ? focus : "";
  const isSelected = (id: string) => selectedSessions === undefined ? selected === id
    : selectedSessions === null ? id === "" : selectedSessions.includes(id);

  useEffect(() => {
    const active = tabs.current?.querySelector<HTMLButtonElement>('[aria-selected="true"]');
    if (active) revealTab(active);
  }, [selected, selectedSessions, sessions]);

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
    onSelect(buttons[next].dataset.sessionId!, event.shiftKey);
    buttons[next].focus({ preventScroll: true });
  };

  return (
    <nav id="session-tabs" className="relative flex min-w-0 items-stretch gap-1 overflow-x-auto [scrollbar-width:thin] max-[760px]:col-span-full max-[760px]:row-start-2 max-[760px]:mt-1.5" ref={tabs} aria-label="Sessions" role="tablist" aria-multiselectable={selectedSessions !== undefined || undefined} aria-orientation="horizontal" onKeyDown={navigate}>
      {items.map((item) => {
        const label = item.title || item.sessionID;
        return (
          <button className="relative flex min-h-12 max-w-[240px] shrink-0 items-center rounded-none border-0 border-b-2 border-transparent bg-transparent px-3 text-left text-[12px] text-muted hover:border-b-[#45464d] hover:bg-[#ffffff03] hover:text-ink focus-visible:-outline-offset-5 aria-selected:border-b-accent aria-selected:bg-[#ff9a6608] aria-selected:text-[#ffb58c] max-[760px]:min-h-11 max-[760px]:max-w-[230px] max-[760px]:px-2.5" type="button" role="tab" key={item.sessionID}
            data-session-id={item.sessionID} aria-selected={isSelected(item.sessionID)} aria-controls="session-workspace"
            tabIndex={focusable === item.sessionID ? 0 : -1} title={`${label}${selectedSessions !== undefined ? " (click to select only; Shift-click to toggle)" : ""}`}
            onFocus={(event) => revealTab(event.currentTarget)} onClick={(event) => onSelect(item.sessionID, event.shiftKey)}>
            <span className="min-w-0 truncate">{label}</span>
          </button>
        );
      })}
    </nav>
  );
}
