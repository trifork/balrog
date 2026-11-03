import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { Skill, type Plugin } from "@opencode/plugin";

/** Makes the bundled skill available wherever the tracing plugin is loaded. */
export async function registerRetro(ctx: Plugin.Context): Promise<void> {
  const file = new URL("../../skills/retro/SKILL.md", import.meta.url);
  const markdown = await readFile(file, "utf8");
  const frontmatter = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
  const description = frontmatter?.[1].match(/^description: (.+)$/m)?.[1].trim();
  if (!frontmatter || !description) throw new Error("The bundled retro skill is missing its description.");
  const id = Skill.ID.make("retro");
  await ctx.skill.transform((editor) => {
    editor.add({
      id,
      name: Skill.Name.make("retro"),
      description,
      autoinvoke: false,
      path: Skill.Info.fields.path.make(fileURLToPath(file)),
      content: markdown.slice(frontmatter[0].length),
    });
  });
  await ctx.command.transform((editor) => {
    editor.add({
      name: "retro",
      description: "Review a Balrog session and suggest repository improvements. Defaults to this session.",
      execute: async ({ sessionID, prompt, delivery }) => {
        const target = prompt.text.trim() || sessionID;
        if (!/^ses_[A-Za-z0-9_-]+$/.test(target)) throw new Error("Usage: /retro [session-id]");
        const cutoff = Date.now();
        await ctx.session.prompt({
          ...prompt,
          sessionID,
          delivery,
          files: prompt.files?.map(({ mention: _mention, ...file }) => file),
          agents: prompt.agents?.map(({ mention: _mention, ...agent }) => agent),
          skills: [...(prompt.skills ?? []).filter((skill) => skill.id !== id)
            .map(({ mention: _mention, ...skill }) => skill), { id }],
          text: `Use the retro skill for a read-only Balrog retrospective.\nTarget Balrog session: ${target}\nSnapshot cutoff: ${cutoff} (Unix milliseconds; request conversation events before this cutoff).\nRead the entire recorded conversation and assess all tool calls together in one analysis pass. Infer each call's reason and outcome from the evidence; label these as retrospective assessments, not original agent reports. Order the execution table by startedAt ascending. Show the call-level table and the separate higher-level improvement table. Propose changes; do not apply them.`,
        });
      },
    });
  });
}
