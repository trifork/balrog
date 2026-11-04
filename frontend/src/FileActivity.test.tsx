import { act, cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { PromptActivity } from "../../server/file-activity";
import { SessionActivityAnalyzer } from "../../server/session-activity";
import { createActivityUpdates } from "../../tests/activity-fixtures";
import type { LogEvent } from "../../server/log-receiver";
import { FileActivity } from "./FileActivity";
import type { ReceivedEvent } from "./useViewer";

let activityUpdates: ReturnType<typeof createActivityUpdates>;
beforeEach(() => {
  activityUpdates = createActivityUpdates();
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false })));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function message(id: number, activity: PromptActivity, ...updates: PromptActivity[]): ReceivedEvent {
  return {
    id, receivedAt: 1_700_000_000_000 + id,
    event: { tag: "session.prompt", sessionID: activity.sessionID, pluginID: "test" } as unknown as LogEvent,
    activityUpdates: activityUpdates(id, activity, ...updates),
  };
}

const inspector = () => within(screen.getByRole("complementary", { name: "Selected prompt and file" }));
const matrix = () => within(screen.getByRole("table", { name: "File operations by prompt" }));
const cell = (path: string, prompt = "01") => matrix().getByRole("button", { name: new RegExp(`^${path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}, prompt ${prompt}:`) });
const promptHeader = (number: string) => matrix().getByRole("columnheader", { name: new RegExp(`^Prompt ${number.padStart(2, "0")}:`) });
const selectPrompt = async (user: ReturnType<typeof userEvent.setup>, number: string) => {
  await user.click(matrix().getAllByRole("button", { name: new RegExp(`, prompt ${number}:`) })[0]);
  await user.click(inspector().getByRole("button", { name: "Show all files for this prompt" }));
};

test("only opens the inspector after a prompt column is selected and closes it on reset or session changes", async () => {
  const user = userEvent.setup();
  const first: PromptActivity = { id: "1", sessionID: "s1", text: "First prompt", files: [
    { path: "src/app.ts", action: "read", outcome: "success", callID: "read" },
  ] };
  const second: PromptActivity = { ...first, id: "2", text: "Second prompt" };
  const events = [message(1, first)];
  const { rerender, container } = render(<FileActivity events={events} sessions={[]} selectedSession="s1" />);
  const panel = () => screen.queryByRole("complementary", { name: "Selected prompt and file" });
  const body = container.querySelector(".activity-body")!;
  expect(panel()).toBeNull();
  expect(body.hasAttribute("data-inspector-open")).toBe(false);
  const updated = [...events, message(2, second)];
  rerender(<FileActivity events={updated} sessions={[]} selectedSession="s1" />);
  expect(panel()).toBeNull();
  await user.click(matrix().getByTitle("src/app.ts"));
  expect(panel()).toBeNull();
  await selectPrompt(user, "01");
  expect(inspector().getByRole("heading", { name: "First prompt" })).toBeTruthy();
  expect(body.hasAttribute("data-inspector-open")).toBe(true);
  await user.click(screen.getByRole("button", { name: "All prompts" }));
  expect(panel()).toBeNull();
  expect(body.hasAttribute("data-inspector-open")).toBe(false);
  await user.click(cell("src/app.ts", "02"));
  expect(inspector().getByRole("heading", { name: "app.ts" })).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "All prompts" }));
  expect(panel()).toBeNull();
  await selectPrompt(user, "01");
  rerender(<FileActivity events={updated} sessions={[]} selectedSession="s2" />);
  expect(panel()).toBeNull();
  rerender(<FileActivity events={updated} sessions={[]} selectedSession="s1" />);
  expect(panel()).toBeNull();
});

