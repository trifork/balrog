import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test } from "vitest";
import type { PromptActivity } from "../../server/file-activity";
import type { LogEvent } from "../../server/log-receiver";
import type { ViewerMessage } from "../../shared/viewer-protocol";
import { FileActivity } from "./FileActivity";

afterEach(cleanup);

function message(id: number, activity: PromptActivity): ViewerMessage {
  return {
    id,
    event: { tag: "session.prompt", sessionID: activity.sessionID, pluginID: "test" } as unknown as LogEvent,
    fileActivity: activity,
  };
}

test("groups observed files, deduplicates badges and counts only confirmed changes", () => {
  const prompt: PromptActivity = {
    id: "1", sessionID: "s1", text: "Update files",
    files: [
      { path: "src/app.ts", action: "read", outcome: "success", callID: "read1" },
      { path: "src/app.ts", action: "read", outcome: "success", callID: "read2" },
      { path: "src/app.ts", action: "modified", outcome: "success", callID: "edit1" },
      { path: "src/app.ts", action: "written", outcome: "success", callID: "write1" },
      { path: "src/new.ts", action: "created", outcome: "pending", callID: "add1" },
      { path: "src/gone.ts", action: "deleted", outcome: "failed", callID: "delete1" },
    ],
  };
  render(<FileActivity events={[message(1, prompt)]} sessions={[]} selectedSession="" />);
  const tree = screen.getByRole("list", { name: "Touched files" });
  expect(screen.getByText("3 files touched / 1 confirmed changed")).toBeTruthy();
  expect(within(tree).getAllByText("Read")).toHaveLength(1);
  for (const badge of ["Edit", "Write", "Added (pending)", "Deleted (failed)"]) {
    expect(within(tree).getByText(badge)).toBeTruthy();
  }
  expect(within(tree).getByText("app.ts").getAttribute("title")).toBe("src/app.ts");
  expect(within(tree).getAllByText("src/")).toHaveLength(1);
});

test("reconstructs prompt order from snapshots and follows new prompts rather than late outcomes", async () => {
  const user = userEvent.setup();
  const first: PromptActivity = { id: "1", sessionID: "s1", text: "First prompt", files: [] };
  const second: PromptActivity = { id: "2", sessionID: "s1", text: "Second prompt", files: [] };
  const completed: PromptActivity = {
    ...first, files: [{ path: "old.ts", action: "modified", outcome: "success", callID: "c1" }],
  };
  const events = [message(1, first), message(2, second), message(3, completed)];
  const { rerender } = render(<FileActivity events={events} sessions={[]} selectedSession="" />);
  const select = screen.getByRole("combobox", { name: "Select prompt" }) as HTMLSelectElement;
  expect(select.value).toBe("2");
  expect(screen.queryByText("old.ts")).toBeNull();
  await user.selectOptions(select, "1");
  expect(screen.getByText("old.ts")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Follow latest" }).getAttribute("aria-pressed")).toBe("false");
  const third: PromptActivity = { id: "3", sessionID: "s1", text: "Third prompt", files: [] };
  rerender(<FileActivity events={[...events, message(4, third)]} sessions={[]} selectedSession="" />);
  expect(select.value).toBe("1");
  await user.click(screen.getByRole("button", { name: "Follow latest" }));
  expect(select.value).toBe("3");
  expect(screen.getByRole("button", { name: "Following latest" }).getAttribute("aria-pressed")).toBe("true");
  expect(screen.queryByText("old.ts")).toBeNull();
});

test("keeps collapsed folders across live updates and resets them for a new prompt", async () => {
  const user = userEvent.setup();
  const prompt: PromptActivity = {
    id: "1", sessionID: "s1", text: "Read a file",
    files: [{ path: "src/app.ts", action: "read", outcome: "pending", callID: "c1" }],
  };
  const { rerender } = render(<FileActivity events={[message(1, prompt)]} sessions={[]} selectedSession="" />);
  const summary = screen.getByText("src/");
  const folder = summary.closest("details")!;
  await user.click(summary);
  expect(folder.open).toBe(false);
  const completed: PromptActivity = { ...prompt, files: [{ ...prompt.files[0], outcome: "success" }] };
  rerender(<FileActivity events={[message(1, prompt), message(2, completed)]} sessions={[]} selectedSession="" />);
  expect(screen.getByText("src/").closest("details")).toBe(folder);
  expect(folder.open).toBe(false);
  rerender(<FileActivity events={[message(3, { ...completed, id: "2", text: "Next prompt" })]} sessions={[]} selectedSession="" />);
  expect(screen.getByText("src/").closest("details")?.open).toBe(true);
});

test("shows empty states and renders prompt and file text safely", () => {
  const { rerender, container } = render(<FileActivity events={[]} sessions={[]} selectedSession="" />);
  expect((screen.getByRole("combobox", { name: "Select prompt" }) as HTMLSelectElement).disabled).toBe(true);
  expect(screen.getByText(/Waiting for a recorded prompt/)).toBeTruthy();
  const prompt: PromptActivity = { id: "1", sessionID: "s1", text: "<img src=x onerror=alert(1)>", files: [] };
  rerender(<FileActivity events={[message(1, prompt)]} sessions={[]} selectedSession="" />);
  expect(screen.getByText("No explicit file activity recorded for this prompt yet.")).toBeTruthy();
  const changed: PromptActivity = {
    ...prompt, files: [{ path: "<script>alert(1)</script>.ts", action: "read", outcome: "success", callID: "c1" }],
  };
  rerender(<FileActivity events={[message(1, changed)]} sessions={[]} selectedSession="" />);
  expect(screen.getByText("1 file touched / 0 confirmed changed")).toBeTruthy();
  expect(container.querySelector("img, script")).toBeNull();
});
