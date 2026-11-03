import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { SessionSummary } from "../../shared/viewer-protocol";
import { EventFeed } from "./EventFeed";
import { FileHeatmap } from "./FileHeatmap";
import { FileInspector } from "./FileInspector";
import { Icon } from "./Icon";
import { collectActivity, fileName, operationCount, promptNumber, type ActivityMode } from "./file-activity-model";
import type { ReceivedEvent } from "./useViewer";

interface Selection {
  session: string;
  prompt: string | null;
  file: string | null;
}

const emptyEventIDs: ReadonlySet<number> = new Set();

export function FileActivity({ events, sessions, selectedSession, activeEventID, cutoffEventID, onVisibleEventsChange, jumpRequest }: {
  events: ReceivedEvent[];
  sessions: SessionSummary[];
  selectedSession: string;
  activeEventID?: number;
  cutoffEventID?: number;
  onVisibleEventsChange?: (events: ReceivedEvent[]) => void;
  jumpRequest?: { id: number };
}) {
  const [selection, setSelection] = useState<Selection>({ session: selectedSession, prompt: null, file: null });
  const [search, setSearch] = useState("");
  const [mode, setMode] = useState<ActivityMode>("all");
  const [mobileOpen, setMobileOpen] = useState(false);
  const [traceOpen, setTraceOpen] = useState(false);
  const [relatedSession, setRelatedSession] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const opener = useRef<HTMLElement | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const traceSummary = useRef<HTMLElement>(null);
  const prompts = useMemo(() => collectActivity(events, selectedSession), [events, selectedSession]);
  const current = selection.session === selectedSession ? selection : { session: selectedSession, prompt: null, file: null };
  const following = current.prompt === null;
  const prompt = following ? prompts.at(-1) : prompts.find((item) => item.key === current.prompt);
  const index = prompt ? prompts.indexOf(prompt) : -1;
  const allPaths = useMemo(() => [...new Set(prompts.flatMap((item) => [...item.files.keys()]))].sort((a, b) => a.localeCompare(b)), [prompts]);
  const paths = allPaths.filter((path) => path.toLowerCase().includes(search.trim().toLowerCase()));
  const operations = prompts.reduce((total, item) => total + [...item.files.values()].reduce((sum, touches) => sum + operationCount(touches), 0), 0);
  const sessionTitle = (sessionID: string) => sessions.find((session) => session.sessionID === sessionID)?.title || sessionID;
  const relatedIDs = prompt ? current.file ? prompt.fileEventIDs.get(current.file) ?? emptyEventIDs : prompt.eventIDs : emptyEventIDs;
  const related = relatedSession === selectedSession && Boolean(prompt);
  const scope = related && prompt ? `Prompt ${promptNumber(index)}${current.file ? ` / ${fileName(current.file)}` : " / all files"}` : "All events";
  const eventCount = related ? relatedIDs.size : events.filter((message) => !selectedSession || (message.session?.sessionID ?? message.event.sessionID) === selectedSession).length;

  useEffect(() => {
    setMobileOpen(false);
    setRelatedSession(null);
    setAnnouncement("");
  }, [selectedSession]);

  useEffect(() => {
    if (mobileOpen && window.matchMedia("(max-width: 760px)").matches) closeRef.current?.focus();
  }, [mobileOpen]);

  useLayoutEffect(() => {
    if (jumpRequest) setTraceOpen(true);
  }, [jumpRequest]);

  useLayoutEffect(() => {
    if (!jumpRequest || !traceOpen) return;
    const card = document.getElementById(`event-${jumpRequest.id}`);
    if (card && !card.hidden) card.scrollIntoView?.({ block: "center", behavior: "instant" });
  }, [jumpRequest, traceOpen]);

  const select = (key: string, file: string | null, element?: HTMLElement) => {
    if (element) opener.current = element;
    setSelection({ session: selectedSession, prompt: key, file });
    setMobileOpen(true);
    setAnnouncement(`Prompt ${promptNumber(prompts.findIndex((item) => item.key === key))} selected${file ? `, ${file}` : ""}.`);
  };
  const closeInspector = () => {
    setMobileOpen(false);
    if (opener.current?.isConnected) opener.current.focus({ preventScroll: true });
  };

  return (
    <section className="activity-workspace" id="session-workspace" role="tabpanel" aria-label={selectedSession ? sessionTitle(selectedSession) : "All sessions"}
      onKeyDown={(event) => { if (event.key === "Escape" && mobileOpen && window.matchMedia("(max-width: 760px)").matches) closeInspector(); }}>
      <div className="activity-page-heading">
        <div><h1>Files touched per prompt</h1><p>Follow the work through your codebase. One prompt at a time.</p></div>
        <dl className="activity-totals" aria-label="Session totals"><div><dd id="total-files">{allPaths.length.toLocaleString()}</dd><dt>observed files</dt></div><div><dd id="total-prompts">{prompts.length.toLocaleString()}</dd><dt>prompts</dt></div><div><dd id="total-operations">{operations.toLocaleString()}</dd><dt>successful operations</dt></div></dl>
      </div>
      <div className="activity-toolbar">
        <label className="activity-search"><Icon name="search" className="size-3.5" /><input type="search" aria-label="Find a file or folder" placeholder="Find a file or folder…" autoComplete="off" value={search} onChange={(event) => setSearch(event.target.value)} onKeyDown={(event) => { if (event.key === "Escape") setSearch(""); }} /></label>
        <div className="activity-filters" role="group" aria-label="Activity type">{([['all', 'All activity'], ['reads', 'Reads'], ['changes', 'Changes']] as const).map(([value, label]) => <button key={value} type="button" aria-pressed={mode === value} onClick={() => setMode(value)}>{label}</button>)}</div>
        <button type="button" className="activity-follow" aria-pressed={following} onClick={() => {
          setSelection({ session: selectedSession, prompt: following ? prompt?.key ?? null : null, file: null });
          setAnnouncement(following ? "Latest prompt pinned." : "Following the latest prompt.");
        }} disabled={!prompts.length}><Icon name="follow" className="size-3.5" />{following ? "Following latest" : "Follow latest"}</button>
      </div>
      <div className="activity-body">
        <FileHeatmap key={selectedSession} prompts={prompts} paths={paths} mode={mode} selectedKey={prompt?.key} selectedFile={current.file} sessionTitle={sessionTitle} onSelect={select} />
        <FileInspector prompt={prompt} index={index} total={prompts.length} selectedFile={current.file} following={following} sessionTitle={prompt ? sessionTitle(prompt.activity.sessionID) : ""}
          eventCount={relatedIDs.size} mobileOpen={mobileOpen} closeRef={closeRef} onClose={closeInspector}
          onNavigate={(next) => select(prompts[next].key, current.file)} onSelectFile={(file, element) => { if (prompt) select(prompt.key, file, element); }}
          onInspect={() => {
            setRelatedSession(selectedSession);
            setTraceOpen(true);
            setMobileOpen(false);
            requestAnimationFrame(() => {
              traceSummary.current?.focus({ preventScroll: true });
              traceSummary.current?.scrollIntoView?.({ block: window.matchMedia("(max-width: 760px)").matches ? "start" : "nearest" });
            });
          }} />
      </div>
      <details className="activity-trace" open={traceOpen} onToggle={(event) => setTraceOpen(event.currentTarget.open)}>
        <summary ref={traceSummary}><Icon name="right" className="trace-chevron size-3.5" /><span>Event stream</span><span className="trace-count">{eventCount.toLocaleString()}</span><span className="trace-scope">{scope}</span><span className="trace-hint">The details, when you need them.</span></summary>
        <div className="activity-trace-body" hidden={!traceOpen}>
          {related && <div className="trace-filter"><span>{scope}</span><button type="button" className="activity-text-button" onClick={() => setRelatedSession(null)}>Show all events</button></div>}
          <EventFeed events={events} selectedSession={selectedSession} sessionTitle={selectedSession ? sessionTitle(selectedSession) : undefined} eventIDs={related ? relatedIDs : undefined} activeEventID={activeEventID} cutoffEventID={cutoffEventID} onVisibleEventsChange={onVisibleEventsChange} />
        </div>
      </details>
      <span className="sr-only" role="status" aria-live="polite">{announcement}</span>
    </section>
  );
}
