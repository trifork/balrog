import { useCallback, useEffect, useLayoutEffect, useState } from "react";
import { FileActivity } from "./FileActivity";
import { Icon } from "./Icon";
import { PermissionRequests } from "./PermissionRequests";
import { ReadWarning } from "./ReadWarning";
import { SessionTabs } from "./SessionTabs";
import { StatusDot } from "./StatusDot";
import { Timeline } from "./Timeline";
import { useViewer, type ReceivedEvent } from "./useViewer";

const sessionFromURL = () =>
  new URL(window.location.href).searchParams.get("session") || "";

export function App() {
  const { events, sessions, status, error, permissions, replyPermission } =
    useViewer();
  const [selected, setSelected] = useState(sessionFromURL);
  const [timelineEvents, setTimelineEvents] = useState<ReceivedEvent[]>([]);
  const [activeEventID, setActiveEventID] = useState<number>();
  const [followingLive, setFollowingLive] = useState(true);
  const [jumpRequest, setJumpRequest] = useState<{ id: number }>();

  const scrubToEvent = useCallback((id: number) => {
    setFollowingLive(false);
    setActiveEventID(id);
    setJumpRequest({ id });
  }, []);

  useLayoutEffect(() => {
    if (!followingLive) return;
    const latest = timelineEvents.at(-1);
    const card = latest ? document.getElementById(`event-${latest.id}`) : null;
    if (card && !card.hidden)
      card.scrollIntoView?.({ block: "start", behavior: "instant" });
  }, [followingLive, timelineEvents]);

  const resumeLive = useCallback(() => {
    setFollowingLive(true);
    setActiveEventID(undefined);
    setJumpRequest(undefined);
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
      setTimelineEvents([]);
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
    setTimelineEvents([]);
    resumeLive();
  };

  return (
    <div
      className="viewer-app group/app min-w-0 grid-rows-[auto_minmax(0,1fr)_40px]"
      data-connection={status}
    >
      <header className="viewer-header">
        <div className="flex items-center gap-2">
          <Icon name="flame" className="h-7 w-6 text-accent" />
          <div className="text-[23px] leading-[1.2] font-[720] tracking-[-1px]">
            balrog<span className="text-accent">.</span>
          </div>
        </div>
        <SessionTabs
          sessions={sessions}
          selected={selected}
          onSelect={selectSession}
        />
        <div className="flex items-center gap-2.5 max-[760px]:col-start-2 max-[760px]:row-start-1 max-[760px]:gap-2">
          <div
            className="inline-flex items-center gap-2 justify-self-end rounded-[20px] border border-[#d5ac6d24] bg-[#d5ac6d08] px-[9px] py-1 text-[11px] whitespace-nowrap text-[#d5ac6d] group-data-[connection=live]/app:border-[#86cfa124] group-data-[connection=live]/app:bg-[#86cfa108] group-data-[connection=live]/app:text-[#a6d9b8] max-[760px]:px-2 max-[760px]:text-[10px]"
            role="status"
          >
            <StatusDot />
            <span>
              {status === "live"
                ? "Live stream"
                : status === "connecting"
                  ? "Connecting"
                  : "Reconnecting"}
            </span>
          </div>
        </div>
      </header>
      <main className="viewer-main">
        {error && (
          <p role="alert" className="viewer-error">
            {error}
          </p>
        )}
        {permissions.length > 0 && (
          <div className="max-h-[35dvh] shrink-0 overflow-auto px-7 pt-4 [&>.read-approvals]:mb-0 max-[760px]:px-3">
            <PermissionRequests
              requests={permissions}
              sessions={sessions}
              live={status === "live"}
              onReply={replyPermission}
            />
          </div>
        )}
        <FileActivity
          events={events}
          sessions={sessions}
          selectedSession={selected}
          activeEventID={activeEventID}
          cutoffEventID={followingLive ? undefined : (activeEventID ?? 0)}
          onVisibleEventsChange={setTimelineEvents}
          jumpRequest={jumpRequest}
        />
      </main>
      <footer
        className="min-w-0 border-t border-line bg-frame"
        aria-label="Bottom bar"
      >
        <Timeline
          events={timelineEvents}
          activeEventID={followingLive ? undefined : activeEventID}
          onSelect={scrubToEvent}
          followingLive={followingLive}
          onToggleLive={toggleLive}
        />
      </footer>
      <ReadWarning requests={permissions} live={status === "live"} />
    </div>
  );
}
