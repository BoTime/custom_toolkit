import { describe, it, expect } from "vitest";
import {
  formatLine,
  parseLedger,
  nextStage,
  durations,
  totalDuration,
  formatDuration,
} from "./autopilot-ledger.mjs";

const LEDGER = `# autopilot run — task: add a CSV export button
2026-07-29T14:02:11Z  started (phase 1)
2026-07-29T14:31:48Z  design approved
2026-07-29T14:32:03Z  worktree: .claude/worktrees/csv-export (branch csv-export)
2026-07-29T14:33:10Z  spec committed → docs/superpowers/specs/2026-07-29-csv-export-design.md
2026-07-29T14:39:20Z  plan complete → docs/superpowers/plans/2026-07-29-csv-export.md
2026-07-29T16:14:55Z  sdd complete (6 tasks, 0 parked)
2026-07-29T16:18:32Z  rebase clean, tests green (42 passed)
2026-07-29T16:19:40Z  pr: https://example.com/pull/23
`;

describe("formatLine", () => {
  it("joins an ISO timestamp and text with two spaces", () => {
    expect(formatLine("2026-07-29T14:02:11Z", "started (phase 1)")).toBe(
      "2026-07-29T14:02:11Z  started (phase 1)",
    );
  });
});

describe("parseLedger", () => {
  it("extracts the task description from the header", () => {
    expect(parseLedger(LEDGER).task).toBe("add a CSV export button");
  });

  it("parses every timestamped entry", () => {
    const { entries } = parseLedger(LEDGER);
    expect(entries).toHaveLength(8);
    expect(entries[0]).toEqual({
      timestamp: "2026-07-29T14:02:11Z", text: "started (phase 1)",
    });
    expect(entries[7].text).toBe("pr: https://example.com/pull/23");
  });

  it("ignores blank lines", () => {
    const { entries } = parseLedger(`# autopilot run — task: x\n\n2026-07-29T14:02:11Z  a\n\n`);
    expect(entries).toHaveLength(1);
  });

  it("returns a null task when the header is missing", () => {
    expect(parseLedger("2026-07-29T14:02:11Z  a").task).toBe(null);
  });
});

describe("nextStage", () => {
  it("returns done for a complete run", () => {
    expect(nextStage(parseLedger(LEDGER))).toBe("done");
  });

  it("returns pr when landing finished but no PR exists", () => {
    const partial = LEDGER.split("\n").slice(0, 8).join("\n");
    expect(nextStage(parseLedger(partial))).toBe("pr");
  });

  it("returns land when sdd finished", () => {
    const partial = LEDGER.split("\n").slice(0, 7).join("\n");
    expect(nextStage(parseLedger(partial))).toBe("land");
  });

  it("returns sdd when the plan exists", () => {
    const partial = LEDGER.split("\n").slice(0, 6).join("\n");
    expect(nextStage(parseLedger(partial))).toBe("sdd");
  });

  it("returns plan when the spec is committed", () => {
    const partial = LEDGER.split("\n").slice(0, 5).join("\n");
    expect(nextStage(parseLedger(partial))).toBe("plan");
  });

  it("returns spec when the worktree exists but no spec is committed", () => {
    const partial = LEDGER.split("\n").slice(0, 4).join("\n");
    expect(nextStage(parseLedger(partial))).toBe("spec");
  });

  it("returns setup when the design is approved but no worktree exists", () => {
    const partial = LEDGER.split("\n").slice(0, 3).join("\n");
    expect(nextStage(parseLedger(partial))).toBe("setup");
  });

  it("returns phase1 for a ledger with only a start line", () => {
    const partial = LEDGER.split("\n").slice(0, 2).join("\n");
    expect(nextStage(parseLedger(partial))).toBe("phase1");
  });

  it("returns parked when the last entry is a PARKED line", () => {
    const parkedLedger = `# autopilot run — task: add a CSV export button
2026-07-29T14:02:11Z  started (phase 1)
2026-07-29T14:31:48Z  design approved
2026-07-29T14:32:03Z  worktree: .claude/worktrees/csv-export (branch csv-export)
2026-07-29T14:33:10Z  spec committed → docs/superpowers/specs/2026-07-29-csv-export-design.md
2026-07-29T14:39:20Z  plan complete → docs/superpowers/plans/2026-07-29-csv-export.md
2026-07-29T16:14:55Z  sdd complete (6 tasks, 0 parked)
2026-07-29T16:18:32Z  PARKED — tests red after rebase (3 failures)
`;
    expect(nextStage(parseLedger(parkedLedger))).toBe("parked");
  });

  it("returns done when a PARKED line is followed by later stage lines", () => {
    const resumedLedger = `# autopilot run — task: add a CSV export button
2026-07-29T14:02:11Z  started (phase 1)
2026-07-29T14:31:48Z  design approved
2026-07-29T14:32:03Z  worktree: .claude/worktrees/csv-export (branch csv-export)
2026-07-29T14:33:10Z  spec committed → docs/superpowers/specs/2026-07-29-csv-export-design.md
2026-07-29T14:39:20Z  plan complete → docs/superpowers/plans/2026-07-29-csv-export.md
2026-07-29T16:14:55Z  sdd complete (6 tasks, 0 parked)
2026-07-29T16:18:32Z  PARKED — tests red after rebase (3 failures)
2026-07-29T16:22:10Z  rebase clean, tests green (42 passed)
2026-07-29T16:23:05Z  pr: https://example.com/pull/23
`;
    expect(nextStage(parseLedger(resumedLedger))).toBe("done");
  });
});

describe("durations", () => {
  it("computes seconds between consecutive entries", () => {
    const d = durations(parseLedger(LEDGER));
    expect(d).toHaveLength(7);
    expect(d[0]).toEqual({
      from: "started (phase 1)", to: "design approved", seconds: 1777,
    });
  });

  it("returns an empty array for a single-entry ledger", () => {
    expect(durations(parseLedger("# autopilot run — task: x\n2026-07-29T14:02:11Z  a"))).toEqual([]);
  });
});

describe("totalDuration", () => {
  it("measures first entry to last entry", () => {
    // 14:02:11 → 16:19:40 is 2h17m29s
    expect(totalDuration(parseLedger(LEDGER))).toBe(8249);
  });

  it("returns 0 for a single-entry ledger", () => {
    expect(
      totalDuration(parseLedger("# autopilot run — task: x\n2026-07-29T14:02:11Z  a")),
    ).toBe(0);
  });

  it("returns null for a ledger with no entries", () => {
    expect(totalDuration(parseLedger("# autopilot run — task: x"))).toBe(null);
  });

  it("ignores a PARKED run's wording and still measures the span", () => {
    const parked = `# autopilot run — task: x
2026-07-29T14:00:00Z  started (phase 1)
2026-07-29T14:30:00Z  PARKED — tests red after rebase`;
    expect(totalDuration(parseLedger(parked))).toBe(1800);
  });
});

describe("formatDuration", () => {
  it("formats hours and minutes", () => {
    expect(formatDuration(8249)).toBe("2h 17m");
  });

  it("formats minutes only when under an hour", () => {
    expect(formatDuration(1800)).toBe("30m");
  });

  it("formats seconds only when under a minute", () => {
    expect(formatDuration(45)).toBe("45s");
  });

  it("formats a zero span", () => {
    expect(formatDuration(0)).toBe("0s");
  });

  it("returns null for a null span", () => {
    expect(formatDuration(null)).toBe(null);
  });
});
