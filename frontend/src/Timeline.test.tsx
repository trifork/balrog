import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { createActivityUpdates } from "../../tests/activity-fixtures";
import type { PromptActivity } from "../../server/file-activity";
import type { ToolExecution } from "../../server/analyzer";
import type { LogEvent } from "../../server/log-receiver";
import { collectActivity } from "./file-activity-model";
import { Timeline } from "./Timeline";
import { timelineLayout } from "./timelineLayout";
import { commandTimeline, timelineMarkers } from "./timelineMarkers";
import type { ReceivedEvent } from "./useViewer";

afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });
let activityUpdates: ReturnType<typeof createActivityUpdates>;
beforeEach(() => { activityUpdates = createActivityUpdates(); });

const message = (id: number, tag: string, activity?: PromptActivity, ...updates: PromptActivity[]): ReceivedEvent => ({
  id, receivedAt: 1_700_000_000_000 + id,
  event: { tag, sessionID: "s1", pluginID: "test", [tag]: { data: { sessionID: "s1" } } } as unknown as LogEvent,
  activityUpdates: activity ? activityUpdates(id, activity, ...updates) : undefined,
});

const first: PromptActivity = { id: "1", sessionID: "s1", text: "First user prompt", files: [] };
const second: PromptActivity = { ...first, id: "2", text: "Second user prompt" };

test("timeline boundaries and numbers match heatmap activity rather than queued or assistant event tags", () => {
  const events = [
    message(1, "session.inbox.enqueued"), message(2, "session.execution.started", first),
    message(3, "session.inbox.delivered", first), message(4, "session.text.ended"),
    message(5, "session.inbox.delivered", second), message(6, "session.tool.success", first),
    message(7, "session.revert.staged", second, first),
  ];
  const prompts = collectActivity(events, "");
  const markers = timelineMarkers(events, prompts);
  expect(markers.map((marker, index) => marker.isPrompt ? index : -1).filter((index) => index >= 0)).toEqual([1, 4]);
  expect(markers[1]).toMatchObject({ label: "Prompt 01", summary: "First user prompt", icon: "prompt" });
  expect(markers[4]).toMatchObject({ label: "Prompt 02", summary: "Second user prompt", icon: "prompt" });
  expect(timelineMarkers([events[5]], prompts)[0].isPrompt).toBe(false);
});

test("timeline layout provides enough edge space to center the first and last events", () => {
  for (const count of [1, 2, 20]) {
    const layout = timelineLayout(count, 0, 400);
    expect(layout.positions[0]).toBeCloseTo(200);
    expect(layout.width - layout.positions.at(-1)!).toBeCloseTo(200);
  }
});

test("previous and next prompt navigation centers the handle at both ends", async () => {
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(400);
  const user = userEvent.setup();
  const events = [message(1, "session.inbox.delivered", first), event(2, "session.tool.called", read), message(3, "session.inbox.delivered", second)];
  const prompts = collectActivity(events, "");
  function Harness() {
    const [active, setActive] = useState(3);
    return <Timeline events={events} prompts={prompts} activeEventID={active} followingLive={false} onSelect={setActive} onActivate={onActivate} />;
  }
  const onActivate = vi.fn();
  render(<Harness />);
  const controls = within(screen.getByRole("group", { name: "Timeline playback" }));
  const handle = screen.getByRole("slider", { name: "Scrub to event" });
  const viewport = handle.parentElement!.parentElement!;
  await user.click(controls.getByRole("button", { name: "Previous prompt" }));
  expect(handle.getAttribute("aria-valuenow")).toBe("1");
  expect(Number.parseFloat(handle.style.left) - viewport.scrollLeft).toBe(200);
  await user.click(controls.getByRole("button", { name: "Next prompt" }));
  expect(handle.getAttribute("aria-valuenow")).toBe("3");
  expect(Number.parseFloat(handle.style.left) - viewport.scrollLeft).toBe(200);
  expect(onActivate).not.toHaveBeenCalled();
});

function event(id: number, tag: string, execution?: ToolExecution, sessionID = "s1"): ReceivedEvent {
  return {
    id, receivedAt: 1_700_000_000_000 + id, execution,
    event: { tag, sessionID, pluginID: "test", [tag]: { data: { sessionID } } } as unknown as LogEvent,
  };
}

