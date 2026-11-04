import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test, type TestContext } from "node:test";
import type { Plugin, Skill } from "@opencode/plugin";
import type { CommandDefinition, CommandInvocation } from "@opencode/plugin/promise/command";
import v2 from "../plugin/v2/index.js";

async function setup(t: TestContext) {
  const skills: Skill.Info[] = [];
  const commands: CommandDefinition[] = [];
  const prompts: Array<Parameters<Plugin.Context["session"]["prompt"]>[0]> = [];
  const registration = async () => ({ dispose: async () => {} });
  const context = {
    app: { version: "2.2.0" }, location: {}, options: { logEndpoint: "" },
    permission: { hook: registration },
    tool: { transform: registration },
    skill: { async transform(callback: (editor: { add(skill: Skill.Info): void }) => void) {
      callback({ add: (skill) => { skills.push(skill); } });
      return registration();
    } },
    command: { async transform(callback: (editor: { add(command: CommandDefinition): void }) => void) {
      callback({ add: (command) => { commands.push(command); } });
      return registration();
    } },
    session: {
      hook: registration,
      prompt: async (input: Parameters<Plugin.Context["session"]["prompt"]>[0]) => { prompts.push(input); },
    },
    event: { async *subscribe() {} },
  } as unknown as Plugin.Context;
  const dispose = await v2.setup(context);
  t.after(async () => { if (typeof dispose === "function") await dispose(); });
  return { skills, commands, prompts };
}

