import { Fragment, useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import type { FileTouch } from "../../server/file-activity";
import { Icon } from "./Icon";
import { fileName, folderName, heatLevel, matchesMode, metricLabel, operationCount, promptNumber, type ActivityMode, type ActivityPrompt } from "./file-activity-model";

interface Props {
  prompts: ActivityPrompt[];
  paths: string[];
  mode: ActivityMode;
  selectedKey?: string;
  selectedFile: string | null;
  sessionTitle: (sessionID: string) => string;
  onSelect: (key: string, file: string | null, opener: HTMLElement) => void;
}

const noTouches: FileTouch[] = [];

export function FileHeatmap({ prompts, paths, mode, selectedKey, selectedFile, sessionTitle, onSelect }: Props) {
  const [collapsed, setCollapsed] = useState(new Set<string>());
  const [hover, setHover] = useState<{ path: string; key: string; x: number; y: number } | null>(null);
  const [focused, setFocused] = useState<{ path: string; key: string } | null>(null);
  const scroll = useRef<HTMLDivElement>(null);
  const table = useRef<HTMLTableElement>(null);
  const folders = [...new Set(paths.map(folderName))];
  const visiblePaths = paths.filter((path) => !collapsed.has(folderName(path)));
  const totals = prompts.map((prompt) => paths.filter((path) => operationCount(prompt.files.get(path) ?? noTouches, mode) > 0).length);
  const maximum = Math.max(1, ...totals);
  const selectedIndex = prompts.findIndex((prompt) => prompt.key === selectedKey);
  const tabStop = focused && visiblePaths.includes(focused.path) && prompts.some((prompt) => prompt.key === focused.key)
    ? focused : { path: visiblePaths.includes(selectedFile ?? "") ? selectedFile : visiblePaths[0], key: selectedKey ?? prompts.at(-1)?.key };

  const reveal = (element: HTMLElement, vertically = false) => {
    if (!scroll.current || !table.current) return;
    const bounds = scroll.current.getBoundingClientRect();
    const rect = element.getBoundingClientRect();
    const labelWidth = table.current.querySelector("th")?.getBoundingClientRect().width ?? 220;
    if (rect.right > bounds.right - 16) scroll.current.scrollLeft += rect.right - bounds.right + 24;
    if (rect.left < bounds.left + labelWidth) scroll.current.scrollLeft -= bounds.left + labelWidth - rect.left + 12;
    if (vertically) {
      const headerHeight = table.current.tHead?.getBoundingClientRect().height ?? 98;
      if (rect.bottom > bounds.bottom - 12) scroll.current.scrollTop += rect.bottom - bounds.bottom + 20;
      if (rect.top < bounds.top + headerHeight) scroll.current.scrollTop -= bounds.top + headerHeight - rect.top + 12;
    }
  };

  useEffect(() => {
    const selected = table.current?.querySelector<HTMLElement>(".heatmap-prompt[aria-pressed=true]");
    if (selected) reveal(selected);
    setHover(null);
  }, [selectedKey, prompts.length]);

  useEffect(() => {
    const dismiss = () => setHover(null);
    window.addEventListener("resize", dismiss);
    return () => window.removeEventListener("resize", dismiss);
  }, []);

  const showTooltip = (element: HTMLElement, path: string, key: string) => {
    const rect = element.getBoundingClientRect();
    setHover({ path, key, x: Math.max(12, Math.min(rect.left + rect.width / 2 - 140, window.innerWidth - 292)), y: Math.min(rect.bottom + 10, window.innerHeight - 160) });
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
  const hoveredTouches = hoveredPrompt?.files.get(hover?.path ?? "") ?? noTouches;

  return (
    <section className="activity-map" aria-label="File activity heatmap">
      <div className="activity-map-heading">
        <div><h2 className="activity-eyebrow">Activity map</h2><span className="activity-map-size">{paths.length} files × {prompts.length} prompts</span></div>
        <span className="activity-timeline">Earlier <Icon name="arrow" className="size-3" /> Latest</span>
      </div>
      <div className="heatmap-scroll" ref={scroll} onScroll={() => setHover(null)}>
        {prompts.length === 0 ? <div className="activity-empty"><Icon name="activity" className="size-8 text-accent" /><h3>Ready when you are</h3><p>Waiting for a recorded prompt or execution. File activity will appear here as your agent works.</p></div> : (
          <>
            <table className="heatmap" ref={table} style={{ "--prompt-count": prompts.length } as CSSProperties} aria-label="File operations by prompt">
              <caption className="sr-only">Rows are observed files. Columns are prompts in recorded order. Cell intensity represents {metricLabel(mode)}; column totals count distinct matching files.</caption>
              <colgroup><col className="heatmap-file-column" />{prompts.map((prompt) => <col key={prompt.key} />)}</colgroup>
              <thead><tr>
                <th scope="col" className="heatmap-corner"><span>Files per prompt <Icon name="arrow" className="size-3" /></span><small>Observed files</small></th>
                {prompts.map((prompt, column) => <th key={prompt.key} scope="col">
                  <button type="button" className="heatmap-prompt" aria-pressed={prompt.key === selectedKey} data-hovered={hover?.key === prompt.key || undefined}
                    aria-label={`Prompt ${promptNumber(column)}: ${prompt.activity.text}`}
                    title={`${sessionTitle(prompt.activity.sessionID)} · ${prompt.activity.text} · ${totals[column]} files`}
                    onClick={(event) => onSelect(prompt.key, null, event.currentTarget)}>
                    <span className="heatmap-total">{totals[column]}</span><span className="heatmap-bar-track"><span style={{ height: `${Math.max(3, totals[column] / maximum * 100)}%` }} /></span><span className="font-mono">{promptNumber(column)}</span>
                  </button>
                </th>)}
              </tr></thead>
              <tbody>{folders.map((folder) => <Fragment key={folder}>
                <tr className="heatmap-folder"><th colSpan={prompts.length + 1} scope="rowgroup">
                  <button type="button" className="heatmap-folder-toggle" title={folder} aria-expanded={!collapsed.has(folder)} onClick={() => {
                    setCollapsed((previous) => { const next = new Set(previous); next.has(folder) ? next.delete(folder) : next.add(folder); return next; });
                    setHover(null);
                  }}><Icon name="down" className="folder-chevron size-2.5" /><Icon name="folder" className="size-3" /><span>{folder === "/" ? "/" : `${folder}/`}</span><small>{paths.filter((path) => folderName(path) === folder).length}</small></button>
                </th></tr>
                {!collapsed.has(folder) && paths.filter((path) => folderName(path) === folder).map((path) => <tr key={path} className="heatmap-file" data-selected={path === selectedFile || undefined}>
                  <th scope="row" className="heatmap-file-label"><button type="button" title={path} onClick={(event) => selectedKey && onSelect(selectedKey, path, event.currentTarget)}><span className="heatmap-file-type">{fileName(path).includes(".") ? fileName(path).split(".").at(-1)?.slice(0, 3).toUpperCase() : "·"}</span><span className="truncate font-mono">{fileName(path)}</span></button></th>
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
                </tr>)}
              </Fragment>)}</tbody>
            </table>
            {!paths.length && <div className="activity-empty"><h3>No matching files</h3><p>Try a different search, or wait for explicit file activity to be recorded.</p></div>}
          </>
        )}
      </div>
      <div className="heatmap-legend">
        <div className="heatmap-key" aria-label="Heat scale: zero operations, 1, 2 to 3, 4 to 7, 8 or more"><span>{mode === "all" ? "Operations" : mode === "reads" ? "Reads" : "Changes"}</span>{["0", "1", "2–3", "4–7", "8+"].map((label, index) => <span key={label}><i data-heat={index} />{label}</span>)}</div>
        <div className="heatmap-markers"><span><i className="marker-reverted" />Reverted</span><span><i className="marker-failed" />Failed</span><span><i className="marker-pending" />Pending</span></div>
      </div>
      {hover && hoveredPrompt && createPortal(<div id="file-activity-tooltip" className="activity-tooltip" role="tooltip" style={{ left: hover.x, top: Math.max(12, hover.y) }}>
        <strong className="font-mono">{hover.path}</strong><p>{sessionTitle(hoveredPrompt.activity.sessionID)} · {hoveredPrompt.activity.text}</p>
        <span>{operationCount(hoveredTouches, mode)} {metricLabel(mode)}{hoveredTouches.some((touch) => touch.reverted) ? " · includes reverted history" : ""}</span>
      </div>, document.body)}
    </section>
  );
}
