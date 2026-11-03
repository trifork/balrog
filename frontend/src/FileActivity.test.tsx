import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { FileActivityTracker, type PromptActivity } from "../../server/file-activity";
import type { LogEvent } from "../../server/log-receiver";
import { FileActivity } from "./FileActivity";
import type { ReceivedEvent } from "./useViewer";

beforeEach(() => vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false }))));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function message(id: number, activity: PromptActivity): ReceivedEvent {
  return {
    id, receivedAt: 1_700_000_000_000 + id,
    event: { tag: "session.prompt", sessionID: activity.sessionID, pluginID: "test" } as unknown as LogEvent,
    fileActivity: activity,
  };
}

const inspector = () => within(screen.getByRole("complementary", { name: "Selected prompt and file" }));
const matrix = () => within(screen.getByRole("table", { name: "File operations by prompt" }));
const cell = (path: string, prompt = "01") => matrix().getByRole("button", { name: new RegExp(`^${path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}, prompt ${prompt}:`) });
const promptButton = (number: string) => matrix().getByRole("button", { name: new RegExp(`^Prompt ${number}:`) });

test("heat counts successful operations, distinct files, and separate pending and failed attempts", async () => {
  const user = userEvent.setup();
  const prompt: PromptActivity = {
    id: "1", sessionID: "s1", text: "Update files", files: [
      { path: "src/app.ts", action: "read", outcome: "success", callID: "read1" },
      { path: "src/app.ts", action: "read", outcome: "success", callID: "read2" },
      { path: "src/app.ts", action: "modified", outcome: "success", callID: "edit1" },
      { path: "src/app.ts", action: "written", outcome: "success", callID: "write1" },
      { path: "src/new.ts", action: "created", outcome: "pending", callID: "add1" },
      { path: "src/gone.ts", action: "deleted", outcome: "failed", callID: "delete1" },
    ],
  };
  const { container } = render(<FileActivity events={[message(1, prompt)]} sessions={[]} selectedSession="" />);
  expect(container.querySelector("#total-files")?.textContent).toBe("3");
  expect(container.querySelector("#total-operations")?.textContent).toBe("4");
  expect(inspector().getByText("1 file touched / 1 confirmed changed")).toBeTruthy();
  expect(cell("src/app.ts").getAttribute("data-heat")).toBe("3");
  expect(cell("src/app.ts").textContent).toBe("4");
  expect(cell("src/new.ts").getAttribute("data-heat")).toBe("0");
  expect(cell("src/new.ts").getAttribute("data-pending")).toBe("true");
  expect(cell("src/gone.ts").getAttribute("data-failed")).toBe("true");
  expect(promptButton("01").title).toContain("1 files");
  const list = within(inspector().getByRole("list", { name: "Touched files" }));
  expect(list.getAllByText("Read")).toHaveLength(1);
  for (const badge of ["Edit", "Write", "Added (pending)", "Deleted (failed)"]) expect(list.getByText(badge)).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "Reads" }));
  expect(cell("src/app.ts").textContent).toBe("2");
  expect(cell("src/gone.ts").hasAttribute("data-failed")).toBe(false);
  await user.click(screen.getByRole("button", { name: "Changes" }));
  expect(cell("src/app.ts").textContent).toBe("2");
  expect(cell("src/new.ts").getAttribute("data-pending")).toBe("true");
});

test("preserves prompt order across late outcomes, pins history and resumes following", async () => {
  const user = userEvent.setup();
  const first: PromptActivity = { id: "1", sessionID: "s1", text: "First prompt", files: [] };
  const second: PromptActivity = { id: "2", sessionID: "s1", text: "Second prompt", files: [] };
  const completed: PromptActivity = { ...first, files: [{ path: "old.ts", action: "modified", outcome: "success", callID: "c1" }] };
  const events = [message(1, first), message(2, second), message(3, completed)];
  const { rerender } = render(<FileActivity events={events} sessions={[]} selectedSession="" />);
  expect(promptButton("02").getAttribute("aria-pressed")).toBe("true");
  expect(inspector().queryByText("old.ts")).toBeNull();
  expect(cell("old.ts", "01").textContent).toBe("1");
  await user.click(promptButton("01"));
  expect(inspector().getByText("old.ts")).toBeTruthy();
  const third: PromptActivity = { id: "3", sessionID: "s1", text: "Third prompt", files: [] };
  rerender(<FileActivity events={[...events, message(4, third)]} sessions={[]} selectedSession="" />);
  expect(promptButton("01").getAttribute("aria-pressed")).toBe("true");
  await user.click(screen.getByRole("button", { name: "Follow latest" }));
  expect(promptButton("03").getAttribute("aria-pressed")).toBe("true");
  expect(screen.getByRole("button", { name: "Following latest" }).getAttribute("aria-pressed")).toBe("true");
});

