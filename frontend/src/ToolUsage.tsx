import { useMemo } from "react";
import type { SessionSummary, ViewerMessage } from "../../shared/viewer-protocol";
import { toolUsage, groupToolUsage } from "./tool-usage-model";
import { collectActivity, promptNumber } from "./file-activity-model";
import { usePromptSelection } from "./usePromptSelection";

export function ToolUsage({ events, selectedSession, sessions, sessionLabel }: {
  events: ViewerMessage[];
  selectedSession: string;
  sessions: SessionSummary[];
  sessionLabel?: string;
}) {
  const attempts = useMemo(() => toolUsage(events, selectedSession), [events, selectedSession]);
  const prompts = useMemo(() => collectActivity(events, selectedSession), [events, selectedSession]);
  const { isSelected, select } = usePromptSelection(prompts);
  const groups = useMemo(() => groupToolUsage(attempts.filter((attempt) => isSelected(attempt.promptKey))), [attempts, isSelected]);
  const sessionTitle = (sessionID: string) => sessions.find((session) => session.sessionID === sessionID)?.title || sessionID;

  return (
    <section className="capabilities-workspace" id="session-workspace" role="tabpanel" aria-label={sessionLabel ?? (selectedSession ? sessionTitle(selectedSession) : "All sessions")}>
      <h1>Tool usage</h1>
      <p className="mb-4 shrink-0 text-xs text-muted">Shows recorded tool calls grouped by tool, with their results.</p>
      <div className="capabilities-scroll">
        <table className="capabilities-table" aria-label="Tool usage">
          <thead><tr><th scope="col">Tool</th><th scope="col">Tool call</th><th scope="col">Result</th></tr></thead>
          {groups.map((group) => <tbody key={group.tool} aria-label={group.tool}>
            {group.invocations.map((attempt, index) => <tr key={attempt.key}>
            {index === 0 && <th scope="rowgroup" rowSpan={group.invocations.length}>{group.tool}</th>}
            <td><code className="capabilities-content" title={`${attempt.tool} · ${sessionTitle(attempt.sessionID)}`}>{attempt.command}</code></td>
            <td data-status={attempt.result.status}><div className="capabilities-content">{attempt.result.text}</div></td>
          </tr>)}
          </tbody>)}
        </table>
        {!groups.length && <p className="capabilities-empty">{!attempts.length ? "No recorded tool calls." : prompts.some((prompt) => isSelected(prompt.key)) ? "No tool calls for the selected prompts." : "No prompts selected."}</p>}
      </div>
      {prompts.length > 0 && <section className="reason-prompts" role="group" aria-label="Prompts">
        <h2>Prompts</h2>
        <div className="reason-prompt-list">{prompts.map((prompt, index) => <button type="button" className="reason-prompt" key={prompt.key}
          aria-pressed={isSelected(prompt.key)} title={`${sessionTitle(prompt.activity.sessionID)} (click to select only; Shift-click to toggle)`} onClick={(event) => select(prompt.key, event.shiftKey)}>
          <span className="reason-prompt-number">Prompt {promptNumber(index)}</span><span className="reason-prompt-text">{prompt.activity.text || "No prompt text recorded"}</span>
        </button>)}</div>
      </section>}
    </section>
  );
}
