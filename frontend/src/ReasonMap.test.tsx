import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test } from "vitest";
import type { LogEvent } from "../../server/log-receiver";
import { ReasonMap } from "./ReasonMap";
import type { ReceivedEvent } from "./useViewer";
import { createActivityUpdates } from "../../tests/activity-fixtures";

afterEach(cleanup);

function access(id: number, callID: string, paths: string[], reason: string | null, prompt = "p1", sessionID = "s1", workspaceRoot?: string): ReceivedEvent {
  const activityUpdates = createActivityUpdates()(id, { id: prompt, sessionID, text: `Task ${prompt}`, files: paths.map((path) => ({ path, action: "read", outcome: "success", callID })) });
  return {
    id, receivedAt: id,
    event: { tag: "session.tool.called", sessionID, pluginID: "test" } as unknown as LogEvent,
    activityUpdates: { ...activityUpdates, items: activityUpdates.items.map((item) => ({ ...item, workspaceRoot })) },
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
const fileHeaders = () => map().queryAllByRole("rowheader").filter((header) => header.getAttribute("scope") === "row");
const filePaths = () => fileHeaders().map((header) => header.getAttribute("aria-label")).sort();

test("uses Activity map workspace groups for reads, changes and grep matches", async () => {
  const user = userEvent.setup();
  const change = access(3, "change", ["src/features/app.ts"], "Update the implementation.");
  change.activityUpdates!.items = change.activityUpdates!.items.map((item) => item.kind === "file.read"
    ? { ...item, kind: "file.change", action: "modified" } : item);
  const grep = access(4, "grep", ["src/matched.ts"], "Find the implementation.");
  grep.activityUpdates!.items = grep.activityUpdates!.items.map((item) => {
    if (item.kind !== "file.read") return item;
    const { path, ...operation } = item;
    return { ...operation, kind: "file.grep", pattern: "needle", matchedFiles: [path] };
  });
  render(<ReasonMap events={[
    access(1, "outside", ["/etc/agent.conf", "../shared/helper.ts"], "Read external guidance.", "p1", "s1", "/workspace"),
    access(2, "inside", ["src/main.ts", "README.md"], explanation),
    change, grep,
    access(5, "unknown", ["/etc/unknown.conf"], "Read additional guidance."),
  ]} selectedSession="" sessions={[]} />);
  const groups = map().getAllByRole("rowgroup").filter((group) => group.tagName === "TBODY");
  expect(groups.map((group) => group.getAttribute("aria-label"))).toEqual(["Outside workspace", "In workspace", "Workspace unknown"]);
  const outside = within(groups[0]);
  const inside = within(groups[1]);
  const unknown = within(groups[2]);
  expect(outside.getByText("2 files")).toBeTruthy();
  expect(inside.getByText("4 files")).toBeTruthy();
  expect(unknown.getByText("1 file")).toBeTruthy();
  expect(outside.getByTitle("/etc").textContent).toBe("/etc/1");
  expect(outside.getByTitle("../shared").textContent).toBe("../shared/1");
  expect(inside.getByTitle("src/features").textContent).toBe("features/1");
  expect(inside.getByRole("rowheader", { name: "src/features/app.ts" }).textContent).toBe("app.ts");
  expect(inside.getByRole("rowheader", { name: "src/matched.ts" })).toBeTruthy();
  expect(unknown.getByRole("rowheader", { name: "/etc/unknown.conf" })).toBeTruthy();
  await user.click(outside.getByTitle("/etc"));
  expect(outside.queryByRole("rowheader", { name: "/etc/agent.conf" })).toBeNull();
  expect(unknown.getByRole("rowheader", { name: "/etc/unknown.conf" })).toBeTruthy();
});

test("workspace folders collapse by keyboard and retain nested state and counts through live updates", async () => {
  const user = userEvent.setup();
  const initial = [access(1, "tree", ["README.md", "src/other.ts", "src/features/app.ts", "src/features/nested/deep.ts"], explanation)];
  const { rerender } = render(<ReasonMap events={initial} selectedSession="" sessions={[]} />);
  const tree = within(map().getByRole("rowgroup", { name: "In workspace" }));
  expect(fileHeaders().map((header) => header.getAttribute("aria-label"))).toEqual(["src/features/nested/deep.ts", "src/features/app.ts", "src/other.ts", "README.md"]);
  expect(tree.getByTitle("src/features").closest("tr")?.style.getPropertyValue("--tree-depth")).toBe("1");
  expect(tree.getByRole("rowheader", { name: "src/features/nested/deep.ts" }).closest("tr")?.style.getPropertyValue("--tree-depth")).toBe("3");
  const reason = within(tree.getByRole("rowheader", { name: "src/features/app.ts" }).closest("tr")!).getByRole("button");
  await user.hover(reason);
  expect(screen.getByRole("tooltip")).toBeTruthy();
  act(() => tree.getByTitle("src/features").focus());
  await user.keyboard("{Enter}");
  expect(tree.getByTitle("src/features").getAttribute("aria-expanded")).toBe("false");
  expect(tree.queryByRole("rowheader", { name: "src/features/app.ts" })).toBeNull();
  expect(tree.queryByTitle("src/features/nested")).toBeNull();
  expect(screen.queryByRole("tooltip")).toBeNull();
  const next = access(2, "new", ["src/features/new.ts"], "Review the new file.");
  rerender(<ReasonMap events={[...initial, next]} selectedSession="" sessions={[]} />);
  expect(tree.getByTitle("src/features").textContent).toBe("features/3");
  expect(tree.queryByRole("rowheader", { name: "src/features/new.ts" })).toBeNull();
  await user.click(tree.getByTitle("src"));
  expect(tree.queryByTitle("src/features")).toBeNull();
  expect(tree.getByRole("rowheader", { name: "README.md" })).toBeTruthy();
  await user.keyboard(" ");
  expect(tree.getByTitle("src/features").getAttribute("aria-expanded")).toBe("false");
  await user.click(tree.getByTitle("src/features"));
  expect(tree.getByRole("rowheader", { name: "src/features/new.ts" })).toBeTruthy();
  expect(tree.getByRole("rowheader", { name: "src/features/nested/deep.ts" })).toBeTruthy();
});

test("search filters workspace groups and counts without losing folder collapse or prompt selection", async () => {
  const user = userEvent.setup();
  render(<ReasonMap events={[
    access(1, "inside", ["src/feature/app.ts", "src/main.ts"], explanation),
    access(2, "outside", ["../shared/helper.ts"], "Read external guidance.", "p2"),
  ]} selectedSession="" sessions={[]} />);
  await user.click(map().getByTitle("src/feature"));
  const search = screen.getByRole("searchbox", { name: "Find a file" });
  await user.type(search, "src/main");
  expect(map().queryByRole("rowgroup", { name: "Outside workspace" })).toBeNull();
  expect(within(map().getByRole("rowgroup", { name: "In workspace" })).getByText("1 file")).toBeTruthy();
  expect(filePaths()).toEqual(["src/main.ts"]);
  expect(prompts().getAllByRole("button").map((button) => button.getAttribute("aria-pressed"))).toEqual(["true", "true"]);
  await user.clear(search);
  expect(map().getByTitle("src/feature").getAttribute("aria-expanded")).toBe("false");
  expect(map().queryByRole("rowheader", { name: "src/feature/app.ts" })).toBeNull();
  expect(map().getByRole("rowgroup", { name: "Outside workspace" })).toBeTruthy();
  await user.type(search, "missing");
  expect(map().queryByRole("rowgroup", { name: "In workspace" })).toBeNull();
  expect(screen.getByText("No matching files.")).toBeTruthy();
});

test("workspace conflicts are unknown until prompt or session selection resolves them", async () => {
  const user = userEvent.setup();
  const mixed = [
    access(1, "outside", ["/shared/file.ts"], "Use shared guidance.", "p1", "s1", "/project"),
    access(2, "inside", ["/shared/file.ts"], "Inspect the workspace.", "p2", "s2", "/shared"),
  ];
  const { rerender } = render(<ReasonMap events={mixed} selectedSession="" sessions={[]} />);
  expect(within(map().getByRole("rowgroup", { name: "Workspace unknown" })).getByRole("rowheader", { name: "/shared/file.ts" })).toBeTruthy();
  await user.click(prompts().getAllByRole("button")[0]);
  expect(map().getByRole("rowgroup", { name: "Outside workspace" })).toBeTruthy();
  expect(map().queryByRole("rowgroup", { name: "Workspace unknown" })).toBeNull();
  await user.click(prompts().getAllByRole("button")[1]);
  expect(map().getByRole("rowgroup", { name: "In workspace" })).toBeTruthy();
  expect(map().queryByRole("rowgroup", { name: "Outside workspace" })).toBeNull();
  rerender(<ReasonMap key="s1" events={mixed} selectedSession="s1" sessions={[]} />);
  expect(map().getByRole("rowgroup", { name: "Outside workspace" })).toBeTruthy();
  expect(map().queryByRole("rowgroup", { name: "Workspace unknown" })).toBeNull();
});

test.each([
  { label: "empty", events: [] },
  { label: "populated", events },
])("describes the reasons view above the $label table", ({ events }) => {
  render(<ReasonMap events={events} selectedSession="" sessions={[]} />);
  const description = screen.getByText("Shows recorded reasons for accessing each file across the selected prompts.");
  expect(description.tagName).toBe("P");
  expect(description.compareDocumentPosition(screen.getByRole("table")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});

test("combines reasons per file and shows prompt text below without an explanations table", () => {
  render(<ReasonMap events={events} selectedSession="" sessions={[]} />);
  expect(map().getAllByRole("columnheader").map((header) => header.textContent)).toEqual(["File", "Reasons"]);
  expect(filePaths()).toEqual(["README.md", "src/App.tsx", "src/main.tsx"]);
  expect(map().getAllByRole("button", { name: "Understand the routing." })).toHaveLength(2);
  expect(map().getByRole("button", { name: "No recorded reason" })).toBeTruthy();
  expect(screen.queryByRole("table", { name: "Reason explanations" })).toBeNull();
  expect(prompts().getAllByRole("button").map((button) => button.textContent)).toEqual(["Prompt 01Task p1", "Prompt 02Task p2", "Prompt 03Task p3"]);
  expect(screen.getByRole("table").compareDocumentPosition(screen.getByRole("group", { name: "Prompts" })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});

test("reason tooltips show bold Outcome and Id labels with the real call ID below the outcome", async () => {
  const user = userEvent.setup();
  const assessed = { ...events[0], execution: { ...events[0].execution!, outcome: "The frontend routes requests in App.tsx." } };
  render(<ReasonMap events={[assessed]} selectedSession="" sessions={[]} />);
  const reason = within(map().getByRole("rowheader", { name: "src/App.tsx" }).closest("tr")!).getByRole("button");
  await user.hover(reason);
  const tooltip = within(screen.getByRole("tooltip"));
  expect(tooltip.getByText(explanation)).toBeTruthy();
  expect(tooltip.getByText("The frontend routes requests in App.tsx.")).toBeTruthy();
  expect(tooltip.getByText("Outcome").tagName).toBe("STRONG");
  expect(tooltip.getByText("Id").tagName).toBe("STRONG");
  expect(tooltip.getByText("c1")).toBeTruthy();
  expect(tooltip.getByText("Outcome").compareDocumentPosition(tooltip.getByText("Id")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(reason.getAttribute("aria-describedby")).toBe(screen.getByRole("tooltip").id);
  await user.unhover(reason);
  await waitFor(() => expect(screen.queryByRole("tooltip")).toBeNull());
  expect(map().getAllByRole("columnheader").map((header) => header.textContent)).toEqual(["File", "Reasons"]);
});

test("shared reasons combine distinct outcomes only for the file and selected prompts", async () => {
  const user = userEvent.setup();
  const completed = (event: ReceivedEvent, outcome: string): ReceivedEvent => ({ ...event, execution: { ...event.execution!, outcome } });
  render(<ReasonMap events={[
    completed(access(1, "c1", ["app.ts"], explanation), "Found the route."),
    completed(access(2, "c2", ["other.ts"], explanation), "Found another file."),
    completed(access(3, "c3", ["app.ts"], explanation, "p2"), "Verified the route."),
    completed(access(4, "c4", ["app.ts"], explanation, "p2"), "Verified the route."),
  ]} selectedSession="" sessions={[]} />);
  const reasonFor = (path: string) => within(map().getByRole("rowheader", { name: path }).closest("tr")!).getByRole("button");
  await user.hover(reasonFor("app.ts"));
  expect(within(screen.getByRole("tooltip")).getByText("Found the route.")).toBeTruthy();
  expect(within(screen.getByRole("tooltip")).getAllByText("Verified the route.")).toHaveLength(1);
  expect(within(screen.getByRole("tooltip")).getByText("c1, c3, c4")).toBeTruthy();
  await user.hover(reasonFor("other.ts"));
  expect(within(screen.getByRole("tooltip")).getByText("Found another file.")).toBeTruthy();
  expect(within(screen.getByRole("tooltip")).getByText("c2")).toBeTruthy();
  expect(within(screen.getByRole("tooltip")).queryByText("Found the route.")).toBeNull();
  await user.click(prompts().getAllByRole("button")[0]);
  await user.hover(reasonFor("app.ts"));
  expect(within(screen.getByRole("tooltip")).getByText("c1")).toBeTruthy();
  expect(within(screen.getByRole("tooltip")).queryByText("Verified the route.")).toBeNull();
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
  await waitFor(() => expect(toggles.every((toggle) => !toggle.hasAttribute("data-highlighted"))).toBe(true));
  await user.hover(map().getByRole("button", { name: "No recorded reason" }));
  expect(toggles.map((toggle) => toggle.getAttribute("data-highlighted"))).toEqual([null, null, "true"]);
});

test("clicking a prompt selects only that prompt and clicking it again keeps it selected", async () => {
  const user = userEvent.setup();
  render(<ReasonMap events={events} selectedSession="" sessions={[]} />);
  const toggles = prompts().getAllByRole("button");
  await user.click(toggles[1]);
  expect(toggles.map((toggle) => toggle.getAttribute("aria-pressed"))).toEqual(["false", "true", "false"]);
  expect(filePaths()).toEqual(["src/App.tsx"]);
  await user.click(toggles[1]);
  expect(toggles.map((toggle) => toggle.getAttribute("aria-pressed"))).toEqual(["false", "true", "false"]);
  await user.click(toggles[2]);
  expect(toggles.map((toggle) => toggle.getAttribute("aria-pressed"))).toEqual(["false", "false", "true"]);
  expect(filePaths()).toEqual(["README.md"]);
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
  expect(filePaths()).toEqual(["README.md"]);
  await user.click(toggles[2]);
  expect(screen.getByText("No prompts selected.")).toBeTruthy();
  expect(fileHeaders()).toHaveLength(0);
  expect(prompts().getAllByRole("button")).toHaveLength(3);
  await user.keyboard("{/Shift}");
  await user.click(toggles[0]);
  expect(filePaths()).toEqual(["src/App.tsx", "src/main.tsx"]);
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
  expect(filePaths()).toEqual(["README.md", "src/App.tsx"]);
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
  expect(filePaths()).toEqual(["src/App.tsx"]);
  expect(prompts().getAllByRole("button")).toHaveLength(3);
  await user.type(search, "missing");
  expect(screen.getByText("No matching files.")).toBeTruthy();
  await user.keyboard("{Escape}");
  expect(fileHeaders()).toHaveLength(3);
});

test("keyboard focus previews a reason and clicking pins both file and prompt highlights", async () => {
  const user = userEvent.setup();
  render(<ReasonMap events={events} selectedSession="" sessions={[]} />);
  const reason = map().getByRole("button", { name: "No recorded reason" });
  act(() => reason.focus());
  expect(document.activeElement).toBe(reason);
  expect(within(screen.getByRole("tooltip")).getByText("c3")).toBeTruthy();
  expect(within(screen.getByRole("tooltip")).getByText("No recorded outcome.")).toBeTruthy();
  expect(prompts().getAllByRole("button")[2].getAttribute("data-highlighted")).toBe("true");
  await user.keyboard("{Enter}{Tab}");
  expect(reason.getAttribute("aria-pressed")).toBe("true");
  expect(reason.getAttribute("data-highlighted")).toBe("true");
  await user.click(screen.getByRole("button", { name: "Clear highlight" }));
  expect(reason.hasAttribute("data-highlighted")).toBe(false);
  await user.click(reason);
  await user.keyboard("{Escape}");
  await user.unhover(reason);
  expect(screen.queryByRole("tooltip")).toBeNull();
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
  expect(map().getByRole("rowheader", { name: "src/main.tsx" })).toBeTruthy();
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
    execution: { ...first.execution!, reason: explanation, outcome: "Located the frontend routes." },
  };
  rerender(<ReasonMap events={[first, other, assessment]} selectedSession="s1" sessions={[]} />);
  const reason = map().getByRole("button", { name: "Understand the routing." });
  expect(map().queryByRole("button", { name: "No recorded reason" })).toBeNull();
  expect(screen.queryByText("Unrelated session reason.")).toBeNull();
  expect(prompts().getAllByRole("button")).toHaveLength(1);
  await user.hover(reason);
  expect(within(screen.getByRole("tooltip")).getByText("Located the frontend routes.")).toBeTruthy();
  expect(within(screen.getByRole("tooltip")).getByText("same-call")).toBeTruthy();
  expect(prompts().getByRole("button").getAttribute("data-highlighted")).toBe("true");
});

test("an unassessed later read of the same file does not erase the submitted reason for an earlier call", async () => {
  const user = userEvent.setup();
  const first = access(1, "read-original", ["README.md"], null, "p1");
  const review = access(2, "read-review", ["README.md"], null, "p2");
  const assessment = {
    ...first, id: 3, activityUpdates: undefined,
    event: { ...first.event, tag: "balrog.tool.assessed", pluginID: "balrog-retro" } as unknown as LogEvent,
    execution: { ...first.execution!, reason: explanation },
  };
  const { rerender } = render(<ReasonMap events={[first, review, assessment]} selectedSession="" sessions={[]} />);
  await user.hover(map().getByRole("button", { name: "Understand the routing." }));
  expect(within(screen.getByRole("tooltip")).getByText(explanation)).toBeTruthy();
  expect(map().getByRole("button", { name: "No recorded reason" })).toBeTruthy();
  rerender(<ReasonMap events={[first, review, assessment, { ...review, id: 4, activityUpdates: undefined }]} selectedSession="" sessions={[]} />);
  expect(within(screen.getByRole("tooltip")).getByText(explanation)).toBeTruthy();
  expect(map().getByRole("button", { name: "No recorded reason" })).toBeTruthy();
});
