// The findings corpus is JSONL appended by many different review agents across
// many runs. A single bad line must never cost the rest of the file: parsing is
// deliberately tolerant, counting what it could not read rather than throwing.

import { describe, it, expect } from "vitest";
import { STAGES, parseFindings } from "./autopilot-findings.mjs";
import { collectCorpus, formatReport, splitThresholdFlag } from "./autopilot-findings.mjs";

const finding = (over = {}) => ({
  task: 4,
  round: 1,
  severity: "major",
  stage_at_fault: "brief",
  pattern: "brief introduced dead code",
  detail: "service._logger is unused",
  verdict: "CONFIRMED",
  ...over,
});

const jsonl = (...objs) => objs.map((o) => JSON.stringify(o)).join("\n");

describe("STAGES", () => {
  it("lists exactly the four stages that can be at fault", () => {
    expect(STAGES).toEqual(["brief", "plan", "spec", "implementation"]);
  });
});

describe("parseFindings", () => {
  it("parses a finding line into a record", () => {
    const { findings } = parseFindings(jsonl(finding()));
    expect(findings).toHaveLength(1);
    expect(findings[0].stage_at_fault).toBe("brief");
    expect(findings[0].pattern).toBe("brief introduced dead code");
    expect(findings[0].task).toBe(4);
    expect(findings[0].round).toBe(1);
  });

  it("separates clean lines from findings", () => {
    const { findings, cleans } = parseFindings(
      jsonl({ task: 1, clean: true }, finding({ task: 2 })),
    );
    expect(cleans).toEqual([{ task: 1, clean: true }]);
    expect(findings).toHaveLength(1);
    expect(findings[0].task).toBe(2);
  });

  it("skips malformed lines and counts them", () => {
    const { findings, malformed } = parseFindings(
      [JSON.stringify(finding()), "{ not json", JSON.stringify(finding({ task: 9 }))].join("\n"),
    );
    expect(findings).toHaveLength(2);
    expect(malformed).toBe(1);
  });

  it("ignores blank lines without counting them as malformed", () => {
    const { findings, malformed } = parseFindings(
      `\n${JSON.stringify(finding())}\n\n  \n`,
    );
    expect(findings).toHaveLength(1);
    expect(malformed).toBe(0);
  });

  it("counts a line missing required fields as malformed", () => {
    // A JSON object that parses but carries no stage_at_fault cannot be
    // clustered, so silently keeping it would corrupt every count downstream.
    const { findings, malformed } = parseFindings(jsonl({ task: 1, detail: "x" }));
    expect(findings).toHaveLength(0);
    expect(malformed).toBe(1);
  });

  it("counts a finding with an unknown stage_at_fault as malformed", () => {
    const { findings, malformed } = parseFindings(
      jsonl(finding({ stage_at_fault: "reviewer" })),
    );
    expect(findings).toHaveLength(0);
    expect(malformed).toBe(1);
  });

  it("returns empty results for an empty file", () => {
    expect(parseFindings("")).toEqual({ findings: [], cleans: [], malformed: 0 });
  });

  it("treats a non-object JSON line as malformed", () => {
    const { findings, cleans, malformed } = parseFindings(jsonl(42, "hello"));
    expect(findings).toEqual([]);
    expect(cleans).toEqual([]);
    expect(malformed).toBe(2);
  });
});

import { clusterFindings, candidates } from "./autopilot-findings.mjs";

const entry = (run, ...findings) => ({ run, findings });

