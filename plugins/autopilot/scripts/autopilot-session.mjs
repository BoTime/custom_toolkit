import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { loadConfig } from "./autopilot-config.mjs";
import { append, read as readLedger, sessionEntries } from "./autopilot-ledger.mjs";

/**
 * Session length is the dominant term in a run's cache-read bill.
 *
 * Every turn re-reads the whole context, so a session's cost is roughly
 * turns x average context — quadratic in its own length. Measured across the
 * samba corpus (730 agents, 24k turns), one turn in a 400+ turn session costs
 * 4.0x the same turn in a session under 50, and 58% of all cache-read spend
 * sits in the 4% of agents that ran past 150 turns.
 *
 * The fix is to stop running long sessions, not to trim what they hold:
 * shrinking the fixed floor every agent starts at by 25% saves 7.5%, while
 * capping sessions at 100 turns and resuming saves 30%.
 *
 * That only holds if the successor starts nearly clean. The saving is entirely
 * a function of how much context crosses the boundary:
 *
 *     carry   8k    20k    40k    60k
 *     100t   30%    21%     6%    -9%
 *
 * At a 40k carry a cap is close to free; past that it costs more than it
 * saves, because each handoff pays a fresh floor for nothing. Autopilot's
 * carry is `run.md` — a dozen timestamped lines — so a resumed run lands in
 * the 8k column, provided the resumed session reads the ledger and the paths
 * it names and nothing else. A successor that re-reads the spec, the plan and
 * the diff to "get oriented" has rebuilt the context it was meant to shed.
 */
export const DEFAULT_CAPS = { max_turns: 120, max_context_tokens: 150000 };

/** `session:` entries a run appends at stage boundaries. */
const SESSION_ENTRY =
  /^session:\s*(\S+)\s+—\s+(\d+)\s+turns,\s+(\d+)\s+ctx$/;

/**
 * Count assistant turns and read the latest context size from a transcript.
 *
 * A turn spans several JSONL records — thinking, text and each tool_use are
 * written separately — that share one message id and repeat the same `usage`.
 * Counting records instead of ids inflates the turn count roughly threefold,
 * so ids are deduplicated here.
 *
 * `ctx` is the last turn's total billed input (raw + cache read + cache
 * write), which is the size the next turn will re-read. It is deliberately the
 * latest value rather than the peak: the question this answers is "how much
 * will continuing cost", not "how large did this ever get".
 */
export function measure(contents) {
  const seen = new Set();
  let turns = 0;
  let ctx = 0;

  for (const line of contents.split("\n")) {
    // Cheap reject before JSON.parse: transcripts run to thousands of records
    // and only assistant turns carry usage.
    if (!line.includes('"usage"')) continue;

    let record;
    try {
      record = JSON.parse(line);
    } catch {
      continue; // a torn final line while the session is still writing
    }
    if (record.type !== "assistant") continue;

    const usage = record.message?.usage;
    const id = record.message?.id;
    if (!usage || id === undefined || seen.has(id)) continue;

    seen.add(id);
    turns += 1;
    ctx =
      (usage.input_tokens ?? 0) +
      (usage.cache_read_input_tokens ?? 0) +
      (usage.cache_creation_input_tokens ?? 0);
  }
  return { turns, ctx };
}

/**
 * Find a session's own transcript.
 *
 * Transcripts live at `~/.claude/projects/<slugified-cwd>/<session-id>.jsonl`,
 * and the slug changes when a session relocates into a worktree — which every
 * autopilot run does at `setup`. Scanning every project directory for the id
 * avoids having to reproduce the slugging rules, and the id is unique, so the
 * first hit is the right one.
 */
export function findTranscript(sessionId, projectsRoot, fs = { readdirSync, statSync }) {
  if (!sessionId) return null;
  let dirs;
  try {
    dirs = fs.readdirSync(projectsRoot);
  } catch {
    return null;
  }
  for (const dir of dirs) {
    const candidate = join(projectsRoot, dir, `${sessionId}.jsonl`);
    try {
      fs.statSync(candidate);
      return candidate;
    } catch {
      // not this project directory
    }
  }
  return null;
}

/** Names the caps a measurement is over. Empty means it may keep running. */
export function exceeded({ turns, ctx }, caps = DEFAULT_CAPS) {
  const over = [];
  if (caps.max_turns !== undefined && turns > caps.max_turns) {
    over.push(`turns ${turns} > ${caps.max_turns}`);
  }
  if (caps.max_context_tokens !== undefined && ctx > caps.max_context_tokens) {
    over.push(`ctx ${ctx} > ${caps.max_context_tokens}`);
  }
  return over;
}

/** The ledger text recording one session's size at a stage boundary. */
export function formatSessionEntry(stage, { turns, ctx }) {
  return `session: ${stage} — ${turns} turns, ${ctx} ctx`;
}

/** Reverse of `formatSessionEntry`; null for anything else. */
export function parseSessionEntry(text) {
  const match = text.match(SESSION_ENTRY);
  if (!match) return null;
  return { stage: match[1], turns: Number(match[2]), ctx: Number(match[3]) };
}

