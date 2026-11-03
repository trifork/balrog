import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Profiler } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { LogEvent } from "../../server/log-receiver";
import { App } from "./App";
import type { ReceivedEvent, ViewerState } from "./useViewer";

let state: ViewerState;
vi.mock("./useViewer", () => ({ useViewer: () => state }));

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
const openEvents = async (user: ReturnType<typeof userEvent.setup>) => user.click(screen.getByText("Event stream", { selector: "summary span" }));

beforeEach(() => {
  window.history.replaceState(null, "", "/");
  vi.stubGlobal("matchMedia", vi.fn(() => ({
    matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn(),
  })));
  state = {
    permissions: [],
    replyPermission: vi.fn(),
    status: "live",
    sessions: [
      { sessionID: "s1", title: "First session", eventCount: 3, lastEventTag: "session.tool.failed", lastEventAt: 2, tags: [] },
      { sessionID: "s2", title: "Second session", eventCount: 1, lastEventTag: "session.text.ended", lastEventAt: 1, tags: [] },
    ],
    events: [
      message(1, "session.text.ended", "s1", "Hello agent"),
      { ...message(2, "session.tool.called", "s1", "npm test"), command: "npm test" },
      message(3, "session.tool.failed", "s1"),
      message(4, "session.text.ended", "s2", "<img src=x onerror=alert(1)>"),
    ],
  };
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

test("prioritizes the heatmap and reveals newest-first events, command previews and safe raw details", async () => {
  const user = userEvent.setup();
  const { container } = render(<App />);
  expect(screen.getByRole("heading", { name: "File heatmap" })).toBeTruthy();
  expect(container.querySelector("#total-files")?.textContent).toBe("0");
  expect(container.querySelector("#total-prompts")?.textContent).toBe("0");
  expect(container.querySelector("#total-operations")?.textContent).toBe("0");
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
  await user.keyboard("{Escape}");
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
  state = { events: [], sessions: [], status: "connecting", permissions: [], replyPermission: vi.fn() };
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
    fileActivity: {
      id: String(event.id), sessionID: event.event.sessionID!, text: `Prompt ${event.id}`,
      files: [{ path: `src/file${event.id}.ts`, action: "read", outcome: "success", callID: String(event.id) }],
    },
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

test("timeline scrubbing reveals the event drawer and Go live restores incoming events", async () => {
  const user = userEvent.setup();
  const { rerender } = render(<App />);
  expect(screen.getByRole("heading", { name: "File heatmap" })).toBeTruthy();
  const slider = screen.getByRole("slider", { name: "Scrub to event" });
  expect(slider.getAttribute("aria-valuenow")).toBe("4");
  fireEvent.keyDown(slider, { key: "Home" });
  expect(cards()).toHaveLength(1);
  expect(cards()[0].id).toBe("event-1");
  expect(screen.getByText("Playback paused. New events are still being recorded.")).toBeTruthy();
  state = { ...state, events: [...state.events, message(5, "session.text.ended", "s1", "Newest")] };
  rerender(<App />);
  expect(cards()).toHaveLength(1);
  await user.click(screen.getByRole("button", { name: "Resume live playback" }));
  expect(cards()).toHaveLength(5);
  expect(slider.getAttribute("aria-valuenow")).toBe("5");
  expect(screen.getByText("Events appear automatically. No refresh needed.")).toBeTruthy();
});

test("the event drawer can close during paused playback and reopen on another timeline selection", async () => {
  const user = userEvent.setup();
  render(<App />);
  fireEvent.keyDown(screen.getByRole("slider", { name: "Scrub to event" }), { key: "Home" });
  expect(cards()).toHaveLength(1);
  await openEvents(user);
  expect(screen.queryByRole("region", { name: "Session events" })).toBeNull();
  fireEvent.keyDown(screen.getByRole("slider", { name: "Scrub to event" }), { key: "End" });
  expect(cards()).toHaveLength(4);
});

test("timeline follows session and related-event filters without hiding read approvals", async () => {
  const user = userEvent.setup();
  state.permissions = [{ pluginID: "p1", sessionID: "s1", requestID: "r1", resources: ["/project/appsettings.json"], status: "pending" }];
  state.events[0] = {
    ...state.events[0],
    fileActivity: {
      id: "1", sessionID: "s1", text: "Read a file",
      files: [{ path: "src/file.ts", action: "read", outcome: "success", callID: "1" }],
    },
  };
  render(<App />);
  await user.click(screen.getByRole("tab", { name: /First session/ }));
  expect(screen.getByRole("slider", { name: "Scrub to event" }).getAttribute("aria-valuemax")).toBe("3");
  await user.click(screen.getByRole("button", { name: "Inspect 1 related events" }));
  expect(cards()).toHaveLength(1);
  expect(screen.getByRole("slider", { name: "Scrub to event" }).getAttribute("aria-valuemax")).toBe("1");
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
    fileActivity: {
      id: String(index + 1), sessionID: "s1", text: name,
      files: [{ path: `src/${name}.ts`, action: "read" as const, outcome: "success" as const, callID: String(index + 1) }],
    },
  }));
  render(<Profiler id="timeline-integration" onRender={() => {
    if (++commits > 40) throw new Error("Timeline update loop");
  }}><App /></Profiler>);
  await user.click(screen.getByRole("button", { name: /^src\/first.ts, prompt 01:/ }));
  await user.click(screen.getByRole("button", { name: "Inspect 1 related events" }));
  expect(cards()).toHaveLength(1);
  await user.click(within(screen.getByRole("complementary", { name: "Selected prompt and file" })).getByRole("button", { name: "Next prompt" }));
  expect(cards()).toHaveLength(0);
  expect(screen.queryByRole("slider", { name: "Scrub to event" })).toBeNull();
  expect(screen.getByText("No recorded activity for this file in this prompt.")).toBeTruthy();
  expect(commits).toBeLessThan(40);
});

test("heatmap prompt navigation centers the timeline without retaining an older playback cutoff", async () => {
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(400);
  const user = userEvent.setup();
  const first = { id: "1", sessionID: "s1", text: "First prompt", files: [] };
  const second = { id: "2", sessionID: "s1", text: "Second prompt", files: [] };
  state.events = [
    { ...message(1, "session.inbox.delivered", "s1"), fileActivity: first },
    { ...message(2, "session.tool.success", "s1"), fileActivity: first },
    { ...message(3, "session.inbox.delivered", "s1"), fileActivity: second },
    { ...message(4, "session.tool.success", "s1"), fileActivity: second },
  ];
  render(<App />);
  const slider = screen.getByRole("slider", { name: "Scrub to event" });
  fireEvent.keyDown(slider, { key: "Home" });
  expect(cards()).toHaveLength(1);
  const heatmap = within(screen.getByRole("table", { name: "File operations by prompt" }));
  await user.click(heatmap.getByRole("button", { name: /^Prompt 02:/ }));
  expect(cards()).toHaveLength(2);
  expect(slider.getAttribute("aria-valuenow")).toBe("1");
  expect(Number.parseFloat(slider.style.left) - slider.parentElement!.parentElement!.scrollLeft).toBe(200);
  const inspector = within(screen.getByRole("complementary", { name: "Selected prompt and file" }));
  await user.click(inspector.getByRole("button", { name: "Previous prompt" }));
  expect(inspector.getByRole("heading", { name: "First prompt" })).toBeTruthy();
  expect(slider.getAttribute("aria-valuenow")).toBe("1");
  expect(Number.parseFloat(slider.style.left) - slider.parentElement!.parentElement!.scrollLeft).toBe(200);
  await user.click(screen.getByRole("button", { name: "All prompts" }));
  expect(cards()).toHaveLength(4);
  expect(slider.getAttribute("aria-valuenow")).toBe("4");
});
