# Brainstorm Question Capture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Capture every clarifying question autopilot's Phase 1 had to ask into a per-run JSONL corpus, and cluster that corpus into missing-context candidates a human can approve.

**Architecture:** One new module, `plugins/autopilot/scripts/autopilot-questions.mjs`, mirroring `autopilot-findings.mjs` exactly: pure functions over strings and arrays, with file access injected, plus a thin two-subcommand CLI (`capture`, `report`). The orchestrator calls `capture` once at the Phase 1 handoff; the `/autopilot-findings` command gains a second report invocation. No new config key — the threshold reuses `findings_threshold`, which already exists and needs no work.

**Tech Stack:** Node 20+ ESM (`"type": "module"`), vitest 3, no runtime dependencies.

**Spec:** `docs/superpowers/specs/2026-08-26-brainstorm-question-capture-design.md`

## Global Constraints

- **Never assert a version literal in any test.** Per `CLAUDE.md`, CI rewrites all six version fields on every push to `main`; a pinned literal turns `main` red and disables the automation.
- **`plugins/autopilot/skills/autopilot-brainstorm/SKILL.md` must not be modified by any task.** The fork is deliberately free of autopilot-specific coupling; the run directory is autopilot's concern (AC12).
- **No new config key.** The threshold reads from the existing `findings_threshold` key — already declared in `plugins/autopilot/autopilot.default.json` (value `2`), already listed in `TOP_LEVEL` and validated in `plugins/autopilot/scripts/autopilot-config.mjs`, already tested in `autopilot-config.test.mjs`. AC10 is satisfied by the repo as it stands; **no task touches config** (AC10).
- **The corpus lives in the main checkout** at `.superpowers/autopilot/<run>/questions.jsonl`, beside `run.md` and `findings.jsonl`. It must exist before the worktree does and survive the reaper.
- **The line carries exactly five fields** — `seq`, `question`, `answer`, `answer_source`, `pattern` — and **no `run` field**. The run is the directory name.
- **`answer_source` is a closed enum**: `task`, `repo`, `claude_md`, `config`, `judgment`.
- Conventional-commit messages (`feat:`, `test:`, `docs:`). A `feat:` squash title yields a minor bump.
- Full suite: `npm test` (which is `vitest run`) from the repository root. Single file: `npx vitest run <path>`.

---

### Task 1: `capture` — validation and the all-or-nothing append

**Files:**
- Create: `plugins/autopilot/scripts/autopilot-questions.mjs`
- Test: `plugins/autopilot/scripts/autopilot-questions.test.mjs`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces, all exported from `plugins/autopilot/scripts/autopilot-questions.mjs`:
  - `ANSWER_SOURCES: string[]` — exactly `["task", "repo", "claude_md", "config", "judgment"]`
  - `ANSWERABLE_SOURCES: string[]` — `ANSWER_SOURCES` without `"judgment"`
  - `validateQuestions(list) -> { ok: true, questions } | { ok: false, error: string }`
  - `captureQuestions({ runDir, questions }, deps = { append: appendFileSync, mkdir: mkdirSync }) -> { ok: true, path, count } | { ok: false, error }`
  - `main(argv = process.argv.slice(2))` — handles the `capture` subcommand; Task 2 adds `report` to this same function.
  - CLI surface Task 3 documents verbatim: `node <plugin root>/scripts/autopilot-questions.mjs capture --run-dir=<dir> --questions=@<path>`

- [ ] **Step 1: Write the failing tests**

Create `plugins/autopilot/scripts/autopilot-questions.test.mjs`:

