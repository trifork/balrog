import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { PendingPermission } from "../../shared/permission-protocol";
import { ReadWarning } from "./ReadWarning";

const request: PendingPermission = {
  pluginID: "p1", sessionID: "s1", requestID: "r1", resources: ["/demo/appsettings.json"], status: "pending",
};

beforeEach(() => vi.useFakeTimers());
afterEach(() => { cleanup(); vi.useRealTimers(); });

test("new pending reads trigger a pointer-transparent warning and accessible announcement, then settle", () => {
  const { container, rerender } = render(<ReadWarning requests={[]} live />);
  expect(container.querySelector(".read-warning-frame")).toBeNull();
  rerender(<ReadWarning requests={[request]} live />);
  expect(container.querySelector(".read-warning-frame")?.getAttribute("aria-hidden")).toBe("true");
  expect(screen.getByRole("alert").textContent).toContain("Sensitive file read requires approval");
  act(() => vi.advanceTimersByTime(1_800));
  expect(container.querySelector(".read-warning-frame")).toBeNull();
});

test("duplicate snapshots and unrelated rerenders do not restart the warning; a new identity does", () => {
  const { container, rerender } = render(<ReadWarning requests={[request]} live />);
  act(() => vi.advanceTimersByTime(1_800));
  rerender(<ReadWarning requests={[{ ...request }]} live />);
  expect(container.querySelector(".read-warning-frame")).toBeNull();
  rerender(<ReadWarning requests={[request, { ...request, requestID: "r2" }]} live />);
  expect(container.querySelector(".read-warning-frame")).not.toBeNull();
});

test("offline and replying requests do not sound an alarm, and reconnecting does not repeat one", () => {
  const { container, rerender } = render(<ReadWarning requests={[request]} live={false} />);
  expect(container.querySelector(".read-warning-frame")).toBeNull();
  rerender(<ReadWarning requests={[request]} live />);
  expect(container.querySelector(".read-warning-frame")).not.toBeNull();
  rerender(<ReadWarning requests={[request]} live={false} />);
  expect(container.querySelector(".read-warning-frame")).toBeNull();
  rerender(<ReadWarning requests={[request]} live />);
  expect(container.querySelector(".read-warning-frame")).toBeNull();
  rerender(<ReadWarning requests={[{ ...request, requestID: "r2", status: "replying" }]} live />);
  expect(container.querySelector(".read-warning-frame")).toBeNull();
});

test("resolving requests removes the warning immediately and unmount clears its timer", () => {
  const { container, rerender, unmount } = render(<ReadWarning requests={[request]} live />);
  expect(container.querySelector(".read-warning-frame")).not.toBeNull();
  rerender(<ReadWarning requests={[]} live />);
  expect(container.querySelector(".read-warning-frame")).toBeNull();
  rerender(<ReadWarning requests={[{ ...request, requestID: "r2" }]} live />);
  unmount();
  expect(vi.getTimerCount()).toBe(0);
});
