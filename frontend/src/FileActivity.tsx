import { useMemo, useState } from "react";
import type { FileTouch, PromptActivity } from "../../server/file-activity";
import type {
  SessionSummary,
  ViewerMessage,
} from "../../shared/viewer-protocol";

const actionLabels = {
  read: "Read",
  modified: "Edit",
  written: "Write",
  created: "Added",
  deleted: "Deleted",
};

interface FileNode {
  children: Map<string, FileNode>;
  path?: string;
  touches?: FileTouch[];
}

function FileBranch({ name, node }: { name: string; node: FileNode }) {
  const [open, setOpen] = useState(true);
  const badges = new Map(
    node.touches?.map((touch) => [`${touch.action}/${touch.outcome}/${Boolean(touch.reverted)}`, touch]),
  );
  return (
    <li>
      {node.touches && (
        <div className="flex flex-wrap items-center gap-1.5 py-[3px]">
          <span title={node.path}>{name}</span>
          {[...badges].map(([key, touch]) => (
            <span
              key={key}
              className={`rounded px-1.5 text-[10px] ${
                touch.reverted
                  ? "border border-[#96969f30] bg-[#96969f15] text-muted"
                  : touch.outcome === "failed" || touch.action === "deleted"
                  ? "bg-[#ed8e8e15] text-[#ed8e8e]"
                  : touch.action === "read"
                    ? "bg-[#95bbef15] text-[#95bbef]"
                    : touch.action === "created"
                      ? "bg-[#8acba415] text-[#8acba4]"
                      : "bg-[#e6b47915] text-[#e6b479]"
              }`}
              data-action={touch.action}
              data-outcome={touch.outcome}
              data-reverted={touch.reverted || undefined}
              title={touch.reverted ? "This recorded action was reverted." : undefined}
            >
              {actionLabels[touch.action]}
              {touch.outcome === "success" ? "" : ` (${touch.outcome})`}
              {touch.reverted ? " (Reverted)" : ""}
            </span>
          ))}
        </div>
      )}
      {node.children.size > 0 && (
        <details
          open={open}
          onToggle={(event) => setOpen(event.currentTarget.open)}
        >
          <summary className="cursor-pointer py-[3px] text-muted hover:text-accent">
            {name}/
          </summary>
          <ul className="list-none pl-[18px]">
            {[...node.children].map(([childName, child]) => (
              <FileBranch key={childName} name={childName} node={child} />
            ))}
          </ul>
        </details>
      )}
    </li>
  );
}

export function FileActivity({
  events,
  sessions,
  selectedSession,
}: {
  events: ViewerMessage[];
  sessions: SessionSummary[];
  selectedSession: string;
}) {
  const [selectedPrompt, setSelectedPrompt] = useState<string | null>(null);
  const prompts = useMemo(() => {
    const retained = new Map<string, PromptActivity>();
    for (const { fileActivity, fileActivityUpdates } of events) {
      for (const activity of [
        ...(fileActivity ? [fileActivity] : []),
        ...(fileActivityUpdates ?? []),
      ]) {
        if (!selectedSession || activity.sessionID === selectedSession) {
          retained.set(activity.id, activity);
        }
      }
    }
    return [...retained.values()];
  }, [events, selectedSession]);
  const prompt =
    selectedPrompt === null
      ? prompts.at(-1)
      : prompts.find((item) => item.id === selectedPrompt);
  const files = new Map<string, FileTouch[]>();
  for (const touch of prompt?.files ?? []) {
    const touches = files.get(touch.path) ?? [];
    touches.push(touch);
    files.set(touch.path, touches);
  }
  const changed = [...files.values()].filter((touches) =>
    touches.some(
      (touch) =>
        touch.action !== "read" &&
        touch.outcome === "success" &&
        !touch.reverted,
    ),
  ).length;
  const root: FileNode = { children: new Map() };
  for (const [path, touches] of [...files].sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
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
    <section className="p-4" aria-label="Files touched per prompt">
      <h2 className="text-[15px] font-semibold tracking-[-0.2px]">
        Files touched per prompt
      </h2>
      <div className="mt-4 flex flex-wrap gap-2">
        <select
          id="prompt-select"
          className="min-w-0 max-w-full flex-1 rounded-[6px] border border-line bg-canvas p-2 text-ink"
          aria-label="Select prompt"
          value={prompt?.id ?? ""}
          disabled={prompts.length === 0}
          onChange={(event) => setSelectedPrompt(event.target.value)}
        >
          {prompts.map((item) => (
            <option key={item.id} value={item.id}>
              {selectedSession
                ? ""
                : `${sessions.find((session) => session.sessionID === item.sessionID)?.title || item.sessionID} / `}
              {item.text.slice(0, 100)}
            </option>
          ))}
        </select>
        <button
          id="follow-files"
          className="px-3 py-2"
          type="button"
          aria-pressed={selectedPrompt === null}
          onClick={() => setSelectedPrompt(null)}
        >
          {selectedPrompt === null ? "Following latest" : "Follow latest"}
        </button>
      </div>
      <p id="file-summary" className="my-[11px] text-[11px] text-muted">
        {!prompt
          ? "Waiting for a recorded prompt or execution. Choose Follow latest to resume live updates."
          : files.size
            ? `${files.size} ${files.size === 1 ? "file" : "files"} touched / ${changed} confirmed changed`
            : "No explicit file activity recorded for this prompt yet."}
      </p>
      <ul
        id="file-tree"
        className="my-3 list-none font-mono text-[12px] leading-[1.8] wrap-anywhere"
        aria-label="Touched files"
        key={prompt?.id}
      >
        {[...root.children].map(([name, node]) => (
          <FileBranch key={name} name={name} node={node} />
        ))}
      </ul>
    </section>
  );
}
