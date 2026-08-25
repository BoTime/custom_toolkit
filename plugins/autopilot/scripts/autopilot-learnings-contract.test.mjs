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

// `stageSection` resolves the `references/dispatch/*.md` fragments a stage
// names, inlining each where it is named — the plan stage's learnings
// instruction reaches its agent by `cat` now, and this follows that route.

import { describe, it, expect } from "vitest";
import { readSkill, sectionOf as stageSection, unwrap } from "./skill-sections.mjs";

const skill = readSkill();

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

describe("the sdd section resumes sdd completion into verify", () => {
  const sddText = unwrap(stageSection(skill, "sdd"));

  it("redirects sdd completion to the verify stage", () => {
    // Load-bearing redirect: `nextStage` resumes a run ending in `sdd complete`
    // at `verify`, which then hands off to `learnings`. Without this guard, an
    // edit reverting the prose to `learnings` or `land` would pass every other
    // test.
    expect(sddText).toMatch(/resume the run at `verify`/i);
  });
});

describe("the resume section lists the learnings stage", () => {
  const whole = unwrap(skill);

  it("counts eleven values and nine stages", () => {
    expect(whole).toMatch(/one of eleven values/i);
    expect(whole).toMatch(/the nine stages/i);
  });
});
