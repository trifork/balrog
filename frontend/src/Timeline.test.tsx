import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, expect, test, vi } from "vitest";
import type { PromptActivity } from "../../server/file-activity";
import type { LogEvent } from "../../server/log-receiver";
import { collectActivity } from "./file-activity-model";
import { Timeline } from "./Timeline";
import { timelineLayout } from "./timelineLayout";
import { timelineMarkers } from "./timelineMarkers";
import type { ReceivedEvent } from "./useViewer";

afterEach(cleanup);

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
  const events = [message(1, "session.inbox.delivered", first), message(2, "session.tool.called"), message(3, "session.inbox.delivered", second)];
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
