import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Profiler } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { LogEvent } from "../../server/log-receiver";
import type { PromptActivity } from "../../server/file-activity";
import { App } from "./App";
import type { ReceivedEvent, ViewerState } from "./useViewer";
import { createActivityUpdates } from "../../tests/activity-fixtures";
import { activityAtEvents } from "./file-activity-model";

let state: ViewerState;
let activityUpdates: ReturnType<typeof createActivityUpdates>;
vi.mock("./useViewer", () => ({ useViewer: () => ({ ...state, heatmaps: activityAtEvents(state.events) }) }));

function message(id: number, tag: string, sessionID: string, content?: string): ReceivedEvent {
  return {
    id,
    event: {
      tag, sessionID, pluginID: "test", apiVersion: "v2",
      [tag]: { type: tag, data: { sessionID, text: content } },
    } as unknown as LogEvent,
    content,
    sessionTitle: sessionID === "s1" ? "First session" : "Second session",
    receivedAt: 1_700_000_000_000 + id,
  };
}

const cards = () => within(screen.getByRole("region", { name: "Session events" })).queryAllByRole("article");
const openEvents = async (user: ReturnType<typeof userEvent.setup>) => user.click(screen.getByRole("button", { name: /^(Expand|Collapse) event stream$/ }));

function command(id: number, sessionID = "s1"): ReceivedEvent {
  return {
    ...message(id, "session.tool.called", sessionID, "npm test"), command: "npm test",
    execution: {
      callID: `call-${id}`, command: { name: "shell", args: { command: "npm test" } },
      startedAt: id, completedAt: null, reason: "Run the tests.", outcome: null, result: null,
    },
  };
}

