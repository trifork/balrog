import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test } from "vitest";
import { EventFeed } from "./EventFeed";
import type { ReceivedEvent } from "./useViewer";

afterEach(cleanup);

function message(id: number, content?: string, sessionID = "s1"): ReceivedEvent {
  const receivedAt = 1_700_000_000_000 + id;
  return {
    id, content, receivedAt,
    event: {
      tag: "balrog.tool.intent", apiVersion: "v2", pluginID: "test", sessionID,
      "balrog.tool.intent": {
        type: "balrog.tool.intent", created: receivedAt,
        data: { sessionID, assistantMessageID: "assistant", id: `call-${id}`, tool: "read", reason: content ?? "" },
      },
    },
  };
}

test("starts event content collapsed with Expand all available", () => {
  render(<EventFeed events={[message(1, "First event"), message(2, "Second event")]} selectedSession="" />);
  expect(screen.getByRole("button", { name: "Expand all" })).toBeTruthy();
  expect(screen.getAllByRole("button", { name: "Expand event", expanded: false })).toHaveLength(2);
  expect(screen.getByText("First event").hidden).toBe(true);
  expect(screen.getByText("Second event").hidden).toBe(true);
});

test("keeps the collapsed default when content arrives after an empty or content-free list", () => {
  const { rerender } = render(<EventFeed events={[]} selectedSession="" />);
  expect((screen.getByRole("button", { name: "Expand all" }) as HTMLButtonElement).disabled).toBe(true);
  rerender(<EventFeed events={[message(1)]} selectedSession="" />);
  expect((screen.getByRole("button", { name: "Expand all" }) as HTMLButtonElement).disabled).toBe(true);
  rerender(<EventFeed events={[message(1), message(2, "Incoming event")]} selectedSession="" />);
  expect(screen.getByRole("button", { name: "Expand event", expanded: false })).toBeTruthy();
  expect(screen.getByText("Incoming event").hidden).toBe(true);
});

test("bulk controls affect only visible content and leave raw details independent", async () => {
  const user = userEvent.setup();
  const events = [message(1, "First event"), message(2, "Second event"), message(3, "Other session", "s2")];
  const { rerender } = render(<EventFeed events={events} selectedSession="" />);
  await user.click(screen.getByRole("button", { name: "Expand all" }));
  expect(screen.getAllByRole("button", { name: "Collapse event", expanded: true })).toHaveLength(3);
  rerender(<EventFeed events={events} selectedSession="s1" />);
  await user.click(screen.getByRole("button", { name: "Collapse all" }));
  expect(screen.getAllByRole("button", { name: "Expand event" })).toHaveLength(2);
  const card = screen.getAllByRole("article")[0];
  const details = card.querySelector("details")!;
  expect(details.open).toBe(false);
  await user.click(within(card).getByText("Raw event"));
  expect(details.open).toBe(true);
  rerender(<EventFeed events={events} selectedSession="" />);
  expect(screen.getAllByRole("button", { name: "Collapse event" })).toHaveLength(1);
  await user.click(screen.getByRole("button", { name: "Collapse event" }));
  await user.click(screen.getByRole("button", { name: "Expand all" }));
  expect(screen.getAllByRole("button", { name: "Collapse event" })).toHaveLength(3);
  expect(details.open).toBe(true);
});

test("new events inherit Expand all even while the search matches no events", async () => {
  const user = userEvent.setup();
  const events = [message(1, "First event")];
  const { rerender } = render(<EventFeed events={events} selectedSession="" />);
  await user.click(screen.getByRole("button", { name: "Expand all" }));
  expect(screen.getByText("First event").hidden).toBe(false);
  const search = screen.getByRole("searchbox", { name: "Search events" });
  await user.type(search, "missing");
  rerender(<EventFeed events={[...events, message(2, "Incoming event")]} selectedSession="" />);
  await user.clear(search);
  expect(screen.getAllByRole("button", { name: "Collapse event", expanded: true })).toHaveLength(2);
  expect(screen.getByText("Incoming event").hidden).toBe(false);
  await user.click(screen.getByRole("button", { name: "Collapse all" }));
  rerender(<EventFeed events={[...events, message(2, "Incoming event"), message(3, "Newest event")]} selectedSession="" />);
  expect(screen.getAllByRole("button", { name: "Expand event", expanded: false })).toHaveLength(3);
  expect(screen.getByText("Newest event").hidden).toBe(true);
});
