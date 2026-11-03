import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test } from "vitest";
import { FileActivityTracker, type PromptActivity } from "../../server/file-activity";
import type { LogEvent } from "../../server/log-receiver";
import type { ViewerMessage } from "../../shared/viewer-protocol";
import { FileActivity } from "./FileActivity";

afterEach(cleanup);

function message(id: number, activity: PromptActivity): ViewerMessage {
  return {
    id,
    event: { tag: "session.prompt", sessionID: activity.sessionID, pluginID: "test" } as unknown as LogEvent,
    fileActivity: activity,
  };
}

test("groups observed files, deduplicates badges and counts only confirmed changes", () => {
  const prompt: PromptActivity = {
    id: "1", sessionID: "s1", text: "Update files",
    files: [
      { path: "src/app.ts", action: "read", outcome: "success", callID: "read1" },
      { path: "src/app.ts", action: "read", outcome: "success", callID: "read2" },
      { path: "src/app.ts", action: "modified", outcome: "success", callID: "edit1" },
      { path: "src/app.ts", action: "written", outcome: "success", callID: "write1" },
      { path: "src/new.ts", action: "created", outcome: "pending", callID: "add1" },
      { path: "src/gone.ts", action: "deleted", outcome: "failed", callID: "delete1" },
    ],
  };
  render(<FileActivity events={[message(1, prompt)]} sessions={[]} selectedSession="" />);
  const tree = screen.getByRole("list", { name: "Touched files" });
  expect(screen.getByText("3 files touched / 1 confirmed changed")).toBeTruthy();
  expect(screen.queryByText(/\(Reverted\)$/)).toBeNull();
  expect(within(tree).getAllByText("Read")).toHaveLength(1);
  for (const badge of ["Edit", "Write", "Added (pending)", "Deleted (failed)"]) {
    expect(within(tree).getByText(badge)).toBeTruthy();
  }
  expect(within(tree).getByText("app.ts").getAttribute("title")).toBe("src/app.ts");
  expect(within(tree).getAllByText("src/")).toHaveLength(1);
});

