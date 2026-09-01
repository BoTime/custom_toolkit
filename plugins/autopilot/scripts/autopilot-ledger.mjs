import { appendFileSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const HEADER = /^#\s*autopilot run\s*—\s*task:\s*(.+)$/;

export function formatLine(timestamp, text) {
  return `${timestamp}  ${text}`;
}

export function parseLedger(contents) {
  const lines = contents.split("\n").filter((l) => l.trim() !== "");
  let task = null;
  const entries = [];

  for (const line of lines) {
    const header = line.match(HEADER);
    if (header) {
      task = header[1].trim();
      continue;
    }
    const match = line.match(/^(\S+)\s\s(.*)$/);
    if (match) entries.push({ timestamp: match[1], text: match[2] });
  }
  return { task, entries };
}

/**
 * Entries that record something about the run without advancing it.
 *
 * `nextStage` detects a park by reading the LAST entry, so an informational
 * line appended after a `PARKED` line would unpark the run — a parked branch
 * would silently resume into the stage that parked it. Anything appended
 * purely for the record belongs here, `session:` measurements included.
 */
const INFORMATIONAL = /^(tier(:| escalated:)|session:)/;

/**
 * `session:` entries record how large a session had grown when it finished a
 * stage. They are bookkeeping for the handoff cap, not pipeline progress, so
 * every consumer below skips them: `nextStage` must not see them at all, and
 * the timing table must not attribute a stage's duration to one.
 */
export const SESSION_PREFIX = "session:";

const isSessionEntry = (entry) => entry.text.startsWith(SESSION_PREFIX);

/** The run's `session:` measurements, oldest first. */
export function sessionEntries(ledger) {
  return ledger.entries.filter(isSessionEntry);
}

export function nextStage(ledger) {
  // Session lines interleave with stage lines, so every check here reads the
  // pipeline entries only. This matters most for the park check below: a
  // `session:` line appended after a PARKED line would otherwise make the run
  // look unparked, and `/autopilot resume` would drive it straight past the
  // decision its human partner was asked to make.
  const entries = ledger.entries.filter((e) => !isSessionEntry(e));
  const has = (prefix) => entries.some((e) => e.text.startsWith(prefix));

  // Check if the last stage-advancing entry is a PARKED line (currently
  // parked, not historical). Informational entries — `tier` lines and
  // `session` measurements alike — are skipped: they may legitimately land
  // after a park, and treating one as the last entry would silently resume a
  // run past the decision its human partner was asked to make.
  const advancing = ledger.entries.filter((e) => !INFORMATIONAL.test(e.text));
  if (advancing.length > 0) {
    const lastEntry = advancing[advancing.length - 1];
    if (lastEntry.text.startsWith("PARKED")) return "parked";
  }

  if (has("pr:")) return "done";
  if (has("rebase clean")) return "pr";
  if (has("learnings committed")) return "land";
  // `verify` covers both outcomes that let the run continue — a pass and a
  // documented skip — because a skipped stage that appends nothing would send
  // every resume back through verify forever.
  if (has("verify")) return "learnings";
  if (has("sdd complete")) return "verify";
  if (has("plan complete")) return "sdd";
  if (has("spec committed")) return "plan";
  if (has("worktree:")) return "spec";
  if (has("design approved")) return "setup";
  return "phase1";
}

/** The run's pipeline entries — everything except `session:` bookkeeping. */
export function pipelineEntries(ledger) {
  return ledger.entries.filter((e) => !isSessionEntry(e));
}

export function durations(ledger) {
  const entries = pipelineEntries(ledger);
  const out = [];
  for (let i = 1; i < entries.length; i++) {
    const prev = entries[i - 1];
    const cur = entries[i];
    const seconds =
      (Date.parse(cur.timestamp) - Date.parse(prev.timestamp)) / 1000;
    out.push({ from: prev.text, to: cur.text, seconds });
  }
  return out;
}

/** Wall-clock seconds from the run's first ledger entry to its last.
 *
 * Measures the span the ledger actually witnessed. That starts at the
 * `started (phase 1)` append, so time spent in preflight — before the branch
 * name is known and the ledger exists — is not counted.
 *
 * `session:` entries are excluded, so a run's reported duration is the same
 * whether or not it happened to hand off partway through.
 *
 * Returns null for a ledger with no pipeline entries, 0 for a single entry.
 */
export function totalDuration(ledger) {
  const entries = pipelineEntries(ledger);
  if (entries.length === 0) return null;
  const first = entries[0];
  const last = entries[entries.length - 1];
  return (Date.parse(last.timestamp) - Date.parse(first.timestamp)) / 1000;
}

/** Render a second count for humans: "2h 17m", "30m", "45s". */
export function formatDuration(seconds) {
  if (seconds === null || seconds === undefined) return null;
  const total = Math.round(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m`;
  return `${total}s`;
}

/** Render the run's timing as a markdown block for a PR description.
 *
 * The total is the headline; the table attributes it to stages, each row
 * naming the entry the stage *ended* with. Returns null for a ledger with no
 * entries — there is nothing to report and nothing should be appended.
 */
export function formatTimingSection(ledger) {
  const total = totalDuration(ledger);
  if (total === null) return null;

  const lines = [
    "## Autopilot timing",
    "",
    `Total run duration: **${formatDuration(total)}** (excludes preflight — the ledger starts at \`started (phase 1)\`).`,
  ];

  const stages = durations(ledger);
  if (stages.length > 0) {
    lines.push("", "| Stage | Duration |", "| --- | --- |");
    for (const stage of stages) {
      // A literal pipe in stage text would end the cell early.
      const label = stage.to.replaceAll("|", "\\|");
      lines.push(`| ${label} | ${formatDuration(stage.seconds)} |`);
    }
  }
  return lines.join("\n");
}

export function append(path, text, now = () => new Date().toISOString().replace(/\.\d{3}Z$/, "Z")) {
  appendFileSync(path, `${formatLine(now(), text)}\n`, "utf8");
}

export function read(path) {
  return parseLedger(readFileSync(path, "utf8"));
}

/** `timing <ledger-path>` prints the PR timing section; `duration` the total. */
export function main(argv = process.argv.slice(2)) {
  const [command, path] = argv;
  if (!path) {
    console.error("usage: autopilot-ledger.mjs <timing|duration> <ledger-path>");
    process.exitCode = 1;
    return;
  }
  const ledger = read(path);
  const out =
    command === "duration"
      ? formatDuration(totalDuration(ledger))
      : formatTimingSection(ledger);
  if (out === null) {
    console.error("ledger has no entries");
    process.exitCode = 1;
    return;
  }
  console.log(out);
}

// pathToFileURL rather than a `file://` template: the plugin's install path is
// user-controlled and a space in it would silently skip main().
if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
