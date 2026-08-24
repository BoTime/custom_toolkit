import { readFileSync } from "node:fs";

export const ROLES = [
  "brainstorm", "spec", "plan", "learnings", "verify", "implement",
  "implement_complex", "task_review", "re_review", "final_review",
  "fix_escalation",
];

export const EFFORTS = ["low", "medium", "high", "xhigh", "max"];

/**
 * The `github` keys the autopilot-github wrapper needs, in report order.
 *
 * Deliberately NOT part of `TOP_LEVEL` below: that list is a hard error on
 * absence, so listing `github` there would break every plain `/autopilot` run
 * in a project that has no board. The wrapper's preflight and the board-
 * touching subcommands of autopilot-github-issue.mjs call the validator below
 * instead, so both fail on exactly the same check.
 */
export const GITHUB_KEYS = [
  "project_owner", "project_number", "status_field",
  "status_ready", "status_in_progress", "status_in_review",
];

/** Names the `github` keys no config layer supplied. Empty means complete. */
export function validateGithubConfig(config) {
  const github = config?.github;
  if (!github || typeof github !== "object") return [...GITHUB_KEYS];
  return GITHUB_KEYS.filter((key) => {
    const value = github[key];
    return value === undefined || value === null || value === "";
  });
}

/**
 * The `browser` keys the `verify` stage needs before it can drive a browser.
 *
 * Deliberately NOT part of `TOP_LEVEL` below, and deliberately not defaulted
 * in `autopilot.default.json`, for the same reason `test_command` has no
 * default: a guessed dev command that serves the wrong thing renders as a
 * verified feature. A project without a frontend supplies neither key and the
 * `verify` stage skips; a project with one supplies both or the stage parks.
 *
 * `ready_timeout_ms` is defaulted, because a timeout has a safe generic value
 * and an absent one would just mean "wait forever".
 */
export const BROWSER_KEYS = ["dev_command", "base_url"];

/** Names the `browser` keys no config layer supplied. Empty means complete. */
export function validateBrowserConfig(config) {
  const browser = config?.browser;
  if (!browser || typeof browser !== "object") return [...BROWSER_KEYS];
  return BROWSER_KEYS.filter((key) => {
    const value = browser[key];
    return value === undefined || value === null || value === "";
  });
}

/**
 * True when no `browser` key at all was supplied beyond the plugin's own
 * defaults — the signal that this project never opted into browser
 * verification, as opposed to opting in and misconfiguring it.
 *
 * The two cases get different treatment at the `verify` stage: unconfigured
 * skips, half-configured parks. Without this distinction a backend-only repo
 * would park on every run.
 */
export function browserConfigured(config) {
  return validateBrowserConfig(config).length < BROWSER_KEYS.length;
}

const TOP_LEVEL = ["worktree_dir", "base_ref", "reaper", "findings_threshold"];

/**
 * Merge a project config over the plugin defaults.
 *
 * Shallow per top-level key, except `roles`, which merges per role so a
 * project can override one role's model without restating all nine.
 */
export function mergeConfig(defaults, project) {
  if (!project || typeof project !== "object") return { ...defaults };

  const merged = { ...defaults, ...project };

  if (defaults.roles || project.roles) {
    merged.roles = { ...defaults.roles };
    for (const [role, entry] of Object.entries(project.roles ?? {})) {
      merged.roles[role] = { ...merged.roles[role], ...entry };
    }
  }

  // Same per-key treatment as `roles`, and for the same reason: the top-level
  // merge is shallow, so a project supplying only `project_owner` and
  // `project_number` would replace the block wholesale and lose all four
  // default status names.
  if (defaults.github || project.github) {
    merged.github = { ...defaults.github, ...(project.github ?? {}) };
  }

  // Likewise for `browser`: a project supplying only `dev_command` and
  // `base_url` would otherwise replace the block wholesale and lose the
  // default `ready_timeout_ms`, leaving the verify stage with no timeout.
  if (defaults.browser || project.browser) {
    merged.browser = { ...defaults.browser, ...(project.browser ?? {}) };
  }

  return merged;
}

