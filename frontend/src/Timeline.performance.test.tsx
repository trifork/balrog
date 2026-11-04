import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, expect, test, vi } from "vitest";
import type { LogEvent } from "../../server/log-receiver";
import { Timeline } from "./Timeline";
import type { ReceivedEvent } from "./useViewer";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const commands = (count: number, offset = 0): ReceivedEvent[] => Array.from({ length: count }, (_, index) => ({
  id: offset + index + 1, receivedAt: 1_700_000_000_000 + index,
  event: { tag: "session.tool.called", sessionID: "s1", pluginID: "test" } as unknown as LogEvent,
  execution: {
    callID: `call-${offset + index}`, command: { name: "read", args: { path: "README.md" } },
    startedAt: index, completedAt: null, reason: "Read the overview.", outcome: null, result: null,
  },
}));

function animationFrames() {
  let next = 0;
  const pending = new Map<number, FrameRequestCallback>();
  vi.stubGlobal("requestAnimationFrame", vi.fn((callback: FrameRequestCallback) => {
    pending.set(++next, callback);
    return next;
  }));
  vi.stubGlobal("cancelAnimationFrame", vi.fn((id: number) => pending.delete(id)));
  return {
    pending,
    flush: () => act(() => {
      const callbacks = [...pending.values()];
      pending.clear();
      for (const callback of callbacks) callback(0);
    }),
  };
}

function viewport() {
  const element = screen.getByRole("slider").parentElement!.parentElement!;
  element.setPointerCapture = vi.fn();
  element.hasPointerCapture = vi.fn(() => false);
  element.releasePointerCapture = vi.fn();
  return element;
}

test("rapid wheel inputs publish one accumulated playback update per frame", () => {
  const frames = animationFrames();
  const events = commands(1_000);
  const onSelect = vi.fn();
  function Harness() {
    const [active, setActive] = useState(1_000);
    return <Timeline events={events} activeEventID={active} followingLive={false} onSelect={(id) => { onSelect(id); setActive(id); }} />;
  }
  render(<Harness />);
  const track = viewport();
  for (let index = 0; index < 20; index++) fireEvent.wheel(track, { deltaY: -12 });
  expect(onSelect).not.toHaveBeenCalled();
  expect(frames.pending.size).toBe(1);
  frames.flush();
  expect(onSelect).toHaveBeenCalledExactlyOnceWith(980);
  expect(screen.getByRole("slider").getAttribute("aria-valuenow")).toBe("980");
  fireEvent.wheel(track, { deltaY: -24 });
  frames.flush();
  expect(onSelect).toHaveBeenLastCalledWith(978);
});

test.each([["wheel", false], ["wheel", true], ["drag", false], ["drag", true]] as const)("new %s input survives React acknowledging the previous frame (initially live: %s)", (input, live) => {
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(400);
  const frames = animationFrames();
  const events = commands(50);
  const onSelect = vi.fn();
  function Harness() {
    const [active, setActive] = useState<number | undefined>(live ? undefined : 50);
    return <Timeline events={events} activeEventID={active} followingLive={active === undefined} onSelect={(id) => { onSelect(id); setActive(id); }} />;
  }
  render(<Harness />);
  const track = viewport();
  vi.spyOn(track, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 400, 40));
  if (input === "wheel") fireEvent.wheel(track, { deltaY: -12 });
  else {
    fireEvent.pointerDown(screen.getByRole("slider"), { pointerId: 1, isPrimary: true, button: 0, clientX: 100, clientY: 20 });
    fireEvent.pointerMove(track, { pointerId: 1, clientX: 79, clientY: 20 });
  }
  act(() => {
    const callbacks = [...frames.pending.values()];
    frames.pending.clear();
    for (const callback of callbacks) callback(0);
    if (input === "wheel") fireEvent.wheel(track, { deltaY: -12 });
    else fireEvent.pointerMove(track, { pointerId: 1, clientX: 58, clientY: 20 });
  });
  expect(onSelect).toHaveBeenCalledExactlyOnceWith(49);
  frames.flush();
  expect(onSelect).toHaveBeenLastCalledWith(48);
  expect(screen.getByRole("slider").getAttribute("aria-valuenow")).toBe("48");
});

