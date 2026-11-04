import type { SessionSummary } from "../../shared/viewer-protocol";
import type { SubagentStart } from "./subagent-model";

interface Props {
  sessions: SessionSummary[];
  selected: string;
  starts?: SubagentStart[];
  onSelect: (sessionID: string, pathname: string) => void;
}

/** Keep related sessions discoverable without mixing their events into this session. */
export function SessionRelations({ sessions, selected, starts = [], onSelect }: Props) {
  if (!selected) return null;
  const current = sessions.find((session) => session.sessionID === selected);
  const parentID = current?.parentID;
  const parent = sessions.find((session) => session.sessionID === parentID);
  const startByID = new Map(starts.map((start) => [start.sessionID, start]));
  const children = sessions.filter((session) => session.parentID === selected)
    .sort((a, b) => (startByID.get(a.sessionID)?.timestamp ?? Infinity) - (startByID.get(b.sessionID)?.timestamp ?? Infinity));
  if (!parentID && !children.length) return null;

  const link = (sessionID: string, label: string, subagent = false) => {
    const prefix = subagent ? startByID.get(sessionID)?.label : undefined;
    const url = new URL(window.location.href);
    if (subagent) url.pathname = "/";
    url.searchParams.set("session", sessionID);
    return <a key={sessionID} href={`${url.pathname}${url.search}${url.hash}`} title={label}
      className="max-w-[320px] truncate rounded border border-line px-2 py-1 text-ink hover:border-accent hover:text-accent"
      onClick={(event) => {
        if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        onSelect(sessionID, url.pathname);
       }}>{prefix && <span className="mr-1 font-mono text-accent">{prefix}</span>}{label}</a>;
  };

  return <nav aria-label="Related sessions" className="flex shrink-0 flex-wrap items-center gap-2 border-b border-line px-7 py-2 text-[12px] text-muted max-[760px]:px-3">
    {parentID && <span className="max-w-[320px] truncate text-ink" title={current?.title || selected}>Subagent: {current?.title || selected}</span>}
    {parentID && <><span>Parent session:</span>{link(parentID, parent?.title || parentID)}</>}
    {children.length > 0 && <><span>Subagents ({children.length}):</span>
      {children.map((session) => link(session.sessionID, session.title || session.sessionID, true))}</>}
  </nav>;
}