describe("clusterFindings", () => {
  it("groups the same (stage, pattern) across different runs", () => {
    const clusters = clusterFindings([
      entry("run-a", finding({ task: 4 })),
      entry("run-b", finding({ task: 7, round: 2 })),
    ]);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].count).toBe(2);
    expect(clusters[0].stage_at_fault).toBe("brief");
    expect(clusters[0].pattern).toBe("brief introduced dead code");
  });

  it("keeps the same pattern under different stages apart", () => {
    // The stage is half the key on purpose: an identical phrase attributed to
    // the plan and to the implementation are different defects.
    const clusters = clusterFindings([
      entry(
        "run-a",
        finding({ stage_at_fault: "brief" }),
        finding({ stage_at_fault: "plan" }),
      ),
    ]);
    expect(clusters).toHaveLength(2);
    expect(clusters.map((c) => c.count)).toEqual([1, 1]);
  });

  it("carries run, task, and round as evidence for every occurrence", () => {
    const clusters = clusterFindings([
      entry("run-a", finding({ task: 4, round: 1 })),
      entry("run-b", finding({ task: 7, round: 3 })),
    ]);
    expect(clusters[0].occurrences).toEqual([
      {
        run: "run-a", task: 4, round: 1, severity: "major",
        detail: "service._logger is unused", verdict: "CONFIRMED",
      },
      {
        run: "run-b", task: 7, round: 3, severity: "major",
        detail: "service._logger is unused", verdict: "CONFIRMED",
      },
    ]);
  });

  it("sorts by count descending", () => {
    const clusters = clusterFindings([
      entry("run-a", finding({ pattern: "rare" })),
      entry("run-b", finding({ pattern: "common" }), finding({ pattern: "common" })),
    ]);
    expect(clusters.map((c) => c.pattern)).toEqual(["common", "rare"]);
  });

  it("breaks a count tie by stage then pattern, so output is stable", () => {
    const clusters = clusterFindings([
      entry(
        "run-a",
        finding({ stage_at_fault: "plan", pattern: "zebra" }),
        finding({ stage_at_fault: "brief", pattern: "yak" }),
        finding({ stage_at_fault: "brief", pattern: "ant" }),
      ),
    ]);
    expect(clusters.map((c) => `${c.stage_at_fault}/${c.pattern}`)).toEqual([
      "brief/ant", "brief/yak", "plan/zebra",
    ]);
  });

  it("returns an empty array when no run has findings", () => {
    expect(clusterFindings([entry("run-a"), entry("run-b")])).toEqual([]);
  });
});

describe("candidates", () => {
  const clusters = () => [
    { stage_at_fault: "brief", pattern: "a", count: 3, occurrences: [] },
    { stage_at_fault: "plan", pattern: "b", count: 2, occurrences: [] },
    { stage_at_fault: "spec", pattern: "c", count: 1, occurrences: [] },
  ];

  it("keeps clusters at or above the threshold", () => {
    expect(candidates(clusters(), 2).map((c) => c.pattern)).toEqual(["a", "b"]);
  });

  it("is inclusive at the boundary", () => {
    expect(candidates(clusters(), 3).map((c) => c.pattern)).toEqual(["a"]);
  });

  it("returns nothing when the threshold is above every count", () => {
    expect(candidates(clusters(), 9)).toEqual([]);
  });

  it("returns everything when the threshold is 1", () => {
    expect(candidates(clusters(), 1)).toHaveLength(3);
  });
});

describe("collectCorpus", () => {
  const deps = (runs, files) => ({
    listRuns: () => runs,
    readFile: (p) => {
      if (!(p in files)) throw new Error("ENOENT");
      return files[p];
    },
  });

  it("reads one findings.jsonl per run directory", () => {
    const { entries } = collectCorpus(
      ".superpowers/autopilot",
      deps(["run-a", "run-b"], {
        ".superpowers/autopilot/run-a/findings.jsonl": jsonl(finding()),
        ".superpowers/autopilot/run-b/findings.jsonl": jsonl(finding({ task: 9 })),
      }),
    );
    expect(entries.map((e) => e.run)).toEqual(["run-a", "run-b"]);
    expect(entries[0].findings).toHaveLength(1);
  });

  it("treats a run with no findings.jsonl as a run with no findings", () => {
    // Most runs predate this feature, and a run that never wrote the file is
    // not an error — it just contributes nothing.
    const { entries } = collectCorpus(
      ".superpowers/autopilot",
      deps(["old-run"], {}),
    );
    expect(entries).toEqual([{ run: "old-run", findings: [] }]);
  });

  it("totals clean lines and malformed lines across runs", () => {
    const { cleanCount, malformed } = collectCorpus(
      ".superpowers/autopilot",
      deps(["run-a", "run-b"], {
        ".superpowers/autopilot/run-a/findings.jsonl":
          jsonl({ task: 1, clean: true }, { task: 2, clean: true }),
        ".superpowers/autopilot/run-b/findings.jsonl":
          [JSON.stringify({ task: 1, clean: true }), "{ oops"].join("\n"),
      }),
    );
    expect(cleanCount).toBe(3);
    expect(malformed).toBe(1);
  });
});