beforeEach(() => {
  activityUpdates = createActivityUpdates();
  window.history.replaceState(null, "", "/");
  vi.stubGlobal("matchMedia", vi.fn(() => ({
    matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn(),
  })));
  state = {
    heatmaps: [],
    permissions: [],
    replyPermission: vi.fn(),
    status: "live",
    sessions: [
      { sessionID: "s1", title: "First session", eventCount: 3, lastEventTag: "session.tool.failed", lastEventAt: 2, tags: [] },
      { sessionID: "s2", title: "Second session", eventCount: 1, lastEventTag: "session.text.ended", lastEventAt: 1, tags: [] },
    ],
    events: [
      message(1, "session.text.ended", "s1", "Hello agent"),
      command(2),
      message(3, "session.tool.failed", "s1"),
      message(4, "session.text.ended", "s2", "<img src=x onerror=alert(1)>"),
    ],
  };
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

test.each(["", "?session=s1&keep=yes"])("main page links to reasons and capabilities while preserving query parameters: %s", (search) => {
  window.history.replaceState(null, "", `/${search}`);
  render(<App />);
  const navigation = within(screen.getByRole("navigation", { name: "Page navigation" }));
  expect(navigation.getByRole("link", { name: "Reasons" }).getAttribute("href")).toBe(`/reason${search}`);
  expect(navigation.getByRole("link", { name: "Capabilities" }).getAttribute("href")).toBe(`/capabilities${search}`);
});

test("/reason shows the simple reason table, prompt toggles and file search, with session selection", async () => {
  window.history.replaceState(null, "", "/reason?session=s1&keep=yes");
  const user = userEvent.setup();
  state.events = ["s1", "s2"].map((sessionID, index) => ({
    ...message(index + 1, "session.tool.called", sessionID),
    activityUpdates: activityUpdates(index + 1, { id: "p1", sessionID, text: "Read files", files: [
      { path: `${sessionID}.ts`, action: "read" as const, outcome: "success" as const, callID: "c1" },
    ] }),
  }));
  render(<App />);
  const reasonMap = () => within(screen.getByRole("table", { name: "File access reasons" }));
  expect(reasonMap().getByRole("rowheader", { name: "s1.ts" })).toBeTruthy();
  expect(reasonMap().queryByText("s2.ts")).toBeNull();
  expect(screen.getByRole("searchbox", { name: "Find a file" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: /event stream/ })).toBeNull();
  expect(screen.queryByRole("slider")).toBeNull();
  expect(screen.queryByRole("complementary")).toBeNull();
  expect(screen.queryByText("Session overview")).toBeNull();
  expect(screen.queryByRole("table", { name: "Reason explanations" })).toBeNull();
  const promptToggle = within(screen.getByRole("group", { name: "Prompts" })).getByRole("button", { name: /Read files/ });
  await user.keyboard("{Shift>}");
  await user.click(promptToggle);
  await user.keyboard("{/Shift}");
  expect(reasonMap().queryByText("s1.ts")).toBeNull();
  await user.click(screen.getByRole("tab", { name: /Second session/ }));
  expect(window.location.pathname).toBe("/reason");
  expect(window.location.search).toBe("?session=s2&keep=yes");
  expect(reasonMap().getByRole("rowheader", { name: "s2.ts" })).toBeTruthy();
  expect(within(screen.getByRole("group", { name: "Prompts" })).getByRole("button").getAttribute("aria-pressed")).toBe("true");
  act(() => {
    window.history.replaceState(null, "", "/?session=s1");
    window.dispatchEvent(new PopStateEvent("popstate"));
  });
  expect(screen.getByRole("region", { name: "File activity heatmap" })).toBeTruthy();
  expect(screen.queryByRole("table", { name: "Reason explanations" })).toBeNull();
});

test("/capabilities shows only the capability table and keeps session selection and view links", async () => {
  window.history.replaceState(null, "", "/capabilities?session=s1&keep=yes");
  state.events = [command(1), command(2, "s2")];
  const user = userEvent.setup();
  render(<App />);
  const attempts = () => within(screen.getByRole("table", { name: "Attempted capabilities" }));
  expect(attempts().getAllByRole("row")).toHaveLength(2);
  expect(attempts().getByText("Run shell command")).toBeTruthy();
  expect(attempts().queryByText("Run the tests.")).toBeNull();
  expect(screen.queryByRole("button", { name: /event stream/ })).toBeNull();
  expect(screen.queryByRole("slider")).toBeNull();
  expect(screen.queryByRole("complementary")).toBeNull();
  expect(screen.getByRole("link", { name: "Reasons" }).getAttribute("href")).toBe("/reason?session=s1&keep=yes");
  expect(screen.getByRole("link", { name: "Activity map" }).getAttribute("href")).toBe("/?session=s1&keep=yes");
  await user.click(screen.getByRole("tab", { name: /Second session/ }));
  expect(window.location.pathname).toBe("/capabilities");
  expect(window.location.search).toBe("?session=s2&keep=yes");
  expect(attempts().getAllByRole("row")).toHaveLength(2);
  await user.click(screen.getByRole("tab", { name: /All sessions/ }));
  expect(attempts().getAllByRole("row")).toHaveLength(3);
  act(() => {
    window.history.replaceState(null, "", "/reason");
    window.dispatchEvent(new PopStateEvent("popstate"));
  });
  expect(screen.getByRole("table", { name: "File access reasons" })).toBeTruthy();
  expect(screen.queryByRole("table", { name: "Attempted capabilities" })).toBeNull();
});

test.each(["/reason", "/capabilities"])("%s supports exclusive clicks and independent Shift-click session toggles", async (path) => {
  window.history.replaceState(null, "", `${path}?keep=yes`);
  state.sessions.push({ sessionID: "s3", title: "Third session", eventCount: 1, lastEventTag: "session.tool.success", lastEventAt: 0, tags: [] });
  state.events = ["s1", "s2", "s3"].map((sessionID, index) => ({
    ...command(index + 1, sessionID),
    activityUpdates: activityUpdates(index + 1, { id: "p1", sessionID, text: `Prompt for ${sessionID}`, files: [
      { path: `${sessionID}.ts`, action: "read" as const, outcome: "success" as const, callID: `call-${index + 1}` },
    ] }),
  }));
  render(<App />);
  const first = screen.getByRole("tab", { name: "First session" });
  const second = screen.getByRole("tab", { name: "Second session" });
  const third = screen.getByRole("tab", { name: "Third session" });
  const choices = () => [first, second, third].map((tab) => tab.getAttribute("aria-selected"));
  const visiblePrompts = () => within(screen.getByRole("group", { name: "Prompts" })).getAllByRole("button").map((button) => button.textContent);
  const rows = () => within(screen.getByRole("table")).getAllByRole("row").slice(1);
  fireEvent.click(first, { shiftKey: true });
  expect(choices()).toEqual(["false", "true", "true"]);
  expect(visiblePrompts()).toEqual(["Prompt 01Prompt for s2", "Prompt 02Prompt for s3"]);
  expect(rows()).toHaveLength(2);
  fireEvent.click(first);
  expect(choices()).toEqual(["true", "false", "false"]);
  fireEvent.click(second, { shiftKey: true });
  expect(choices()).toEqual(["true", "true", "false"]);
  expect(visiblePrompts()).toEqual(["Prompt 01Prompt for s1", "Prompt 02Prompt for s2"]);
  expect(rows()).toHaveLength(2);
  expect(new URL(window.location.href).searchParams.getAll("session")).toEqual(["s1", "s2"]);
  expect(new URL(window.location.href).searchParams.get("keep")).toBe("yes");
  expect(screen.getByRole("link", { name: path === "/reason" ? "Capabilities" : "Reasons" }).getAttribute("href")).toContain("session=s1&session=s2");
  fireEvent.click(first);
  expect(choices()).toEqual(["true", "false", "false"]);
  fireEvent.click(first, { shiftKey: true });
  expect(choices()).toEqual(["false", "false", "false"]);
  expect(screen.getByRole("tab", { name: "All sessions" }).getAttribute("aria-selected")).toBe("false");
  expect(within(screen.getByRole("table")).getAllByRole("row")).toHaveLength(1);
  act(() => {
    window.history.replaceState(null, "", `${path}?keep=yes&session=s2&session=s3`);
    window.dispatchEvent(new PopStateEvent("popstate"));
  });
  expect(choices()).toEqual(["false", "true", "true"]);
  expect(visiblePrompts()).toEqual(["Prompt 01Prompt for s2", "Prompt 02Prompt for s3"]);
  fireEvent.click(screen.getByRole("tab", { name: "All sessions" }));
  expect(visiblePrompts()).toHaveLength(3);
  expect(window.location.search).toBe("?keep=yes");
});

test("prioritizes the heatmap and reveals newest-first events, command previews and safe raw details", async () => {
  const user = userEvent.setup();
  const { container } = render(<App />);
  expect(screen.getByRole("region", { name: "File activity heatmap" })).toBeTruthy();
  expect(screen.getByText("0 files × 0 prompts")).toBeTruthy();
  expect(screen.queryByRole("region", { name: "Session events" })).toBeNull();
  await openEvents(user);
  expect(cards()).toHaveLength(4);
  expect(cards()[0].textContent).toContain("<img src=x onerror=alert(1)>");
  expect(container.querySelector("img")).toBeNull();
  expect(container.querySelector('code[title="npm test"]')?.textContent).toBe("npm test");
  const details = cards()[0].querySelector("details")!;
  expect(details.open).toBe(false);
  await user.click(within(cards()[0]).getByText("Raw event"));
  expect(details.open).toBe(true);
  expect(details.querySelector("pre")?.textContent).toContain('"sessionID": "s2"');
});

test("searches raw events case-insensitively and combines event and session filters", async () => {
  const user = userEvent.setup();
  render(<App />);
  await openEvents(user);
  const search = screen.getByRole("searchbox", { name: "Search events" });
  await user.type(search, "HELLO");
  expect(cards()).toHaveLength(1);
  expect(cards()[0].textContent).toContain("Hello agent");
  await user.clear(search);
  expect(cards()).toHaveLength(4);
  await user.selectOptions(screen.getByRole("combobox", { name: "Filter event type" }), "tool");
  expect(cards()).toHaveLength(2);
  await user.selectOptions(screen.getByRole("combobox", { name: "Filter event type" }), "error");
  expect(cards()).toHaveLength(1);
  expect(cards()[0].getAttribute("data-kind")).toBe("error");
  await user.click(screen.getByRole("tab", { name: /Second session/ }));
  expect(cards()).toHaveLength(0);
  expect(screen.getByText("No matching events")).toBeTruthy();
});

test("session selection preserves other URL parameters and responds to browser navigation", async () => {
  window.history.replaceState(null, "", "/?keep=yes&session=s2");
  const user = userEvent.setup();
  render(<App />);
  await openEvents(user);
  expect(cards()).toHaveLength(1);
  await user.click(screen.getByRole("tab", { name: /First session/ }));
  expect(window.location.search).toContain("session=s1");
  expect(window.location.search).toContain("keep=yes");
  expect(cards()).toHaveLength(3);
  expect(screen.getByRole("heading", { name: "First session" })).toBeTruthy();
  act(() => {
    window.history.replaceState(null, "", "/?session=s2");
    window.dispatchEvent(new PopStateEvent("popstate"));
  });
  expect(cards()).toHaveLength(1);
  await user.click(screen.getByRole("tab", { name: /All sessions/ }));
  expect(window.location.search).toBe("");
  expect(cards()).toHaveLength(4);
});

test("session tabs support arrow keys, Home and End", async () => {
  const user = userEvent.setup();
  render(<App />);
  screen.getByRole("tab", { name: /All sessions/ }).focus();
  await user.keyboard("{ArrowRight}");
  expect(document.activeElement?.textContent).toContain("First session");
  expect(window.location.search).toBe("?session=s1");
  await user.keyboard("{End}");
  expect(document.activeElement?.textContent).toContain("Second session");
  await user.keyboard("{Home}");
  expect(document.activeElement?.textContent).toContain("All sessions");
});

test("event stream keeps its controls at the top when opening and following live events", async () => {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    return new DOMRect(0, this.id.startsWith("event-") ? 400 : 20, 400, 100);
  });
  const user = userEvent.setup();
  const { container, rerender } = render(<App />);
  const scroller = container.querySelector<HTMLElement>(".activity-trace-scroll")!;
  expect(scroller.scrollTop).toBe(0);
  await user.click(screen.getByRole("button", { name: "Expand event stream" }));
  expect(scroller.scrollTop).toBe(0);
  expect(screen.getByRole("searchbox", { name: "Search events" })).toBeTruthy();
  expect(screen.getByRole("combobox", { name: "Filter event type" })).toBeTruthy();
  scroller.scrollTop = 200;
  state = { ...state, events: [...state.events, message(5, "session.text.ended", "s1", "Newest")] };
  rerender(<App />);
  expect(scroller.scrollTop).toBe(0);
  expect(cards()[0].id).toBe("event-5");
});

