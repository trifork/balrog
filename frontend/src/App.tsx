import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from "react";
import { FileActivity } from "./FileActivity";
import { Icon } from "./Icon";
import { SessionTabs } from "./SessionTabs";
import { StatusDot } from "./StatusDot";
import { useViewer } from "./useViewer";
import { PermissionRequests } from "./PermissionRequests";
import { ReadWarning } from "./ReadWarning";
import { Timeline } from "./Timeline";
import { collectActivity } from "./file-activity-model";

const sessionFromURL = () => new URL(window.location.href).searchParams.get("session") || "";

export function App() {
  const { events, sessions, status, error, permissions, replyPermission } = useViewer();
  const [selected, setSelected] = useState(sessionFromURL);
  const [activeEventID, setActiveEventID] = useState<number>();
  const [followingLive, setFollowingLive] = useState(true);
  const [jumpRequest, setJumpRequest] = useState<{ id: number }>();
  const [promptJump, setPromptJump] = useState<{ id: number }>();
  const prompts = useMemo(() => collectActivity(events, selected), [events, selected]);
  const sessionEvents = useMemo(() => events.filter((message) => !selected || (message.session?.sessionID ?? message.event.sessionID) === selected), [events, selected]);
  const timelineEvents = useMemo(() => sessionEvents.filter((message) => String(message.event.tag) !== "session.text.delta"), [sessionEvents]);

  const scrubToEvent = useCallback((id: number) => {
    setPromptJump(undefined);
    setFollowingLive(false);
    setActiveEventID(id);
    setJumpRequest({ id });
  }, []);

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
    setFollowingLive(true);
    setActiveEventID(id);
    setJumpRequest(undefined);
    setPromptJump(id === undefined ? undefined : { id });
  }, []);

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
      setSelected(sessionFromURL());
      resumeLive();
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [resumeLive]);

  const selectSession = (sessionID: string) => {
    if (selected === sessionID) return;
    const url = new URL(window.location.href);
    if (sessionID) url.searchParams.set("session", sessionID);
    else url.searchParams.delete("session");
    window.history.pushState(null, "", url);
    setSelected(sessionID);
    resumeLive();
  };

  return (
    <div className="viewer-app group/app min-w-0" data-connection={status}>
      <header className="viewer-header">
        <div className="flex items-center gap-2">
          <Icon name="flame" className="h-7 w-6 text-accent" />
          <div className="text-[23px] leading-[1.2] font-[720] tracking-[-1px]">balrog<span className="text-accent">.</span></div>
        </div>
        <SessionTabs sessions={sessions} selected={selected} onSelect={selectSession} />
        <div className="flex items-center gap-2.5 max-[760px]:col-start-2 max-[760px]:row-start-1 max-[760px]:gap-2">
          <div className="inline-flex items-center gap-2 justify-self-end rounded-[20px] border border-[#d5ac6d24] bg-[#d5ac6d08] px-[9px] py-1 text-[11px] whitespace-nowrap text-[#d5ac6d] group-data-[connection=live]/app:border-[#86cfa124] group-data-[connection=live]/app:bg-[#86cfa108] group-data-[connection=live]/app:text-[#a6d9b8] max-[760px]:px-2 max-[760px]:text-[10px]" role="status"><StatusDot /><span>{status === "live" ? "Live stream" : status === "connecting" ? "Connecting" : "Reconnecting"}</span></div>
        </div>
      </header>
      <main className="viewer-main">
        {error && <p role="alert" className="viewer-error">{error}</p>}
        {permissions.length > 0 && <div className="max-h-[35dvh] shrink-0 overflow-auto px-7 pt-4 [&>.read-approvals]:mb-0 max-[760px]:px-3">
          <PermissionRequests requests={permissions} sessions={sessions} live={status === "live"} onReply={replyPermission} />
        </div>}
        <FileActivity events={events} sessions={sessions} selectedSession={selected} activityPrompts={prompts} activeEventID={activeEventID} cutoffEventID={followingLive ? undefined : activeEventID ?? 0} jumpRequest={jumpRequest} onPromptNavigate={navigatePrompt} />
      </main>
      <footer className="viewer-timeline min-w-0 border-t border-line bg-frame" aria-label="Bottom bar"><Timeline events={timelineEvents} prompts={prompts} activeEventID={activeEventID} centerRequest={promptJump} onSelect={scrubToEvent} followingLive={followingLive} onToggleLive={toggleLive} /></footer>
      <ReadWarning requests={permissions} live={status === "live"} />
    </div>
  );
}
