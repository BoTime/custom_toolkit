# Autopilot Findings Capture and Analysis Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make SDD review findings durable and analyzable — capture each finding as a JSON line during a run, and cluster the corpus across runs into human-approved rule candidates.

**Architecture:** Three independent pieces. (1) A new pure-function Node helper, `plugins/autopilot/scripts/autopilot-findings.mjs`, that parses `findings.jsonl`, clusters by `(stage_at_fault, pattern)`, and applies a threshold — all I/O at the edges so the logic is unit-testable. (2) Prose changes to `plugins/autopilot/skills/autopilot/SKILL.md`: a findings-capture contract in the `sdd` section, a fix-round count in the `sdd complete` ledger entry, and a pinned definition of `<run>` plus the main-checkout placement rule — each pinned by a guard test, since prose changes break nothing else. (3) A `/autopilot-findings` command that renders the helper's clusters for a human to approve, reject, or edit.

**Tech Stack:** Node ESM (`.mjs`), vitest 3.2, Claude Code plugin (skills + commands), JSONL corpus files.

## Global Constraints

- **Test command:** `npm test` (vitest). Run from the repository root.
- **Baseline:** 103 tests passing across 7 files. Do not weaken, delete, or loosen any existing test. Every task must leave the full suite green.
- **Node helpers** live in `plugins/autopilot/scripts/` with colocated `.test.mjs` vitest files. ESM only (`"type": "module"` at the repo root).
- **Version bump to `1.3.0`** in BOTH `plugins/autopilot/.claude-plugin/plugin.json` and `.claude-plugin/marketplace.json` — and in marketplace.json in BOTH places: the `plugins[0].version` entry AND the `metadata.version` block. Done once, in Task 7.
- **Corpus location:** `.superpowers/autopilot/<run>/findings.jsonl`, in the MAIN CHECKOUT, beside `run.md`.
- **Finding fields:** `task`, `round`, `severity`, `stage_at_fault`, `pattern`, `detail`, `verdict`. Clean lines are `{"task": N, "clean": true}`.
- **`stage_at_fault` allowed values:** `brief`, `plan`, `spec`, `implementation`.
- **OUT OF SCOPE — do not implement:** injection of rules into stage prompts. Do NOT modify `superpowers:writing-plans`, and do NOT modify the SDD verification contract's four existing rules (they are pinned by `autopilot-sdd-contract.test.mjs`; that test must keep passing untouched). This plan ADDS a separate findings-capture contract alongside them. An approved candidate is recorded for a human, never wired into a prompt.
- **Prose guard tests** must collapse whitespace before matching (`readFileSync(path,"utf8").replace(/\s+/g," ")`), because the SKILL.md files are hard-wrapped and a pinned phrase routinely straddles a newline. See `autopilot-no-design-gate.test.mjs` for the established `unwrap` helper.

---

## File Structure

**Created:**

- `plugins/autopilot/scripts/autopilot-findings.mjs` — parse, cluster, threshold, and format the findings corpus. Pure functions plus a thin `main()` CLI. Sole owner of the JSONL schema.
- `plugins/autopilot/scripts/autopilot-findings.test.mjs` — colocated vitest coverage for the above.
- `plugins/autopilot/scripts/autopilot-findings-contract.test.mjs` — guard test pinning the SKILL.md prose that this feature depends on: the capture contract, the fix-round ledger entry, and the `<run>` / main-checkout placement rule.
- `plugins/autopilot/commands/autopilot-findings.md` — the `/autopilot-findings` command that runs the helper and walks a human through approve/reject/edit.

**Modified:**

- `plugins/autopilot/scripts/autopilot-config.mjs` — add `findings_threshold` handling (`TOP_LEVEL` currently lists `worktree_dir`, `base_ref`, `reaper`).
- `plugins/autopilot/scripts/autopilot-config.test.mjs` — cover the new key.
- `plugins/autopilot/autopilot.default.json` — ship the default threshold.
- `plugins/autopilot/skills/autopilot/SKILL.md` — capture contract, ledger fix-round count, `<run>` definition and placement rule.
- `plugins/autopilot/scripts/autopilot-ledger-coupling.test.mjs` — prove the new `sdd complete` wording still resolves to `land`.
- `plugins/autopilot/.claude-plugin/plugin.json` — version `1.3.0`, register `commands`.
- `.claude-plugin/marketplace.json` — version `1.3.0` in both places.

**Task order rationale:** Tasks 1–3 build the helper bottom-up (parse → cluster → format/CLI). Task 4 adds the config key the CLI reads for its default threshold. Tasks 5–6 are the prose changes plus their guards. Task 7 is the command and the version bump. Each task ends green and is independently reviewable.

---

### Task 1: Findings corpus parser

Parse a `findings.jsonl` file into typed records, tolerating the malformed lines a JSONL corpus written by many agents will accumulate.

**Files:**
- Create: `plugins/autopilot/scripts/autopilot-findings.mjs`
- Create: `plugins/autopilot/scripts/autopilot-findings.test.mjs`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `STAGES` — `["brief", "plan", "spec", "implementation"]` (exported const array of strings).
  - `parseFindings(contents: string): { findings: Finding[], cleans: Clean[], malformed: number }` where `Finding` is `{task: number, round: number, severity: string, stage_at_fault: string, pattern: string, detail: string, verdict: string}` and `Clean` is `{task: number, clean: true}`.

- [ ] **Step 1: Write the failing test**

Create `plugins/autopilot/scripts/autopilot-findings.test.mjs`:

