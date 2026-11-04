import type { Plugin } from "@opencode/plugin";
import type { Info } from "@opencode/plugin/promise/tool";
import type { Recorder } from "../shared/recorder.js";
import { OUTCOME_TOOL_ID, REASON_FIELD, REASON_LIMIT } from "../shared/tracing.js";
import { decodeOriginalInput, withIntent } from "./intent-schema.js";

export async function registerLiveToolExplanations(ctx: Plugin.Context, recorder: Pick<Recorder, "record">) {
  const active = new Set<string>();
  let pending = Promise.resolve();
  const wrapped = new WeakSet<Info["execute"]>();
  const record = (tag: string, sessionID: string, data: object) => {
    const event = { type: tag, created: Date.now(), data };
    pending = pending.then(() => recorder.record(tag, sessionID, event)).catch(() => {});
  };
  const registration = await ctx.tool.transform((editor) => {
    for (const { id } of editor.list()) {
      if (id === OUTCOME_TOOL_ID) continue;
      editor.update(id, (tool) => {
        if (wrapped.has(tool.execute)) return;
        const input = withIntent(tool.input);
        if (!input) return;
        const originalInput = tool.input;
        const execute = tool.execute;
        tool.input = input;
        tool.execute = async (value, context) => {
          const object = value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
          const { [REASON_FIELD]: purpose, ...args } = object ?? {};
          const key = JSON.stringify([context.sessionID, context.id]);
          if (active.has(key)) return execute(await decodeOriginalInput(originalInput, object ? args : value), context);
          active.add(key);
          const call = { sessionID: context.sessionID, assistantMessageID: context.messageID, id: context.id, tool: id };
          const reason = typeof purpose === "string" ? purpose.trim().slice(0, REASON_LIMIT) : "";
          if (reason) record("balrog.tool.intent", context.sessionID, { ...call, reason, source: "agent" });
          try {
            const decoded = await decodeOriginalInput(originalInput, object ? args : value);
            return await execute(decoded, context);
          } finally {
            active.delete(key);
          }
        };
        wrapped.add(tool.execute);
      });
    }
  });
  return { dispose: async () => {
    await registration.dispose();
    await pending;
  } };
}
