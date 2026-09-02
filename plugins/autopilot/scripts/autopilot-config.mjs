import { existsSync, readFileSync, writeFileSync } from "node:fs";
import {
  hostConfigPath,
  hostDefaultsPath,
  hostEffortOverride,
} from "./autopilot-host.mjs";

export const ROLES = [
  "brainstorm", "spec", "plan", "learnings", "verify", "implement",
  "implement_complex", "task_review", "re_review", "final_review",
  "fix_escalation",
];

export const EFFORTS = ["low", "medium", "high", "xhigh", "max"];

/**
 * The minimalism ladder's intensity. `off` is the default and emits no ladder
 * text at all, leaving every dispatch prompt byte-identical to one composed
 * before this key existed.
 */
export const MINIMALISM_MODES = ["off", "lite", "full"];

/**
 * The ceremony ladder, ordered by ceiling. A tier caps how far `plan` may
 * decompose the work; it never selects which documents get written — `spec`
 * and `plan` run on every tier.
 *
 * The order is load-bearing: escalation is one step up this list, derived by
 * index rather than by a second hand-maintained map.
 */
export const TIERS = ["small", "standard", "large"];

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

  // Likewise for `browser`: a project overriding nothing in the block must
  // still inherit the default `ready_timeout_ms`, leaving the verify stage
  // with a budget rather than none.
  if (defaults.browser || project.browser) {
    merged.browser = { ...defaults.browser, ...(project.browser ?? {}) };
  }

  // And likewise for `minimalism`: a project supplying a partial block — or an
  // unrelated key alongside it — must still inherit the default mode rather
  // than silently losing it to the shallow top-level merge.
  if (defaults.minimalism || project.minimalism) {
    merged.minimalism = { ...defaults.minimalism, ...(project.minimalism ?? {}) };
  }

  // Likewise for `tiers`: absence defaults, but any present-and-malformed
  // value — including an explicit `null` — is carried through unmerged so
  // validateConfig can reject it. `??` would treat `null` the same as
  // `undefined` and silently default it; the explicit `undefined` check below
  // is what keeps `null` falling through to validation like every other
  // malformed shape (a string, a number, an array).
  if (defaults.tiers || project.tiers) {
    const supplied = project.tiers;
    const isBlock =
      typeof supplied === "object" && supplied !== null && !Array.isArray(supplied);
    merged.tiers = isBlock
      ? { ...defaults.tiers, ...supplied }
      : supplied === undefined
        ? defaults.tiers
        : supplied;
  }

  // And likewise for `session`: a project raising only `max_turns` must keep
  // the default context cap rather than losing it to the shallow merge and
  // leaving the run capped on one axis.
  if (defaults.session || project.session) {
    merged.session = { ...defaults.session, ...(project.session ?? {}) };
  }

  return merged;
}