test("shows clickable chronological subagent labels beside their starting prompts, even without files", async () => {
  const user = userEvent.setup();
  const events = [
    message(1, { id: "1", sessionID: "parent", text: "First prompt", files: [] }),
    message(5, { id: "2", sessionID: "parent", text: "Second prompt", files: [] }),
  ];
  const starts = [
    { sessionID: "child-1", parentID: "parent", label: "S1", timestamp: 1_700_000_000_002, startEventID: 2 },
    { sessionID: "child-2", parentID: "parent", label: "S2", timestamp: 1_700_000_000_003, startEventID: 3 },
    { sessionID: "child-3", parentID: "parent", label: "S3", timestamp: 1_700_000_000_006, startEventID: 6 },
  ];
  const onSelect = vi.fn();
  const props = { events, sessions: [], selectedSession: "parent", subagentStarts: starts, onSelectSubagent: onSelect };
  const { rerender } = render(<FileActivity {...props} />);
  const first = within(promptHeader("01"));
  expect(first.getAllByRole("link").map((link) => link.textContent)).toEqual(["S1", "S2"]);
  const link = first.getByRole("link", { name: /S1: child-1/ });
  expect(link.getAttribute("href")).toContain("session=child-1");
  expect(link.getAttribute("title")).toContain("started");
  await user.click(link);
  expect(onSelect).toHaveBeenCalledWith("child-1");
  expect(within(promptHeader("02")).getByRole("link", { name: /S3: child-3/ })).toBeTruthy();
  rerender(<FileActivity {...props} cutoffEventID={2} />);
  expect(within(promptHeader("01")).getAllByRole("link").map((link) => link.textContent)).toEqual(["S1"]);
  expect(within(promptHeader("02")).queryByRole("link")).toBeNull();
});

test("mobile inspector opens and focuses only after selecting a prompt, including after All prompts", async () => {
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: true })));
  const user = userEvent.setup();
  const first: PromptActivity = { id: "1", sessionID: "s1", text: "Read a file", files: [
    { path: "app.ts", action: "read", outcome: "success", callID: "read" },
  ] };
  render(<FileActivity events={[message(1, first)]} sessions={[]} selectedSession="" />);
  await user.click(matrix().getByTitle("app.ts"));
  expect(screen.queryByRole("complementary", { name: "Selected prompt and file" })).toBeNull();
  await user.click(cell("app.ts"));
  expect(document.activeElement).toBe(screen.getByRole("button", { name: "Close detail panel" }));
  await user.keyboard("{Escape}");
  expect(document.activeElement).toBe(cell("app.ts"));
  expect(screen.getByRole("complementary").hasAttribute("data-mobile-open")).toBe(false);
  await user.click(screen.getByRole("button", { name: "All prompts" }));
  expect(screen.queryByRole("complementary")).toBeNull();
  await user.click(cell("app.ts"));
  expect(screen.getByRole("complementary").hasAttribute("data-mobile-open")).toBe(true);
  expect(document.activeElement).toBe(screen.getByRole("button", { name: "Close detail panel" }));
});

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
  render(<FileActivity events={[message(1, prompt)]} sessions={[]} selectedSession="" />);
  expect(screen.getByText("3 files × 1 prompts")).toBeTruthy();
  await selectPrompt(user, "01");
  expect(inspector().getByText("1 file touched / 1 confirmed changed")).toBeTruthy();
  expect(cell("src/app.ts").getAttribute("data-heat")).toBe("3");
  expect(cell("src/app.ts").textContent).toBe("4");
  expect(cell("src/new.ts").getAttribute("data-heat")).toBe("0");
  expect(cell("src/new.ts").getAttribute("data-pending")).toBe("true");
  expect(cell("src/gone.ts").getAttribute("data-failed")).toBe("true");
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

test("starts without an inspector, preserves prompt filters across updates, and closes on All prompts", async () => {
  const user = userEvent.setup();
  const first: PromptActivity = { id: "1", sessionID: "s1", text: "First prompt", files: [] };
  const second: PromptActivity = { id: "2", sessionID: "s1", text: "Second prompt", files: [] };
  const completed: PromptActivity = { ...first, files: [{ path: "old.ts", action: "modified", outcome: "success", callID: "c1" }] };
  const events = [message(1, first), message(2, second), message(3, completed)];
  const { rerender } = render(<FileActivity events={events} sessions={[]} selectedSession="" />);
  expect(promptHeader("02").hasAttribute("data-selected")).toBe(false);
  expect(screen.getByRole("button", { name: "All prompts" }).getAttribute("aria-pressed")).toBe("true");
  expect(screen.queryByRole("complementary", { name: "Selected prompt and file" })).toBeNull();
  expect(cell("old.ts", "01").textContent).toBe("1");
  await selectPrompt(user, "01");
  expect(inspector().getByText("old.ts")).toBeTruthy();
  const third: PromptActivity = { id: "3", sessionID: "s1", text: "Third prompt", files: [] };
  rerender(<FileActivity events={[...events, message(4, third)]} sessions={[]} selectedSession="" />);
  expect(promptHeader("01").getAttribute("data-selected")).toBe("true");
  await user.click(screen.getByRole("button", { name: "All prompts" }));
  expect(promptHeader("03").hasAttribute("data-selected")).toBe(false);
  expect(screen.getByRole("button", { name: "All prompts" }).getAttribute("aria-pressed")).toBe("true");
  expect(screen.queryByRole("complementary", { name: "Selected prompt and file" })).toBeNull();
  await selectPrompt(user, "02");
  expect(inspector().queryByText("old.ts")).toBeNull();
  await user.click(screen.getByRole("button", { name: "All prompts" }));
  expect(screen.queryByRole("complementary", { name: "Selected prompt and file" })).toBeNull();
});

