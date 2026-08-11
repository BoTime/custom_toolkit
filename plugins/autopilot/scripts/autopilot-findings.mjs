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