```js
// Capture is all-or-nothing on purpose: a half-landed batch is worse than no
// batch, because the lines that did not land are invisible afterwards. These
// tests inject the file writes so the validation logic is exercised without a
// fixture tree, and use one real tmpdir round-trip to prove the write appends
// rather than truncates.

import { describe, it, expect } from "vitest";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ANSWER_SOURCES,
  ANSWERABLE_SOURCES,
  validateQuestions,
  captureQuestions,
  main,
} from "./autopilot-questions.mjs";

const question = (over = {}) => ({
  seq: 1,
  question: "Where should the corpus live?",
  answer: "Beside run.md in the main checkout.",
  answer_source: "repo",
  pattern: "artifact placement not stated",
  ...over,
});

/** Records the writes a capture would make, so nothing touches the disk. */
const spyDeps = () => {
  const calls = [];
  return {
    calls,
    deps: {
      append: (path, body) => calls.push({ kind: "append", path, body }),
      mkdir: () => {},
    },
  };
};

describe("ANSWER_SOURCES", () => {
  it("is the closed enum the spec fixes", () => {
    expect(ANSWER_SOURCES).toEqual(["task", "repo", "claude_md", "config", "judgment"]);
  });

  it("treats every source but judgment as answerable", () => {
    expect(ANSWERABLE_SOURCES).toEqual(["task", "repo", "claude_md", "config"]);
  });
});

describe("validateQuestions", () => {
  it("accepts a well-formed batch", () => {
    const result = validateQuestions([question(), question({ seq: 2 })]);
    expect(result.ok).toBe(true);
    expect(result.questions).toHaveLength(2);
  });

  it("accepts every value in the enum", () => {
    for (const answer_source of ANSWER_SOURCES) {
      expect(validateQuestions([question({ answer_source })]).ok).toBe(true);
    }
  });

  it("rejects a non-array", () => {
    expect(validateQuestions({ seq: 1 })).toEqual({
      ok: false,
      error: "questions: expected a JSON array",
    });
  });

  it("names the index and the field of a missing value", () => {
    const result = validateQuestions([question(), question({ seq: 2, pattern: undefined })]);
    expect(result.ok).toBe(false);
    expect(result.error).toContain("questions[1]");
    expect(result.error).toContain("pattern");
  });

  it("rejects a field that is present but empty", () => {
    const result = validateQuestions([question({ answer: "   " })]);
    expect(result.ok).toBe(false);
    expect(result.error).toContain("questions[0]");
    expect(result.error).toContain("answer");
  });

  it("names the index and the field of a value outside the enum", () => {
    const result = validateQuestions([question({ answer_source: "vibes" })]);
    expect(result.ok).toBe(false);
    expect(result.error).toContain("questions[0]");
    expect(result.error).toContain("answer_source");
  });

  it("rejects a seq that is not a positive integer", () => {
    for (const seq of [0, -1, 1.5, "1", undefined]) {
      const result = validateQuestions([question({ seq })]);
      expect(result.ok).toBe(false);
      expect(result.error).toContain("seq");
    }
  });
});

describe("captureQuestions", () => {
  it("appends one line per element, carrying exactly the five fields", () => {
    const { calls, deps } = spyDeps();
    const result = captureQuestions(
      { runDir: "/runs/alpha", questions: [question(), question({ seq: 2 })] },
      deps,
    );

    expect(result).toMatchObject({ ok: true, count: 2 });
    expect(result.path).toBe("/runs/alpha/questions.jsonl");
    expect(calls).toHaveLength(1);

    const lines = calls[0].body.trimEnd().split("\n").map((l) => JSON.parse(l));
    expect(lines).toHaveLength(2);
    expect(Object.keys(lines[0]).sort()).toEqual(
      ["answer", "answer_source", "pattern", "question", "seq"],
    );
  });

  it("never writes a run field, even when the batch carries one", () => {
    // The run is the directory name; a `run` key in the line would let the two
    // disagree, and collectQuestionCorpus would still trust the directory.
    const { calls, deps } = spyDeps();
    captureQuestions(
      { runDir: "/runs/alpha", questions: [{ ...question(), run: "beta" }] },
      deps,
    );
    expect(JSON.parse(calls[0].body.trim()).run).toBeUndefined();
  });

  it("writes nothing at all when any element is invalid", () => {
    const { calls, deps } = spyDeps();
    const result = captureQuestions(
      {
        runDir: "/runs/alpha",
        questions: [question(), question({ seq: 2, answer_source: "vibes" })],
      },
      deps,
    );

    expect(result.ok).toBe(false);
    expect(result.error).toContain("questions[1]");
    expect(result.error).toContain("answer_source");
    expect(calls).toEqual([]);
  });
});

describe("the capture CLI", () => {
  it("appends to an existing questions.jsonl instead of truncating it", () => {
    // Real files here, not injected writes: append-versus-truncate is a
    // property of the write call itself, and a spy cannot fail on it.
    const runDir = mkdtempSync(join(tmpdir(), "autopilot-questions-"));
    const batch = join(runDir, "batch.json");

    writeFileSync(batch, JSON.stringify([question()]), "utf8");
    main(["capture", `--run-dir=${runDir}`, `--questions=@${batch}`]);

    writeFileSync(batch, JSON.stringify([question({ seq: 2 }), question({ seq: 3 })]), "utf8");
    main(["capture", `--run-dir=${runDir}`, `--questions=@${batch}`]);

    const lines = readFileSync(join(runDir, "questions.jsonl"), "utf8")
      .trimEnd()
      .split("\n")
      .map((l) => JSON.parse(l));
    expect(lines.map((l) => l.seq)).toEqual([1, 2, 3]);
  });

  it("exits non-zero and writes nothing when the batch is invalid", () => {
    const runDir = mkdtempSync(join(tmpdir(), "autopilot-questions-"));
    const batch = join(runDir, "batch.json");
    writeFileSync(batch, JSON.stringify([question({ answer_source: "vibes" })]), "utf8");

    process.exitCode = 0;
    main(["capture", `--run-dir=${runDir}`, `--questions=@${batch}`]);
    expect(process.exitCode).toBe(1);
    process.exitCode = 0;

    expect(() => readFileSync(join(runDir, "questions.jsonl"), "utf8")).toThrow();
  });

  it("rejects a --questions value that is not @<path>", () => {
    process.exitCode = 0;
    main(["capture", "--run-dir=/runs/alpha", "--questions=[]"]);
    expect(process.exitCode).toBe(1);
    process.exitCode = 0;
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run plugins/autopilot/scripts/autopilot-questions.test.mjs`

Expected: FAIL — `Failed to resolve import "./autopilot-questions.mjs"`; the module does not exist yet.

- [ ] **Step 3: Write the implementation**

Create `plugins/autopilot/scripts/autopilot-questions.mjs`:

