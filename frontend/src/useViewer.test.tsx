import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { useViewer } from "./useViewer";
import { createActivityUpdates } from "../../tests/activity-fixtures";

class MockWebSocket {
  static OPEN = 1;
  static instances: MockWebSocket[] = [];
  readyState = MockWebSocket.OPEN;
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
  act(() => socket.receive({ type: "snapshot", sessions: [message.session], events: [message], heatmaps: [] }));
  expect(result.current.status).toBe("live");
  expect(result.current.events).toHaveLength(1);
  act(() => socket.receive({ type: "event", message: { ...message, id: 2 } }));
  expect(result.current.events).toHaveLength(2);
  act(() => socket.receive({ type: "snapshot", sessions: [], events: [message], heatmaps: [] }));
  expect(result.current.events).toHaveLength(1);
  expect(result.current.sessions).toEqual([]);
  expect(result.current.heatmaps).toEqual([]);
});

test("uses canonical snapshot heatmaps, applies live updates and replaces state after reconnect", () => {
  const updates = createActivityUpdates();
  const first = { id: "p1", sessionID: "s1", text: "Change a file", files: [] };
  const initial = updates(1, first);
  const heatmap = { schemaVersion: 2, sessionID: "s1", items: initial.items };
  const { result } = renderHook(() => useViewer());
  const socket = MockWebSocket.instances[0];
  // The initial map comes from the snapshot, not from reinterpreting raw events.
  act(() => socket.receive({ type: "snapshot", sessions: [], events: [], heatmaps: [heatmap], permissions: [] }));
  expect(result.current.heatmaps).toEqual([heatmap]);
  const change = updates(2, { ...first, files: [
    { path: "app.ts", action: "modified", outcome: "success", callID: "edit" },
  ] });
  act(() => socket.receive({ type: "event", message: { ...message, id: 2, activityUpdates: change } }));
  const live = result.current.heatmaps[0].items.find((item) => item.kind === "file.change");
  expect(live).toMatchObject({ status: "completed", path: "app.ts", promptID: initial.items[0].id });
  expect(heatmap.items).toHaveLength(1);
  act(() => socket.receive({ type: "snapshot", sessions: [], events: [], heatmaps: [], permissions: [] }));
  expect(result.current.heatmaps).toEqual([]);
  expect(result.current.events).toEqual([]);
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

test("incompatible activity snapshots show an explicit error instead of opening a broken map", () => {
  const { result } = renderHook(() => useViewer());
  const socket = MockWebSocket.instances[0];
  for (const heatmaps of [undefined, [{ schemaVersion: 1, sessionID: "s1", items: [] }]]) {
    act(() => socket.receive({ type: "snapshot", sessions: [], events: [], heatmaps, permissions: [] }));
    expect(result.current.status).not.toBe("live");
    expect(result.current.error).toContain("Restart the viewer server");
    expect(result.current.heatmaps).toEqual([]);
  }
});

const permission = {
  pluginID: "p1", sessionID: "s1", requestID: "r1", resources: ["/src/appsettings.json"], status: "pending" as const,
};

test("permission snapshots and updates are separate from history and send exact once-only replies", () => {
  const { result } = renderHook(() => useViewer());
  const socket = MockWebSocket.instances[0];
  act(() => socket.receive({ type: "snapshot", sessions: [], events: [], heatmaps: [], permissions: [permission] }));
  expect(result.current.permissions).toEqual([permission]);
  act(() => {
    result.current.replyPermission(permission, "once");
    result.current.replyPermission(permission, "once");
  });
  expect(socket.send).toHaveBeenCalledOnce();
  expect(JSON.parse(socket.send.mock.calls[0][0])).toEqual({
    type: "permission.reply", pluginID: "p1", sessionID: "s1", requestID: "r1", decision: "once",
  });
  expect(result.current.permissions[0].status).toBe("replying");
  act(() => socket.receive({ type: "permissions", permissions: [] }));
  expect(result.current.permissions).toEqual([]);
  expect(result.current.events).toEqual([]);
});

test("permissions cannot be answered offline or replayed after removal, and a failed reply can be retried", () => {
  const { result } = renderHook(() => useViewer());
  const socket = MockWebSocket.instances[0];
  act(() => result.current.replyPermission(permission, "once"));
  expect(socket.send).not.toHaveBeenCalled();
  act(() => socket.receive({ type: "snapshot", sessions: [], events: [], heatmaps: [], permissions: [permission] }));
  act(() => result.current.replyPermission(permission, "reject"));
  expect(JSON.parse(socket.send.mock.calls[0][0]).decision).toBe("reject");
  act(() => {
    socket.receive({ type: "permissions", permissions: [permission] });
    socket.receive({ type: "error", message: "Native reply failed" });
  });
  act(() => result.current.replyPermission(permission, "once"));
  expect(socket.send).toHaveBeenCalledTimes(2);
  act(() => socket.receive({ type: "permissions", permissions: [] }));
  act(() => result.current.replyPermission(permission, "once"));
  expect(socket.send).toHaveBeenCalledTimes(2);
  act(() => socket.onclose?.());
  act(() => result.current.replyPermission(permission, "once"));
  expect(socket.send).toHaveBeenCalledTimes(2);
});