test("event stream resets to its controls when reopened after scrolling", async () => {
  const user = userEvent.setup();
  const { container } = render(<App />);
  await user.click(screen.getByRole("button", { name: "Expand event stream" }));
  const scroller = container.querySelector<HTMLElement>(".activity-trace-scroll")!;
  scroller.scrollTop = 240;
  await user.click(screen.getByRole("button", { name: "Collapse event stream" }));
  await user.click(screen.getByRole("button", { name: "Expand event stream" }));
  expect(scroller.scrollTop).toBe(0);
});

test("event stream still centers an explicitly selected timeline event", () => {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    return new DOMRect(0, this.id.startsWith("event-") ? 400 : 20, 400, this.classList.contains("activity-trace-scroll") ? 400 : 100);
  });
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { callback(0); return 1; });
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  const { container } = render(<App />);
  fireEvent.click(screen.getByRole("button", { name: /^Jump to command 1:/ }));
  expect(screen.getByRole("button", { name: "Collapse event stream" })).toBeTruthy();
  expect(cards()[0].id).toBe("event-2");
  expect(container.querySelector<HTMLElement>(".activity-trace-scroll")!.scrollTop).toBe(230);
});

test("collapse all changes only visible content-bearing events and leaves raw details available", async () => {
  const user = userEvent.setup();
  render(<App />);
  await openEvents(user);
  await user.click(screen.getByRole("button", { name: "Expand all" }));
  await user.click(screen.getByRole("tab", { name: /First session/ }));
  await user.click(screen.getByRole("button", { name: "Collapse all" }));
  expect(screen.getAllByRole("button", { name: "Expand event" })).toHaveLength(2);
  const firstDetails = cards()[1].querySelector("details")!;
  await user.click(within(cards()[1]).getByText("Raw event"));
  expect(firstDetails.open).toBe(true);
  await user.click(screen.getByRole("tab", { name: /All sessions/ }));
  expect(screen.getAllByRole("button", { name: "Collapse event" })).toHaveLength(1);
  await user.click(screen.getByRole("button", { name: "Collapse event" }));
  expect(screen.getByRole("button", { name: "Expand all" })).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "Expand all" }));
  expect(screen.getAllByRole("button", { name: "Collapse event" })).toHaveLength(3);
});

