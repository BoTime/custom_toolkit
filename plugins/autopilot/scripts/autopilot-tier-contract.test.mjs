// The tier ladder reaches its agents entirely as prose: a task-count ceiling
// the `plan` dispatch carries, and a review-depth instruction the `sdd`
// dispatch carries at exactly one task. Nothing else fails if that prose is
// deleted, reworded past recognition, or gated onto the wrong stage — the run
// simply decomposes as it always did, and nobody finds out.
//
// These assertions compose the real definition from the real files, the way
// autopilot-dispatch.mjs does, and read the result.

import { describe, it, expect } from "vitest";
import { compose } from "./autopilot-dispatch.mjs";
import { composeStage, defaultConfig, dummyValues } from "./dispatch-fixture.mjs";

const plan = (tier, opts) => composeStage("plan", { extraValues: { tier }, ...opts });

describe("the plan tier budgets", () => {
  it("states each tier's configured ceiling as a number", () => {
    // AC9
    for (const [tier, ceiling] of Object.entries({ small: 1, standard: 3, large: 5 })) {
      expect(plan(tier)).toContain(`The ceiling for this plan is **${ceiling}**.`);
    }
  });

  it("renders a tuned ceiling rather than a number baked into the text", () => {
    // AC9 — the config knob has to actually reach the prompt.
    const out = compose({
      stage: "plan",
      config: defaultConfig({ tiers: { small: 1, standard: 4, large: 5 } }),
      values: { ...dummyValues("plan"), tier: "standard" },
      worktreeHas: () => true,
    });
    expect(out).toContain("The ceiling for this plan is **4**.");
    expect(out).not.toContain("The ceiling for this plan is **3**.");
    // The escalation target's ceiling is rendered from config too.
    expect(out).toContain("more than 5 tasks");
  });

  it("leaves no placeholder unrendered in any tier's budget", () => {
    // render() leaves an unfilled placeholder in place, so a stray marker
    // would ship to the agent literally.
    for (const tier of ["small", "standard", "large"]) {
      expect(plan(tier)).not.toContain("{{");
    }
  });

  it("gives small and standard the one-step escalation rule, naming the target tier", () => {
    // AC10
    expect(plan("small")).toMatch(/escalat/i);
    expect(plan("small")).toContain("tier `standard`");
    expect(plan("small")).toContain("escalated to standard: <reason>");
    expect(plan("small")).toContain("## Escalation");
    expect(plan("small")).toMatch(/at most once|never moves more than one step/i);

    expect(plan("standard")).toMatch(/escalat/i);
    expect(plan("standard")).toContain("tier `large`");
    expect(plan("standard")).toContain("escalated to large: <reason>");
    expect(plan("standard")).toContain("## Escalation");
    expect(plan("standard")).toMatch(/at most once|never moves more than one step/i);
  });

  it("gives large no escalation rule at all", () => {
    // AC10 — large has nowhere to escalate to, and a rule naming a tier that
    // does not exist is worse than no rule.
    const large = plan("large");
    expect(large).not.toMatch(/escalat/i);
    expect(large).toContain("This is a budget, not a cap.");
  });

  it("keeps correctness above the ceiling in every tier", () => {
    // Whitespace-tolerant: the three fragments wrap this sentence at
    // different columns, and the assertion is about the sentence reaching the
    // agent, not about where markdown happens to break the line.
    for (const tier of ["small", "standard", "large"]) {
      expect(plan(tier)).toMatch(/cannot\s+be\s+reviewed\s+as\s+one\s+diff\s+is\s+two\s+tasks/);
    }
  });
});

describe("the sdd single-review contract", () => {
  const single = composeStage("sdd", { extraValues: { tasks: "1" } });

  it("names final_review as the review that runs", () => {
    // AC11
    expect(single).toContain("`final_review`");
    expect(single).toMatch(/one review, not two/i);
  });

  it("names task_review as the dispatch that is skipped", () => {
    // AC11
    expect(single).toMatch(/[Ss]kip the per-task `task_review` dispatch/);
  });

  it("keeps the fix-round machinery explicitly unchanged", () => {
    // The saving is one review dispatch, not the loop that acts on findings.
    expect(single).toContain("`re_review`");
    expect(single).toContain("`fix_escalation`");
    // sdd-body.md also says "round-5 breaker", so match the phrasing that is
    // unique to this fragment — otherwise deleting the fragment leaves this
    // assertion green.
    expect(single).toContain("the round-5 breaker still applies");
  });

  it("is absent from a two-task dispatch", () => {
    expect(composeStage("sdd", { extraValues: { tasks: "2" } }))
      .not.toMatch(/one review, not two/i);
  });
});