test("undo and redo update an older column without moving a pinned or following selection", async () => {
  const user = userEvent.setup();
  const first: PromptActivity = { id: "1", sessionID: "s1", text: "First prompt", files: [
    { path: "src/app.ts", action: "modified", outcome: "success", callID: "edit" },
    { path: "src/active.ts", action: "written", outcome: "success", callID: "active" },
  ] };
  const second: PromptActivity = { id: "2", sessionID: "s1", text: "Second prompt", files: [] };
  const events = [message(1, first), message(2, second)];
  const { rerender } = render(<FileActivity events={events} sessions={[]} selectedSession="" />);
  const reverted: PromptActivity = { ...first, files: first.files.map((file) => file.callID === "edit" ? { ...file, reverted: true } : file) };
  const update = { ...message(3, second), fileActivityUpdates: [reverted] };
  rerender(<FileActivity events={[...events, update]} sessions={[]} selectedSession="" />);
  expect(promptButton("02").getAttribute("aria-pressed")).toBe("true");
  expect(cell("src/app.ts").textContent).toBe("1");
  expect(cell("src/app.ts").getAttribute("data-reverted")).toBe("true");
  await user.click(screen.getByRole("button", { name: "Changes" }));
  expect(cell("src/app.ts").getAttribute("data-heat")).toBe("0");
  expect(cell("src/active.ts").textContent).toBe("1");
  await user.click(promptButton("01"));
  expect(inspector().getByText("Edit (Reverted)")).toBeTruthy();
  expect(inspector().getByText("2 files touched / 1 confirmed changed")).toBeTruthy();
  rerender(<FileActivity events={[...events, update, { ...message(4, second), fileActivityUpdates: [first] }]} sessions={[]} selectedSession="" />);
  expect(promptButton("01").getAttribute("aria-pressed")).toBe("true");
  expect(inspector().queryByText("Edit (Reverted)")).toBeNull();
  expect(inspector().getByText("2 files touched / 2 confirmed changed")).toBeTruthy();
  expect(cell("src/app.ts").textContent).toBe("1");
});