test("keeps search and selected session when WebSocket state is replaced", async () => {
  const user = userEvent.setup();
  const { rerender } = render(<App />);
  await openEvents(user);
  await user.click(screen.getByRole("tab", { name: /First session/ }));
  await user.type(screen.getByRole("searchbox", { name: "Search events" }), "hello");
  state = { ...state, events: [state.events[0]], status: "reconnecting" };
  rerender(<App />);
  expect((screen.getByRole("searchbox", { name: "Search events" }) as HTMLInputElement).value).toBe("hello");
  expect(window.location.search).toBe("?session=s1");
  expect(cards()).toHaveLength(1);
  expect(screen.getByText("Reconnecting")).toBeTruthy();
});

test("keeps raw details open across filtering and lets new events inherit the collapse state", async () => {
  const user = userEvent.setup();
  const { rerender } = render(<App />);
  await openEvents(user);
  await user.click(screen.getByRole("button", { name: "Expand all" }));
  const details = cards()[0].querySelector("details")!;
  await user.click(within(cards()[0]).getByText("Raw event"));
  await user.selectOptions(screen.getByRole("combobox", { name: "Filter event type" }), "tool");
  await user.selectOptions(screen.getByRole("combobox", { name: "Filter event type" }), "all");
  expect(cards()[0].querySelector("details")).toBe(details);
  expect(details.open).toBe(true);
  for (const button of screen.getAllByRole("button", { name: "Collapse event" })) await user.click(button);
  state = { ...state, events: [...state.events, message(5, "session.text.ended", "s1", "Newest")] };
  rerender(<App />);
  expect(within(cards()[0]).getByRole("button", { name: "Expand event" })).toBeTruthy();
});