```js
/**
 * The brainstorm-question corpus: one JSON object per line, appended once at
 * the Phase 1 handoff to `.superpowers/autopilot/<run>/questions.jsonl` in the
 * main checkout.
 *
 * Every clarifying question Phase 1 had to ask marks context the pipeline
 * could not find on its own — in the task description, in the repo, in
 * CLAUDE.md, or in config. Recording them is what turns "are we needing the
 * human less?" into a measurable question.
 *
 * Structured like autopilot-findings.mjs on purpose: pure functions over
 * strings and arrays, with file access injected, and a thin CLI at the bottom.
 */

import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

/**
 * Where the answer SHOULD have lived — not what the question was about.
 *
 * The enum is closed because it is half the clustering key: an agent inventing
 * "design" or "user" fragments every count downstream.
 */
export const ANSWER_SOURCES = ["task", "repo", "claude_md", "config", "judgment"];

/**
 * `judgment` is genuine human preference — no artifact could have supplied it.
 * It is recorded so the corpus has a denominator, and excluded from candidates
 * by construction: proposing a fix for a recurring judgment call would push
 * the pipeline toward guessing at product decisions.
 */
export const ANSWERABLE_SOURCES = ANSWER_SOURCES.filter((s) => s !== "judgment");

const isNonEmptyString = (v) => typeof v === "string" && v.trim() !== "";

/**
 * Validate a whole batch before a byte is written.
 *
 * The message names the offending index and field so the author can fix the
 * array without guessing which element failed.
 */
export function validateQuestions(list) {
  if (!Array.isArray(list)) {
    return { ok: false, error: "questions: expected a JSON array" };
  }

  for (const [i, q] of list.entries()) {
    if (q === null || typeof q !== "object" || Array.isArray(q)) {
      return { ok: false, error: `questions[${i}]: expected a JSON object` };
    }
    if (!Number.isInteger(q.seq) || q.seq < 1) {
      return { ok: false, error: `questions[${i}].seq: must be a positive integer` };
    }
    for (const field of ["question", "answer", "pattern"]) {
      if (!isNonEmptyString(q[field])) {
        return { ok: false, error: `questions[${i}].${field}: missing or empty` };
      }
    }
    if (!ANSWER_SOURCES.includes(q.answer_source)) {
      return {
        ok: false,
        error: `questions[${i}].answer_source: must be one of ${ANSWER_SOURCES.join(", ")}`,
      };
    }
  }

  return { ok: true, questions: list };
}

/**
 * Append one line per element to `<runDir>/questions.jsonl`.
 *
 * All-or-nothing: validation runs over the whole batch first, so a bad element
 * costs the batch rather than landing half of it. A half-landed batch is worse
 * than none, because the missing lines are invisible afterwards.
 *
 * Each line is built field by field rather than by spreading the input, so an
 * extra key — a `run` field especially, which the directory name already
 * carries — never reaches the corpus.
 */
export function captureQuestions(
  { runDir, questions },
  deps = { append: appendFileSync, mkdir: mkdirSync },
) {
  const validated = validateQuestions(questions);
  if (!validated.ok) return validated;

  const path = join(runDir, "questions.jsonl");
  const body = validated.questions
    .map(
      (q) =>
        JSON.stringify({
          seq: q.seq,
          question: q.question,
          answer: q.answer,
          answer_source: q.answer_source,
          pattern: q.pattern,
        }) + "\n",
    )
    .join("");

  deps.mkdir(runDir, { recursive: true });
  deps.append(path, body, "utf8");
  return { ok: true, path, count: validated.questions.length };
}

/** `capture --run-dir=<dir> --questions=@<path>` appends a batch. */
export function main(argv = process.argv.slice(2)) {
  const [command, ...rest] = argv;
  const flag = (name, fallback) =>
    rest.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;

  if (command === "capture") {
    const runDir = flag("run-dir");
    const questionsArg = flag("questions");
    if (!runDir || !questionsArg) {
      console.error(
        "usage: autopilot-questions.mjs capture --run-dir=<dir> --questions=@<path>",
      );
      process.exitCode = 1;
      return;
    }
    // Only `@<path>` is accepted. A JSON array passed inline would have to
    // survive the shell's quoting, and a batch that arrives mangled looks
    // exactly like a batch the author got wrong.
    if (!questionsArg.startsWith("@")) {
      console.error("--questions must be @<path> to a file holding a JSON array");
      process.exitCode = 1;
      return;
    }
    const batchPath = questionsArg.slice(1);
    let parsed;
    try {
      parsed = JSON.parse(readFileSync(batchPath, "utf8"));
    } catch (err) {
      console.error(`cannot read questions from ${batchPath}: ${err.message}`);
      process.exitCode = 1;
      return;
    }
    const result = captureQuestions({ runDir, questions: parsed });
    if (!result.ok) {
      console.error(result.error);
      process.exitCode = 1;
      return;
    }
    console.log(`captured ${result.count} question(s) → ${result.path}`);
    return;
  }

  console.error("usage: autopilot-questions.mjs capture [...]");
  process.exitCode = 1;
}

// pathToFileURL rather than a `file://` template: the plugin's install path is
// user-controlled and a space in it would silently skip main().
if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
```

Do **not** import `readdirSync` here — nothing in this task uses it, and an unused import is dead code. Task 2 adds it along with the code that needs it.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run plugins/autopilot/scripts/autopilot-questions.test.mjs`

Expected: PASS — all tests green.

- [ ] **Step 5: Prove the all-or-nothing assertion can fail**

Temporarily move the `deps.append(...)` call in `captureQuestions` above the `if (!validated.ok) return validated;` guard, building `body` from the raw `questions` argument. Re-run the file.

Expected: FAIL on "writes nothing at all when any element is invalid" and on "exits non-zero and writes nothing when the batch is invalid". Then revert the change and re-run to green.

- [ ] **Step 6: Run the full suite**

Run: `npm test`

Expected: PASS — no existing test regresses.

- [ ] **Step 7: Commit**

```bash
git add plugins/autopilot/scripts/autopilot-questions.mjs plugins/autopilot/scripts/autopilot-questions.test.mjs
git commit -m "feat(autopilot): capture brainstorm clarifying questions to a per-run corpus"
```

---

### Task 2: `report` — parse, walk, cluster, summarize, format

**Files:**
- Modify: `plugins/autopilot/scripts/autopilot-questions.mjs` (add the report functions; extend `main`)
- Test: `plugins/autopilot/scripts/autopilot-questions.test.mjs` (append new `describe` blocks)

**Interfaces:**
- Consumes, from Task 1 in the same file: `ANSWER_SOURCES`, `ANSWERABLE_SOURCES`, `validateQuestions(list)`, and the existing `main(argv)`.
- Consumes, from `./autopilot-findings.mjs` (already exported there): `splitThresholdFlag(argv) -> { positional, flagValue }`.
- Produces, all exported from `plugins/autopilot/scripts/autopilot-questions.mjs`:
  - `parseQuestions(contents) -> { questions, malformed }`
  - `collectQuestionCorpus(root, deps) -> { entries, malformed }` where `entries` is `[{ run, questions }]`
  - `clusterQuestions(entries) -> [{ answer_source, pattern, count, occurrences: [{ run, seq, question, answer }] }]`
  - `summarize(entries) -> { questions, runs, judgment, answerable }`
  - `candidates(clusters, threshold) -> clusters[]` — exactly two parameters
  - `formatQuestionSection(clusters, { threshold, summary, malformed }) -> string`
  - CLI surface Task 3 documents verbatim: `node <plugin root>/scripts/autopilot-questions.mjs report .superpowers/autopilot "$THRESHOLD"`
  - The summary line `formatQuestionSection` renders, which Task 3 documents with placeholders: `Brainstorm questions: N across R runs — J judgment, A answerable`

**One definition fixed here, because Task 3's prose depends on it:** `summary.runs` counts only runs that carry **at least one** question. A run directory with no `questions.jsonl` — every run predating this feature — contributes zero to both `questions` and `runs`.

- [ ] **Step 1: Write the failing tests**

Append to `plugins/autopilot/scripts/autopilot-questions.test.mjs`. First extend the existing import from `./autopilot-questions.mjs` with these six names: `parseQuestions`, `collectQuestionCorpus`, `clusterQuestions`, `summarize`, `candidates`, `formatQuestionSection`. Then append:

