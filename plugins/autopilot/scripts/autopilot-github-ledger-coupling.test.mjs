// autopilot-github appends its own lines to the same run.md that autopilot's
// nextStage reads to decide where /autopilot resume jumps back in. Nothing in
// the code links the two: if a wrapper line ever gained a prefix nextStage
// matches, a resumed run would jump to the wrong stage, and nothing else would
// fail.
//
// This file pins both halves of that contract:
//
//   1. Every `github: ` line is inert — a ledger with them interleaved at every
//      hook point resolves to the same stage as the same ledger without them.
//   2. The park hook's ordering. nextStage returns "parked" only when PARKED
//      starts the LAST entry, so `github: parked comment posted` must be
//      appended BEFORE `PARKED — <reason>`. Reversed, the run looks resumable
//      and /autopilot resume drives it past the park — the exact failure
//      autopilot's parking section warns about.
//
// Sibling of autopilot-ledger-coupling.test.mjs, which stays focused on
// autopilot's own nine entries.

import { describe, it, expect } from "vitest";
import { parseLedger, nextStage } from "./autopilot-ledger.mjs";
import { GITHUB_LEDGER_LINES } from "./autopilot-github-issue.mjs";

const HEADER = "# autopilot run — task: GitHub issue #42: CSV export drops unicode";

// The eight prefixes nextStage resumes on, plus the park marker.
const RESUME_PREFIXES = [
  "pr:", "rebase clean", "learnings committed", "sdd complete", "plan complete",
  "spec committed", "worktree:", "design approved", "PARKED",
];

// autopilot's own nine entries, in pipeline order, with the stage nextStage
// must return once the ledger ends there.
const STAGE_ENTRIES = [
  ["started (phase 1)", "phase1"],
  ["design approved", "setup"],
  ["worktree: .claude/worktrees/issue-42 (branch worktree-issue-42)", "spec"],
  ["spec committed → docs/superpowers/specs/2026-08-21-x-design.md", "plan"],
  ["plan complete → docs/superpowers/plans/2026-08-21-x.md (6 tasks)", "sdd"],
  ["sdd complete (6 tasks, 0 parked, 0 fix rounds across 0 tasks)", "learnings"],
  ["learnings committed → docs/autopilot/learnings.md", "land"],
  ["rebase clean, tests green (42 passed)", "verify"],
  ["verify: 3/3 ui criteria passed", "pr"],
  ["pr: https://example.com/pull/23", "done"],
];

// The wrapper's lines interleaved at their hook points: the two start lines
// straight after `started (phase 1)`, the two PR lines straight after `pr:`.
const GITHUB_AFTER = {
  "started (phase 1)": ["github: moved to in-progress", "github: start comment posted"],
  "pr: https://example.com/pull/23": ["github: moved to in-review", "github: pr comment posted"],
};

function buildLedger(entries) {
  const lines = [HEADER];
  entries.forEach((text, i) => {
    lines.push(`2026-08-21T14:${String(i).padStart(2, "0")}:00Z  ${text}`);
  });
  return lines.join("\n");
}

const stageOf = (entries) => nextStage(parseLedger(buildLedger(entries)));

/** The plain entry list through index `i`, with the github lines woven in. */
function withGithub(entries) {
  return entries.flatMap((text) => [text, ...(GITHUB_AFTER[text] ?? [])]);
}

describe("github: lines collide with none of nextStage's prefixes", () => {
  GITHUB_LEDGER_LINES.forEach((line) => {
    it(`"${line}" starts with none of them`, () => {
      for (const prefix of RESUME_PREFIXES) {
        expect(line.startsWith(prefix)).toBe(false);
      }
    });
  });
});

describe("a ledger with github: lines resolves like one without them", () => {
  STAGE_ENTRIES.forEach(([entryText, expectedStage], index) => {
    it(`through "${entryText}" resolves to "${expectedStage}" either way`, () => {
      const plain = STAGE_ENTRIES.slice(0, index + 1).map(([text]) => text);
      expect(stageOf(plain)).toBe(expectedStage);
      expect(stageOf(withGithub(plain))).toBe(expectedStage);
    });
  });

  it("still returns done when the pr hook's lines are the last two entries", () => {
    // nextStage matches `pr:` anywhere in the ledger, not only as the last
    // entry, so appending after it is safe — this is what makes the pr hook's
    // anchor (immediately after `pr:`) legal.
    const entries = withGithub(STAGE_ENTRIES.map(([text]) => text));
    expect(entries.at(-1)).toBe("github: pr comment posted");
    expect(stageOf(entries)).toBe("done");
  });
});

describe("the PARKED ordering constraint", () => {
  const throughSdd = STAGE_ENTRIES.slice(0, 6).map(([text]) => text);
  const REASON = "PARKED — tests red after rebase (3 failures)";

  it("returns parked when the github line is appended BEFORE the PARKED entry", () => {
    expect(stageOf([...throughSdd, "github: parked comment posted", REASON]))
      .toBe("parked");
  });

  it("does NOT return parked when the github line lands after it", () => {
    // This is the failure the ordering rule exists to prevent: the run reads as
    // resumable and /autopilot resume drives it into `learnings` on a red
    // branch.
    const stage = stageOf([...throughSdd, REASON, "github: parked comment posted"]);
    expect(stage).not.toBe("parked");
    expect(stage).toBe("learnings");
  });
});