test("shows initial empty state and disables collapse when no event has content", async () => {
  const user = userEvent.setup();
  state = { events: [], sessions: [], heatmaps: [], status: "connecting", permissions: [], replyPermission: vi.fn() };
  render(<App />);
  expect(screen.getByRole("heading", { name: "Ready when you are" })).toBeTruthy();
  await openEvents(user);
  expect((screen.getByRole("button", { name: "Expand all" }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.change(screen.getByRole("searchbox", { name: "Search events" }), { target: { value: "missing" } });
  expect(screen.getByText("No matching events")).toBeTruthy();
});

test("keeps session tabs in the header and scopes the heatmap and related event drawer", async () => {
  const user = userEvent.setup();
  state.events = state.events.map((event) => event.id === 1 || event.id === 4 ? {
    ...event,
    activityUpdates: activityUpdates(event.id, {
      id: String(event.id), sessionID: event.event.sessionID!, text: `Prompt ${event.id}`,
      files: [{ path: `src/file${event.id}.ts`, action: "read", outcome: "success", callID: String(event.id) }],
    }),
  } : event);
  render(<App />);
  const heatmap = () => within(screen.getByRole("table", { name: "File operations by prompt" }));
  expect(screen.getByRole("tablist").closest("header")).toBeTruthy();
  expect(heatmap().getByText("file4.ts")).toBeTruthy();
  await user.click(screen.getByRole("tab", { name: /First session/ }));
  expect(heatmap().getByText("file1.ts")).toBeTruthy();
  expect(heatmap().queryByText("file4.ts")).toBeNull();
  await user.click(heatmap().getByRole("button", { name: /^src\/file1.ts, prompt 01:/ }));
  await user.click(screen.getByRole("button", { name: "Inspect 1 related events" }));
  expect(cards()).toHaveLength(1);
  expect(cards()[0].textContent).toContain("Hello agent");
  expect(screen.queryByRole("button", { name: "Compact" })).toBeNull();
});

test("read approvals remain visible when a different session and event filters are selected", async () => {
  const user = userEvent.setup();
  state.permissions = [{ pluginID: "p1", sessionID: "s1", requestID: "r1", resources: ["/project/appsettings.json"], status: "pending" }];
  render(<App />);
  await user.click(screen.getByRole("tab", { name: /Second session/ }));
  expect(screen.getByRole("region", { name: "Read approvals" })).toBeTruthy();
  await openEvents(user);
  await user.type(screen.getByRole("searchbox", { name: "Search events" }), "not found");
  expect(screen.getByRole("region", { name: "Read approvals" })).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "Accept once" }));
  expect(state.replyPermission).toHaveBeenCalledWith(state.permissions[0], "once");
});

