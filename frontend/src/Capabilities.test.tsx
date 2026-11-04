import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test } from "vitest";
import type { ToolExecution } from "../../server/analyzer";
import type { LogEvent } from "../../server/log-receiver";
import type { ViewerMessage } from "../../shared/viewer-protocol";
import { Capabilities } from "./Capabilities";
import { createActivityUpdates } from "../../tests/activity-fixtures";

afterEach(cleanup);

function message(id: number, tag: string, execution: ToolExecution, data: Record<string, unknown> = {}, sessionID = "s1"): ViewerMessage {
  return {
    id, execution,
    event: { tag, sessionID, pluginID: "test", [tag]: { event: { type: tag, data: { sessionID, id: execution.callID, ...data } } } } as unknown as LogEvent,
  };
}

const execution = (overrides: Partial<ToolExecution> = {}): ToolExecution => ({
  callID: "c1", command: { name: "shell", args: { command: "dotnet tests .", description: "Run tests" } },
  reason: null, outcome: null, startedAt: 1, completedAt: 2, result: "Tests passed.", ...overrides,
});
const table = () => within(screen.getByRole("table", { name: "Attempted capabilities" }));

test("the same technical operation keeps its capability when the reason changes", () => {
  const command = { name: "read", args: { path: "README.md", description: "Find lifecycle documentation" } };
  render(<Capabilities events={[
    message(1, "session.tool.success", execution({ command, reason: "Find lifecycle documentation" })),
    message(2, "session.tool.success", execution({ command, callID: "c2", reason: "Verify the deployment configuration" })),
  ]} selectedSession="" sessions={[]} />);
  expect(table().getAllByRole("columnheader").map((header) => header.textContent)).toEqual(["Capability", "Tool call", "Result"]);
  expect(table().getAllByRole("rowheader").map((header) => header.textContent)).toEqual(["Read file"]);
  expect(within(table().getByRole("rowgroup", { name: "Read file" })).getAllByRole("row")).toHaveLength(2);
  expect(table().queryByText("Find lifecycle documentation")).toBeNull();
  expect(table().queryByText("Verify the deployment configuration")).toBeNull();
});

test("retro capability labels stay separate from different reasons for the same shell call", () => {
  const command = { name: "shell", args: { command: "kubectl --context prod get deployment api" } };
  const capability = "Get status from production Kubernetes deployment";
  render(<Capabilities events={[
    message(1, "session.tool.success", execution({ command, capability, reason: "Find lifecycle management details" })),
    message(2, "session.tool.success", execution({ command, capability, callID: "c2", reason: "Verify the rollout" })),
  ]} selectedSession="" sessions={[]} />);
  expect(table().getAllByRole("rowheader").map((header) => header.textContent)).toEqual([capability]);
  expect(within(table().getByRole("rowgroup", { name: capability })).getAllByRole("row")).toHaveLength(2);
  expect(table().queryByText("Find lifecycle management details")).toBeNull();
  expect(table().queryByText("Verify the rollout")).toBeNull();
});

test("unsupported tools do not turn their reasons or descriptions into capability labels", () => {
  render(<Capabilities events={[message(1, "session.tool.success", execution({
    command: { name: "custom", args: { description: "Find lifecycle documentation", rationale: "Verify the rollout" } },
    reason: "Read the deployment documentation", outcome: "Documentation found",
  }))]} selectedSession="" sessions={[]} />);
  expect(table().getByRole("rowheader", { name: "Unknown capability" })).toBeTruthy();
});

test("groups invocations by capability, with failing groups and failing invocations first", () => {
  render(<Capabilities events={[
    message(1, "session.tool.success", execution({ capability: "Run tests", command: { name: "shell", args: { command: "tests-pass" } } })),
    message(2, "session.tool.success", execution({ callID: "read", capability: "Read file", command: { name: "read", args: { path: "README.md" } } })),
    message(3, "session.tool.failed", execution({ callID: "failed", capability: "Run tests", command: { name: "shell", args: { command: "tests-fail" } }, result: { error: "No projects found" } })),
    message(4, "session.tool.failed", execution({ callID: "deploy", capability: "Get deployment status", command: { name: "shell", args: { command: "me deployment status" } }, result: { error: "me not found" } })),
  ]} selectedSession="" sessions={[]} />);
  expect(table().getAllByRole("rowheader").map((header) => header.textContent)).toEqual(["Run tests", "Get deployment status", "Read file"]);
  const invocations = within(table().getByRole("rowgroup", { name: "Run tests" })).getAllByRole("row");
  expect(invocations.map((row) => row.querySelector("code")?.textContent)).toEqual(["tests-fail", "tests-pass"]);
  expect(invocations.map((row) => within(row).getAllByRole("cell").at(-1)?.textContent)).toEqual(["error: No projects found", "ok"]);
  expect(table().getByRole("rowheader", { name: "Run tests" }).getAttribute("rowspan")).toBe("2");
});

