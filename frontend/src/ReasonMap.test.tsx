import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test } from "vitest";
import type { LogEvent } from "../../server/log-receiver";
import { ReasonMap } from "./ReasonMap";
import type { ReceivedEvent } from "./useViewer";
import { createActivityUpdates } from "../../tests/activity-fixtures";

afterEach(cleanup);

function access(id: number, callID: string, paths: string[], reason: string | null, prompt = "p1", sessionID = "s1"): ReceivedEvent {
  return {
    id, receivedAt: id,
    event: { tag: "session.tool.called", sessionID, pluginID: "test" } as unknown as LogEvent,
    activityUpdates: createActivityUpdates()(id, { id: prompt, sessionID, text: `Task ${prompt}`, files: paths.map((path) => ({ path, action: "read", outcome: "success", callID })) }),
    execution: { callID, command: { name: "read", args: {} }, reason, outcome: null, startedAt: id, completedAt: id, result: null },
  };
}

const explanation = "Understand the routing. Check how requests reach the frontend before adding a page.";
const events = [
  access(1, "c1", ["src/App.tsx", "src/main.tsx"], explanation),
  access(2, "c2", ["src/App.tsx"], explanation, "p2"),
  access(3, "c3", ["README.md"], null, "p3"),
];
const map = () => within(screen.getByRole("table", { name: "File access reasons" }));
const prompts = () => within(screen.getByRole("group", { name: "Prompts" }));

