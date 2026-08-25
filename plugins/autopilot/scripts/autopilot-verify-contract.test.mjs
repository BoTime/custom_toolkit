// SKILL.md's `verify` section carries the browser-verification contract: the
// rules that keep a dispatched agent from dumping a page into its context, and
// the outcome table that decides park-vs-fix. The contract is prose, so nothing
// else fails if it is deleted or reworded past recognition — the stage would
// simply start reading full DOM snapshots and compacting mid-run, or start
// retrying a red branch until it went green.
//
// This test reads SKILL.md and asserts the load-bearing pieces are present
// within the `verify` section, where a dispatched agent will actually read
// them, and that the ledger strings it prescribes still match `nextStage`.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parseLedger, nextStage } from "./autopilot-ledger.mjs";
import { EXIT, RECIPE_KEYS } from "./autopilot-verify.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const SKILL_PATH = join(HERE, "..", "skills", "autopilot", "SKILL.md");
const GITHUB_SKILL_PATH = join(HERE, "..", "skills", "autopilot-github", "SKILL.md");

// SKILL.md is hard-wrapped prose, so a pinned phrase routinely straddles a
// newline. Collapse whitespace before matching; otherwise a reflow that changes
// no words at all would fail these tests.
const unwrap = (s) => s.replace(/\s+/g, " ");

/**
 * Blank out fenced code blocks, preserving offsets.
 *
 * The `spec` section embeds a markdown example that contains a literal
 * `## Acceptance criteria` line. Without masking, the boundary search below
 * treats that example as the start of the next section and truncates the
 * section to a few lines — so a rule further down would read as absent and
 * this test would pass a contract nobody wrote.
 */
function maskFences(markdown) {
  return markdown.replace(/^```[\s\S]*?^```/gm, (block) => block.replace(/[^\n]/g, " "));
}

/**
 * A stage section: from its heading to the next heading at the same level or
 * shallower. Anchored at line starts for the same reason as the other contract
 * tests — a rule outside this section never reaches the dispatched agent.
 */
function section(markdown, heading) {
  const masked = maskFences(markdown);
  const startMatch = new RegExp(`^### \`${heading}\`.*$`, "m").exec(masked);
  if (!startMatch) throw new Error(`SKILL.md has no \`${heading}\` stage section`);
  const after = masked.slice(startMatch.index + startMatch[0].length);
  const endMatch = /\n#{1,3} .*$/m.exec(after);
  const end = endMatch
    ? startMatch.index + startMatch[0].length + endMatch.index
    : markdown.length;
  return markdown.slice(startMatch.index, end);
}

const skill = readFileSync(SKILL_PATH, "utf8");
const verify = unwrap(section(skill, "verify"));
const whole = unwrap(skill);

