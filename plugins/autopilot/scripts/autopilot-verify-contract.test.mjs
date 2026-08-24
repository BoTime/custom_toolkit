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
import { EXIT } from "./autopilot-verify.mjs";
import { BROWSER_KEYS } from "./autopilot-config.mjs";

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
  it("runs after land and before pr", () => {
    const order = ["### `land`", "### `verify`", "### `pr`"].map((h) => skill.indexOf(h));
    expect(order.every((i) => i > 0)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it("says why it runs on the landed branch rather than before the rebase", () => {
    expect(verify).toMatch(/after\*{0,2} `?land/i);
    expect(verify).toMatch(/semantic conflict|rebases clean/i);
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

  it("caps the fix round at one, then parks", () => {
    expect(verify).toMatch(/one round/i);
    expect(verify).toContain("PARKED — verify red after fix round");
  });

  it("treats an uncovered criterion as a failure, not a pass", () => {
    expect(verify).toMatch(/not covered.*not a pass|is a failure of this stage/i);
  });

  it("reuses the four existing stage_at_fault values", () => {
    expect(verify).toMatch(/invent no new value/i);
    expect(verify).toContain("findings.jsonl");
  });

  it("documents every exit code the script can return", () => {
    for (const code of Object.values(EXIT)) {
      expect(verify).toMatch(new RegExp(`\\|\\s*${code}\\s*\\|`));
    }
  });
});

describe("verify gating", () => {
  it("skips an unconfigured project but parks a half-configured one", () => {
    expect(verify).toMatch(/skipped \(browser not configured\)/);
    expect(verify).toMatch(/browser config incomplete/);
  });

  it("explains why a skip must still append a ledger line", () => {
    expect(verify).toMatch(/back through `?verify`? forever|forever/i);
  });

  it("names the browser keys the project must supply", () => {
    for (const key of BROWSER_KEYS) expect(verify).toContain(key);
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
      "2026-08-24T10:06:00Z  learnings committed → docs/autopilot/learnings.md",
      "2026-08-24T10:07:00Z  rebase clean, tests green (12 passed)",
      ...(entry ? [`2026-08-24T10:08:00Z  ${entry}`] : []),
    ].join("\n");

  it("resumes at verify once the branch has landed", () => {
    expect(nextStage(parseLedger(upTo(null)))).toBe("verify");
  });

  // Every ledger string the section tells the orchestrator to append must
  // clear the stage. A skip line that did not would loop the resume forever.
  it.each([
    "verify: 3/3 ui criteria passed",
    "verify: skipped (no ui criteria)",
    "verify: skipped (browser not configured)",
  ])('"%s" advances the run to pr', (entry) => {
    expect(nextStage(parseLedger(upTo(entry)))).toBe("pr");
  });

  it("parks on the verify park lines", () => {
    expect(nextStage(parseLedger(upTo("PARKED — verify red after fix round: AC3")))).toBe("parked");
  });

  it("lists verify among the stages the resume section documents", () => {
    expect(whole).toMatch(/one of eleven values/i);
    expect(whole).toMatch(/the nine stages/i);
    expect(whole).toMatch(/`land`, `verify`, `pr`/);
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
    expect(parking).toMatch(/half-configured/i);
    expect(parking).toMatch(/dev server never answered/i);
    expect(parking).toMatch(/still failing after the one fix round/i);
  });
});
