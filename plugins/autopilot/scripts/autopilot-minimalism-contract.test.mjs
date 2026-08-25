// SKILL.md carries two minimalism blocks: a decomposition ladder in the `plan`
// section and a fourth contract in the `sdd` section. Both are prose, so
// nothing else fails if they are deleted, reworded past recognition, or moved
// out of the section where a dispatched agent would actually read them.
//
// This test matches load-bearing phrases, not full sentences, so ordinary
// editing does not break it but removal does. Every assertion is scoped to a
// sub-slice of its section rather than the section as a whole: `implement`,
// `implement_complex`, `task_review`, `re_review` and `final_review` all
// already appear in the `sdd` model-mapping contract, so a section-wide
// `toContain` would have passed before this feature existed.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { readSkill, sectionOf as section } from "./skill-sections.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const README_PATH = join(HERE, "..", "..", "..", "README.md");

/**
 * The minimalism contract the `sdd` dispatch carries, and nothing before it.
 *
 * `section` resolves the `references/dispatch/*.md` fragments the stage names,
 * inlining each where it is named — so the gating paragraph in SKILL.md and the
 * ladder fragments it `cat`s land in the order the dispatch assembles them, and
 * this slice sees both.
 */
function minimalismContract(markdown) {
  const sdd = section(markdown, "sdd");
  const start = /minimalism contract/i.exec(sdd);
  if (!start) throw new Error("the sdd section carries no minimalism contract");
  const rest = sdd.slice(start.index);
  const end = /\nAnswer these gates/.exec(rest);
  return end ? rest.slice(0, end.index) : rest;
}

describe("sdd minimalism contract", () => {
  const contract = minimalismContract(readSkill());

  it("emits nothing at all when the mode is off", () => {
    expect(contract).toContain("minimalism.mode");
    expect(contract).toMatch(/include nothing/i);
  });

  it("grades the two modes that do emit", () => {
    expect(contract).toMatch(/`lite`/);
    expect(contract).toMatch(/`full`/);
  });

  it("scopes the contract to implementer dispatches only", () => {
    expect(contract).toMatch(/implementer dispatches only/i);
    expect(contract).toContain("implement_complex");
  });

  it("names all three excluded review roles", () => {
    expect(contract).toContain("task_review");
    expect(contract).toContain("re_review");
    expect(contract).toContain("final_review");
  });

  it("gives the reason for the exclusion, so it is not generalized away", () => {
    // An unexplained exclusion gets "helpfully" extended by the agent applying
    // it; the reason is what stops that.
    expect(contract).toMatch(/approves under-built work/i);
  });

  it("carries the four lite rungs", () => {
    expect(contract).toMatch(/the code you never wrote/i);
    expect(contract).toMatch(/Extend what exists/i);
    expect(contract).toMatch(/smallest thing that satisfies the task/i);
    expect(contract).toMatch(/only for a caller that exists today/i);
  });

  it("carries the three further full rungs", () => {
    expect(contract).toMatch(/Prefer the diff that removes lines/i);
    expect(contract).toMatch(/without a named present-day/i);
    expect(contract).toMatch(/No speculative error handling/i);
  });

  it("states the plan-governs rule", () => {
    expect(contract).toMatch(/Plan governs/i);
    expect(contract).toMatch(/Implement every task the plan states/i);
    expect(contract).toMatch(/implement it anyway/i);
  });

  it("routes an unnecessary task to findings.jsonl against the plan stage", () => {
    expect(contract).toContain("findings.jsonl");
    expect(contract).toContain("stage_at_fault");
    expect(contract).toContain("plan specified unnecessary work");
    expect(contract).toContain('"stage_at_fault":"plan"');
  });
});

/** The minimalism ladder inside the `plan` section, and nothing before it. */
function planLadder(markdown) {
  const plan = section(markdown, "plan");
  const start = /minimalism ladder/i.exec(plan);
  if (!start) throw new Error("the plan section carries no minimalism ladder");
  const rest = plan.slice(start.index);
  const end = /\nThe dispatch prompt also carries a learnings instruction/.exec(rest);
  return end ? rest.slice(0, end.index) : rest;
}

describe("plan minimalism ladder", () => {
  const skill = readSkill();
  const ladder = planLadder(skill);

  it("emits nothing at all when the mode is off", () => {
    expect(ladder).toContain("minimalism.mode");
    expect(ladder).toMatch(/include nothing/i);
  });

  it("sits alongside the task-count budget, in the same section", () => {
    // Two instructions about how many tasks to plan reach the plan agent
    // together or not at all.
    expect(section(skill, "plan")).toMatch(/Task-count budget for this plan/);
  });

  it("carries the four lite rungs", () => {
    expect(ladder).toMatch(/Prefer no task/i);
    expect(ladder).toMatch(/Prefer fewer tasks/i);
    expect(ladder).toMatch(/smallest task that satisfies the spec/i);
    expect(ladder).toMatch(/abstraction with one consumer/i);
  });

  it("carries the two further full rungs", () => {
    expect(ladder).toMatch(/Prefer plans that delete/i);
    expect(ladder).toMatch(/Correctness outranks minimalism/i);
  });

  it("keeps the decomposition ladder distinct from the sdd code ladder", () => {
    // The plan ladder is about which tasks are worth planning; the sdd
    // contract is about how code gets written. Collapsing them loses one.
    expect(ladder).not.toMatch(/implementer dispatches only/i);
  });
});

describe("README ponytail documentation", () => {
  const readme = readFileSync(README_PATH, "utf8");

  /** The ponytail subsection: its heading to the next heading of any level. */
  const ponytailSection = () => {
    const start = /^#### Pointing ponytail at/m.exec(readme);
    if (!start) throw new Error("README has no ponytail subsection");
    const rest = readme.slice(start.index);
    const end = /\n#{1,4} .*$/m.exec(rest.slice(start[0].length));
    return end ? rest.slice(0, start[0].length + end.index) : rest;
  };
  const ponytail = ponytailSection();

  it("documents the optional matcher export", () => {
    expect(ponytail).toContain("PONYTAIL_SUBAGENT_MATCHER");
    expect(ponytail).toContain("^autopilot-(plan|implement|implement_complex)$");
  });

  it("states that ponytail is optional and never required", () => {
    expect(ponytail).toMatch(/optional and never required/i);
  });

  it("states that the matcher excludes the three reviewer roles", () => {
    expect(ponytail).toMatch(/exclude/i);
    expect(ponytail).toContain("task_review");
    expect(ponytail).toContain("re_review");
    expect(ponytail).toContain("final_review");
  });

  it("warns that ponytail's own default is every subagent", () => {
    // Unset is not "off", it is "all", reviewers included. Omitting the
    // variable is the failure mode, so the README has to say so.
    expect(ponytail).toMatch(/unset/i);
    expect(ponytail).toMatch(/must be \*\*set\*\*/i);
  });

  it("documents the minimalism.mode key in the configuration table", () => {
    expect(readme).toMatch(/\| `minimalism\.mode` \| `off` \|/);
  });
});