/**
 * Every recorded session that finished a stage over cap.
 *
 * This is the enforcement half. The cap itself is cooperative — nothing in the
 * harness stops a session at N turns, so the controller has to yield on its
 * own — which is exactly how the prose rule it replaces failed. Recording the
 * measurement at each boundary makes the yielding checkable after the fact:
 * a run that never handed off leaves the evidence in its own ledger.
 */
export function checkSessions(ledger, caps = DEFAULT_CAPS) {
  const violations = [];
  for (const entry of sessionEntries(ledger)) {
    const parsed = parseSessionEntry(entry.text);
    if (!parsed) continue;
    const over = exceeded(parsed, caps);
    if (over.length > 0) {
      violations.push({ ...parsed, timestamp: entry.timestamp, over });
    }
  }
  return violations;
}

/** Read the `session` block from merged config, falling back to the defaults. */
export function capsFrom(config) {
  return { ...DEFAULT_CAPS, ...(config?.session ?? {}) };
}

/**
 * What crossing the cap means for the controller.
 *
 * `handoff` (the default) is the cost lever described above: stop at the
 * stage boundary and let a fresh session resume. `continue` records the
 * measurement but never asks the controller to stop — for runs where nobody
 * is at the terminal to type `/autopilot resume`, where a handoff is not a
 * saving but a stall until a human returns. The measurement is still written
 * to the ledger either way, so `check` can still show how large the sessions
 * got; under `continue` it reports rather than fails.
 *
 * Note that the measurement is the *whole* session, Phase 1 included. A long
 * interactive brainstorm — mockups, screenshots, a visual companion — can put
 * a session over the context cap before Phase 2 has done any work at all, and
 * under `handoff` that stops the run after its first automated stage.
 */
export function onCapPolicy(caps) {
  return caps?.on_cap === "continue" ? "continue" : "handoff";
}

function flag(argv, name, fallback) {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit === undefined ? fallback : hit.slice(name.length + 3);
}

/**
 * `measure` prints this session's size; `record <ledger> <stage>` also appends
 * it and reports whether to hand off; `check <ledger>` is the post-run gate.
 *
 * `measure` and `record` exit 0 whether or not the session is over cap — being
 * over is a routine instruction to resume, not a failure. Only `check` exits
 * non-zero, because by then the handoff that should have happened did not.
 */
export function main(argv = process.argv.slice(2), env = process.env, deps = {}) {
  const {
    readFile = (p) => readFileSync(p, "utf8"),
    load = loadConfig,
    appendLedger = append,
    readLedgerAt = readLedger,
    find = findTranscript,
    log = console.log,
    logError = console.error,
  } = deps;

  const [command, ...rest] = argv;
  const configPath = flag(argv, "config", ".claude/autopilot.json");

  let caps = DEFAULT_CAPS;
  try {
    caps = capsFrom(load(configPath, env).config);
  } catch (error) {
    // A malformed project config must not stop a run from measuring itself;
    // the caps are advisory and the defaults are sane. The stages that
    // genuinely need config already fail loudly on their own.
    logError(`autopilot-session: using default caps (${error.message})`);
  }

  if (command === "check") {
    const path = rest.find((a) => !a.startsWith("--"));
    if (!path) {
      logError("usage: autopilot-session.mjs check <ledger-path>");
      return 1;
    }
    const violations = checkSessions(readLedgerAt(path), caps);
    if (violations.length === 0) {
      log("every recorded session stayed under cap");
      return 0;
    }
    if (onCapPolicy(caps) === "continue") {
      // The project chose to keep running over cap; the sizes are information
      // for the developer, not a missed handoff.
      for (const v of violations) {
        log(`over cap at ${v.stage} (continued by session.on_cap): ${v.over.join(", ")}`);
      }
      return 0;
    }
    for (const v of violations) {
      logError(`over cap at ${v.stage}: ${v.over.join(", ")}`);
    }
    return 1;
  }

  if (command !== "measure" && command !== "record") {
    logError("usage: autopilot-session.mjs <measure|record|check> [args]");
    return 1;
  }

  const sessionId = env.CLAUDE_CODE_SESSION_ID;
  const projectsRoot = join(env.HOME ?? "", ".claude", "projects");
  const transcript = find(sessionId, projectsRoot);
  if (!transcript) {
    logError(
      sessionId
        ? `no transcript found for session ${sessionId}`
        : "CLAUDE_CODE_SESSION_ID is not set",
    );
    return 2;
  }

  const measurement = measure(readFile(transcript));
  const over = exceeded(measurement, caps);
  const handoff = over.length > 0 && onCapPolicy(caps) === "handoff";
  const result = { ...measurement, handoff, over };

  if (command === "record") {
    const [path, stage] = rest.filter((a) => !a.startsWith("--"));
    if (!path || !stage) {
      logError("usage: autopilot-session.mjs record <ledger-path> <stage>");
      return 1;
    }
    appendLedger(path, formatSessionEntry(stage, measurement));
  }

  log(JSON.stringify(result));
  return 0;
}

// pathToFileURL rather than a `file://` template: the plugin's install path is
// user-controlled and a space in it would silently skip main().
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main();
}
