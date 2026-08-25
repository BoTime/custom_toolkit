import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync, existsSync, symlinkSync, appendFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve as resolvePath } from "node:path";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { loadConfig } from "./autopilot-config.mjs";

/**
 * Exit codes, because the verify stage branches on them and "non-zero" is not
 * enough: a failed criterion earns a fix round, a dead dev server does not,
 * and a repo with no `(ui)` criteria is not failing at all.
 *
 * There is nothing to configure any more, so there is no "half-configured"
 * state. `cannot_verify` is where a missing recipe and a missing
 * `@playwright/test` land: the spec asked for browser verification and this
 * stage could not deliver it, which must never report as success.
 */
export const EXIT = {
  pass: 0,
  criteria_failed: 1,
  infrastructure: 2,
  skipped: 3,
  cannot_verify: 4,
};

const HEADING = /^##\s+Acceptance criteria\s*$/im;

/**
 * Pull the acceptance criteria out of a committed spec.
 *
 * The spec is the single source: `/autopilot-github` seeds it from the issue
 * body and a plain `/autopilot` from the brainstorm, so by the time verify
 * runs there is exactly one list to read. Each item looks like:
 *
 *   - AC1 (ui) — a signed-out visitor clicking "Save" sees the login prompt
 *
 * The `(ui)` / `(non-ui)` tag is what gates the whole stage, so an untagged
 * item is an error rather than a default: silently treating it as non-ui
 * would drop a criterion from verification and still report success.
 */
export function parseCriteria(markdown) {
  const heading = HEADING.exec(markdown);
  if (!heading) {
    return { ok: false, criteria: [], reason: "spec has no `## Acceptance criteria` section" };
  }

  const rest = markdown.slice(heading.index + heading[0].length);
  const end = /^#{1,2}\s+/m.exec(rest);
  const body = end ? rest.slice(0, end.index) : rest;

  const criteria = [];
  const untagged = [];
  for (const line of body.split("\n")) {
    const item = /^\s*[-*]\s+(.*\S)\s*$/.exec(line);
    if (!item) continue;
    const text = item[1];
    const tagged = /^(AC\d+)\s*\((ui|non-ui)\)\s*[—:-]\s*(.+)$/i.exec(text);
    if (!tagged) {
      untagged.push(text);
      continue;
    }
    criteria.push({
      id: tagged[1].toUpperCase(),
      kind: tagged[2].toLowerCase(),
      text: tagged[3].trim(),
    });
  }

  if (untagged.length > 0) {
    return {
      ok: false,
      criteria,
      reason: `acceptance criteria missing a (ui)/(non-ui) tag: ${untagged.join("; ")}`,
    };
  }
  if (criteria.length === 0) {
    return { ok: false, criteria, reason: "`## Acceptance criteria` section is empty" };
  }
  return { ok: true, criteria, reason: null };
}

export const uiCriteria = (criteria) => criteria.filter((c) => c.kind === "ui");

/**
 * Flatten Playwright's JSON report into a verdict.
 *
 * Only the outcome and the first error message per failing test are kept.
 * The full report stays on disk: the verify agent is under a contract not to
 * read it, and this is what makes that contract followable.
 */
export function summarize(report) {
  const results = [];
  const walk = (suite) => {
    for (const spec of suite.specs ?? []) {
      const failed = (spec.tests ?? []).some((t) => t.status !== "expected");
      const message = (spec.tests ?? [])
        .flatMap((t) => t.results ?? [])
        .map((r) => r.error?.message)
        .find(Boolean);
      results.push({
        title: spec.title,
        ok: !failed,
        message: failed ? (message ?? "failed with no error message").split("\n")[0] : null,
      });
    }
    for (const child of suite.suites ?? []) walk(child);
  };
  for (const suite of report.suites ?? []) walk(suite);

  const failures = results.filter((r) => !r.ok);
  return {
    total: results.length,
    passed: results.length - failures.length,
    failed: failures.length,
    results,
    failures,
  };
}

/**
 * Match each UI criterion to the spec titled for it.
 *
 * Titles are expected to start with the criterion id, which is why the verify
 * contract tells the agent to name them that way. A criterion with no matching
 * test counts as unverified, not as passing — the gap this whole stage exists
 * to close.
 */
