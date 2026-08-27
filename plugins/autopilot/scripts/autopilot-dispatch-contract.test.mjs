// What each stage's dispatch actually carries, composed through the script.
//
// This replaces the `sectionOf`-based route the contract tests used to take.
// That route proved a contract reached the agent by resolving the
// `references/**.md` paths SKILL.md named; SKILL.md no longer names them, so
// the proof has to go where the assembly went. These assertions compose the
// real definition from the real files and read the result.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  STAGES,
  ROLE_TABLE_ROLES,
  compose,
  roleTable,
  placeholdersIn,
  readFragment,
  outputPath,
} from "./autopilot-dispatch.mjs";
import { defaultConfig, dummyValues, composeStage } from "./dispatch-fixture.mjs";
import { SKILL_DIR, SKILL_PATH, readSkill } from "./skill-sections.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const VERIFY_RUN_PATH = join(SKILL_DIR, "references", "stages", "verify-run.md");
const GITHUB_SKILL_PATH = join(HERE, "..", "skills", "autopilot-github", "SKILL.md");
const LEDGER_PATH = join(HERE, "autopilot-ledger.mjs");

const skill = readSkill();
const stageNames = Object.keys(STAGES);

/** The fragment text as `compose` embeds it — trailing whitespace stripped. */
const fragmentBody = (rel) => readFragment(rel).replace(/\s+$/, "");

describe("every stage composes a valid subagent definition", () => {
  it.each(stageNames)("%s carries the role's configured model and effort", (stage) => {
    const config = defaultConfig();
    const role = STAGES[stage].role;
    const out = composeStage(stage);
    expect(out.startsWith("---\n")).toBe(true);
    // Role-keyed, not stage-keyed: the README documents
    // PONYTAIL_SUBAGENT_MATCHER as ^autopilot-(plan|implement|implement_complex)$,
    // which a stage-keyed name would silently stop matching.
    expect(out).toContain(`name: autopilot-${role}`);
    expect(out).toContain(`description: ${stage} stage of an autopilot run`);
    expect(out).toContain(`model: ${config.roles[role].model}`);
    expect(out).toContain(`effort: ${config.roles[role].effort}`);
  });

  it.each(stageNames)("%s renders every placeholder — none survives into the prompt", (stage) => {
    expect(composeStage(stage)).not.toMatch(/\{\{[a-z0-9_]+\}\}/);
  });

  it.each(stageNames)("%s declares exactly the placeholders the design fixes", (stage) => {
    // Copied from the design's placeholder table. Flags are kebab-case and
    // placeholders snake_case, so this list is also the flag list every caller
    // must pass — a template growing a placeholder no caller fills would park
    // every run, and one losing a placeholder would silently drop a value.
    const EXPECTED = {
      spec: ["run", "worktree", "branch", "spec_path", "design", "criteria_source"],
      plan: ["run", "worktree", "spec_path"],
      sdd: ["run", "worktree", "plan_path"],
      verify: ["run", "worktree", "spec_path", "verify_dir"],
      "verify-fix": ["run", "worktree", "failing_criteria", "failures"],
      learnings: ["run", "worktree"],
      "land-conflict": ["run", "worktree", "base_ref", "conflicts"],
      pr: ["run", "worktree"],
    };
    expect(placeholdersIn(readFragment(STAGES[stage].body)).sort())
      .toEqual(EXPECTED[stage].sort());
  });
});

describe("each stage carries its declared fragments, in order", () => {
  it.each(stageNames)("%s", (stage) => {
    const config = defaultConfig({ minimalism: { mode: "full" } });
    const declared = STAGES[stage].fragments({ config, worktreeHas: () => true });
    const out = compose({
      stage,
      config,
      values: dummyValues(stage),
      worktreeHas: () => true,
    });

    let cursor = out.indexOf("\n---\n") + 5; // past the frontmatter
    for (const fragment of declared) {
      const text = typeof fragment === "string" ? fragmentBody(fragment) : fragment.text;
      const at = out.indexOf(text, cursor);
      expect(at, `${stage}: ${typeof fragment === "string" ? fragment : "rendered role table"} missing or out of order`).toBeGreaterThan(-1);
      cursor = at + text.length;
    }
  });

  it("puts sdd's rendered role table between the model map and the verification contract", () => {
    const config = defaultConfig();
    const out = compose({ stage: "sdd", config, values: dummyValues("sdd"), worktreeHas: () => false });
    const table = roleTable(config);
    expect(out.indexOf(fragmentBody("sdd-model-map.md"))).toBeLessThan(out.indexOf(table));
    expect(out.indexOf(table)).toBeLessThan(out.indexOf(fragmentBody("sdd-verification.md")));
    for (const role of ROLE_TABLE_ROLES) {
      expect(table).toContain(`| \`${role}\` | ${config.roles[role].model} | ${config.roles[role].effort} |`);
    }
  });
});

describe("the four implement-role stages do not overwrite each other", () => {
  const implementStages = ["sdd", "verify-fix", "land-conflict", "pr"];

  it("writes four distinct paths", () => {
    const paths = implementStages.map((s) => outputPath("r1", s));
    expect(new Set(paths).size).toBe(4);
  });

  it("still names autopilot-implement in every one of them", () => {
    const config = defaultConfig();
    for (const stage of implementStages) {
      const out = composeStage(stage);
      expect(out).toContain("name: autopilot-implement");
      expect(out).toContain(`model: ${config.roles.implement.model}`);
      expect(out).toContain(`effort: ${config.roles.implement.effort}`);
    }
  });
});