test("combines reasons per file and shows prompt text below without an explanations table", () => {
  render(<ReasonMap events={events} selectedSession="" sessions={[]} />);
  expect(map().getAllByRole("columnheader").map((header) => header.textContent)).toEqual(["File", "Reasons"]);
  expect(map().getAllByRole("rowheader").map((header) => header.textContent)).toEqual(["README.md", "src/App.tsx", "src/main.tsx"]);
  expect(map().getAllByRole("button", { name: "Understand the routing." })).toHaveLength(2);
  expect(map().getByRole("button", { name: "No recorded reason" })).toBeTruthy();
  expect(screen.queryByRole("table", { name: "Reason explanations" })).toBeNull();
  expect(prompts().getAllByRole("button").map((button) => button.textContent)).toEqual(["Prompt 01Task p1", "Prompt 02Task p2", "Prompt 03Task p3"]);
  expect(screen.getByRole("table").compareDocumentPosition(screen.getByRole("group", { name: "Prompts" })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});

test("hovering a reason highlights every matching file entry and its associated prompts", async () => {
  const user = userEvent.setup();
  render(<ReasonMap events={events} selectedSession="" sessions={[]} />);
  const reasons = map().getAllByRole("button", { name: "Understand the routing." });
  const toggles = prompts().getAllByRole("button");
  await user.hover(reasons[0]);
  expect(reasons.every((reason) => reason.getAttribute("data-highlighted") === "true")).toBe(true);
  expect(toggles.map((toggle) => toggle.getAttribute("data-highlighted"))).toEqual(["true", "true", null]);
  await user.unhover(reasons[0]);
  expect(toggles.every((toggle) => !toggle.hasAttribute("data-highlighted"))).toBe(true);
  await user.hover(map().getByRole("button", { name: "No recorded reason" }));
  expect(toggles.map((toggle) => toggle.getAttribute("data-highlighted"))).toEqual([null, null, "true"]);
});

test("clicking a prompt selects only that prompt and clicking it again keeps it selected", async () => {
  const user = userEvent.setup();
  render(<ReasonMap events={events} selectedSession="" sessions={[]} />);
  const toggles = prompts().getAllByRole("button");
  await user.click(toggles[1]);
  expect(toggles.map((toggle) => toggle.getAttribute("aria-pressed"))).toEqual(["false", "true", "false"]);
  expect(map().getAllByRole("rowheader").map((row) => row.textContent)).toEqual(["src/App.tsx"]);
  await user.click(toggles[1]);
  expect(toggles.map((toggle) => toggle.getAttribute("aria-pressed"))).toEqual(["false", "true", "false"]);
  await user.click(toggles[2]);
  expect(toggles.map((toggle) => toggle.getAttribute("aria-pressed"))).toEqual(["false", "false", "true"]);
  expect(map().getAllByRole("rowheader").map((row) => row.textContent)).toEqual(["README.md"]);
});

test("Shift-click toggles only one prompt and allows every prompt to be turned off", async () => {
  const user = userEvent.setup();
  render(<ReasonMap events={[events[0], access(2, "c2", ["src/App.tsx"], "Check the exports.", "p2"), events[2]]} selectedSession="" sessions={[]} />);
  const toggles = prompts().getAllByRole("button");
  expect(toggles.every((toggle) => toggle.getAttribute("aria-pressed") === "true")).toBe(true);
  expect(map().getByRole("button", { name: "Check the exports." })).toBeTruthy();
  await user.keyboard("{Shift>}");
  await user.click(toggles[1]);
  expect(toggles[1].getAttribute("aria-pressed")).toBe("false");
  expect(map().queryByRole("button", { name: "Check the exports." })).toBeNull();
  expect(map().getAllByRole("button", { name: "Understand the routing." })).toHaveLength(2);
  await user.click(toggles[0]);
  expect(map().getAllByRole("rowheader").map((row) => row.textContent)).toEqual(["README.md"]);
  await user.click(toggles[2]);
  expect(screen.getByText("No prompts selected.")).toBeTruthy();
  expect(map().queryAllByRole("rowheader")).toHaveLength(0);
  expect(prompts().getAllByRole("button")).toHaveLength(3);
  await user.keyboard("{/Shift}");
  await user.click(toggles[0]);
  expect(map().getAllByRole("rowheader").map((row) => row.textContent)).toEqual(["src/App.tsx", "src/main.tsx"]);
});

test("Shift-click adds to an exclusive selection and normal clicks replace that selection", async () => {
  const user = userEvent.setup();
  render(<ReasonMap events={events} selectedSession="" sessions={[]} />);
  const toggles = prompts().getAllByRole("button");
  await user.click(toggles[1]);
  await user.keyboard("{Shift>}");
  await user.click(toggles[2]);
  await user.keyboard("{/Shift}");
  expect(toggles.map((toggle) => toggle.getAttribute("aria-pressed"))).toEqual(["false", "true", "true"]);
  expect(map().getAllByRole("rowheader").map((row) => row.textContent)).toEqual(["README.md", "src/App.tsx"]);
  await user.click(toggles[0]);
  expect(toggles.map((toggle) => toggle.getAttribute("aria-pressed"))).toEqual(["true", "false", "false"]);
});

test("keyboard activation selects one prompt and Shift-Enter toggles without replacing the selection", async () => {
  const user = userEvent.setup();
  render(<ReasonMap events={events} selectedSession="" sessions={[]} />);
  const toggles = prompts().getAllByRole("button");
  await user.click(toggles[0]);
  await user.tab();
  expect(document.activeElement).toBe(toggles[1]);
  await user.keyboard("{Shift>}{Enter}{/Shift}");
  expect(toggles.map((toggle) => toggle.getAttribute("aria-pressed"))).toEqual(["true", "true", "false"]);
  await user.keyboard("{Enter}");
  expect(toggles.map((toggle) => toggle.getAttribute("aria-pressed"))).toEqual(["false", "true", "false"]);
});

test("file search filters the table without hiding prompt toggles", async () => {
  const user = userEvent.setup();
  render(<ReasonMap events={events} selectedSession="" sessions={[]} />);
  const search = screen.getByRole("searchbox", { name: "Find a file" });
  await user.type(search, "SRC/APP");
  expect(map().getAllByRole("rowheader").map((row) => row.textContent)).toEqual(["src/App.tsx"]);
  expect(prompts().getAllByRole("button")).toHaveLength(3);
  await user.type(search, "missing");
  expect(screen.getByText("No matching files.")).toBeTruthy();
  await user.keyboard("{Escape}");
  expect(map().getAllByRole("rowheader")).toHaveLength(3);
});

test("keyboard focus previews a reason and clicking pins both file and prompt highlights", async () => {
  const user = userEvent.setup();
  render(<ReasonMap events={events} selectedSession="" sessions={[]} />);
  const reason = map().getByRole("button", { name: "No recorded reason" });
  await user.tab();
  await user.tab();
  expect(document.activeElement).toBe(reason);
  expect(prompts().getAllByRole("button")[2].getAttribute("data-highlighted")).toBe("true");
  await user.keyboard("{Enter}{Tab}");
  expect(reason.getAttribute("aria-pressed")).toBe("true");
  expect(reason.getAttribute("data-highlighted")).toBe("true");
  await user.click(screen.getByRole("button", { name: "Clear highlight" }));
  expect(reason.hasAttribute("data-highlighted")).toBe(false);
  await user.click(reason);
  await user.keyboard("{Escape}");
  await user.unhover(reason);
  expect(reason.getAttribute("aria-pressed")).toBe("false");
  expect(prompts().getAllByRole("button").every((toggle) => !toggle.hasAttribute("data-highlighted"))).toBe(true);
});

test("live updates retain an explicit prompt selection without enabling new prompts", async () => {
  const user = userEvent.setup();
  const { rerender } = render(<ReasonMap events={events} selectedSession="" sessions={[]} />);
  await user.click(prompts().getAllByRole("button")[0]);
  const next = access(4, "c4", ["new.ts"], "Review the new file.", "p4");
  rerender(<ReasonMap events={[...events, next]} selectedSession="" sessions={[]} />);
  expect(prompts().getAllByRole("button").map((toggle) => toggle.getAttribute("aria-pressed"))).toEqual(["true", "false", "false", "false"]);
  expect(map().getByText("src/main.tsx")).toBeTruthy();
  expect(map().queryByRole("button", { name: "Review the new file." })).toBeNull();
});

test("new prompts stay enabled while the initial all-prompts selection is unchanged", () => {
  const { rerender } = render(<ReasonMap events={events} selectedSession="" sessions={[]} />);
  const next = access(4, "c4", ["new.ts"], "Review the new file.", "p4");
  rerender(<ReasonMap events={[...events, next]} selectedSession="" sessions={[]} />);
  expect(prompts().getAllByRole("button").every((toggle) => toggle.getAttribute("aria-pressed") === "true")).toBe(true);
  expect(map().getByRole("button", { name: "Review the new file." })).toBeTruthy();
});

test("late assessments update reasons and prompt associations without mixing sessions", async () => {
  const user = userEvent.setup();
  const first = access(1, "same-call", ["src/App.tsx"], null);
  const other = access(2, "same-call", ["other.ts"], "Unrelated session reason.", "p1", "s2");
  const { rerender } = render(<ReasonMap events={[first, other]} selectedSession="s1" sessions={[]} />);
  expect(map().getByRole("button", { name: "No recorded reason" })).toBeTruthy();
  const assessment = {
    ...first, id: 3, activityUpdates: undefined,
    event: { ...first.event, tag: "balrog.tool.assessed", pluginID: "balrog-retro" } as unknown as LogEvent,
    execution: { ...first.execution!, reason: explanation },
  };
  rerender(<ReasonMap events={[first, other, assessment]} selectedSession="s1" sessions={[]} />);
  const reason = map().getByRole("button", { name: "Understand the routing." });
  expect(reason.title).toBe(explanation);
  expect(map().queryByRole("button", { name: "No recorded reason" })).toBeNull();
  expect(screen.queryByText("Unrelated session reason.")).toBeNull();
  expect(prompts().getAllByRole("button")).toHaveLength(1);
  await user.hover(reason);
  expect(prompts().getByRole("button").getAttribute("data-highlighted")).toBe("true");
});

test("an unassessed later read of the same file does not erase the submitted reason for an earlier call", () => {
  const first = access(1, "read-original", ["README.md"], null, "p1");
  const review = access(2, "read-review", ["README.md"], null, "p2");
  const assessment = {
    ...first, id: 3, activityUpdates: undefined,
    event: { ...first.event, tag: "balrog.tool.assessed", pluginID: "balrog-retro" } as unknown as LogEvent,
    execution: { ...first.execution!, reason: explanation },
  };
  const { rerender } = render(<ReasonMap events={[first, review, assessment]} selectedSession="" sessions={[]} />);
  expect(map().getByRole("button", { name: "Understand the routing." }).title).toBe(explanation);
  expect(map().getByRole("button", { name: "No recorded reason" })).toBeTruthy();
  rerender(<ReasonMap events={[first, review, assessment, { ...review, id: 4, activityUpdates: undefined }]} selectedSession="" sessions={[]} />);
  expect(map().getByRole("button", { name: "Understand the routing." }).title).toBe(explanation);
  expect(map().getByRole("button", { name: "No recorded reason" })).toBeTruthy();
});
