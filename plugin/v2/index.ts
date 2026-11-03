import { Plugin } from "@opencode/plugin";
import { Recorder } from "../shared/recorder.js";

export default Plugin.define({
  id: "opencode-balrog",
  async setup(ctx) {
    const recorder = new Recorder("v2", {
      logEndpoint: ctx.options.logEndpoint,
      logPath: ctx.options.logPath,
    });
    await recorder.record("initialize", null, {
      context: {
        location: ctx.location,
        version: ctx.app.version,
      },
    });

    const controller = new AbortController();
    const consume = (async () => {
      try {
        for await (const event of ctx.event.subscribe({
          signal: controller.signal,
        })) {
          const sessionID =
            "sessionID" in event.data &&
            typeof event.data.sessionID === "string"
              ? event.data.sessionID
              : null;
          await recorder.record(event.type, sessionID, event);
        }
      } catch (error) {
        if (!controller.signal.aborted) throw error;
      }
    })();

    return async () => {
      controller.abort();
      await consume;
    };
  },
});