test("timeline scrubbing leaves the event drawer closed and Go live restores incoming events", async () => {
  const user = userEvent.setup();
  const { rerender } = render(<App />);
  const slider = screen.getByRole("slider", { name: "Scrub to event" });
  expect(slider.getAttribute("aria-valuenow")).toBe("1");
  fireEvent.keyDown(slider, { key: "Home" });
  expect(screen.queryByRole("region", { name: "Session events" })).toBeNull();
  expect(screen.getByRole("button", { name: "Expand event stream" })).toBeTruthy();
  await openEvents(user);
  expect(cards()).toHaveLength(2);
  expect(cards()[0].id).toBe("event-2");
  expect(screen.getByText("Playback paused. New events are still being recorded.")).toBeTruthy();
  state = { ...state, events: [...state.events, message(5, "session.text.ended", "s1", "Newest")] };
  rerender(<App />);
  expect(cards()).toHaveLength(2);
  await user.click(screen.getByRole("button", { name: "Resume live playback" }));
  expect(cards()).toHaveLength(5);
  expect(slider.getAttribute("aria-valuenow")).toBe("1");
  expect(screen.getByText("Events appear automatically. No refresh needed.")).toBeTruthy();
});

test("the event drawer stays closed during paused playback until an event is activated", async () => {
  const user = userEvent.setup();
  state.events.push(command(5));
  render(<App />);
  fireEvent.click(screen.getByRole("button", { name: /^Jump to command 1:/ }));
  expect(cards()).toHaveLength(2);
  await openEvents(user);
  expect(screen.queryByRole("region", { name: "Session events" })).toBeNull();
  fireEvent.keyDown(screen.getByRole("slider", { name: "Scrub to event" }), { key: "End" });
  expect(screen.queryByRole("region", { name: "Session events" })).toBeNull();
  fireEvent.keyDown(screen.getByRole("slider", { name: "Scrub to event" }), { key: "Enter" });
  expect(cards()).toHaveLength(5);
});

test("pausing live playback does not open the event stream", async () => {
  const user = userEvent.setup();
  render(<App />);
  await user.click(screen.getByRole("button", { name: "Pause live playback" }));
  expect(screen.getByRole("button", { name: "Resume live playback" })).toBeTruthy();
  expect(screen.queryByRole("region", { name: "Session events" })).toBeNull();
});