```js
const jsonl = (...objs) => objs.map((o) => JSON.stringify(o)).join("\n");

/** A corpus entry as collectQuestionCorpus returns it. */
const entry = (run, ...questions) => ({ run, questions });

describe("parseQuestions", () => {
  it("parses a question line into a record", () => {
    const { questions, malformed } = parseQuestions(jsonl(question()));
    expect(malformed).toBe(0);
    expect(questions).toHaveLength(1);
    expect(questions[0].answer_source).toBe("repo");
    expect(questions[0].pattern).toBe("artifact placement not stated");
  });

  it("skips an unparseable line, counts it, and keeps the valid ones", () => {
    const { questions, malformed } = parseQuestions(
      [JSON.stringify(question()), "{ not json", JSON.stringify(question({ seq: 9 }))].join("\n"),
    );
    expect(questions.map((q) => q.seq)).toEqual([1, 9]);
    expect(malformed).toBe(1);
  });

  it("ignores blank lines without counting them as malformed", () => {
    const { questions, malformed } = parseQuestions(`\n${JSON.stringify(question())}\n\n  \n`);
    expect(questions).toHaveLength(1);
    expect(malformed).toBe(0);
  });

  it("counts a line with an unknown answer_source as malformed", () => {
    const { questions, malformed } = parseQuestions(jsonl(question({ answer_source: "vibes" })));
    expect(questions).toHaveLength(0);
    expect(malformed).toBe(1);
  });

  it("counts a line missing a required field as malformed", () => {
    const { questions, malformed } = parseQuestions(jsonl({ seq: 1, question: "x" }));
    expect(questions).toHaveLength(0);
    expect(malformed).toBe(1);
  });

  it("returns empty results for an empty file", () => {
    expect(parseQuestions("")).toEqual({ questions: [], malformed: 0 });
  });
});

describe("collectQuestionCorpus", () => {
  // `files` maps a run name to its questions.jsonl contents, or to null for a
  // run that has no such file.
  const deps = (files) => ({
    listRuns: () => Object.keys(files),
    readFile: (path) => {
      const run = path.split("/").at(-2);
      const contents = files[run];
      if (contents === undefined || contents === null) throw new Error("ENOENT");
      return contents;
    },
  });

  it("attributes each entry to its run by directory name", () => {
    const { entries } = collectQuestionCorpus(
      ".superpowers/autopilot",
      deps({ alpha: jsonl(question()), beta: jsonl(question({ seq: 2 })) }),
    );
    expect(entries.map((e) => e.run)).toEqual(["alpha", "beta"]);
    expect(entries[1].questions[0].seq).toBe(2);
  });

  it("treats a run with no questions.jsonl as a run with zero questions", () => {
    // Every run predating this feature is one. Throwing here would make the
    // report unrunnable on any real corpus.
    const { entries } = collectQuestionCorpus(
      ".superpowers/autopilot",
      deps({ alpha: null, beta: jsonl(question()) }),
    );
    expect(entries).toEqual([
      { run: "alpha", questions: [] },
      { run: "beta", questions: [question()] },
    ]);
  });

  it("totals malformed lines across runs", () => {
    const { malformed } = collectQuestionCorpus(
      ".superpowers/autopilot",
      deps({ alpha: "{ not json", beta: jsonl(question(), { seq: 2 }) }),
    );
    expect(malformed).toBe(2);
  });
});

describe("clusterQuestions", () => {
  it("clusters on the (answer_source, pattern) pair", () => {
    const clusters = clusterQuestions([
      entry("alpha", question({ pattern: "p" }), question({ seq: 2, pattern: "p" })),
      entry("beta", question({ pattern: "p", answer_source: "task" })),
    ]);
    expect(clusters).toHaveLength(2);
    expect(clusters[0]).toMatchObject({ answer_source: "repo", pattern: "p", count: 2 });
    expect(clusters[1]).toMatchObject({ answer_source: "task", pattern: "p", count: 1 });
  });

  it("carries run, seq, question, and answer as evidence for every occurrence", () => {
    const [cluster] = clusterQuestions([
      entry("alpha", question({ seq: 3, question: "Q3?", answer: "A3." })),
    ]);
    expect(cluster.occurrences).toEqual([
      { run: "alpha", seq: 3, question: "Q3?", answer: "A3." },
    ]);
  });

  it("sorts count-descending", () => {
    const clusters = clusterQuestions([
      entry("alpha", question({ pattern: "rare" })),
      entry("beta", question({ pattern: "common" }), question({ seq: 2, pattern: "common" })),
    ]);
    expect(clusters.map((c) => c.pattern)).toEqual(["common", "rare"]);
  });

  it("breaks a count tie on (answer_source, pattern)", () => {
    const clusters = clusterQuestions([
      entry("alpha", question({ pattern: "zeta", answer_source: "task" })),
      entry("beta", question({ pattern: "alpha", answer_source: "task" })),
      entry("gamma", question({ pattern: "mid", answer_source: "config" })),
    ]);
    expect(clusters.map((c) => `${c.answer_source}/${c.pattern}`)).toEqual([
      "config/mid",
      "task/alpha",
      "task/zeta",
    ]);
  });

  it("produces identical output on repeated runs over an unchanged corpus", () => {
    const corpus = [
      entry("alpha", question({ pattern: "a" }), question({ seq: 2, pattern: "b" })),
      entry("beta", question({ pattern: "b", answer_source: "config" })),
    ];
    expect(clusterQuestions(corpus)).toEqual(clusterQuestions(corpus));
  });
});

describe("summarize", () => {
  it("totals questions, runs, judgment, and answerable", () => {
    const summary = summarize([
      entry("alpha", question(), question({ seq: 2, answer_source: "judgment" })),
      entry("beta", question({ answer_source: "judgment" })),
    ]);
    expect(summary).toEqual({ questions: 3, runs: 2, judgment: 2, answerable: 1 });
  });

  it("counts judgment questions in the totals", () => {
    // Without the denominator, a run that asked two answerable questions is
    // indistinguishable from one that asked two answerable and twenty
    // judgment calls.
    const summary = summarize([entry("alpha", question({ answer_source: "judgment" }))]);
    expect(summary.questions).toBe(1);
    expect(summary.answerable).toBe(0);
  });

  it("does not count a run that captured no questions", () => {
    const summary = summarize([entry("alpha"), entry("beta", question())]);
    expect(summary).toEqual({ questions: 1, runs: 1, judgment: 0, answerable: 1 });
  });

  it("reports zeroes for an empty corpus", () => {
    expect(summarize([])).toEqual({ questions: 0, runs: 0, judgment: 0, answerable: 0 });
  });
});

describe("candidates", () => {
  const clusters = () =>
    clusterQuestions([
      entry(
        "alpha",
        question({ pattern: "repo gap" }),
        question({ seq: 2, pattern: "repo gap" }),
        question({ seq: 3, pattern: "taste", answer_source: "judgment" }),
        question({ seq: 4, pattern: "taste", answer_source: "judgment" }),
        question({ seq: 5, pattern: "taste", answer_source: "judgment" }),
        question({ seq: 6, pattern: "one-off", answer_source: "task" }),
      ),
    ]);

  it("returns only clusters at or above the threshold", () => {
    expect(candidates(clusters(), 2).map((c) => c.pattern)).toEqual(["repo gap"]);
    expect(candidates(clusters(), 1).map((c) => c.pattern).sort()).toEqual([
      "one-off",
      "repo gap",
    ]);
  });

  it("excludes judgment even when it is the most frequent cluster", () => {
    expect(candidates(clusters(), 1).some((c) => c.answer_source === "judgment")).toBe(false);
  });

  it("takes no flag that could re-admit judgment", () => {
    // The exclusion is structural, not a caller-supplied option: a caller
    // passing anything extra still gets judgment filtered out.
    expect(candidates.length).toBe(2);
    const forced = candidates(clusters(), 1, { includeJudgment: true });
    expect(forced.some((c) => c.answer_source === "judgment")).toBe(false);
  });
});

describe("formatQuestionSection", () => {
  const summary = { questions: 7, runs: 3, judgment: 2, answerable: 5 };

  it("prints the one-line summary in the documented shape", () => {
    const out = formatQuestionSection([], { threshold: 2, summary, malformed: 0 });
    expect(out.split("\n")[0]).toBe(
      "Brainstorm questions: 7 across 3 runs — 2 judgment, 5 answerable",
    );
  });

  it("prints each qualifying cluster with its full evidence", () => {
    const clusters = clusterQuestions([
      entry(
        "alpha",
        question({ seq: 4, question: "Where do tests live?", answer: "Beside the source." }),
      ),
    ]);
    const out = formatQuestionSection(clusters, { threshold: 1, summary, malformed: 0 });
    expect(out).toContain("## Missing-context candidates");
    expect(out).toContain("### [repo] artifact placement not stated — 1 occurrences");
    expect(out).toContain("- alpha: seq 4");
    expect(out).toContain("Where do tests live?");
    expect(out).toContain("Beside the source.");
  });

  it("states that counts are a floor when lines were skipped", () => {
    const out = formatQuestionSection([], { threshold: 2, summary, malformed: 3 });
    expect(out).toContain("3 malformed line(s) were skipped");
    expect(out).toMatch(/floor/i);
  });

  it("says plainly that the corpus is empty, with no empty heading", () => {
    const out = formatQuestionSection([], {
      threshold: 2,
      summary: { questions: 0, runs: 0, judgment: 0, answerable: 0 },
      malformed: 0,
    });
    expect(out).toMatch(/none captured yet/i);
    expect(out).not.toContain("## Missing-context candidates");
  });

  it("keeps the heading when the corpus has questions but nothing recurred", () => {
    const out = formatQuestionSection([], { threshold: 2, summary, malformed: 0 });
    expect(out).toContain("## Missing-context candidates");
    expect(out).toContain("No candidates: no answerable question recurred 2 or more times.");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run plugins/autopilot/scripts/autopilot-questions.test.mjs`