const read: ToolExecution = {
  callID: "call-1", command: { name: "read", args: { path: "README.md" } },
  startedAt: 100, completedAt: null, reason: "Read the overview.\nVerify setup details.", outcome: null, result: null,
};

const scrubEvents = () => [
  event(1, "session.tool.called", read),
  event(2, "session.tool.called", { ...read, callID: "call-2", startedAt: 200 }),
];

const manyEvents = (count: number) => Array.from({ length: count }, (_, index) => event(index + 1, "session.tool.called", {
  ...read, callID: `call-${index + 1}`, startedAt: index + 1,
}));

test.each([100, 1_000])("large timelines keep mounted markers bounded with %i commands", (count) => {
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(400);
  render(<Timeline events={manyEvents(count)} onSelect={vi.fn()} />);
  expect(screen.getAllByRole("button", { name: /^Jump to command/ }).length).toBeLessThan(60);
  expect(screen.getByRole("slider").getAttribute("aria-valuemax")).toBe(String(count));
  expect(screen.getByRole("button", { name: new RegExp(`^Jump to command ${count}:`) }).getAttribute("aria-current")).toBe("true");
});

test("virtual markers follow scrolling and resize without changing playback", () => {
  const width = vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(400);
  const events = manyEvents(1_000);
  const onSelect = vi.fn();
  render(<Timeline events={events} activeEventID={1} followingLive={false} onSelect={onSelect} />);
  const slider = screen.getByRole("slider");
  const viewport = slider.parentElement!.parentElement!;
  viewport.scrollLeft = timelineLayout(events.length, 0, 400, events.map(() => 14)).positions[500] - 200;
  fireEvent.scroll(viewport);
  expect(screen.getByRole("button", { name: /^Jump to command 501:/ })).toBeTruthy();
  expect(screen.queryByRole("button", { name: /^Jump to command 1000:/ })).toBeNull();
  expect(screen.getByRole("button", { name: /^Jump to command 1:/ }).getAttribute("aria-current")).toBe("true");
  expect(slider.getAttribute("aria-valuenow")).toBe("1");
  width.mockReturnValue(800);
  fireEvent(window, new Event("resize"));
  expect(screen.getByRole("button", { name: /^Jump to command 1:/ })).toBeTruthy();
  expect(onSelect).not.toHaveBeenCalled();
});

test("keyboard Home and End reach virtualized commands and preserve activation and focus", () => {
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(400);
  const events = manyEvents(1_000);
  const onActivate = vi.fn();
  function Harness() {
    const [active, setActive] = useState(1_000);
    return <Timeline events={events} activeEventID={active} followingLive={false} onSelect={setActive} onActivate={onActivate} />;
  }
  render(<Harness />);
  const slider = screen.getByRole("slider");
  fireEvent.keyDown(slider, { key: "Home" });
  expect(slider.getAttribute("aria-valuenow")).toBe("1");
  expect(screen.getByRole("button", { name: /^Jump to command 1:/ })).toBeTruthy();
  expect(document.activeElement).toBe(slider);
  fireEvent.keyDown(slider, { key: "End" });
  expect(slider.getAttribute("aria-valuenow")).toBe("1000");
  fireEvent.keyDown(slider, { key: "Enter" });
  expect(onActivate).toHaveBeenCalledExactlyOnceWith(1_000);
  expect(screen.getAllByRole("button", { name: /^Jump to command/ }).length).toBeLessThan(60);
});

test("hovered and focused markers stay mounted until their interactions finish", () => {
  vi.useFakeTimers();
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(400);
  render(<Timeline events={manyEvents(1_000)} activeEventID={1} onSelect={vi.fn()} />);
  const hovered = screen.getByRole("button", { name: /^Jump to command 5:/ });
  const focused = screen.getByRole("button", { name: /^Jump to command 6:/ });
  act(() => focused.focus());
  fireEvent.pointerEnter(hovered, { pointerType: "mouse" });
  const viewport = screen.getByRole("slider").parentElement!.parentElement!;
  viewport.scrollLeft = 5_000;
  fireEvent.scroll(viewport);
  expect(hovered.isConnected).toBe(true);
  expect(focused.isConnected).toBe(true);
  expect(document.activeElement).toBe(focused);
  expect(screen.getByRole("tooltip")).toBeTruthy();
  fireEvent.pointerLeave(hovered, { pointerType: "mouse" });
  fireEvent.pointerEnter(screen.getByRole("tooltip"), { pointerType: "mouse" });
  act(() => vi.advanceTimersByTime(200));
  expect(hovered.isConnected).toBe(true);
  fireEvent.pointerLeave(screen.getByRole("tooltip"), { pointerType: "mouse" });
  act(() => vi.advanceTimersByTime(200));
  act(() => focused.blur());
  expect(hovered.isConnected).toBe(false);
  expect(focused.isConnected).toBe(false);
});