describe("verify stage placement", () => {
  it("runs after sdd and before learnings", () => {
    const order = ["### `sdd`", "### `verify`", "### `learnings`", "### `land`", "### `pr`"]
      .map((h) => skill.indexOf(h));
    expect(order.every((i) => i > 0)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  // The previous design verified the rebased branch. Moving earlier trades
  // that away deliberately; the section must name the trade rather than
  // quietly dropping the old rationale.
  it("names what moving it before land costs", () => {
    expect(verify).toMatch(/pre-rebase|before `?land/i);
    expect(verify).toMatch(/rebase/i);
  });

  it("says learnings runs after it so the browser evidence is distillable", () => {
    expect(verify).toMatch(/learnings/i);
  });
});

describe("verify token contract", () => {
  it("forbids reading a full DOM or accessibility dump", () => {
    expect(verify).toMatch(/never read a full-page dom or accessibility dump/i);
  });

  it("names the scoped, grepped snapshot as the only escape hatch", () => {
    expect(verify).toMatch(/ariaSnapshot/);
    expect(verify).toMatch(/grep/i);
  });

  it("forbids reading screenshots and the raw results file back", () => {
    expect(verify).toMatch(/never read a screenshot back/i);
    expect(verify).toMatch(/never read `results\.json` whole/i);
  });

  it("tells the agent to derive locators from worktree source", () => {
    expect(verify).toMatch(/derive locators from the worktree source/i);
    expect(verify).toMatch(/getByRole/);
  });

  it("forbids the agent authoring a playwright config the script generates", () => {
    expect(verify).toMatch(/do not write a playwright config/i);
  });
});

describe("verify prerequisites", () => {
  it("names @playwright/test as the project's responsibility", () => {
    expect(verify).toMatch(/@playwright\/test/);
    expect(verify).toMatch(/resolvable from the project/i);
    expect(verify).toMatch(/exit 4/i);
  });

  // A run that installs its own tooling produces a green nobody can reproduce,
  // and downloads hundreds of megabytes nobody approved.
  it("forbids autopilot installing it", () => {
    expect(verify).toMatch(/autopilot never installs it/i);
  });

  it("explains how out-of-tree specs resolve the project's modules", () => {
    expect(verify).toMatch(/symlinks the project's `node_modules`/i);
  });
});

describe("verify artifact placement", () => {
  it("keeps specs and fixtures in the run directory, out of the repository", () => {
    expect(verify).toMatch(/main checkout/i);
    expect(verify).toContain(".superpowers/autopilot/<run>/verify/");
    expect(verify).toMatch(/nothing is committed/i);
  });

  // Same harness constraint the ledger documents: Write/Edit cannot reach the
  // main checkout from a worktree session, but Bash redirects can.
  it("names the Bash heredoc as how spec files get written", () => {
    expect(verify).toMatch(/cannot write or edit into the main checkout/i);
    expect(verify).toMatch(/heredoc/i);
  });
});

describe("verify outcomes", () => {
  it("distinguishes infrastructure failure from a failed criterion", () => {
    expect(verify).toMatch(/infrastructure/i);
    expect(verify).toMatch(/one fix round/i);
    expect(verify).toMatch(/not a fix round/i);
  });

  // Without the flag the re-run is indistinguishable from the first run at the
  // findings level, and one twice-failing criterion clusters as two.
  it("tells the re-run to declare itself round 2", () => {
    expect(verify).toContain("--round=2");
    expect(verify).toMatch(/re-run the script \*{0,2}with `?--round=2/i);
  });

  it("caps the fix round at one, then parks", () => {
    expect(verify).toMatch(/one round/i);
    expect(verify).toContain("PARKED — verify red after fix round");
  });

  it("treats an uncovered criterion as a failure, not a pass", () => {
    expect(verify).toMatch(/not covered.*not a pass|is a failure of this stage/i);
  });

  it("reuses the four existing stage_at_fault values and the seven fields", () => {
    expect(verify).toMatch(/invent no new value/i);
    expect(verify).toContain("findings.jsonl");
    expect(verify).toContain('"task": 0, "clean": true');
    for (const field of [
      "task", "round", "severity", "stage_at_fault", "pattern", "detail", "verdict",
    ]) {
      expect(verify).toContain(field);
    }
  });

  it("documents every exit code the script can return", () => {
    for (const code of Object.values(EXIT)) {
      expect(verify).toMatch(new RegExp(`\\|\\s*${code}\\s*\\|`));
    }
  });
});

describe("verify gating", () => {
  // The one-sentence enablement answer. A feature whose activation rule is
  // only inferable from source is one most users never knowingly turn on.
  it("says a (ui) acceptance criterion is what turns the stage on", () => {
    expect(verify).toMatch(/writing a `?\(ui\)`? acceptance criterion/i);
    expect(verify).toMatch(/nothing to configure|no flag/i);
  });

  // The `pr` stage claims the verification section is written here in both the
  // passing and the skipped case. That is only true if the skip path is told to
  // run the subcommand that writes it.
  it("tells a skipping run to write its pr section too", () => {
    expect(verify).toMatch(/autopilot-verify\.mjs" skip/);
    expect(verify).toContain("pr-section.md");
  });

  it("skips a spec with no ui criteria and parks one that cannot be verified", () => {
    expect(verify).toMatch(/skipped \(no ui criteria\)/);
    expect(verify).toMatch(/PARKED — verify cannot run/);
  });

  it("explains why a skip must still append a ledger line", () => {
    expect(verify).toMatch(/back through `?verify`? forever|forever/i);
  });

  it("names the recipe the plan stage derived and its required keys", () => {
    expect(verify).toContain(".superpowers/autopilot/<run>/verify/recipe.json");
    for (const key of RECIPE_KEYS) expect(verify).toContain(key);
    expect(verify).toContain("stop_command");
    expect(verify).toContain("seed_command");
  });

  // Both lifecycle corrections. Neither is checkable from code alone: the
  // section is what tells a resuming orchestrator not to "fix" them.
  it("says a clean dev_command exit is setup finishing, not a death", () => {
    expect(verify).toMatch(/clean `?dev_command`? exit means setup finished/i);
    expect(verify).toMatch(/only a non-zero exit is a failure/i);
  });

  it("says teardown runs stop_command in a finally", () => {
    expect(verify).toMatch(/`stop_command` in a `finally`/);
    expect(verify).toMatch(/falling back to killing the process group/i);
  });

  it("says the base url is resolved in the worktree after dev_command", () => {
    expect(verify).toMatch(/in the worktree, after `?dev_command`?/i);
    expect(verify).toMatch(/never written down|never persisted/i);
  });
});

describe("spec stage supplies the criteria verify reads", () => {
  const spec = unwrap(section(skill, "spec"));

  it("requires an acceptance criteria section", () => {
    expect(spec).toContain("## Acceptance criteria");
  });

  it("requires a ui/non-ui tag on every criterion and rejects an untagged one", () => {
    expect(spec).toMatch(/\(ui\)/);
    expect(spec).toMatch(/\(non-ui\)/);
    expect(spec).toMatch(/untagged criterion is an error/i);
  });

  it("is echoed by the github wrapper, which sources criteria from the issue", () => {
    const github = unwrap(readFileSync(GITHUB_SKILL_PATH, "utf8"));
    expect(github).toContain("## Acceptance criteria");
    expect(github).toMatch(/come from GitHub issue/i);
  });
});

describe("SKILL.md <-> nextStage coupling for verify", () => {
  const HEADER = "# autopilot run — task: x";
  const upTo = (entry) =>
    [
      HEADER,
      "2026-08-24T10:00:00Z  started (phase 1)",
      "2026-08-24T10:01:00Z  design approved",
      "2026-08-24T10:02:00Z  worktree: .claude/worktrees/x (branch x)",
      "2026-08-24T10:03:00Z  spec committed → docs/x.md",
      "2026-08-24T10:04:00Z  plan complete → docs/y.md",
      "2026-08-24T10:05:00Z  sdd complete (3 tasks, 0 parked)",
      ...(entry ? [`2026-08-24T10:06:00Z  ${entry}`] : []),
    ].join("\n");

  it("resumes at verify once sdd has finished", () => {
    expect(nextStage(parseLedger(upTo(null)))).toBe("verify");
  });

  // Every ledger string the section tells the orchestrator to append must
  // clear the stage. A skip line that did not would loop the resume forever.
  it.each([
    "verify: 3/3 ui criteria passed",
    "verify: skipped (no ui criteria)",
  ])('"%s" advances the run to learnings', (entry) => {
    expect(nextStage(parseLedger(upTo(entry)))).toBe("learnings");
  });

  it("parks on the verify park lines", () => {
    expect(nextStage(parseLedger(upTo("PARKED — verify red after fix round: AC3")))).toBe("parked");
  });

  it("lists verify among the stages the resume section documents", () => {
    expect(whole).toMatch(/one of eleven values/i);
    expect(whole).toMatch(/the nine stages/i);
    expect(whole).toMatch(/`sdd`, `verify`, `learnings`/);
  });
});

describe("pr stage carries the verification result", () => {
  it("concatenates the section the verify stage wrote rather than formatting one", () => {
    const pr = unwrap(skill.slice(skill.indexOf("### `pr`")));
    expect(pr).toContain("verify/pr-section.md");
    expect(pr).toMatch(/this stage formats nothing/i);
  });

  it("is honest that screenshots do not reach the PR", () => {
    const pr = unwrap(skill.slice(skill.indexOf("### `pr`")));
    expect(pr).toMatch(/stay local to the run directory and are \*{0,2}not\*{0,2} attached/i);
  });
});

describe("parking conditions include the verify failures", () => {
  const parking = unwrap(skill.slice(skill.indexOf("## Parking")));

  it("counts the conditions it lists", () => {
    expect(parking).toMatch(/nine conditions park a run/i);
  });

  it("lists each verify park reason", () => {
    expect(parking).toMatch(/no usable `## Acceptance criteria` section/i);
    expect(parking).toMatch(/cannot be verified/i);
    expect(parking).toMatch(/dev server never answered/i);
    expect(parking).toMatch(/still failing after the one fix round/i);
  });
});

describe("plan stage derives the verify recipe", () => {
  const plan = unwrap(section(skill, "plan"));

  it("writes it to the per-run verify directory in the main checkout", () => {
    expect(plan).toContain(".superpowers/autopilot/<run>/verify/recipe.json");
    expect(plan).toMatch(/main checkout/i);
  });

  // Same harness constraint as the ledger: Write/Edit cannot reach the main
  // checkout from a worktree session, but Bash redirects can.
  it("names the Bash heredoc as how the file gets written", () => {
    expect(plan).toMatch(/heredoc/i);
  });

  it("names every recipe key and which two are required", () => {
    for (const key of [...RECIPE_KEYS, "stop_command", "seed_command"]) {
      expect(plan).toContain(key);
    }
    expect(plan).toMatch(/required/i);
  });

  it("tells the stage where to read the project's dev setup from", () => {
    expect(plan).toMatch(/package\.json/);
    expect(plan).toMatch(/README/);
  });

  // Rederived, not committed: a committed recipe is a second copy of the dev
  // setup that drifts silently, because nothing runs it except autopilot.
  it("says it is rederived every run and never committed", () => {
    expect(plan).toMatch(/rederived|derived every run/i);
    expect(plan).toMatch(/never committed|not committed/i);
  });

  it("skips the derivation when the spec declares no ui criteria", () => {
    expect(plan).toMatch(/\(ui\)/);
  });
});