Expected: FAIL — the six new imports are undefined, so every new `describe` errors with "is not a function". Task 1's tests still pass.

- [ ] **Step 3: Write the implementation**

In `plugins/autopilot/scripts/autopilot-questions.mjs`, add `readdirSync` to the `node:fs` import so the line reads:

```js
import { appendFileSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
```

and add this import below the existing ones:

```js
// The threshold flag is parsed exactly as the findings report parses it —
// taking `--threshold=2` positionally makes Number() yield NaN, and
// `count >= NaN` is false for every cluster, so the report silently prints
// "no candidates" for a corpus that has them.
import { splitThresholdFlag } from "./autopilot-findings.mjs";
```

Then insert these functions after `captureQuestions` and before `main`:

```js
/**
 * Parse a questions.jsonl file.
 *
 * Tolerant per line, exactly as parseFindings is: a truncated or interleaved
 * write costs that line, never the file. A line is judged by the same
 * validator that gated its write, so the read and write contracts cannot
 * drift apart.
 */
export function parseQuestions(contents) {
  const questions = [];
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

    if (!validateQuestions([obj]).ok) {
      malformed += 1;
      continue;
    }

    questions.push(obj);
  }

  return { questions, malformed };
}

/**
 * Read every run's questions.jsonl under the autopilot root.
 *
 * Directory listing and file reading are injected so the corpus walk is
 * testable without a fixture tree. A run with no questions.jsonl is normal —
 * every run predating this feature is one — so an unreadable file yields a run
 * with no questions rather than an error.
 */
export function collectQuestionCorpus(
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
  let malformed = 0;

  for (const run of deps.listRuns(root)) {
    let contents;
    try {
      contents = deps.readFile(`${root}/${run}/questions.jsonl`);
    } catch {
      entries.push({ run, questions: [] });
      continue;
    }
    const parsed = parseQuestions(contents);
    entries.push({ run, questions: parsed.questions });
    malformed += parsed.malformed;
  }

  return { entries, malformed };
}

/**
 * Cluster questions by `(answer_source, pattern)` across runs.
 *
 * `pattern` is a short canonical phrase and `question`/`answer` carry the
 * specifics, which is what keeps clustering a pure lexical function instead of
 * something needing a model call. The source is half the key: the same phrase
 * attributed to the repo and to human judgment are different gaps.
 *
 * Sorted count-descending with an (answer_source, pattern) tiebreak so
 * repeated runs over an unchanged corpus print identical output.
 */
export function clusterQuestions(entries) {
  const byKey = new Map();

  for (const { run, questions } of entries) {
    for (const q of questions ?? []) {
      const key = `${q.answer_source}\x00${q.pattern}`;
      if (!byKey.has(key)) {
        byKey.set(key, {
          answer_source: q.answer_source,
          pattern: q.pattern,
          count: 0,
          occurrences: [],
        });
      }
      const cluster = byKey.get(key);
      cluster.count += 1;
      cluster.occurrences.push({
        run,
        seq: q.seq,
        question: q.question,
        answer: q.answer,
      });
    }
  }

  return [...byKey.values()].sort(
    (a, b) =>
      b.count - a.count ||
      a.answer_source.localeCompare(b.answer_source) ||
      a.pattern.localeCompare(b.pattern),
  );
}

/**
 * Corpus totals.
 *
 * `judgment` counts toward `questions` deliberately: it is the denominator.
 * Without it, a run that asked two answerable questions is indistinguishable
 * from one that asked two answerable and twenty judgment calls, and "are we
 * needing the human less?" stops being measurable.
 *
 * `runs` counts only the runs that captured at least one question, so the
 * summary reads as the spread of the questions rather than the size of the
 * directory.
 */
export function summarize(entries) {
  let questions = 0;
  let judgment = 0;
  let runs = 0;

  for (const entry of entries) {
    const list = entry.questions ?? [];
    if (list.length === 0) continue;
    runs += 1;
    questions += list.length;
    judgment += list.filter((q) => q.answer_source === "judgment").length;
  }

  return { questions, runs, judgment, answerable: questions - judgment };
}

/**
 * Clusters worth showing a human: answerable ones seen at least `threshold`
 * times.
 *
 * The judgment filter is structural, not a parameter. A recurring judgment
 * question is not a defect, and offering a caller a way to include it would be
 * offering a way to propose that the pipeline guess at product decisions.
 */
export function candidates(clusters, threshold) {
  return clusters.filter(
    (c) => c.count >= threshold && ANSWERABLE_SOURCES.includes(c.answer_source),
  );
}

/**
 * Render the questions half of the findings report.
 *
 * Every cluster prints its full evidence — run, seq, question, and answer —
 * because the reader's job is to judge whether the gap is real, and a bare
 * count gives them nothing to judge with.
 */
export function formatQuestionSection(clusters, { threshold, summary, malformed = 0 }) {
  const lines = [];
  const floorNote =
    malformed > 0
      ? ["", `Note: ${malformed} malformed line(s) were skipped. Counts above are a floor.`]
      : [];

  if (summary.questions === 0) {
    lines.push(
      "Brainstorm questions: none captured yet — no run has recorded clarifying questions.",
      ...floorNote,
    );
    return lines.join("\n");
  }

  lines.push(
    `Brainstorm questions: ${summary.questions} across ${summary.runs} runs — ` +
      `${summary.judgment} judgment, ${summary.answerable} answerable`,
    ...floorNote,
    "",
    "## Missing-context candidates",
  );

  if (clusters.length === 0) {
    lines.push("", `No candidates: no answerable question recurred ${threshold} or more times.`);
    return lines.join("\n");
  }

  lines.push(
    "",
    "These are proposals. Nothing is written until you approve a candidate;",
    "rejecting or editing one is an equally valid outcome.",
  );

  for (const c of clusters) {
    lines.push("", `### [${c.answer_source}] ${c.pattern} — ${c.count} occurrences`, "");
    for (const o of c.occurrences) {
      lines.push(`- ${o.run}: seq ${o.seq}`, `  - Q: ${o.question}`, `  - A: ${o.answer}`);
    }
  }

  return lines.join("\n");
}
```

Then, inside `main`, insert this `report` block immediately after the `capture` block's closing brace, and replace the single-subcommand usage fallback at the end with the two-subcommand one shown here. There must be exactly one usage fallback at the end of `main` when you are done:

```js
  if (command === "report") {
    const { positional, flagValue } = splitThresholdFlag(rest);
    const [root = ".superpowers/autopilot", positionalThreshold] = positional;
    const rawThreshold = flagValue ?? positionalThreshold ?? "2";
    const threshold = Number(rawThreshold);
    if (!Number.isInteger(threshold) || threshold < 1) {
      console.error(
        `bad threshold: ${JSON.stringify(rawThreshold)} — expected a positive integer`,
      );
      process.exitCode = 1;
      return;
    }
    const { entries, malformed } = collectQuestionCorpus(root);
    const clusters = candidates(clusterQuestions(entries), threshold);
    console.log(
      formatQuestionSection(clusters, { threshold, summary: summarize(entries), malformed }),
    );
    return;
  }

  console.error("usage: autopilot-questions.mjs <capture|report> [root] [threshold|--threshold=N]");
  process.exitCode = 1;
