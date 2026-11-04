import { Plugin } from "@opencode/plugin";
import { Recorder } from "../shared/recorder.js";
import { SensitiveReadPermissions } from "./permissions.js";
import { registerRetro } from "./retro.js";
import { registerEvents } from "./events.js";
import { registerLiveToolExplanations } from "./live-explanations.js";

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
    let explanations: Awaited<ReturnType<typeof registerLiveToolExplanations>> | undefined;
    try {
      await permissions.start();
      if (ctx.options.liveToolExplanations === true) explanations = await registerLiveToolExplanations(ctx, recorder);
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
          try {
            await explanations?.dispose();
          } finally {
            await permissions.close();
          }
        }
      };
    } catch (error) {
      try {
        await explanations?.dispose();
      } finally {
        await permissions.close();
      }
      throw error;
    }
  },
});
