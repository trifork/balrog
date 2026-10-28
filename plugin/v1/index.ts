import type { Plugin } from "@opencode-ai/plugin";
import { Recorder } from "../shared/recorder.js";

const BalrogPlugin: Plugin = async (context) => {
  const recorder = new Recorder("v1");
  await recorder.record("initialize", null, {
    context: {
      ...context,
      client: null,
      $: null,
    },
  });

  return {
    "command.execute.before": (input, output) =>
      recorder.record("command.execute.before", input.sessionID, {
        input,
        output,
      }),
    "tool.execute.before": (input, output) =>
      recorder.record("tool.execute.before", input.sessionID, { input, output }),
    "tool.execute.after": (input, output) =>
      recorder.record("tool.execute.after", input.sessionID, { input, output }),
    "chat.message": (input, output) =>
      recorder.record("chat.message", input.sessionID, { input, output }),
  };
};

export default BalrogPlugin;