```

Also update the JSDoc line above `main` to `/** `capture` appends a batch; `report` prints the candidate section. */`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run plugins/autopilot/scripts/autopilot-questions.test.mjs`

Expected: PASS — all tests green.

- [ ] **Step 5: Prove the judgment exclusion can fail**

Temporarily drop the `&& ANSWERABLE_SOURCES.includes(c.answer_source)` conjunct from `candidates`. Re-run the file.

Expected: FAIL on "excludes judgment even when it is the most frequent cluster" and on "takes no flag that could re-admit judgment". Revert and re-run to green.

- [ ] **Step 6: Smoke-test the report CLI**

```bash
node plugins/autopilot/scripts/autopilot-questions.mjs report .superpowers/autopilot 2
```

Expected: exit 0, printing either a `Brainstorm questions: N across R runs — ...` line or `Brainstorm questions: none captured yet — no run has recorded clarifying questions.` Quote the actual output in your report rather than paraphrasing it. If `.superpowers/autopilot/` does not exist in this worktree, run the same command from the main checkout instead.

- [ ] **Step 7: Run the full suite**

Run: `npm test`

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add plugins/autopilot/scripts/autopilot-questions.mjs plugins/autopilot/scripts/autopilot-questions.test.mjs
git commit -m "feat(autopilot): cluster the question corpus into missing-context candidates"
```

---

### Task 3: The prose contracts — Phase 1 capture and the findings command

**Files:**
- Modify: `plugins/autopilot/skills/autopilot/SKILL.md` (insert a subsection into `## Phase 1 — brainstorm`)
- Modify: `plugins/autopilot/commands/autopilot-findings.md` (second report invocation and second walkthrough section)
- Create: `plugins/autopilot/scripts/autopilot-questions-contract.test.mjs`

**Interfaces:**
- Consumes, from Task 1: the `capture` CLI — `node "$AP/scripts/autopilot-questions.mjs" capture --run-dir=<dir> --questions=@<path>` — and the exported `ANSWER_SOURCES`.
- Consumes, from Task 2: the `report` CLI — `node "$AP/scripts/autopilot-questions.mjs" report .superpowers/autopilot "$THRESHOLD"` — and the rendered summary shape `Brainstorm questions: N across R runs — J judgment, A answerable`.
- Consumes, from `./skill-sections.mjs` (already exported there): `readSkill()`, `unwrap(s)`, `topSection(markdown, title, { resolve })`.
- Produces: no code that other tasks consume. **Do not modify `plugins/autopilot/skills/autopilot-brainstorm/SKILL.md`** (AC12).

- [ ] **Step 1: Write the failing contract test**

