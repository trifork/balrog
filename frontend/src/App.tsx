import { useEffect, useState } from "react";
import { FileActivity } from "./FileActivity";
import { Icon } from "./Icon";
import { SessionTabs } from "./SessionTabs";
import { StatusDot } from "./StatusDot";
import { useViewer } from "./useViewer";

const sessionFromURL = () => new URL(window.location.href).searchParams.get("session") || "";

export function App() {
  const { events, sessions, status, error } = useViewer();
  const [selected, setSelected] = useState(sessionFromURL);

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
    <div className="viewer-app group/app" data-connection={status}>
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
        <FileActivity events={events} sessions={sessions} selectedSession={selected} />
      </main>
      <footer className="viewer-footer" aria-label="Bottom bar"><span>Recorded file-tool activity</span><span>Select a cell to inspect · Arrow keys move between cells</span></footer>
    </div>
  );
}
