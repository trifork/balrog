import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { eventKind } from "./EventCard";
import { Icon } from "./Icon";
import { commandTimeline } from "./timelineMarkers";
import { TimelineTooltip } from "./TimelineTooltip";
import { TimelineControls } from "./TimelineControls";
import { timelinePromptWidth } from "./timelineLayout";
import { useTimelineScrubber } from "./useTimelineScrubber";
import type { ReceivedEvent } from "./useViewer";
import type { ActivityPrompt } from "./file-activity-model";

interface Props {
  events: ReceivedEvent[];
  prompts?: ActivityPrompt[];
  evidenceEvents?: ReceivedEvent[];
  activeEventID?: number;
  centerRequest?: { id: number };
  highlightedEventIDs?: ReadonlySet<number>;
  onSelect: (id: number) => void;
  onActivate?: (id: number) => void;
  followingLive?: boolean;
  onToggleLive?: () => void;
}

export function Timeline({ events: sourceEvents, evidenceEvents = sourceEvents, prompts, activeEventID, centerRequest, highlightedEventIDs, onSelect, onActivate, followingLive = true, onToggleLive }: Props) {
  const { events, markers } = useMemo(() => commandTimeline(sourceEvents, evidenceEvents, prompts), [sourceEvents, evidenceEvents, prompts]);
  const markerWidths = useMemo(() => markers.map((marker) => marker.isPrompt ? timelinePromptWidth : marker.icon ? 14 : 1), [markers]);
  const { viewportRef, handleRef, activeIndex, layout, latestOutside, dragging, scrubSpeed, tooltipVisible, hideTooltip, endDrag, jumpToIndex, activateIndex, updateFade, startDrag, moveDrag, stopDrag, onKeyDown } = useTimelineScrubber({ events, activeEventID, centerRequest, onSelect, onActivate, markerWidths });
  const [hoveredEventID, setHoveredEventID] = useState<number>();
  const hoverAnchorRef = useRef<HTMLButtonElement | null>(null);
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeEvent = events[activeIndex];
  const activeFileRelated = Boolean(activeEvent && !markers[activeIndex].isPrompt && highlightedEventIDs?.has(activeEvent.id));
  const hoveredIndex = !dragging ? events.findIndex((message) => message.id === hoveredEventID) : -1;
  const tooltipIndex = hoveredIndex >= 0 ? hoveredIndex : tooltipVisible ? activeIndex : -1;
  const tooltipEvent = events[tooltipIndex];
  const promptCommands = useMemo(() => markers.flatMap((marker, index) => marker.isPrompt ? [index] : []), [markers]);
  const previousPrompt = promptCommands.reduce((previous, index) => index < activeIndex ? index : previous, -1);
  const nextPrompt = promptCommands.find((index) => index > activeIndex) ?? -1;

  useEffect(() => {
    setHoveredEventID(undefined);
  }, [dragging, events[0]?.id]);

  useEffect(() => {
    const clearHover = () => setHoveredEventID(undefined);
    window.addEventListener("blur", clearHover);
    return () => window.removeEventListener("blur", clearHover);
  }, []);

  useEffect(() => () => {
    if (hoverTimerRef.current !== null) clearTimeout(hoverTimerRef.current);
  }, []);

  const keepHover = () => {
    if (hoverTimerRef.current !== null) clearTimeout(hoverTimerRef.current);
    hoverTimerRef.current = null;
  };

  const hoverEvent = (id: number, anchor: HTMLButtonElement) => {
    if (dragging) return;
    keepHover();
    hoverAnchorRef.current = anchor;
    setHoveredEventID(id);
  };

  const leaveEvent = (id: number) => {
    keepHover();
    hoverTimerRef.current = setTimeout(() => setHoveredEventID((previous) => previous === id ? undefined : previous), 150);
  };

  const navigateKey = (event: KeyboardEvent<HTMLButtonElement>) => {
    onKeyDown(event);
    if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", "Enter", " ", "Escape"].includes(event.key)) setHoveredEventID(undefined);
  };

  const toggleLive = () => {
    endDrag();
    hideTooltip();
    setHoveredEventID(undefined);
    onToggleLive?.();
  };

  return (
    <div className="group/timeline flex h-full min-w-0 items-center gap-3 px-4 max-[760px]:gap-2 max-[760px]:px-3 max-[480px]:px-2.5" data-dragging={dragging} role="group" aria-label="Event timeline">
      <span className="w-16 shrink-0 font-mono text-[9px] tracking-[1.4px] text-muted uppercase max-[760px]:hidden">{dragging && scrubSpeed < 1 ? `Fine ${Math.round(scrubSpeed * 100)}%` : "Timeline"}</span>
      <TimelineControls previousPrompt={previousPrompt} nextPrompt={nextPrompt} followingLive={followingLive} hasEvents={events.length > 0} onNavigate={(index) => { setHoveredEventID(undefined); jumpToIndex(index, true); }} onToggleLive={onToggleLive ? toggleLive : undefined} />
      <span id="timeline-instructions" className="sr-only">Amber borders mark commands related to the selected file in the current prompt scope. Hover a prompt for its summary or a command for its reason and outcome. Click an event or press Enter or Space to pause playback at that point and update the heatmap without opening the event stream. Expand Event stream separately to inspect events. Drag anywhere to scrub. Release and re-grab to continue from the current event. Drag vertically away from the bar for finer control. Use arrow keys to step or Home and End to jump. Scrubbing pauses playback; use Go live to resume.</span>
      <div className="relative isolate h-full min-w-0 flex-1">
        <div ref={viewportRef} className="h-full w-full cursor-ew-resize touch-none overflow-x-auto overflow-y-hidden overscroll-contain select-none group-data-[dragging=true]/timeline:cursor-grabbing [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          onScroll={updateFade} onPointerDown={startDrag} onPointerMove={moveDrag} onPointerUp={stopDrag} onPointerCancel={stopDrag} onLostPointerCapture={stopDrag}>
          {events.length ? <div className="relative h-full" style={{ width: layout.width }}>
            <div className="pointer-events-none absolute top-1/2 h-px bg-line" style={{ left: layout.positions[0], width: layout.positions[events.length - 1] - layout.positions[0] }} />
            {events.map((message, index) => {
              const marker = markers[index];
              const targetWidth = marker.isPrompt ? timelinePromptWidth + 4 : 28;
              const before = index ? layout.positions[index] - layout.positions[index - 1] : targetWidth;
              const after = index < events.length - 1 ? layout.positions[index + 1] - layout.positions[index] : targetWidth;
              const width = Math.max(4, Math.min(targetWidth, before, after));
              const future = !followingLive && index > activeIndex;
              const fileRelated = !marker.isPrompt && highlightedEventIDs?.has(message.id);
              return <button key={message.id} type="button" data-event-id={message.id} data-file-related={fileRelated || undefined} tabIndex={index === activeIndex ? 0 : -1}
                aria-label={`Jump to ${marker.isPrompt ? "prompt" : "command"} ${index + 1}: ${marker.label}. ${marker.summary}${fileRelated ? ". Related to selected file" : ""}`} aria-describedby={tooltipIndex === index ? "timeline-summary" : undefined} aria-current={index === activeIndex ? "true" : undefined}
                className="absolute top-1/2 flex h-8 -translate-x-1/2 -translate-y-1/2 cursor-pointer items-center justify-center rounded-[2px] border border-transparent bg-transparent p-0 group-data-[dragging=true]/timeline:cursor-grabbing hover:border-transparent hover:bg-transparent focus-visible:outline-offset-0 data-[file-related=true]:border-[#e6b479] data-[file-related=true]:hover:border-[#e6b479]"
                style={{ left: layout.positions[index], width, color: marker.color }}
                onPointerEnter={(event) => { if (event.pointerType === "mouse") hoverEvent(message.id, event.currentTarget); }} onPointerLeave={() => leaveEvent(message.id)}
                onFocus={(event) => { if (event.currentTarget.matches(":focus-visible")) hoverEvent(message.id, event.currentTarget); }} onBlur={() => leaveEvent(message.id)}
                onClick={(event) => { if (event.detail === 0) activateIndex(index); }} onKeyDown={navigateKey}>
                <span aria-hidden="true" data-icon={Boolean(marker.icon)} data-kind={eventKind(String(message.event.tag ?? "event"))} data-prompt={marker.isPrompt || undefined}
                  className="h-3 w-px shrink-0 bg-current transition-opacity duration-100 data-[kind=error]:h-4 data-[icon=true]:grid data-[icon=true]:size-3.5 data-[icon=true]:place-items-center data-[icon=true]:rounded-[2px] data-[icon=true]:bg-frame data-[prompt=true]:flex data-[prompt=true]:h-7 data-[prompt=true]:items-center data-[prompt=true]:justify-center data-[prompt=true]:gap-1.5 data-[prompt=true]:rounded-[5px] data-[prompt=true]:border data-[prompt=true]:border-[#c9adff99] data-[prompt=true]:bg-[#382b4b] data-[prompt=true]:text-[#e6d5ff] data-[prompt=true]:shadow-[0_0_14px_#b7a0e925] motion-reduce:transition-none"
                  style={{ width: marker.isPrompt ? timelinePromptWidth : undefined, scale: layout.scales[index], opacity: future && hoveredEventID !== message.id ? marker.isPrompt ? 0.7 : 0.35 : 1 }}>{marker.icon && <Icon name={marker.icon} className="size-3.5" />}{marker.isPrompt && <span className="font-mono text-[10px] font-semibold">P{marker.promptNumber}</span>}</span>
              </button>;
            })}
            <button ref={handleRef} type="button" role="slider" data-event-id={activeEvent.id} data-prompt={markers[activeIndex].isPrompt || undefined} data-file-related={activeFileRelated || undefined} aria-label="Scrub to event" aria-controls="events" aria-describedby={tooltipIndex === activeIndex ? "timeline-instructions timeline-summary" : "timeline-instructions"} aria-orientation="horizontal"
              aria-valuemin={1} aria-valuemax={events.length} aria-valuenow={activeIndex + 1}
              aria-valuetext={`Event ${activeIndex + 1} of ${events.length}: ${markers[activeIndex].label}, ${new Date(activeEvent.receivedAt).toLocaleTimeString()}${activeFileRelated ? ". Related to selected file" : ""}`}
              className="absolute top-1/2 z-20 flex h-6 w-[22px] -translate-x-1/2 -translate-y-1/2 cursor-ew-resize items-center justify-center gap-[3px] rounded-[5px] border-[#ff9a6680] bg-[#32231c] p-0 text-accent shadow-[0_0_10px_#ff9a6614] group-data-[dragging=true]/timeline:cursor-grabbing hover:border-accent hover:bg-[#443024] hover:text-accent focus-visible:outline-offset-1 data-[prompt=true]:h-[34px] data-[prompt=true]:bg-transparent data-[prompt=true]:hover:bg-transparent data-[prompt=true]:[&>span]:hidden data-[file-related=true]:border-[#e6b479] data-[file-related=true]:hover:border-[#e6b479]"
              style={{ left: layout.positions[activeIndex], width: markers[activeIndex].isPrompt ? timelinePromptWidth + 6 : undefined }} onKeyDown={navigateKey} onClick={(event) => { if (event.detail === 0) activateIndex(activeIndex); }}
              onPointerEnter={(event) => { if (event.pointerType === "mouse") hoverEvent(activeEvent.id, event.currentTarget); }} onPointerLeave={() => leaveEvent(activeEvent.id)}
              onFocus={(event) => { if (event.currentTarget.matches(":focus-visible")) hoverEvent(activeEvent.id, event.currentTarget); }} onBlur={() => leaveEvent(activeEvent.id)}>
              <span className="h-2.5 w-px bg-current" aria-hidden="true" /><span className="h-2.5 w-px bg-current" aria-hidden="true" />
            </button>
          </div> : <div className="flex h-full items-center gap-3"><div className="h-px flex-1 bg-line" /><span className="text-[10px] text-muted">No commands</span><div className="h-px flex-1 bg-line" /></div>}
        </div>
        {events.length > 0 && <>
          <div className="pointer-events-none absolute inset-y-0 left-0 z-10 w-8 max-w-[20%] bg-linear-to-r from-frame to-transparent" aria-hidden="true" />
          <div className="pointer-events-none absolute inset-y-0 right-0 z-10 w-8 max-w-[20%] bg-linear-to-l from-frame to-transparent opacity-0 transition-opacity duration-150 data-[visible=true]:opacity-100 motion-reduce:transition-none" data-visible={latestOutside} aria-hidden="true" />
        </>}
      </div>
      <div className="flex shrink-0 items-center gap-3 font-mono text-[10px] text-muted tabular-nums max-[760px]:gap-2">
        {activeEvent && <time className="text-[#c4c4ce] max-[1000px]:hidden" dateTime={new Date(activeEvent.receivedAt).toISOString()}>{new Date(activeEvent.receivedAt).toLocaleTimeString()}</time>}
        <span><span className={activeEvent ? "text-accent" : ""}>{activeEvent ? (activeIndex + 1).toLocaleString() : "0"}</span><span className="px-1 text-[#575862]">/</span>{events.length.toLocaleString()}</span>
      </div>
      {tooltipEvent && <TimelineTooltip anchorRef={hoveredIndex >= 0 ? hoverAnchorRef : handleRef} message={tooltipEvent} marker={markers[tooltipIndex]} position={layout.positions[tooltipIndex]} onPointerEnter={keepHover} onPointerLeave={() => leaveEvent(tooltipEvent.id)} />}
    </div>
  );
}
