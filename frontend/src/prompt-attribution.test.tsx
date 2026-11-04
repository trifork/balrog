import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test } from "vitest";
import { SessionActivityAnalyzer } from "../../server/session-activity";
import type { LogEvent } from "../../server/log-receiver";
import type { ViewerMessage } from "../../shared/viewer-protocol";
import { collectActivity } from "./file-activity-model";
import { ReasonMap } from "./ReasonMap";

afterEach(cleanup);

function event(tag: string, pluginID: string, data: object): LogEvent {
  return {
    tag, pluginID, sessionID: "session", apiVersion: "v2",
    [tag]: { type: tag, data: { sessionID: "session", ...data } },
  } as unknown as LogEvent;
}

function replay() {
  const tracker = new SessionActivityAnalyzer();
  const records = [
    event("session.inbox.enqueued", "workspace", {
      inboxID: "overview", item: { type: "user", payload: { text: "what does this repo do?" } },
    }),
    event("session.execution.started", "application", {}),
    event("session.inbox.delivered", "workspace", { inboxID: "overview" }),
    event("session.tool.input.started", "workspace", { id: "read-overview", name: "read" }),
    event("session.tool.called", "workspace", { id: "read-overview", input: { path: "README.md" } }),
    event("session.tool.success", "workspace", { id: "read-overview" }),
    event("session.execution.succeeded", "application", {}),
    event("session.inbox.enqueued", "application", {
      inboxID: "retro", item: { type: "user", payload: { text: "Use the retro skill for a Balrog retrospective." } },
    }),
    event("session.inbox.delivered", "workspace", { inboxID: "retro" }),
    event("session.execution.started", "application", {}),
    event("session.tool.input.started", "workspace", { id: "read-retro", name: "read" }),
    event("session.tool.called", "workspace", { id: "read-retro", input: { path: "AGENTS.md" } }),
    event("session.tool.success", "workspace", { id: "read-retro" }),
  ];
  return records.map((event, index): ViewerMessage => {
    tracker.process(event);
    return { id: index + 1, event, activityUpdates: tracker.getUpdates(event) };
  });
}

test("the overview prompt excludes retrospective reads when V2 plugin instances differ", async () => {
  const user = userEvent.setup();
  render(<ReasonMap events={replay()} selectedSession="session" sessions={[]} />);
  const prompts = within(screen.getByRole("group", { name: "Prompts" }));
  const table = within(screen.getByRole("table", { name: "File access reasons" }));
  await user.click(prompts.getByRole("button", { name: /what does this repo do\?/ }));
  expect(table.queryByText("AGENTS.md")).toBeNull();
  expect(table.getByText("README.md")).toBeTruthy();
  expect(prompts.getAllByRole("button")).toHaveLength(2);
  await user.click(prompts.getByRole("button", { name: /Use the retro skill/ }));
  expect(table.getByText("AGENTS.md")).toBeTruthy();
  expect(table.queryByText("README.md")).toBeNull();
});

test("V2 prompt file details include tool lifecycle events from another plugin instance", () => {
  const prompts = collectActivity(replay(), "session");
  const overview = prompts.find((prompt) => prompt.activity.text === "what does this repo do?")!;
  expect([...overview.fileEventIDs.get("README.md")!].sort((a, b) => a - b)).toEqual([4, 5, 6]);
});
