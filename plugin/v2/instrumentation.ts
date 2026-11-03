import type { Plugin } from "@opencode/plugin";
import { Error as ToolError, type Info } from "@opencode/plugin/promise/tool";
import { Schema } from "effect";
import type { Recorder } from "../shared/recorder.js";
import { OUTCOME_TOOL_ID } from "../shared/tracing.js";
import type { ToolLifecycleObserver } from "./outcomes.js";

export const REASON_FIELD = "__balrogReason";
const REASON_DESCRIPTION = "Briefly state why this call is needed and what result you expect. Give the action's purpose, not private reasoning.";

type ObjectSchema = Record<string, unknown>;

function object(value: unknown): ObjectSchema | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as ObjectSchema
    : undefined;
}

function inputJSONSchema(input: unknown): ObjectSchema {
  if (Schema.isSchema(input)) {
    const document = Schema.toJsonSchemaDocument(input, { referencePolicy: () => undefined });
    return { ...document.schema, ...(Object.keys(document.definitions).length ? { $defs: document.definitions } : {}) };
  }
  const schema = object(input);
  const standard = object(schema?.["~standard"]);
  if (standard) {
    const jsonSchema = object(standard["jsonSchema"]);
    const project = jsonSchema?.["input"];
    const toJSONSchema = schema?.["toJSONSchema"];
    const projected = typeof project === "function"
      ? project.call(jsonSchema, { target: "draft-2020-12" })
      : typeof toJSONSchema === "function" ? toJSONSchema.call(input) : undefined;
    if (!object(projected)) throw new Error("Tool intent requires a projectable object input schema");
    return projected;
  }
  if (input === true) return { type: "object" };
  if (!schema) throw new Error("Tool intent requires an object input schema");
  return schema;
}

function withIntent(input: unknown): ObjectSchema {
  const schema = structuredClone(inputJSONSchema(input));
  const visited = new Set<ObjectSchema>();
  const extend = (node: ObjectSchema): void => {
    if (visited.has(node)) return;
    visited.add(node);
    const reference = node["$ref"];
    if (typeof reference === "string") {
      if (!reference.startsWith("#/")) throw new Error("Tool intent requires local root schema references");
      let target: unknown = schema;
      for (const part of reference.slice(2).split("/")) {
        target = object(target)?.[part.replace(/~1/g, "/").replace(/~0/g, "~")];
      }
      if (!object(target)) throw new Error(`Unresolved tool input reference: ${reference}`);
      extend(target as ObjectSchema);
    }
    for (const keyword of ["allOf", "anyOf", "oneOf"]) {
      const branches = node[keyword];
      if (Array.isArray(branches)) {
        for (const branch of branches) if (object(branch)) extend(branch as ObjectSchema);
      }
    }
    const properties = object(node["properties"]);
    if (properties && Object.hasOwn(properties, REASON_FIELD)) {
      throw new Error(`Tool input already uses the reserved ${REASON_FIELD} argument`);
    }
    node["type"] = "object";
    node["properties"] = {
      ...properties,
      [REASON_FIELD]: { type: "string", minLength: 1, pattern: "\\S", description: REASON_DESCRIPTION },
    };
    node["required"] = [...(node["required"] as string[] | undefined ?? []), REASON_FIELD];
    for (const keyword of ["minProperties", "maxProperties"]) {
      if (typeof node[keyword] === "number") node[keyword] += 1;
    }
    if (node["propertyNames"] !== undefined) {
      node["propertyNames"] = { anyOf: [node["propertyNames"], { const: REASON_FIELD }] };
    }
  };
  extend(schema);
  return schema;
}

/** Adds per-call intent without forwarding tracing metadata to tool implementations. */
export async function instrumentTools(
  ctx: Plugin.Context,
  recorder: Recorder,
  outcomes?: ToolLifecycleObserver,
): Promise<void> {
  const wrapped = new WeakSet<Info["execute"]>();
  await ctx.tool.transform((editor) => {
    for (const { id } of editor.list()) {
      if (id === OUTCOME_TOOL_ID) continue;
      editor.update(id, (tool) => {
        if (wrapped.has(tool.execute)) return;
        tool.input = withIntent(tool.input);
        tool.description += `\nEvery call must include ${REASON_FIELD}. ${REASON_DESCRIPTION}`;
        const execute = tool.execute;
        tool.execute = async (input, context) => {
          const value = input !== null && typeof input === "object" && !Array.isArray(input)
            ? input as Record<string, unknown>
            : {};
          const reason = value[REASON_FIELD];
          if (typeof reason !== "string" || !reason.trim()) {
            throw new ToolError({ message: `Provide a non-empty ${REASON_FIELD} explaining this call's purpose and expected outcome.` });
          }
          const { [REASON_FIELD]: _reason, ...args } = value;
          await recorder.record("balrog.tool.intent", context.sessionID, {
            type: "balrog.tool.intent",
            created: Date.now(),
            data: {
              sessionID: context.sessionID,
              assistantMessageID: context.messageID,
              id: context.id,
              tool: id,
              reason,
            },
          });
          const call = { sessionID: context.sessionID, callID: context.id, tool: id, reason };
          outcomes?.started(call);
          try {
            const result = await execute(args, context);
            outcomes?.completed({ ...call, status: "completed" });
            return result;
          } catch (error) {
            outcomes?.completed({ ...call, status: "error" });
            throw error;
          }
        };
        wrapped.add(tool.execute);
      });
    }
  });
}
