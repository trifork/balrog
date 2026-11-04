import { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { AccessReason } from "./reason-map-model";

export function ReasonTooltip({ id, reason, anchor, onMouseEnter, onMouseLeave }: {
  id: string;
  reason: AccessReason;
  anchor: HTMLButtonElement;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [placement, setPlacement] = useState<{ left: number; top: number }>();

  useLayoutEffect(() => {
    const tooltip = ref.current;
    if (!tooltip) return;
    const place = () => {
      const bounds = tooltip.getBoundingClientRect();
      const target = anchor.getBoundingClientRect();
      const viewport = window.visualViewport;
      const startX = viewport?.offsetLeft ?? 0;
      const startY = viewport?.offsetTop ?? 0;
      const width = viewport?.width ?? window.innerWidth;
      const height = viewport?.height ?? window.innerHeight;
      const left = Math.max(startX + 8, Math.min(target.left, startX + width - bounds.width - 8));
      const below = target.bottom + 8;
      const top = below + bounds.height <= startY + height - 8 ? below : Math.max(startY + 8, target.top - bounds.height - 8);
      setPlacement((previous) => previous?.left === left && previous.top === top ? previous : { left, top });
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
  }, [anchor, reason]);

  return createPortal(<div ref={ref} id={id} role="tooltip" className="reason-tooltip" onMouseEnter={onMouseEnter} onMouseLeave={onMouseLeave}
    style={{ left: placement?.left ?? 0, top: placement?.top ?? 0, visibility: placement ? "visible" : "hidden" }}>
    <p>{reason.explanation}</p>
    <strong>Outcome</strong>
    {reason.outcomes.length ? reason.outcomes.map((outcome) => <p key={outcome}>{outcome}</p>) : <p>No recorded outcome.</p>}
    <strong>Id</strong>
    <p className="font-mono">{reason.callIDs.join(", ")}</p>
  </div>, document.body);
}
