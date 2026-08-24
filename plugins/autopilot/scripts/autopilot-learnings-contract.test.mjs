// SKILL.md carries the learnings loop in prose across two places: the
// `learnings` stage (which dispatches a role to rewrite
// `docs/autopilot/learnings.md`) and the `plan` stage's dispatch prompt (which
// instructs the plan agent to read that doc). Both are prose, so nothing else
// fails if they are deleted or reworded past recognition — the pipeline would
// simply stop feeding run learnings back into planning, and the findings corpus
// would keep naming the same mistakes without anyone applying them.
//
// This test reads SKILL.md and asserts the load-bearing pieces are present in
// the right sections. It matches on phrases, not full sentences, so ordinary
// editing does not break it but removal does.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const SKILL_PATH = join(HERE, "..", "skills", "autopilot", "SKILL.md");

// SKILL.md is hard-wrapped prose, so a pinned phrase routinely straddles a
// newline. Collapse whitespace before matching; otherwise a reflow that changes
// no words at all would fail these tests.
const unwrap = (s) => s.replace(/\s+/g, " ");

/**
 * A `### \`<name>\`` stage section: from its heading line to the next heading
 * at the same level or shallower. Anchored so a rule outside the section never
 * satisfies an assertion that is supposed to prove it lives inside it.
 */
function stageSection(markdown, name) {
  const heading = `### \`${name}\``;
  const start = markdown.indexOf(heading);
  if (start === -1) throw new Error(`SKILL.md has no \`${heading}\` section`);
  const rest = markdown.slice(start + heading.length);
  const end = /\n#{1,3} /.exec(rest);
  return end ? rest.slice(0, end.index) : rest;
}

const skill = readFileSync(SKILL_PATH, "utf8");

describe("learnings dispatch prompt", () => {
  const sectionText = unwrap(stageSection(skill, "learnings"));

  it("names the corpus file and its main-checkout placement", () => {
    expect(sectionText).toContain("findings.jsonl");
    expect(sectionText).toMatch(/main checkout/i);
  });

  it("names the two doc sections", () => {
    expect(sectionText).toContain("Planning rules");
    expect(sectionText).toContain("Recent runs");
  });

  it("carries the bounded-rewrite instruction", () => {
    expect(sectionText).toMatch(/condense/i);
    expect(sectionText).toMatch(/not endlessly appended/i);
  });

  it("says the doc is written inside the worktree and committed to the branch", () => {
    expect(sectionText).toMatch(/inside the worktree/i);
    expect(sectionText).toMatch(/commit it to the branch/i);
  });

  it("keeps the learnings stage inside its own section, not merely in the file", () => {
    expect(sectionText).toMatch(/learnings committed/i);
  });

  it("records the non-parking failure mode", () => {
    expect(sectionText).toMatch(/does not park/i);
    expect(sectionText).toContain("learnings failed — <reason>");
  });
});

describe("plan dispatch prompt reads the learnings doc", () => {
  const planText = unwrap(stageSection(skill, "plan"));

  it("instructs the plan agent to read the learnings doc", () => {
    expect(planText).toContain("docs/autopilot/learnings.md");
  });

  it("tells it to apply the planning rules", () => {
    expect(planText).toMatch(/planning rules/i);
  });

  it("handles absence — no error, no parking", () => {
    expect(planText).toMatch(/if present/i);
    expect(planText).toMatch(/plan without/i);
  });

  it("does not displace the existing task-count budget", () => {
    expect(planText).toMatch(/task-count budget/i);
  });
});

describe("the sdd section resumes sdd completion into learnings", () => {
  const sddText = unwrap(stageSection(skill, "sdd"));

  it("redirects sdd completion to the learnings stage", () => {
    // Load-bearing redirect: `nextStage` resumes a run ending in `sdd complete`
    // at `learnings`, not `land`. Without this guard, an edit reverting the
    // prose to `land` would pass every other test.
    expect(sddText).toMatch(/resume the run at `learnings`/i);
  });
});

describe("the resume section lists the learnings stage", () => {
  const whole = unwrap(skill);

  it("counts eleven values and nine stages", () => {
    expect(whole).toMatch(/one of eleven values/i);
    expect(whole).toMatch(/the nine stages/i);
  });
});
