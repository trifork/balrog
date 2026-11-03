import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { moveTimelinePosition, timelineLayout } from "./timelineLayout";
import type { ReceivedEvent } from "./useViewer";

interface Props {
  events: ReceivedEvent[];
  activeEventID?: number;
  centerRequest?: { id: number };
  onSelect: (id: number) => void;
  markerWidths?: readonly number[];
}

interface Drag {
  pointerID: number;
  clientX: number;
  startX: number;
  startY: number;
  candidateID?: number;
  started: boolean;
}

export function useTimelineScrubber({ events, activeEventID, centerRequest, onSelect, markerWidths }: Props) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<HTMLButtonElement>(null);
  const dragRef = useRef<Drag | null>(null);
  const wheelRef = useRef(0);
  const tooltipTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [viewportWidth, setViewportWidth] = useState(0);
  const [latestOutside, setLatestOutside] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [scrubSpeed, setScrubSpeed] = useState(1);
  const [tooltipEventID, setTooltipEventID] = useState<number>();
  const selectedIndex = events.findIndex((message) => message.id === activeEventID);
  const activeIndex = !events.length ? -1 : selectedIndex >= 0 ? selectedIndex : activeEventID === undefined ? events.length - 1
    : Math.max(0, events.reduce((index, message, current) => message.id <= activeEventID ? current : index, -1));
  const indexRef = useRef(activeIndex);
  const positionRef = useRef(activeIndex);
  const centerRequestRef = useRef<number | undefined>(undefined);
  const layout = useMemo(() => timelineLayout(events.length, activeIndex, viewportWidth, markerWidths), [events.length, activeIndex, viewportWidth, markerWidths]);
  const inputRef = useRef({ events, onSelect, layout });
  const firstEventID = events[0]?.id;

  useLayoutEffect(() => {
    inputRef.current = { events, onSelect, layout };
    indexRef.current = activeIndex;
    if (Math.round(positionRef.current) !== activeIndex) positionRef.current = activeIndex;
  }, [events, onSelect, layout, activeIndex]);

  const updateFade = useCallback(() => {
    const viewport = viewportRef.current;
    const positions = inputRef.current.layout.positions;
    if (!viewport || !positions.length) {
      setLatestOutside(false);
      return;
    }
    const latest = positions[positions.length - 1] - viewport.scrollLeft;
    setLatestOutside(latest < 0 || latest > viewport.clientWidth);
  }, []);

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const measure = () => setViewportWidth(viewport.clientWidth);
    measure();
    const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(measure);
    observer?.observe(viewport);
    window.addEventListener("resize", measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const position = layout.positions[activeIndex];
    if (position !== undefined) {
      if (centerRequest || centerRequestRef.current === activeIndex) {
        viewport.scrollLeft = Math.max(0, position - viewport.clientWidth / 2);
        centerRequestRef.current = undefined;
      } else {
        const inset = Math.min(32, viewport.clientWidth / 3);
        if (position < viewport.scrollLeft + inset) viewport.scrollLeft = position - inset;
        else if (position > viewport.scrollLeft + viewport.clientWidth - inset) viewport.scrollLeft = position - viewport.clientWidth + inset;
      }
    }
    updateFade();
  }, [activeIndex, layout, centerRequest, updateFade]);

  const hideTooltip = useCallback(() => {
    if (tooltipTimerRef.current !== null) clearTimeout(tooltipTimerRef.current);
    tooltipTimerRef.current = null;
    setTooltipEventID(undefined);
  }, []);

  const showTooltip = useCallback((id: number, hold = false) => {
    if (tooltipTimerRef.current !== null) clearTimeout(tooltipTimerRef.current);
    tooltipTimerRef.current = null;
    setTooltipEventID(id);
    if (!hold) tooltipTimerRef.current = setTimeout(() => {
      tooltipTimerRef.current = null;
      setTooltipEventID(undefined);
    }, 1_500);
  }, []);

  useEffect(() => () => {
    if (tooltipTimerRef.current !== null) clearTimeout(tooltipTimerRef.current);
  }, []);

  const selectIndex = useCallback((position: number, force = false) => {
    const input = inputRef.current;
    if (!input.events.length) return;
    positionRef.current = Math.max(0, Math.min(input.events.length - 1, position));
    const next = Math.round(positionRef.current);
    showTooltip(input.events[next].id, Boolean(dragRef.current?.started));
    if (!force && next === indexRef.current) return;
    indexRef.current = next;
    input.onSelect(input.events[next].id);
  }, [showTooltip]);

  const endDrag = useCallback(() => {
    const drag = dragRef.current;
    dragRef.current = null;
    setDragging(false);
    setScrubSpeed(1);
    const viewport = viewportRef.current;
    if (drag && viewport?.hasPointerCapture(drag.pointerID)) viewport.releasePointerCapture(drag.pointerID);
    const message = inputRef.current.events[indexRef.current];
    if (drag?.started && message) showTooltip(message.id);
  }, [showTooltip]);

  const jumpToIndex = useCallback((index: number, center = false) => {
    endDrag();
    const next = Math.max(0, Math.min(inputRef.current.events.length - 1, index));
    centerRequestRef.current = center ? next : undefined;
    selectIndex(next, true);
    const viewport = viewportRef.current;
    const position = inputRef.current.layout.positions[next];
    if (center && viewport && position !== undefined) {
      viewport.scrollLeft = Math.max(0, position - viewport.clientWidth / 2);
      updateFade();
    }
  }, [endDrag, selectIndex, updateFade]);

  const beginDrag = useCallback(() => {
    const drag = dragRef.current;
    if (!drag) return;
    drag.started = true;
    setDragging(true);
    handleRef.current?.focus({ preventScroll: true });
    selectIndex(positionRef.current, true);
  }, [selectIndex]);

  useEffect(() => {
    endDrag();
    hideTooltip();
    wheelRef.current = 0;
    positionRef.current = indexRef.current;
  }, [firstEventID, endDrag, hideTooltip]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const onWheel = (event: WheelEvent) => {
      if (event.ctrlKey || !inputRef.current.events.length) return;
      event.preventDefault();
      if (dragRef.current) return;
      const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? viewport.clientWidth : 1;
      wheelRef.current += delta * unit;
      const steps = Math.trunc(wheelRef.current / 12);
      if (!steps) return;
      wheelRef.current -= steps * 12;
      selectIndex(indexRef.current + steps);
    };
    viewport.addEventListener("wheel", onWheel, { passive: false });
    const onBlur = () => {
      endDrag();
      hideTooltip();
    };
    window.addEventListener("blur", onBlur);
    return () => {
      viewport.removeEventListener("wheel", onWheel);
      window.removeEventListener("blur", onBlur);
    };
  }, [selectIndex, endDrag, hideTooltip]);

  const startDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || !event.isPrimary || !events.length || dragRef.current) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const marker = event.target instanceof Element ? event.target.closest<HTMLButtonElement>("[data-event-id]") : null;
    const handle = event.target instanceof Element && Boolean(event.target.closest('[role="slider"]'));
    const bounds = event.currentTarget.getBoundingClientRect();
    const position = event.clientX - bounds.left + event.currentTarget.scrollLeft;
    const index = Math.round(moveTimelinePosition(layout.positions, 0, position - layout.positions[0]));
    dragRef.current = {
      pointerID: event.pointerId,
      clientX: event.clientX,
      startX: event.clientX,
      startY: event.clientY,
      candidateID: marker ? Number(marker.dataset.eventId) : events[handle ? activeIndex : index]?.id,
      started: false,
    };
    wheelRef.current = 0;
    if (marker) marker.focus({ preventScroll: true });
    else handleRef.current?.focus({ preventScroll: true });
  };

  const moveDrag = (event: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerID !== event.pointerId) return;
    if (!drag.started) {
      if (Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < 4) return;
      beginDrag();
    }
    const bounds = event.currentTarget.getBoundingClientRect();
    const distance = Math.max(0, bounds.top - event.clientY, event.clientY - bounds.bottom);
    const speed = Math.max(0.08, 1 / (1 + distance / 48));
    const delta = event.clientX - drag.clientX;
    drag.clientX = event.clientX;
    setScrubSpeed(Math.round(speed * 100) / 100);
    selectIndex(moveTimelinePosition(inputRef.current.layout.positions, positionRef.current, delta * speed));
  };

  const stopDrag = (event: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerID !== event.pointerId) return;
    const candidateID = event.type === "pointerup" && !drag.started ? drag.candidateID : undefined;
    endDrag();
    if (candidateID !== undefined) {
      const index = inputRef.current.events.findIndex((message) => message.id === candidateID);
      if (index >= 0) jumpToIndex(index, true);
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      endDrag();
      hideTooltip();
      return;
    }
    const index = indexRef.current;
    const destinations: Record<string, number> = {
      ArrowLeft: index - 1,
      ArrowDown: index - 1,
      ArrowRight: index + 1,
      ArrowUp: index + 1,
      PageUp: index - 10,
      PageDown: index + 10,
      Home: 0,
      End: events.length - 1,
      Enter: index,
      " ": index,
    };
    if (!(event.key in destinations)) return;
    event.preventDefault();
    jumpToIndex(destinations[event.key], event.key === "Enter" || event.key === " ");
  };

  const tooltipVisible = tooltipEventID !== undefined && tooltipEventID === events[activeIndex]?.id;

  return { viewportRef, handleRef, activeIndex, layout, latestOutside, dragging, scrubSpeed, tooltipVisible, hideTooltip, endDrag, jumpToIndex, updateFade, startDrag, moveDrag, stopDrag, onKeyDown };
}
