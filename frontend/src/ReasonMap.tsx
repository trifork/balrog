import { useEffect, useId, useMemo, useRef, useState, type CSSProperties } from "react";
import type { SessionSummary, ViewerMessage } from "../../shared/viewer-protocol";
import { Icon } from "./Icon";
import { fileActivityRows, fileName, groupWorkspacePaths, promptNumber } from "./file-activity-model";
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
  const [collapsed, setCollapsed] = useState(new Set<string>());
  const [fileColumnPinned, setFileColumnPinned] = useState(true);
  const scroll = useRef<HTMLDivElement>(null);
  const table = useRef<HTMLTableElement>(null);
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
  const groups = groupWorkspacePaths(activityPrompts.filter((prompt) => isSelected(prompt.key)), visiblePaths).map((group) => ({
    ...group, rows: fileActivityRows(group.paths, group.workspace, collapsed),
  }));
  const displayedPaths = new Set(groups.flatMap((group) => group.rows.flatMap((row) => row.kind === "file" ? [row.path] : [])));

  useEffect(() => {
    const viewport = scroll.current;
    const header = table.current?.querySelector("thead th");
    if (!viewport || !header) return;
    const measure = () => setFileColumnPinned(header.getBoundingClientRect().width + 210 <= viewport.clientWidth);
    measure();
    const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(measure);
    observer?.observe(viewport);
    observer?.observe(header);
    return () => observer?.disconnect();
  }, []);

  const sessionTitle = (sessionID: string) => sessions.find((session) => session.sessionID === sessionID)?.title || sessionID;
  const clearHighlight = () => { keepHover(); setPinned(undefined); setHovered(undefined); setFocused(undefined); };
  const selectPrompt = (key: string, toggle: boolean) => {
    select(key, toggle);
    clearHighlight();
  };
  const target = hovered ?? focused;
  const tooltipReason = target && displayedPaths.has(target.path) ? files.get(target.path)?.get(target.key) : undefined;
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
      <p className="mb-4 shrink-0 text-xs text-muted">Shows recorded reasons for accessing each file across the selected prompts.</p>
      <div className="reason-map-scroll" ref={scroll} data-file-column-pinned={fileColumnPinned || undefined}>
        <table className="reason-map" ref={table} aria-label="File access reasons">
          <thead><tr><th scope="col">File</th><th scope="col">Reasons</th></tr></thead>
          {groups.map((group) => <tbody key={group.workspace} aria-label={group.label} data-workspace={group.workspace}>
            <tr className="reason-scope"><th scope="rowgroup" colSpan={2}><span className="reason-scope-label">{group.label}<small>{group.paths.length} {group.paths.length === 1 ? "file" : "files"}</small></span></th></tr>
            {group.rows.map((row) => <tr key={`${row.kind}:${row.path}`} className={row.kind === "folder" ? "reason-folder" : "reason-file"} style={{ "--tree-depth": row.depth } as CSSProperties}>
              {row.kind === "folder" ? <>
                <th scope="rowgroup"><button type="button" className="reason-folder-toggle" title={row.path} aria-expanded={!collapsed.has(row.key)} onClick={() => {
                  setCollapsed((previous) => { const next = new Set(previous); next.has(row.key) ? next.delete(row.key) : next.add(row.key); return next; });
                  keepHover();
                  setHovered(undefined);
                  setFocused(undefined);
                }}><Icon name="down" className="folder-chevron size-2.5" /><Icon name="folder" className="size-3" /><span>{row.label}</span><small>{row.count}</small></button></th>
                <td />
              </> : <>
                <th scope="row" aria-label={row.path} title={row.path}><span className="reason-file-name">{fileName(row.path)}</span></th>
                <td data-highlighted={[...files.get(row.path)!.values()].some(highlighted) || undefined}><div className="reason-entries">{[...files.get(row.path)!.values()].map((reason) => reasonButton(row.path, reason))}</div></td>
              </>}
            </tr>)}
          </tbody>)}
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
