import { useCallback, useEffect, useLayoutEffect, useMemo, useState, type KeyboardEvent } from "react";
import { FileActivity } from "./FileActivity";
import { Icon } from "./Icon";
import { SessionTabs } from "./SessionTabs";
import { StatusDot } from "./StatusDot";
import { useViewer } from "./useViewer";
import { PermissionRequests } from "./PermissionRequests";
import { ReadWarning } from "./ReadWarning";
import { Timeline } from "./Timeline";
import { collectActivity, collectHeatmapActivity } from "./file-activity-model";
import { ReasonMap } from "./ReasonMap";
import { Capabilities } from "./Capabilities";

const views = [
  { key: "activity", path: "/", title: "Activity map" },
  { key: "capabilities", path: "/capabilities", title: "Capabilities" },
  { key: "reason", path: "/reason", title: "Reasons" },
] as const;

const sessionsFromURL = () => {
  const params = new URL(window.location.href).searchParams;
  return params.has("session") ? [...new Set(params.getAll("session").filter(Boolean))] : null;
};

export function App() {
  const { events, sessions, heatmaps, status, error, permissions, replyPermission } = useViewer();
  const [selectedSessions, setSelectedSessions] = useState(sessionsFromURL);
  const [pathname, setPathname] = useState(() => window.location.pathname);
  const reasonsPage = pathname === "/reason" || pathname === "/reason/";
  const capabilitiesPage = pathname === "/capabilities" || pathname === "/capabilities/";
  const simplePage = reasonsPage || capabilitiesPage;
  const selected = selectedSessions?.length === 1 ? selectedSessions[0] : "";
  const simpleEvents = useMemo(() => selectedSessions === null ? events : events.filter((message) =>
    selectedSessions.includes(message.session?.sessionID ?? message.event.sessionID ?? "")), [events, selectedSessions]);
  const selectionKey = JSON.stringify(selectedSessions);
  const sessionLabel = selectedSessions === null ? "All sessions" : !selectedSessions.length ? "No sessions selected"
    : selectedSessions.map((id) => sessions.find((session) => session.sessionID === id)?.title || id).join(", ");
  const page = reasonsPage ? "reason" : capabilitiesPage ? "capabilities" : "activity";
  const [activeEventID, setActiveEventID] = useState<number>();
  const [followingLive, setFollowingLive] = useState(true);
  const [jumpRequest, setJumpRequest] = useState<{ id: number }>();
  const [promptJump, setPromptJump] = useState<{ id: number }>();
  const [highlightedEventIDs, setHighlightedEventIDs] = useState<ReadonlySet<number>>(() => new Set());
  const prompts = useMemo(() => collectHeatmapActivity(heatmaps, selected), [heatmaps, selected]);
  const cutoffEventID = followingLive ? undefined : activeEventID ?? 0;
  const activityPrompts = useMemo(() => cutoffEventID === undefined ? prompts
    : collectActivity(events.filter((message) => message.id <= cutoffEventID), selected), [events, selected, prompts, cutoffEventID]);
  const sessionEvents = useMemo(() => events.filter((message) => !selected || (message.session?.sessionID ?? message.event.sessionID) === selected), [events, selected]);
  const timelineEvents = useMemo(() => sessionEvents.filter((message) => String(message.event.tag) !== "session.text.delta"), [sessionEvents]);

  const scrubToEvent = useCallback((id: number) => {
    setPromptJump(undefined);
    setFollowingLive(false);
    setActiveEventID(id);
    setJumpRequest(undefined);
  }, []);

  const inspectEvent = useCallback((id: number) => {
    scrubToEvent(id);
    setJumpRequest({ id });
  }, [scrubToEvent]);

  useLayoutEffect(() => {
    if (!followingLive) return;
    const latest = sessionEvents.at(-1);
    const card = latest ? document.getElementById(`event-${latest.id}`) : null;
    const scroller = card?.closest<HTMLElement>(".activity-trace-scroll");
    if (card && !card.hidden && scroller) scroller.scrollTop = 0;
  }, [followingLive, sessionEvents]);

  const resumeLive = useCallback(() => {
    setFollowingLive(true);
    setActiveEventID(undefined);
    setJumpRequest(undefined);
    setPromptJump(undefined);
  }, []);

  const navigatePrompt = useCallback((id: number | undefined) => {
    setActiveEventID((previous) => id ?? (followingLive ? undefined : previous));
    setJumpRequest(undefined);
    setPromptJump(id === undefined ? undefined : { id });
  }, [followingLive]);

  const toggleLive = () => {
    if (!followingLive) {
      resumeLive();
      return;
    }
    const latest = timelineEvents.at(-1);
    if (latest) scrubToEvent(latest.id);
  };

  useEffect(() => {
    const onPopState = () => {
      setSelectedSessions(sessionsFromURL());
      setPathname(window.location.pathname);
      resumeLive();
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [resumeLive]);

  const selectSession = (sessionID: string, toggle = false) => {
    let next = sessionID ? [sessionID] : null;
    if (simplePage && toggle && sessionID) {
      const current = selectedSessions ?? sessions.map((session) => session.sessionID);
      next = current.includes(sessionID) ? current.filter((id) => id !== sessionID) : [...current, sessionID];
    }
    if (JSON.stringify(next) === selectionKey) return;
    const url = new URL(window.location.href);
    if (next === null) url.searchParams.delete("session");
    else {
      url.searchParams.set("session", next[0] ?? "");
      for (const id of next.slice(1)) url.searchParams.append("session", id);
    }
    window.history.pushState(null, "", url);
    setSelectedSessions(next);
    resumeLive();
  };

  const selectView = (view: typeof views[number]) => {
    if (view.key === page) return;
    const url = new URL(window.location.href);
    url.pathname = view.path;
    window.history.pushState(null, "", url);
    setPathname(view.path);
    setHighlightedEventIDs(new Set());
    resumeLive();
  };

  const navigateViews = (event: KeyboardEvent<HTMLElement>) => {
    const target = event.target;
    if (!(target instanceof HTMLAnchorElement)) return;
    const index = views.findIndex((view) => view.key === target.dataset.view);
    if (index < 0) return;
    let next: number;
    if (event.key === "ArrowRight") next = (index + 1) % views.length;
    else if (event.key === "ArrowLeft") next = (index + views.length - 1) % views.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = views.length - 1;
    else if (event.key === " ") next = index;
    else return;
    event.preventDefault();
    selectView(views[next]);
    event.currentTarget.querySelector<HTMLAnchorElement>(`#view-tab-${views[next].key}`)?.focus({ preventScroll: true });
  };

  return (
    <div className="viewer-app group/app min-w-0" data-connection={status} data-page={page}>
      <header className="viewer-header">
        <div className="flex items-center gap-2">
          <Icon name="flame" className="h-7 w-6 text-accent" />
          <div className="text-[23px] leading-[1.2] font-[720] tracking-[-1px]">balrog<span className="text-accent">.</span></div>
        </div>
        <SessionTabs sessions={sessions} selected={selected} selectedSessions={simplePage ? selectedSessions : undefined} onSelect={selectSession} />
        <div className="flex items-center gap-2.5 max-[760px]:col-start-2 max-[760px]:row-start-1 max-[760px]:gap-2">
          <div className="inline-flex items-center gap-2 justify-self-end rounded-[20px] border border-[#d5ac6d24] bg-[#d5ac6d08] px-[9px] py-1 text-[11px] whitespace-nowrap text-[#d5ac6d] group-data-[connection=live]/app:border-[#86cfa124] group-data-[connection=live]/app:bg-[#86cfa108] group-data-[connection=live]/app:text-[#a6d9b8] max-[760px]:px-2 max-[760px]:text-[10px]" role="status"><StatusDot /><span className="max-[480px]:sr-only">{status === "live" ? "Live stream" : status === "connecting" ? "Connecting" : "Reconnecting"}</span></div>
        </div>
      </header>
      <main className="viewer-main">
        <nav className="viewer-view-tabs" role="tablist" aria-label="Views" aria-orientation="horizontal" onKeyDown={navigateViews}>
          {views.map((view) => <a key={view.key} id={`view-tab-${view.key}`} role="tab" data-view={view.key}
            aria-selected={view.key === page} aria-controls="view-workspace" tabIndex={view.key === page ? 0 : -1}
            href={`${view.path}${window.location.search}`} onClick={(event) => {
              if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
              event.preventDefault();
              selectView(view);
            }}>{view.title}</a>)}
        </nav>
        <div className="viewer-view-panel" id="view-workspace" role="tabpanel" aria-labelledby={`view-tab-${page}`}>
        {error && <p role="alert" className="viewer-error">{error}</p>}
        {!simplePage && permissions.length > 0 && <div className="max-h-[35dvh] shrink-0 overflow-auto px-7 pt-4 [&>.read-approvals]:mb-0 max-[760px]:px-3">
          <PermissionRequests requests={permissions} sessions={sessions} live={status === "live"} onReply={replyPermission} />
        </div>}
        {reasonsPage ? <ReasonMap key={selectionKey} events={simpleEvents} sessions={sessions} selectedSession={selected} sessionLabel={sessionLabel} />
          : capabilitiesPage ? <Capabilities key={selectionKey} events={simpleEvents} sessions={sessions} selectedSession={selected} sessionLabel={sessionLabel} />
          : <FileActivity events={events} sessions={sessions} selectedSession={selected} activityPrompts={activityPrompts} activeEventID={activeEventID} cutoffEventID={cutoffEventID} jumpRequest={jumpRequest} onPromptNavigate={navigatePrompt} onFileEventsChange={setHighlightedEventIDs} />}
        </div>
      </main>
      {!simplePage && <footer className="viewer-timeline min-w-0 border-t border-line bg-frame" aria-label="Bottom bar"><Timeline events={timelineEvents} evidenceEvents={events} prompts={prompts} activeEventID={activeEventID} centerRequest={promptJump} highlightedEventIDs={highlightedEventIDs} onSelect={scrubToEvent} onActivate={inspectEvent} followingLive={followingLive} onToggleLive={toggleLive} /></footer>}
      {!simplePage && <ReadWarning requests={permissions} live={status === "live"} />}
    </div>
  );
}
