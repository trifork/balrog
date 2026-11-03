import type { RefObject } from "react";
import type { FileTouch } from "../../server/file-activity";
import { Icon } from "./Icon";
import { actionBadges, actionLabel, fileName, folderName, operationCount, promptNumber, type ActivityPrompt } from "./file-activity-model";

interface Props {
  prompt?: ActivityPrompt;
  index: number;
  total: number;
  selectedFile: string | null;
  following: boolean;
  sessionTitle: string;
  eventCount: number;
  mobileOpen: boolean;
  closeRef: RefObject<HTMLButtonElement | null>;
  onClose: () => void;
  onNavigate: (index: number) => void;
  onSelectFile: (path: string | null, opener: HTMLElement) => void;
  onInspect: () => void;
}

function FileBadges({ touches }: { touches: FileTouch[] }) {
  return <span className="file-badges">{actionBadges(touches).map((touch) => <span className="file-badge"
    key={`${touch.action}/${touch.outcome}/${Boolean(touch.reverted)}`} data-action={touch.action} data-outcome={touch.outcome} data-reverted={touch.reverted || undefined}
    title={touch.reverted ? "This recorded action was reverted." : undefined}>{actionLabel(touch)}</span>)}</span>;
}

export function FileInspector({ prompt, index, total, selectedFile, following, sessionTitle, eventCount, mobileOpen, closeRef, onClose, onNavigate, onSelectFile, onInspect }: Props) {
  const files = [...(prompt?.files ?? [])];
  const touched = files.filter(([, touches]) => operationCount(touches) > 0).length;
  const changed = files.filter(([, touches]) => operationCount(touches, "changes") > 0).length;
  const touches = prompt?.files.get(selectedFile ?? "") ?? [];

  return (
    <aside className="activity-inspector" data-mobile-open={mobileOpen || undefined} aria-label="Selected prompt and file">
      <div className="inspector-heading">
        <span className="activity-eyebrow">{prompt ? `Prompt ${promptNumber(index)}` : "Prompt details"}</span>
        <div className="inspector-navigation"><span>{following ? "Following" : "Pinned"}</span>
          <button type="button" className="activity-icon-button" aria-label="Previous prompt" disabled={index <= 0} onClick={() => onNavigate(index - 1)}><Icon name="left" className="size-3.5" /></button>
          <button type="button" className="activity-icon-button" aria-label="Next prompt" disabled={index < 0 || index >= total - 1} onClick={() => onNavigate(index + 1)}><Icon name="right" className="size-3.5" /></button>
          <button type="button" className="activity-icon-button inspector-close" aria-label="Close detail panel" ref={closeRef} onClick={onClose}><Icon name="close" className="size-3.5" /></button>
        </div>
      </div>
      {prompt ? <>
        <div className="inspector-prompt">
          <div className="inspector-meta"><Icon name="clock" className="size-3" />{prompt.timestamp !== undefined && <><time dateTime={new Date(prompt.timestamp).toISOString()} className="font-mono">{new Date(prompt.timestamp).toLocaleTimeString()}</time><span>·</span></>}<span title={sessionTitle}>{sessionTitle}</span></div>
          <h2>{prompt.activity.text}</h2>
          <div className="inspector-stats"><div><strong>{touched}</strong><span>files touched</span></div><div><strong>{changed}</strong><span>confirmed changed</span></div></div>
          <p className="sr-only" id="file-summary">{touched} {touched === 1 ? "file" : "files"} touched / {changed} confirmed changed</p>
        </div>
        <div className="inspector-files">
          {selectedFile ? <>
            <div className="inspector-section-heading"><h3 className="activity-eyebrow">Focused file</h3><button type="button" className="activity-icon-button" aria-label="Show all files for this prompt" onClick={(event) => onSelectFile(null, event.currentTarget)}><Icon name="close" className="size-3" /></button></div>
            <h4 className="inspector-filename font-mono">{fileName(selectedFile)}</h4><p className="inspector-path font-mono">{folderName(selectedFile)}/</p>
            <FileBadges touches={touches} />
            <ul className="file-operations" aria-label="Recorded file operations">{touches.slice(0, 6).map((touch, position) => <li key={`${touch.callID}/${touch.action}`} data-outcome={touch.outcome} data-reverted={touch.reverted || undefined} title={`Call ${touch.callID}`}>
              <Icon name={touch.action === "read" ? "read" : "edit"} className="size-3.5 text-muted" /><span>{actionLabel(touch)}</span><small className="font-mono">{promptNumber(position)}</small><Icon name={touch.reverted ? "undo" : touch.outcome === "pending" ? "clock" : touch.outcome === "failed" ? "close" : "check"} className="operation-status size-3" />
            </li>)}</ul>
            {!touches.length && <p className="inspector-note">No recorded activity for this file in this prompt.</p>}
            {touches.length > 6 && <p className="inspector-note">+ {touches.length - 6} more operations in the related events</p>}
            {touches.some((touch) => touch.reverted) && <p className="inspector-note">Reverted edits stay in the activity history and are excluded from confirmed changes.</p>}
          </> : <>
            <div className="inspector-section-heading"><h3 className="activity-eyebrow">Files in this prompt</h3><span className="font-mono">{files.length}</span></div>
            {!files.length && <p className="inspector-note">No explicit file activity recorded for this prompt yet.</p>}
            <ul className="prompt-files" aria-label="Touched files">{files.sort(([a], [b]) => a.localeCompare(b)).map(([path, entries]) => <li key={path}>
              <button type="button" className="prompt-file" title={path} onClick={(event) => onSelectFile(path, event.currentTarget)}><span className="prompt-file-name"><span className="truncate font-mono">{fileName(path)}</span><small>{operationCount(entries)} ops</small></span><FileBadges touches={entries} /></button>
            </li>)}</ul>
          </>}
        </div>
      </> : <div className="activity-empty"><Icon name="read" className="size-6 text-muted" /><h3>A closer look</h3><p>Select a prompt or heatmap cell to explore its recorded file activity.</p></div>}
      <div className="inspector-footer"><button type="button" className="inspect-events" disabled={!prompt || !eventCount} onClick={onInspect}><Icon name="terminal" className="size-3.5" /><span>Inspect {eventCount} related events</span><Icon name="arrow" className="size-3.5" /></button><p>Explicit file-tool activity. Shell commands and unobserved files aren’t included.</p></div>
    </aside>
  );
}