test("reconstructs prompt order from snapshots and follows new prompts rather than late outcomes", async () => {
  const user = userEvent.setup();
  const first: PromptActivity = { id: "1", sessionID: "s1", text: "First prompt", files: [] };
  const second: PromptActivity = { id: "2", sessionID: "s1", text: "Second prompt", files: [] };
  const completed: PromptActivity = {
    ...first, files: [{ path: "old.ts", action: "modified", outcome: "success", callID: "c1" }],
  };
  const events = [message(1, first), message(2, second), message(3, completed)];
  const { rerender } = render(<FileActivity events={events} sessions={[]} selectedSession="" />);
  const select = screen.getByRole("combobox", { name: "Select prompt" }) as HTMLSelectElement;
  expect(select.value).toBe("2");
  expect(screen.queryByText("old.ts")).toBeNull();
  await user.selectOptions(select, "1");
  expect(screen.getByText("old.ts")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Follow latest" }).getAttribute("aria-pressed")).toBe("false");
  const third: PromptActivity = { id: "3", sessionID: "s1", text: "Third prompt", files: [] };
  rerender(<FileActivity events={[...events, message(4, third)]} sessions={[]} selectedSession="" />);
  expect(select.value).toBe("1");
  await user.click(screen.getByRole("button", { name: "Follow latest" }));
  expect(select.value).toBe("3");
  expect(screen.getByRole("button", { name: "Following latest" }).getAttribute("aria-pressed")).toBe("true");
  expect(screen.queryByText("old.ts")).toBeNull();
});

test("keeps collapsed folders across live updates and resets them for a new prompt", async () => {
  const user = userEvent.setup();
  const prompt: PromptActivity = {
    id: "1", sessionID: "s1", text: "Read a file",
    files: [{ path: "src/app.ts", action: "read", outcome: "pending", callID: "c1" }],
  };
  const { rerender } = render(<FileActivity events={[message(1, prompt)]} sessions={[]} selectedSession="" />);
  const summary = screen.getByText("src/");
  const folder = summary.closest("details")!;
  await user.click(summary);
  expect(folder.open).toBe(false);
  const completed: PromptActivity = { ...prompt, files: [{ ...prompt.files[0], outcome: "success" }] };
  rerender(<FileActivity events={[message(1, prompt), message(2, completed)]} sessions={[]} selectedSession="" />);
  expect(screen.getByText("src/").closest("details")).toBe(folder);
  expect(folder.open).toBe(false);
  rerender(<FileActivity events={[message(3, { ...completed, id: "2", text: "Next prompt" })]} sessions={[]} selectedSession="" />);
  expect(screen.getByText("src/").closest("details")?.open).toBe(true);
});

test("shows empty states and renders prompt and file text safely", () => {
  const { rerender, container } = render(<FileActivity events={[]} sessions={[]} selectedSession="" />);
  expect((screen.getByRole("combobox", { name: "Select prompt" }) as HTMLSelectElement).disabled).toBe(true);
  expect(screen.getByText(/Waiting for a recorded prompt/)).toBeTruthy();
  const prompt: PromptActivity = { id: "1", sessionID: "s1", text: "<img src=x onerror=alert(1)>", files: [] };
  rerender(<FileActivity events={[message(1, prompt)]} sessions={[]} selectedSession="" />);
  expect(screen.getByText("No explicit file activity recorded for this prompt yet.")).toBeTruthy();
  const changed: PromptActivity = {
    ...prompt, files: [{ path: "<script>alert(1)</script>.ts", action: "read", outcome: "success", callID: "c1" }],
  };
  rerender(<FileActivity events={[message(1, changed)]} sessions={[]} selectedSession="" />);
  expect(screen.getByText("1 file touched / 0 confirmed changed")).toBeTruthy();
  expect(container.querySelector("img, script")).toBeNull();
});

test("includes Reverted in action badges, deduplicates reverted edits and preserves still-active changes", () => {
  const prompt: PromptActivity = {
    id: "1", sessionID: "s1", text: "Change and restore",
    files: [
      { path: "src/app.ts", action: "read", outcome: "success", callID: "read" },
      { path: "src/app.ts", action: "modified", outcome: "success", callID: "edit", reverted: true },
      { path: "src/app.ts", action: "modified", outcome: "success", callID: "undo", reverted: true },
      { path: "src/app.ts", action: "written", outcome: "success", callID: "write", reverted: true },
    ],
  };
  const { rerender } = render(<FileActivity events={[message(1, prompt)]} sessions={[]} selectedSession="" />);
  expect(screen.getByText("1 file touched / 0 confirmed changed")).toBeTruthy();
  expect(screen.getAllByText("Edit (Reverted)")).toHaveLength(1);
  expect(screen.getByText("Edit (Reverted)").getAttribute("data-reverted")).toBe("true");
  expect(screen.getByText("Write (Reverted)")).toBeTruthy();
  expect(screen.queryByText("Edit")).toBeNull();
  expect(screen.queryByText("Reverted")).toBeNull();
  expect(screen.getByText("Read")).toBeTruthy();
  rerender(<FileActivity events={[message(2, {
    ...prompt, files: [...prompt.files, { path: "src/app.ts", action: "modified", outcome: "success", callID: "new-edit" }],
  })]} sessions={[]} selectedSession="" />);
  expect(screen.getAllByText("Edit")).toHaveLength(1);
  expect(screen.getAllByText("Edit (Reverted)")).toHaveLength(1);
  expect(screen.getByText("1 file touched / 1 confirmed changed")).toBeTruthy();
});

test("updates older prompts for undo and redo without changing follow-latest or a pinned selection", async () => {
  const user = userEvent.setup();
  const first: PromptActivity = {
    id: "1", sessionID: "s1", text: "First prompt",
    files: [{ path: "src/app.ts", action: "modified", outcome: "success", callID: "edit" }],
  };
  const second: PromptActivity = { id: "2", sessionID: "s1", text: "Second prompt", files: [] };
  const events = [message(1, first), message(2, second)];
  const { rerender } = render(<FileActivity events={events} sessions={[]} selectedSession="" />);
  const select = screen.getByRole("combobox", { name: "Select prompt" }) as HTMLSelectElement;
  const reverted: PromptActivity = { ...first, files: first.files.map((file) => ({ ...file, reverted: true })) };
  const updates: ViewerMessage = { ...message(3, second), fileActivityUpdates: [reverted] };
  rerender(<FileActivity events={[...events, updates]} sessions={[]} selectedSession="" />);
  expect(select.value).toBe("2");
  await user.selectOptions(select, "1");
  expect(screen.getByText("Edit (Reverted)")).toBeTruthy();
  expect(screen.getByText("1 file touched / 0 confirmed changed")).toBeTruthy();
  const redo: ViewerMessage = { ...message(4, second), fileActivityUpdates: [first] };
  rerender(<FileActivity events={[...events, updates, redo]} sessions={[]} selectedSession="" />);
  expect(select.value).toBe("1");
  expect(screen.queryByText("Edit (Reverted)")).toBeNull();
  expect(screen.getByText("Edit")).toBeTruthy();
  expect(screen.getByText("1 file touched / 1 confirmed changed")).toBeTruthy();
});

test("keeps Edit (Reverted) scoped to reverted files", () => {
  const prompt: PromptActivity = {
    id: "1", sessionID: "s1", text: "Undo one file",
    files: [
      { path: "src/reverted.ts", action: "modified", outcome: "success", callID: "c1", reverted: true },
      { path: "src/active.ts", action: "modified", outcome: "success", callID: "c2" },
    ],
  };
  render(<FileActivity events={[message(1, prompt)]} sessions={[]} selectedSession="" />);
  const revertedRow = screen.getByTitle("src/reverted.ts").parentElement!;
  const activeRow = screen.getByTitle("src/active.ts").parentElement!;
  expect(within(revertedRow).getByText("Edit (Reverted)")).toBeTruthy();
  expect(within(activeRow).queryByText("Edit (Reverted)")).toBeNull();
  expect(within(activeRow).getByText("Edit")).toBeTruthy();
  expect(screen.getByText("2 files touched / 1 confirmed changed")).toBeTruthy();
});

test("shows Edit (Reverted) when a successful patch removes its earlier added line without native undo events", () => {
  const tracker = new FileActivityTracker();
  const events: ViewerMessage[] = [];
  const publish = (tag: string, data: Record<string, unknown>) => {
    const event = {
      tag, sessionID: "s1", pluginID: "test",
      [tag]: { type: tag, data: { sessionID: "s1", ...data } },
    } as unknown as LogEvent;
    const [fileActivity, ...fileActivityUpdates] = tracker.processAll(event);
    events.push({ id: events.length + 1, event, fileActivity, fileActivityUpdates });
  };
  const patch = (marker: "+" | "-") =>
    `*** Begin Patch\n*** Update File: environments/.env.example\n@@\n VITE_APP_NAME=demo\n${marker}# Temporary change\n*** End Patch`;
  publish("session.prompt", { text: "make a small change and then revert it again" });
  publish("session.tool.input.started", { id: "add", name: "patch" });
  publish("session.tool.called", { id: "add", input: { patchText: patch("+") }, executed: false });
  publish("session.tool.success", { id: "add", executed: false });
  const { rerender } = render(<FileActivity events={[...events]} sessions={[]} selectedSession="" />);
  expect(screen.queryByText("Edit (Reverted)")).toBeNull();
  expect(screen.getByText("1 file touched / 1 confirmed changed")).toBeTruthy();

  publish("session.tool.input.started", { id: "remove", name: "patch" });
  publish("session.tool.called", { id: "remove", input: { patchText: patch("-") }, executed: false });
  rerender(<FileActivity events={[...events]} sessions={[]} selectedSession="" />);
  expect(screen.queryByText("Edit (Reverted)")).toBeNull();
  publish("session.tool.success", { id: "remove", executed: false });
  rerender(<FileActivity events={[...events]} sessions={[]} selectedSession="" />);
  expect(screen.getAllByText("Edit (Reverted)")).toHaveLength(1);
  expect(screen.queryByText("Edit")).toBeNull();
  expect(screen.getByText("1 file touched / 0 confirmed changed")).toBeTruthy();
  expect(events.some(({ event }) => event.tag.startsWith("session.revert."))).toBe(false);
});

test("does not infer Edit (Reverted) from Git status or shell-script cleanup", () => {
  const tracker = new FileActivityTracker();
  const events: ViewerMessage[] = [];
  const status = (output: string) => ({
    content: [{ type: "text", text: output }],
    metadata: { status: "completed", truncated: false, exit: 0 },
  });
  const records: Array<[string, Record<string, unknown>]> = [
    ["session.prompt", { text: "Optimize the service" }],
    ["session.tool.called", { id: "service", tool: "edit", input: { path: "src/RabbitMQService.cs" } }],
    ["session.tool.success", { id: "service" }],
    ["session.tool.called", { id: "swagger", tool: "patch", input: {
      patchText: "*** Begin Patch\n*** Update File: swagger.json\n@@\n-generated\n+original\n*** End Patch",
    } }],
    ["session.tool.success", { id: "swagger" }],
    ["session.tool.called", { id: "dirty", tool: "shell", input: { command: "git status --short" } }],
    ["session.tool.success", { id: "dirty", ...status(" M swagger.json\n M src/RabbitMQService.cs\n") }],
    ["session.tool.called", { id: "cleanup", tool: "shell", input: { command: "python3 cleanup.py" } }],
    ["session.tool.success", { id: "cleanup", ...status("(no output)") }],
    ["session.tool.input.started", { id: "clean", name: "shell" }],
    ["session.tool.called", { id: "clean", input: { command: "git status --short" } }],
    ["session.tool.success", { id: "clean", ...status(" M src/RabbitMQService.cs\n") }],
  ];
  for (const [tag, data] of records) {
    const event = {
      tag, sessionID: "s1", pluginID: "test",
      [tag]: { type: tag, location: { directory: "/workspace" }, data },
    } as unknown as LogEvent;
    const [fileActivity, ...fileActivityUpdates] = tracker.processAll(event);
    events.push({ id: events.length + 1, event, fileActivity, fileActivityUpdates });
  }
  const { rerender } = render(<FileActivity events={events.slice(0, -1)} sessions={[]} selectedSession="" />);
  expect(screen.queryByText("Edit (Reverted)")).toBeNull();
  expect(screen.getByText("2 files touched / 2 confirmed changed")).toBeTruthy();
  rerender(<FileActivity events={events} sessions={[]} selectedSession="" />);
  const swagger = screen.getByText("swagger.json").parentElement!;
  expect(within(swagger).queryByText("Edit (Reverted)")).toBeNull();
  expect(within(swagger).getByText("Edit")).toBeTruthy();
  const service = screen.getByText("RabbitMQService.cs").parentElement!;
  expect(within(service).queryByText("Edit (Reverted)")).toBeNull();
  expect(within(service).getByText("Edit")).toBeTruthy();
  expect(screen.getByText("2 files touched / 2 confirmed changed")).toBeTruthy();
});