test("live failures move their capability group to the top and prompt filtering removes the whole group", async () => {
  const user = userEvent.setup();
  const first = { ...message(1, "session.tool.success", execution({ capability: "Read file" })),
    activityUpdates: createActivityUpdates()(1, { id: "p1", sessionID: "s1", text: "Read project guidance", files: [] }) };
  const pending = { ...message(2, "session.tool.called", execution({ callID: "tests", capability: "Run tests", completedAt: null, result: null })),
    activityUpdates: createActivityUpdates()(2, { id: "p2", sessionID: "s1", text: "Verify the change", files: [] }) };
  const { rerender } = render(<Capabilities events={[first, pending]} selectedSession="" sessions={[]} />);
  expect(table().getAllByRole("rowheader").map((header) => header.textContent)).toEqual(["Read file", "Run tests"]);
  const failed = message(3, "session.tool.failed", { ...pending.execution!, completedAt: 3, result: { error: "Test runner missing" } });
  rerender(<Capabilities events={[first, pending, failed]} selectedSession="" sessions={[]} />);
  expect(table().getAllByRole("rowheader").map((header) => header.textContent)).toEqual(["Run tests", "Read file"]);
  await user.click(within(screen.getByRole("group", { name: "Prompts" })).getByRole("button", { name: /Read project guidance/ }));
  expect(table().getAllByRole("rowheader").map((header) => header.textContent)).toEqual(["Read file"]);
  expect(table().queryByText("error: Test runner missing")).toBeNull();
});

test("keyboard prompt selection matches clicking and explicit selections hide unattributed calls", async () => {
  const user = userEvent.setup();
  const first = { ...message(1, "session.tool.success", execution({ capability: "Read file" })),
    activityUpdates: createActivityUpdates()(1, { id: "p1", sessionID: "s1", text: "First prompt", files: [] }) };
  const second = { ...message(2, "session.tool.success", execution({ callID: "tests", capability: "Run tests" })),
    activityUpdates: createActivityUpdates()(2, { id: "p2", sessionID: "s1", text: "Second prompt", files: [] }) };
  const unattributed = message(3, "session.tool.success", execution({ callID: "unknown", capability: "Find files" }));
  render(<Capabilities events={[first, second, unattributed]} selectedSession="" sessions={[]} />);
  expect(table().getByRole("rowheader", { name: "Find files" })).toBeTruthy();
  const toggles = within(screen.getByRole("group", { name: "Prompts" })).getAllByRole("button");
  await user.click(toggles[0]);
  expect(table().queryByRole("rowheader", { name: "Find files" })).toBeNull();
  await user.tab();
  await user.keyboard("{Shift>}{Enter}{/Shift}");
  expect(toggles.map((button) => button.getAttribute("aria-pressed"))).toEqual(["true", "true"]);
  await user.keyboard("{Enter}");
  expect(toggles.map((button) => button.getAttribute("aria-pressed"))).toEqual(["false", "true"]);
  expect(table().getAllByRole("rowheader").map((header) => header.textContent)).toEqual(["Run tests"]);
});

test("prompt clicks select only one prompt and Shift-click toggles within the selection", async () => {
  const user = userEvent.setup();
  const messages = ["p1", "p2", "p3"].map((id, index) => ({
    ...message(index + 1, "session.tool.success", execution({ callID: id, command: { name: "shell", args: { command: `command-${id}` } } })),
    activityUpdates: createActivityUpdates()(index + 1, { id, sessionID: "s1", text: `Prompt text ${id}`, files: [] }),
  }));
  render(<Capabilities events={messages} selectedSession="" sessions={[]} />);
  const toggles = within(screen.getByRole("group", { name: "Prompts" })).getAllByRole("button");
  await user.click(toggles[1]);
  expect(toggles.map((button) => button.getAttribute("aria-pressed"))).toEqual(["false", "true", "false"]);
  expect(table().getByText("command-p2")).toBeTruthy();
  expect(table().queryByText("command-p1")).toBeNull();
  await user.keyboard("{Shift>}");
  await user.click(toggles[2]);
  await user.keyboard("{/Shift}");
  expect(toggles.map((button) => button.getAttribute("aria-pressed"))).toEqual(["false", "true", "true"]);
  expect(table().getByText("command-p3")).toBeTruthy();
  await user.click(toggles[0]);
  expect(toggles.map((button) => button.getAttribute("aria-pressed"))).toEqual(["true", "false", "false"]);
});