test("related indicators reveal virtualized commands without selecting or activating them", () => {
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(400);
  const onSelect = vi.fn();
  const onActivate = vi.fn();
  render(<Timeline events={manyEvents(1_000)} activeEventID={500} highlightedEventIDs={new Set([10, 500, 950])} onSelect={onSelect} onActivate={onActivate} />);
  expect(screen.queryByRole("button", { name: /^Jump to command 10:/ })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Show 1 related command earlier in the timeline" }));
  expect(screen.getByRole("button", { name: /^Jump to command 10:/ }).getAttribute("data-file-related")).toBe("true");
  expect(screen.getByRole("button", { name: "Show 2 related commands later in the timeline" })).toBeTruthy();
  expect(screen.getByRole("slider").getAttribute("aria-valuenow")).toBe("500");
  expect(onSelect).not.toHaveBeenCalled();
  expect(onActivate).not.toHaveBeenCalled();
});

test("virtualization follows new live commands but keeps paused playback at its selected event", () => {
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(400);
  const events = manyEvents(1_001);
  const onSelect = vi.fn();
  const { rerender } = render(<Timeline events={events.slice(0, 1_000)} onSelect={onSelect} />);
  rerender(<Timeline events={events} onSelect={onSelect} />);
  expect(screen.getByRole("slider").getAttribute("aria-valuenow")).toBe("1001");
  expect(screen.getByRole("button", { name: /^Jump to command 1001:/ })).toBeTruthy();
  rerender(<Timeline events={events.slice(0, 1_000)} activeEventID={1} followingLive={false} onSelect={onSelect} />);
  rerender(<Timeline events={events} activeEventID={1} followingLive={false} onSelect={onSelect} />);
  expect(screen.getByRole("slider").getAttribute("aria-valuenow")).toBe("1");
  expect(screen.queryByRole("button", { name: /^Jump to command 1001:/ })).toBeNull();
  expect(onSelect).not.toHaveBeenCalled();
});

function pointerViewport() {
  const viewport = screen.getByRole("slider").parentElement!.parentElement!;
  viewport.setPointerCapture = vi.fn();
  viewport.hasPointerCapture = vi.fn(() => false);
  viewport.releasePointerCapture = vi.fn();
  return viewport;
}

test("clicking an event selects and activates it once", async () => {
  const user = userEvent.setup();
  const onSelect = vi.fn();
  const onActivate = vi.fn();
  render(<Timeline events={scrubEvents()} onSelect={onSelect} onActivate={onActivate} />);
  pointerViewport();
  await user.click(screen.getByRole("button", { name: /^Jump to command 1:/ }));
  expect(onSelect).toHaveBeenLastCalledWith(1);
  expect(onActivate).toHaveBeenCalledExactlyOnceWith(1);
});

test("clicking the slider over the current prompt opens that prompt", async () => {
  const user = userEvent.setup();
  const onActivate = vi.fn();
  render(<Timeline events={[message(1, "session.inbox.delivered", first)]} onSelect={vi.fn()} onActivate={onActivate} />);
  pointerViewport();
  await user.click(screen.getByRole("slider"));
  expect(onActivate).toHaveBeenCalledExactlyOnceWith(1);
});

test("keyboard navigation moves focus with playback before activation", async () => {
  const user = userEvent.setup();
  const events = scrubEvents();
  const onActivate = vi.fn();
  function Harness() {
    const [active, setActive] = useState(1);
    return <Timeline events={events} activeEventID={active} onSelect={setActive} onActivate={onActivate} />;
  }
  render(<Harness />);
  screen.getByRole("button", { name: /^Jump to command 1:/ }).focus();
  await user.keyboard("{ArrowRight}{Enter}");
  expect(onActivate).toHaveBeenCalledExactlyOnceWith(2);
});

test.each(["Enter", " "])("%j activates the focused event rather than the current playback event", (key) => {
  const onSelect = vi.fn();
  const onActivate = vi.fn();
  render(<Timeline events={scrubEvents()} onSelect={onSelect} onActivate={onActivate} />);
  fireEvent.keyDown(screen.getByRole("button", { name: /^Jump to command 1:/ }), { key });
  expect(onSelect).toHaveBeenLastCalledWith(1);
  expect(onActivate).toHaveBeenCalledExactlyOnceWith(1);
});

test.each(["event", "slider"])("dragging from the %s scrubs without activating it on release", (target) => {
  const onSelect = vi.fn();
  const onActivate = vi.fn();
  render(<Timeline events={scrubEvents()} onSelect={onSelect} onActivate={onActivate} />);
  const viewport = pointerViewport();
  fireEvent.pointerDown(target === "slider" ? screen.getByRole("slider") : screen.getByRole("button", { name: /^Jump to command 1:/ }), {
    pointerId: 1, isPrimary: true, button: 0, clientX: 100, clientY: 20,
  });
  fireEvent.pointerMove(viewport, { pointerId: 1, clientX: 40, clientY: 20 });
  fireEvent.pointerUp(viewport, { pointerId: 1, clientX: 40, clientY: 20 });
  expect(onSelect).toHaveBeenLastCalledWith(1);
  expect(onActivate).not.toHaveBeenCalled();
});

test.each(["pointerCancel", "lostPointerCapture"])("%s does not activate a pressed event", (eventType) => {
  const onSelect = vi.fn();
  const onActivate = vi.fn();
  render(<Timeline events={scrubEvents()} onSelect={onSelect} onActivate={onActivate} />);
  const viewport = pointerViewport();
  fireEvent.pointerDown(screen.getByRole("button", { name: /^Jump to command 1:/ }), {
    pointerId: 1, isPrimary: true, button: 0, clientX: 100, clientY: 20,
  });
  fireEvent[eventType as "pointerCancel" | "lostPointerCapture"](viewport, { pointerId: 1 });
  expect(onSelect).not.toHaveBeenCalled();
  expect(onActivate).not.toHaveBeenCalled();
});

test("clicking the track and scrolling only select a playback position", () => {
  const onSelect = vi.fn();
  const onActivate = vi.fn();
  render(<Timeline events={scrubEvents()} onSelect={onSelect} onActivate={onActivate} />);
  const viewport = pointerViewport();
  const marker = screen.getByRole("button", { name: /^Jump to command 1:/ });
  const pointer = { pointerId: 1, isPrimary: true, button: 0, clientX: Number.parseFloat(marker.style.left) - viewport.scrollLeft, clientY: 20 };
  fireEvent.pointerDown(viewport, pointer);
  fireEvent.pointerUp(viewport, pointer);
  expect(onSelect).toHaveBeenLastCalledWith(1);
  fireEvent.wheel(viewport, { deltaY: -12 });
  expect(onSelect).toHaveBeenLastCalledWith(1);
  expect(onActivate).not.toHaveBeenCalled();
});

test("prompt boundaries survive command filtering and keep their summaries and numbers", () => {
  const command = event(3, "session.tool.called", read);
  const events = [
    message(1, "session.inbox.delivered", first), message(2, "session.text.ended"), command,
    event(4, "session.tool.called", read), message(5, "session.inbox.delivered", second),
  ];
  render(<Timeline events={events} prompts={collectActivity(events, "")} evidenceEvents={[
    ...events, event(6, "balrog.tool.outcome", { ...read, outcome: "Overview found." }),
  ]} onSelect={vi.fn()} />);
  expect(screen.getAllByRole("button", { name: /^Jump to/ })).toHaveLength(3);
  expect(screen.getAllByRole("button", { name: /^Jump to command/ })).toHaveLength(1);
  fireEvent.pointerEnter(screen.getByRole("button", { name: /^Jump to prompt 3: Prompt 02/ }), { pointerType: "mouse" });
  expect(within(screen.getByRole("tooltip")).getByText(second.text)).toBeTruthy();
  expect(within(screen.getByRole("tooltip")).queryByText("Reason")).toBeNull();
  fireEvent.pointerEnter(screen.getByRole("button", { name: /^Jump to command/ }), { pointerType: "mouse" });
  expect(within(screen.getByRole("tooltip")).queryByText("Overview found.")).toBeNull();
});

test("a command at a prompt boundary does not gain a duplicate recorder marker", () => {
  render(<Timeline events={[
    { ...event(1, "session.tool.called", read), activityUpdates: activityUpdates(1, first) },
    event(2, "session.tool.called", read),
  ]} onSelect={vi.fn()} />);
  expect(screen.getAllByRole("button", { name: /^Jump to/ })).toHaveLength(1);
  expect(screen.getByRole("button", { name: /^Jump to prompt 1: Prompt 01/ })).toBeTruthy();
});

test("timeline shows one marker per command and its verbatim reason without any outcome", () => {
  const events = [event(1, "session.text.ended"), event(2, "session.tool.called", read), event(3, "session.tool.success", { ...read, completedAt: 120 })];
  const onSelect = vi.fn();
  const { rerender } = render(<Timeline events={events} onSelect={onSelect} />);
  const timeline = within(screen.getByRole("group", { name: "Event timeline" }));
  expect(timeline.getAllByRole("button", { name: /^Jump to/ })).toHaveLength(1);
  expect(screen.getByRole("slider").getAttribute("aria-valuemax")).toBe("1");
  fireEvent.pointerEnter(timeline.getByRole("button", { name: /^Jump to/ }), { pointerType: "mouse" });
  const tooltip = within(screen.getByRole("tooltip"));
  expect(tooltip.getByText('read').textContent).toBe("read");
  expect(tooltip.getByText("README.md")).toBeTruthy();
  expect(tooltip.getByText(/Read the overview/).textContent).toBe(read.reason);
  expect(tooltip.queryByText("null")).toBeNull();
  expect(tooltip.queryByText(/^Outcome/)).toBeNull();

  const outcome = "Found setup instructions.\nNo code changed.";
  rerender(<Timeline events={[...events, event(4, "balrog.tool.outcome", { ...read, completedAt: 120, outcome })]} onSelect={onSelect} />);
  expect(within(screen.getByRole("tooltip")).queryByText(/Found setup instructions/)).toBeNull();
  expect(timeline.getAllByRole("button", { name: /^Jump to/ })).toHaveLength(1);
  fireEvent.keyDown(screen.getByRole("slider"), { key: "Home" });
  expect(onSelect).toHaveBeenLastCalledWith(2);
});

test("duplicate recorder events update the first command icon instead of adding another", () => {
  const first = event(2, "session.tool.called", { ...read, reason: null });
  const duplicate = event(3, "session.tool.called", read);
  duplicate.event = { ...duplicate.event, pluginID: "another-recorder" };
  const onSelect = vi.fn();
  const { rerender } = render(<Timeline events={[first]} onSelect={onSelect} />);
  const icon = screen.getByRole("button", { name: /^Jump to command/ });
  fireEvent.pointerEnter(icon, { pointerType: "mouse" });

  rerender(<Timeline events={[first, duplicate]} onSelect={onSelect} />);
  expect(screen.getAllByRole("button", { name: /^Jump to command/ })).toHaveLength(1);
  expect(screen.getByRole("button", { name: /^Jump to command/ })).toBe(icon);
  expect(within(screen.getByRole("tooltip")).getByText(/Read the overview/).textContent).toBe(read.reason);

  const reason = event(4, "balrog.tool.intent", { ...read, reason: "Verify the recorded setup instructions." });
  reason.event = { ...reason.event, pluginID: "intent-recorder" };
  rerender(<Timeline events={[first, duplicate, reason]} onSelect={onSelect} />);
  expect(screen.getAllByRole("button", { name: /^Jump to command/ })).toHaveLength(1);
  expect(within(screen.getByRole("tooltip")).getByText("Verify the recorded setup instructions.")).toBeTruthy();

  const outcome = event(5, "balrog.tool.outcome", { ...reason.execution!, outcome: "Overview found." });
  outcome.event = { ...outcome.event, pluginID: "outcome-recorder" };
  rerender(<Timeline events={[first, duplicate, reason, outcome]} onSelect={onSelect} />);
  expect(screen.getAllByRole("button", { name: /^Jump to command/ })).toHaveLength(1);
  expect(within(screen.getByRole("tooltip")).queryByText("Overview found.")).toBeNull();
  fireEvent.keyDown(screen.getByRole("slider"), { key: "Home" });
  expect(onSelect).toHaveBeenLastCalledWith(2);
});

test("retro assessment events update timeline reasons without displaying outcomes or adding markers", () => {
  const original = event(1, "session.tool.called", { ...read, reason: null });
  const { rerender } = render(<Timeline events={[original]} onSelect={vi.fn()} />);
  fireEvent.pointerEnter(screen.getByRole("button", { name: /^Jump to command/ }), { pointerType: "mouse" });
  const assessment = event(2, "balrog.tool.assessed", {
    ...read, reason: "Inferred: find setup instructions.", outcome: "The README contains setup instructions.",
  });
  assessment.event = { ...assessment.event, pluginID: "balrog-retro" };
  rerender(<Timeline events={[original, assessment]} onSelect={vi.fn()} />);
  expect(screen.getAllByRole("button", { name: /^Jump to command/ })).toHaveLength(1);
  const tooltip = within(screen.getByRole("tooltip"));
  expect(tooltip.getByText("Inferred: find setup instructions.")).toBeTruthy();
  expect(tooltip.queryByText("The README contains setup instructions.")).toBeNull();
  expect(tooltip.queryByText(/^Outcome/)).toBeNull();
});

test("timeline distinguishes agent and retrospective reasons but never shows their outcomes", () => {
  const live: ToolExecution = {
    ...read, reasonSource: "agent", outcomeSource: "automatic",
    outcome: "Tool completed. Result excerpt: “Setup instructions”",
  };
  const { rerender } = render(<Timeline events={[event(1, "session.tool.called", live)]} onSelect={vi.fn()} />);
  fireEvent.pointerEnter(screen.getByRole("button", { name: /^Jump to command/ }), { pointerType: "mouse" });
  const tooltip = within(screen.getByRole("tooltip"));
  expect(tooltip.getByText("Reason (agent-provided)")).toBeTruthy();
  expect(tooltip.queryByText(/^Outcome/)).toBeNull();
  expect(tooltip.queryByText(live.outcome!)).toBeNull();
  rerender(<Timeline events={[
    event(1, "session.tool.called", live),
    event(2, "balrog.tool.assessed", { ...live, reasonSource: "retrospective", outcomeSource: "retrospective" }),
  ]} onSelect={vi.fn()} />);
  expect(tooltip.getByText("Reason (retrospective)")).toBeTruthy();
  expect(tooltip.queryByText(/^Outcome/)).toBeNull();
  expect(tooltip.queryByText(live.outcome!)).toBeNull();
});

test.each([undefined, "agent", "automatic", "retrospective"] as const)("timeline markers omit %s outcome data entirely", (outcomeSource) => {
  const call = event(1, "session.tool.called", { ...read, outcome: "Outcome must not appear on the timeline.", outcomeSource });
  const { markers } = commandTimeline([call]);
  expect(markers).toHaveLength(1);
  expect(markers[0]).not.toHaveProperty("outcome");
  expect(markers[0]).not.toHaveProperty("outcomeSource");
});

test("separate calls of the same command and calls in different sessions retain separate icons", () => {
  render(<Timeline events={[
    event(1, "session.tool.called", read),
    event(2, "session.tool.called", { ...read, callID: "call-2", startedAt: 200 }),
    event(3, "session.tool.called", read, "s2"),
  ]} onSelect={vi.fn()} />);
  expect(screen.getAllByRole("button", { name: /^Jump to command/ })).toHaveLength(3);
});

test("timeline hides reporting helpers but retains execute wrappers that also do work", () => {
  const execution = (name: string, args: unknown, callID: string): ToolExecution => ({ ...read, callID, command: { name, args } });
  render(<Timeline onSelect={vi.fn()} events={[
    event(1, "session.tool.called", execution("balrog_reportOutcome", { callID: "a", outcome: "done" }, "helper")),
    event(2, "session.tool.called", execution("execute", { code: 'return await tools.balrog.reportOutcome({"callID":"a","outcome":"done"});' }, "report")),
    event(3, "session.tool.called", execution("execute", { code: 'return await Promise.all([tools.balrog.reportOutcome({callID:"a",outcome:"done"})]);' }, "uncertain")),
    event(4, "session.tool.called", execution("execute", { code: 'await tools.balrog.reportOutcome({"callID":"a","outcome":"done"}); return await fetch("/api");' }, "mixed")),
    event(5, "session.tool.called", read),
  ]} />);
  // Uncertain code stays visible, just as the retro skill specifies.
  expect(screen.getAllByRole("button", { name: /^Jump to command/ })).toHaveLength(3);
});

test("filtered commands retain later evidence and call IDs remain scoped to their session", () => {
  const command = event(2, "session.tool.called", read);
  const { rerender } = render(<Timeline events={[command]} evidenceEvents={[
    command,
    event(3, "balrog.tool.assessed", { ...read, reason: "Correct session reason", outcome: "Correct session outcome" }),
    event(4, "balrog.tool.assessed", { ...read, reason: "Other session reason", outcome: "Other session outcome" }, "s2"),
  ]} onSelect={vi.fn()} />);
  fireEvent.focus(screen.getByRole("slider"));
  fireEvent.pointerEnter(screen.getByRole("button", { name: /^Jump to command/ }), { pointerType: "mouse" });
  expect(within(screen.getByRole("tooltip")).getByText("Correct session reason")).toBeTruthy();
  expect(screen.queryByText("Other session reason")).toBeNull();
  expect(screen.queryByText("Correct session outcome")).toBeNull();
  expect(screen.queryByText("Other session outcome")).toBeNull();
  rerender(<Timeline events={[event(5, "session.text.ended")]} onSelect={vi.fn()} />);
  expect(screen.queryByRole("slider")).toBeNull();
  expect(screen.getByText("No commands")).toBeTruthy();
});

test("hover details stay open while the pointer moves into the scrollable tooltip", () => {
  vi.useFakeTimers();
  render(<Timeline events={[event(2, "session.tool.called", read)]} onSelect={vi.fn()} />);
  const marker = screen.getByRole("button", { name: /^Jump to command/ });
  fireEvent.pointerEnter(marker, { pointerType: "mouse" });
  fireEvent.pointerLeave(marker, { pointerType: "mouse" });
  expect(screen.getByRole("tooltip")).toBeTruthy();
  fireEvent.pointerEnter(screen.getByRole("tooltip"), { pointerType: "mouse" });
  act(() => vi.advanceTimersByTime(200));
  expect(screen.getByRole("tooltip")).toBeTruthy();
  fireEvent.pointerLeave(screen.getByRole("tooltip"), { pointerType: "mouse" });
  act(() => vi.advanceTimersByTime(200));
  expect(screen.queryByRole("tooltip")).toBeNull();
});

test.each(["{Enter}", " "])("tooltip action stays available while focused and activates with %s", async (key) => {
  vi.useFakeTimers();
  const onSelect = vi.fn();
  const onActivate = vi.fn();
  render(<Timeline events={scrubEvents()} onSelect={onSelect} onActivate={onActivate} />);
  const marker = screen.getByRole("button", { name: /^Jump to command 1:/ });
  fireEvent.pointerEnter(marker, { pointerType: "mouse" });
  fireEvent.pointerLeave(marker, { pointerType: "mouse" });
  const action = screen.getByRole("button", { name: "Open in event stream" });
  act(() => action.focus());
  fireEvent.pointerEnter(action, { pointerType: "mouse" });
  fireEvent.pointerLeave(action, { pointerType: "mouse" });
  act(() => vi.advanceTimersByTime(2_000));
  expect(action.isConnected).toBe(true);
  expect(document.activeElement).toBe(action);
  vi.useRealTimers();
  const user = userEvent.setup();
  await user.keyboard(key);
  expect(onSelect).toHaveBeenLastCalledWith(1);
  expect(onActivate).toHaveBeenCalledExactlyOnceWith(1);
  expect(screen.queryByRole("tooltip")).toBeNull();
});

test.each(["marker", "scrubber"])("tooltip action keeps focus when the pointer leaves its %s afterward", (target) => {
  vi.useFakeTimers();
  const onActivate = vi.fn();
  render(<Timeline events={scrubEvents()} onSelect={vi.fn()} onActivate={onActivate} />);
  const anchor = target === "marker" ? screen.getByRole("button", { name: /^Jump to command 1:/ }) : screen.getByRole("slider");
  fireEvent.pointerEnter(anchor, { pointerType: "mouse" });
  const action = screen.getByRole("button", { name: "Open in event stream" });
  act(() => action.focus());
  fireEvent.pointerLeave(anchor, { pointerType: "mouse" });
  act(() => vi.advanceTimersByTime(200));
  expect(action.isConnected).toBe(true);
  expect(document.activeElement).toBe(action);
  fireEvent.click(action);
  expect(onActivate).toHaveBeenCalledExactlyOnceWith(target === "marker" ? 1 : 2);
});

test("tooltip action follows the scrubber in Tab order even when related overflow controls are present", async () => {
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(400);
  const user = userEvent.setup();
  const onActivate = vi.fn();
  render(<Timeline events={manyEvents(1_000)} activeEventID={500} followingLive={false} highlightedEventIDs={new Set([10, 950])} onSelect={vi.fn()} onActivate={onActivate} />);
  expect(screen.getAllByRole("button", { name: /^Show 1 related command/ })).toHaveLength(2);
  const scrubber = screen.getByRole("slider");
  act(() => scrubber.focus());
  fireEvent.pointerEnter(scrubber, { pointerType: "mouse" });
  const action = screen.getByRole("button", { name: "Open in event stream" });
  await user.tab();
  expect(document.activeElement).toBe(action);
  await user.tab({ shift: true });
  expect(document.activeElement).toBe(scrubber);
  await user.tab();
  expect(document.activeElement).toBe(action);
  await user.keyboard("{Enter}");
  expect(onActivate).toHaveBeenCalledExactlyOnceWith(500);
});

test("tooltip action stays available after scrubbing while the pointer is over it", () => {
  vi.useFakeTimers();
  const onActivate = vi.fn();
  const events = scrubEvents();
  function Harness() {
    const [active, setActive] = useState(2);
    return <Timeline events={events} activeEventID={active} followingLive={false} onSelect={setActive} onActivate={onActivate} />;
  }
  render(<Harness />);
  fireEvent.keyDown(screen.getByRole("slider"), { key: "Home" });
  const action = screen.getByRole("button", { name: "Open in event stream" });
  expect(action.closest('[role="tooltip"]')).toBeNull();
  fireEvent.pointerEnter(action, { pointerType: "mouse" });
  act(() => vi.advanceTimersByTime(2_000));
  expect(action.isConnected).toBe(true);
  fireEvent.click(action);
  expect(onActivate).toHaveBeenCalledExactlyOnceWith(1);
});

test("tooltip action stays open when focus leaves but the pointer is still over it", () => {
  vi.useFakeTimers();
  render(<><button type="button">Elsewhere</button><Timeline events={scrubEvents()} onSelect={vi.fn()} onActivate={vi.fn()} /></>);
  fireEvent.pointerEnter(screen.getByRole("button", { name: /^Jump to command 1:/ }), { pointerType: "mouse" });
  const action = screen.getByRole("button", { name: "Open in event stream" });
  fireEvent.pointerEnter(action, { pointerType: "mouse" });
  act(() => action.focus());
  act(() => screen.getByRole("button", { name: "Elsewhere" }).focus());
  act(() => vi.advanceTimersByTime(2_000));
  expect(action.isConnected).toBe(true);
  fireEvent.pointerLeave(action, { pointerType: "mouse" });
  act(() => vi.advanceTimersByTime(200));
  expect(action.isConnected).toBe(false);
});

test("tooltip action opens prompt markers and is omitted without a stream activation callback", () => {
  const onActivate = vi.fn();
  const events = [message(1, "session.inbox.delivered", first)];
  const { rerender } = render(<Timeline events={events} onSelect={vi.fn()} onActivate={onActivate} />);
  fireEvent.pointerEnter(screen.getByRole("button", { name: /^Jump to prompt/ }), { pointerType: "mouse" });
  fireEvent.click(screen.getByRole("button", { name: "Open in event stream" }));
  expect(onActivate).toHaveBeenCalledExactlyOnceWith(1);
  rerender(<Timeline events={events} onSelect={vi.fn()} />);
  fireEvent.pointerEnter(screen.getByRole("button", { name: /^Jump to prompt/ }), { pointerType: "mouse" });
  expect(screen.getByRole("tooltip")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Open in event stream" })).toBeNull();
});
