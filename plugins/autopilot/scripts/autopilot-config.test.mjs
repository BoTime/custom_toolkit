import { describe, it, expect } from "vitest";
import {
  ROLES, EFFORTS, GITHUB_KEYS, MINIMALISM_MODES, TIERS,
  validateConfig, validateGithubConfig, mergeConfig, loadConfig,
  scaffoldConfig,
} from "./autopilot-config.mjs";
import { hostDefaultsPath } from "./autopilot-host.mjs";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));

/** The real shipped defaults — the only thing that can answer AC1. */
const defaults = () =>
  JSON.parse(readFileSync(join(HERE, "..", "autopilot.default.json"), "utf8"));

const validConfig = () => ({
  roles: {
    brainstorm: { model: "opus", effort: "high" },
    spec: { model: "opus", effort: "high" },
    plan: { model: "opus", effort: "xhigh" },
    learnings: { model: "opus", effort: "high" },
    verify: { model: "sonnet", effort: "high" },
    implement: { model: "sonnet", effort: "medium" },
    implement_complex: { model: "opus", effort: "high" },
    task_review: { model: "opus", effort: "high" },
    re_review: { model: "sonnet", effort: "medium" },
    final_review: { model: "opus", effort: "xhigh" },
    fix_escalation: { model: "opus", effort: "xhigh" },
  },
  worktree_dir: ".claude/worktrees",
  base_ref: "origin/main",
  test_command: "npm test",
  reaper: true,
  findings_threshold: 2,
});

describe("ROLES and EFFORTS", () => {
  it("lists exactly the eleven roles", () => {
    expect(ROLES).toEqual([
      "brainstorm", "spec", "plan", "learnings", "verify", "implement",
      "implement_complex", "task_review", "re_review", "final_review",
      "fix_escalation",
    ]);
  });

  it("lists exactly the five effort levels", () => {
    expect(EFFORTS).toEqual(["low", "medium", "high", "xhigh", "max"]);
  });
});

