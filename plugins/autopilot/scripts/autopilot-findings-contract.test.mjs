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