Create `plugins/autopilot/scripts/autopilot-questions-contract.test.mjs`:

```js
// The capture contract is prose. Nothing else fails if it is deleted or
// reworded past recognition: Phase 1 would simply stop capturing, and an empty
// corpus is indistinguishable from a run that needed no clarifying questions.
//
// These tests pin the load-bearing pieces where the agent actually reads them
// — the Phase 1 section of the orchestrator skill, and the findings command —
// matching on phrases rather than whole sentences, so ordinary rewording
// survives but a dropped rule does not.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { ANSWER_SOURCES } from "./autopilot-questions.mjs";
import { readSkill, unwrap, topSection } from "./skill-sections.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

const phase1 = unwrap(topSection(readSkill(), "Phase 1 — brainstorm"));

const commandMd = readFileSync(join(HERE, "..", "commands", "autopilot-findings.md"), "utf8");
const runTheReport = unwrap(topSection(commandMd, "Run the report", { resolve: false }));
const questionSection = unwrap(
  topSection(commandMd, "Present the missing-context candidates", { resolve: false }),
);

describe("Phase 1 carries the question-capture contract", () => {
  it("names the capture invocation and both its flags", () => {
    expect(phase1).toMatch(/autopilot-questions\.mjs"? capture/);
    expect(phase1).toContain("--run-dir=");
    expect(phase1).toContain("--questions=@");
  });

  it("names the corpus file and its main-checkout placement", () => {
    // The file must exist before the worktree does and survive the reaper.
    expect(phase1).toContain("questions.jsonl");
    expect(phase1).toMatch(/main checkout/i);
  });

  it("names every field a question line must carry", () => {
    for (const field of ["seq", "question", "answer", "answer_source", "pattern"]) {
      expect(phase1).toContain(field);
    }
  });

  it("enumerates the closed answer_source list", () => {
    // Without the closed list, agents invent values and the clustering key
    // fragments.
    for (const source of ANSWER_SOURCES) {
      expect(phase1).toMatch(new RegExp(`\\b${source}\\b`));
    }
  });

  it("captures once in a single batch, not per question", () => {
    expect(phase1).toMatch(/single batch/i);
  });

  it("orders capture strictly before the `design approved` ledger entry", () => {
    // `design approved` is what a resume matches to jump to `setup`, so a run
    // that captured after it would re-capture on every resume.
    expect(phase1).toMatch(/Capture before appending .design approved./i);
    expect(phase1).toMatch(/re-?capture/i);
  });

  it("says a capture failure never parks the run", () => {
    expect(phase1).toMatch(/never parks/i);
    expect(phase1).toContain("questions capture failed —");
    expect(phase1).toMatch(/continue the run/i);
  });

  it("requires judgment questions to be recorded rather than dropped", () => {
    expect(phase1).toMatch(/denominator/i);
  });
});

describe("the findings command reports the question corpus", () => {
  it("runs the questions report as a second invocation", () => {
    expect(runTheReport).toContain("autopilot-questions.mjs");
    expect(runTheReport).toContain("autopilot-findings.mjs");
    expect(runTheReport).toContain("findings_threshold");
  });

  it("fixes the output order: review findings first, then the questions", () => {
    expect(runTheReport).toMatch(/review-finding candidates first/i);
  });

  it("documents the one-line summary in the shape the report prints", () => {
    expect(questionSection).toContain(
      "Brainstorm questions: N across R runs — J judgment, A answerable",
    );
  });

  it("documents the candidates section and its full evidence", () => {
    expect(questionSection).toContain("## Missing-context candidates");
    expect(questionSection).toMatch(/run, seq, question, and answer/i);
  });

  it("states that judgment is never proposed as something to fix", () => {
    expect(questionSection).toMatch(/judgment/);
    expect(questionSection).toMatch(/never proposed/i);
  });

  it("records an approval into the existing rules file, with the source and a count", () => {
    expect(questionSection).toContain(".superpowers/autopilot/rules.md");
    expect(questionSection).toContain("answer_source");
    expect(questionSection).toMatch(/count of the evidence/i);
  });

  it("keeps the no-write-without-a-yes and no-injection rules", () => {
    expect(questionSection).toMatch(/explicit yes/i);
    expect(questionSection).toMatch(/do not write/i);
  });
});

describe("the brainstorm fork stays uncoupled", () => {
  it("never mentions the corpus or the capture script", () => {
    // The fork's header sets out to keep it free of autopilot-specific
    // coupling; the run directory is the orchestrator's concern.
    const brainstorm = readFileSync(
      join(HERE, "..", "skills", "autopilot-brainstorm", "SKILL.md"),
      "utf8",
    );
    expect(brainstorm).not.toContain("questions.jsonl");
    expect(brainstorm).not.toContain("autopilot-questions.mjs");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run plugins/autopilot/scripts/autopilot-questions-contract.test.mjs`