test("incoming live commands do not discard a queued request to scrub into history", () => {
  const frames = animationFrames();
  const onSelect = vi.fn();
  const { rerender } = render(<Timeline events={commands(100)} onSelect={onSelect} />);
  fireEvent.wheel(viewport(), { deltaY: -12 });
  rerender(<Timeline events={commands(101)} onSelect={onSelect} />);
  frames.flush();
  expect(onSelect).toHaveBeenCalledExactlyOnceWith(99);
});

test("rapid drag inputs publish once per frame without activating commands", () => {
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(400);
  const frames = animationFrames();
  const events = commands(100);
  const onSelect = vi.fn();
  const onActivate = vi.fn();
  function Harness() {
    const [active, setActive] = useState(100);
    return <Timeline events={events} activeEventID={active} followingLive={false} onSelect={(id) => { onSelect(id); setActive(id); }} onActivate={onActivate} />;
  }
  render(<Harness />);
  const track = viewport();
  vi.spyOn(track, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 400, 40));
  fireEvent.pointerDown(screen.getByRole("slider"), { pointerId: 1, isPrimary: true, button: 0, clientX: 100, clientY: 20 });
  for (let x = 96; x >= 80; x--) fireEvent.pointerMove(track, { pointerId: 1, clientX: x, clientY: 20 });
  expect(onSelect).not.toHaveBeenCalled();
  frames.flush();
  expect(onSelect).toHaveBeenCalledExactlyOnceWith(99);
  fireEvent.pointerUp(track, { pointerId: 1, clientX: 80, clientY: 20 });
  expect(onActivate).not.toHaveBeenCalled();
  expect(document.activeElement).toBe(screen.getByRole("slider"));
});

test.each(["session", "selection", "centering", "live", "blur", "unmount"])("pending wheel input does not override %s changes", (change) => {
  const frames = animationFrames();
  const events = commands(100);
  const onSelect = vi.fn();
  const { rerender, unmount } = render(<Timeline events={events} activeEventID={50} followingLive={false} onSelect={onSelect} />);
  fireEvent.wheel(viewport(), { deltaY: -12 });
  expect(frames.pending.size).toBe(1);
  if (change === "session") rerender(<Timeline events={commands(100, 1_000)} activeEventID={1_050} followingLive={false} onSelect={onSelect} />);
  if (change === "selection") rerender(<Timeline events={events} activeEventID={80} followingLive={false} onSelect={onSelect} />);
  if (change === "centering") rerender(<Timeline events={events} activeEventID={50} centerRequest={{ id: 50 }} followingLive={false} onSelect={onSelect} />);
  if (change === "live") rerender(<Timeline events={events} activeEventID={50} followingLive onSelect={onSelect} />);
  if (change === "blur") fireEvent(window, new Event("blur"));
  if (change === "unmount") unmount();
  frames.flush();
  expect(onSelect).not.toHaveBeenCalled();
  expect(frames.pending.size).toBe(0);
});

test.each([
  { deltaY: -24, expected: 48 },
  { deltaX: -24, deltaY: 2, expected: 48 },
  { deltaY: -1, deltaMode: 1, expected: 49 },
  { deltaY: -1, deltaMode: 2, expected: 17 },
  { deltaY: 2_400, expected: 100 },
  { deltaY: -2_400, expected: 1 },
])("wheel sensitivity, axes, delta modes, and bounds are retained: %j", ({ expected, ...input }) => {
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(400);
  const frames = animationFrames();
  const onSelect = vi.fn();
  render(<Timeline events={commands(100)} activeEventID={50} onSelect={onSelect} />);
  fireEvent.wheel(viewport(), input);
  frames.flush();
  expect(onSelect).toHaveBeenCalledExactlyOnceWith(expected);
});

test("small wheel deltas accumulate and control-wheel zoom remains untouched", () => {
  const frames = animationFrames();
  const onSelect = vi.fn();
  render(<Timeline events={commands(100)} activeEventID={50} onSelect={onSelect} />);
  const track = viewport();
  fireEvent.wheel(track, { deltaY: -11 });
  expect(frames.pending.size).toBe(0);
  fireEvent.wheel(track, { deltaY: -1 });
  frames.flush();
  expect(onSelect).toHaveBeenCalledExactlyOnceWith(49);
  const zoom = new WheelEvent("wheel", { deltaY: 120, ctrlKey: true, cancelable: true });
  fireEvent(track, zoom);
  expect(zoom.defaultPrevented).toBe(false);
  expect(frames.pending.size).toBe(0);
});

