// The `sdd` dispatch carries a verification contract: four rules that stop the
// dispatched agent from narrating verification into the developer's transcript.
// The contract is prose, so nothing else fails if it is deleted, reworded past
// recognition, or dropped from the dispatch — where a dispatched agent would
// never read it.
//
// The contract text lives in `references/dispatch/sdd-verification.md` and is
// appended to the subagent definition with `cat`, so it never passes through
// the orchestrator's context. `sectionOf` resolves the fragments the section
// names, so these assertions still prove the rule reaches the dispatched agent.
// They match on load-bearing phrases, not full sentences, so ordinary editing
// does not break them but removal does.

import { describe, it, expect } from "vitest";
import { readSkill, sectionOf } from "./skill-sections.mjs";

describe("sdd dispatch verification contract", () => {
  // `sectionOf` resolves the `references/dispatch/*.md` fragments the section
  // names, inlining each where it is named. The contract now travels to the
  // dispatched agent by `cat` rather than inline prose, and this follows that
  // route — so "lives in the sdd section" keeps its original meaning.
  const section = sectionOf(readSkill(), "sdd");

  it("names test_command as the verification gate", () => {
    expect(section).toContain("test_command");
  });

  it("forbids narrating verification", () => {
    expect(section).toMatch(/do not narrate/i);
  });

  it("names the specific noise patterns it forbids", () => {
    // Naming them is the point — a general "be concise" does not bind an
    // agent that believes each individual check is justified.
    expect(section).toMatch(/md5/i);
    expect(section).toMatch(/echo/i);
    expect(section).toMatch(/idempotence/i);
  });

  it("forbids throwaway repositories for proving guards fire", () => {
    expect(section).toMatch(/throwaway/i);
  });

  it("keeps the contract inside the sdd section, not merely in the file", () => {
    // A rule outside the `sdd` section never reaches the dispatched agent.
    expect(section).toMatch(/verification contract/i);
  });
});
