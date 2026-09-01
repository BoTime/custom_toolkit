// Codex cannot dispatch Claude subagent frontmatter. It needs the same rendered
// instructions carried in a structured record with Codex's field names.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  codexOutputPath,
  composeCodexDispatch,
} from "./autopilot-dispatch.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const SKILLS = join(HERE, "..", "skills");
const readSkill = (...parts) => readFileSync(join(SKILLS, ...parts), "utf8");
const flatten = (text) => text.replace(/\s+/g, " ");

const coreSkill = readSkill("autopilot", "SKILL.md");
const verifyRun = readSkill(
  "autopilot", "references", "stages", "verify-run.md",
);
// The per-host dispatch protocols live beside the stage references rather than
// inline, so a run pays for its own host's protocol and not the other's. The
// contract is unchanged — these assertions follow the text to where it lives.
const codexDispatch = readSkill(
  "autopilot", "references", "stages", "codex-dispatch.md",
);
const githubSkill = readSkill("autopilot-github", "SKILL.md");
const brainstormSkill = readSkill("autopilot-brainstorm", "SKILL.md");
const visualCompanion = readSkill(
  "autopilot-brainstorm", "visual-companion.md",
);

function config() {
  return {
    roles: {
      implement: { model: "gpt-5.6", effort: "high" },
    },
  };
}

describe("Codex dispatch contract", () => {
  it("composes the pr stage as a structured Codex record", () => {
    const record = composeCodexDispatch({
      stage: "pr",
      config: config(),
      values: { run: "run-7", worktree: "/tmp/worktree" },
      fragmentReader: (rel) => rel === "pr-body.md"
        ? "PR STAGE for {{run}} in {{worktree}}"
        : `FRAGMENT(${rel})`,
      worktreeHas: () => false,
    });

    expect(record).toMatchObject({
      role: "implement",
      model: expect.any(String),
      reasoning_effort: "high",
      instructions: expect.stringContaining("PR STAGE"),
    });
  });

  it("writes the pr record to a JSON stage path", () => {
    expect(codexOutputPath("run-7", "pr"))
      .toBe(".superpowers/autopilot/run-7/agents/pr.json");
  });
});

describe("Codex skill execution contract", () => {
  it("selects Codex's config and native dispatch protocol", () => {
    const flat = flatten(`${coreSkill}\n${codexDispatch}`);

    expect(flat).toContain("--host=codex");
    expect(flat).toContain("--config=.codex/autopilot.json");
    expect(flat).toContain("spawn_agent");
    expect(flat).toContain("record.instructions");
    expect(flat).toContain("record.model");
    expect(flat).toContain("record.reasoning_effort");
    expect(flat).toContain("`${record.role}-${stage}`");
    expect(flat).toContain('`fork_turns` `"none"`');
  });

  it("passes the selected host and config to every stage composition example", () => {
    const commands = `${coreSkill}\n${verifyRun}`.match(
      /node "\$AP\/scripts\/autopilot-dispatch\.mjs"[\s\S]*?```/g,
    ) ?? [];

    expect(commands.length).toBeGreaterThanOrEqual(9);
    for (const command of commands) {
      expect(command).toMatch(/--host=(?:<host>|codex)/);
      expect(command).toMatch(/--config=(?:<config>|\.codex\/autopilot\.json)/);
    }
  });

  it("routes the orchestrator to the Codex protocol from SKILL.md", () => {
    // The protocol only reaches a Codex run if SKILL.md names its file. An
    // unnamed reference is a contract nobody reads, which the size budget
    // would happily accept.
    expect(coreSkill).toContain("references/stages/codex-dispatch.md");
  });

  it("keeps Claude-only dispatch claims out of the Codex protocol", () => {
    expect(codexDispatch).not.toMatch(/Agent tool/i);
    expect(codexDispatch).not.toMatch(/frontmatter/i);
    expect(codexDispatch).not.toMatch(/\b(?:opus|sonnet)\b/i);
    expect(codexDispatch).not.toMatch(/cannot Write or Edit/i);
  });

  it("uses the selected Codex config throughout the GitHub wrapper", () => {
    const flat = flatten(githubSkill);

    expect(flat).toContain(".codex/autopilot.json");
    expect(flat).toMatch(
      /autopilot-github-issue\.mjs preflight --config=<config>/,
    );
    expect(flat).toMatch(/delegat\w* through the host-aware/i);
  });

  it("routes Codex visual-companion startup through a persistent foreground session", () => {
    const brainstorm = flatten(brainstormSkill);
    const visual = flatten(visualCompanion);

    expect(brainstorm).toMatch(/Codex.*visual companion.*foreground session/i);
    expect(visual).toMatch(/Codex:.*foreground.*exec session/i);
    expect(visual).toMatch(/keep.*session.*running/i);
  });
});
