import { useLayoutEffect, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import { Icon } from "./Icon";
import type { TimelineMarker } from "./timelineMarkers";
import type { ReceivedEvent } from "./useViewer";

interface Props {
  anchorRef: RefObject<HTMLButtonElement | null>;
  message: ReceivedEvent;
  marker: TimelineMarker;
  position: number;
}

export function TimelineTooltip({ anchorRef, message, marker, position }: Props) {
  const tooltipRef = useRef<HTMLDivElement>(null);
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
  }, [anchorRef, message.id, marker.label, marker.summary, position]);

  return createPortal(
    <div ref={tooltipRef} id="timeline-summary" role="tooltip"
      className="pointer-events-none fixed z-50 w-[340px] max-w-[calc(100vw-16px)] rounded-[9px] border border-[#45464d] bg-[#1d1e22] p-3 text-ink shadow-[0_8px_32px_#0008]"
      style={{ left: placement?.left ?? 0, top: placement?.top ?? 0, visibility: placement ? "visible" : "hidden", borderTopColor: marker.color }}>
      <div className="mb-1.5 flex min-w-0 items-center gap-2">
        <span className="flex min-w-0 flex-1 items-center gap-1.5 text-[11px] font-medium" style={{ color: marker.color }}>
          {marker.icon ? <Icon name={marker.icon} className="size-3.5" /> : <span className="size-1.5 shrink-0 rounded-full bg-current" aria-hidden="true" />}
          <span className="truncate">{marker.label}</span>
        </span>
        <time className="shrink-0 font-mono text-[9px] text-muted tabular-nums" dateTime={new Date(message.receivedAt).toISOString()}>{new Date(message.receivedAt).toLocaleTimeString()}</time>
      </div>
      {marker.label !== message.event.tag && <div className="mb-1.5 truncate font-mono text-[9px] text-muted">{message.event.tag}</div>}
      <p className="m-0 line-clamp-3 text-[11px] leading-[1.7] wrap-anywhere text-[#c7c7d0]">{marker.summary}</p>
      <span className="absolute -bottom-[5px] size-2 rotate-45 border-r border-b border-[#45464d] bg-[#1d1e22]" style={{ left: (placement?.arrowLeft ?? 12) - 4 }} aria-hidden="true" />
    </div>,
    document.body,
  );
}
