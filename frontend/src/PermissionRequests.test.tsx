import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";
import { PermissionRequests } from "./PermissionRequests";
import type { PendingPermission } from "../../shared/permission-protocol";

afterEach(cleanup);

const request: PendingPermission = {
  pluginID: "plugin-1", sessionID: "session-1", requestID: "request-1",
  resources: ["/project/appsettings.Production.json", "/project/.env"], status: "pending",
};

test("shows sensitive paths and session identification and replies once or rejects", async () => {
  const user = userEvent.setup();
  const onReply = vi.fn();
  render(<PermissionRequests requests={[request]} sessions={[]} live onReply={onReply} />);
  const region = screen.getByRole("region", { name: "Read approvals" });
  expect(within(region).getByText("/project/appsettings.Production.json")).toBeTruthy();
  expect(within(region).getByText("/project/.env")).toBeTruthy();
  expect(within(region).getByText("session-1")).toBeTruthy();
  await user.click(within(region).getByRole("button", { name: "Accept once" }));
  expect(onReply).toHaveBeenLastCalledWith(request, "once");
  await user.click(within(region).getByRole("button", { name: "Reject" }));
  expect(onReply).toHaveBeenLastCalledWith(request, "reject");
});

test("disables actions while replying or disconnected and disappears after a native reply", () => {
  const onReply = vi.fn();
  const { rerender } = render(<PermissionRequests requests={[{ ...request, status: "replying" }]} sessions={[]} live onReply={onReply} />);
  expect((screen.getByRole("button", { name: "Accept once" }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByRole("article").getAttribute("data-waiting")).toBe("false");
  expect(screen.getByText("Sending reply…")).toBeTruthy();
  rerender(<PermissionRequests requests={[request]} sessions={[]} live={false} onReply={onReply} />);
  expect(screen.getByRole("article").getAttribute("data-waiting")).toBe("false");
  expect((screen.getByRole("button", { name: "Reject" }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByText(/Reconnect to answer/)).toBeTruthy();
  rerender(<PermissionRequests requests={[]} sessions={[]} live onReply={onReply} />);
  expect(screen.queryByRole("region", { name: "Read approvals" })).toBeNull();
});