describe("formatReport", () => {
  const cluster = {
    stage_at_fault: "brief",
    pattern: "brief introduced dead code",
    count: 2,
    occurrences: [
      { run: "run-a", task: 4, round: 1, severity: "major", detail: "d1", verdict: "CONFIRMED" },
      { run: "run-b", task: 7, round: 2, severity: "minor", detail: "d2", verdict: "CONFIRMED" },
    ],
  };

  it("names the stage, pattern, and count in the heading", () => {
    const out = formatReport([cluster], { threshold: 2, cleanCount: 5, malformed: 0 });
    expect(out).toContain("brief");
    expect(out).toContain("brief introduced dead code");
    expect(out).toContain("2");
  });

  it("lists run, task, and round for every occurrence", () => {
    const out = formatReport([cluster], { threshold: 2, cleanCount: 5, malformed: 0 });
    expect(out).toMatch(/run-a.*task 4.*round 1/s);
    expect(out).toMatch(/run-b.*task 7.*round 2/s);
  });

  it("states that nothing is written without a human decision", () => {
    // The command proposes; the human disposes. A report that reads like a
    // changelog invites the reader to assume the rule already landed.
    const out = formatReport([cluster], { threshold: 2, cleanCount: 0, malformed: 0 });
    expect(out).toMatch(/approv/i);
  });

  it("reports the threshold and the clean count", () => {
    const out = formatReport([cluster], { threshold: 3, cleanCount: 12, malformed: 0 });
    expect(out).toMatch(/threshold/i);
    expect(out).toContain("3");
    expect(out).toMatch(/clean/i);
    expect(out).toContain("12");
  });

  it("says so plainly when no cluster reaches the threshold", () => {
    const out = formatReport([], { threshold: 2, cleanCount: 4, malformed: 0 });
    expect(out).toMatch(/no candidate/i);
  });

  it("surfaces malformed lines so corpus rot is visible", () => {
    const out = formatReport([], { threshold: 2, cleanCount: 0, malformed: 3 });
    expect(out).toMatch(/3 malformed/i);
  });

  it("omits the malformed note when the corpus is clean", () => {
    const out = formatReport([], { threshold: 2, cleanCount: 1, malformed: 0 });
    expect(out).not.toMatch(/malformed/i);
  });
});

// `--threshold=2` is what a human types. Taken positionally it landed in the
// ROOT slot and parsed as NaN, and `count >= NaN` is false for every cluster —
// so a corpus with real recurring findings reported "no candidates". A wrong
// threshold has to fail loudly; silently emptying the report is the one
// outcome that reads as success.
describe("threshold flag parsing", () => {
  it("extracts --threshold=N and leaves the positional args alone", () => {
    const { positional, flagValue } = splitThresholdFlag([
      "report",
      ".superpowers/autopilot",
      "--threshold=3",
    ]);
    expect(flagValue).toBe("3");
    expect(positional).toEqual(["report", ".superpowers/autopilot"]);
  });

  it("does not mistake the flag for the corpus root", () => {
    const { positional } = splitThresholdFlag(["report", "--threshold=2"]);
    expect(positional).toEqual(["report"]);
  });

  it("reports no flag when none is given", () => {
    const { positional, flagValue } = splitThresholdFlag(["report", "somedir", "4"]);
    expect(flagValue).toBeUndefined();
    expect(positional).toEqual(["report", "somedir", "4"]);
  });
});
