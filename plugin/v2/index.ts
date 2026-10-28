import { Plugin } from "@opencode/plugin";
import { Recorder } from "../shared/recorder.js";

export default Plugin.define({
  id: "opencode-balrog",
  async setup(ctx) {
    const recorder = new Recorder("v2");
    await recorder.record("initialize", null, {
      context: {
        location: ctx.location,
        version: ctx.app.version,
      },
    });

    await ctx.tool.hook("execute.before", (event) =>
      recorder.record("tool.execute.before", event.sessionID, { event }),
    );
    await ctx.tool.hook("execute.after", (event) =>
      recorder.record("tool.execute.after", event.sessionID, { event }),
    );
    await ctx.session.hook("prompt", (event) =>
      recorder.record("session.prompt", event.sessionID, { event }),
    );
  },
});