Expected: FAIL — `topSection` throws `SKILL.md has no "## Present the missing-context candidates" section` (the helper's error message says `SKILL.md` whatever markdown it is given), and the Phase 1 assertions fail on missing text.

- [ ] **Step 3: Add the capture contract to Phase 1**

In `plugins/autopilot/skills/autopilot/SKILL.md`, inside `## Phase 1 — brainstorm`, insert the following **between** the paragraph ending `not a separate approval step.` and the paragraph beginning `**The brainstorm's handoff ends Phase 1.**`. Insert it verbatim, including the fenced block:

````markdown
### Capture the clarifying questions

Every clarifying question the brainstorm asked marks context the pipeline
could not find on its own — in the task description, in the repo, in
`CLAUDE.md`, or in config. Capture the whole set **once, in a single batch, at
the handoff**, never one question at a time: the interactive phase stays as
fast as it is today, and the trade — a brainstorm interrupted before the
handoff records nothing — is deliberate.

Write the batch with a quoted heredoc, then capture it. Capture appends one
line per element to `.superpowers/autopilot/<run>/questions.jsonl` in the
**main checkout**, beside `run.md`:

```bash
cat > /tmp/autopilot-questions.json <<'JSON'
[
  {
    "seq": 1,
    "question": "<the clarifying question, as asked>",
    "answer": "<the answer your human partner gave>",
    "answer_source": "repo",
    "pattern": "<short canonical phrase>"
  }
]
JSON
node "$AP/scripts/autopilot-questions.mjs" capture \
  --run-dir=.superpowers/autopilot/<run> \
  --questions=@/tmp/autopilot-questions.json
```

`seq` is 1-based within the run and records the order asked. `answer_source`
names where the answer **should have lived** — not what the question was
about:

| Value | Meaning |
|---|---|
| `task` | The issue or task description could have stated it |
| `repo` | Discoverable by reading code, docs, or tests already present |
| `claude_md` | A project convention that belongs in `CLAUDE.md` |
| `config` | A key in `.claude/autopilot.json` |
| `judgment` | Genuine human preference; no artifact could have supplied it |

Record the `judgment` questions too. A recurring judgment question is never a
defect and is never proposed as something to fix, but without it the corpus
has no denominator: a run that asked two answerable questions would look
identical to one that asked two answerable and twenty judgment calls.

`pattern` is the clustering key and clustering is a pure lexical match, so
reuse the same short phrase verbatim across runs when the gap is the same
kind, and leave the specifics to `question` and `answer`. A phrase reworded
per question clusters with nothing.

Validation is all-or-nothing: on any bad element the script writes nothing and
exits non-zero, naming the offending index and field.

**Capture before appending `design approved`.** That entry is what a resume
matches to jump straight to `setup`, so a run that captured after it would
re-capture the same batch on every resume.

**A capture failure never parks.** Append
`questions capture failed — <reason>` and continue the run, the way a
`learnings` failure is logged and passed over. The run's product is the pull
request; a missing question log is a reporting defect.
````

- [ ] **Step 4: Add the second report to the findings command**

In `plugins/autopilot/commands/autopilot-findings.md`:

**4a.** In `## Run the report`, add the second invocation to the existing bash block and add the ordering paragraph after it, so the block and the text immediately following it read:

````markdown
```bash
AP="<the plugin root>"
THRESHOLD=$(node -e "import('$AP/scripts/autopilot-config.mjs').then(m=>console.log(m.loadConfig('.claude/autopilot.json').config.findings_threshold))")
node "$AP/scripts/autopilot-findings.mjs" report .superpowers/autopilot "$THRESHOLD"
node "$AP/scripts/autopilot-questions.mjs" report .superpowers/autopilot "$THRESHOLD"
```

Run them in that order and present them in that order: review-finding
candidates first, then the brainstorm-question summary and its
`## Missing-context candidates` section. Both reports read the same
`findings_threshold`; there is no separate key for questions.
````

Leave the existing paragraph that begins ``findings_threshold` comes from` as
it is, and leave `## Present the candidates` and `## Recording an approval`
unchanged.

**4b.** Append this section to the end of the file:

```markdown
## Present the missing-context candidates

The second report covers the clarifying questions Phase 1 had to ask. Each one
marks context the pipeline could not find on its own, so a recurring question
is a standing gap in the task descriptions, the repo, `CLAUDE.md`, or the
config.

Print its one-line summary exactly as it comes —
`Brainstorm questions: N across R runs — J judgment, A answerable` — then walk
the `## Missing-context candidates` entries one at a time. For each, state the
`answer_source`, the pattern, the count, and the full evidence: run, seq,
question, and answer per occurrence. The evidence is the point: a bare count
gives your human partner nothing to judge.

`judgment` questions are counted in the summary but never appear as
candidates. A recurring judgment call is genuine human preference, and it is
never proposed as something to fix — proposing it would push the pipeline
toward guessing at product decisions.

Ask the same three ways as above, one candidate at a time: **Approve**,
**Reject** with a one-line reason, or **Edit** and then approve the reworded
version.

Approved candidates append to the same `.superpowers/autopilot/rules.md` in
the **main checkout**, each recording its `answer_source`, its pattern, and a
one-line count of the evidence behind it. From a worktree-isolated session,
append with Bash (`>>`).

**Do not write any of this into a stage prompt.** As with the review findings,
an approved candidate is recorded for a human to act on later, never wired
into a prompt automatically. Nothing is written without an explicit yes.
```

- [ ] **Step 5: Run the contract test to verify it passes**

Run: `npx vitest run plugins/autopilot/scripts/autopilot-questions-contract.test.mjs`

Expected: PASS.

- [ ] **Step 6: Prove a contract assertion can fail**

Temporarily delete the `**A capture failure never parks.**` paragraph from `SKILL.md` and re-run the contract test.

Expected: FAIL on "says a capture failure never parks the run". Restore the paragraph and re-run to green.

- [ ] **Step 7: Run the full suite**

Run: `npm test`

Expected: PASS. Three existing files read the same two documents and must stay green: `autopilot-no-design-gate.test.mjs`, `autopilot-ledger-coupling.test.mjs`, and `autopilot-findings-contract.test.mjs`. Nothing in the new prose reintroduces an approval gate, renames the `design approved` entry, or removes an anchor those tests match on.

- [ ] **Step 8: Verify the brainstorm fork is untouched**

Run: `git status --porcelain plugins/autopilot/skills/autopilot-brainstorm/`

Expected: no output at all. Quote the actual (empty) output in your report rather than paraphrasing it. If any line appears, revert that file before committing.

- [ ] **Step 9: Commit**

```bash
git add plugins/autopilot/skills/autopilot/SKILL.md plugins/autopilot/commands/autopilot-findings.md plugins/autopilot/scripts/autopilot-questions-contract.test.mjs
git commit -m "feat(autopilot): document the Phase 1 question-capture contract and its report"
```

---

## Acceptance criteria coverage

| AC | Where |
|---|---|
| AC1, AC2, AC3 | Task 1 |
| AC4, AC5, AC6, AC7, AC8, AC9, AC15, AC16 | Task 2 |
| AC10 | Already true in the repo — `findings_threshold` exists in `autopilot.default.json`, is validated in `autopilot-config.mjs`, and is tested in `autopilot-config.test.mjs`. No task, and no new key. |
| AC11, AC13, AC14, AC18 | Task 3 |
| AC12 | Global constraint; asserted in Task 3's contract test and checked by Task 3 Step 8 |
| AC17 | Tasks 1 and 2, both in `autopilot-questions.test.mjs` |
| AC19 | Global constraint; no task adds a version assertion |

**Task count: 3.** Capture (a writer with all-or-nothing validation), report (six pure functions and a formatter over the same JSONL shape), and the prose contracts (two markdown files plus the test that pins them) are three diffs a reviewer can reject independently. Merging capture into report would put roughly 250 lines of new code and 30 assertions into one diff with no reviewability gained; merging the prose into either would mix an executable contract with the code it names.
