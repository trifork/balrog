import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import type { FileTouch } from "../../server/file-activity";
import { Icon } from "./Icon";
import { fileActivityRows, fileName, groupWorkspacePaths, heatLevel, matchesMode, metricLabel, operationCount, promptNumber, type ActivityMode, type ActivityPrompt } from "./file-activity-model";
import { FileActivityTooltip } from "./FileActivityTooltip";
import { useStickyHeatmapFolders } from "./useStickyHeatmapFolders";
import type { SubagentStart } from "./subagent-model";

interface Props {
  prompts: ActivityPrompt[];
  paths: string[];
  mode: ActivityMode;
  selectedKey?: string;
  selectedFile: string | null;
  sessionTitle: (sessionID: string) => string;
  onSelect: (key: string | null, file: string | null, opener: HTMLElement) => void;
  promptSubagents?: ReadonlyMap<string, SubagentStart[]>;
  onSelectSubagent?: (sessionID: string) => void;
}

const noTouches: FileTouch[] = [];

export function FileHeatmap({ prompts, paths, mode, selectedKey, selectedFile, sessionTitle, onSelect, promptSubagents, onSelectSubagent }: Props) {
  const [collapsed, setCollapsed] = useState(new Set<string>());
  const [hover, setHover] = useState<{ path: string; key: string; rect: DOMRect } | null>(null);
  const [focused, setFocused] = useState<{ path: string; key: string } | null>(null);
  const [fileColumnPinned, setFileColumnPinned] = useState(true);
  const scroll = useRef<HTMLDivElement>(null);
  const table = useRef<HTMLTableElement>(null);
  const groups = useMemo(() => {
    const workspaceGroups = groupWorkspacePaths(prompts, paths);
    // Prompt headings (and subagent starts) remain visible even without file operations.
    return (workspaceGroups.length ? workspaceGroups : [{ workspace: "workspace" as const, label: "In workspace", paths: [] }]).map((group) => ({
      ...group, rows: fileActivityRows(group.paths, group.workspace, collapsed),
    }));
  }, [prompts, paths, collapsed]);
  const stickyInset = useStickyHeatmapFolders(scroll, table, groups);
  const visiblePaths = groups.flatMap((group) => group.rows.flatMap((row) => row.kind === "file" ? [row.path] : []));
  const selectedIndex = prompts.findIndex((prompt) => prompt.key === selectedKey);
  const tabStop = focused && visiblePaths.includes(focused.path) && prompts.some((prompt) => prompt.key === focused.key)
    ? focused : { path: visiblePaths.includes(selectedFile ?? "") ? selectedFile : visiblePaths[0], key: selectedKey ?? prompts.at(-1)?.key };

  const reveal = (element: HTMLElement, vertically = false) => {
    if (!scroll.current || !table.current) return;
    const bounds = scroll.current.getBoundingClientRect();
    const rect = element.getBoundingClientRect();
    const labelWidth = fileColumnPinned ? table.current.querySelector("tbody th")?.getBoundingClientRect().width ?? 220 : 0;
    if (rect.right > bounds.right - 16) scroll.current.scrollLeft += rect.right - bounds.right + 24;
    if (rect.left < bounds.left + labelWidth) scroll.current.scrollLeft -= bounds.left + labelWidth - rect.left + 12;
    if (vertically) {
      const headerHeight = stickyInset(element);
      if (rect.bottom > bounds.bottom - 12) scroll.current.scrollTop += rect.bottom - bounds.bottom + 20;
      if (rect.top < bounds.top + headerHeight) scroll.current.scrollTop -= bounds.top + headerHeight - rect.top + 12;
    }
  };

  useEffect(() => {
    const selected = table.current?.querySelector<HTMLElement>(`.heatmap-cell[data-column="${selectedIndex}"]`);
    if (selected) reveal(selected);
    setHover(null);
  }, [selectedIndex, prompts.length, fileColumnPinned]);

  useEffect(() => {
    const viewport = scroll.current;
    const header = table.current?.querySelector("tbody th");
    if (!viewport || !header) return;
    const measure = () => {
      const promptWidth = table.current?.querySelector(".heatmap-prompt-title")?.getBoundingClientRect().width ?? 0;
      setFileColumnPinned(header.getBoundingClientRect().width + Math.max(60, promptWidth + 16) <= viewport.clientWidth);
    };
    measure();
    const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(measure);
    observer?.observe(viewport);
    observer?.observe(header);
    return () => observer?.disconnect();
  }, [prompts.length, groups[0]?.workspace]);

  useEffect(() => {
    const dismiss = () => setHover(null);
    window.addEventListener("resize", dismiss);
    return () => window.removeEventListener("resize", dismiss);
  }, []);

  const showTooltip = (element: HTMLElement, path: string, key: string) => {
    setHover({ path, key, rect: element.getBoundingClientRect() });
  };

  const navigate = (event: KeyboardEvent<HTMLButtonElement>, path: string, column: number) => {
    if (event.key === "Escape") { setHover(null); return; }
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const row = visiblePaths.indexOf(path);
    const nextRow = Math.max(0, Math.min(visiblePaths.length - 1, row + (event.key === "ArrowDown" ? 1 : event.key === "ArrowUp" ? -1 : 0)));
    const nextColumn = event.key === "Home" ? 0 : event.key === "End" ? prompts.length - 1
      : Math.max(0, Math.min(prompts.length - 1, column + (event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0)));
    const target = table.current?.querySelector<HTMLButtonElement>(`button[data-row="${nextRow}"][data-column="${nextColumn}"]`);
    target?.focus({ preventScroll: true });
    if (target) reveal(target, true);
  };

  const hoveredPrompt = prompts.find((prompt) => prompt.key === hover?.key);

  return (
    <section className="activity-map" aria-label="File activity heatmap">
      <div className="activity-map-heading">
        <div><h2 className="activity-eyebrow">Activity map</h2><span className="activity-map-size">{paths.length} files × {prompts.length} prompts</span></div>
      </div>
      <div className="heatmap-scroll" ref={scroll} data-file-column-pinned={fileColumnPinned || undefined} onScroll={() => setHover(null)}>
        {prompts.length === 0 ? <div className="activity-empty"><Icon name="activity" className="size-8 text-accent" /><h3>Ready when you are</h3><p>Waiting for a recorded prompt or execution. File activity will appear here as your agent works.</p></div> : (
          <>
            <table className="heatmap" ref={table} style={{ "--prompt-count": prompts.length } as CSSProperties} aria-label="File operations by prompt">
              <caption className="sr-only">Rows are observed files grouped by whether they are in or outside the recorded workspace. Files without enough workspace context are marked unknown. Columns are prompts in recorded order. Cell intensity represents {metricLabel(mode)}. Select a cell to inspect its file and prompt; choose All prompts to reset.</caption>
              <colgroup><col className="heatmap-file-column" />{prompts.map((prompt) => <col key={prompt.key} />)}</colgroup>
              {groups.map((group, groupIndex) => <tbody key={group.workspace} aria-label={group.label} data-workspace={group.workspace}>
                <tr className="heatmap-scope" data-prompt-headings={groupIndex === 0 || undefined}>
                  <th scope="rowgroup"><span className="heatmap-scope-label">{group.label}<small>{group.paths.length} {group.paths.length === 1 ? "file" : "files"}</small></span></th>
                  {prompts.map((prompt, column) => groupIndex === 0
                    ? <th key={prompt.key} scope="col" className="heatmap-prompt-title" title={prompt.activity.text}
                      aria-label={`Prompt ${promptNumber(column)}: ${prompt.activity.text}`} data-selected={prompt.key === selectedKey || undefined}>Prompt {promptNumber(column)}
                        {promptSubagents?.get(prompt.key)?.map((start) => {
                          const url = new URL(window.location.href);
                          url.pathname = "/";
                          url.searchParams.set("session", start.sessionID);
                          return <a key={start.sessionID} href={`${url.pathname}${url.search}${url.hash}`}
                            className="ml-1 inline-block rounded border border-accent/40 px-1 font-mono text-accent hover:bg-accent/10"
                            aria-label={`${start.label}: ${sessionTitle(start.sessionID)}, started during Prompt ${promptNumber(column)}`}
                            title={`${start.label}: ${sessionTitle(start.sessionID)} — ${start.timestamp === undefined ? "start time not recorded" : `started ${new Date(start.timestamp).toLocaleString()}`}`}
                            onClick={(event) => {
                              if (!onSelectSubagent || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                              event.preventDefault();
                              onSelectSubagent(start.sessionID);
                            }}>{start.label}</a>;
                        })}
                      </th>
                    : <td key={prompt.key} data-selected={prompt.key === selectedKey || undefined} />)}
                </tr>
                {group.rows.map((row) => {
                  const path = row.path;
                  if (row.kind === "folder") return <tr key={`folder:${path}`} className="heatmap-folder" style={{ "--tree-depth": row.depth } as CSSProperties}><th scope="rowgroup">
                  <button type="button" className="heatmap-folder-toggle" title={path} aria-expanded={!collapsed.has(row.key)} onClick={() => {
                    setCollapsed((previous) => { const next = new Set(previous); next.has(row.key) ? next.delete(row.key) : next.add(row.key); return next; });
                    setHover(null);
                  }}><Icon name="down" className="folder-chevron size-2.5" /><Icon name="folder" className="size-3" /><span>{row.label}</span><small>{row.count}</small></button>
                </th>{prompts.map((prompt) => <td key={prompt.key} data-selected={prompt.key === selectedKey || undefined} />)}</tr>;
                  return <tr key={`file:${path}`} className="heatmap-file" style={{ "--tree-depth": row.depth } as CSSProperties} data-selected={path === selectedFile || undefined}>
                  <th scope="row" className="heatmap-file-label"><button type="button" title={path} onClick={(event) => onSelect(selectedKey ?? null, path, event.currentTarget)}><span className="heatmap-file-type">{fileName(path).includes(".") ? fileName(path).split(".").at(-1)?.slice(0, 3).toUpperCase() : "·"}</span><span className="heatmap-file-name font-mono">{fileName(path)}</span></button></th>
                  {prompts.map((prompt, column) => {
                    const touches = prompt.files.get(path) ?? noTouches;
                    const count = operationCount(touches, mode);
                    const attempts = touches.filter((touch) => matchesMode(touch, mode));
                    const reverted = attempts.some((touch) => touch.reverted);
                    const failed = attempts.some((touch) => touch.outcome === "failed");
                    const pending = attempts.some((touch) => touch.outcome === "pending");
                    return <td key={prompt.key} data-selected={column === selectedIndex || undefined}><button type="button" className="heatmap-cell"
                      data-heat={heatLevel(count)} data-reverted={reverted || undefined} data-failed={failed || undefined} data-pending={pending || undefined}
                      data-row={visiblePaths.indexOf(path)} data-column={column}
                      tabIndex={tabStop.path === path && tabStop.key === prompt.key ? 0 : -1}
                      aria-pressed={prompt.key === selectedKey && path === selectedFile}
                      aria-label={`${path}, prompt ${promptNumber(column)}: ${count} ${metricLabel(mode)}${reverted ? ", reverted actions" : ""}${failed ? ", failed attempts" : ""}${pending ? ", pending attempts" : ""}`}
                      aria-describedby={hover?.path === path && hover.key === prompt.key ? "file-activity-tooltip" : undefined}
                      onClick={(event) => { setHover(null); onSelect(prompt.key, path, event.currentTarget); }}
                      onPointerEnter={(event) => { if (event.pointerType !== "touch") showTooltip(event.currentTarget, path, prompt.key); }} onPointerLeave={() => setHover(null)}
                      onFocus={(event) => { setFocused({ path, key: prompt.key }); showTooltip(event.currentTarget, path, prompt.key); }} onBlur={() => setHover(null)}
                      onKeyDown={(event) => navigate(event, path, column)}>{count || ""}</button></td>;
                  })}
                </tr>;
              })}</tbody>)}
            </table>
            {!paths.length && <div className="activity-empty"><h3>No matching files</h3><p>Try a different search, or wait for explicit file activity to be recorded.</p></div>}
          </>
        )}
      </div>
      <div className="heatmap-legend">
        <div className="heatmap-key" aria-label="Heat scale: zero operations, 1, 2 to 3, 4 to 7, 8 or more"><span>{mode === "all" ? "Operations" : mode === "reads" ? "Reads" : "Changes"}</span>{["0", "1", "2–3", "4–7", "8+"].map((label, index) => <span key={label}><i data-heat={index} />{label}</span>)}</div>
        <div className="heatmap-markers"><span><i className="marker-reverted" />Reverted</span><span><i className="marker-failed" />Failed</span><span><i className="marker-pending" />Pending</span></div>
      </div>
      {hover && hoveredPrompt && <FileActivityTooltip path={hover.path} prompt={hoveredPrompt} sessionTitle={sessionTitle(hoveredPrompt.activity.sessionID)} anchor={hover.rect} />}
    </section>
  );
}
