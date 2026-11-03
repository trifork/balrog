import type { Plugin } from "@opencode/plugin/tui";
import { jsx } from "@opentui/solid/jsx-runtime";

const BalrogSidebar = {
  id: "opencode-balrog",
  setup({ options, ui }: {
    options: Readonly<Record<string, unknown>>;
    ui: Pick<Plugin.Context["ui"], "slot">;
  }) {
    const viewerURL = options.viewerURL ?? "http://localhost:5002";
    if (typeof viewerURL !== "string") {
      throw new TypeError("Balrog viewerURL must be an HTTP or HTTPS URL");
    }
    const baseURL = new URL(viewerURL);
    if (baseURL.protocol !== "http:" && baseURL.protocol !== "https:") {
      throw new TypeError("Balrog viewerURL must be an HTTP or HTTPS URL");
    }

    return ui.slot({
      append: "sidebar.content",
      render(input) {
        const sessionURL = () => {
          const url = new URL(baseURL);
          url.searchParams.set("session", input.sessionID);
          return url.href;
        };
        return jsx("box", {
          flexDirection: "column",
          marginTop: 1,
          children: [
            jsx("text", {
              children: jsx("a", {
                get href() { return sessionURL(); },
                get children() { return "View session in Balrog"; },
              }),
            }),
          ],
        });
      },
    });
  },
} satisfies Plugin.Definition;

export default BalrogSidebar;
