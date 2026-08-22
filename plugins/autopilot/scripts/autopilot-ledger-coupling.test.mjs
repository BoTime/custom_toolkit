// This test pins the coupling between .claude/skills/autopilot/SKILL.md's
// instructions to the orchestrator (the exact strings it tells the
// orchestrator to append to the ledger) and autopilot-ledger.mjs's
// `nextStage`, which matches those strings by prefix to decide where
// `/autopilot resume` should jump back in. The two are not otherwise linked:
// nothing fails at build time if SKILL.md's prose drifts from what
// `nextStage` expects. If this file fails, a ledger-entry instruction in
// SKILL.md no longer matches what `nextStage` looks for — reconcile them
// before shipping either change.
//
// Ledgers here are hand-written strings, not read from SKILL.md, so this
// test only detects drift when someone updates one side and forgets the
// other.

import { describe, it, expect } from "vitest";
import { parseLedger, nextStage } from "./autopilot-ledger.mjs";

const HEADER = "# autopilot run — task: add a CSV export button";

// The nine ledger entries SKILL.md instructs the orchestrator to append,
// in pipeline order, paired with the stage `nextStage` must return once a
// ledger ends with that entry.
const STAGE_ENTRIES = [
  ["started (phase 1)", "phase1"],
  ["design approved", "setup"],
  ["worktree: .claude/worktrees/x (branch x)", "spec"],
  ["spec committed → docs/superpowers/specs/2026-07-29-x-design.md", "plan"],
  ["plan complete → docs/superpowers/plans/2026-07-29-x.md", "sdd"],
  ["sdd complete (6 tasks, 0 parked)", "learnings"],
  ["learnings committed → docs/autopilot/learnings.md", "land"],
  ["rebase clean, tests green (42 passed)", "pr"],
  ["pr: https://example.com/pull/23", "done"],
];

function buildLedger(entries) {
  const lines = [HEADER];
  entries.forEach((text, i) => {
    lines.push(`2026-07-29T14:${String(i).padStart(2, "0")}:00Z  ${text}`);
  });
  return lines.join("\n");
}

describe("SKILL.md <-> nextStage coupling", () => {
  STAGE_ENTRIES.forEach(([entryText, expectedStage], index) => {
    it(`"${entryText}" as the last entry resolves to "${expectedStage}"`, () => {
      const cumulative = STAGE_ENTRIES.slice(0, index + 1).map(([text]) => text);
      const ledger = buildLedger(cumulative);
      expect(nextStage(parseLedger(ledger))).toBe(expectedStage);
    });
  });

  it('a ledger ending in "PARKED — tests red after rebase (3 failures)" returns "parked"', () => {
    const cumulative = [
      ...STAGE_ENTRIES.slice(0, 6).map(([text]) => text), // through "sdd complete"
      "PARKED — tests red after rebase (3 failures)",
    ];
    const ledger = buildLedger(cumulative);
    expect(nextStage(parseLedger(ledger))).toBe("parked");
  });

  it('"sdd complete (6 tasks, 2 parked)" as the last entry returns "learnings", not "parked"', () => {
    const cumulative = [
      ...STAGE_ENTRIES.slice(0, 5).map(([text]) => text), // through "plan complete"
      "sdd complete (6 tasks, 2 parked)",
    ];
    const ledger = buildLedger(cumulative);
    expect(nextStage(parseLedger(ledger))).toBe("learnings");
  });

  it('"sdd complete" with fix-round counts still returns "learnings"', () => {
    // The entry grew a fix-round clause. nextStage matches it by PREFIX, so
    // the longer wording must keep resolving to the same stage.
    const cumulative = [
      ...STAGE_ENTRIES.slice(0, 5).map(([text]) => text), // through "plan complete"
      "sdd complete (10 tasks, 0 parked, 7 fix rounds across 4 tasks)",
    ];
    const ledger = buildLedger(cumulative);
    expect(nextStage(parseLedger(ledger))).toBe("learnings");
  });
});
