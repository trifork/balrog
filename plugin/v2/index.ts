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

    const controller = new AbortController();
    const consume = (async () => {
      try {
        for await (const event of ctx.event.subscribe({
          types: [
            "permission.asked",
            "permission.replied",
            "session.created",
            "session.execution.failed",
            "session.execution.started",
            "session.execution.succeeded",
            "session.renamed",
            "session.text.ended",
            "session.text.started",
            "session.tool.called",
            "session.tool.failed",
            "session.tool.success",
          ],
          signal: controller.signal,
        })) {
          await recorder.record(event.type, event.data.sessionID, {
            event,
          });
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
