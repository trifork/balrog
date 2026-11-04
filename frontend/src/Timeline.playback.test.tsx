import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { PromptActivity } from "../../server/file-activity";
import type { LogEvent } from "../../server/log-receiver";
import { createActivityUpdates } from "../../tests/activity-fixtures";
import { App } from "./App";
import { activityAtEvents } from "./file-activity-model";
import type { ReceivedEvent, ViewerState } from "./useViewer";

let state: ViewerState;
vi.mock("./useViewer", () => ({ useViewer: () => state }));

beforeEach(() => {
  window.history.replaceState(null, "", "/");
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(400);
  const updates = createActivityUpdates();
  const pending: PromptActivity = {
    id: "prompt", sessionID: "s1", text: "Update files", files: [
      { path: "src/app.ts", action: "modified", outcome: "pending", callID: "call-1" },
    ],
  };
  const completed: PromptActivity = { ...pending, files: pending.files.map((file) => ({ ...file, outcome: "success" })) };
  const reverted: PromptActivity = { ...completed, files: completed.files.map((file) => ({ ...file, reverted: true })) };
  const events: ReceivedEvent[] = Array.from({ length: 100 }, (_, index) => {
    const id = index + 1;
    return {
      id, receivedAt: 1_700_000_000_000 + id, content: `Command ${id}`,
      event: { tag: "session.tool.called", sessionID: "s1", pluginID: "test", "session.tool.called": { data: { path: "src/app.ts" } } } as unknown as LogEvent,
      execution: {
        callID: `call-${id}`, command: { name: "edit", args: { path: "src/app.ts" } },
        startedAt: id, completedAt: null, reason: "Update the app.", outcome: null, result: null,
      },
      activityUpdates: id === 1 ? updates(id, pending) : id === 50 ? updates(id, completed) : id === 100 ? updates(id, reverted) : undefined,
    };
  });
  state = { events, heatmaps: activityAtEvents(events), sessions: [], permissions: [], status: "live", replyPermission: vi.fn() };
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function scrollPlayback() {
  let callback: FrameRequestCallback | undefined;
  vi.stubGlobal("requestAnimationFrame", vi.fn((next: FrameRequestCallback) => { callback = next; return 1; }));
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  const viewport = screen.getByRole("slider").parentElement!.parentElement!;
  for (let index = 0; index < 20; index++) fireEvent.wheel(viewport, { deltaY: -12 });
  expect(callback).toBeTypeOf("function");
  act(() => callback!(0));
}

const fileCell = () => within(screen.getByRole("table", { name: "File operations by prompt" }))
  .getByRole("button", { name: /^src\/app.ts, prompt 01:/ });

test("batched scrubbing reconstructs historical heatmaps and Go live restores the latest state without opening the drawer", async () => {
  const user = userEvent.setup();
  render(<App />);
  await user.click(screen.getByRole("button", { name: "Changes" }));
  expect(fileCell().getAttribute("data-reverted")).toBe("true");
  scrollPlayback();
  expect(screen.getByRole("slider").getAttribute("aria-valuenow")).toBe("80");
  expect(fileCell().getAttribute("data-heat")).toBe("1");
  expect(fileCell().hasAttribute("data-reverted")).toBe(false);
  expect(screen.queryByRole("region", { name: "Session events" })).toBeNull();
  await user.click(screen.getByRole("button", { name: "Resume live playback" }));
  expect(screen.getByRole("slider").getAttribute("aria-valuenow")).toBe("100");
  expect(fileCell().getAttribute("data-reverted")).toBe("true");
  expect(screen.queryByRole("region", { name: "Session events" })).toBeNull();
});

test("drawer search, expanded content, and raw details survive scrubbing and live playback", async () => {
  const user = userEvent.setup();
  render(<App />);
  await user.click(screen.getByRole("button", { name: "Expand event stream" }));
  await user.type(screen.getByRole("searchbox", { name: "Search events" }), "src/app.ts");
  const latest = document.getElementById("event-100")!;
  await user.click(within(latest).getByRole("button", { name: "Expand event" }));
  await user.click(within(latest).getByText("Raw event"));
  expect(latest.querySelector("details")!.open).toBe(true);
  await user.click(screen.getByRole("button", { name: "Collapse event stream" }));
  scrollPlayback();
  expect(screen.getByRole("slider").getAttribute("aria-valuenow")).toBe("80");
  await user.click(screen.getByRole("button", { name: "Resume live playback" }));
  await user.click(screen.getByRole("button", { name: "Expand event stream" }));
  expect((screen.getByRole("searchbox", { name: "Search events" }) as HTMLInputElement).value).toBe("src/app.ts");
  expect(within(latest).getByRole("button", { name: "Collapse event" }).getAttribute("aria-expanded")).toBe("true");
  expect(latest.querySelector("details")!.open).toBe(true);
});
