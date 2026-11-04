import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { moveTimelinePosition, timelineLayout } from "./timelineLayout";
import type { ReceivedEvent } from "./useViewer";

interface Props {
  events: ReceivedEvent[];
  activeEventID?: number;
  centerRequest?: { id: number };
  followingLive?: boolean;
  onSelect: (id: number) => void;
  onActivate?: (id: number) => void;
  markerWidths?: readonly number[];
}

interface Drag {
  pointerID: number;
  clientX: number;
  startX: number;
  startY: number;
  candidateID?: number;
  activate: boolean;
  started: boolean;
}

export function useTimelineScrubber({ events, activeEventID, centerRequest, followingLive, onSelect, onActivate, markerWidths }: Props) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<HTMLButtonElement>(null);
  const dragRef = useRef<Drag | null>(null);
  const wheelRef = useRef(0);
  const selectionFrameRef = useRef<number | null>(null);
  const pendingSelectionRef = useRef<{ position: number; force: boolean; speed?: number } | null>(null);
  const tooltipTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [viewportWidth, setViewportWidth] = useState(0);
  const [latestOutside, setLatestOutside] = useState(false);
  const [visibleRange, setVisibleRange] = useState({ start: 0, end: 0 });
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
  const inputRef = useRef({ events, onSelect, onActivate, layout });
  const firstEventID = events[0]?.id;
  const navigationRef = useRef({ firstEventID, activeEventID, centerRequest, followingLive });
  const publishedEventIDRef = useRef<number | undefined>(undefined);

  const cancelPendingSelection = useCallback(() => {
    if (selectionFrameRef.current !== null) cancelAnimationFrame(selectionFrameRef.current);
    selectionFrameRef.current = null;
    pendingSelectionRef.current = null;
    positionRef.current = indexRef.current;
  }, []);

  useLayoutEffect(() => {
    if (activeEventID !== undefined && activeIndex !== indexRef.current) cancelPendingSelection();
    inputRef.current = { events, onSelect, onActivate, layout };
    indexRef.current = activeIndex;
    if (!pendingSelectionRef.current && Math.round(positionRef.current) !== activeIndex) positionRef.current = activeIndex;
  }, [events, onSelect, onActivate, layout, activeIndex, activeEventID, cancelPendingSelection]);

  useLayoutEffect(() => {
    const previous = navigationRef.current;
    const acknowledged = publishedEventIDRef.current !== undefined && publishedEventIDRef.current === activeEventID;
    const external = previous.firstEventID !== firstEventID || previous.centerRequest !== centerRequest
      || (previous.activeEventID !== activeEventID && !acknowledged)
      || (previous.followingLive !== followingLive && !(acknowledged && followingLive === false));
    navigationRef.current = { firstEventID, activeEventID, centerRequest, followingLive };
    if (external) cancelPendingSelection();
    if (external || acknowledged) publishedEventIDRef.current = undefined;
  });

  useEffect(() => cancelPendingSelection, [cancelPendingSelection]);

  const updateFade = useCallback(() => {
    const viewport = viewportRef.current;
    const positions = inputRef.current.layout.positions;
    if (viewport) {
      const start = viewport.scrollLeft;
      const end = start + viewport.clientWidth;
      setVisibleRange((previous) => previous.start === start && previous.end === end ? previous : { start, end });
    }
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
    publishedEventIDRef.current = input.events[next].id;
    input.onSelect(input.events[next].id);
  }, [showTooltip]);

  const flushPendingSelection = useCallback(() => {
    if (selectionFrameRef.current !== null) cancelAnimationFrame(selectionFrameRef.current);
    selectionFrameRef.current = null;
    const pending = pendingSelectionRef.current;
    pendingSelectionRef.current = null;
    if (pending) {
      if (pending.speed !== undefined) setScrubSpeed(pending.speed);
      selectIndex(pending.position, pending.force);
    }
  }, [selectIndex]);

  const scheduleSelection = useCallback((position: number, force = false, speed?: number) => {
    positionRef.current = Math.max(0, Math.min(inputRef.current.events.length - 1, position));
    pendingSelectionRef.current = { position: positionRef.current, force: force || Boolean(pendingSelectionRef.current?.force), speed };
    if (selectionFrameRef.current === null) selectionFrameRef.current = requestAnimationFrame(flushPendingSelection);
  }, [flushPendingSelection]);

  const endDrag = useCallback(() => {
    const drag = dragRef.current;
    if (drag?.started) flushPendingSelection();
    else cancelPendingSelection();
    dragRef.current = null;
    setDragging(false);
    setScrubSpeed(1);
    const viewport = viewportRef.current;
    if (drag && viewport?.hasPointerCapture(drag.pointerID)) viewport.releasePointerCapture(drag.pointerID);
    const message = inputRef.current.events[indexRef.current];
    if (drag?.started && message) showTooltip(message.id);
  }, [showTooltip, cancelPendingSelection, flushPendingSelection]);

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

  const activateIndex = useCallback((index: number) => {
    jumpToIndex(index, true);
    const message = inputRef.current.events[indexRef.current];
    if (message) inputRef.current.onActivate?.(message.id);
  }, [jumpToIndex]);

  const beginDrag = useCallback(() => {
    const drag = dragRef.current;
    if (!drag) return;
    drag.started = true;
    setDragging(true);
    handleRef.current?.focus({ preventScroll: true });
    scheduleSelection(positionRef.current, true);
  }, [scheduleSelection]);

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
      scheduleSelection(Math.round(positionRef.current) + steps);
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
  }, [scheduleSelection, endDrag, hideTooltip]);

  const startDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || !event.isPrimary || !events.length || dragRef.current) return;
    cancelPendingSelection();
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
      activate: Boolean(marker),
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
    scheduleSelection(moveTimelinePosition(inputRef.current.layout.positions, positionRef.current, delta * speed), false, Math.round(speed * 100) / 100);
  };

  const stopDrag = (event: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerID !== event.pointerId) return;
    const candidateID = event.type === "pointerup" && !drag.started ? drag.candidateID : undefined;
    endDrag();
    if (candidateID !== undefined) {
      const index = inputRef.current.events.findIndex((message) => message.id === candidateID);
      if (index >= 0) {
        if (drag.activate) activateIndex(index);
        else jumpToIndex(index, true);
      }
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
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      const markerID = event.currentTarget.dataset.eventId;
      const focusedIndex = markerID === undefined ? index : events.findIndex((message) => message.id === Number(markerID));
      if (focusedIndex >= 0) activateIndex(focusedIndex);
      return;
    }
    const destinations: Record<string, number> = {
      ArrowLeft: index - 1,
      ArrowDown: index - 1,
      ArrowRight: index + 1,
      ArrowUp: index + 1,
      PageUp: index - 10,
      PageDown: index + 10,
      Home: 0,
      End: events.length - 1,
    };
    if (!(event.key in destinations)) return;
    event.preventDefault();
    jumpToIndex(destinations[event.key]);
    handleRef.current?.focus({ preventScroll: true });
  };

  const tooltipVisible = tooltipEventID !== undefined && tooltipEventID === events[activeIndex]?.id;

  return { viewportRef, handleRef, activeIndex, layout, latestOutside, visibleRange, dragging, scrubSpeed, tooltipVisible, hideTooltip, endDrag, jumpToIndex, activateIndex, updateFade, startDrag, moveDrag, stopDrag, onKeyDown };
}