export function attribute(criteria, summary) {
  return uiCriteria(criteria).map((c) => {
    const match = summary.results.find((r) => r.title.toUpperCase().startsWith(c.id));
    if (!match) return { ...c, status: "missing", message: "no test covered this criterion" };
    return { ...c, status: match.ok ? "pass" : "fail", message: match.message };
  });
}

/** The PR body section. Kept text-only: artifacts stay local to the run. */
export function formatVerifySection(rows, { artifactsDir, skipped } = {}) {
  const lines = ["## Browser verification", ""];
  if (skipped) {
    lines.push(`Skipped — ${skipped}.`);
    return lines.join("\n");
  }

  lines.push("| Criterion | Result |", "| --- | --- |");
  const mark = { pass: "✅", fail: "❌", missing: "⚠️ not covered" };
  for (const row of rows) {
    const label = `${row.id} — ${row.text}`.replaceAll("|", "\\|");
    const detail = row.status === "pass" ? "" : ` ${(row.message ?? "").replaceAll("|", "\\|")}`;
    lines.push(`| ${label} | ${mark[row.status]}${detail} |`);
  }

  const passed = rows.filter((r) => r.status === "pass").length;
  lines.push("", `${passed}/${rows.length} UI criteria verified · Chromium`);
  if (artifactsDir) lines.push(`Artifacts (local to the run): \`${artifactsDir}\``);
  return lines.join("\n");
}

/** Poll until the dev server answers or the budget runs out. */
export async function waitForServer(
  url,
  { timeoutMs = 120000, intervalMs = 500 } = {},
  probe = (u) => fetch(u, { redirect: "manual" }).then(() => true, () => false),
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  now = () => Date.now(),
) {
  const deadline = now() + timeoutMs;
  for (;;) {
    if (await probe(url)) return { ready: true };
    if (now() >= deadline) return { ready: false };
    await sleep(intervalMs);
  }
}

/**
 * The Playwright config is generated, never authored.
 *
 * Two reasons. The reporter and artifact settings are what the verify agent's
 * token contract depends on — a hand-written config could quietly drop the
 * JSON reporter and force the agent to read raw output instead. And it is pure
 * boilerplate, so generating it leaves the agent writing only spec files.
 *
 * `.cjs` because the run directory has no package.json of its own and the
 * project's `type` field must not decide how this parses.
 */
export function playwrightConfig({ baseURL, specDir, artifactsDir }) {
  return `// Generated by autopilot-verify.mjs — do not edit; regenerated each run.
module.exports = {
  testDir: ${JSON.stringify(specDir)},
  outputDir: ${JSON.stringify(join(artifactsDir, "test-results"))},
  timeout: 30000,
  fullyParallel: false,
  workers: 1,
  forbidOnly: true,
  retries: 0,
  reporter: [["line"], ["json", { outputFile: ${JSON.stringify(join(artifactsDir, "results.json"))} }]],
  use: {
    baseURL: ${JSON.stringify(baseURL)},
    headless: true,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    video: "off",
  },
};
`;
}

/**
 * Make the project's dependencies reachable from spec files that live outside
 * it.
 *
 * Specs are written to the run directory precisely so they never enter the
 * repository, but Node resolves `@playwright/test` by walking up from the
 * importing file — which from the run directory never reaches the project's
 * `node_modules`. A symlink at the run directory's own `node_modules` puts the
 * project's tree exactly one level above the specs, where the walk finds it.
 *
 * Found by running the stage end to end: without this every spec fails to
 * import, Playwright reports "No tests found", and the run reads as a feature
 * whose criteria were simply never covered.
 */
function linkModules(runDir, cwd) {
  const link = join(runDir, "node_modules");
  const target = join(cwd, "node_modules");
  if (existsSync(link) || !existsSync(target)) return;
  try {
    symlinkSync(target, link, "junction");
  } catch {
    // Non-fatal: the resolve check below is what actually reports the problem.
  }
}

/** Whether the project can supply the test runner. Never installs it. */
export function playwrightResolvable(cwd, req = createRequire) {
  try {
    req(join(resolvePath(cwd), "package.json")).resolve("@playwright/test");
    return true;
  } catch {
    return false;
  }
}

