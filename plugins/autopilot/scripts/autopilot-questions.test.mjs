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
  parseQuestions,
  collectQuestionCorpus,
  clusterQuestions,
  summarize,
  candidates,
  formatQuestionSection,
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