describe("validateConfig", () => {
  it("accepts a complete config", () => {
    const result = validateConfig(validConfig(), {});
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("rejects a missing role", () => {
    const cfg = validConfig();
    delete cfg.roles.final_review;
    const result = validateConfig(cfg, {});
    expect(result.ok).toBe(false);
    expect(result.errors).toContain("roles.final_review: missing");
  });

  it("rejects a missing learnings role", () => {
    const cfg = validConfig();
    delete cfg.roles.learnings;
    const result = validateConfig(cfg, {});
    expect(result.ok).toBe(false);
    expect(result.errors).toContain("roles.learnings: missing");
  });

  it("rejects a role missing its model", () => {
    const cfg = validConfig();
    delete cfg.roles.plan.model;
    const result = validateConfig(cfg, {});
    expect(result.ok).toBe(false);
    expect(result.errors).toContain("roles.plan: missing model");
  });

  it("rejects a role missing its effort", () => {
    const cfg = validConfig();
    delete cfg.roles.plan.effort;
    const result = validateConfig(cfg, {});
    expect(result.ok).toBe(false);
    expect(result.errors).toContain("roles.plan: missing effort");
  });

  it("rejects an effort level outside the allowed set", () => {
    const cfg = validConfig();
    cfg.roles.plan.effort = "ultra";
    const result = validateConfig(cfg, {});
    expect(result.ok).toBe(false);
    expect(result.errors).toContain(
      'roles.plan: effort "ultra" is not one of low, medium, high, xhigh, max',
    );
  });

  it("rejects a missing top-level key", () => {
    const cfg = validConfig();
    delete cfg.base_ref;
    const result = validateConfig(cfg, {});
    expect(result.ok).toBe(false);
    expect(result.errors).toContain("base_ref: missing");
  });

  it("warns rather than errors when test_command is absent", () => {
    const cfg = validConfig();
    delete cfg.test_command;
    const result = validateConfig(cfg, {});
    expect(result.ok).toBe(true);
    expect(result.warnings.join("\n")).toMatch(/test_command: not set/);
    expect(result.warnings.join("\n")).toMatch(/park/);
  });

  it("does not warn about test_command when it is set", () => {
    const result = validateConfig(validConfig(), {});
    expect(result.warnings.join("\n")).not.toMatch(/test_command/);
  });

  it("warns when CLAUDE_CODE_EFFORT_LEVEL is set", () => {
    const result = validateConfig(validConfig(), { CLAUDE_CODE_EFFORT_LEVEL: "low" });
    expect(result.ok).toBe(true);
    expect(result.warnings).toContain(
      'CLAUDE_CODE_EFFORT_LEVEL=low overrides every configured effort level',
    );
  });

  it("does not warn when CLAUDE_CODE_EFFORT_LEVEL is absent", () => {
    const result = validateConfig(validConfig(), {});
    expect(result.warnings).toEqual([]);
  });

  it("rejects a missing findings_threshold", () => {
    const cfg = validConfig();
    delete cfg.findings_threshold;
    const result = validateConfig(cfg, {});
    expect(result.ok).toBe(false);
    expect(result.errors).toContain("findings_threshold: missing");
  });

  it("rejects a non-integer findings_threshold", () => {
    const cfg = validConfig();
    cfg.findings_threshold = 2.5;
    const result = validateConfig(cfg, {});
    expect(result.ok).toBe(false);
    expect(result.errors).toContain(
      "findings_threshold: must be a positive integer",
    );
  });

  it("rejects a findings_threshold below 1", () => {
    // A threshold of 0 would promote every one-off finding into a candidate,
    // which is the noise the threshold exists to filter.
    const cfg = validConfig();
    cfg.findings_threshold = 0;
    const result = validateConfig(cfg, {});
    expect(result.ok).toBe(false);
    expect(result.errors).toContain(
      "findings_threshold: must be a positive integer",
    );
  });

  it("accepts a findings_threshold of 1", () => {
    const cfg = validConfig();
    cfg.findings_threshold = 1;
    expect(validateConfig(cfg, {}).ok).toBe(true);
  });
});

describe("mergeConfig", () => {
  it("returns the defaults when there is no project config", () => {
    const merged = mergeConfig(validConfig(), undefined);
    expect(merged).toEqual(validConfig());
  });

  it("overrides a scalar key", () => {
    const merged = mergeConfig(validConfig(), { base_ref: "origin/develop" });
    expect(merged.base_ref).toBe("origin/develop");
    expect(merged.worktree_dir).toBe(".claude/worktrees");
  });

  it("overrides one role and preserves the other ten", () => {
    const merged = mergeConfig(validConfig(), {
      roles: { implement: { model: "opus" } },
    });
    expect(merged.roles.implement.model).toBe("opus");
    // effort survives a partial role override
    expect(merged.roles.implement.effort).toBe("medium");
    expect(merged.roles.plan).toEqual({ model: "opus", effort: "xhigh" });
    expect(Object.keys(merged.roles)).toHaveLength(11);
  });

  it("does not mutate the defaults", () => {
    const defaults = validConfig();
    mergeConfig(defaults, { roles: { implement: { model: "opus" } } });
    expect(defaults.roles.implement.model).toBe("sonnet");
  });

  it("adds a key the defaults omit", () => {
    const defaults = validConfig();
    delete defaults.test_command;
    const merged = mergeConfig(defaults, { test_command: "uv run pytest" });
    expect(merged.test_command).toBe("uv run pytest");
  });

  it("lets a project override findings_threshold", () => {
    const merged = mergeConfig(validConfig(), { findings_threshold: 5 });
    expect(merged.findings_threshold).toBe(5);
  });
});

describe("loadConfig", () => {
  // Routes reads by path so defaults and project config can differ.
  const reader = (files) => (p) => {
    if (!(p in files)) throw new Error("ENOENT");
    return files[p];
  };

  const DEFAULTS = "/plugin/autopilot.default.json";
  const CODEX_DEFAULTS = join(
    dirname(fileURLToPath(import.meta.url)),
    "..",
    "autopilot.codex.default.json",
  );
  const PROJECT = "/proj/.claude/autopilot.json";

  it("returns the defaults when the project has no config", () => {
    const readFile = reader({ [DEFAULTS]: JSON.stringify(validConfig()) });
    const { config, usedProjectConfig } = loadConfig(PROJECT, {}, readFile, DEFAULTS);
    expect(config.roles.implement.model).toBe("sonnet");
    expect(usedProjectConfig).toBe(false);
  });

  it("layers the project config over the defaults", () => {
    const readFile = reader({
      [DEFAULTS]: JSON.stringify(validConfig()),
      [PROJECT]: JSON.stringify({ test_command: "uv run pytest" }),
    });
    const { config, usedProjectConfig } = loadConfig(PROJECT, {}, readFile, DEFAULTS);
    expect(config.test_command).toBe("uv run pytest");
    expect(config.roles.implement.model).toBe("sonnet");
    expect(usedProjectConfig).toBe(true);
  });

  it("warns when no layer supplies test_command", () => {
    const defaults = validConfig();
    delete defaults.test_command;
    const readFile = reader({ [DEFAULTS]: JSON.stringify(defaults) });
    const { warnings } = loadConfig(PROJECT, {}, readFile, DEFAULTS);
    expect(warnings.join("\n")).toMatch(/test_command: not set/);
  });

  it("throws when the plugin defaults are missing", () => {
    const readFile = reader({});
    expect(() => loadConfig(PROJECT, {}, readFile, DEFAULTS)).toThrow(
      /install is incomplete/,
    );
  });

  it("throws with all errors joined when the merged config is invalid", () => {
    const defaults = validConfig();
    delete defaults.roles.plan;
    delete defaults.base_ref;
    const readFile = reader({ [DEFAULTS]: JSON.stringify(defaults) });
    expect(() => loadConfig(PROJECT, {}, readFile, DEFAULTS)).toThrow(
      /roles\.plan: missing/,
    );
  });

  it("attributes invalid shipped defaults to the defaults path when no project config exists", () => {
    const defaults = validConfig();
    delete defaults.roles.plan;
    const readFile = reader({ [DEFAULTS]: JSON.stringify(defaults) });
    expect(() => loadConfig(PROJECT, {}, readFile, DEFAULTS)).toThrow(
      new RegExp(`^${DEFAULTS.replaceAll(".", "\\.")} is invalid:`),
    );
  });

  it("throws a clear error when the project config is not valid JSON", () => {
    const readFile = reader({
      [DEFAULTS]: JSON.stringify(validConfig()),
      [PROJECT]: "{ not json",
    });
    expect(() => loadConfig(PROJECT, {}, readFile, DEFAULTS)).toThrow(
      /autopilot\.json is not valid JSON/,
    );
  });

  it("ships a findings_threshold default when the project sets none", () => {
    const readFile = reader({ [DEFAULTS]: JSON.stringify(validConfig()) });
    const { config } = loadConfig(PROJECT, {}, readFile, DEFAULTS);
    expect(config.findings_threshold).toBe(2);
  });

  it("loads codex defaults when the host is codex", () => {
    const codexDefaults = {
      ...validConfig(),
      roles: {
        ...validConfig().roles,
        implement: { model: "gpt-5.6-terra", effort: "medium" },
        implement_complex: { model: "gpt-5.6-sol", effort: "high" },
      },
    };
    const readFile = reader({
      [CODEX_DEFAULTS]: JSON.stringify(codexDefaults),
    });
    const { config, usedProjectConfig } = loadConfig(
      "/proj/.codex/autopilot.json",
      {},
      readFile,
      undefined,
      { host: "codex" },
    );
    expect(config.roles.implement.model).toBe("gpt-5.6-terra");
    expect(config.roles.implement_complex.model).toBe("gpt-5.6-sol");
    expect(usedProjectConfig).toBe(false);
  });

  it("merges .codex overrides independently of .claude", () => {
    const readFile = reader({
      [CODEX_DEFAULTS]: JSON.stringify({
        ...validConfig(),
        roles: {
          ...validConfig().roles,
          implement: { model: "gpt-5.6-terra", effort: "medium" },
        },
      }),
      "/proj/.codex/autopilot.json": JSON.stringify({
        roles: { implement: { effort: "max" } },
      }),
    });
    const { config, usedProjectConfig } = loadConfig(
      "/proj/.codex/autopilot.json",
      {},
      readFile,
      undefined,
      { host: "codex" },
    );
    expect(config.roles.implement).toEqual({ model: "gpt-5.6-terra", effort: "max" });
    expect(usedProjectConfig).toBe(true);
  });

  it("uses the passed config path in the missing test_command warning", () => {
    const defaults = validConfig();
    delete defaults.test_command;
    const readFile = reader({
      [CODEX_DEFAULTS]: JSON.stringify(defaults),
    });
    const { warnings } = loadConfig(
      "/proj/.codex/autopilot.json",
      {},
      readFile,
      undefined,
      { host: "codex" },
    );
    expect(warnings).toContain(
      "test_command: not set — the land stage will park instead of reporting tests green. Set it in your project's /proj/.codex/autopilot.json",
    );
  });

  it("warns when CODEX_REASONING_EFFORT is set for codex", () => {
    const readFile = reader({
      [CODEX_DEFAULTS]: JSON.stringify(validConfig()),
    });
    const { warnings } = loadConfig(
      "/proj/.codex/autopilot.json",
      { CODEX_REASONING_EFFORT: "high" },
      readFile,
      undefined,
      { host: "codex" },
    );
    expect(warnings).toContain(
      "CODEX_REASONING_EFFORT=high overrides every configured effort level",
    );
  });

  it("rejects an unknown host", () => {
    const readFile = reader({ [DEFAULTS]: JSON.stringify(validConfig()) });
    expect(() => loadConfig(PROJECT, {}, readFile, DEFAULTS, { host: "cursor" }))
      .toThrow(/unknown host/i);
  });
});

// The `github` block powers the autopilot-github wrapper only. Two properties
// have to hold at once: a project that supplies just the two irreducibly
// project-specific keys must keep the four default status names (otherwise the
// shallow top-level merge silently drops them), and a project with no `github`
// block at all must keep loading exactly as before — plain /autopilot has no
// board and must not start erroring.

const validGithub = () => ({
  project_owner: "BoTime",
  project_number: 7,
  status_field: "Status",
  status_ready: "Ready",
  status_in_progress: "In Progress",
  status_in_review: "In Review",
});

describe("validateGithubConfig", () => {
  it("returns an empty list for a complete github block", () => {
    expect(validateGithubConfig({ github: validGithub() })).toEqual([]);
  });

  it("names every key when the block is absent entirely", () => {
    expect(validateGithubConfig({})).toEqual(GITHUB_KEYS);
  });

  it("names every key when the block is not an object", () => {
    expect(validateGithubConfig({ github: "yes" })).toEqual(GITHUB_KEYS);
  });

  it("names only the keys that are actually missing", () => {
    const github = validGithub();
    delete github.project_owner;
    delete github.status_in_review;
    expect(validateGithubConfig({ github })).toEqual([
      "project_owner",
      "status_in_review",
    ]);
  });

  it("treats an empty string as missing", () => {
    // A key present but blank fails at gh-call time with a confusing message.
    // Catching it in preflight is the whole point of the check.
    expect(validateGithubConfig({ github: { ...validGithub(), status_ready: "" } }))
      .toEqual(["status_ready"]);
  });

  it("does not throw on a null config", () => {
    expect(validateGithubConfig(null)).toEqual(GITHUB_KEYS);
  });
});

describe("mergeConfig with github", () => {
  it("merges github per key so a project supplying only the two project keys keeps the status names", () => {
    const defaults = {
      ...validConfig(),
      github: {
        status_field: "Status",
        status_ready: "Ready",
        status_in_progress: "In Progress",
        status_in_review: "In Review",
      },
    };
    const merged = mergeConfig(defaults, {
      github: { project_owner: "BoTime", project_number: 7 },
    });
    expect(merged.github).toEqual(validGithub());
  });

  it("lets a project override one status name and keep the rest", () => {
    const defaults = { ...validConfig(), github: validGithub() };
    const merged = mergeConfig(defaults, { github: { status_in_review: "Review" } });
    expect(merged.github.status_in_review).toBe("Review");
    expect(merged.github.status_ready).toBe("Ready");
    expect(merged.github.project_owner).toBe("BoTime");
  });

  it("leaves github absent when neither layer supplies one", () => {
    const merged = mergeConfig(validConfig(), { test_command: "npm test" });
    expect(merged.github).toBeUndefined();
  });

  it("does not mutate the defaults' github block", () => {
    const defaults = { ...validConfig(), github: validGithub() };
    mergeConfig(defaults, { github: { status_ready: "Backlog" } });
    expect(defaults.github.status_ready).toBe("Ready");
  });
});

describe("github is not a hard requirement", () => {
  it("validateConfig accepts a config with no github block", () => {
    // github in TOP_LEVEL would break every plain /autopilot run in a project
    // with no board. This is the test that stops someone adding it there.
    const result = validateConfig(validConfig(), {});
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("loadConfig warns about nothing new when the project has no github block", () => {
    const readFile = (p) => {
      if (p !== "/plugin/autopilot.default.json") throw new Error("ENOENT");
      return JSON.stringify({ ...validConfig(), github: { status_ready: "Ready" } });
    };
    const { config, warnings } = loadConfig(
      "/proj/.claude/autopilot.json", {}, readFile, "/plugin/autopilot.default.json",
    );
    expect(warnings).toEqual([]);
    expect(config.github).toEqual({ status_ready: "Ready" });
  });
});

describe("shipped autopilot.default.json", () => {
  const defaults = JSON.parse(
    readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "..", "autopilot.default.json"),
      "utf8",
    ),
  );

  it("ships the four non-project-specific github keys", () => {
    expect(defaults.github).toEqual({
      status_field: "Status",
      status_ready: "Ready",
      status_in_progress: "In Progress",
      status_in_review: "In Review",
    });
  });

  it("ships no default for the two project-specific keys", () => {
    // Same reason test_command has no default: a guessed owner or board number
    // fails confusingly instead of failing at preflight with the key's name.
    expect(defaults.github.project_owner).toBeUndefined();
    expect(defaults.github.project_number).toBeUndefined();
  });

  it("ships the learnings role", () => {
    expect(defaults.roles.learnings).toEqual({ model: "opus", effort: "high" });
  });
});

describe("shipped autopilot.codex.default.json", () => {
  const defaults = JSON.parse(
    readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "..", "autopilot.codex.default.json"),
      "utf8",
    ),
  );

  it("ships every role with a codex model and allowed effort", () => {
    for (const role of ROLES) {
      expect(defaults.roles[role]).toBeDefined();
      expect(["gpt-5.6-terra", "gpt-5.6-sol"]).toContain(defaults.roles[role].model);
      expect(EFFORTS).toContain(defaults.roles[role].effort);
    }
  });

  it("uses gpt-5.6-sol for high-complexity roles and gpt-5.6-terra for routine roles", () => {
    expect(defaults.roles.brainstorm.model).toBe("gpt-5.6-sol");
    expect(defaults.roles.plan.model).toBe("gpt-5.6-sol");
    expect(defaults.roles.implement_complex.model).toBe("gpt-5.6-sol");
    expect(defaults.roles.fix_escalation.model).toBe("gpt-5.6-sol");
    expect(defaults.roles.verify.model).toBe("gpt-5.6-terra");
    expect(defaults.roles.implement.model).toBe("gpt-5.6-terra");
    expect(defaults.roles.re_review.model).toBe("gpt-5.6-terra");
  });
});