```js
// The findings corpus is JSONL appended by many different review agents across
// many runs. A single bad line must never cost the rest of the file: parsing is
// deliberately tolerant, counting what it could not read rather than throwing.

import { describe, it, expect } from "vitest";
import { STAGES, parseFindings } from "./autopilot-findings.mjs";

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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run plugins/autopilot/scripts/autopilot-findings.test.mjs`
Expected: FAIL — `Failed to resolve import "./autopilot-findings.mjs"`

- [ ] **Step 3: Write minimal implementation**

Create `plugins/autopilot/scripts/autopilot-findings.mjs`:

```js
/**
 * The findings corpus: one JSON object per line, appended by SDD's review roles
 * to `.superpowers/autopilot/<run>/findings.jsonl` in the main checkout.
 *
 * Every function here is pure over strings and arrays. File reading lives in
 * the CLI at the bottom, so the logic is testable without a fixture tree.
 */

/**
 * The stages that can be at fault for a finding.
 *
 * This is the field that makes the corpus actionable rather than a blame log:
 * a defect introduced by the brief must not read as an implementer error, or
 * the analysis tunes the wrong stage.
 */
export const STAGES = ["brief", "plan", "spec", "implementation"];

const REQUIRED = ["task", "round", "severity", "stage_at_fault", "pattern", "detail", "verdict"];

/**
 * Parse a findings.jsonl file.
 *
 * Tolerant by design: the corpus is appended by many agents across many runs,
 * and a single truncated or interleaved write must not cost the whole file.
 * Unreadable lines are counted, not thrown on, so a caller can surface corpus
 * health without losing the records that did parse.
 */
export function parseFindings(contents) {
  const findings = [];
  const cleans = [];
  let malformed = 0;

  for (const line of contents.split("\n")) {
    if (line.trim() === "") continue;

    let obj;
    try {
      obj = JSON.parse(line);
    } catch {
      malformed += 1;
      continue;
    }

    if (obj === null || typeof obj !== "object" || Array.isArray(obj)) {
      malformed += 1;
      continue;
    }

    if (obj.clean === true) {
      cleans.push({ task: obj.task, clean: true });
      continue;
    }

    if (REQUIRED.some((k) => obj[k] === undefined)) {
      malformed += 1;
      continue;
    }
    if (!STAGES.includes(obj.stage_at_fault)) {
      malformed += 1;
      continue;
    }

    findings.push(obj);
  }

  return { findings, cleans, malformed };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run plugins/autopilot/scripts/autopilot-findings.test.mjs`
Expected: PASS (8 tests)

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: PASS — 111 tests across 8 files (103 baseline + 8 new)

- [ ] **Step 6: Commit**

```bash
git add plugins/autopilot/scripts/autopilot-findings.mjs plugins/autopilot/scripts/autopilot-findings.test.mjs
git commit -m "feat(autopilot): parse the findings JSONL corpus"
```

---

### Task 2: Cluster findings and apply a threshold

Group parsed findings by `(stage_at_fault, pattern)` across runs, carrying each occurrence's evidence, and filter to those at or above a threshold.

**Files:**
- Modify: `plugins/autopilot/scripts/autopilot-findings.mjs`
- Modify: `plugins/autopilot/scripts/autopilot-findings.test.mjs`

**Interfaces:**
- Consumes: `parseFindings` and `STAGES` from Task 1.
- Produces:
  - `clusterFindings(entries: {run: string, findings: Finding[]}[]): Cluster[]` where `Cluster` is `{stage_at_fault: string, pattern: string, count: number, occurrences: {run: string, task: number, round: number, severity: string, detail: string, verdict: string}[]}`. Sorted by `count` descending, then `stage_at_fault` ascending, then `pattern` ascending.
  - `candidates(clusters: Cluster[], threshold: number): Cluster[]` — those with `count >= threshold`, order preserved.

- [ ] **Step 1: Write the failing test**

Append to `plugins/autopilot/scripts/autopilot-findings.test.mjs`:

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run plugins/autopilot/scripts/autopilot-findings.test.mjs`
Expected: FAIL — `clusterFindings is not a function` (or an import error for the new names)

- [ ] **Step 3: Write minimal implementation**

Append to `plugins/autopilot/scripts/autopilot-findings.mjs`:

```js
/**
 * Cluster findings by `(stage_at_fault, pattern)` across runs.
 *
 * `pattern` is a short canonical phrase and `detail` carries the specifics,
 * which is what keeps clustering a pure lexical function over JSON instead of
 * something needing a model call. The stage is half the key: the same phrase
 * blamed on the plan and on the implementation are different defects.
 *
 * Sorted count-descending with a (stage, pattern) tiebreak so repeated runs
 * over an unchanged corpus print identical output.
 */
export function clusterFindings(entries) {
  const byKey = new Map();

  for (const { run, findings } of entries) {
    for (const f of findings ?? []) {
      const key = `${f.stage_at_fault} ${f.pattern}`;
      if (!byKey.has(key)) {
        byKey.set(key, {
          stage_at_fault: f.stage_at_fault,
          pattern: f.pattern,
          count: 0,
          occurrences: [],
        });
      }
      const cluster = byKey.get(key);
      cluster.count += 1;
      cluster.occurrences.push({
        run,
        task: f.task,
        round: f.round,
        severity: f.severity,
        detail: f.detail,
        verdict: f.verdict,
      });
    }
  }

  return [...byKey.values()].sort(
    (a, b) =>
      b.count - a.count ||
      a.stage_at_fault.localeCompare(b.stage_at_fault) ||
      a.pattern.localeCompare(b.pattern),
  );
}