test("highlights the entire selected prompt column across headers, folders and files", async () => {
  const user = userEvent.setup();
  const first: PromptActivity = { id: "1", sessionID: "s1", text: "First prompt", files: [
    { path: "src/app.ts", action: "read", outcome: "success", callID: "read" },
    { path: "tests/app.test.ts", action: "modified", outcome: "success", callID: "edit" },
  ] };
  const second: PromptActivity = { id: "2", sessionID: "s1", text: "Second prompt", files: [
    { path: "src/new.ts", action: "created", outcome: "success", callID: "create" },
  ] };
  const events = [message(1, first), message(2, second)];
  const { rerender } = render(<FileActivity events={events} sessions={[]} selectedSession="" />);
  const expectColumn = (column?: number) => {
    for (const row of matrix().getAllByRole("row")) {
      expect([...row.querySelectorAll(":scope > [data-selected]")]).toEqual(column === undefined ? [] : [row.children[column + 1]]);
    }
  };
  expectColumn();
  await selectPrompt(user, "01");
  expectColumn(0);
  expect(cell("src/app.ts", "01").getAttribute("data-heat")).toBe("1");
  expect(cell("src/app.ts", "02").getAttribute("data-heat")).toBe("0");
  await selectPrompt(user, "02");
  expectColumn(1);
  await user.click(matrix().getByRole("button", { name: /tests\//, expanded: true }));
  expectColumn(1);
  await user.type(screen.getByRole("searchbox", { name: "Find a file or folder" }), "src/");
  expectColumn(1);
  await user.clear(screen.getByRole("searchbox", { name: "Find a file or folder" }));
  const third: PromptActivity = { id: "3", sessionID: "s1", text: "Third prompt", files: [] };
  rerender(<FileActivity events={[...events, message(3, third)]} sessions={[]} selectedSession="" />);
  expectColumn(1);
  await user.click(cell("src/app.ts", "01"));
  expectColumn(0);
  await user.keyboard("{ArrowRight}{Enter}");
  expectColumn(1);
  await user.click(screen.getByRole("button", { name: "All prompts" }));
  expectColumn();
  await selectPrompt(user, "02");
  await user.click(screen.getByRole("button", { name: "All prompts" }));
  expectColumn();
});

test("undo and redo update an older column without changing file activity or the selected filter", async () => {
  const user = userEvent.setup();
  const first: PromptActivity = { id: "1", sessionID: "s1", text: "First prompt", files: [
    { path: "src/app.ts", action: "modified", outcome: "success", callID: "edit" },
    { path: "src/active.ts", action: "written", outcome: "success", callID: "active" },
  ] };
  const second: PromptActivity = { id: "2", sessionID: "s1", text: "Second prompt", files: [] };
  const events = [message(1, first), message(2, second)];
  const { rerender } = render(<FileActivity events={events} sessions={[]} selectedSession="" />);
  const reverted: PromptActivity = { ...first, files: first.files.map((file) => file.callID === "edit" ? { ...file, reverted: true } : file) };
  const update = message(3, second, reverted);
  rerender(<FileActivity events={[...events, update]} sessions={[]} selectedSession="" />);
  expect(promptHeader("02").hasAttribute("data-selected")).toBe(false);
  expect(cell("src/app.ts").textContent).toBe("1");
  expect(cell("src/app.ts").getAttribute("data-reverted")).toBe("true");
  await user.click(screen.getByRole("button", { name: "Changes" }));
  expect(cell("src/app.ts").getAttribute("data-heat")).toBe("0");
  expect(cell("src/active.ts").textContent).toBe("1");
  await selectPrompt(user, "01");
  expect(inspector().getByText("Edit (Reverted)")).toBeTruthy();
  expect(inspector().getByText("2 files touched / 1 confirmed changed")).toBeTruthy();
  rerender(<FileActivity events={[...events, update, message(4, second, first)]} sessions={[]} selectedSession="" />);
  expect(promptHeader("01").getAttribute("data-selected")).toBe("true");
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

test("keeps long observed folder paths and file names intact through selection and folder toggling", async () => {
  const user = userEvent.setup();
  const folder = "src/features/observed-file-activity/deeply-nested-directory-with-a-long-name";
  const name = "a-very-long-observed-file-name-that-must-remain-readable-without-ellipsis.test.ts";
  const path = `${folder}/${name}`;
  const prompt: PromptActivity = { id: "1", sessionID: "s1", text: "Read a nested file", files: [
    { path, action: "read", outcome: "success", callID: "read" },
  ] };
  render(<FileActivity events={[message(1, prompt)]} sessions={[]} selectedSession="" />);
  expect(within(matrix().getByTitle(folder)).getByText(`${folder.split("/").at(-1)}/`)).toBeTruthy();
  const label = matrix().getByTitle(path);
  expect(within(label).getByText(name)).toBeTruthy();
  await user.click(label);
  expect(screen.queryByRole("complementary")).toBeNull();
  await user.click(cell(path));
  expect(inspector().getByRole("heading", { name })).toBeTruthy();
  await user.click(matrix().getByTitle(folder));
  expect(matrix().queryByTitle(path)).toBeNull();
  await user.click(matrix().getByTitle(folder));
  expect(within(matrix().getByTitle(path)).getByText(name)).toBeTruthy();
  expect(cell(path).getAttribute("aria-pressed")).toBe("true");
});

test("only pins the file column when there is room to see prompt columns", () => {
  let viewportWidth = 400;
  let resize = () => {};
  const disconnect = vi.fn();
  vi.stubGlobal("ResizeObserver", class {
    constructor(callback: () => void) { resize = callback; }
    observe = vi.fn();
    disconnect = disconnect;
  });
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    return new DOMRect(0, 0, this.matches(".heatmap-scope > th:first-child") ? 500 : 0, 100);
  });
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(function (this: HTMLElement) {
    return this.classList.contains("heatmap-scroll") ? viewportWidth : 0;
  });
  const prompt: PromptActivity = { id: "1", sessionID: "s1", text: "Read a file", files: [
    { path: "src/app.ts", action: "read", outcome: "success", callID: "read" },
  ] };
  const { container, unmount } = render(<FileActivity events={[message(1, prompt)]} sessions={[]} selectedSession="" />);
  const scroller = container.querySelector(".heatmap-scroll")!;
  expect(scroller.hasAttribute("data-file-column-pinned")).toBe(false);
  act(() => { viewportWidth = 1000; resize(); });
  expect(scroller.hasAttribute("data-file-column-pinned")).toBe(true);
  act(() => { viewportWidth = 400; resize(); });
  expect(scroller.hasAttribute("data-file-column-pinned")).toBe(false);
  unmount();
  expect(disconnect).toHaveBeenCalledOnce();
});

test("supports keyboard cell navigation and selecting a file without pointer input", async () => {
  const user = userEvent.setup();
  const first: PromptActivity = { id: "1", sessionID: "s1", text: "First", files: [{ path: "app.ts", action: "read", outcome: "success", callID: "a" }] };
  render(<FileActivity events={[message(1, first), message(2, { ...first, id: "2", text: "Second" })]} sessions={[]} selectedSession="" />);
  cell("app.ts", "02").focus();
  await user.keyboard("{ArrowLeft}");
  expect(document.activeElement).toBe(cell("app.ts", "01"));
  expect(promptHeader("02").hasAttribute("data-selected")).toBe(false);
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
  const { rerender } = render(<FileActivity events={events} sessions={[]} selectedSession="" />);
  expect(screen.getByText("2 files × 2 prompts")).toBeTruthy();
  await selectPrompt(user, "01");
  rerender(<FileActivity events={events} sessions={[]} selectedSession="s2" />);
  expect(matrix().queryByText("a.ts")).toBeNull();
  expect(screen.queryByRole("complementary", { name: "Selected prompt and file" })).toBeNull();
  await selectPrompt(user, "01");
  expect(inspector().getByRole("heading", { name: "Second session prompt" })).toBeTruthy();
  expect(inspector().getByText("b.ts")).toBeTruthy();
  rerender(<FileActivity events={[message(2, { ...b, files: [...b.files, ...b.files] })]} sessions={[]} selectedSession="s2" />);
  expect(cell("b.ts").textContent).toBe("1");
});

test("shows empty states and safely renders prompt and file text", async () => {
  const user = userEvent.setup();
  const { rerender, container } = render(<FileActivity events={[]} sessions={[]} selectedSession="" />);
  expect(screen.getByRole("heading", { name: "Ready when you are" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "All prompts" }).getAttribute("aria-pressed")).toBe("true");
  const prompt: PromptActivity = { id: "1", sessionID: "s1", text: "<img src=x onerror=alert(1)>", files: [] };
  rerender(<FileActivity events={[message(1, prompt)]} sessions={[]} selectedSession="" />);
  expect(screen.queryByRole("complementary")).toBeNull();
  expect(screen.getByRole("heading", { name: "No matching files" })).toBeTruthy();
  rerender(<FileActivity events={[message(2, { ...prompt, files: [{ path: "<script>alert(1)</script>.ts", action: "read", outcome: "success", callID: "c1" }] })]} sessions={[]} selectedSession="" />);
  expect(promptHeader("01").getAttribute("aria-label")).toContain("<img src=x onerror=alert(1)>");
  await selectPrompt(user, "01");
  expect(inspector().getByText("1 file touched / 0 confirmed changed")).toBeTruthy();
  expect(container.querySelector("img, script")).toBeNull();
});

function recording() {
  const tracker = new SessionActivityAnalyzer();
  const events: ReceivedEvent[] = [];
  const record = (event: LogEvent) => {
    tracker.process(event);
    events.push({ id: events.length + 1, receivedAt: 1_700_000_000_000 + events.length, event, activityUpdates: tracker.getUpdates(event) });
  };
  const publish = (tag: string, data: Record<string, unknown>, sessionID = "s1") => {
    record({ tag, sessionID, pluginID: "test", [tag]: { type: tag, data: { sessionID, ...data } } } as unknown as LogEvent);
  };
  const initialize = (directory: string) => record({
    tag: "initialize", sessionID: null, pluginID: "test", initialize: { context: { location: { directory } } },
  } as unknown as LogEvent);
  return { events, publish, initialize };
}

test("splits workspace and external files while keeping search, folder collapse and keyboard order consistent", async () => {
  const user = userEvent.setup();
  const { events, publish, initialize } = recording();
  initialize("/workspace");
  publish("session.prompt", { text: "Inspect workspace and external files" });
  publish("session.tool.called", { id: "inside", tool: "read", input: { path: "/workspace/src/app.ts" } });
  publish("session.tool.success", { id: "inside" });
  const earlier = [...events];
  publish("session.tool.called", { id: "outside", tool: "read", input: { path: "/etc/agent.conf" } });
  publish("session.tool.success", { id: "outside" });
  publish("session.tool.called", { id: "grep", tool: "grep", input: { path: "/workspace", pattern: "needle" } });
  publish("session.tool.success", { id: "grep", content: [{
    type: "text", text: "Found 2 matches\n/workspace/src/matched.ts:\n  Line 1: needle\n../shared/helper.ts:\n  Line 2: needle",
  }] });
  const { rerender } = render(<FileActivity events={events} sessions={[]} selectedSession="s1" />);
  const inside = within(matrix().getByRole("rowgroup", { name: "In workspace" }));
  const outside = within(matrix().getByRole("rowgroup", { name: "Outside workspace" }));
  expect(inside.getByText("2 files")).toBeTruthy();
  expect(outside.getByText("2 files")).toBeTruthy();
  expect(inside.getByTitle("src/app.ts")).toBeTruthy();
  expect(inside.getByTitle("src/matched.ts")).toBeTruthy();
  expect(outside.getByTitle("/etc/agent.conf")).toBeTruthy();
  expect(outside.getByTitle("../shared/helper.ts")).toBeTruthy();
  expect(promptHeader("01").closest("tr")).toBe(matrix().getByRole("rowgroup", { name: "Outside workspace" }).firstElementChild);
  expect(inside.queryByRole("columnheader")).toBeNull();
  expect(matrix().queryByRole("rowgroup", { name: "Workspace unknown" })).toBeNull();
  const renderedCells = [...screen.getByRole("table").querySelectorAll<HTMLButtonElement>('.heatmap-cell[data-column="0"]')];
  expect([...screen.getByRole("table").querySelectorAll("tbody")].map((body) => body.getAttribute("aria-label"))).toEqual(["Outside workspace", "In workspace"]);
  expect(renderedCells.slice(-2)).toEqual([cell("src/app.ts"), cell("src/matched.ts")]);
  renderedCells[1].focus();
  await user.keyboard("{ArrowDown}");
  expect(document.activeElement).toBe(renderedCells[2]);
  await user.keyboard("{Enter}");
  expect(screen.getByRole("complementary")).toBeTruthy();
  await user.click(matrix().getByTitle("src"));
  expect(matrix().queryByTitle("src/app.ts")).toBeNull();
  expect(outside.getByTitle("/etc/agent.conf")).toBeTruthy();
  await user.click(matrix().getByTitle("src"));
  await user.type(screen.getByRole("searchbox", { name: "Find a file or folder" }), "src/");
  expect(matrix().queryByRole("rowgroup", { name: "Outside workspace" })).toBeNull();
  expect(matrix().getByRole("rowgroup", { name: "In workspace" })).toBeTruthy();
  expect(promptHeader("01").closest("tr")).toBe(matrix().getByRole("rowgroup", { name: "In workspace" }).firstElementChild);
  await user.clear(screen.getByRole("searchbox", { name: "Find a file or folder" }));
  await user.click(screen.getByRole("button", { name: "Reads" }));
  expect(cell("src/matched.ts").textContent).toBe("1");
  expect(cell("../shared/helper.ts").textContent).toBe("1");
  rerender(<FileActivity events={earlier} sessions={[]} selectedSession="s1" />);
  expect(matrix().getByRole("rowgroup", { name: "In workspace" })).toBeTruthy();
  expect(matrix().queryByRole("rowgroup", { name: "Outside workspace" })).toBeNull();
});

test("workspace folders form a collapsible tree and retain nested collapse state across live updates", async () => {
  const user = userEvent.setup();
  const first: PromptActivity = { id: "1", sessionID: "s1", text: "Read a workspace tree", files: [
    { path: "README.md", action: "read", outcome: "success", callID: "root" },
    { path: "src/other.ts", action: "read", outcome: "success", callID: "other" },
    { path: "src/features/alpha.ts", action: "read", outcome: "success", callID: "alpha" },
    { path: "src/features/nested/beta.ts", action: "read", outcome: "success", callID: "beta" },
    { path: "../shared/helper.ts", action: "read", outcome: "success", callID: "external" },
  ] };
  const initial = [message(1, first)];
  const { rerender } = render(<FileActivity events={initial} sessions={[]} selectedSession="s1" />);
  const tree = within(matrix().getByRole("rowgroup", { name: "In workspace" }));
  expect(within(tree.getByTitle("src")).getByText("src/")).toBeTruthy();
  expect(within(tree.getByTitle("src/features")).getByText("features/")).toBeTruthy();
  expect(within(tree.getByTitle("src/features/nested")).getByText("nested/")).toBeTruthy();
  expect(tree.getByTitle("src/features").closest("tr")?.style.getPropertyValue("--tree-depth")).toBe("1");
  expect(tree.getByTitle("src/features/nested/beta.ts").closest("tr")?.style.getPropertyValue("--tree-depth")).toBe("3");
  await user.click(tree.getByTitle("src/features"));
  expect(tree.queryByTitle("src/features/alpha.ts")).toBeNull();
  expect(tree.queryByTitle("src/features/nested")).toBeNull();
  expect(tree.getByTitle("src/other.ts")).toBeTruthy();
  expect(matrix().getByTitle("../shared/helper.ts")).toBeTruthy();
  const updated: PromptActivity = { ...first, files: [...first.files, { path: "src/features/new.ts", action: "read", outcome: "success", callID: "new" }] };
  rerender(<FileActivity events={[...initial, message(2, updated)]} sessions={[]} selectedSession="s1" />);
  expect(tree.getByTitle("src/features").getAttribute("aria-expanded")).toBe("false");
  expect(within(tree.getByTitle("src/features")).getByText("3")).toBeTruthy();
  expect(tree.queryByTitle("src/features/new.ts")).toBeNull();
  await user.click(tree.getByTitle("src"));
  expect(tree.queryByTitle("src/features")).toBeNull();
  expect(tree.getByTitle("README.md")).toBeTruthy();
  await user.click(tree.getByTitle("src"));
  expect(tree.getByTitle("src/features").getAttribute("aria-expanded")).toBe("false");
  await user.click(tree.getByTitle("src/features"));
  expect(tree.getByTitle("src/features/new.ts")).toBeTruthy();
  const firstCell = cell("../shared/helper.ts");
  firstCell.focus();
  await user.keyboard("{ArrowDown}");
  expect(document.activeElement).toBe(cell("src/features/nested/beta.ts"));
});

test("shows absolute file paths without recorded workspace context as unknown", () => {
  const prompt: PromptActivity = { id: "1", sessionID: "s1", text: "Read a file", files: [
    { path: "/unknown/app.ts", action: "read", outcome: "success", callID: "read" },
  ] };
  render(<FileActivity events={[message(1, prompt)]} sessions={[]} selectedSession="s1" />);
  expect(within(matrix().getByRole("rowgroup", { name: "Workspace unknown" })).getByTitle("/unknown/app.ts")).toBeTruthy();
  expect(matrix().queryByRole("rowgroup", { name: "Outside workspace" })).toBeNull();
});

test("grep matches appear under Reads with distinct badges, trace links and historical state", async () => {
  const user = userEvent.setup();
  const { events, publish } = recording();
  publish("session.prompt", { text: "Find the implementation" });
  publish("session.tool.input.started", { id: "grep", name: "grep" });
  publish("session.tool.called", { id: "grep", input: { path: "src", pattern: "needle" } });
  const pending = [...events];
  const { rerender } = render(<FileActivity events={pending} sessions={[]} selectedSession="" />);
  expect(screen.getByText("0 files × 1 prompts")).toBeTruthy();
  publish("session.tool.success", { id: "grep", content: [{
    type: "text", text: "Found 3 matches\nsrc/app.ts:\n  Line 1: needle\nsrc/match.ts:\n  Line 2: needle\nsrc/app.ts:\n  Line 3: needle",
  }] });
  publish("session.tool.called", { id: "read", tool: "read", input: { path: "src/app.ts" } });
  publish("session.tool.success", { id: "read" });
  const complete = [...events];
  rerender(<FileActivity events={complete} sessions={[]} selectedSession="" />);
  expect(screen.getByText("2 files × 1 prompts")).toBeTruthy();
  await selectPrompt(user, "01");
  expect(inspector().getByText("2 files touched / 0 confirmed changed")).toBeTruthy();
  expect(cell("src/app.ts").textContent).toBe("2");
  expect(cell("src/match.ts").textContent).toBe("1");
  const badges = within(inspector().getByRole("list", { name: "Touched files" }));
  expect(badges.getAllByText("Grep match")).toHaveLength(2);
  expect(badges.getAllByText("Read")).toHaveLength(1);
  await user.click(screen.getByRole("button", { name: "Reads" }));
  expect(cell("src/app.ts").textContent).toBe("2");
  expect(cell("src/match.ts").textContent).toBe("1");
  await user.hover(cell("src/match.ts"));
  const stats = screen.getByRole("tooltip").querySelector('[data-operation="reads"]')!;
  expect(stats.textContent).toContain("1");
  await user.click(screen.getByRole("button", { name: "Changes" }));
  expect(cell("src/match.ts").getAttribute("data-heat")).toBe("0");
  expect(inspector().getByText("2 files touched / 0 confirmed changed")).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "Reads" }));
  await user.click(cell("src/match.ts"));
  await user.click(inspector().getByRole("button", { name: "Inspect 3 related events" }));
  const feed = within(screen.getByRole("region", { name: "Session events" }));
  expect(feed.getAllByRole("article")).toHaveLength(3);
  rerender(<FileActivity events={pending} sessions={[]} selectedSession="" />);
  expect(screen.getByText("0 files × 1 prompts")).toBeTruthy();
  rerender(<FileActivity events={complete} sessions={[]} selectedSession="" />);
  expect(cell("src/match.ts").textContent).toBe("1");
});

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
  await selectPrompt(user, "01");
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