describe("browser config is one policy knob and nothing else", () => {
  // Every other browser fact — the dev command, the URL, the seed — is now
  // derived per run into the verify recipe. A timeout cannot be: how long a
  // human is willing to wait before calling a stack dead cannot be read off
  // package.json.
  it("exports no browser key list any more", async () => {
    const mod = await import("./autopilot-config.mjs");
    expect(mod.BROWSER_KEYS).toBeUndefined();
    expect(mod.validateBrowserConfig).toBeUndefined();
    expect(mod.browserConfigured).toBeUndefined();
  });

  it("ships a two-minute default, because a docker stack is not up in sixty seconds", () => {
    const defaults = JSON.parse(
      readFileSync(
        join(dirname(fileURLToPath(import.meta.url)), "..", "autopilot.default.json"),
        "utf8",
      ),
    );
    expect(defaults.browser).toEqual({ ready_timeout_ms: 120000 });
  });

  it("keeps the default timeout when a project overrides nothing in browser", () => {
    const merged = mergeConfig(
      { ...validConfig(), browser: { ready_timeout_ms: 120000 } },
      { test_command: "npm test" },
    );
    expect(merged.browser).toEqual({ ready_timeout_ms: 120000 });
  });

  it("lets a project raise the timeout", () => {
    const merged = mergeConfig(
      { ...validConfig(), browser: { ready_timeout_ms: 120000 } },
      { browser: { ready_timeout_ms: 300000 } },
    );
    expect(merged.browser.ready_timeout_ms).toBe(300000);
  });

  it("rejects a non-positive timeout", () => {
    const result = validateConfig({ ...validConfig(), browser: { ready_timeout_ms: 0 } }, {});
    expect(result.ok).toBe(false);
    expect(result.errors).toContain("browser.ready_timeout_ms: must be a positive integer");
  });

  // There is nothing to half-configure any more, so a browser block must never
  // produce a warning — a backend repo would otherwise be nagged every run.
  it("warns about nothing in the browser block", () => {
    const result = validateConfig({ ...validConfig(), browser: { ready_timeout_ms: 120000 } }, {});
    expect(result.warnings.join("\n")).not.toMatch(/browser/);
  });
});

