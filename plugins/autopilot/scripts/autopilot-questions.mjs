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
