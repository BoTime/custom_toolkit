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

const HERE = dirname(fileURLToPath(import.meta.url));
const SKILL_PATH = join(HERE, "..", "skills", "autopilot", "SKILL.md");
const README_PATH = join(HERE, "..", "..", "..", "README.md");

/**
 * The `### \`<heading>\`` section: from its heading line to the next heading at
 * the same level or shallower (`###`, `##`, or `#`), both anchored to the start
 * of a line. The end anchor accepts shallower headings so that promoting a
 * following section cannot widen this one and let text living elsewhere satisfy
 * assertions that are supposed to prove where it lives.
 */
function section(markdown, heading) {
  const start = new RegExp("^### `" + heading + "`.*$", "m").exec(markdown);
  if (!start) throw new Error("SKILL.md has no ### " + heading + " section");
  const rest = markdown.slice(start.index);
  const end = /\n#{1,3} .*$/m.exec(rest.slice(start[0].length));
  return end ? rest.slice(0, start[0].length + end.index) : rest;
}

/** The minimalism contract inside the `sdd` section, and nothing before it. */
function minimalismContract(markdown) {
  const sdd = section(markdown, "sdd");
  const start = /minimalism contract/i.exec(sdd);
  if (!start) throw new Error("the sdd section carries no minimalism contract");
  const rest = sdd.slice(start.index);
  const end = /\nAnswer these gates/.exec(rest);
  return end ? rest.slice(0, end.index) : rest;
}

describe("sdd minimalism contract", () => {
  const contract = minimalismContract(readFileSync(SKILL_PATH, "utf8"));

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
