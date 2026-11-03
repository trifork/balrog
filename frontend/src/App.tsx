import { useEffect, useState } from "react";
import { EventFeed } from "./EventFeed";
import { Icon } from "./Icon";
import { SessionTabs } from "./SessionTabs";
import { StatusDot } from "./StatusDot";
import { useViewer } from "./useViewer";

const sessionFromURL = () => new URL(window.location.href).searchParams.get("session") || "";

export function App() {
  const { events, sessions, status, error } = useViewer();
  const [selected, setSelected] = useState(sessionFromURL);
  const [rightPaneOpen, setRightPaneOpen] = useState(true);
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
    <div className="group/app grid h-screen min-w-0 grid-rows-[auto_minmax(0,1fr)_32px] overflow-hidden supports-[height:100dvh]:h-dvh" data-connection={status}>
      <header className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-4 border-b border-line bg-frame px-4 max-[760px]:grid-cols-[minmax(0,1fr)_auto] max-[760px]:gap-x-3 max-[760px]:gap-y-0 max-[760px]:px-3 max-[760px]:pt-2 max-[480px]:px-2.5">
        <div className="flex items-center gap-2">
          <div className="grid h-[30px] w-7 place-items-center rounded-[8px] border border-[#ff9a6630] bg-[linear-gradient(145deg,#ffae7924,#ff733309)] text-accent"><Icon name="flame" className="size-5" /></div>
          <div className="text-[20px] leading-[1.2] font-[720] tracking-[-1px]">balrog<span className="text-accent">.</span></div>
        </div>
        <SessionTabs sessions={sessions} selected={selected} onSelect={selectSession} />
        <div className="flex items-center gap-2.5 max-[760px]:col-start-2 max-[760px]:row-start-1 max-[760px]:gap-2">
          <div className="inline-flex items-center gap-2 justify-self-end rounded-[20px] border border-[#d5ac6d24] bg-[#d5ac6d08] px-[9px] py-1 text-[11px] whitespace-nowrap text-[#d5ac6d] group-data-[connection=live]/app:border-[#86cfa124] group-data-[connection=live]/app:bg-[#86cfa108] group-data-[connection=live]/app:text-[#a6d9b8] max-[760px]:px-2 max-[760px]:text-[10px]" role="status"><StatusDot /><span>{status === "live" ? "Live stream" : status === "connecting" ? "Connecting" : "Reconnecting"}</span></div>
          <button className="grid size-8 place-items-center rounded-[6px] bg-transparent p-0 text-muted hover:border-[#45464d] hover:bg-[#2b2c31] hover:text-white aria-expanded:border-[#ff9a6630] aria-expanded:bg-[#ff9a6608] aria-expanded:text-accent" type="button" aria-expanded={rightPaneOpen} aria-controls="right-pane"
            aria-label={rightPaneOpen ? "Collapse right pane" : "Expand right pane"} title={rightPaneOpen ? "Collapse right pane" : "Expand right pane"}
            onClick={() => setRightPaneOpen((open) => !open)}><Icon name="panel" /></button>
        </div>
      </header>
      <div className="grid min-h-0 min-w-0 grid-cols-2 overflow-hidden data-[pane-open=false]:grid-cols-1" data-pane-open={rightPaneOpen}>
        <main className="min-h-0 min-w-0 w-full overflow-auto overscroll-contain p-4 pb-6 max-[760px]:px-3 max-[760px]:pt-3.5 max-[480px]:px-2.5 max-[480px]:pt-3 max-[480px]:pb-5">
          {error && <p role="alert">{error}</p>}
          <EventFeed events={events} selectedSession={selected} sessionTitle={sessionTitle} />
        </main>
        <aside id="right-pane" className="min-h-0 min-w-0 border-l border-line bg-frame" aria-label="Right pane" hidden={!rightPaneOpen} />
      </div>
      <footer className="border-t border-line bg-frame" aria-label="Bottom bar" />
    </div>
  );
}