test("scrubbing reconstructs historical heatmap snapshots and Go live restores later activity", async () => {
  const user = userEvent.setup();
  const pending: PromptActivity = { id: "1", sessionID: "s1", text: "Update files", files: [
    { path: "src/app.ts", action: "modified", outcome: "pending", callID: "edit" },
    { path: "src/failed.ts", action: "deleted", outcome: "pending", callID: "delete" },
  ] };
  const completed: PromptActivity = { ...pending, files: pending.files.map((file) => ({
    ...file, outcome: file.callID === "edit" ? "success" : "failed",
  })) };
  const reverted: PromptActivity = { ...completed, files: completed.files.map((file) => ({
    ...file, reverted: file.callID === "edit",
  })) };
  state.events = [
    { ...message(1, "session.inbox.delivered", "s1"), activityUpdates: activityUpdates(1, pending) },
    { ...command(2), activityUpdates: activityUpdates(2, completed) },
    { ...command(3), activityUpdates: activityUpdates(3, reverted) },
  ];
  const { rerender } = render(<App />);
  const heatmap = () => within(screen.getByRole("table", { name: "File operations by prompt" }));
  const cell = (file: string) => heatmap().getByRole("button", { name: new RegExp(`^src/${file}\\.ts, prompt 01:`) });
  await user.click(screen.getByRole("button", { name: "Changes" }));
  expect(cell("app").getAttribute("data-reverted")).toBe("true");
  const slider = screen.getByRole("slider", { name: "Scrub to event" });
  fireEvent.keyDown(slider, { key: "Home" });
  expect(slider.getAttribute("aria-valuemax")).toBe("3");
  expect(cell("app").getAttribute("data-pending")).toBe("true");
  expect(cell("app").hasAttribute("data-reverted")).toBe(false);
  expect(cell("failed").hasAttribute("data-failed")).toBe(false);
  await user.click(heatmap().getByRole("button", { name: /^Prompt 01:/ }));
  expect(cell("app").getAttribute("data-pending")).toBe("true");
  expect(screen.getByRole("button", { name: "Resume live playback" })).toBeTruthy();
  fireEvent.keyDown(slider, { key: "ArrowRight" });
  expect(cell("app").getAttribute("data-heat")).toBe("1");
  expect(cell("app").hasAttribute("data-pending")).toBe(false);
  expect(cell("app").hasAttribute("data-reverted")).toBe(false);
  expect(cell("failed").getAttribute("data-failed")).toBe("true");
  fireEvent.keyDown(slider, { key: "ArrowRight" });
  expect(cell("app").getAttribute("data-heat")).toBe("0");
  expect(cell("app").getAttribute("data-reverted")).toBe("true");
  fireEvent.keyDown(slider, { key: "ArrowLeft" });
  state = { ...state, events: [...state.events, {
    ...message(4, "session.inbox.delivered", "s1"),
    activityUpdates: activityUpdates(4, { id: "2", sessionID: "s1", text: "Later prompt", files: [
      { path: "src/later.ts", action: "created", outcome: "success", callID: "create" },
    ] }),
  }] };
  rerender(<App />);
  expect(cell("app").getAttribute("data-heat")).toBe("1");
  expect(heatmap().queryByText("later.ts")).toBeNull();
  expect(heatmap().queryByRole("button", { name: /^Prompt 02:/ })).toBeNull();
  expect(screen.queryByRole("region", { name: "Session events" })).toBeNull();
  await user.click(screen.getByRole("button", { name: "All prompts" }));
  expect(cell("app").getAttribute("data-heat")).toBe("1");
  expect(heatmap().queryByText("later.ts")).toBeNull();
  await user.click(screen.getByRole("button", { name: "Resume live playback" }));
  expect(cell("app").getAttribute("data-reverted")).toBe("true");
  expect(heatmap().getByText("later.ts")).toBeTruthy();
  expect(heatmap().getByRole("button", { name: /^Prompt 02:/ })).toBeTruthy();
  expect(screen.queryByRole("region", { name: "Session events" })).toBeNull();
});

test("timeline follows the session without inheriting related-event filters or hiding read approvals", async () => {
  const user = userEvent.setup();
  state.permissions = [{ pluginID: "p1", sessionID: "s1", requestID: "r1", resources: ["/project/appsettings.json"], status: "pending" }];
  state.events[0] = {
    ...command(1),
    activityUpdates: activityUpdates(1, {
      id: "1", sessionID: "s1", text: "Read a file",
      files: [{ path: "src/file.ts", action: "read", outcome: "success", callID: "1" }],
    }),
  };
  render(<App />);
  await user.click(screen.getByRole("tab", { name: /First session/ }));
  expect(screen.getByRole("slider", { name: "Scrub to event" }).getAttribute("aria-valuemax")).toBe("2");
  await user.click(screen.getByRole("button", { name: "Inspect 1 related events" }));
  expect(cards()).toHaveLength(1);
  expect(screen.getByRole("slider", { name: "Scrub to event" }).getAttribute("aria-valuemax")).toBe("2");
  fireEvent.keyDown(screen.getByRole("slider", { name: "Scrub to event" }), { key: "Home" });
  await user.click(screen.getByRole("tab", { name: /Second session/ }));
  expect(cards()).toHaveLength(1);
  expect(cards()[0].id).toBe("event-4");
  expect(screen.getByRole("button", { name: "Pause live playback" })).toBeTruthy();
  expect(screen.getByRole("region", { name: "Read approvals" })).toBeTruthy();
});

