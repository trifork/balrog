import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { SessionSummary } from "../../shared/viewer-protocol";
import { EventFeed } from "./EventFeed";
import { FileHeatmap } from "./FileHeatmap";
import { FileInspector } from "./FileInspector";
import { Icon } from "./Icon";
import { aggregateActivity, collectActivity, fileName, promptNumber, type ActivityMode, type ActivityPrompt } from "./file-activity-model";
import type { ReceivedEvent } from "./useViewer";

interface Selection {
  session: string;
  prompt: string | null;
  file: string | null;
}

const emptyEventIDs: ReadonlySet<number> = new Set();

export function FileActivity({ events, sessions, selectedSession, activityPrompts, activeEventID, cutoffEventID, onVisibleEventsChange, jumpRequest, onPromptNavigate }: {
  events: ReceivedEvent[];
  sessions: SessionSummary[];
  selectedSession: string;
  activityPrompts?: ActivityPrompt[];
  activeEventID?: number;
  cutoffEventID?: number;
  onVisibleEventsChange?: (events: ReceivedEvent[]) => void;
  jumpRequest?: { id: number };
  onPromptNavigate?: (eventID: number | undefined) => void;
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
  const traceSummary = useRef<HTMLButtonElement>(null);
  const traceScroll = useRef<HTMLDivElement>(null);
  const prompts = useMemo(() => activityPrompts ?? collectActivity(events, selectedSession), [activityPrompts, events, selectedSession]);
  const current = selection.session === selectedSession ? selection : { session: selectedSession, prompt: null, file: null };
  const selectedPrompt = prompts.find((item) => item.key === current.prompt);
  const overview = !selectedPrompt;
  const summary = useMemo(() => aggregateActivity(prompts), [prompts]);
  const prompt = selectedPrompt ?? summary;
  const index = selectedPrompt ? prompts.indexOf(selectedPrompt) : -1;
  const allPaths = useMemo(() => [...new Set(prompts.flatMap((item) => [...item.files.keys()]))].sort((a, b) => a.localeCompare(b)), [prompts]);
  const paths = allPaths.filter((path) => path.toLowerCase().includes(search.trim().toLowerCase()));
  const sessionTitle = (sessionID: string) => sessions.find((session) => session.sessionID === sessionID)?.title || sessionID;
  const relatedIDs = prompt ? current.file ? prompt.fileEventIDs.get(current.file) ?? emptyEventIDs : prompt.eventIDs : emptyEventIDs;
  const related = relatedSession === selectedSession && Boolean(prompt);
  const scope = related && prompt ? `${overview ? "All prompts" : `Prompt ${promptNumber(index)}`}${current.file ? ` / ${fileName(current.file)}` : " / all files"}` : "All events";
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
    if (!jumpRequest) return;
    setRelatedSession(null);
    setMobileOpen(false);
    setTraceOpen(true);
  }, [jumpRequest]);

  useLayoutEffect(() => {
    if (!traceOpen) return;
    if (!jumpRequest) {
      if (traceScroll.current) traceScroll.current.scrollTop = 0;
      return;
    }
    const frame = requestAnimationFrame(() => {
      const card = document.getElementById(`event-${jumpRequest.id}`);
      const scroller = traceScroll.current;
      if (!card || card.hidden || !scroller) return;
      const bounds = scroller.getBoundingClientRect();
      const rect = card.getBoundingClientRect();
      scroller.scrollTop += rect.top - bounds.top - (bounds.height - rect.height) / 2;
    });
    return () => cancelAnimationFrame(frame);
  }, [jumpRequest, traceOpen, related]);

  useEffect(() => {
    if (!traceOpen) return;
    const close = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setTraceOpen(false);
      traceSummary.current?.focus({ preventScroll: true });
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [traceOpen]);

  const resetPrompts = () => {
    setSelection({ session: selectedSession, prompt: null, file: null });
    setRelatedSession(null);
    setAnnouncement("Showing all prompts in the session.");
    onPromptNavigate?.(undefined);
  };
  const select = (key: string | null, file: string | null, element?: HTMLElement) => {
    if (element) opener.current = element;
    if (key === null && file === null) {
      resetPrompts();
      return;
    }
    setSelection({ session: selectedSession, prompt: key, file });
    if (key !== current.prompt) onPromptNavigate?.(prompts.find((item) => item.key === key)?.startEventID);
    setRelatedSession(key !== null || related ? selectedSession : null);
    setMobileOpen(true);
    setAnnouncement(`${key === null ? "All prompts" : `Prompt ${promptNumber(prompts.findIndex((item) => item.key === key))}`} selected${file ? `, ${file}` : ""}.`);
  };
  const closeInspector = () => {
    setMobileOpen(false);
    if (opener.current?.isConnected) opener.current.focus({ preventScroll: true });
  };

  return (
    <section className="activity-workspace" id="session-workspace" role="tabpanel" aria-label={selectedSession ? sessionTitle(selectedSession) : "All sessions"}
      onKeyDown={(event) => { if (event.key === "Escape" && mobileOpen && window.matchMedia("(max-width: 760px)").matches) { event.stopPropagation(); closeInspector(); } }}>
      <div className="activity-toolbar">
        <label className="activity-search"><Icon name="search" className="size-3.5" /><input type="search" aria-label="Find a file or folder" placeholder="Find a file or folder…" autoComplete="off" value={search} onChange={(event) => setSearch(event.target.value)} onKeyDown={(event) => { if (event.key === "Escape") setSearch(""); }} /></label>
        <div className="activity-filters" role="group" aria-label="Activity type">{([['all', 'All activity'], ['reads', 'Reads'], ['changes', 'Changes']] as const).map(([value, label]) => <button key={value} type="button" aria-pressed={mode === value} onClick={() => setMode(value)}>{label}</button>)}</div>
        <div className="activity-prompt-scope"><span>{overview ? "Session overview" : `Filtering prompt ${promptNumber(index)}`}</span><button type="button" className="activity-follow" aria-pressed={overview} onClick={resetPrompts}><Icon name={overview ? "layers" : "close"} className="size-3.5" />All prompts</button></div>
      </div>
      <div className="activity-body">
        <FileHeatmap key={selectedSession} prompts={prompts} paths={paths} mode={mode} selectedKey={selectedPrompt?.key} selectedFile={current.file} sessionTitle={sessionTitle} onSelect={select} />
        <FileInspector prompt={prompt} index={index} total={prompts.length} selectedFile={current.file} sessionTitle={selectedPrompt ? sessionTitle(selectedPrompt.activity.sessionID) : selectedSession ? sessionTitle(selectedSession) : "All sessions"}
          eventCount={relatedIDs.size} mobileOpen={mobileOpen} closeRef={closeRef} onClose={closeInspector}
          onNavigate={(next) => select(prompts[next].key, current.file)} onSelectFile={(file, element) => select(selectedPrompt?.key ?? null, file, element)}
          onInspect={() => {
            setRelatedSession(selectedSession);
            setTraceOpen(true);
            setMobileOpen(false);
             requestAnimationFrame(() => {
               traceSummary.current?.focus({ preventScroll: true });
             });
          }} />
      </div>
      <section className="activity-trace" data-open={traceOpen} aria-label="Event stream sheet">
        <button type="button" className="activity-trace-toggle" ref={traceSummary} aria-expanded={traceOpen} aria-controls="event-stream-sheet" aria-label={traceOpen ? "Collapse event stream" : "Expand event stream"} onClick={() => setTraceOpen((open) => !open)}>
          <span className="trace-grip" aria-hidden="true" /><Icon name="terminal" className="size-3.5" /><span>Event stream</span><span className="trace-count">{eventCount.toLocaleString()}</span><span className="trace-scope">{scope}</span><span className="trace-hint">{traceOpen ? "Timeline stays in view" : "Expand to inspect events"}</span><Icon name="down" className="trace-chevron size-3.5" />
        </button>
        <div id="event-stream-sheet" className="activity-trace-body" inert={!traceOpen} aria-hidden={!traceOpen}>
          <div className="activity-trace-scroll" ref={traceScroll}>
            {related && <div className="trace-filter"><span>{scope}</span><button type="button" className="activity-text-button" onClick={() => setRelatedSession(null)}>Show all events</button></div>}
            <EventFeed events={events} selectedSession={selectedSession} sessionTitle={selectedSession ? sessionTitle(selectedSession) : undefined} eventIDs={related ? relatedIDs : undefined} activeEventID={activeEventID} cutoffEventID={cutoffEventID} onVisibleEventsChange={onVisibleEventsChange} jumpRequest={jumpRequest} />
          </div>
        </div>
      </section>
      <span className="sr-only" role="status" aria-live="polite">{announcement}</span>
    </section>
  );
}