test("prompt filters include non-file calls and retain choices through late assessments", async () => {
  const user = userEvent.setup();
  const first = { ...message(1, "session.tool.success", execution({ capability: "Run tests", reason: "Verify the fix" })),
    activityUpdates: createActivityUpdates()(1, { id: "p1", sessionID: "s1", text: "Run the first command", files: [] }) };
  const second = { ...message(2, "session.tool.success", execution({ callID: "c2", capability: "Build project", reason: "Verify compilation" })),
    activityUpdates: createActivityUpdates()(2, { id: "p2", sessionID: "s1", text: "Run the second command", files: [] }) };
  const { rerender } = render(<Capabilities events={[first, second]} selectedSession="" sessions={[]} />);
  const prompts = () => within(screen.getByRole("group", { name: "Prompts" }));
  await user.keyboard("{Shift>}");
  await user.click(prompts().getByRole("button", { name: /Run the first command/ }));
  expect(table().queryByText("Run tests")).toBeNull();
  expect(table().getByText("Build project")).toBeTruthy();
  const assessed = message(3, "balrog.tool.assessed", execution({ capability: "Run tests", reason: "Assessed first task" }));
  rerender(<Capabilities events={[first, second, assessed]} selectedSession="" sessions={[]} />);
  expect(table().queryByText("Run tests")).toBeNull();
  await user.click(prompts().getByRole("button", { name: /Run the second command/ }));
  expect(screen.getByText("No prompts selected.")).toBeTruthy();
  await user.keyboard("{/Shift}");
  await user.click(prompts().getByRole("button", { name: /Run the first command/ }));
  expect(table().getByText("Run tests")).toBeTruthy();
  expect(table().queryByText("Build project")).toBeNull();
});

test("prompt choices stay independent across sessions without new live prompts changing an explicit selection", async () => {
  const user = userEvent.setup();
  const first = { ...message(1, "session.tool.success", execution({ capability: "Run tests", reason: "First session task" })),
    activityUpdates: createActivityUpdates()(1, { id: "p1", sessionID: "s1", text: "First session prompt", files: [] }) };
  const other = { ...message(2, "session.tool.success", execution({ capability: "Build project", reason: "Second session task" }), {}, "s2"),
    activityUpdates: createActivityUpdates()(2, { id: "p1", sessionID: "s2", text: "Second session prompt", files: [] }) };
  const { rerender } = render(<Capabilities events={[first, other]} selectedSession="" sessions={[]} />);
  const prompts = () => within(screen.getByRole("group", { name: "Prompts" }));
  await user.keyboard("{Shift>}");
  await user.click(prompts().getByRole("button", { name: /First session prompt/ }));
  await user.keyboard("{/Shift}");
  expect(table().queryByText("Run tests")).toBeNull();
  expect(table().getByText("Build project")).toBeTruthy();
  const live = { ...message(3, "session.tool.called", execution({ callID: "c3", capability: "Run linter", reason: "Live task", completedAt: null })),
    activityUpdates: createActivityUpdates()(3, { id: "p2", sessionID: "s1", text: "New live prompt", files: [] }) };
  rerender(<Capabilities events={[first, other, live]} selectedSession="" sessions={[]} />);
  expect(prompts().getAllByRole("button").map((button) => button.getAttribute("aria-pressed"))).toEqual(["false", "true", "false"]);
  expect(table().queryByText("Run linter")).toBeNull();
  expect(table().queryByText("Pending")).toBeNull();
  expect(table().queryByText("Run tests")).toBeNull();
});

test("shows technical capabilities separately from reasons and descriptions", () => {
  render(<Capabilities events={[
    message(1, "session.tool.success", execution()),
    message(2, "session.tool.failed", execution({
      callID: "c2", command: { name: "shell", args: { command: "me deploydment status" } },
      capability: "Get status from production Kubernetes deployment", reason: "Verify the rollout", result: { error: { message: "me not found" }, content: null },
    }), { error: { message: "me not found" } }),
  ]} selectedSession="" sessions={[]} />);
  expect(table().getAllByRole("columnheader").map((header) => header.textContent)).toEqual(["Capability", "Tool call", "Result"]);
  const rows = table().getAllByRole("row").slice(1);
  expect(rows.map((row) => [within(row).getByRole("rowheader").textContent, ...within(row).getAllByRole("cell").map((cell) => cell.textContent)])).toEqual([
    ["Get status from production Kubernetes deployment", "me deploydment status", "error: me not found"],
    ["Run shell command", "dotnet tests .", "ok"],
  ]);
});