test("retro registers a bundled explicit-only skill and defaults to the caller session, never the latest session", async (t) => {
  const { skills, commands, prompts } = await setup(t);
  assert.equal(skills.length, 1);
  assert.equal(skills[0].id, "retro");
  assert.equal(skills[0].autoinvoke, false);
  assert.match(skills[0].path, /skills[/\\]retro[/\\]SKILL\.md$/);
  assert.match(skills[0].content, /startedAt/);
  const command = commands.find((entry) => entry.name === "retro");
  assert.ok(command);
  await command.execute({
    sessionID: "ses_current", prompt: { text: "" }, delivery: "queue",
  } as unknown as CommandInvocation);
  assert.equal(prompts[0].sessionID, "ses_current");
  assert.match(prompts[0].text, /Target Balrog session: ses_current/);
  assert.deepEqual(prompts[0].skills, [{ id: "retro" }]);
  assert.equal(prompts[0].delivery, "queue");
  assert.match(prompts[0].text, /startedAt ascending/);
  assert.match(prompts[0].text, /Snapshot cutoff: \d+/);
  assert.match(prompts[0].text, /entire recorded conversation/);
  assert.match(prompts[0].text, /one analysis pass/);
  assert.match(prompts[0].text, /Return only high-level recommendations/);
  assert.match(prompts[0].text, /Reuse every non-empty recorded reason verbatim/);
  assert.match(prompts[0].text, /infer a reason only when none is recorded/);
  assert.doesNotMatch(prompts[0].text, /Infer each call's reason and outcome/);
  assert.doesNotMatch(prompts[0].text, /Show the call-level table/);
  assert.equal(prompts.length, 1);
});

test("retro can review another session without moving the caller or dropping attached skills", async (t) => {
  const { commands, prompts } = await setup(t);
  await commands[0].execute({
    sessionID: "ses_current",
    prompt: {
      text: "  ses_target  ",
      skills: [{ id: "other-skill", mention: { start: 0, end: 6, text: "@other" } }, { id: "retro" }],
      files: [{ uri: "file:///evidence.json", mention: { start: 0, end: 6, text: "@file" } }],
    },
    delivery: "steer",
  } as unknown as CommandInvocation);
  assert.equal(prompts[0].sessionID, "ses_current");
  assert.match(prompts[0].text, /Target Balrog session: ses_target/);
  assert.deepEqual(prompts[0].skills, [{ id: "other-skill" }, { id: "retro" }]);
  assert.deepEqual(prompts[0].files, [{ uri: "file:///evidence.json" }]);
  assert.equal(prompts[0].delivery, "steer");
});

test("retro rejects ambiguous command arguments without submitting a review prompt", async (t) => {
  const { commands, prompts } = await setup(t);
  await assert.rejects(commands[0].execute({
    sessionID: "ses_current", prompt: { text: "ses_first ses_second" }, delivery: "queue",
  } as unknown as CommandInvocation), /Usage: \/retro \[session-id\]/);
  assert.equal(prompts.length, 0);
});

test("retro assesses the whole conversation in one pass without per-tool model calls or live reporting", async (t) => {
  const { skills } = await setup(t);
  const content = skills[0].content;
  assert.match(content, /retrospective assessments/);
  assert.match(content, /one analysis pass/);
  assert.match(content, /at most three/);
  assert.match(content, /Never make a model request or delegate an agent per tool call/);
  assert.match(content, /\/api\/sessions\/.*\/conversation/);
  assert.match(content, /unknown/);
  assert.match(content, /Order by `startedAt` ascending/);
  assert.match(content, /\[assets\/retro-output\.md\]\(assets\/retro-output\.md\)/);
  const template = await readFile(new URL("../skills/retro/assets/retro-output.md", import.meta.url), "utf8");
  assert.doesNotMatch(template, /\| id \| command/);
  assert.doesNotMatch(template, /\| id \|[^\n]*(?:improvement|complexity|gain)/);
  assert.doesNotMatch(content, /\| id \|[^\n]*(?:improvement|complexity|gain)/);
  assert.doesNotMatch(content, /\b(?:score|scores|scoring)\b|suggested command|alternative command/i);
  assert.match(content, /Hide `startedAt` and `completedAt` unless the user asks/);
  assert.match(content, /Use the original `callID` values for all call references/);
  assert.doesNotMatch(content, /Assign consecutive numeric IDs|display IDs|displayed IDs|numeric display ID|calls 2 and 5/);
  assert.match(template, /# Recommendations/);
  assert.match(template, /Complexity:.*gain:.*Validate by/);
  assert.match(content, /`LOW`, `MEDIUM`, or `HIGH`/);
  assert.match(content, /AGENTS\.md/);
  assert.match(content, /Co-locate tightly related implementation, settings, and tests by feature/);
  assert.match(content, /Do not edit files, restructure modules/);
  assert.match(content, /original records remain unchanged/);
  assert.match(content, /POST.*\/api\/sessions\/.*\/assessments/);
  assert.match(content, /original `callID`/);
  assert.match(content, /one batch/);
  assert.doesNotMatch(content, /assessments and suggestions are not written back|Requires read-only HTTP/);
  assert.match(content, /Report whether publication succeeded/);
  assert.doesNotMatch(content, /Preserve `reason` and `outcome` verbatim|A missing outcome stays `null`/);
  assert.match(template, /Detailed call assessments belong in Balrog/);
});

test("retro reuses recorded reasons and infers only missing purposes without rewriting original intent", async (t) => {
  const { skills } = await setup(t);
  const content = skills[0].content;
  assert.match(content, /without an `Inferred:` prefix/);
  assert.match(content, /Qualify actual uncertainty and use `unknown`/);
  assert.match(content, /"reason": "Find setup instructions\."/);
  assert.doesNotMatch(content, /"reason": "Inferred:|Distinguish an explicit explanation from an inference/);
  assert.match(content, /Reuse every non-empty recorded reason verbatim/);
  assert.match(content, /including reasons from previous retrospectives/);
  assert.match(content, /Do not regenerate, paraphrase, or correct an existing reason/);
  assert.match(content, /Only when no non-empty reason is recorded, describe why the call was needed/);
  assert.match(content, /omit `reason` from its POST entry/);
  assert.match(content, /preserves the original reason and its provenance/);
});

test("retro publishes a stable technical capability separately from the reason for using it", async (t) => {
  const { skills } = await setup(t);
  const content = skills[0].content;
  assert.match(content, /`capability`: describe the technical operation/);
  assert.match(content, /The same technical operation must use the same capability label/);
  assert.match(content, /different reasons/);
  assert.match(content, /Read file/);
  assert.match(content, /Get status from production Kubernetes deployment/);
  assert.match(content, /environment.*recorded evidence/);
  assert.match(content, /"capability": "Read file"/);
  assert.match(content, /Publish capabilities, reasons, and outcomes/);
  assert.match(content, /Send the redacted assessments prepared internally/);
});

test("retro lists activated skills, assesses task fit, and proposes bounded skill-use changes", async (t) => {
  const { skills } = await setup(t);
  const content = skills[0].content;
  const template = await readFile(new URL("../skills/retro/assets/retro-output.md", import.meta.url), "utf8");
  assert.ok(skills[0].description);
  assert.match(skills[0].description, /assess activated skills/);
  assert.match(content, /List each distinct activated skill/);
  assert.match(content, /recorded successful skill loads and explicit skill/);
  assert.match(content, /A catalog of available skills, a mention, or a failed load is not proof/);
  assert.match(content, /Do not count\s+skills activated only to perform this retrospective/);
  assert.match(content, /reviewer's current skills/);
  assert.match(content, /mark coverage as unknown\s+or partial/);
  assert.match(content, /Task fit: compare its documented scope and trigger/);
  assert.match(content, /Respect required\s+or user-requested skill use/);
  assert.match(content, /`KEEP`, `NARROW`, `REPLACE`, or `STOP`/);
  assert.match(content, /Use `UNKNOWN` when evidence cannot support a decision/);
  assert.match(content, /not delete\s+it or disable it globally/);
  assert.match(content, /availability and documented relevance are verified/);
  assert.match(content, /Carry actionable skill-use recommendations into the higher-level improvements/);
  assert.match(content, /Do not enable, disable, install, or remove skills during `\/retro`/);
  assert.doesNotMatch(template, /Skill-activation coverage:|## Activated skills/);
  assert.match(template, /including actionable skill-use changes/);
});

test("retro keeps detailed analysis in Balrog and returns bounded recommendations even if publication fails", async (t) => {
  const { skills } = await setup(t);
  const content = skills[0].content;
  const template = await readFile(new URL("../skills/retro/assets/retro-output.md", import.meta.url), "utf8");
  assert.match(content, /at most three prioritized recommendations/);
  assert.match(content, /200 words or fewer/);
  assert.match(content, /one short publication-status line/);
  assert.match(content, /only when it materially limits confidence/);
  assert.match(content, /internal unless the user\s+explicitly requests them/);
  assert.match(content, /A publication failure does not trigger a full report dump/);
  assert.match(template, /No changes are justified by the available evidence/);
  assert.match(template, /published assessment count, skipped because no calls remain, or failure and reason/);
  assert.doesNotMatch(template, /## Commands|\| skill \||\| evidence \|/);
});