test.each(["pointerUp", "pointerCancel", "lostPointerCapture", "blur", "Escape"])("%s flushes the last drag position without activating it", (ending) => {
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(400);
  const frames = animationFrames();
  const onSelect = vi.fn();
  const onActivate = vi.fn();
  render(<Timeline events={commands(100)} onSelect={onSelect} onActivate={onActivate} />);
  const track = viewport();
  vi.spyOn(track, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 400, 40));
  fireEvent.pointerDown(screen.getByRole("slider"), { pointerId: 1, isPrimary: true, button: 0, clientX: 100, clientY: 20 });
  fireEvent.pointerMove(track, { pointerId: 1, clientX: 58, clientY: 20 });
  expect(onSelect).not.toHaveBeenCalled();
  if (ending === "blur") fireEvent(window, new Event("blur"));
  else if (ending === "Escape") fireEvent.keyDown(screen.getByRole("slider"), { key: "Escape" });
  else fireEvent[ending as "pointerUp" | "pointerCancel" | "lostPointerCapture"](track, { pointerId: 1, clientX: 58, clientY: 20 });
  expect(onSelect).toHaveBeenCalledExactlyOnceWith(98);
  frames.flush();
  expect(onSelect).toHaveBeenCalledTimes(1);
  expect(onActivate).not.toHaveBeenCalled();
  expect(screen.getByRole("group", { name: "Event timeline" }).getAttribute("data-dragging")).toBe("false");
});

test("fine scrubbing retains fractional progress across frames and the live-to-paused transition", () => {
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(400);
  const frames = animationFrames();
  const events = commands(100);
  function Harness() {
    const [active, setActive] = useState<number>();
    return <Timeline events={events} activeEventID={active} followingLive={active === undefined} onSelect={setActive} />;
  }
  render(<Harness />);
  const track = viewport();
  vi.spyOn(track, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 400, 40));
  fireEvent.pointerDown(screen.getByRole("slider"), { pointerId: 1, isPrimary: true, button: 0, clientX: 100, clientY: 20 });
  for (let x = 96; x >= 36; x -= 3) {
    fireEvent.pointerMove(track, { pointerId: 1, clientX: x, clientY: 232 });
    frames.flush();
  }
  expect(screen.getByText("Fine 20%")).toBeTruthy();
  expect(screen.getByRole("slider").getAttribute("aria-valuenow")).toBe("99");
  fireEvent.pointerUp(track, { pointerId: 1 });
  expect(screen.queryByText("Fine 20%")).toBeNull();
});

test.each(["Home", "Enter", "click", "live"])("explicit %s navigation stays immediate and supersedes queued scrolling", (action) => {
  const frames = animationFrames();
  const onSelect = vi.fn();
  const onActivate = vi.fn();
  const onToggleLive = vi.fn();
  render(<Timeline events={commands(100)} activeEventID={50} followingLive={false} onSelect={onSelect} onActivate={onActivate} onToggleLive={onToggleLive} />);
  fireEvent.wheel(viewport(), { deltaY: -12 });
  if (action === "click") fireEvent.click(screen.getByRole("button", { name: /^Jump to command 50:/ }));
  else if (action === "live") fireEvent.click(screen.getByRole("button", { name: "Resume live playback" }));
  else fireEvent.keyDown(screen.getByRole("slider"), { key: action });
  if (action === "live") {
    expect(onSelect).not.toHaveBeenCalled();
    expect(onToggleLive).toHaveBeenCalledTimes(1);
  } else {
    expect(onSelect).toHaveBeenCalledExactlyOnceWith(action === "Home" ? 1 : 50);
    if (action !== "Home") expect(onActivate).toHaveBeenCalledExactlyOnceWith(50);
  }
  expect(frames.pending.size).toBe(0);
  frames.flush();
  expect(onSelect.mock.calls.flat()).not.toContain(49);
});