export function validateConfig(
  obj,
  env,
  { host = "claude", configPath = hostConfigPath(host) } = {},
) {
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
        `Set it in your project's ${configPath}`,
    );
  }

  const timeout = obj.browser?.ready_timeout_ms;
  if (
    timeout !== undefined &&
    (!Number.isInteger(timeout) || timeout < 1)
  ) {
    errors.push("browser.ready_timeout_ms: must be a positive integer");
  }

  // Absent is not an error — every config that predates this key must keep
  // loading, which is why `minimalism` stays out of TOP_LEVEL. A present but
  // unknown mode is, though: a typo that silently degraded to "off" would be
  // indistinguishable from never having configured the feature.
  //
  // The same reasoning covers the block's own shape: `"minimalism": "full"` is
  // the flattening a one-key block invites, and unchecked it reaches the
  // shallow spread in mergeConfig as a string and degrades to "off" just as
  // silently. Checked before the mode so a non-object reports one clear error
  // rather than also complaining about a mode it cannot have.
  const minimalism = obj.minimalism;
  const minimalismIsBlock =
    typeof minimalism === "object" &&
    minimalism !== null &&
    !Array.isArray(minimalism);
  if (minimalism !== undefined && !minimalismIsBlock) {
    errors.push("minimalism: must be an object with a `mode` key");
  }

  const minimalismMode = minimalismIsBlock ? minimalism.mode : undefined;
  if (
    minimalismMode !== undefined &&
    !MINIMALISM_MODES.includes(minimalismMode)
  ) {
    errors.push(
      `minimalism.mode: "${minimalismMode}" is not one of ${MINIMALISM_MODES.join(", ")}`,
    );
  }

  // Absent is not an error — every config that predates this key must keep
  // loading, and an absent block means an untiered run, which composes the
  // pre-tier budget. A present but malformed one is: a ceiling of 0 would
  // instruct the plan agent to write no tasks at all.
  const tiers = obj.tiers;
  const tiersIsBlock =
    typeof tiers === "object" && tiers !== null && !Array.isArray(tiers);
  if (tiers !== undefined && !tiersIsBlock) {
    errors.push(
      `tiers: must be an object mapping ${TIERS.join(", ")} to positive integers`,
    );
  }
  if (tiersIsBlock) {
    for (const tier of TIERS) {
      const ceiling = tiers[tier];
      if (ceiling !== undefined && (!Number.isInteger(ceiling) || ceiling < 1)) {
        errors.push(`tiers.${tier}: must be a positive integer`);
      }
    }
    for (const key of Object.keys(tiers)) {
      if (!TIERS.includes(key)) {
        errors.push(`tiers.${key}: not one of ${TIERS.join(", ")}`);
      }
    }
  }

  // Same reasoning as `minimalism`: absent is not an error, so `session` stays
  // out of TOP_LEVEL and every config that predates the key keeps loading. A
  // present but nonsensical cap is an error — a zero or negative cap would put
  // every session over on its first turn and hand off forever, and a flattened
  // `"session": 120` would reach the shallow spread as a number and silently
  // leave the run uncapped on both axes.
  const session = obj.session;
  const sessionIsBlock =
    typeof session === "object" && session !== null && !Array.isArray(session);
  if (session !== undefined && !sessionIsBlock) {
    errors.push("session: must be an object with `max_turns` / `max_context_tokens`");
  }
  if (sessionIsBlock) {
    for (const key of ["max_turns", "max_context_tokens"]) {
      const value = session[key];
      if (
        value !== undefined &&
        (!Number.isInteger(value) || value < 1)
      ) {
        errors.push(`session.${key}: must be a positive integer`);
      }
    }
  }

  const override = hostEffortOverride(host, env);
  if (override) {
    const overrideVar = host === "codex"
      ? "CODEX_REASONING_EFFORT"
      : "CLAUDE_CODE_EFFORT_LEVEL";
    warnings.push(
      `${overrideVar}=${override} overrides every configured effort level`,
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
  defaultsPath,
  { host = "claude" } = {},
) {
  const resolvedDefaultsPath = defaultsPath ?? hostDefaultsPath(host);
  const defaults = readJson(resolvedDefaultsPath, readFile);
  if (defaults === undefined) {
    throw new Error(`${resolvedDefaultsPath} is missing — the plugin install is incomplete`);
  }

  const project = readJson(path, readFile);
  const merged = mergeConfig(defaults, project);

  const { ok, errors, warnings } = validateConfig(merged, env, { host, configPath: path });
  if (!ok) {
    const source = project === undefined ? resolvedDefaultsPath : `${path} (merged over defaults)`;
    throw new Error(`${source} is invalid:\n  ${errors.join("\n  ")}`);
  }
  return { config: merged, warnings, usedProjectConfig: project !== undefined };
}

/**
 * Materialize the selected host's shipped defaults into the project's config
 * file so every knob — per-role model and effort included — is visible and
 * editable. `test_command` leads as an empty string: it is the one key with
 * no default, and validateConfig already treats `""` as unset, so the
 * scaffolded file loads with exactly the single warning an absent file
 * produces today.
 *
 * Never overwrites. An existing file, malformed or not, is the developer's to
 * fix; replacing it would silently discard their edits. No merging and no
 * validation on write: the shipped defaults are already valid, and the
 * project pins them from here on. Returns the written path.
 */
export function scaffoldConfig(
  path,
  {
    host = "claude",
    readFile = (p) => readFileSync(p, "utf8"),
    writeFile = (p, text) => writeFileSync(p, text),
    exists = existsSync,
  } = {},
) {
  const defaultsPath = hostDefaultsPath(host); // throws on an unknown host
  if (exists(path)) {
    throw new Error(`${path} already exists — refusing to overwrite it`);
  }
  const defaults = readJson(defaultsPath, readFile);
  if (!defaults || typeof defaults !== "object" || Array.isArray(defaults)) {
    throw new Error(
      `${defaultsPath} is not a JSON object — the plugin install is incomplete`,
    );
  }
  writeFile(path, `${JSON.stringify({ test_command: "", ...defaults }, null, 2)}\n`);
  return path;
}
