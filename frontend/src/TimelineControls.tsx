import { Icon } from "./Icon";

interface Props {
  previousPrompt: number;
  nextPrompt: number;
  followingLive: boolean;
  hasEvents: boolean;
  onNavigate: (index: number) => void;
  onToggleLive?: () => void;
}

export function TimelineControls({ previousPrompt, nextPrompt, followingLive, hasEvents, onNavigate, onToggleLive }: Props) {
  return (
    <div className="flex shrink-0 items-center gap-1" role="group" aria-label="Timeline playback">
      <button type="button" className="grid size-6 place-items-center rounded-[4px] border-transparent bg-transparent p-0 text-muted hover:bg-[#2b2c31] focus-visible:outline-offset-0" aria-label="Previous prompt" title="Previous prompt" disabled={previousPrompt < 0} onClick={() => onNavigate(previousPrompt)}><Icon name="previousPrompt" className="size-3.5" /></button>
      <button type="button" className="grid size-6 place-items-center rounded-[4px] border-transparent bg-transparent p-0 text-muted hover:bg-[#2b2c31] focus-visible:outline-offset-0" aria-label="Next prompt" title="Next prompt" disabled={nextPrompt < 0} onClick={() => onNavigate(nextPrompt)}><Icon name="nextPrompt" className="size-3.5" /></button>
      <button type="button" className="ml-1 inline-flex h-6 w-[70px] items-center justify-center gap-1.5 rounded-[4px] border-[#45464d] bg-transparent p-0 font-mono text-[9px] text-muted aria-pressed:border-[#86cfa140] aria-pressed:bg-[#86cfa108] aria-pressed:text-[#a6d9b8] focus-visible:outline-offset-0" aria-pressed={followingLive}
        aria-label={followingLive ? "Pause live playback" : "Resume live playback"} title={followingLive ? "Pause following new events" : "Jump to the latest event and follow live"}
        disabled={!onToggleLive || followingLive && !hasEvents} onClick={onToggleLive}><Icon name={followingLive ? "pause" : "live"} className="size-3" /><span>{followingLive ? "Live" : "Go live"}</span></button>
    </div>
  );
}
