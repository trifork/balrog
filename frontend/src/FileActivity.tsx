import { useMemo, useState } from "react";
import type { FileTouch, PromptActivity } from "../../server/file-activity";
import type { SessionSummary, ViewerMessage } from "../../shared/viewer-protocol";

const actionLabels = { read: "Read", modified: "Edit", written: "Write", created: "Added", deleted: "Deleted" };

interface FileNode {
  children: Map<string, FileNode>;
  path?: string;
  touches?: FileTouch[];
}

function FileBranch({ name, node }: { name: string; node: FileNode }) {
  const [open, setOpen] = useState(true);
  const badges = new Map(node.touches?.map((touch) => [`${touch.action}/${touch.outcome}`, touch]));
  return (
    <li>
      {node.touches && <div className="file-row">
        <span title={node.path}>{name}</span>
        {[...badges].map(([key, touch]) => <span key={key} className="file-badge" data-action={touch.action} data-outcome={touch.outcome}>
          {actionLabels[touch.action]}{touch.outcome === "success" ? "" : ` (${touch.outcome})`}
        </span>)}
      </div>}
      {node.children.size > 0 && <details open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
        <summary>{name}/</summary>
        <ul>{[...node.children].map(([childName, child]) => <FileBranch key={childName} name={childName} node={child} />)}</ul>
      </details>}
    </li>
  );
}

export function FileActivity({ events, sessions, selectedSession }: {
  events: ViewerMessage[];
  sessions: SessionSummary[];
  selectedSession: string;
}) {
  const [selectedPrompt, setSelectedPrompt] = useState<string | null>(null);
  const prompts = useMemo(() => {
    const retained = new Map<string, PromptActivity>();
    for (const { fileActivity } of events) {
      if (fileActivity && (!selectedSession || fileActivity.sessionID === selectedSession)) {
        retained.set(fileActivity.id, fileActivity);
      }
    }
    return [...retained.values()];
  }, [events, selectedSession]);
  const prompt = selectedPrompt === null ? prompts.at(-1) : prompts.find((item) => item.id === selectedPrompt);
  const files = new Map<string, FileTouch[]>();
  for (const touch of prompt?.files ?? []) {
    const touches = files.get(touch.path) ?? [];
    touches.push(touch);
    files.set(touch.path, touches);
  }
  const changed = [...files.values()].filter((touches) => touches.some((touch) => touch.action !== "read" && touch.outcome === "success")).length;
  const root: FileNode = { children: new Map() };
  for (const [path, touches] of [...files].sort(([a], [b]) => a.localeCompare(b))) {
    let node = root;
    for (const segment of path.split("/").filter(Boolean)) {
      let child = node.children.get(segment);
      if (!child) {
        child = { children: new Map() };
        node.children.set(segment, child);
      }
      node = child;
    }
    node.path = path;
    node.touches = touches;
  }

  return (
    <section className="file-activity" aria-label="Files touched per prompt">
      <h2>Files touched per prompt</h2>
      <div className="file-controls">
        <select id="prompt-select" aria-label="Select prompt" value={prompt?.id ?? ""} disabled={prompts.length === 0}
          onChange={(event) => setSelectedPrompt(event.target.value)}>
          {prompts.map((item) => <option key={item.id} value={item.id}>
            {selectedSession ? "" : `${sessions.find((session) => session.sessionID === item.sessionID)?.title || item.sessionID} / `}{item.text.slice(0, 100)}
          </option>)}
        </select>
        <button id="follow-files" type="button" aria-pressed={selectedPrompt === null} onClick={() => setSelectedPrompt(null)}>
          {selectedPrompt === null ? "Following latest" : "Follow latest"}
        </button>
      </div>
      <p id="file-prompt">{prompt?.text ?? ""}</p>
      <p id="file-summary">{!prompt
        ? "Waiting for a recorded prompt or execution. Choose Follow latest to resume live updates."
        : files.size ? `${files.size} ${files.size === 1 ? "file" : "files"} touched / ${changed} confirmed changed`
        : "No explicit file activity recorded for this prompt yet."}</p>
      <ul id="file-tree" aria-label="Touched files" key={prompt?.id}>
        {[...root.children].map(([name, node]) => <FileBranch key={name} name={name} node={node} />)}
      </ul>
    </section>
  );
}
