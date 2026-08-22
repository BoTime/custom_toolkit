// SKILL.md's `sdd` section carries a findings-capture contract: SDD's review
// roles must append one JSON line per finding, plus an explicit clean line per
// passing task. The contract is prose, so nothing else fails if it is deleted
// or reworded past recognition — findings would simply stop being recorded and
// the corpus would silently stay empty, which is indistinguishable from a run
// where nothing went wrong.
//
// This test reads SKILL.md and asserts the load-bearing pieces are present
// within the `sdd` section, where a dispatched agent will actually read them.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { STAGES } from "./autopilot-findings.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const SKILL_PATH = join(HERE, "..", "skills", "autopilot", "SKILL.md");

// SKILL.md is hard-wrapped prose, so a pinned phrase routinely straddles a
// newline. Collapse whitespace before matching; otherwise a reflow that changes
// no words at all would fail these tests.
const unwrap = (s) => s.replace(/\s+/g, " ");

/**
 * The `### \`sdd\`` section: from its heading to the next heading at the same
 * level or shallower. Anchored at line starts for the same reasons as
 * autopilot-sdd-contract.test.mjs — a rule outside this section never reaches
 * the dispatched agent.
 */
function sddSection(markdown) {
  const startMatch = /^### `sdd`.*$/m.exec(markdown);
  if (!startMatch) throw new Error("SKILL.md has no `### \\`sdd\\`` section");
  const rest = markdown.slice(startMatch.index);
  const endMatch = /\n#{1,3} .*$/m.exec(rest.slice(startMatch[0].length));
  return endMatch ? rest.slice(0, startMatch[0].length + endMatch.index) : rest;
}

const skill = readFileSync(SKILL_PATH, "utf8");
const section = unwrap(sddSection(skill));

describe("sdd findings-capture contract", () => {
  it("names the corpus file and its main-checkout placement", () => {
    expect(section).toContain("findings.jsonl");
    expect(section).toMatch(/main checkout/i);
  });

  it("names every field a finding line must carry", () => {
    for (const field of [
      "task", "round", "severity", "stage_at_fault", "pattern", "detail", "verdict",
    ]) {
      expect(section).toContain(field);
    }
  });

  it("enumerates the stages that can be at fault", () => {
    // Without the closed list, agents invent values like "reviewer" and the
    // clustering key fragments.
    for (const stage of STAGES) {
      expect(section).toMatch(new RegExp(`\\b${stage}\\b`));
    }
  });

  it("requires an explicit clean line for a task that passes review", () => {
    // Without it, absence of evidence is indistinguishable from evidence of
    // absence and no threshold can be trusted.
    expect(section).toContain('"clean": true');
    expect(section).toMatch(/absence of evidence/i);
  });

  it("distinguishes pattern from detail so clustering stays lexical", () => {
    expect(section).toMatch(/pattern.{0,120}(short|canonical)/i);
  });

  it("says stage_at_fault names the stage that produced the bad input", () => {
    // Framing every finding as an implementer mistake would tune the wrong
    // stage — this is the sentence that prevents it.
    expect(section).toMatch(/stage_at_fault/);
    expect(section).toMatch(/bad input|produced the/i);
  });

  it("keeps the capture contract inside the sdd section, not merely in the file", () => {
    expect(section).toMatch(/findings capture contract/i);
  });

  it("does not weaken the existing verification contract", () => {
    // The verification contract and the capture contract coexist in this
    // section. Adding one must not displace the other.
    expect(section).toMatch(/verification contract/i);
  });
});

const whole = unwrap(skill);

describe("sdd complete records fix rounds", () => {
  it("shows the fix-round count in the ledger entry", () => {
    expect(section).toMatch(/fix rounds/i);
  });

  it("keeps the `sdd complete` prefix nextStage matches on", () => {
    // nextStage matches this entry by prefix to resume a run at `land`.
    // Renaming it silently breaks resume.
    expect(section).toContain("sdd complete (");
  });

  it("says why the count is there — a struggling run should be visible", () => {
    expect(section).toMatch(/at a glance|struggling/i);
  });
});

describe("run directory placement", () => {
  it("gives `<run>` a single definition", () => {
    expect(whole).toMatch(/`<run>`/);
  });

  it("states the main-checkout placement", () => {
    expect(whole).toMatch(/main checkout/i);
  });

  it("gives the before-the-worktree reason", () => {
    // The ledger is appended during Phase 1, and `setup` — which creates the
    // worktree — is the next stage.
    expect(whole).toMatch(/before the worktree|exists before/i);
  });

  it("gives the survives-the-worktree reason", () => {
    // The reaper deletes worktrees after merge; a ledger inside one is
    // destroyed along with every completed run's PR URL.
    expect(whole).toMatch(/reaper deletes|survive/i);
  });

  it("says findings.jsonl inherits the same placement", () => {
    expect(whole).toMatch(/findings\.jsonl[^.]{0,200}same placement|inherits/i);
  });

  it("records the worktree-cannot-write-to-main-checkout constraint", () => {
    // A worktree-isolated session cannot Write/Edit to the main checkout,
    // though Bash appends and reads work. Recording it stops the next agent
    // rediscovering it mid-run.
    expect(whole).toMatch(/Bash append/i);
  });
});

describe("plugin packaging", () => {
  const pluginJson = JSON.parse(
    readFileSync(join(HERE, "..", ".claude-plugin", "plugin.json"), "utf8"),
  );
  const marketplace = JSON.parse(
    readFileSync(join(HERE, "..", "..", "..", ".claude-plugin", "marketplace.json"), "utf8"),
  );

  it("registers the commands directory so the new command loads", () => {
    expect(pluginJson.commands).toEqual(["./commands/"]);
  });

  it("is at version 1.5.0", () => {
    expect(pluginJson.version).toBe("1.5.0");
  });

  it("bumps the marketplace plugin entry to the same version", () => {
    const entry = marketplace.plugins.find((p) => p.name === "autopilot");
    expect(entry.version).toBe("1.5.0");
  });

  it("bumps the marketplace metadata block too", () => {
    // Two places in one file. Bumping only the plugin entry is the drift this
    // pins.
    expect(marketplace.metadata.version).toBe("1.5.0");
  });

  it("ships the findings command", () => {
    const command = readFileSync(
      join(HERE, "..", "commands", "autopilot-findings.md"),
      "utf8",
    );
    expect(command).toContain("autopilot-findings.mjs");
    expect(command).toContain("findings_threshold");
    // The command proposes; the human disposes.
    expect(command).toMatch(/approv/i);
    expect(command).toMatch(/do not (write|inject)/i);
  });
});
