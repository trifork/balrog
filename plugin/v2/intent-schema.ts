import { Schema } from "effect";
import { Error as ToolError, type Info } from "@opencode/plugin/promise/tool";
import { REASON_FIELD, REASON_LIMIT } from "../shared/tracing.js";

type ObjectSchema = Record<string, unknown>;

function object(value: unknown): ObjectSchema | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as ObjectSchema : undefined;
}

function project(input: Info["input"]): ObjectSchema | undefined {
  if (Schema.isSchema(input)) {
    const document = Schema.toJsonSchemaDocument(input, { referencePolicy: () => undefined });
    return { ...document.schema, ...(Object.keys(document.definitions).length ? { $defs: document.definitions } : {}) };
  }
  const schema = object(input);
  const standard = object(schema?.["~standard"]);
  if (!standard) return schema;
  const jsonSchema = object(standard["jsonSchema"]);
  const projection = jsonSchema?.["input"];
  const toJSONSchema = schema?.["toJSONSchema"];
  return object(typeof projection === "function"
    ? projection.call(jsonSchema, { target: "draft-2020-12" })
    : typeof toJSONSchema === "function" ? toJSONSchema.call(input) : undefined);
}

export function withIntent(input: Info["input"]): ObjectSchema | undefined {
  try {
    const projected = project(input);
    if (!projected) return undefined;
    const schema = structuredClone(projected);
    const visited = new Set<ObjectSchema>();
    const extend = (node: ObjectSchema): boolean => {
      if (visited.has(node)) return true;
      visited.add(node);
      if (node["type"] !== undefined && node["type"] !== "object") return false;
      if (["const", "enum", "patternProperties", "if", "then", "else", "not", "dependentSchemas", "dependentRequired", "dependencies", "$dynamicRef", "$recursiveRef"]
        .some((keyword) => Object.hasOwn(node, keyword))) return false;
      if (Array.isArray(node["required"]) && node["required"].includes(REASON_FIELD)) return false;
      const properties = object(node["properties"]);
      if (properties && Object.hasOwn(properties, REASON_FIELD)) return false;
      let isObject = node["type"] === "object" || properties !== undefined;
      const reference = node["$ref"];
      if (typeof reference === "string") {
        if (!reference.startsWith("#/")) return false;
        let target: unknown = schema;
        for (const part of reference.slice(2).split("/")) target = object(target)?.[part.replace(/~1/g, "/").replace(/~0/g, "~")];
        if (!object(target) || target === node || !extend(target as ObjectSchema)) return false;
        isObject = true;
      }
      for (const keyword of ["allOf", "anyOf", "oneOf"]) {
        const branches = node[keyword];
        if (!Array.isArray(branches)) continue;
        if (!branches.length || !branches.every((branch) => object(branch) && extend(branch as ObjectSchema))) return false;
        isObject = true;
      }
      if (!isObject) return false;
      node["properties"] = {
        ...properties,
        [REASON_FIELD]: { type: "string", description: `Brief purpose in at most ${REASON_LIMIT} characters; not private reasoning.` },
      };
      const counts: ObjectSchema = {};
      for (const keyword of ["minProperties", "maxProperties"]) {
        if (typeof node[keyword] === "number") {
          counts[keyword] = node[keyword];
          delete node[keyword];
        }
      }
      if (Object.keys(counts).length) {
        node["allOf"] = [...(node["allOf"] as unknown[] | undefined ?? []), {
          if: { required: [REASON_FIELD] },
          then: Object.fromEntries(Object.entries(counts).map(([key, count]) => [key, Number(count) + 1])),
          else: counts,
        }];
      }
      if (node["propertyNames"] !== undefined) {
        node["propertyNames"] = { anyOf: [node["propertyNames"], { const: REASON_FIELD }] };
      }
      return true;
    };
    return extend(schema) ? schema : undefined;
  } catch {
    return undefined;
  }
}

export async function decodeOriginalInput(schema: Info["input"], input: unknown): Promise<unknown> {
  if (Schema.isSchema(schema)) return Schema.decodeUnknownPromise(schema)(input);
  const standard = object(object(schema)?.["~standard"]);
  if (typeof standard?.["validate"] !== "function") return input;
  const result = await standard["validate"](input);
  if (result.issues) throw new ToolError({ message: result.issues.map((issue: { message: string }) => issue.message).join("; ") });
  return result.value;
}
