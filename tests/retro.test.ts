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
  assert.ok(template.includes("| id | command | reason | outcome |"));
  assert.doesNotMatch(template, /\| id \|[^\n]*(?:improvement|complexity|gain)/);
  assert.doesNotMatch(content, /\| id \|[^\n]*(?:improvement|complexity|gain)/);
  assert.doesNotMatch(content, /\b(?:score|scores|scoring)\b|suggested command|alternative command/i);
  assert.match(content, /Hide `startedAt`, `completedAt`, and `callID` unless the user asks/);
  assert.match(content, /Assign consecutive numeric IDs starting at 1/);
  assert.match(content, /Use the displayed `id` values for evidence references/);
  assert.doesNotMatch(content, /using related call IDs/);
  assert.ok(template.includes("| improvement | complexity | gain | evidence | validation |"));
  assert.match(template, /## Session and evidence/);
  assert.match(template, /## Recommendation/);
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
  assert.match(template, /retrospective assessments/);
});

test("retro writes purposes directly and qualifies uncertainty based on evidence, not assessment timing", async (t) => {
  const { skills } = await setup(t);
  const content = skills[0].content;
  assert.match(content, /without an `Inferred:` prefix/);
  assert.match(content, /Qualify actual uncertainty and use `unknown`/);
  assert.match(content, /"reason": "Find setup instructions\."/);
  assert.doesNotMatch(content, /"reason": "Inferred:|Distinguish an explicit explanation from an inference/);
  const template = await readFile(new URL("../skills/retro/assets/retro-output.md", import.meta.url), "utf8");
  assert.match(template, /evidence-supported purpose; unknown if unsupported/);
});