test("timeline remains stable when a related file has no events in the next prompt", async () => {
  const user = userEvent.setup();
  let commits = 0;
  state.events = ["first", "second"].map((name, index) => ({
    ...message(index + 1, "session.text.ended", "s1", name),
    activityUpdates: activityUpdates(index + 1, {
      id: String(index + 1), sessionID: "s1", text: name,
      files: [{ path: `src/${name}.ts`, action: "read" as const, outcome: "success" as const, callID: String(index + 1) }],
    }),
  }));
  render(<Profiler id="timeline-integration" onRender={() => {
    if (++commits > 40) throw new Error("Timeline update loop");
  }}><App /></Profiler>);
  await user.click(screen.getByRole("button", { name: /^src\/first.ts, prompt 01:/ }));
  await user.click(screen.getByRole("button", { name: "Inspect 1 related events" }));
  expect(cards()).toHaveLength(1);
  await user.click(within(screen.getByRole("complementary", { name: "Selected prompt and file" })).getByRole("button", { name: "Next prompt" }));
  expect(cards()).toHaveLength(0);
  expect(screen.getByRole("slider", { name: "Scrub to event" }).getAttribute("aria-valuemax")).toBe("2");
  expect(screen.getByText("No recorded activity for this file in this prompt.")).toBeTruthy();
  expect(commits).toBeLessThan(40);
});

test("heatmap prompt navigation centers the timeline while preserving live playback", async () => {
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(400);
  const user = userEvent.setup();
  const first = { id: "1", sessionID: "s1", text: "First prompt", files: [] };
  const second = { id: "2", sessionID: "s1", text: "Second prompt", files: [] };
  state.events = [
    { ...message(1, "session.inbox.delivered", "s1"), activityUpdates: activityUpdates(1, first) },
    { ...message(2, "session.tool.success", "s1"), activityUpdates: activityUpdates(2, first) },
    { ...message(3, "session.inbox.delivered", "s1"), activityUpdates: activityUpdates(3, second) },
    { ...message(4, "session.tool.success", "s1"), activityUpdates: activityUpdates(4, second) },
  ];
  render(<App />);
  const slider = screen.getByRole("slider", { name: "Scrub to event" });
  await openEvents(user);
  expect(cards()).toHaveLength(4);
  const heatmap = within(screen.getByRole("table", { name: "File operations by prompt" }));
  await user.click(heatmap.getByRole("button", { name: /^Prompt 02:/ }));
  expect(cards()).toHaveLength(2);
  expect(slider.getAttribute("aria-valuenow")).toBe("2");
  expect(Number.parseFloat(slider.style.left) - slider.parentElement!.parentElement!.scrollLeft).toBe(200);
  const inspector = within(screen.getByRole("complementary", { name: "Selected prompt and file" }));
  await user.click(inspector.getByRole("button", { name: "Previous prompt" }));
  expect(inspector.getByRole("heading", { name: "First prompt" })).toBeTruthy();
  expect(slider.getAttribute("aria-valuenow")).toBe("1");
  expect(Number.parseFloat(slider.style.left) - slider.parentElement!.parentElement!.scrollLeft).toBe(200);
  await user.click(screen.getByRole("button", { name: "All prompts" }));
  expect(cards()).toHaveLength(4);
  expect(slider.getAttribute("aria-valuenow")).toBe("2");
  expect(screen.getByRole("button", { name: "Pause live playback" })).toBeTruthy();
});
