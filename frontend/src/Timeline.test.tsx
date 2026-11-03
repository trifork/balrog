import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, expect, test, vi } from "vitest";
import type { PromptActivity } from "../../server/file-activity";
import type { ToolExecution } from "../../server/analyzer";
import type { LogEvent } from "../../server/log-receiver";
import { collectActivity } from "./file-activity-model";
import { Timeline } from "./Timeline";
import { timelineLayout } from "./timelineLayout";
import { timelineMarkers } from "./timelineMarkers";
import type { ReceivedEvent } from "./useViewer";

afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });

const message = (id: number, tag: string, activity?: PromptActivity): ReceivedEvent => ({
  id, receivedAt: 1_700_000_000_000 + id,
  event: { tag, sessionID: "s1", pluginID: "test", [tag]: { data: { sessionID: "s1" } } } as unknown as LogEvent,
  fileActivity: activity,
});

const first: PromptActivity = { id: "1", sessionID: "s1", text: "First user prompt", files: [] };
const second: PromptActivity = { ...first, id: "2", text: "Second user prompt" };

test("timeline boundaries and numbers match heatmap activity rather than queued or assistant event tags", () => {
  const events = [
    message(1, "session.inbox.enqueued"), message(2, "session.execution.started", first),
    message(3, "session.inbox.delivered", first), message(4, "session.text.ended"),
    message(5, "session.inbox.delivered", second), message(6, "session.tool.success", first),
    { ...message(7, "session.revert.staged", second), fileActivityUpdates: [first] },
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
    return <Timeline events={events} prompts={prompts} activeEventID={active} followingLive={false} onSelect={setActive} />;
  }
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
  expect(within(screen.getByRole("tooltip")).getByText("Overview found.")).toBeTruthy();
});

test("a command at a prompt boundary does not gain a duplicate recorder marker", () => {
  render(<Timeline events={[
    { ...event(1, "session.tool.called", read), fileActivity: first },
    event(2, "session.tool.called", read),
  ]} onSelect={vi.fn()} />);
  expect(screen.getAllByRole("button", { name: /^Jump to/ })).toHaveLength(1);
  expect(screen.getByRole("button", { name: /^Jump to prompt 1: Prompt 01/ })).toBeTruthy();
});

test("timeline shows one marker per command and verbatim reason and outcome on hover", () => {
  const events = [event(1, "session.text.ended"), event(2, "session.tool.called", read), event(3, "session.tool.success", { ...read, completedAt: 120 })];
  const onSelect = vi.fn();
  const { rerender } = render(<Timeline events={events} onSelect={onSelect} />);
  const timeline = within(screen.getByRole("group", { name: "Event timeline" }));
  expect(timeline.getAllByRole("button", { name: /^Jump to/ })).toHaveLength(1);
  expect(screen.getByRole("slider").getAttribute("aria-valuemax")).toBe("1");
  fireEvent.pointerEnter(timeline.getByRole("button", { name: /^Jump to/ }), { pointerType: "mouse" });
  const tooltip = within(screen.getByRole("tooltip"));
  expect(tooltip.getByText('read').textContent).toBe("read");
  expect(tooltip.getByText(/README.md/).textContent).toContain('"path": "README.md"');
  expect(tooltip.getByText(/Read the overview/).textContent).toBe(read.reason);
  expect(tooltip.getByText("null")).toBeTruthy();

  const outcome = "Found setup instructions.\nNo code changed.";
  rerender(<Timeline events={[...events, event(4, "balrog.tool.outcome", { ...read, completedAt: 120, outcome })]} onSelect={onSelect} />);
  expect(within(screen.getByRole("tooltip")).getByText(/Found setup instructions/).textContent).toBe(outcome);
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
  expect(within(screen.getByRole("tooltip")).getByText("Overview found.")).toBeTruthy();
  fireEvent.keyDown(screen.getByRole("slider"), { key: "Home" });
  expect(onSelect).toHaveBeenLastCalledWith(2);
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
    event(3, "balrog.tool.outcome", { ...read, outcome: "Correct session outcome" }),
    event(4, "balrog.tool.outcome", { ...read, outcome: "Other session outcome" }, "s2"),
  ]} onSelect={vi.fn()} />);
  fireEvent.focus(screen.getByRole("slider"));
  fireEvent.pointerEnter(screen.getByRole("button", { name: /^Jump to command/ }), { pointerType: "mouse" });
  expect(within(screen.getByRole("tooltip")).getByText("Correct session outcome")).toBeTruthy();
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