// `minimalism` is a nested optional block: merged per key like `browser`, kept
// out of TOP_LEVEL like `github`. Both properties have to hold at once — a
// project supplying a partial block must still inherit the default mode, and a
// project with no block at all (every config that predates the key) must keep
// loading exactly as before.

describe("minimalism config", () => {
  const DEFAULTS = "/plugin/autopilot.default.json";
  const PROJECT = "/proj/.claude/autopilot.json";
  const reader = (files) => (p) => {
    if (!(p in files)) throw new Error("ENOENT");
    return files[p];
  };
  const withMinimalism = () => ({ ...validConfig(), minimalism: { mode: "off" } });

  it("lists exactly the three modes", () => {
    expect(MINIMALISM_MODES).toEqual(["off", "lite", "full"]);
  });

  it("ships mode off in autopilot.default.json", () => {
    const defaults = JSON.parse(
      readFileSync(
        join(dirname(fileURLToPath(import.meta.url)), "..", "autopilot.default.json"),
        "utf8",
      ),
    );
    expect(defaults.minimalism).toEqual({ mode: "off" });
  });

  it("returns mode off when the project has no minimalism key", () => {
    const readFile = reader({ [DEFAULTS]: JSON.stringify(withMinimalism()) });
    const { config } = loadConfig(PROJECT, {}, readFile, DEFAULTS);
    expect(config.minimalism.mode).toBe("off");
  });

  it("loads lite from the project config", () => {
    const readFile = reader({
      [DEFAULTS]: JSON.stringify(withMinimalism()),
      [PROJECT]: JSON.stringify({ minimalism: { mode: "lite" } }),
    });
    const { config } = loadConfig(PROJECT, {}, readFile, DEFAULTS);
    expect(config.minimalism.mode).toBe("lite");
  });

  it("loads full from the project config", () => {
    const readFile = reader({
      [DEFAULTS]: JSON.stringify(withMinimalism()),
      [PROJECT]: JSON.stringify({ minimalism: { mode: "full" } }),
    });
    const { config } = loadConfig(PROJECT, {}, readFile, DEFAULTS);
    expect(config.minimalism.mode).toBe("full");
  });

  it("keeps the default mode when a project supplies a minimalism block without one", () => {
    // Without the per-key merge the shallow top-level spread replaces the whole
    // block and the mode disappears, so this fails on the current code.
    const merged = mergeConfig(withMinimalism(), { minimalism: {} });
    expect(merged.minimalism).toEqual({ mode: "off" });
  });

  it("does not mutate the defaults' minimalism block", () => {
    const defaults = withMinimalism();
    mergeConfig(defaults, { minimalism: { mode: "full" } });
    expect(defaults.minimalism).toEqual({ mode: "off" });
  });

  it("leaves minimalism absent when neither layer supplies one", () => {
    const merged = mergeConfig(validConfig(), { base_ref: "origin/trunk" });
    expect(merged.minimalism).toBeUndefined();
  });

  it("rejects an unknown mode with an error naming minimalism.mode", () => {
    const result = validateConfig(
      { ...validConfig(), minimalism: { mode: "ultra" } },
      {},
    );
    expect(result.ok).toBe(false);
    expect(result.errors).toContain(
      'minimalism.mode: "ultra" is not one of off, lite, full',
    );
  });

  it("rejects a minimalism value that is not a block", () => {
    // `"minimalism": "full"` is the flattening a one-key block invites. Without
    // the shape guard it validates clean, then merges into
    // { mode: "off", 0: "f", ... } and the feature is silently off.
    for (const value of ["full", null, ["full"]]) {
      const result = validateConfig({ ...validConfig(), minimalism: value }, {});
      expect(result.ok).toBe(false);
      expect(result.errors).toContain(
        "minimalism: must be an object with a `mode` key",
      );
    }
  });

  it("surfaces an unknown mode as a load failure, not a silent fallback", () => {
    const readFile = reader({
      [DEFAULTS]: JSON.stringify(withMinimalism()),
      [PROJECT]: JSON.stringify({ minimalism: { mode: "ultra" } }),
    });
    expect(() => loadConfig(PROJECT, {}, readFile, DEFAULTS)).toThrow(
      /minimalism\.mode/,
    );
  });

  it("neither errors nor warns when no layer supplies a minimalism block", () => {
    const result = validateConfig(validConfig(), {});
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.warnings.join("\n")).not.toMatch(/minimalism/);
  });

  it("keeps loading a config that predates the key, so minimalism is not a hard requirement", () => {
    // The TOP_LEVEL guard: adding `minimalism` there would make this throw.
    const readFile = reader({ [DEFAULTS]: JSON.stringify(validConfig()) });
    const { config, warnings } = loadConfig(PROJECT, {}, readFile, DEFAULTS);
    expect(config.minimalism).toBeUndefined();
    expect(warnings.join("\n")).not.toMatch(/minimalism/);
  });
});

