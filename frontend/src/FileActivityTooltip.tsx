import { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { changeBreakdown, operationCount, type ActivityPrompt } from "./file-activity-model";

interface Props {
  path: string;
  prompt: ActivityPrompt;
  sessionTitle: string;
  anchor: DOMRect;
}

export function FileActivityTooltip({ path, prompt, sessionTitle, anchor }: Props) {
  const tooltipRef = useRef<HTMLDivElement>(null);
  const [placement, setPlacement] = useState<{ left: number; top: number }>();
  const touches = prompt.files.get(path) ?? [];
  const changes = changeBreakdown(touches);
  const statuses = [
    { key: "failed", label: "failed", count: new Set(touches.filter((touch) => touch.outcome === "failed").map((touch) => touch.callID)).size },
    { key: "pending", label: "pending", count: new Set(touches.filter((touch) => touch.outcome === "pending").map((touch) => touch.callID)).size },
    { key: "reverted", label: "reverted", count: new Set(touches.filter((touch) => touch.reverted).map((touch) => touch.callID)).size },
  ].filter((status) => status.count > 0);

  useLayoutEffect(() => {
    const tooltip = tooltipRef.current;
    if (!tooltip) return;
    const rect = tooltip.getBoundingClientRect();
    const viewport = window.visualViewport;
    const startX = viewport?.offsetLeft ?? 0;
    const startY = viewport?.offsetTop ?? 0;
    const width = viewport?.width ?? window.innerWidth;
    const height = viewport?.height ?? window.innerHeight;
    const left = Math.max(startX + 12, Math.min(anchor.left + anchor.width / 2 - rect.width / 2, startX + width - rect.width - 12));
    const below = anchor.bottom + 10;
    const top = below + rect.height <= startY + height - 12 ? below : Math.max(startY + 12, anchor.top - rect.height - 10);
    setPlacement({ left, top });
  }, [anchor, path, prompt]);

  return createPortal(<div ref={tooltipRef} id="file-activity-tooltip" className="activity-tooltip" role="tooltip"
    style={{ left: placement?.left ?? 0, top: placement?.top ?? 0, visibility: placement ? "visible" : "hidden" }}>
    <strong className="font-mono">{path}</strong>
    <p>{sessionTitle} · {prompt.activity.text}</p>
    <dl className="activity-tooltip-stats">
      <div data-operation="reads"><dd>{operationCount(touches, "reads")}</dd><dt>Reads</dt></div>
      <div data-operation="changes"><dd>{operationCount(touches, "changes")}</dd><dt>Changes</dt></div>
    </dl>
    <div className="activity-tooltip-changes" aria-label="Confirmed change breakdown">
      <span data-change="created">{changes.created} created</span><span data-change="edited">{changes.edited} edited</span><span data-change="deleted">{changes.deleted} deleted</span>
    </div>
    {statuses.length > 0 && <div className="activity-tooltip-status">{statuses.map((status) => <span key={status.key} data-status={status.key}>{status.count} {status.label}</span>)}</div>}
    {statuses.some((status) => status.key === "reverted") && <p className="activity-tooltip-note">Reverted actions are excluded from changes.</p>}
  </div>, document.body);
}
