import { useMemo } from "react";
import type { SessionSummary, ViewerMessage } from "../../shared/viewer-protocol";
import { capabilities, groupCapabilities } from "./capabilities-model";
import { collectActivity, promptNumber } from "./file-activity-model";
import { usePromptSelection } from "./usePromptSelection";

export function Capabilities({ events, selectedSession, sessions, sessionLabel }: {
  events: ViewerMessage[];
  selectedSession: string;
  sessions: SessionSummary[];
  sessionLabel?: string;
}) {
  const attempts = useMemo(() => capabilities(events, selectedSession), [events, selectedSession]);
  const prompts = useMemo(() => collectActivity(events, selectedSession), [events, selectedSession]);
  const { isSelected, select } = usePromptSelection(prompts);
  const groups = useMemo(() => groupCapabilities(attempts.filter((attempt) => isSelected(attempt.promptKey))), [attempts, isSelected]);
  const sessionTitle = (sessionID: string) => sessions.find((session) => session.sessionID === sessionID)?.title || sessionID;

  return (
    <section className="capabilities-workspace" id="session-workspace" role="tabpanel" aria-label={sessionLabel ?? (selectedSession ? sessionTitle(selectedSession) : "All sessions")}>
      <h1>Capabilities</h1>
      <div className="capabilities-scroll">
        <table className="capabilities-table" aria-label="Attempted capabilities">
          <thead><tr><th scope="col">Capability</th><th scope="col">Tool call</th><th scope="col">Result</th></tr></thead>
          {groups.map((group) => <tbody key={group.capability.toLowerCase()} aria-label={group.capability}>
            {group.invocations.map((attempt, index) => <tr key={attempt.key}>
            {index === 0 && <th scope="rowgroup" rowSpan={group.invocations.length}>{group.capability}</th>}
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
