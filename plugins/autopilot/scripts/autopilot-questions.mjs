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

import { appendFileSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

// The threshold flag is parsed exactly as the findings report parses it —
// taking `--threshold=2` positionally makes Number() yield NaN, and
// `count >= NaN` is false for every cluster, so the report silently prints
// "no candidates" for a corpus that has them.
import { splitThresholdFlag } from "./autopilot-findings.mjs";

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

/** `capture` appends a batch; `report` prints the candidate section. */
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
}

// pathToFileURL rather than a `file://` template: the plugin's install path is
// user-controlled and a space in it would silently skip main().
if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