test.each([
  ["native exit metadata", { metadata: { exit: 1 }, content: [{ type: "text", text: "error: no projects found" }] }, "error: no projects found"],
  ["structured shell result", { result: { exitCode: 127, stderr: "me not found" } }, "error: me not found"],
  ["text exit marker", { content: [{ type: "text", text: "no projects found\nProcess exited with code 1" }] }, "error: no projects found\nProcess exited with code 1"],
  ["separate exit marker", { content: [{ type: "text", text: "me not found" }, { type: "text", text: "Exited with code 127" }] }, "error: me not found\nExited with code 127"],
  ["MCP error flag", { result: { isError: true, content: [{ type: "text", text: "Service unavailable" }] } }, "error: Service unavailable"],
  ["missing error output", { metadata: { exit_code: 3 } }, "error: Command exited with code 3"],
])("shows command failures despite a successful tool event: %s", (_name, data, expected) => {
  render(<Capabilities events={[message(1, "session.tool.success", execution({ result: null }), data)]} selectedSession="" sessions={[]} />);
  expect(table().getAllByRole("cell").at(-1)?.textContent).toBe(expected);
});

test("successful results containing the word error are not treated as failures", () => {
  render(<Capabilities events={[message(1, "session.tool.success", execution({ result: "0 errors. Tests passed." }), {
    metadata: { exit: 0 }, content: [{ type: "text", text: "0 errors. Tests passed." }],
  })]} selectedSession="" sessions={[]} />);
  expect(table().getAllByRole("cell").at(-1)?.textContent).toBe("ok");
});

test("reading text about command failures does not make the read fail", () => {
  render(<Capabilities events={[message(1, "session.tool.success", execution({
    command: { name: "read", args: { path: "troubleshooting.md" } }, result: "Process exited with code 1",
  }), { content: [{ type: "text", text: "Process exited with code 1" }] })]} selectedSession="" sessions={[]} />);
  expect(table().getAllByRole("cell").at(-1)?.textContent).toBe("ok");
});

test("live completions and retro capabilities update one row while retaining recorded command errors", () => {
  const pending = execution({ completedAt: null, result: null });
  const start = message(1, "session.tool.called", pending);
  const { rerender } = render(<Capabilities events={[start]} selectedSession="" sessions={[]} />);
  expect(table().getByText("Pending")).toBeTruthy();
  const completed = execution({ result: "no projects found" });
  const end = message(2, "session.tool.success", completed, { metadata: { exit: 1 }, content: "no projects found" });
  rerender(<Capabilities events={[start, end]} selectedSession="" sessions={[]} />);
  expect(table().getByText("error: no projects found")).toBeTruthy();
  const assessed = message(3, "balrog.tool.assessed", { ...completed, capability: "Run .NET tests", reason: "Verify the solution", outcome: "No project was found." });
  assessed.event.pluginID = "balrog-retro";
  rerender(<Capabilities events={[start, end, assessed]} selectedSession="" sessions={[]} />);
  expect(table().getAllByRole("row")).toHaveLength(2);
  expect(table().getByText("Run .NET tests")).toBeTruthy();
  expect(table().getByText("error: no projects found")).toBeTruthy();
});

test("session filters isolate identical call IDs and retain distinct attempts at the same capability", () => {
  const messages = [
    message(1, "session.tool.success", execution(), {}, "s1"),
    message(2, "session.tool.success", execution({ capability: "Build project", reason: "Other session task" }), {}, "s2"),
    message(3, "session.tool.success", execution({ callID: "c2", startedAt: 3 }), {}, "s1"),
  ];
  const { rerender } = render(<Capabilities events={messages} selectedSession="s1" sessions={[]} />);
  expect(table().getAllByRole("row")).toHaveLength(3);
  expect(table().queryByText("Build project")).toBeNull();
  rerender(<Capabilities events={messages} selectedSession="" sessions={[]} />);
  expect(table().getAllByRole("row")).toHaveLength(4);
  expect(table().getByText("Build project")).toBeTruthy();
});

test("basic file capabilities and non-shell arguments remain visible and recorded markup is escaped", () => {
  const { container } = render(<Capabilities events={[message(1, "session.tool.success", execution({
    reason: null, command: { name: "read", args: { path: "<img src=x onerror=alert(1)>" } },
  }))]} selectedSession="" sessions={[]} />);
  expect(table().getByText("Read file")).toBeTruthy();
  expect(table().getAllByRole("cell")[0].textContent).toBe('read {\n  "path": "<img src=x onerror=alert(1)>"\n}');
  expect(container.querySelector("img")).toBeNull();
});

test("a recorded tool failure without an error message never displays ok", () => {
  render(<Capabilities events={[message(1, "session.tool.failed", execution({ result: null }))]} selectedSession="" sessions={[]} />);
  expect(table().getByText("error: Tool call failed")).toBeTruthy();
});

test("empty sessions show an empty state without inventing calls", () => {
  render(<Capabilities events={[]} selectedSession="" sessions={[]} />);
  expect(screen.getByText("No recorded tool calls.")).toBeTruthy();
  expect(table().getAllByRole("row")).toHaveLength(1);
});