export function validateConfig(obj, env) {
  const errors = [];
  const warnings = [];

  if (!obj || typeof obj !== "object") {
    return { ok: false, errors: ["config is not an object"], warnings };
  }

  const roles = obj.roles;
  if (!roles || typeof roles !== "object") {
    errors.push("roles: missing");
  } else {
    for (const role of ROLES) {
      const entry = roles[role];
      if (!entry || typeof entry !== "object") {
        errors.push(`roles.${role}: missing`);
        continue;
      }
      if (!entry.model) errors.push(`roles.${role}: missing model`);
      if (!entry.effort) {
        errors.push(`roles.${role}: missing effort`);
      } else if (!EFFORTS.includes(entry.effort)) {
        errors.push(
          `roles.${role}: effort "${entry.effort}" is not one of ${EFFORTS.join(", ")}`,
        );
      }
    }
  }

  for (const key of TOP_LEVEL) {
    if (obj[key] === undefined) errors.push(`${key}: missing`);
  }

  // A threshold below 1 promotes every one-off finding into a candidate, which
  // is exactly the noise the threshold exists to filter.
  const threshold = obj.findings_threshold;
  if (
    threshold !== undefined &&
    (!Number.isInteger(threshold) || threshold < 1)
  ) {
    errors.push("findings_threshold: must be a positive integer");
  }

  // test_command is the one genuinely project-specific key, so it has no
  // default. Guessing `npm test` in a Python repo fails confusingly, and
  // silently skipping tests is worse: the post-rebase run is the only thing
  // that catches semantic conflicts. Unset is a warning here and a park at
  // the land stage, never a green report.
  if (!obj.test_command) {
    warnings.push(
      "test_command: not set — the land stage will park instead of reporting tests green. " +
        "Set it in your project's .claude/autopilot.json",
    );
  }

  const timeout = obj.browser?.ready_timeout_ms;
  if (
    timeout !== undefined &&
    (!Number.isInteger(timeout) || timeout < 1)
  ) {
    errors.push("browser.ready_timeout_ms: must be a positive integer");
  }

  // Half-configured browser support is a warning here and a park at the verify
  // stage, never a silent skip. Skipping it would report a run as verified
  // when no browser ever opened — the same false-green the test_command rule
  // exists to prevent. Supplying neither key is the normal backend-repo case
  // and says nothing at all.
  const missingBrowser = validateBrowserConfig(obj);
  if (missingBrowser.length > 0 && missingBrowser.length < BROWSER_KEYS.length) {
    warnings.push(
      `browser: ${missingBrowser.join(", ")} not set — the verify stage will ` +
        "park instead of checking UI acceptance criteria. Set them in your " +
        "project's .claude/autopilot.json",
    );
  }

  const override = env.CLAUDE_CODE_EFFORT_LEVEL;
  if (override) {
    warnings.push(
      `CLAUDE_CODE_EFFORT_LEVEL=${override} overrides every configured effort level`,
    );
  }

  return { ok: errors.length === 0, errors, warnings };
}

function readJson(path, readFile) {
  let raw;
  try {
    raw = readFile(path);
  } catch {
    return undefined; // absent, not malformed
  }
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error(`${path} is not valid JSON`);
  }
}

/**
 * Load the effective config: plugin defaults with the project's config
 * layered over them.
 *
 * `defaultsPath` ships with the plugin and must exist. `path` is the
 * project's optional `.claude/autopilot.json`; absent means defaults alone,
 * malformed is an error rather than a silent fallback.
 */
export function loadConfig(
  path,
  env = process.env,
  readFile = (p) => readFileSync(p, "utf8"),
  defaultsPath = new URL("../autopilot.default.json", import.meta.url).pathname,
) {
  const defaults = readJson(defaultsPath, readFile);
  if (defaults === undefined) {
    throw new Error(`${defaultsPath} is missing — the plugin install is incomplete`);
  }

  const project = readJson(path, readFile);
  const merged = mergeConfig(defaults, project);

  const { ok, errors, warnings } = validateConfig(merged, env);
  if (!ok) {
    const source = project === undefined ? defaultsPath : `${path} (merged over defaults)`;
    throw new Error(`${source} is invalid:\n  ${errors.join("\n  ")}`);
  }
  return { config: merged, warnings, usedProjectConfig: project !== undefined };
}