describe("the tiers block", () => {
  it("names the three tiers in ceiling order", () => {
    expect(TIERS).toEqual(["small", "standard", "large"]);
  });

  it("defaults to 1, 3 and 5 when the project supplies no tiers key", () => {
    // AC1
    const merged = mergeConfig(defaults(), {});
    expect(merged.tiers).toEqual({ small: 1, standard: 3, large: 5 });
  });

  it("inherits the default ceiling for every key a partial block omits", () => {
    // AC2 — the shallow top-level merge would otherwise drop small and large.
    const merged = mergeConfig(defaults(), { tiers: { standard: 4 } });
    expect(merged.tiers).toEqual({ small: 1, standard: 4, large: 5 });
  });

  it("rejects a ceiling that is not a positive integer, naming the key", () => {
    // AC3
    for (const bad of [0, -1, 2.5, "3", null]) {
      const { ok, errors } = validateConfig(
        mergeConfig(defaults(), { tiers: { standard: bad } }),
        {},
      );
      expect(ok).toBe(false);
      expect(errors.join("\n")).toMatch(/tiers\.standard/);
    }
  });

  it("rejects a flattened tiers value rather than silently keeping the defaults", () => {
    // "tiers": 3 is the flattening a numeric block invites. Spreading a
    // non-object into the merge would produce an object that validates,
    // losing the developer's intent without a word. `null` is included here
    // because `??` would otherwise treat it the same as an absent key and
    // silently default it — unlike every other malformed shape.
    for (const bad of [3, "3", [], null]) {
      const { ok, errors } = validateConfig(mergeConfig(defaults(), { tiers: bad }), {});
      expect(ok).toBe(false);
      expect(errors.join("\n")).toMatch(/^tiers:/m);
    }
  });

  it("rejects an unknown tier name, naming it", () => {
    // A typo'd tier key leaves that tier at its default ceiling, which is
    // indistinguishable from never having configured the feature — the same
    // reasoning the file already applies to minimalism.mode.
    const { ok, errors } = validateConfig(
      mergeConfig(defaults(), { tiers: { medium: 4 } }),
      {},
    );
    expect(ok).toBe(false);
    expect(errors.join("\n")).toMatch(/tiers\.medium/);
  });

  it("keeps loading a config that predates the key entirely", () => {
    const config = defaults();
    delete config.tiers;
    expect(validateConfig(config, {}).ok).toBe(true);
  });
});

