// Two minimalism blocks reach dispatched agents: a decomposition ladder the
// `plan` dispatch carries and a fourth contract the `sdd` dispatch carries.
// Both are prose, so nothing else fails if they are deleted, reworded past
// recognition, or dropped from the stage whose agent would actually read them.
//
// This test composes each stage the way `autopilot-dispatch.mjs` does, at
// `minimalism.mode` `full`, and asserts on what the dispatch actually carries.
// The mode gating itself needs no slicing any more: at mode `off` the composed
// definition carries no ladder at all, which is a stronger pin than prose
// saying so. What remains in SKILL.md — the sentence naming the two modes that
// emit — is asserted against SKILL.md.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { readSkill, sectionOf as section } from "./skill-sections.mjs";
import { composeStage } from "./dispatch-fixture.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const README_PATH = join(HERE, "..", "..", "..", "README.md");

describe("sdd minimalism contract", () => {
  const contract = composeStage("sdd", { minimalism: { mode: "full" } });

  it("emits no contract at all when the mode is off", () => {
    const off = composeStage("sdd", { minimalism: { mode: "off" } });
    expect(off).not.toMatch(/implementer dispatches only/i);
    expect(off).not.toMatch(/the code you never wrote/i);
  });

  it("grades the two modes that do emit", () => {
    // Orchestrator-facing: the mode gate is SKILL.md's, not the agent's.
    const sdd = section(readSkill(), "sdd");
    expect(sdd).toMatch(/`lite`/);
    expect(sdd).toMatch(/`full`/);
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

describe("plan minimalism ladder", () => {
  const ladder = composeStage("plan", { minimalism: { mode: "full" } });

  it("emits no ladder at all when the mode is off", () => {
    const off = composeStage("plan", { minimalism: { mode: "off" } });
    expect(off).not.toMatch(/Prefer no task/i);
    expect(off).not.toMatch(/Prefer plans that delete/i);
  });

  it("sits alongside the task-count budget in the same definition", () => {
    // Two instructions about how many tasks to plan reach the plan agent
    // together or not at all.
    expect(ladder).toMatch(/Task-count budget for this plan/);
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
