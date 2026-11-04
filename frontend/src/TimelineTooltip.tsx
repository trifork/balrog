import { useLayoutEffect, useRef, useState, type RefObject } from "react";
import { Icon } from "./Icon";
import type { TimelineMarker } from "./timelineMarkers";
import type { ReceivedEvent } from "./useViewer";

interface Props {
  tooltipRef: RefObject<HTMLDivElement | null>;
  anchorRef: RefObject<HTMLButtonElement | null>;
  message: ReceivedEvent;
  marker: TimelineMarker;
  position: number;
  onPointerEnter: () => void;
  onPointerLeave: () => void;
  onOpenEvent?: () => void;
}

const sourceLabels = { agent: "agent-provided", automatic: "automatic", retrospective: "retrospective" };

export function TimelineTooltip({ tooltipRef, anchorRef, message, marker, position, onPointerEnter, onPointerLeave, onOpenEvent }: Props) {
  const pointerInsideRef = useRef(false);
  const [placement, setPlacement] = useState<{ left: number; top: number; arrowLeft: number } | null>(null);

  useLayoutEffect(() => {
    const tooltip = tooltipRef.current;
    const anchor = anchorRef.current;
    if (!tooltip || !anchor) return;
    const place = () => {
      const handle = anchor.getBoundingClientRect();
      const bounds = tooltip.getBoundingClientRect();
      const viewport = window.visualViewport;
      const startX = viewport?.offsetLeft ?? 0;
      const startY = viewport?.offsetTop ?? 0;
      const width = viewport?.width ?? window.innerWidth;
      const height = viewport?.height ?? window.innerHeight;
      const center = handle.left + handle.width / 2;
      const left = Math.max(startX + 8, Math.min(center - bounds.width / 2, startX + width - bounds.width - 8));
      const top = Math.max(startY + 8, Math.min(handle.top - bounds.height - 10, startY + height - bounds.height - 8));
      const arrowLeft = Math.max(12, Math.min(bounds.width - 12, center - left));
      setPlacement((previous) => previous?.left === left && previous.top === top && previous.arrowLeft === arrowLeft ? previous : { left, top, arrowLeft });
    };
    place();
    const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(place);
    observer?.observe(tooltip);
    observer?.observe(anchor);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    window.visualViewport?.addEventListener("resize", place);
    window.visualViewport?.addEventListener("scroll", place);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
      window.visualViewport?.removeEventListener("resize", place);
      window.visualViewport?.removeEventListener("scroll", place);
    };
  }, [tooltipRef, anchorRef, message.id, marker.label, marker.summary, marker.reason, marker.reasonSource, position]);

  return (
    <div ref={tooltipRef}
      onPointerEnter={() => { pointerInsideRef.current = true; onPointerEnter(); }} onPointerLeave={(event) => { pointerInsideRef.current = false; if (!event.currentTarget.contains(document.activeElement)) onPointerLeave(); }}
      onFocus={onPointerEnter} onBlur={(event) => { if (!pointerInsideRef.current && !event.currentTarget.contains(event.relatedTarget)) onPointerLeave(); }}
      className="fixed z-50 w-[420px] max-w-[calc(100vw-16px)] max-h-[calc(100dvh-16px)] overflow-y-auto rounded-[9px] border border-[#45464d] bg-[#1d1e22] p-3 text-ink shadow-[0_8px_32px_#0008]"
      style={{ left: placement?.left ?? 0, top: placement?.top ?? 0, visibility: placement ? "visible" : "hidden", borderTopColor: marker.color }}>
      <div id="timeline-summary" role="tooltip">
        <div className="mb-1.5 flex min-w-0 items-center gap-2">
          <span className="flex min-w-0 flex-1 items-center gap-1.5 text-[11px] font-medium" style={{ color: marker.color }}>
            {marker.icon ? <Icon name={marker.icon} className="size-3.5" /> : <span className="size-1.5 shrink-0 rounded-full bg-current" aria-hidden="true" />}
            <span className="truncate">{marker.label}</span>
          </span>
          <time className="shrink-0 font-mono text-[9px] text-muted tabular-nums" dateTime={new Date(message.receivedAt).toISOString()}>{new Date(message.receivedAt).toLocaleTimeString()}</time>
        </div>
        {!marker.isPrompt && <dl className="m-0 space-y-2 text-[11px] leading-relaxed">
          <div><dt className="font-medium text-muted">Reason</dt><dd className="m-0 whitespace-pre-wrap wrap-anywhere">{marker.reason ?? "null"}</dd></div>
        </dl>}
        <p className="m-0 mt-2 border-t border-line pt-2 text-[11px] leading-relaxed whitespace-pre-wrap wrap-anywhere text-[#c7c7d0]">{marker.summary}</p>
      </div>
      {onOpenEvent && <button type="button" className="mt-3 inline-flex items-center gap-1.5 rounded-[5px] border border-[#45464d] bg-transparent px-2 py-1.5 text-[11px] text-muted hover:border-accent hover:bg-[#ff9a6608] hover:text-accent focus-visible:outline-offset-2" onClick={onOpenEvent}>
        <Icon name="terminal" className="size-3.5" />Open in event stream<Icon name="arrow" className="size-3" />
      </button>}
      <span className="absolute -bottom-[5px] size-2 rotate-45 border-r border-b border-[#45464d] bg-[#1d1e22]" style={{ left: (placement?.arrowLeft ?? 12) - 4 }} aria-hidden="true" />
    </div>
  );
}