describe("minimalism mode off is byte-identical to no minimalism key", () => {
  // Strictly stronger than the prose pin it replaces: `off` is the default, and
  // the promise is that a default run's prompt is exactly the prompt composed
  // before the key existed.
  it.each(["plan", "sdd"])("%s", (stage) => {
    expect(composeStage(stage, { minimalism: { mode: "off" } }))
      .toBe(composeStage(stage, { minimalism: null }));
  });
});

describe("SKILL.md routes every dispatch through the script", () => {
  const sources = {
    "SKILL.md": skill,
    "references/stages/verify-run.md": readFileSync(VERIFY_RUN_PATH, "utf8"),
    "autopilot-github/SKILL.md": readFileSync(GITHUB_SKILL_PATH, "utf8"),
  };

  /** Every `autopilot-dispatch.mjs <stage> ...` invocation, with its flags. */
  function invocations(text) {
    const found = [];
    for (const m of text.matchAll(
      /autopilot-dispatch\.mjs"?\s+([a-z][a-z-]*)((?:[^\n]*\\\n)*[^\n]*)/g,
    )) {
      found.push({
        stage: m[1],
        flags: [...m[2].matchAll(/--([a-z][a-z-]*)=/g)].map((f) => f[1].replace(/-/g, "_")),
      });
    }
    return found;
  }

  const all = Object.values(sources).flatMap(invocations);

  it("no stage section composes a prompt by hand", () => {
    // AC3: the heredoc recipe and the fragment `cat`s are what made the
    // orchestrator hold each prompt. Their absence is the change.
    expect(skill).not.toContain("references/dispatch/");
    expect(skill).not.toMatch(/cat >>? "\$A"/);
    expect(skill).not.toMatch(/^A=\.superpowers/m);
  });

  it("invokes every dispatched stage at least once", () => {
    const invoked = new Set(all.map((i) => i.stage));
    expect([...stageNames].filter((s) => !invoked.has(s))).toEqual([]);
  });

  it("invokes no stage the script does not know", () => {
    expect(all.map((i) => i.stage).filter((s) => !(s in STAGES))).toEqual([]);
  });

  // Beyond run/config/worktree (legitimate for every stage — every stage's
  // body template has a `{{worktree}}` placeholder, and `run`/`config` are
  // dispatch-universal), a RESERVED flag gates a fragment rather than filling
  // a placeholder — and only the stage that reads it may carry it. This must
  // stay narrow: it is what catches a reserved flag drifting onto a stage
  // that never gates on it.
  const GATED_FLAGS = { plan: ["tier"], sdd: ["tasks"] };

  it("passes exactly the flags each stage's template consumes", () => {
    // The seam no single file exposes: a flag the template does not consume is
    // a value that never reaches the agent, and the script errors on it — so a
    // drift here parks every run of that stage.
    for (const { stage, flags } of all) {
      const expected = new Set(placeholdersIn(readFragment(STAGES[stage].body)));
      expected.add("run");
      expected.add("config");
      expected.add("host");
      const passed = new Set(flags);
      expect([...expected].filter((f) => !passed.has(f)), `${stage}: flags not passed`).toEqual([]);
      const stageMayCarry = (f) => expected.has(f) || (GATED_FLAGS[stage] ?? []).includes(f);
      expect(
        [...passed].filter((f) => !stageMayCarry(f)),
        `${stage}: flags that fill nothing`,
      ).toEqual([]);
    }
  });
});

describe("every ledger prefix nextStage matches still appears in SKILL.md", () => {
  // autopilot-ledger-coupling.test.mjs pins `nextStage` against hand-written
  // ledger strings, so it cannot catch SKILL.md dropping a line. This reads
  // the prefixes out of `nextStage`'s own source, so adding one there without
  // documenting it fails here too.
  const source = readFileSync(LEDGER_PATH, "utf8");
  const prefixes = [...source.matchAll(/has\("([^"]+)"\)/g)].map((m) => m[1]);

  it("finds the ten prefixes in nextStage's source", () => {
    expect(prefixes).toHaveLength(9); // `started (phase 1)` is the `return "phase1"` default
    expect(prefixes).toContain("sdd complete");
    expect(prefixes).toContain("learnings committed");
  });

  it.each(["started (phase 1)", "PARKED"])("%s appears verbatim", (literal) => {
    expect(skill).toContain(literal);
  });

  it.each([
    "pr:", "rebase clean", "learnings committed", "sdd complete",
    "plan complete", "spec committed", "worktree:", "design approved",
  ])("%s appears verbatim", (prefix) => {
    expect(skill).toContain(prefix);
  });

  it("keeps both full verify ledger lines, since the bare prefix is too weak to fail", () => {
    // `has("verify")` matches the word anywhere, so asserting "verify" proves
    // nothing. The two lines the stage actually appends are what must survive.
    expect(skill).toContain("verify: <n>/<n> ui criteria passed");
    expect(skill).toContain("verify: skipped (no ui criteria)");
  });

  it("asserts every prefix nextStage reads, not a stale hand-copied list", () => {
    const documented = prefixes.filter((p) => skill.includes(p));
    expect(documented).toEqual(prefixes);
  });
});