/** Clusters worth showing a human: those seen at least `threshold` times. */
export function candidates(clusters, threshold) {
  return clusters.filter((c) => c.count >= threshold);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run plugins/autopilot/scripts/autopilot-findings.test.mjs`
Expected: PASS (18 tests)

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: PASS — 121 tests across 8 files

- [ ] **Step 6: Commit**

```bash
git add plugins/autopilot/scripts/autopilot-findings.mjs plugins/autopilot/scripts/autopilot-findings.test.mjs
git commit -m "feat(autopilot): cluster findings by stage and pattern with a threshold"
```

---

### Task 3: Corpus discovery, report formatting, and CLI

Read every run's `findings.jsonl` under `.superpowers/autopilot/`, render clusters as a human-readable report with evidence, and expose it as a CLI.

**Files:**
- Modify: `plugins/autopilot/scripts/autopilot-findings.mjs`
- Modify: `plugins/autopilot/scripts/autopilot-findings.test.mjs`

**Interfaces:**
- Consumes: `parseFindings`, `clusterFindings`, `candidates` from Tasks 1–2.
- Produces:
  - `collectCorpus(root: string, deps: {listRuns: (root) => string[], readFile: (path) => string}): {entries: {run: string, findings: Finding[]}[], cleanCount: number, malformed: number}` — `listRuns` returns run directory names; `readFile` throws for an absent `findings.jsonl`, which is treated as a run with no findings.
  - `formatReport(clusters: Cluster[], opts: {threshold: number, cleanCount: number, malformed: number}): string`
  - `main(argv)` — CLI entry.

- [ ] **Step 1: Write the failing test**

Append to `plugins/autopilot/scripts/autopilot-findings.test.mjs`:

```js
import { collectCorpus, formatReport } from "./autopilot-findings.mjs";

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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run plugins/autopilot/scripts/autopilot-findings.test.mjs`
Expected: FAIL — `collectCorpus is not a function`

- [ ] **Step 3: Write minimal implementation**

Append to `plugins/autopilot/scripts/autopilot-findings.mjs`. Add `readFileSync`, `readdirSync`, and `pathToFileURL` imports at the TOP of the file (matching `autopilot-ledger.mjs`'s style):

```js
import { readFileSync, readdirSync } from "node:fs";
import { pathToFileURL } from "node:url";
```

Then append:

```js
/**
 * Read every run's findings.jsonl under the autopilot root.
 *
 * Directory listing and file reading are injected so the corpus walk is
 * testable without a fixture tree. A run with no findings.jsonl is normal —
 * every run predating this feature is one — so an unreadable file yields a run
 * with no findings rather than an error.
 */
export function collectCorpus(
  root,
  deps = {
    listRuns: (r) =>
      readdirSync(r, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name),
    readFile: (p) => readFileSync(p, "utf8"),
  },
) {
  const entries = [];
  let cleanCount = 0;
  let malformed = 0;

  for (const run of deps.listRuns(root)) {
    let contents;
    try {
      contents = deps.readFile(`${root}/${run}/findings.jsonl`);
    } catch {
      entries.push({ run, findings: [] });
      continue;
    }
    const parsed = parseFindings(contents);
    entries.push({ run, findings: parsed.findings });
    cleanCount += parsed.cleans.length;
    malformed += parsed.malformed;
  }

  return { entries, cleanCount, malformed };
}

/**
 * Render clusters for a human to act on.
 *
 * Every cluster prints its full evidence — run, task, and round per occurrence
 * — because the reader's job is to judge whether the pattern is real, and a
 * bare count gives them nothing to judge with.
 */
export function formatReport(clusters, { threshold, cleanCount, malformed }) {
  const lines = [
    "# Autopilot findings — rule candidates",
    "",
    `Threshold: ${threshold} occurrences. Clean task lines in corpus: ${cleanCount}.`,
  ];

  if (malformed > 0) {
    lines.push(
      "",
      `Note: ${malformed} malformed line(s) were skipped. Counts below are a floor.`,
    );
  }

  if (clusters.length === 0) {
    lines.push("", `No candidates: nothing recurred ${threshold} or more times.`);
    return lines.join("\n");
  }

  lines.push(
    "",
    "These are proposals. Nothing is written until you approve a candidate;",
    "rejecting or editing one is an equally valid outcome.",
  );

  for (const c of clusters) {
    lines.push(
      "",
      `## [${c.stage_at_fault}] ${c.pattern} — ${c.count} occurrences`,
      "",
    );
    for (const o of c.occurrences) {
      lines.push(
        `- ${o.run}: task ${o.task}, round ${o.round} (${o.severity}, ${o.verdict}) — ${o.detail}`,
      );
    }
  }

  return lines.join("\n");
}

/** `report [root] [threshold]` prints the candidate report. */
export function main(argv = process.argv.slice(2)) {
  const [command, root = ".superpowers/autopilot", rawThreshold = "2"] = argv;
  if (command !== "report") {
    console.error("usage: autopilot-findings.mjs report [root] [threshold]");
    process.exitCode = 1;
    return;
  }
  const threshold = Number(rawThreshold);
  const { entries, cleanCount, malformed } = collectCorpus(root);
  const clusters = candidates(clusterFindings(entries), threshold);
  console.log(formatReport(clusters, { threshold, cleanCount, malformed }));
}

// pathToFileURL rather than a `file://` template: the plugin's install path is
// user-controlled and a space in it would silently skip main().
if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run plugins/autopilot/scripts/autopilot-findings.test.mjs`
Expected: PASS (28 tests)

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: PASS — 131 tests across 8 files

- [ ] **Step 6: Commit**

```bash
git add plugins/autopilot/scripts/autopilot-findings.mjs plugins/autopilot/scripts/autopilot-findings.test.mjs
git commit -m "feat(autopilot): collect the findings corpus and format a candidate report"
```

---

### Task 4: `findings_threshold` config key

Add the threshold as a validated config key with a shipped default, so it is tunable once real data shows how noisy clustering is.

**Files:**
- Modify: `plugins/autopilot/scripts/autopilot-config.mjs:10` (the `TOP_LEVEL` array) and `validateConfig`
- Modify: `plugins/autopilot/scripts/autopilot-config.test.mjs`
- Modify: `plugins/autopilot/autopilot.default.json`

**Interfaces:**
- Consumes: nothing from earlier tasks (independent of the helper).
- Produces: `config.findings_threshold` — a positive integer, default `2`. Task 7's command reads it.

- [ ] **Step 1: Write the failing test**

In `plugins/autopilot/scripts/autopilot-config.test.mjs`, add `findings_threshold: 2,` to the `validConfig()` object (place it next to `reaper: true,`), and add these tests inside the existing `describe("validateConfig", ...)` block:

```js
  it("rejects a missing findings_threshold", () => {
    const cfg = validConfig();
    delete cfg.findings_threshold;
    const result = validateConfig(cfg, {});
    expect(result.ok).toBe(false);
    expect(result.errors).toContain("findings_threshold: missing");
  });

  it("rejects a non-integer findings_threshold", () => {
    const cfg = validConfig();
    cfg.findings_threshold = 2.5;
    const result = validateConfig(cfg, {});
    expect(result.ok).toBe(false);
    expect(result.errors).toContain(
      "findings_threshold: must be a positive integer",
    );
  });

  it("rejects a findings_threshold below 1", () => {
    // A threshold of 0 would promote every one-off finding into a candidate,
    // which is the noise the threshold exists to filter.
    const cfg = validConfig();
    cfg.findings_threshold = 0;
    const result = validateConfig(cfg, {});
    expect(result.ok).toBe(false);
    expect(result.errors).toContain(
      "findings_threshold: must be a positive integer",
    );
  });

  it("accepts a findings_threshold of 1", () => {
    const cfg = validConfig();
    cfg.findings_threshold = 1;
    expect(validateConfig(cfg, {}).ok).toBe(true);
  });
```

And add this test inside the existing `describe("mergeConfig", ...)` block:

```js
  it("lets a project override findings_threshold", () => {
    const merged = mergeConfig(validConfig(), { findings_threshold: 5 });
    expect(merged.findings_threshold).toBe(5);
  });
```

And this one inside the existing `describe("loadConfig", ...)` block:

```js
  it("ships a findings_threshold default when the project sets none", () => {
    const readFile = reader({ [DEFAULTS]: JSON.stringify(validConfig()) });
    const { config } = loadConfig(PROJECT, {}, readFile, DEFAULTS);
    expect(config.findings_threshold).toBe(2);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run plugins/autopilot/scripts/autopilot-config.test.mjs`
Expected: FAIL — the missing-key test fails because `TOP_LEVEL` does not include `findings_threshold`, and the type tests fail because no type check exists.

- [ ] **Step 3: Write minimal implementation**

In `plugins/autopilot/scripts/autopilot-config.mjs`, change line 10:

```js
const TOP_LEVEL = ["worktree_dir", "base_ref", "reaper", "findings_threshold"];
```

And in `validateConfig`, immediately after the existing `for (const key of TOP_LEVEL)` loop, add:

```js
  // A threshold below 1 promotes every one-off finding into a candidate, which
  // is exactly the noise the threshold exists to filter.
  const threshold = obj.findings_threshold;
  if (
    threshold !== undefined &&
    (!Number.isInteger(threshold) || threshold < 1)
  ) {
    errors.push("findings_threshold: must be a positive integer");
  }
```

In `plugins/autopilot/autopilot.default.json`, add the key after `"reaper": true` (remember the comma on the `reaper` line):

```json
  "reaper": true,
  "findings_threshold": 2
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run plugins/autopilot/scripts/autopilot-config.test.mjs`
Expected: PASS (29 tests)

- [ ] **Step 5: Verify the shipped default actually loads**

The unit tests use a fake reader, so they never touch `autopilot.default.json`. Confirm the real file is valid and carries the key:

Run: `node -e "import('./plugins/autopilot/scripts/autopilot-config.mjs').then(m=>console.log(m.loadConfig('.claude/autopilot.json').config.findings_threshold))"`
Expected: `2`

- [ ] **Step 6: Run the full suite**

Run: `npm test`
Expected: PASS — 137 tests across 8 files

- [ ] **Step 7: Commit**

```bash
git add plugins/autopilot/scripts/autopilot-config.mjs plugins/autopilot/scripts/autopilot-config.test.mjs plugins/autopilot/autopilot.default.json
git commit -m "feat(autopilot): add the findings_threshold config key"
```

---

### Task 5: Findings-capture contract in SKILL.md

Add a capture contract to the `sdd` section telling review roles to append one JSON line per finding, plus an explicit clean line per passing task — written the way the existing verification contract is, naming concrete expected behavior.

**Files:**
- Modify: `plugins/autopilot/skills/autopilot/SKILL.md` (the `### \`sdd\`` section, after the existing verification contract block and before the "Answer these gates" table)
- Create: `plugins/autopilot/scripts/autopilot-findings-contract.test.mjs`

**Interfaces:**
- Consumes: the field names from Task 1 (`task`, `round`, `severity`, `stage_at_fault`, `pattern`, `detail`, `verdict`) and the `STAGES` values.
- Produces: prose only. Task 6 adds more assertions to the same guard-test file.

**Do NOT touch** the four existing verification-contract rules or anything `autopilot-sdd-contract.test.mjs` pins. This is an ADDITION alongside them.

- [ ] **Step 1: Write the failing test**

Create `plugins/autopilot/scripts/autopilot-findings-contract.test.mjs`:

```js
// SKILL.md's `sdd` section carries a findings-capture contract: SDD's review
// roles must append one JSON line per finding, plus an explicit clean line per
// passing task. The contract is prose, so nothing else fails if it is deleted
// or reworded past recognition — findings would simply stop being recorded and
// the corpus would silently stay empty, which is indistinguishable from a run
// where nothing went wrong.
//
// This test reads SKILL.md and asserts the load-bearing pieces are present
// within the `sdd` section, where a dispatched agent will actually read them.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { STAGES } from "./autopilot-findings.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const SKILL_PATH = join(HERE, "..", "skills", "autopilot", "SKILL.md");

// SKILL.md is hard-wrapped prose, so a pinned phrase routinely straddles a
// newline. Collapse whitespace before matching; otherwise a reflow that changes
// no words at all would fail these tests.
const unwrap = (s) => s.replace(/\s+/g, " ");

/**
 * The `### \`sdd\`` section: from its heading to the next heading at the same
 * level or shallower. Anchored at line starts for the same reasons as
 * autopilot-sdd-contract.test.mjs — a rule outside this section never reaches
 * the dispatched agent.
 */
function sddSection(markdown) {
  const startMatch = /^### `sdd`.*$/m.exec(markdown);
  if (!startMatch) throw new Error("SKILL.md has no `### \\`sdd\\`` section");
  const rest = markdown.slice(startMatch.index);
  const endMatch = /\n#{1,3} .*$/m.exec(rest.slice(startMatch[0].length));
  return endMatch ? rest.slice(0, startMatch[0].length + endMatch.index) : rest;
}

const skill = readFileSync(SKILL_PATH, "utf8");
const section = unwrap(sddSection(skill));

describe("sdd findings-capture contract", () => {
  it("names the corpus file and its main-checkout placement", () => {
    expect(section).toContain("findings.jsonl");
    expect(section).toMatch(/main checkout/i);
  });

  it("names every field a finding line must carry", () => {
    for (const field of [
      "task", "round", "severity", "stage_at_fault", "pattern", "detail", "verdict",
    ]) {
      expect(section).toContain(field);
    }
  });

  it("enumerates the stages that can be at fault", () => {
    // Without the closed list, agents invent values like "reviewer" and the
    // clustering key fragments.
    for (const stage of STAGES) {
      expect(section).toMatch(new RegExp(`\\b${stage}\\b`));
    }
  });

  it("requires an explicit clean line for a task that passes review", () => {
    // Without it, absence of evidence is indistinguishable from evidence of
    // absence and no threshold can be trusted.
    expect(section).toContain('"clean": true');
    expect(section).toMatch(/absence of evidence/i);
  });

  it("distinguishes pattern from detail so clustering stays lexical", () => {
    expect(section).toMatch(/pattern.{0,120}(short|canonical)/i);
  });

  it("says stage_at_fault names the stage that produced the bad input", () => {
    // Framing every finding as an implementer mistake would tune the wrong
    // stage — this is the sentence that prevents it.
    expect(section).toMatch(/stage_at_fault/);
    expect(section).toMatch(/bad input|produced the/i);
  });

  it("keeps the capture contract inside the sdd section, not merely in the file", () => {
    expect(section).toMatch(/findings capture contract/i);
  });

  it("does not weaken the existing verification contract", () => {
    // The verification contract and the capture contract coexist in this
    // section. Adding one must not displace the other.
    expect(section).toMatch(/verification contract/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run plugins/autopilot/scripts/autopilot-findings-contract.test.mjs`
Expected: FAIL — `expected section to contain "findings.jsonl"`

- [ ] **Step 3: Write the prose**

In `plugins/autopilot/skills/autopilot/SKILL.md`, inside `### \`sdd\``, insert this AFTER the paragraph ending "…their tool calls still render." and BEFORE "Answer these gates from config rather than asking:":

```markdown
The dispatch prompt also carries a findings capture contract. SDD generates
review findings and then discards them: task reports are written after the fix
and describe the corrected state, so they read as success narratives. In a real
repository, ten task reports mentioned not one review finding, fix round, or
rejected verdict. The signal is real — two findings in a single run were both
attributable to the brief rather than the implementer — but nothing survives to
show it. Include text equivalent to:

> Findings capture contract for this stage:
>
> 1. **Append one JSON line per review finding** to
>    `.superpowers/autopilot/<run>/findings.jsonl` in the **main checkout**,
>    beside `run.md` — not inside the worktree, which the reaper deletes. Use a
>    Bash append (`>>`); a worktree-isolated session cannot Write/Edit to the
>    main checkout, but Bash appends work.
> 2. **Every finding line carries all seven fields**: `task` (number), `round`
>    (number), `severity`, `stage_at_fault`, `pattern`, `detail`, `verdict`.
>    A line missing any of them is dropped by the analyzer.
> 3. **`stage_at_fault` is one of `brief`, `plan`, `spec`, `implementation`** —
>    the stage that produced the bad input, not the stage that surfaced it. A
>    defect the brief introduced must not be recorded as an implementation
>    error; framing every finding as a model mistake tunes the wrong stage.
>    Invent no other values.
> 4. **`pattern` is a short canonical phrase; `detail` carries the specifics.**
>    Clustering is a pure lexical match over `pattern`, so a phrase rewritten
>    per finding clusters with nothing. Reuse a phrase you have used before
>    when the defect is the same kind.
> 5. **A task that passes review writes an explicit clean line**:
>    `{"task": N, "clean": true}`. This is not optional bookkeeping. Without
>    it, absence of evidence is indistinguishable from evidence of absence:
>    occurrence counts become a floor rather than a count, and no threshold can
>    be trusted.
>
> Example lines:
>
> ```
> {"task":4,"round":1,"severity":"major","stage_at_fault":"brief","pattern":"brief introduced dead code","detail":"service._logger added by the brief is never wired","verdict":"CONFIRMED"}
> {"task":5,"clean":true}
> ```

A general instruction to "log findings" will not bind. The rules above name the
concrete expected behavior for the same reason the verification contract's
rules 2 and 3 do.
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run plugins/autopilot/scripts/autopilot-findings-contract.test.mjs`
Expected: PASS (8 tests)

- [ ] **Step 5: Confirm the existing contract guard still passes**

Run: `npx vitest run plugins/autopilot/scripts/autopilot-sdd-contract.test.mjs`
Expected: PASS (5 tests) — unchanged. If this fails, the edit displaced the verification contract; restore it.

- [ ] **Step 6: Run the full suite**

Run: `npm test`
Expected: PASS — 145 tests across 9 files

- [ ] **Step 7: Commit**

```bash
git add plugins/autopilot/skills/autopilot/SKILL.md plugins/autopilot/scripts/autopilot-findings-contract.test.mjs
git commit -m "feat(autopilot): add the findings capture contract to the sdd dispatch"
```

---

### Task 6: Fix-round ledger entry and the `<run>` placement rule

Two prose fixes in SKILL.md: `sdd complete` gains fix-round counts, and `<run>` gets a single definition with the main-checkout placement rule and both of its reasons.

**Files:**
- Modify: `plugins/autopilot/skills/autopilot/SKILL.md` (the `sdd` section's Append line; a new subsection near "Phase 2 — automated")
- Modify: `plugins/autopilot/scripts/autopilot-findings-contract.test.mjs`
- Modify: `plugins/autopilot/scripts/autopilot-ledger-coupling.test.mjs`

**Interfaces:**
- Consumes: the guard-test file created in Task 5.
- Produces: prose only. No code changes — `nextStage` already matches `sdd complete` by prefix, so the longer entry needs no parser change. The coupling test proves that.

- [ ] **Step 1: Write the failing tests**

Append to `plugins/autopilot/scripts/autopilot-findings-contract.test.mjs`:

```js
const whole = unwrap(skill);

describe("sdd complete records fix rounds", () => {
  it("shows the fix-round count in the ledger entry", () => {
    expect(section).toMatch(/fix rounds/i);
  });

  it("keeps the `sdd complete` prefix nextStage matches on", () => {
    // nextStage matches this entry by prefix to resume a run at `land`.
    // Renaming it silently breaks resume.
    expect(section).toContain("sdd complete (");
  });

  it("says why the count is there — a struggling run should be visible", () => {
    expect(section).toMatch(/at a glance|struggling/i);
  });
});

describe("run directory placement", () => {
  it("gives `<run>` a single definition", () => {
    expect(whole).toMatch(/`<run>`/);
  });

  it("states the main-checkout placement", () => {
    expect(whole).toMatch(/main checkout/i);
  });

  it("gives the before-the-worktree reason", () => {
    // The ledger is appended during Phase 1, and `setup` — which creates the
    // worktree — is the next stage.
    expect(whole).toMatch(/before the worktree|exists before/i);
  });

  it("gives the survives-the-worktree reason", () => {
    // The reaper deletes worktrees after merge; a ledger inside one is
    // destroyed along with every completed run's PR URL.
    expect(whole).toMatch(/reaper deletes|survive/i);
  });

  it("says findings.jsonl inherits the same placement", () => {
    expect(whole).toMatch(/findings\.jsonl[^.]{0,200}same placement|inherits/i);
  });

  it("records the worktree-cannot-write-to-main-checkout constraint", () => {
    // A worktree-isolated session cannot Write/Edit to the main checkout,
    // though Bash appends and reads work. Recording it stops the next agent
    // rediscovering it mid-run.
    expect(whole).toMatch(/Bash append/i);
  });
});
```

Append to `plugins/autopilot/scripts/autopilot-ledger-coupling.test.mjs`, inside the existing `describe("SKILL.md <-> nextStage coupling", ...)` block:

```js
  it('"sdd complete" with fix-round counts still returns "land"', () => {
    // The entry grew a fix-round clause. nextStage matches it by PREFIX, so
    // the longer wording must keep resolving to the same stage.
    const cumulative = [
      ...STAGE_ENTRIES.slice(0, 5).map(([text]) => text), // through "plan complete"
      "sdd complete (10 tasks, 0 parked, 7 fix rounds across 4 tasks)",
    ];
    const ledger = buildLedger(cumulative);
    expect(nextStage(parseLedger(ledger))).toBe("land");
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run plugins/autopilot/scripts/autopilot-findings-contract.test.mjs plugins/autopilot/scripts/autopilot-ledger-coupling.test.mjs`
Expected: The findings-contract file FAILS on `/fix rounds/i` and the placement assertions. The ledger-coupling file PASSES already — `nextStage` matches by prefix, which is exactly what that test documents.

- [ ] **Step 3: Write the prose**

**3a.** In `plugins/autopilot/skills/autopilot/SKILL.md`, replace the `sdd` section's final line:

```markdown
Append: `sdd complete (<n> tasks, <k> parked)`.
```

with:

```markdown
Append: `sdd complete (<n> tasks, <k> parked, <f> fix rounds across <t> tasks)`
— for example `sdd complete (10 tasks, 0 parked, 7 fix rounds across 4 tasks)`.
Count a fix round every time a task returns to its implementer after a review
finding; `<t>` is how many distinct tasks needed at least one. Keep the
`sdd complete (` prefix exactly — `nextStage` matches it to resume the run at
`land`. Without the fix-round clause, a run where every task needed three
rounds renders identically to one where all passed first try, so a struggling
run is invisible at a glance.
```

**3b.** In the same file, insert this subsection immediately after the `## Phase 2 — automated` heading's opening line ("Do not ask your human partner anything in Phase 2 unless a stage parks.") and before "**Every dispatch:**":

```markdown
### The run directory

`<run>` is **one string for the whole run**: the run name chosen at Phase 1,
used verbatim in every path below. It is not the worktree directory name and
not the `worktree-` prefixed git branch. Those may differ; `<run>` does not
change to follow them. Pick it once and reuse it.

The run directory is `.superpowers/autopilot/<run>/` in the **main checkout** —
never inside the worktree. Both `run.md` and `findings.jsonl` live there, and
`findings.jsonl` inherits this placement for the same two reasons:

1. **It exists before the worktree does.** `started (phase 1)` and
   `design approved` are appended during Phase 1, and `setup` — the stage that
   creates the worktree — comes after them.
2. **It must survive the worktree.** The reaper deletes worktrees after merge.
   A ledger inside one destroys the record of every completed run, including
   the PR URL that `nextStage` returns `done` on.

**Known constraint:** a worktree-isolated session cannot Write or Edit files in
the main checkout, though **Bash appends (`>>`) and reads still work**. Use a
Bash append for `run.md` (via `autopilot-ledger.mjs`) and for `findings.jsonl`.
This is a harness limitation, recorded here so it is not rediscovered mid-run.
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run plugins/autopilot/scripts/autopilot-findings-contract.test.mjs plugins/autopilot/scripts/autopilot-ledger-coupling.test.mjs`
Expected: PASS — 17 findings-contract tests, 11 ledger-coupling tests

- [ ] **Step 5: Confirm the other prose guards still pass**

Run: `npx vitest run plugins/autopilot/scripts/autopilot-sdd-contract.test.mjs plugins/autopilot/scripts/autopilot-no-design-gate.test.mjs`
Expected: PASS (5 + 9 tests) — both unchanged. The new `### The run directory` heading sits inside `## Phase 2 — automated`, well before `### \`sdd\``, so it cannot widen or truncate the `sdd` section those tests scope to.

- [ ] **Step 6: Run the full suite**

Run: `npm test`
Expected: PASS — 155 tests across 9 files

- [ ] **Step 7: Commit**

```bash
git add plugins/autopilot/skills/autopilot/SKILL.md plugins/autopilot/scripts/autopilot-findings-contract.test.mjs plugins/autopilot/scripts/autopilot-ledger-coupling.test.mjs
git commit -m "feat(autopilot): record fix rounds in the ledger and pin the run directory placement"
```

---

### Task 7: `/autopilot-findings` command and version bump

Ship the human-facing command that renders the candidate report, and bump the plugin to 1.3.0.

**Files:**
- Create: `plugins/autopilot/commands/autopilot-findings.md`
- Modify: `plugins/autopilot/.claude-plugin/plugin.json`
- Modify: `.claude-plugin/marketplace.json`
- Modify: `plugins/autopilot/scripts/autopilot-findings-contract.test.mjs`

**Interfaces:**
- Consumes: `main()` / `report` CLI from Task 3, `findings_threshold` from Task 4.
- Produces: the `/autopilot-findings` slash command.

Note: `plugin.json` currently declares only `"skills": ["./skills/"]`. A `commands` key is required for the new directory to register.

- [ ] **Step 1: Write the failing test**

Append to `plugins/autopilot/scripts/autopilot-findings-contract.test.mjs` (it already imports `readFileSync`, `join`, and `HERE`):

```js
describe("plugin packaging", () => {
  const pluginJson = JSON.parse(
    readFileSync(join(HERE, "..", ".claude-plugin", "plugin.json"), "utf8"),
  );
  const marketplace = JSON.parse(
    readFileSync(join(HERE, "..", "..", "..", ".claude-plugin", "marketplace.json"), "utf8"),
  );

  it("registers the commands directory so the new command loads", () => {
    expect(pluginJson.commands).toEqual(["./commands/"]);
  });

  it("is at version 1.3.0", () => {
    expect(pluginJson.version).toBe("1.3.0");
  });

  it("bumps the marketplace plugin entry to the same version", () => {
    const entry = marketplace.plugins.find((p) => p.name === "autopilot");
    expect(entry.version).toBe("1.3.0");
  });

  it("bumps the marketplace metadata block too", () => {
    // Two places in one file. Bumping only the plugin entry is the drift this
    // pins.
    expect(marketplace.metadata.version).toBe("1.3.0");
  });

  it("ships the findings command", () => {
    const command = readFileSync(
      join(HERE, "..", "commands", "autopilot-findings.md"),
      "utf8",
    );
    expect(command).toContain("autopilot-findings.mjs");
    expect(command).toContain("findings_threshold");
    // The command proposes; the human disposes.
    expect(command).toMatch(/approv/i);
    expect(command).toMatch(/do not (write|inject)/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run plugins/autopilot/scripts/autopilot-findings-contract.test.mjs`
Expected: FAIL — `expected undefined to equal [ './commands/' ]`

- [ ] **Step 3: Write the command**

Create `plugins/autopilot/commands/autopilot-findings.md`:

```markdown
---
description: Cluster autopilot's captured review findings into rule candidates for you to approve, reject, or edit
---

# Autopilot findings

Read the findings corpus across all runs, cluster it, and present the
candidates that cleared the threshold.

## Run the report

Resolve the plugin root the same way the autopilot skill does — the harness
prefixes this command with a `Base directory` line pointing at the plugin.
Then, from the repository root:

```bash
AP="<the plugin root>"
THRESHOLD=$(node -e "import('$AP/scripts/autopilot-config.mjs').then(m=>console.log(m.loadConfig('.claude/autopilot.json').config.findings_threshold))")
node "$AP/scripts/autopilot-findings.mjs" report .superpowers/autopilot "$THRESHOLD"
```

`findings_threshold` comes from `.claude/autopilot.json`, layered over the
plugin default of 2. If the corpus is empty, say so and stop — no run has
captured findings yet.

## Present the candidates

Show the report as printed. For each candidate, state the stage at fault, the
pattern, the count, and the evidence — run, task, and round per occurrence. The
evidence is the point: a bare count gives your human partner nothing to judge.

Then ask, one candidate at a time:

- **Approve** — record the rule as a candidate for later injection.
- **Reject** — say why in one line, so the same cluster is not re-proposed
  blind next time.
- **Edit** — reword the rule and then approve the reworded version.

## Recording an approval

Append approved candidates to `.superpowers/autopilot/rules.md` in the **main
checkout**, each with its stage, its pattern, and a one-line count of the
evidence behind it.

**Do not write any rule into a stage prompt.** Injection is deliberately out of
scope: an approved candidate is recorded for a human to act on later, never
wired into a prompt automatically. A pipeline that silently rewrites its own
prompts from its own review output drifts, and instruction drift is harder to
notice and trace than code drift.

Nothing is written without an explicit yes.
```

- [ ] **Step 4: Bump the versions**

In `plugins/autopilot/.claude-plugin/plugin.json`, set `"version": "1.3.0"` and add the commands key after `"skills"`:

```json
  "skills": ["./skills/"],
  "commands": ["./commands/"]
```

In `.claude-plugin/marketplace.json`, set BOTH `metadata.version` and the `autopilot` plugin entry's `version` to `"1.3.0"`.

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run plugins/autopilot/scripts/autopilot-findings-contract.test.mjs`
Expected: PASS (22 tests)

- [ ] **Step 6: Smoke-test the CLI end to end**

The unit tests inject fake readers, so nothing has yet proved the CLI reads a real directory. Build a throwaway corpus under the scratchpad — not in the repo — and run the real command:

```bash
D=$(mktemp -d)/autopilot && mkdir -p "$D/run-a" "$D/run-b"
printf '%s\n' '{"task":4,"round":1,"severity":"major","stage_at_fault":"brief","pattern":"brief introduced dead code","detail":"unused logger","verdict":"CONFIRMED"}' '{"task":5,"clean":true}' > "$D/run-a/findings.jsonl"
printf '%s\n' '{"task":2,"round":2,"severity":"minor","stage_at_fault":"brief","pattern":"brief introduced dead code","detail":"unused field","verdict":"CONFIRMED"}' > "$D/run-b/findings.jsonl"
node plugins/autopilot/scripts/autopilot-findings.mjs report "$D" 2
```

Expected: a report with one candidate — `[brief] brief introduced dead code — 2 occurrences` — listing `run-a: task 4, round 1` and `run-b: task 2, round 2`, and reporting 1 clean line. Then delete the temp directory.

- [ ] **Step 7: Run the full suite**

Run: `npm test`
Expected: PASS — 160 tests across 9 files

- [ ] **Step 8: Commit**

```bash
git add plugins/autopilot/commands/autopilot-findings.md plugins/autopilot/.claude-plugin/plugin.json .claude-plugin/marketplace.json plugins/autopilot/scripts/autopilot-findings-contract.test.mjs
git commit -m "feat(autopilot): add the /autopilot-findings command and bump to 1.3.0"
```

---

## Open Questions

Noted rather than silently resolved. None of these block implementation — each has a stated default the plan already follows.

1. **Who counts fix rounds for the ledger entry?** The spec says `sdd complete` gains fix-round counts but does not say whether the orchestrator derives them from `findings.jsonl` or the SDD stage agent reports them. The plan takes the second reading — the stage agent reports the numbers, since it is the only party that observes the rounds as they happen — and does not add a helper to derive them from the corpus. Deriving them would also undercount when the capture contract is not followed.

2. **`rules.md` has no schema.** The spec says an approved candidate is "recorded for later" but not in what form. Task 7 records prose entries in `.superpowers/autopilot/rules.md`. If a future injection stage needs to parse them, that format will need pinning — which is properly the deferred injection work's problem, not this run's.

3. **The corpus is never pruned.** `collectCorpus` reads every run directory that has ever existed. That is correct for now (the whole point is cross-run signal), but a long-lived repository will eventually want a date window on the report. Deferred until real corpus size shows it matters.

4. **`round` on a first-pass finding.** The plan's examples use `round: 1` for a finding raised on the initial review. The spec does not state whether the first review is round 1 or round 0. The capture contract does not pin it, so clustering is unaffected — `round` is evidence, never part of the key — but two agents could record the same review differently. Worth pinning if the evidence lists ever read confusingly.