function run(command, cwd) {
  const r = spawnSync(command, { cwd, shell: true, encoding: "utf8", stdio: "pipe" });
  return { code: r.status ?? 1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

/** The recipe keys without which nothing can be started or reached. */
export const RECIPE_KEYS = ["dev_command", "base_url_command"];

/**
 * Read the per-run recipe the `plan` stage derived.
 *
 * Derived rather than configured, and rederived every run: a committed recipe
 * is a second copy of the project's dev setup that drifts silently the moment
 * someone changes a port or renames a script, because nothing runs it except
 * autopilot.
 */
export function loadRecipe(runDir, readFile = (p) => readFileSync(p, "utf8")) {
  const path = join(runDir, "recipe.json");
  let raw;
  try {
    raw = readFile(path);
  } catch {
    return {
      ok: false,
      reason:
        `no verify recipe at ${path} — the plan stage derives it from the ` +
        "project's own dev setup, so a run that reached here without one " +
        "cannot open a browser",
    };
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, reason: `${path} is not valid JSON` };
  }
  const missing = RECIPE_KEYS.filter((key) => !parsed?.[key]);
  if (missing.length > 0) {
    return { ok: false, reason: `${path} is missing ${missing.join(", ")}` };
  }
  return { ok: true, recipe: parsed };
}

/**
 * Resolve the base URL by running the recipe's command in the worktree.
 *
 * The URL is never written down. A worktree-up script derives its ports from
 * the worktree name and reassigns them when a block is occupied, so a static
 * base_url is not merely inconvenient — it is wrong on the second concurrent
 * run.
 *
 * Polling, rather than one shot, is what lets the command run "after
 * dev_command" for both shapes of dev command: a setup script that assigns
 * ports and exits, and a blocking server that never exits at all.
 */
export async function resolveBaseUrl(command, cwd, {
  timeoutMs = 120000,
  intervalMs = 500,
  devExitCode = () => null,
  runCommand = run,
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  now = () => Date.now(),
} = {}) {
  const deadline = now() + timeoutMs;
  for (;;) {
    // A zero exit means setup finished, not that the server died — only a
    // non-zero exit is a failure. Whether the server is actually up is
    // waitForServer's question, not this one's.
    const exited = devExitCode();
    if (exited !== null && exited !== 0) {
      return { ok: false, reason: `dev command exited ${exited} before a base url could be resolved` };
    }
    const attempt = runCommand(command, cwd);
    const url = (attempt.stdout ?? "").trim();
    if (attempt.code === 0 && url) return { ok: true, url };
    if (now() >= deadline) {
      const why = (attempt.stderr ?? "").trim() || "empty stdout";
      return { ok: false, reason: `base_url_command produced no url within ${timeoutMs}ms: ${why}` };
    }
    await sleep(intervalMs);
  }
}

/**
 * Start the dev command in its own process group so the whole tree can be
 * signalled at once, and remember how it exited.
 *
 * The exit code matters only when it is non-zero: the common project script
 * starts containers, backgrounds its app processes, prints a summary and
 * returns 0, which the old rule read as a crash on a perfectly healthy stack.
 */
export function startDevCommand(command, cwd, spawnFn = spawn) {
  const child = spawnFn(command, { cwd, shell: true, detached: true, stdio: "ignore" });
  const state = { code: null };
  child.on?.("exit", (code, signal) => { state.code = code ?? (signal ? 1 : 0); });
  child.unref?.();
  return { child, exitCode: () => state.code };
}

function killGroup(child) {
  if (!child?.pid) return;
  for (const signal of ["SIGTERM", "SIGKILL"]) {
    try {
      process.kill(-child.pid, signal);
    } catch {
      return; // already gone
    }
    if (signal === "SIGTERM") spawnSync("sleep", ["1"]);
  }
}

/**
 * Tear the stack down, preferring the recipe's own stop command.
 *
 * The process-group kill is the fallback for the blocking-server case, where
 * it remains correct. It is useless for a setup script: the child autopilot
 * holds has already exited, so signalling it leaves every container running
 * long after the run.
 */
export function teardown({ child, stopCommand, cwd }, runCommand = run, kill = killGroup) {
  if (stopCommand) {
    runCommand(stopCommand, cwd);
    return "stop_command";
  }
  kill(child);
  return "process-group";
}

/**
 * One finding line per unmet criterion, under the existing seven-field
 * contract — this stage is a second producer for it, not a new schema.
 *
 * `task: 0` is the sentinel for "not a task": verify is not a numbered SDD
 * task, but the field is required and a nullable variant would fork the
 * contract for one producer. `stage_at_fault` stays inside the existing four
 * values: it names the stage that produced the bad input, never the stage
 * that surfaced it.
 */
export function findingsLines(rows, { round = 1 } = {}) {
  const unmet = rows.filter((r) => r.status !== "pass");
  if (unmet.length === 0) return [{ task: 0, clean: true }];
  return unmet.map((row) => ({
    task: 0,
    round,
    severity: "major",
    stage_at_fault: "implementation",
    pattern: row.status === "missing"
      ? "ui criterion had no browser test"
      : "ui criterion failed in browser",
    detail: `${row.id}: ${row.text} — ${row.message ?? "no detail"}`,
    verdict: "CONFIRMED",
  }));
}

/** Append to the run's corpus, which sits one level above the verify dir. */
export function appendFindings(runDir, lines, append = appendFileSync) {
  const path = join(runDir, "..", "findings.jsonl");
  append(path, lines.map((line) => `${JSON.stringify(line)}\n`).join(""), "utf8");
  return path;
}

/**
 * `round` is what keeps a fix round's findings from double-counting. The
 * pattern strings this stage emits are drawn from a fixed pair, so a criterion
 * still red after the fix round would otherwise write a second line identical
 * to the first — and `clusterFindings` would read one twice-failing criterion
 * as two occurrences of the same cluster.
 */
export async function verify({ configPath, runDir, cwd, specPath, round = 1 }) {
  const { config } = loadConfig(configPath);
  const readyTimeoutMs = config.browser?.ready_timeout_ms ?? 120000;

  // Writing a `(ui)` acceptance criterion is what turns this stage on. There
  // is no flag and nothing to configure, so the spec is the only gate.
  const parsed = specPath
    ? parseCriteria(readFileSync(specPath, "utf8"))
    : { ok: false, criteria: [], reason: "no spec path was given" };
  if (!parsed.ok) return { code: EXIT.cannot_verify, message: parsed.reason };

  const ui = uiCriteria(parsed.criteria);
  if (ui.length === 0) {
    return { code: EXIT.skipped, message: "no (ui) acceptance criteria in the spec" };
  }

  const loaded = loadRecipe(runDir);
  if (!loaded.ok) return { code: EXIT.cannot_verify, message: loaded.reason };

  if (!playwrightResolvable(cwd)) {
    return {
      code: EXIT.cannot_verify,
      message:
        "@playwright/test is not resolvable from the project — add it as a " +
        "devDependency and install browsers with `npx playwright install " +
        "chromium`. Autopilot never installs it for you: a background install " +
        "on an unattended run is a surprise the developer did not approve.",
    };
  }

  const { dev_command, base_url_command, stop_command, seed_command } = loaded.recipe;
  const specDir = join(runDir, "specs");
  const artifactsDir = join(runDir, "artifacts");
  mkdirSync(specDir, { recursive: true });
  mkdirSync(artifactsDir, { recursive: true });
  linkModules(runDir, cwd);

  let started;
  try {
    started = startDevCommand(dev_command, cwd);

    const resolved = await resolveBaseUrl(base_url_command, cwd, {
      timeoutMs: readyTimeoutMs,
      devExitCode: started.exitCode,
    });
    if (!resolved.ok) return { code: EXIT.infrastructure, message: resolved.reason };

    const { ready } = await waitForServer(resolved.url, { timeoutMs: readyTimeoutMs });
    if (!ready) {
      return {
        code: EXIT.infrastructure,
        message: `dev server did not answer ${resolved.url} within ${readyTimeoutMs}ms`,
      };
    }

    // Seeding waits until the server answers. The canonical recipe's
    // `dev_command` brings up a docker stack, so a seed run before it would
    // talk to a database whose container has not started — parking a healthy
    // branch on an infrastructure exit. Inside the `try`, a seed that fails
    // now also gets the `finally`'s teardown, which it needs: something is
    // running by this point.
    if (seed_command) {
      const seeded = run(seed_command, cwd);
      if (seeded.code !== 0) {
        return { code: EXIT.infrastructure, message: `seed command failed: ${seeded.stderr.trim()}` };
      }
    }

    const configFile = join(runDir, "playwright.config.cjs");
    writeFileSync(
      configFile,
      playwrightConfig({ baseURL: resolved.url, specDir, artifactsDir }),
      "utf8",
    );

    const tests = run(`npx playwright test --config ${JSON.stringify(configFile)}`, cwd);
    const resultsPath = join(artifactsDir, "results.json");
    if (!existsSync(resultsPath)) {
      return {
        code: EXIT.infrastructure,
        message: `playwright produced no report: ${(tests.stderr || tests.stdout).trim().split("\n").slice(-5).join("\n")}`,
      };
    }
    const summary = summarize(JSON.parse(readFileSync(resultsPath, "utf8")));

    // Playwright exits non-zero and still writes a report when it collects
    // nothing — a spec that failed to import looks identical to a feature
    // nobody tested. Treat it as infrastructure so it parks instead of
    // sending an implementer to fix code that was never exercised.
    if (summary.total === 0) {
      return {
        code: EXIT.infrastructure,
        message: `playwright collected no tests from ${specDir}: ${
          (tests.stderr || tests.stdout).trim().split("\n").slice(-5).join(" ")
        }`,
      };
    }

    const rows = attribute(parsed.criteria, summary);
    writeFileSync(join(runDir, "pr-section.md"), formatVerifySection(rows, { artifactsDir }), "utf8");
    appendFindings(runDir, findingsLines(rows, { round }));

    // A criterion with no test is a gap in this stage, not a pass, so it is
    // failure-weighted alongside a red assertion.
    const unmet = rows.filter((r) => r.status !== "pass");
    return {
      code: unmet.length > 0 ? EXIT.criteria_failed : EXIT.pass,
      message:
        `${rows.length - unmet.length}/${rows.length} ui criteria passed ` +
        `(${summary.passed}/${summary.total} tests)` +
        (unmet.length > 0 ? `; unmet: ${unmet.map((r) => `${r.id} ${r.status}`).join(", ")}` : ""),
      summary,
      rows,
      artifactsDir,
    };
  } finally {
    if (started) teardown({ child: started.child, stopCommand: stop_command, cwd });
  }
}

// `runVerify` is injected the way the other scripts inject their side effects,
// so the flag parsing below is testable without a browser stack.
export async function main(argv = process.argv.slice(2), runVerify = verify) {
  const [command, ...rest] = argv;
  const flag = (name, fallback) =>
    rest.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;

  if (command === "criteria") {
    const specPath = rest.find((a) => !a.startsWith("--"));
    if (!specPath) {
      console.error("usage: autopilot-verify.mjs criteria <spec-path>");
      process.exitCode = 1;
      return;
    }
    const parsed = parseCriteria(readFileSync(specPath, "utf8"));
    if (!parsed.ok) {
      console.error(parsed.reason);
      process.exitCode = 1;
      return;
    }
    const ui = uiCriteria(parsed.criteria);
    console.log(JSON.stringify({ ui: ui.length, total: parsed.criteria.length, criteria: parsed.criteria }, null, 2));
    return;
  }

  if (command === "skip") {
    const runDir = flag("run-dir");
    const reason = flag("reason", "no ui acceptance criteria");
    mkdirSync(runDir, { recursive: true });
    writeFileSync(join(runDir, "pr-section.md"), formatVerifySection([], { skipped: reason }), "utf8");
    console.log(`status: skipped (${reason})`);
    return;
  }

  if (command === "run") {
    const result = await runVerify({
      configPath: flag("config", ".claude/autopilot.json"),
      runDir: flag("run-dir"),
      cwd: flag("cwd", process.cwd()),
      specPath: flag("spec"),
      round: Number(flag("round", "1")),
    });
    console.log(`status: ${Object.keys(EXIT).find((k) => EXIT[k] === result.code)}`);
    console.log(result.message);
    process.exitCode = result.code;
    return;
  }

  console.error("usage: autopilot-verify.mjs <criteria|run|skip> [...]");
  process.exitCode = 1;
}

// pathToFileURL rather than a `file://` template: the plugin's install path is
// user-controlled and a space in it would silently skip main().
if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