// `session` follows the same shape as `minimalism`: optional, merged per key,
// out of TOP_LEVEL so configs that predate it keep loading. The caps bound how
// long one session may run before the controller hands off to a resumed one.

describe("session config", () => {
  const DEFAULTS = "/plugin/autopilot.default.json";
  const PROJECT = "/proj/.claude/autopilot.json";
  const reader = (files) => (p) => {
    if (!(p in files)) throw new Error("ENOENT");
    return files[p];
  };
  const withSession = () => ({
    ...validConfig(),
    session: { max_turns: 120, max_context_tokens: 150000 },
  });

  it("ships both caps in autopilot.default.json", () => {
    const defaults = JSON.parse(
      readFileSync(
        join(dirname(fileURLToPath(import.meta.url)), "..", "autopilot.default.json"),
        "utf8",
      ),
    );
    expect(defaults.session).toEqual({
      max_turns: 120,
      max_context_tokens: 150000,
    });
  });

  it("keeps the context cap when a project overrides only max_turns", () => {
    const merged = mergeConfig(withSession(), { session: { max_turns: 60 } });
    expect(merged.session).toEqual({ max_turns: 60, max_context_tokens: 150000 });
  });

  it("does not mutate the defaults' session block", () => {
    const defaults = withSession();
    mergeConfig(defaults, { session: { max_turns: 40 } });
    expect(defaults.session.max_turns).toBe(120);
  });

  it("leaves session absent when neither layer supplies one", () => {
    const merged = mergeConfig(validConfig(), {});
    expect(merged.session).toBeUndefined();
  });

  it("loads a config that predates the key without error", () => {
    const readFile = reader({ [DEFAULTS]: JSON.stringify(validConfig()) });
    const { config, warnings } = loadConfig(PROJECT, {}, readFile, DEFAULTS);
    expect(config.session).toBeUndefined();
    expect(warnings.join("\n")).not.toMatch(/session/);
  });

  it("rejects a flattened session value", () => {
    const result = validateConfig({ ...validConfig(), session: 120 }, {});
    expect(result.ok).toBe(false);
    expect(result.errors.join("\n")).toMatch(/^session: must be an object/m);
  });

  it("rejects a cap that would put every session over on its first turn", () => {
    const result = validateConfig(
      { ...validConfig(), session: { max_turns: 0 } },
      {},
    );
    expect(result.ok).toBe(false);
    expect(result.errors.join("\n")).toMatch(/session\.max_turns/);
  });

  it("rejects a non-integer context cap", () => {
    const result = validateConfig(
      { ...validConfig(), session: { max_context_tokens: 1.5 } },
      {},
    );
    expect(result.ok).toBe(false);
    expect(result.errors.join("\n")).toMatch(/session\.max_context_tokens/);
  });

  it("accepts a block that sets only one axis", () => {
    const result = validateConfig(
      { ...validConfig(), session: { max_turns: 80 } },
      {},
    );
    expect(result.ok).toBe(true);
  });

  it("accepts on_cap continue and handoff", () => {
    for (const on_cap of ["continue", "handoff"]) {
      const result = validateConfig({ ...validConfig(), session: { on_cap } }, {});
      expect(result.ok).toBe(true);
    }
  });

  it("rejects an unknown on_cap policy", () => {
    const result = validateConfig(
      { ...validConfig(), session: { on_cap: "park" } },
      {},
    );
    expect(result.ok).toBe(false);
    expect(result.errors.join("\n")).toMatch(/session\.on_cap: must be one of handoff, continue/);
  });

  it("carries on_cap through the merge alongside the caps", () => {
    const merged = mergeConfig(withSession(), { session: { on_cap: "continue" } });
    expect(merged.session).toEqual({
      max_turns: 120,
      max_context_tokens: 150000,
      on_cap: "continue",
    });
  });
});

