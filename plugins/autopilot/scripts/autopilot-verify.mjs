import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync, existsSync, symlinkSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve as resolvePath } from "node:path";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { loadConfig, validateBrowserConfig, browserConfigured } from "./autopilot-config.mjs";

/**
 * Exit codes, because the verify stage branches on them and "non-zero" is not
 * enough: a failed criterion earns a fix round, a dead dev server does not.
 */
export const EXIT = {
  pass: 0,
  criteria_failed: 1,
  infrastructure: 2,
  unconfigured: 3,
  half_configured: 4,
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
  { timeoutMs = 60000, intervalMs = 500 } = {},
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

/**
 * Start the dev server in its own process group so the whole tree can be
 * signalled at once. A dev server that spawns a child compiler is the norm,
 * and killing only the parent leaves the port held — the next run then times
 * out against the previous run's stale server and reports infrastructure
 * failure on a healthy branch.
 */
function startServer(command, cwd) {
  const child = spawn(command, { cwd, shell: true, detached: true, stdio: "ignore" });
  child.unref();
  return child;
}

function stopServer(child) {
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

export async function verify({ configPath, runDir, cwd, specPath }) {
  const { config } = loadConfig(configPath);

  if (!browserConfigured(config)) {
    return { code: EXIT.unconfigured, message: "browser not configured in .claude/autopilot.json" };
  }
  const missing = validateBrowserConfig(config);
  if (missing.length > 0) {
    return { code: EXIT.half_configured, message: `browser config incomplete: ${missing.join(", ")}` };
  }

  if (!playwrightResolvable(cwd)) {
    return {
      code: EXIT.infrastructure,
      message:
        "@playwright/test is not resolvable from the project — add it as a " +
        "devDependency and install browsers with `npx playwright install " +
        "chromium`. Autopilot never installs it for you: a background install " +
        "on an unattended run is a surprise the developer did not approve.",
    };
  }

  const { dev_command, base_url, ready_timeout_ms = 60000, seed } = config.browser;
  const specDir = join(runDir, "specs");
  const artifactsDir = join(runDir, "artifacts");
  mkdirSync(specDir, { recursive: true });
  mkdirSync(artifactsDir, { recursive: true });
  linkModules(runDir, cwd);

  const configFile = join(runDir, "playwright.config.cjs");
  writeFileSync(configFile, playwrightConfig({ baseURL: base_url, specDir, artifactsDir }), "utf8");

  if (seed) {
    const seeded = run(seed, cwd);
    if (seeded.code !== 0) {
      return { code: EXIT.infrastructure, message: `seed command failed: ${seeded.stderr.trim()}` };
    }
  }

  let server;
  try {
    server = startServer(dev_command, cwd);
    const { ready } = await waitForServer(base_url, { timeoutMs: ready_timeout_ms });
    if (!ready) {
      return {
        code: EXIT.infrastructure,
        message: `dev server did not answer ${base_url} within ${ready_timeout_ms}ms`,
      };
    }

    const tests = run(`npx playwright test --config ${JSON.stringify(configFile)}`, cwd);
    const resultsPath = join(artifactsDir, "results.json");
    if (!existsSync(resultsPath)) {
      return {
        code: EXIT.infrastructure,
        message: `playwright produced no report: ${(tests.stderr || tests.stdout).trim().split("\n").slice(-5).join("\n")}`,
      };
    }
    const summary = summarize(JSON.parse(readFileSync(resultsPath, "utf8")));
    const parsed = specPath ? parseCriteria(readFileSync(specPath, "utf8")) : { criteria: [] };

    // Playwright exits non-zero and still writes a report when it collects
    // nothing — a spec that failed to import looks identical to a feature
    // nobody tested. Treat it as infrastructure so it parks instead of
    // sending an implementer to fix code that was never exercised.
    if (summary.total === 0 && uiCriteria(parsed.criteria).length > 0) {
      return {
        code: EXIT.infrastructure,
        message: `playwright collected no tests from ${specDir}: ${
          (tests.stderr || tests.stdout).trim().split("\n").slice(-5).join(" ")
        }`,
      };
    }

    const rows = attribute(parsed.criteria, summary);
    writeFileSync(join(runDir, "pr-section.md"), formatVerifySection(rows, { artifactsDir }), "utf8");

    // A criterion with no test is a gap in this stage, not a pass, so it is
    // failure-weighted alongside a red assertion.
    const unmet = rows.filter((r) => r.status !== "pass");
    return {
      code: summary.failed > 0 || unmet.length > 0 ? EXIT.criteria_failed : EXIT.pass,
      message:
        `${rows.length - unmet.length}/${rows.length} ui criteria passed ` +
        `(${summary.passed}/${summary.total} tests)` +
        (unmet.length > 0 ? `; unmet: ${unmet.map((r) => `${r.id} ${r.status}`).join(", ")}` : ""),
      summary,
      rows,
      artifactsDir,
    };
  } finally {
    stopServer(server);
  }
}

export async function main(argv = process.argv.slice(2)) {
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
    const reason = flag("reason", "no ui criteria");
    mkdirSync(runDir, { recursive: true });
    writeFileSync(join(runDir, "pr-section.md"), formatVerifySection([], { skipped: reason }), "utf8");
    console.log(`status: skipped (${reason})`);
    return;
  }

  if (command === "run") {
    const result = await verify({
      configPath: flag("config", ".claude/autopilot.json"),
      runDir: flag("run-dir"),
      cwd: flag("cwd", process.cwd()),
      specPath: flag("spec"),
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
