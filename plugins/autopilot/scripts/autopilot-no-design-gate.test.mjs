// Phase 1 ends when the brainstorm hands its design back — there is no
// design-approval gate. That contract lives in prose across two skill files,
// so nothing else fails if a later edit reintroduces the gate: an agent would
// simply start asking "does this look right?" again, and the run would stall
// on a reply it does not need.
//
// These tests pin the load-bearing pieces. They match on phrases rather than
// full sentences, so ordinary rewording survives but a reinstated gate does
// not. The positive assertions prove the instruction is present; the negative
// ones prove the old section-by-section approval language is gone.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const SKILLS = join(HERE, "..", "skills");
const BRAINSTORM = join(SKILLS, "autopilot-brainstorm", "SKILL.md");
const ORCHESTRATOR = join(SKILLS, "autopilot", "SKILL.md");

// These files are hard-wrapped prose, so a pinned phrase routinely straddles a
// newline. Collapse whitespace before matching; otherwise a reflow that changes
// no words at all would fail these tests.
const unwrap = (path) => readFileSync(path, "utf8").replace(/\s+/g, " ");

const brainstorm = unwrap(BRAINSTORM);
const orchestrator = unwrap(ORCHESTRATOR);

describe("autopilot-brainstorm has no design-approval gate", () => {
  it("names the clarifying questions as the approval mechanism", () => {
    expect(brainstorm).toMatch(/clarifying questions ARE the approval/i);
  });

  it("forbids the proceed-check phrasings an agent reaches for", () => {
    expect(brainstorm).toMatch(/does this look right/i);
    expect(brainstorm).toMatch(/shall I (proceed|start)/i);
  });

  it("routes an unresolved point back to a question, not to a gate", () => {
    // The escape hatch matters: without it, an agent facing real ambiguity
    // reinvents the gate to resolve it.
    expect(brainstorm).toMatch(/missed clarifying question/i);
  });

  it("states the design and hands back in one message", () => {
    expect(brainstorm).toMatch(
      /same message that hands back|State the design and hand back/i,
    );
  });

  it("no longer asks for approval after each design section", () => {
    expect(brainstorm).not.toMatch(/approval after each section/i);
    expect(brainstorm).not.toMatch(/Ask after each section/i);
    expect(brainstorm).not.toMatch(/Section-by-section approval/i);
  });
});

describe("autopilot orchestrator starts Phase 2 without re-confirming", () => {
  it("tells the controller not to ask whether to proceed", () => {
    expect(orchestrator).toMatch(/do not ask whether to proceed/i);
  });

  it("keeps the `design approved` ledger entry that nextStage matches on", () => {
    // Renaming this entry would break resume: nextStage reads it to decide a
    // run has cleared Phase 1 and belongs at `setup`.
    expect(orchestrator).toContain("`design approved`");
  });

  it("describes the brainstorm as asking rather than seeking approval", () => {
    expect(orchestrator).toMatch(/does not ask for design approval/i);
  });

  it("drops the claim that sections were approved individually", () => {
    expect(orchestrator).not.toMatch(/every section was approved/i);
    expect(orchestrator).not.toMatch(/last section's approval/i);
  });
});
