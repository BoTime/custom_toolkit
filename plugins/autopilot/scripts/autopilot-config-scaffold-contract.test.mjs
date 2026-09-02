// Preflight step 4's scaffold branch reaches the agent entirely as prose.
// Nothing else fails if it is deleted or reworded past recognition — the run
// just validates against plugin defaults and starts the brainstorm, which is
// exactly the behaviour the scaffold exists to replace. These assertions read
// the real SKILL.md the way the other autopilot-*-contract tests do.
//
// Whitespace is normalised before matching so a line wrap inside a sentence
// cannot turn a live assertion into a dead one.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, it, expect } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const SKILL_PATH = join(HERE, "..", "skills", "autopilot", "SKILL.md");

const skill = readFileSync(SKILL_PATH, "utf8").replace(/\s+/g, " ");

const SCAFFOLD_CALL = "m.scaffoldConfig(process.argv[2],{host:process.argv[3]})";
const VALIDATE_CALL = "m.loadConfig(process.argv[2],process.env,undefined,undefined,{host:process.argv[3]})";

describe("preflight step 4 scaffolds an absent config", () => {
  it("calls scaffoldConfig for the selected host when <config> is absent", () => {
    // AC5
    expect(skill).toContain("If `<config>` is absent, scaffold it");
    expect(skill).toContain(SCAFFOLD_CALL);
    expect(skill).toContain(`${SCAFFOLD_CALL}))" "$AP" "<config>" "<host>"`);
  });

  it("runs the scaffold branch before the validate command", () => {
    // AC5 — the order is the guard: validating first would report
    // "ok (plugin defaults)" and the scaffold would never run.
    expect(skill.indexOf(SCAFFOLD_CALL)).toBeGreaterThan(-1);
    expect(skill.indexOf(SCAFFOLD_CALL)).toBeLessThan(skill.indexOf(VALIDATE_CALL));
  });

  it("reports the created path and the test_command instruction, then stops", () => {
    // AC5
    expect(skill).toContain("report the created path");
    expect(skill).toContain("`test_command` must be filled in before rerunning `/autopilot`");
    expect(skill).toContain("stop the run — do not start the brainstorm");
    expect(skill).toContain("The file is left uncommitted on the current branch");
  });

  it("no longer says a project with no config file runs on the host's defaults", () => {
    // AC5 — the old trailing sentence contradicts the new branch.
    expect(skill).not.toContain("A project with no config file runs on that host's defaults.");
    expect(skill).toContain("scaffolds it from those defaults and stops instead of running on them");
  });
});
