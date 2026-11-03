import { Plugin } from "@opencode/plugin";
import { Recorder } from "../shared/recorder.js";
import { SensitiveReadPermissions } from "./permissions.js";
import { registerRetro } from "./retro.js";
import { registerEvents } from "./events.js";

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

    const permissions = new SensitiveReadPermissions(ctx, recorder.pluginID, ctx.options.logEndpoint ?? "http://localhost:5001/log");
    try {
      await permissions.start();
      await registerRetro(ctx);
      const stopRecording = registerEvents({
        context: ctx,
        recorder,
        observe: (event) => permissions.observe(event),
      });

      return async () => {
        try {
          await stopRecording();
        } finally {
          await permissions.close();
        }
      };
    } catch (error) {
      await permissions.close();
      throw error;
    }
  },
});
