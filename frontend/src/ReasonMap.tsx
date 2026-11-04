import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { SessionSummary, ViewerMessage } from "../../shared/viewer-protocol";
import { Icon } from "./Icon";
import { promptNumber } from "./file-activity-model";
import { reasonMap, type AccessReason } from "./reason-map-model";
import { usePromptSelection } from "./usePromptSelection";
import { ReasonTooltip } from "./ReasonTooltip";

interface ReasonTarget {
  path: string;
  key: AccessReason["key"];
  anchor: HTMLButtonElement;
}

export function ReasonMap({ events, selectedSession, sessions, sessionLabel }: {
  events: ViewerMessage[];
  selectedSession: string;
  sessions: SessionSummary[];
  sessionLabel?: string;
}) {
  const [search, setSearch] = useState("");
  const [hovered, setHovered] = useState<ReasonTarget>();
  const [focused, setFocused] = useState<ReasonTarget>();
  const tooltipID = useId();
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const keepHover = () => { if (hoverTimer.current !== null) clearTimeout(hoverTimer.current); };
  const leaveHover = () => { keepHover(); hoverTimer.current = setTimeout(() => setHovered(undefined), 150); };
  useEffect(() => () => { if (hoverTimer.current !== null) clearTimeout(hoverTimer.current); }, []);
  const [pinned, setPinned] = useState<AccessReason["key"]>();
  const highlighted = (reason: AccessReason) => reason.key === hovered?.key || reason.key === focused?.key || reason.key === pinned;
  const { prompts } = useMemo(() => reasonMap(events, selectedSession), [events, selectedSession]);
  const activityPrompts = useMemo(() => prompts.map(({ prompt }) => prompt), [prompts]);
  const { isSelected, select } = usePromptSelection(activityPrompts);
  const files = useMemo(() => {
    const retained = new Map<string, Map<AccessReason["key"], AccessReason>>();
    for (const { prompt, files } of prompts) {
      if (!isSelected(prompt.key)) continue;
      for (const [path, reasons] of files) {
        const entries = retained.get(path) ?? new Map<AccessReason["key"], AccessReason>();
        for (const reason of reasons) {
          const previous = entries.get(reason.key);
          entries.set(reason.key, {
            ...reason,
            outcomes: [...new Set([...(previous?.outcomes ?? []), ...reason.outcomes])],
            callIDs: [...new Set([...(previous?.callIDs ?? []), ...reason.callIDs])],
          });
        }
        retained.set(path, entries);
      }
    }
    return retained;
  }, [prompts, isSelected]);
  const paths = [...files.keys()].sort((a, b) => a.localeCompare(b));
  const visiblePaths = paths.filter((path) => path.toLowerCase().includes(search.trim().toLowerCase()));
  const sessionTitle = (sessionID: string) => sessions.find((session) => session.sessionID === sessionID)?.title || sessionID;
  const clearHighlight = () => { keepHover(); setPinned(undefined); setHovered(undefined); setFocused(undefined); };
  const selectPrompt = (key: string, toggle: boolean) => {
    select(key, toggle);
    clearHighlight();
  };
  const target = hovered ?? focused;
  const tooltipReason = target && visiblePaths.includes(target.path) ? files.get(target.path)?.get(target.key) : undefined;
  const reasonButton = (path: string, reason: AccessReason) => <button type="button" className="reason-entry" key={JSON.stringify(reason.key)}
    aria-describedby={tooltipReason && target?.path === path && target.key === reason.key ? tooltipID : undefined}
    data-highlighted={highlighted(reason) || undefined} aria-pressed={reason.key === pinned}
    onMouseEnter={(event) => { keepHover(); setHovered({ path, key: reason.key, anchor: event.currentTarget }); }} onMouseLeave={leaveHover}
    onFocus={(event) => setFocused({ path, key: reason.key, anchor: event.currentTarget })} onBlur={() => setFocused(undefined)} onClick={() => setPinned(reason.key)}>{reason.label}</button>;

  return (
    <section className="reason-workspace" id="session-workspace" role="tabpanel" aria-label={sessionLabel ?? (selectedSession ? sessionTitle(selectedSession) : "All sessions")} onKeyDown={(event) => { if (event.key === "Escape") clearHighlight(); }}>
      <div className="reason-toolbar">
        <h1>File access reasons</h1>
        <label className="activity-search"><Icon name="search" className="size-3.5" /><input type="search" aria-label="Find a file" placeholder="Find a file…" autoComplete="off" value={search} onChange={(event) => setSearch(event.target.value)} onKeyDown={(event) => { if (event.key === "Escape") setSearch(""); }} /></label>
        {pinned !== undefined && <button className="reason-clear" type="button" onClick={clearHighlight}>Clear highlight</button>}
      </div>
      <div className="reason-map-scroll">
        <table className="reason-map" aria-label="File access reasons">
          <thead><tr><th scope="col">File</th><th scope="col">Reasons</th></tr></thead>
          <tbody>{visiblePaths.map((path) => <tr key={path}>
            <th scope="row">{path}</th>
            <td data-highlighted={[...files.get(path)!.values()].some(highlighted) || undefined}><div className="reason-entries">{[...files.get(path)!.values()].map((reason) => reasonButton(path, reason))}</div></td>
          </tr>)}</tbody>
        </table>
      </div>
      {tooltipReason && target && <ReasonTooltip id={tooltipID} reason={tooltipReason} anchor={target.anchor} onMouseEnter={keepHover} onMouseLeave={leaveHover} />}
      {!visiblePaths.length && <p className="reason-empty">{!prompts.length ? "No recorded file activity." : prompts.every(({ prompt }) => !isSelected(prompt.key)) ? "No prompts selected." : paths.length ? "No matching files." : "No file activity for the selected prompts."}</p>}
      {prompts.length > 0 && <section className="reason-prompts" role="group" aria-label="Prompts">
        <h2>Prompts</h2>
        <div className="reason-prompt-list">{prompts.map(({ prompt, files }, index) => <button type="button" className="reason-prompt" key={prompt.key}
          aria-pressed={isSelected(prompt.key)} title={`${sessionTitle(prompt.activity.sessionID)} (click to select only; Shift-click to toggle)`}
          data-highlighted={[...files.values()].some((reasons) => reasons.some(highlighted)) || undefined}
          onClick={(event) => selectPrompt(prompt.key, event.shiftKey)}>
          <span className="reason-prompt-number">Prompt {promptNumber(index)}</span><span className="reason-prompt-text">{prompt.activity.text || "No prompt text recorded"}</span>
        </button>)}</div>
      </section>}
    </section>
  );
}