test("Git status and shell cleanup do not invent reverted file actions", async () => {
  const user = userEvent.setup();
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
  await selectPrompt(user, "01");
  expect(inspector().queryByText("Edit (Reverted)")).toBeNull();
  expect(inspector().getByText("2 files touched / 2 confirmed changed")).toBeTruthy();
});

test("removes the candle selector while preserving the map header, file groups and cell selection", async () => {
  const user = userEvent.setup();
  const first: PromptActivity = { id: "1", sessionID: "s1", text: "Mixed changes", files: [
    { path: "added.ts", action: "created", outcome: "success", callID: "a" },
    { path: "edited.ts", action: "modified", outcome: "success", callID: "b" },
    { path: "written.ts", action: "written", outcome: "success", callID: "c" },
    { path: "deleted.ts", action: "deleted", outcome: "success", callID: "d" },
    { path: "read.ts", action: "read", outcome: "success", callID: "r" },
    { path: "pending.ts", action: "created", outcome: "pending", callID: "p" },
    { path: "failed.ts", action: "deleted", outcome: "failed", callID: "f" },
    { path: "undone.ts", action: "modified", outcome: "success", callID: "u", reverted: true },
  ] };
  const second: PromptActivity = { id: "2", sessionID: "s1", text: "Read only", files: [
    { path: "read.ts", action: "read", outcome: "success", callID: "r2" },
  ] };
  render(<FileActivity events={[message(1, first), message(2, second)]} sessions={[]} selectedSession="" />);
  for (const label of ["Click a candle to filter by prompt", "Changes per prompt", "Observed files", "Earlier", "Latest"]) {
    expect(screen.queryByText(label)).toBeNull();
  }
  expect(document.querySelector(".heatmap-filter-guide")).toBeNull();
  expect(screen.queryByLabelText("Candle colors")).toBeNull();
  expect(document.querySelector(".heatmap-prompt, .heatmap-candle")).toBeNull();
  expect(matrix().queryByRole("button", { name: /^Prompt \d+:/ })).toBeNull();
  expect(screen.getByRole("heading", { name: "Activity map" })).toBeTruthy();
  const count = screen.getByText("8 files × 2 prompts");
  expect(count.parentElement).toBe(screen.getByRole("heading", { name: "Activity map" }).parentElement);
  expect(matrix().getByRole("rowgroup", { name: "In workspace" })).toBeTruthy();
  expect(document.querySelector(".heatmap thead")).toBeNull();
  expect(promptHeader("01").closest("tr")).toBe(matrix().getByRole("rowgroup", { name: "In workspace" }).firstElementChild);
  expect(promptHeader("01").textContent).toBe("Prompt 01");
  expect(promptHeader("02").textContent).toBe("Prompt 02");
  expect(promptHeader("01").title).toBe("Mixed changes");
  await user.click(promptHeader("01"));
  expect(screen.queryByRole("complementary")).toBeNull();
  expect(cell("added.ts").textContent).toBe("1");
  expect(cell("read.ts", "02").textContent).toBe("1");
  expect(cell("undone.ts").getAttribute("data-reverted")).toBe("true");
  await user.click(cell("read.ts"));
  expect(inspector().getByRole("heading", { name: "Mixed changes" })).toBeTruthy();
  expect(inspector().getByRole("heading", { name: "read.ts" })).toBeTruthy();
  expect(cell("read.ts").getAttribute("aria-pressed")).toBe("true");
  await user.click(inspector().getByRole("button", { name: "Show all files for this prompt" }));
  expect(inspector().getByText("6 files touched / 4 confirmed changed")).toBeTruthy();
  expect(matrix().getAllByRole("columnheader", { name: /^Prompt \d+:/ })).toHaveLength(2);
  await user.click(screen.getByRole("button", { name: "Expand event stream" }));
  expect(within(screen.getByRole("region", { name: "Session events" })).getAllByRole("article")).toHaveLength(1);
  await user.click(screen.getByRole("button", { name: "All prompts" }));
  expect(within(screen.getByRole("region", { name: "Session events" })).getAllByRole("article")).toHaveLength(2);
});

