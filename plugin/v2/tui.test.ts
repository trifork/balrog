// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Plugin } from "@opencode/plugin/tui";
import sidebar from "./tui";

const { jsx } = vi.hoisted(() => ({
  jsx: vi.fn((type: string, props: Record<string, unknown>) => ({ type, props })),
}));
vi.mock("@opentui/solid/jsx-runtime", () => ({ jsx }));

beforeEach(() => jsx.mockClear());

function registerSidebar(options: Readonly<Record<string, unknown>> = {}) {
  const claims: Parameters<Plugin.Context["ui"]["slot"]>[0][] = [];
  const dispose = vi.fn();
  const cleanup = sidebar.setup({
    options,
    ui: {
      slot(claim) {
        claims.push(claim);
        return dispose;
      },
    },
  });
  expect(claims).toHaveLength(1);
  const claim = claims[0];
  if (claim.append !== "sidebar.content") {
    throw new Error("Expected an additive session sidebar contribution");
  }
  return { render: claim.render, cleanup, dispose };
}

function linkProps() {
  const call = jsx.mock.calls.find(([type]) => type === "a");
  if (!call) throw new Error("Expected a terminal hyperlink");
  return call[1];
}

describe("V2 sidebar session link", () => {
  it("adds a link for the current session without replacing sidebar content", () => {
    const { render } = registerSidebar();
    render({ sessionID: "ses_123" });

    expect(sidebar.id).toBe("opencode-balrog");
    expect(linkProps().href).toBe("http://localhost:5002/?session=ses_123");
    expect(linkProps().children).toBe(linkProps().href);
    expect(jsx).toHaveBeenCalledWith("b", { children: "Balrog" });
  });

  it("uses the configured frontend independently of the recording endpoint", () => {
    const { render } = registerSidebar({
      viewerURL: "https://viewer.example/balrog/?theme=dark&session=old#files",
      logEndpoint: "http://recorder.example:5001/log",
    });
    render({ sessionID: "ses_new" });

    expect(linkProps().href).toBe(
      "https://viewer.example/balrog/?theme=dark&session=ses_new#files",
    );
  });

  it("encodes session IDs without introducing additional URL parameters", () => {
    const { render } = registerSidebar();
    const sessionID = "session /?&=# +";
    render({ sessionID });
    const url = new URL(String(linkProps().href));

    expect(url.searchParams.get("session")).toBe(sessionID);
    expect([...url.searchParams.keys()]).toEqual(["session"]);
    expect(url.hash).toBe("");
  });

  it("keeps the link and its label tied to reactive session props", () => {
    const { render } = registerSidebar();
    let sessionID = "ses_first";
    render({ get sessionID() { return sessionID; } });
    const link = linkProps();

    expect(link.href).toBe("http://localhost:5002/?session=ses_first");
    sessionID = "ses_second";
    expect(link.href).toBe("http://localhost:5002/?session=ses_second");
    expect(link.children).toBe(link.href);
  });

  it("unregisters the sidebar contribution when the plugin is unloaded", () => {
    const { cleanup, dispose } = registerSidebar();
    cleanup();
    expect(dispose).toHaveBeenCalledOnce();
  });

  it.each(["", "invalid", "file:///tmp/viewer", "javascript:alert(1)", 123, false, {}])(
    "rejects an invalid viewerURL: %j",
    (viewerURL) => {
      expect(() => registerSidebar({ viewerURL })).toThrow();
    },
  );
});
