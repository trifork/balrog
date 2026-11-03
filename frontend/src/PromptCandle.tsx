import type { ActivityPrompt, changeBreakdown } from "./file-activity-model";
import { promptNumber } from "./file-activity-model";
import { Icon } from "./Icon";

interface Props {
  prompt: ActivityPrompt;
  index: number;
  files: number;
  changes: ReturnType<typeof changeBreakdown>;
  maximum: number;
  selected: boolean;
  hovered: boolean;
  sessionTitle: string;
  onSelect: (element: HTMLButtonElement) => void;
}

const kinds = [["created", "creation"], ["edited", "edit"], ["deleted", "deletion"]] as const;

export function PromptCandle({ prompt, index, files, changes, maximum, selected, hovered, sessionTitle, onSelect }: Props) {
  const summary = changes.total ? kinds.map(([kind, label]) => {
    const count = changes[kind];
    const percent = (count / changes.total * 100).toLocaleString(undefined, { maximumFractionDigits: 1 });
    return `${count} ${label}${count === 1 ? "" : "s"} (${percent}%)`;
  }).join(" · ") : "No confirmed changes";
  const action = selected ? "Click to show all prompts" : "Click to filter by this prompt";

  return (
    <button type="button" className="heatmap-prompt" aria-pressed={selected} data-hovered={hovered || undefined}
      aria-label={`Prompt ${promptNumber(index)}: ${prompt.activity.text}. ${summary}. ${action}`}
      aria-describedby="prompt-filter-hint"
      title={`${sessionTitle} · ${prompt.activity.text} · ${files} ${files === 1 ? "file" : "files"}\n${summary}\n${action}`}
      onClick={(event) => onSelect(event.currentTarget)}>
      <span className="heatmap-total">{changes.total}</span>
      <span className="heatmap-bar-track" aria-hidden="true"><span className="heatmap-candle" data-empty={!changes.total || undefined} style={{ height: `${changes.total ? Math.max(3, changes.total / maximum * 100) : 6}%` }}>
        {changes.total > 0 && kinds.map(([kind]) => changes[kind] > 0 && <span key={kind} data-change={kind} style={{ height: `${changes[kind] / changes.total * 100}%` }} />)}
      </span></span>
      <span className="heatmap-prompt-number font-mono">{promptNumber(index)}<Icon name={selected ? "check" : "down"} className="size-2.5" /></span>
    </button>
  );
}