test("file labels only open details within an explicitly selected prompt", async () => {
  const user = userEvent.setup();
  const first: PromptActivity = { id: "1", sessionID: "s1", text: "First", files: [
    { path: "app.ts", action: "created", outcome: "success", callID: "same" },
  ] };
  const second: PromptActivity = { ...first, id: "2", text: "Second", files: [
    { path: "app.ts", action: "modified", outcome: "success", callID: "same" },
  ] };
  render(<FileActivity events={[message(1, first), message(2, second)]} sessions={[]} selectedSession="" />);
  await user.click(matrix().getByTitle("app.ts"));
  expect(screen.queryByRole("complementary", { name: "Selected prompt and file" })).toBeNull();
  await selectPrompt(user, "01");
  await user.click(inspector().getByRole("button", { name: /app.ts/ }));
  expect(inspector().getByRole("heading", { name: "app.ts" })).toBeTruthy();
  expect(inspector().getByRole("list", { name: "Recorded file operations" }).children).toHaveLength(1);
  expect(inspector().getAllByText("Added")).toHaveLength(2);
  expect(screen.getByRole("button", { name: "All prompts" }).getAttribute("aria-pressed")).toBe("false");
  await selectPrompt(user, "02");
  await user.click(matrix().getByTitle("app.ts"));
  expect(inspector().getByRole("list", { name: "Recorded file operations" }).children).toHaveLength(1);
  expect(inspector().getAllByText("Edit")).toHaveLength(2);
});
