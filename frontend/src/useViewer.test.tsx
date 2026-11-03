import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { useViewer } from "./useViewer";

class MockWebSocket {
  static instances: MockWebSocket[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((message: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  send = vi.fn();
  close = vi.fn();

  constructor(readonly url: string) {
    MockWebSocket.instances.push(this);
  }

  receive(message: unknown) {
    this.onmessage?.({ data: JSON.stringify(message) });
  }
}

const message = {
  id: 1,
  event: { tag: "session.tool.called", sessionID: "s1" },
  session: { sessionID: "s1", title: "First", eventCount: 1 },
};

beforeEach(() => {
  MockWebSocket.instances = [];
  vi.stubGlobal("WebSocket", MockWebSocket);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

test("requests a snapshot and replaces replayed state instead of duplicating events", () => {
  const { result } = renderHook(() => useViewer());
  const socket = MockWebSocket.instances[0];
  expect(socket.url).toMatch(/^ws:\/\/.+\/ws$/);
  act(() => socket.onopen?.());
  expect(socket.send).toHaveBeenCalledWith(JSON.stringify({ type: "snapshot.request" }));
  act(() => socket.receive({ type: "snapshot", sessions: [message.session], events: [message] }));
  expect(result.current.status).toBe("live");
  expect(result.current.events).toHaveLength(1);
  act(() => socket.receive({ type: "event", message: { ...message, id: 2 } }));
  expect(result.current.events).toHaveLength(2);
  act(() => socket.receive({ type: "snapshot", sessions: [], events: [message] }));
  expect(result.current.events).toHaveLength(1);
  expect(result.current.sessions).toEqual([]);
});

test("reconnects after close and cleans up sockets and retries on unmount", () => {
  vi.useFakeTimers();
  const { result, unmount } = renderHook(() => useViewer());
  const first = MockWebSocket.instances[0];
  act(() => first.onclose?.());
  expect(result.current.status).toBe("reconnecting");
  act(() => vi.advanceTimersByTime(1_000));
  expect(MockWebSocket.instances).toHaveLength(2);
  const second = MockWebSocket.instances[1];
  act(() => second.onopen?.());
  expect(second.send).toHaveBeenCalledOnce();
  unmount();
  expect(second.close).toHaveBeenCalledOnce();
  act(() => vi.advanceTimersByTime(30_000));
  expect(MockWebSocket.instances).toHaveLength(2);
});

test("ignores malformed server frames and surfaces protocol errors", () => {
  const { result } = renderHook(() => useViewer());
  const socket = MockWebSocket.instances[0];
  act(() => socket.onmessage?.({ data: "not json" }));
  expect(result.current.events).toEqual([]);
  act(() => socket.receive({ type: "error", message: "Invalid request" }));
  expect(result.current.error).toBe("Invalid request");
});