test("searches full paths and preserves collapsed folders across live updates", async () => {
  const user = userEvent.setup();
  const first: PromptActivity = { id: "1", sessionID: "s1", text: "Read files", files: [
    { path: "src/app.ts", action: "read", outcome: "pending", callID: "read" },
    { path: "tests/app.test.ts", action: "read", outcome: "success", callID: "test" },
  ] };
  const { rerender } = render(<FileActivity events={[message(1, first)]} sessions={[]} selectedSession="" />);
  await user.click(matrix().getByRole("button", { name: /src\//, expanded: true }));
  const complete = { ...first, files: first.files.map((file) => ({ ...file, outcome: "success" as const })) };
  rerender(<FileActivity events={[message(1, first), message(2, complete)]} sessions={[]} selectedSession="" />);
  expect(matrix().getByRole("button", { name: /src\//, expanded: false })).toBeTruthy();
  expect(matrix().queryByText("app.ts")).toBeNull();
  await user.type(screen.getByRole("searchbox", { name: "Find a file or folder" }), "TESTS/");
  expect(matrix().getByText("app.test.ts")).toBeTruthy();
  expect(matrix().queryByRole("button", { name: /src\//, expanded: false })).toBeNull();
  await user.clear(screen.getByRole("searchbox", { name: "Find a file or folder" }));
  await user.type(screen.getByRole("searchbox", { name: "Find a file or folder" }), "missing");
  expect(screen.getByRole("heading", { name: "No matching files" })).toBeTruthy();
});

test("supports keyboard cell navigation and selecting a file without pointer input", async () => {
  const user = userEvent.setup();
  const first: PromptActivity = { id: "1", sessionID: "s1", text: "First", files: [{ path: "app.ts", action: "read", outcome: "success", callID: "a" }] };
  render(<FileActivity events={[message(1, first), message(2, { ...first, id: "2", text: "Second" })]} sessions={[]} selectedSession="" />);
  cell("app.ts", "02").focus();
  await user.keyboard("{ArrowLeft}");
  expect(document.activeElement).toBe(cell("app.ts", "01"));
  expect(promptButton("02").getAttribute("aria-pressed")).toBe("true");
  await user.keyboard("{Enter}");
  expect(cell("app.ts", "01").getAttribute("aria-pressed")).toBe("true");
  expect(inspector().getByRole("heading", { name: "app.ts" })).toBeTruthy();
  expect(document.querySelectorAll('.heatmap-cell[tabindex="0"]')).toHaveLength(1);
});

test("keeps same-ID prompts isolated across sessions and reconstructs replacement snapshots", async () => {
  const user = userEvent.setup();
  const a: PromptActivity = { id: "1", sessionID: "s1", text: "First session prompt", files: [{ path: "a.ts", action: "read", outcome: "success", callID: "a" }] };
  const b: PromptActivity = { id: "1", sessionID: "s2", text: "Second session prompt", files: [{ path: "b.ts", action: "modified", outcome: "success", callID: "b" }] };
  const events = [message(1, a), message(2, b)];
  const { rerender, container } = render(<FileActivity events={events} sessions={[]} selectedSession="" />);
  expect(container.querySelector("#total-prompts")?.textContent).toBe("2");
  await user.click(promptButton("01"));
  rerender(<FileActivity events={events} sessions={[]} selectedSession="s2" />);
  expect(matrix().queryByText("a.ts")).toBeNull();
  expect(inspector().getByRole("heading", { name: "Second session prompt" })).toBeTruthy();
  rerender(<FileActivity events={[message(2, { ...b, files: [...b.files, ...b.files] })]} sessions={[]} selectedSession="s2" />);
  expect(container.querySelector("#total-operations")?.textContent).toBe("1");
});

test("shows empty states and safely renders prompt and file text", () => {
  const { rerender, container } = render(<FileActivity events={[]} sessions={[]} selectedSession="" />);
  expect(screen.getByRole("heading", { name: "Ready when you are" })).toBeTruthy();
  expect((screen.getByRole("button", { name: "Following latest" }) as HTMLButtonElement).disabled).toBe(true);
  const prompt: PromptActivity = { id: "1", sessionID: "s1", text: "<img src=x onerror=alert(1)>", files: [] };
  rerender(<FileActivity events={[message(1, prompt)]} sessions={[]} selectedSession="" />);
  expect(inspector().getByText("No explicit file activity recorded for this prompt yet.")).toBeTruthy();
  rerender(<FileActivity events={[message(2, { ...prompt, files: [{ path: "<script>alert(1)</script>.ts", action: "read", outcome: "success", callID: "c1" }] })]} sessions={[]} selectedSession="" />);
  expect(inspector().getByText("1 file touched / 0 confirmed changed")).toBeTruthy();
  expect(container.querySelector("img, script")).toBeNull();
});

function recording() {
  const tracker = new FileActivityTracker();
  const events: ReceivedEvent[] = [];
  const publish = (tag: string, data: Record<string, unknown>, sessionID = "s1") => {
    const event = { tag, sessionID, pluginID: "test", [tag]: { type: tag, data: { sessionID, ...data } } } as unknown as LogEvent;
    const [fileActivity, ...fileActivityUpdates] = tracker.processAll(event);
    events.push({ id: events.length + 1, receivedAt: 1_700_000_000_000 + events.length, event, fileActivity, fileActivityUpdates });
  };
  return { events, publish };
}

test("related events include tool starts and outcomes, excluding other files and same-call-ID sessions", async () => {
  const user = userEvent.setup();
  const { events, publish } = recording();
  publish("session.prompt", { text: "Read two files" });
  for (const [id, path] of [["a", "a.ts"], ["b", "b.ts"]]) {
    publish("session.tool.input.started", { id, name: "read" });
    publish("session.tool.called", { id, input: { path } });
    publish("session.tool.success", { id });
  }
  publish("session.prompt", { text: "Other session" }, "s2");
  publish("session.tool.called", { id: "a", tool: "read", input: { path: "other.ts" } }, "s2");
  render(<FileActivity events={events} sessions={[]} selectedSession="" />);
  await user.click(cell("a.ts", "01"));
  await user.click(inspector().getByRole("button", { name: "Inspect 3 related events" }));
  const feed = within(screen.getByRole("region", { name: "Session events" }));
  expect(feed.getAllByRole("article")).toHaveLength(3);
  expect(feed.getAllByRole("article").map((article) => article.textContent).join(" ")).toContain("session.tool.input.started");
  expect(feed.getAllByRole("article").map((article) => article.textContent).join(" ")).not.toContain("other.ts");
  await user.click(screen.getByRole("button", { name: "Show all events" }));
  expect(feed.getAllByRole("article")).toHaveLength(events.length);
});

test("inverse patches update heat and reverted badges without native undo events", async () => {
  const user = userEvent.setup();
  const { events, publish } = recording();
  const patch = (marker: "+" | "-") => `*** Begin Patch\n*** Update File: environments/.env.example\n@@\n VITE_APP_NAME=demo\n${marker}# Temporary change\n*** End Patch`;
  publish("session.prompt", { text: "Make a small change and revert it" });
  publish("session.tool.input.started", { id: "add", name: "patch" });
  publish("session.tool.called", { id: "add", input: { patchText: patch("+") } });
  publish("session.tool.success", { id: "add" });
  const { rerender } = render(<FileActivity events={[...events]} sessions={[]} selectedSession="" />);
  expect(inspector().getByText("1 file touched / 1 confirmed changed")).toBeTruthy();
  publish("session.tool.input.started", { id: "remove", name: "patch" });
  publish("session.tool.called", { id: "remove", input: { patchText: patch("-") } });
  publish("session.tool.success", { id: "remove" });
  rerender(<FileActivity events={[...events]} sessions={[]} selectedSession="" />);
  expect(inspector().getAllByText("Edit (Reverted)")).toHaveLength(1);
  expect(inspector().getByText("1 file touched / 0 confirmed changed")).toBeTruthy();
  expect(cell("environments/.env.example").textContent).toBe("2");
  await user.click(screen.getByRole("button", { name: "Changes" }));
  expect(cell("environments/.env.example").getAttribute("data-heat")).toBe("0");
});

test("Git status and shell cleanup do not invent reverted file actions", () => {
  const { events, publish } = recording();
  publish("session.prompt", { text: "Optimize the service" });
  publish("session.tool.called", { id: "service", tool: "edit", input: { path: "src/Service.cs" } });
  publish("session.tool.success", { id: "service" });
  publish("session.tool.called", { id: "swagger", tool: "patch", input: { patchText: "*** Begin Patch\n*** Update File: swagger.json\n@@\n-generated\n+original\n*** End Patch" } });
  publish("session.tool.success", { id: "swagger" });
  publish("session.tool.called", { id: "cleanup", tool: "shell", input: { command: "python3 cleanup.py" } });
  publish("session.tool.success", { id: "cleanup" });
  publish("session.tool.called", { id: "status", tool: "shell", input: { command: "git status --short" } });
  publish("session.tool.success", { id: "status", content: [{ type: "text", text: " M src/Service.cs\n" }] });
  render(<FileActivity events={events} sessions={[]} selectedSession="" />);
  expect(inspector().queryByText("Edit (Reverted)")).toBeNull();
  expect(inspector().getByText("2 files touched / 2 confirmed changed")).toBeTruthy();
});
