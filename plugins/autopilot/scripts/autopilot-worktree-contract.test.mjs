// SKILL.md's `setup` section is the only thing that makes the orchestrator run
// the create script and record what it prints. The contract is prose: nothing
// else fails if it is deleted or reworded past recognition — the run would
// simply go on making git worktrees and the ledger would stop being the source
// of the branch name. These assertions pin the load-bearing pieces of it, in
// the text a `setup` orchestrator actually reads (references resolved).

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { readSkill, sectionOf as section, unwrap } from "./skill-sections.mjs";
import { parseLedger, nextStage } from "./autopilot-ledger.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const GITHUB_SKILL_PATH = join(HERE, "..", "skills", "autopilot-github", "SKILL.md");

const skill = readSkill();
const setup = unwrap(section(skill, "setup"));
const whole = unwrap(skill);
const github = unwrap(readFileSync(GITHUB_SKILL_PATH, "utf8"));

describe("the setup stage runs the create script", () => {
  it("names the script", () => {
    expect(setup).toContain("autopilot-worktree.mjs");
  });

  it("passes the run name and the base ref", () => {
    expect(setup).toContain("--name=<run>");
    expect(setup).toContain("--base=<config.base_ref>");
  });

  it("passes the provider to the reaper", () => {
    expect(setup).toContain("--provider=<config.worktree_provider>");
  });
});

describe("the three outcomes reach the orchestrator", () => {
  it("documents the orca line", () => {
    expect(setup).toContain("worktree: <path> (branch <branch>)");
  });

  it("documents the git short-circuit", () => {
    expect(setup).toContain("provider: git");
  });

  it("documents the fallback line and what it appends", () => {
    expect(setup).toContain("fallback: git — <reason>");
    expect(setup).toContain("worktree provider: fell back to git — <reason>");
  });

  it("says a provider problem never parks the run", () => {
    expect(setup).toMatch(/never a park/);
  });
});

describe("the ledger is the source of the branch", () => {
  it("says so in the setup section", () => {
    expect(setup).toContain(
      "the sole source of the worktree path and the branch name",
    );
  });

  it("no longer claims the branch carries a worktree- prefix", () => {
    // AC8. The `git` provider still produces that prefix, so the wrapper may
    // name it as one case; what must be gone is the unconditional claim.
    expect(whole).not.toContain("`worktree-` prefixed git branch");
  });

  it("the fallback ledger line cannot advance the run", () => {
    // `nextStage` matches the worktree entry with `has("worktree:")`. The
    // fallback line is appended BEFORE the real one, so if it ever matched,
    // a resume would skip setup on a run that has no worktree yet.
    const ledger = [
      "# autopilot run — task: x",
      "2026-09-09T10:00:00Z  design approved",
      "2026-09-09T10:01:00Z  worktree provider: fell back to git — orca CLI not found on PATH",
    ].join("\n");
    expect(nextStage(parseLedger(ledger))).toBe("setup");
  });
});

describe("the github wrapper links the worktree to its issue", () => {
  it("passes --issue to the create script", () => {
    expect(github).toContain("--issue=<n>");
  });

  it("names the create script rather than the worktree skill", () => {
    expect(github).toContain("autopilot-worktree.mjs create");
  });
});