describe("scaffoldConfig", () => {
  const CLAUDE_DEFAULTS = hostDefaultsPath("claude");
  const CODEX_DEFAULTS = hostDefaultsPath("codex");
  const CLAUDE_PROJECT = "/proj/.claude/autopilot.json";
  const CODEX_PROJECT = "/proj/.codex/autopilot.json";

  // Records every write and routes reads to the real shipped defaults, so
  // the tests answer for the file the plugin actually ships.
  const harness = ({ present = false } = {}) => {
    const writes = [];
    const reads = [];
    return {
      writes,
      reads,
      deps: {
        readFile: (p) => {
          reads.push(p);
          return readFileSync(p, "utf8");
        },
        writeFile: (p, text) => {
          writes.push({ path: p, text });
        },
        exists: () => present,
      },
    };
  };

  it("writes the Claude defaults behind a leading empty test_command, in shipped order", () => {
    // AC1
    const { writes, deps } = harness();
    const returned = scaffoldConfig(CLAUDE_PROJECT, { host: "claude", ...deps });
    expect(returned).toBe(CLAUDE_PROJECT);
    expect(writes).toHaveLength(1);
    expect(writes[0].path).toBe(CLAUDE_PROJECT);
    const written = JSON.parse(writes[0].text);
    const shipped = JSON.parse(readFileSync(CLAUDE_DEFAULTS, "utf8"));
    expect(written).toEqual({ test_command: "", ...shipped });
    expect(Object.keys(written)).toEqual(["test_command", ...Object.keys(shipped)]);
  });

  it("reads and writes the Codex defaults on host codex", () => {
    // AC2
    const { writes, reads, deps } = harness();
    scaffoldConfig(CODEX_PROJECT, { host: "codex", ...deps });
    expect(reads).toEqual([CODEX_DEFAULTS]);
    const written = JSON.parse(writes[0].text);
    const shipped = JSON.parse(readFileSync(CODEX_DEFAULTS, "utf8"));
    expect(written).toEqual({ test_command: "", ...shipped });
    expect(Object.keys(written)).toEqual(["test_command", ...Object.keys(shipped)]);
    expect(written.roles.plan.model).toBe("gpt-5.6-sol");
  });

  it("throws the assertHost error for an unknown host and writes nothing", () => {
    // AC2
    const { writes, deps } = harness();
    expect(() => scaffoldConfig(CLAUDE_PROJECT, { host: "gemini", ...deps })).toThrow(
      /unknown host "gemini"/,
    );
    expect(writes).toEqual([]);
  });

  it("refuses to overwrite an existing file, naming the path, and never calls writeFile", () => {
    // AC3
    const { writes, deps } = harness({ present: true });
    expect(() => scaffoldConfig(CLAUDE_PROJECT, { host: "claude", ...deps })).toThrow(
      /already exists/,
    );
    expect(() => scaffoldConfig(CLAUDE_PROJECT, { host: "claude", ...deps })).toThrow(
      CLAUDE_PROJECT,
    );
    expect(writes).toEqual([]);
  });

  it("throws rather than scaffolding when the shipped defaults are not a JSON object", () => {
    // Shape guard: a spread of a non-object would silently write `{}` plus
    // the placeholder, which loadConfig would then reject far from the cause.
    const { writes, deps } = harness();
    const readFile = () => "[]";
    expect(() =>
      scaffoldConfig(CLAUDE_PROJECT, { host: "claude", ...deps, readFile }),
    ).toThrow(/is not a JSON object/);
    expect(writes).toEqual([]);
  });

  it("round-trips through loadConfig with ok and exactly the test_command warning", () => {
    // AC4 — `ok` is implied: loadConfig throws on any error.
    const { writes, deps } = harness();
    scaffoldConfig(CLAUDE_PROJECT, { host: "claude", ...deps });
    const readFile = (p) =>
      p === CLAUDE_PROJECT ? writes[0].text : readFileSync(p, "utf8");
    const { warnings, usedProjectConfig } = loadConfig(
      CLAUDE_PROJECT, {}, readFile, undefined, { host: "claude" },
    );
    expect(usedProjectConfig).toBe(true);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/^test_command: not set/);
  });

  it("writes two-space-indented JSON ending in exactly one newline", () => {
    // AC1
    const { writes, deps } = harness();
    scaffoldConfig(CLAUDE_PROJECT, { host: "claude", ...deps });
    const text = writes[0].text;
    expect(text).toBe(`${JSON.stringify(JSON.parse(text), null, 2)}\n`);
    expect(text.startsWith('{\n  "test_command": "",\n')).toBe(true);
    expect(text.endsWith("}\n")).toBe(true);
    expect(text.endsWith("\n\n")).toBe(false);
  });
});
