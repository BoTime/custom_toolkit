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
