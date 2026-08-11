/**
 * The findings corpus: one JSON object per line, appended by SDD's review roles
 * to `.superpowers/autopilot/<run>/findings.jsonl` in the main checkout.
 *
 * Every function here is pure over strings and arrays. File reading lives in
 * the CLI at the bottom, so the logic is testable without a fixture tree.
 */

import { readFileSync, readdirSync } from "node:fs";
import { pathToFileURL } from "node:url";

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
      const key = `${f.stage_at_fault}\x00${f.pattern}`;
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
