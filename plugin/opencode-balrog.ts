import { type Plugin } from "@opencode-ai/plugin";
import * as fs from "fs";

const URL = "http://localhost:5001/log";

class Balrog {
  pluginID: string;

  constructor(pluginID: string) {
    this.pluginID = pluginID;
  }

  async record(
    tag: string,
    sessionID: string | null,
    fields: object,
  ): Promise<void> {
    const event = {
      [tag]: fields,
      tag: tag,
      sessionID: sessionID,
      pluginID: this.pluginID,
    };
    if (!URL) {
      await this.recordInFile(event);
    } else {
      const response = await fetch(URL, {
        method: "POST",
        body: JSON.stringify(event),
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
      });

      if (!response.ok) {
        await this.recordInFile(event);
      }
    }
  }

  async recordInFile(event: object): Promise<void> {
    const contents = `${String(JSON.stringify(event ?? null))}\n\n`;
    fs.appendFileSync("balrog.json", contents);
  }
}

export const BalrogPlugin: Plugin = async (context) => {
  const pluginId = crypto.randomUUID().substring(0, 8);
  const handler = new Balrog(pluginId);
  await handler.record("initialize", null, {
    context: {
      ...context,
      client: null,
      $: null,
    },
  });
  return {
    "command.execute.before": (input, output) =>
      handler.record("command.execute.before", input.sessionID, {
        input,
        output,
      }),
    "tool.execute.before": (input, output) =>
      handler.record("tool.execute.before", input.sessionID, { input, output }),
    "tool.execute.after": (input, output) =>
      handler.record("tool.execute.after", input.sessionID, { input, output }),
    "chat.message": (input, output) =>
      handler.record("chat.message", input.sessionID, { input, output }),
  };
};
