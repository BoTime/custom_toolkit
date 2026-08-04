import { appendFileSync, readFileSync } from "node:fs";

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

export function nextStage(ledger) {
  const has = (prefix) => ledger.entries.some((e) => e.text.startsWith(prefix));

  // Check if the last entry is a PARKED line (currently parked, not historical)
  if (ledger.entries.length > 0) {
    const lastEntry = ledger.entries[ledger.entries.length - 1];
    if (lastEntry.text.startsWith("PARKED")) return "parked";
  }

  if (has("pr:")) return "done";
  if (has("rebase clean")) return "pr";
  if (has("sdd complete")) return "land";
  if (has("plan complete")) return "sdd";
  if (has("spec committed")) return "plan";
  if (has("worktree:")) return "spec";
  if (has("design approved")) return "setup";
  return "phase1";
}

export function durations(ledger) {
  const out = [];
  for (let i = 1; i < ledger.entries.length; i++) {
    const prev = ledger.entries[i - 1];
    const cur = ledger.entries[i];
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
 * Returns null for a ledger with no entries, 0 for a single entry.
 */
export function totalDuration(ledger) {
  if (ledger.entries.length === 0) return null;
  const first = ledger.entries[0];
  const last = ledger.entries[ledger.entries.length - 1];
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

export function append(path, text, now = () => new Date().toISOString().replace(/\.\d{3}Z$/, "Z")) {
  appendFileSync(path, `${formatLine(now(), text)}\n`, "utf8");
}

export function read(path) {
  return parseLedger(readFileSync(path, "utf8"));
}
