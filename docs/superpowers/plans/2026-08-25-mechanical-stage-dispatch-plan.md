# Mechanical Stage Dispatch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add one script that composes every autopilot stage's subagent definition and prints its path, so the orchestrator dispatches by path instead of assembling prompts in its own context.

**Architecture:** A new `plugins/autopilot/scripts/autopilot-dispatch.mjs` holds a `STAGES` table mapping each of eight dispatched stages to a role, a body template under `references/dispatch/<stage>-body.md`, and the contract fragments it carries. It reads merged config through the existing `loadConfig`, interpolates `{{placeholder}}` values, concatenates fragments inside the node process, writes `.superpowers/autopilot/<run>/agents/<stage>.md`, and prints that one path. `SKILL.md`'s stage sections collapse to that command plus a ledger line; the five existing contract tests stop slicing SKILL.md sections and start asserting against composed output.

**Tech Stack:** Node ESM (`.mjs`), vitest, no new dependencies.

**Spec:** `docs/superpowers/specs/2026-08-25-mechanical-stage-dispatch-design.md`

## Global Constraints

- The repository **is** the autopilot plugin. Every path below is relative to the worktree root.
- **No test asserts a version literal** (per `CLAUDE.md`). `scripts/bump-version.mjs` owns the version digits.
- **No new configuration key**, and no change to `plugins/autopilot/autopilot.default.json`.
- **No change** to the stage graph, the ledger format, `nextStage`, or any parking condition.
- **No change to the fragment files issue #27 extracted.** The nine existing files in `plugins/autopilot/skills/autopilot/references/dispatch/` are read as-is, byte for byte: `learnings.md`, `plan-budget.md`, `plan-learnings.md`, `plan-minimalism-full.md`, `plan-minimalism-lite.md`, `sdd-findings.md`, `sdd-minimalism-full.md`, `sdd-minimalism-lite.md`, `sdd-model-map.md`, `sdd-verification.md`, `spec-criteria.md`, `verify-browser.md`.
- **`resolveReferences` stays in `skill-sections.mjs`.** Removing it is out of scope.
- Module shape for the new script matches `autopilot-land.mjs` and `autopilot-verify.mjs`: exported pure functions, an exported `main(argv)`, injectable readers, and the guard `if (import.meta.url === pathToFileURL(process.argv[1]).href)` — `pathToFileURL`, never a `file://` template.
- One non-zero exit code (`1`) for every failure. No taxonomy.
- The whole suite is `npm test` (vitest). No new tooling.
- **Every stage key, role, body filename, fragment order and placeholder name below is copied from the spec's tables and is the contract.** Do not rename one for readability.

### The eight dispatched stages

| Stage | Role | Body template | Fragments, in order |
|---|---|---|---|
| `spec` | `spec` | `spec-body.md` | `spec-criteria.md` |
| `plan` | `plan` | `plan-body.md` | `plan-budget.md`; `plan-minimalism-lite.md` (lite/full); `plan-minimalism-full.md` (full); `plan-learnings.md` (when the worktree has `docs/autopilot/learnings.md`) |
| `sdd` | `implement` | `sdd-body.md` | `sdd-model-map.md`; *rendered role table*; `sdd-verification.md`; `sdd-findings.md`; `sdd-minimalism-lite.md` (lite/full); `sdd-minimalism-full.md` (full) |
| `verify` | `verify` | `verify-body.md` | `verify-browser.md` |
| `verify-fix` | `implement` | `verify-fix-body.md` | — |
| `learnings` | `learnings` | `learnings-body.md` | `learnings.md` |
| `land-conflict` | `implement` | `land-conflict-body.md` | — |
| `pr` | `implement` | `pr-body.md` | — |

### The placeholders each stage's body template must use

| Stage | Placeholders |
|---|---|
| `spec` | `{{run}}`, `{{worktree}}`, `{{branch}}`, `{{spec_path}}`, `{{design}}`, `{{criteria_source}}` |
| `plan` | `{{run}}`, `{{worktree}}`, `{{spec_path}}` |
| `sdd` | `{{run}}`, `{{worktree}}`, `{{plan_path}}` |
| `verify` | `{{run}}`, `{{worktree}}`, `{{spec_path}}`, `{{verify_dir}}` |
| `verify-fix` | `{{run}}`, `{{worktree}}`, `{{failing_criteria}}`, `{{failures}}` |
| `learnings` | `{{run}}`, `{{worktree}}` |
| `land-conflict` | `{{run}}`, `{{worktree}}`, `{{base_ref}}`, `{{conflicts}}` |
| `pr` | `{{run}}`, `{{worktree}}` |

Exactly this set, no more and no fewer: a placeholder with no flag is an error, and a flag no placeholder consumes is an error, so the two tables are one contract read from both ends.

---

## File Structure

**Created**

- `plugins/autopilot/scripts/autopilot-dispatch.mjs` — the `STAGES` table, `compose`, `render`, `placeholdersIn`, `roleTable`, `main`.
- `plugins/autopilot/scripts/autopilot-dispatch.test.mjs` — unit tests, fully injected readers.
- `plugins/autopilot/scripts/autopilot-dispatch-contract.test.mjs` — composes each stage through the script against the real files.
- `plugins/autopilot/skills/autopilot/references/dispatch/{spec,plan,sdd,verify,verify-fix,learnings,land-conflict,pr}-body.md` — eight body templates.

**Modified**

- `plugins/autopilot/skills/autopilot/SKILL.md` — stage sections collapse to the dispatch command; "Composing a dispatch" loses the heredoc recipe.
- `plugins/autopilot/skills/autopilot/references/stages/verify-run.md` — its `cat verify-browser.md` block becomes the dispatch command; its agent-facing paragraphs move into `verify-body.md`.
- `plugins/autopilot/skills/autopilot-github/SKILL.md` — Delta 1a routes its instruction through a file and `--criteria-source=@<path>`.
- `plugins/autopilot/scripts/autopilot-sdd-contract.test.mjs`, `autopilot-minimalism-contract.test.mjs`, `autopilot-learnings-contract.test.mjs`, `autopilot-verify-contract.test.mjs`, `autopilot-findings-contract.test.mjs` — repointed.
- `plugins/autopilot/scripts/skill-sections.test.mjs` — the orphan-fragment check repoints at `STAGES`.

**Task decomposition, and why three**

The change is one subsystem, so the budget's low end applies. It is three tasks, not one, because Task 2 is a prose move that cannot be reviewed in the same diff as the script's logic, and Task 3's assertions cannot be written before the files they compose exist.

It is not four, because two pairs cannot be reviewed or kept green apart:

- **The body templates and the SKILL.md deletions are one move.** `skill-sections.test.mjs` asserts that no dispatch fragment's text is duplicated back into SKILL.md. Creating a template while its source prose still sits in SKILL.md reds that assertion, and deleting the prose before the template exists loses it. They land together.
- **The five repointed contract tests land with the rewrite that breaks them.** A repoint without the rewrite is unmotivated; a rewrite without the repoint is a red suite.

---

## Task 1: The dispatch script and its unit tests

**Files:**
- Create: `plugins/autopilot/scripts/autopilot-dispatch.mjs`
- Test: `plugins/autopilot/scripts/autopilot-dispatch.test.mjs`

**Interfaces:**
- Consumes: `loadConfig(path, env, readFile, defaultsPath)` from `./autopilot-config.mjs`. It returns `{ config, warnings, usedProjectConfig }` and **throws** on an invalid merged config. Its `readFile` parameter is `(path) => string` and is used for **both** the plugin defaults (`plugins/autopilot/autopilot.default.json`) and the project config, so an injected reader must answer both paths.
- Produces, for Tasks 2 and 3:
  - `STAGES` — `Record<string, { role: string, body: string, fragments: (ctx) => Array<string | { text: string }> }>`, where `ctx` is `{ config, worktreeHas }`.
  - `compose({ stage, config, values, fragmentReader, worktreeHas }) => string`
  - `render(template, values) => string`
  - `placeholdersIn(template) => string[]`
  - `roleTable(config) => string`
  - `ROLE_TABLE_ROLES` — `["implement", "implement_complex", "task_review", "re_review", "fix_escalation", "final_review"]`
  - `DISPATCH_DIR` — absolute path to `plugins/autopilot/skills/autopilot/references/dispatch`
  - `outputPath(run, stage) => string` — `.superpowers/autopilot/<run>/agents/<stage>.md`
  - `main(argv, io) => 0 | 1`

### Step 1: Write the failing unit tests

- [ ] **Step 1: Write the failing test**

Create `plugins/autopilot/scripts/autopilot-dispatch.test.mjs`:

```javascript
// autopilot-dispatch.mjs is the one thing that builds a subagent definition.
// Every assertion here is about a failure that would otherwise report success:
// a stage dispatched at a defaulted model, a placeholder left empty so the
// agent invents a path, a typo'd flag whose value never reaches the prompt.
// Readers are injected throughout — these tests never touch the filesystem, so
// they run before the body templates exist and stay independent of their text.

import { describe, it, expect } from "vitest";
import {
  STAGES,
  ROLE_TABLE_ROLES,
  compose,
  render,
  placeholdersIn,
  roleTable,
  outputPath,
  main,
} from "./autopilot-dispatch.mjs";

/** A merged config shaped like loadConfig's output, with every role present. */
function makeConfig(overrides = {}) {
  const roles = {};
  for (const role of [
    "brainstorm", "spec", "plan", "learnings", "verify", "implement",
    "implement_complex", "task_review", "re_review", "final_review",
    "fix_escalation",
  ]) {
    roles[role] = { model: `model-${role}`, effort: "high" };
  }
  return { roles, worktree_dir: ".claude/worktrees", base_ref: "origin/main",
    reaper: true, findings_threshold: 2, ...overrides };
}

/** A fragment reader that returns a marker naming the file it was asked for. */
const fakeFragments = (bodies = {}) => (rel) => {
  if (rel in bodies) return bodies[rel];
  if (rel.endsWith("-body.md")) return `BODY(${rel})`;
  return `FRAGMENT(${rel})`;
};

describe("render", () => {
  it("substitutes a placeholder by its snake_case name", () => {
    expect(render("a {{spec_path}} b", { spec_path: "docs/x.md" })).toBe("a docs/x.md b");
  });

  it("is single-pass — a substituted value is never rescanned", () => {
    // A design document containing the literal text {{run}} must reach the
    // agent unchanged rather than being expanded a second time.
    expect(render("{{design}}", { design: "see {{run}}", run: "r1" })).toBe("see {{run}}");
  });

  it("leaves a placeholder with no value in place, for compose to report", () => {
    expect(render("{{a}}", {})).toBe("{{a}}");
  });
});

describe("placeholdersIn", () => {
  it("lists each distinct placeholder once, in order of first appearance", () => {
    expect(placeholdersIn("{{b}} {{a}} {{b}}")).toEqual(["b", "a"]);
  });
});

describe("compose", () => {
  const base = {
    config: makeConfig(),
    values: { run: "r1", worktree: "/w" },
    fragmentReader: fakeFragments(),
    worktreeHas: () => false,
  };

  it("writes frontmatter naming the role, not the stage", () => {
    // The README documents PONYTAIL_SUBAGENT_MATCHER as
    // ^autopilot-(plan|implement|implement_complex)$ — a stage-keyed name
    // would silently stop matching it.
    const out = compose({ ...base, stage: "pr" });
    expect(out).toContain("name: autopilot-implement");
    expect(out).toContain("description: pr stage of an autopilot run");
  });

  it("carries the role's configured model and effort", () => {
    const config = makeConfig();
    config.roles.implement = { model: "haiku", effort: "low" };
    const out = compose({ ...base, config, stage: "pr" });
    expect(out).toContain("model: haiku");
    expect(out).toContain("effort: low");
  });

  it("names the missing roles.<role> field rather than defaulting", () => {
    const config = makeConfig();
    delete config.roles.learnings;
    expect(() => compose({ ...base, stage: "learnings", config })).toThrow(/roles\.learnings/);
  });

  it("names the missing field when a role has no model", () => {
    const config = makeConfig();
    delete config.roles.learnings.model;
    expect(() => compose({ ...base, stage: "learnings", config })).toThrow(/roles\.learnings.*model/s);
  });

  it("rejects an unknown stage, naming it and the known stages", () => {
    expect(() => compose({ ...base, stage: "deploy" })).toThrow(/deploy/);
    expect(() => compose({ ...base, stage: "deploy" })).toThrow(/land-conflict/);
  });

  it("rejects an unfilled placeholder, naming the stage, placeholder and flag", () => {
    const fragmentReader = fakeFragments({ "pr-body.md": "{{run}} {{worktree}} {{spec_path}}" });
    expect(() => compose({ ...base, stage: "pr", fragmentReader })).toThrow(/pr/);
    expect(() => compose({ ...base, stage: "pr", fragmentReader })).toThrow(/spec_path/);
    expect(() => compose({ ...base, stage: "pr", fragmentReader })).toThrow(/--spec-path/);
  });

  it("rejects a flag no placeholder consumes, naming the flag and the stage", () => {
    const values = { run: "r1", worktree: "/w", spec_path: "docs/x.md" };
    expect(() => compose({ ...base, stage: "pr", values })).toThrow(/--spec-path/);
    expect(() => compose({ ...base, stage: "pr", values })).toThrow(/pr/);
  });

  it("does not treat the reserved --run and --config as unconsumed", () => {
    const fragmentReader = fakeFragments({ "pr-body.md": "no placeholders here" });
    const values = { run: "r1", config: ".claude/autopilot.json" };
    expect(() => compose({ ...base, stage: "pr", values, fragmentReader })).not.toThrow();
  });

  it("names the fragment's relative path and the absolute path tried", () => {
    const fragmentReader = (rel) => {
      if (rel.endsWith("-body.md")) return "{{run}} {{worktree}}";
      throw new Error(`fragment references/dispatch/${rel} cannot be read at /abs/${rel}`);
    };
    expect(() => compose({ ...base, stage: "learnings", fragmentReader }))
      .toThrow(/references\/dispatch\/learnings\.md/);
    expect(() => compose({ ...base, stage: "learnings", fragmentReader }))
      .toThrow(/\/abs\/learnings\.md/);
  });

  it("orders spec's one fragment after the body", () => {
    const values = { run: "r", worktree: "/w", branch: "b", spec_path: "s",
      design: "d", criteria_source: "c" };
    const out = compose({ ...base, stage: "spec", values,
      fragmentReader: fakeFragments({ "spec-body.md": "{{run}}{{worktree}}{{branch}}{{spec_path}}{{design}}{{criteria_source}}" }) });
    expect(out.indexOf("---")).toBeLessThan(out.indexOf("FRAGMENT(spec-criteria.md)"));
  });
});

describe("the minimalism gate", () => {
  const values = { run: "r", worktree: "/w", plan_path: "p" };
  const composeSdd = (minimalism) =>
    compose({
      stage: "sdd",
      config: makeConfig(minimalism === undefined ? {} : { minimalism }),
      values,
      fragmentReader: fakeFragments({ "sdd-body.md": "{{run}}{{worktree}}{{plan_path}}" }),
      worktreeHas: () => false,
    });

  it("emits no ladder at mode off, byte-identical to no minimalism key at all", () => {
    expect(composeSdd({ mode: "off" })).toBe(composeSdd(undefined));
    expect(composeSdd({ mode: "off" })).not.toContain("minimalism");
  });

  it("appends only the lite fragment at mode lite", () => {
    const out = composeSdd({ mode: "lite" });
    expect(out).toContain("FRAGMENT(sdd-minimalism-lite.md)");
    expect(out).not.toContain("FRAGMENT(sdd-minimalism-full.md)");
  });

  it("appends lite then full at mode full — the ladder is ordered, not a set", () => {
    const out = composeSdd({ mode: "full" });
    expect(out.indexOf("FRAGMENT(sdd-minimalism-lite.md)"))
      .toBeLessThan(out.indexOf("FRAGMENT(sdd-minimalism-full.md)"));
  });
});

describe("the plan learnings gate", () => {
  const composePlan = (worktreeHas) =>
    compose({
      stage: "plan",
      config: makeConfig(),
      values: { run: "r", worktree: "/w", spec_path: "s" },
      fragmentReader: fakeFragments({ "plan-body.md": "{{run}}{{worktree}}{{spec_path}}" }),
      worktreeHas,
    });

  it("appends the learnings fragment when the worktree has the doc", () => {
    expect(composePlan((rel) => rel === "docs/autopilot/learnings.md"))
      .toContain("FRAGMENT(plan-learnings.md)");
  });

  it("omits it when the worktree does not", () => {
    expect(composePlan(() => false)).not.toContain("FRAGMENT(plan-learnings.md)");
  });
});

describe("roleTable", () => {
  it("renders the six roles' merged model and effort values", () => {
    const config = makeConfig();
    config.roles.implement = { model: "sonnet", effort: "medium" };
    const table = roleTable(config);
    expect(table).toContain("| Role | model | effort |");
    expect(table).toContain("| `implement` | sonnet | medium |");
    for (const role of ROLE_TABLE_ROLES) expect(table).toContain(`\`${role}\``);
    expect(table).not.toContain("`spec`");
  });

  it("throws naming the role when one of the six is missing from config", () => {
    const config = makeConfig();
    delete config.roles.re_review;
    expect(() => roleTable(config)).toThrow(/roles\.re_review/);
  });
});

describe("outputPath", () => {
  it("keys the file by stage, so the four implement stages do not collide", () => {
    const paths = ["sdd", "verify-fix", "land-conflict", "pr"].map((s) => outputPath("r1", s));
    expect(new Set(paths).size).toBe(4);
    expect(paths[0]).toBe(".superpowers/autopilot/r1/agents/sdd.md");
  });
});

describe("main", () => {
  /** io stub: serves config from memory, fragments from markers, captures writes. */
  function io(overrides = {}) {
    const written = [];
    const out = [];
    const errs = [];
    return {
      written, out, errs,
      deps: {
        readFile: (p) => {
          if (p.endsWith("autopilot.default.json")) return JSON.stringify(makeConfig());
          throw new Error("ENOENT");
        },
        readFragment: fakeFragments({
          "pr-body.md": "{{run}} {{worktree}}",
          "spec-body.md": "{{run}} {{worktree}} {{branch}} {{spec_path}} {{design}} {{criteria_source}}",
        }),
        exists: () => false,
        writeOut: (p, text) => written.push({ path: p, text }),
        log: (m) => out.push(m),
        err: (m) => errs.push(m),
        env: {},
        ...overrides,
      },
    };
  }

  it("prints the path and nothing else, and writes the definition there", () => {
    const t = io();
    const code = main(["pr", "--run=r1", "--worktree=/w"], t.deps);
    expect(code).toBe(0);
    expect(t.out).toEqual([".superpowers/autopilot/r1/agents/pr.md"]);
    expect(t.written).toHaveLength(1);
    expect(t.written[0].path).toBe(".superpowers/autopilot/r1/agents/pr.md");
    expect(t.written[0].text).toContain("name: autopilot-implement");
  });

  it("maps a kebab-case flag onto a snake_case placeholder", () => {
    const t = io();
    main(["spec", "--run=r1", "--worktree=/w", "--branch=b", "--spec-path=docs/x.md",
      "--design=d", "--criteria-source=c"], t.deps);
    expect(t.written[0].text).toContain("docs/x.md");
  });

  it("reads a value from a file when the flag says @path", () => {
    const t = io({
      readFile: (p) => {
        if (p.endsWith("autopilot.default.json")) return JSON.stringify(makeConfig());
        if (p === "run/design.md") return "MULTI\nLINE\n";
        throw new Error("ENOENT");
      },
    });
    main(["spec", "--run=r1", "--worktree=/w", "--branch=b", "--spec-path=s",
      "--design=@run/design.md", "--criteria-source=c"], t.deps);
    expect(t.written[0].text).toContain("MULTI\nLINE");
  });

  it("treats @@ as an escape for a value that starts with @", () => {
    const t = io();
    main(["spec", "--run=r1", "--worktree=/w", "--branch=b", "--spec-path=s",
      "--design=@@literal", "--criteria-source=c"], t.deps);
    expect(t.written[0].text).toContain("@literal");
  });

  it("names the path and the flag when an @path cannot be read", () => {
    const t = io();
    const code = main(["spec", "--run=r1", "--worktree=/w", "--branch=b", "--spec-path=s",
      "--design=@run/missing.md", "--criteria-source=c"], t.deps);
    expect(code).toBe(1);
    expect(t.errs.join("\n")).toMatch(/run\/missing\.md/);
    expect(t.errs.join("\n")).toMatch(/--design/);
  });

  it("writes nothing and prints nothing on stdout when composition fails", () => {
    const t = io();
    const code = main(["deploy", "--run=r1"], t.deps);
    expect(code).toBe(1);
    expect(t.written).toEqual([]);
    expect(t.out).toEqual([]);
    expect(t.errs.join("\n")).toMatch(/deploy/);
  });

  it("requires --run, naming it", () => {
    const t = io();
    expect(main(["pr", "--worktree=/w"], t.deps)).toBe(1);
    expect(t.errs.join("\n")).toMatch(/--run/);
  });

  it("sends config warnings to stderr, keeping stdout to one line", () => {
    const t = io();
    main(["pr", "--run=r1", "--worktree=/w"], t.deps);
    // test_command is unset in makeConfig(), so loadConfig warns.
    expect(t.errs.join("\n")).toMatch(/test_command/);
    expect(t.out).toHaveLength(1);
  });

  it("passes a worktree-relative existence check through to the plan gate", () => {
    const t = io({
      exists: (p) => p === "/w/docs/autopilot/learnings.md",
      readFragment: fakeFragments({ "plan-body.md": "{{run}} {{worktree}} {{spec_path}}" }),
    });
    main(["plan", "--run=r1", "--worktree=/w", "--spec-path=s"], t.deps);
    expect(t.written[0].text).toContain("FRAGMENT(plan-learnings.md)");
  });
});

describe("the STAGES table", () => {
  it("declares exactly the eight dispatched stages", () => {
    // Phase 1's brainstorm is a skill the orchestrator invokes in conversation,
    // not a dispatched definition; `setup` and `land` run scripts. `land`
    // appears here only through its conflict resolver.
    expect(Object.keys(STAGES).sort()).toEqual([
      "land-conflict", "learnings", "plan", "pr", "sdd", "spec", "verify", "verify-fix",
    ]);
  });

  it("names a body template per stage, keyed by stage", () => {
    for (const [stage, entry] of Object.entries(STAGES)) {
      expect(entry.body).toBe(`${stage}-body.md`);
    }
  });

  it("gives four stages the implement role", () => {
    const implementStages = Object.entries(STAGES)
      .filter(([, e]) => e.role === "implement")
      .map(([s]) => s);
    expect(implementStages.sort()).toEqual(["land-conflict", "pr", "sdd", "verify-fix"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run plugins/autopilot/scripts/autopilot-dispatch.test.mjs`
Expected: FAIL — `Failed to resolve import "./autopilot-dispatch.mjs"`.

- [ ] **Step 3: Write the script**

Create `plugins/autopilot/scripts/autopilot-dispatch.mjs`:

```javascript
// The one thing that builds a subagent definition.
//
// SKILL.md used to hand the orchestrator a heredoc recipe and ask it to
// assemble each stage's prompt itself. Assembling a prompt means holding it,
// and in practice means reading the files around it "just to check" — the
// behaviour that put a median 165k of context and 5MB of resident tool output
// into a run. This script moves the assembly into a node process: the
// orchestrator runs it, gets one path back, and dispatches by that path.
//
// Every failure below exits non-zero and writes nothing. Defaulting is never
// the fallback: a stage dispatched at the wrong model, or missing a contract,
// produces plausible work that skipped the process — the most expensive
// failure this pipeline has, because it reports success.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { loadConfig } from "./autopilot-config.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

/** Where the verbatim prompt fragments and body templates live. */
export const DISPATCH_DIR = join(
  HERE, "..", "skills", "autopilot", "references", "dispatch",
);

/**
 * The six roles the `sdd` dispatch's rendered table names, in the order SKILL.md
 * has always rendered them. SDD picks models by its own judgment and cannot
 * accept an externally supplied map, so the table is how the values reach it.
 */
export const ROLE_TABLE_ROLES = [
  "implement", "implement_complex", "task_review", "re_review",
  "fix_escalation", "final_review",
];

const laddered = (config) => ["lite", "full"].includes(config?.minimalism?.mode);
const fullLadder = (config) => config?.minimalism?.mode === "full";

/**
 * Stage -> role, body template, and the fragments it carries.
 *
 * Keyed by STAGE, not by role, which deviates from issue #25's text
 * deliberately: four stages dispatch the `implement` role, and a role-keyed
 * path would have all four overwrite each other's definitions mid-run. The
 * frontmatter `name` stays role-keyed — see composeFrontmatter.
 *
 * The recipe is JavaScript rather than config or template frontmatter because
 * the conditionals are not one uniform shape (two-value mode gates, a rendered
 * table that is not a file at all, a worktree existence check), and because a
 * project must not be able to silently drop the findings-capture or
 * verification contract from a dispatch and still report success. The
 * contracts a stage carries are not a project's choice.
 *
 * `fragments` returns entries in dispatch order. A string names a file under
 * DISPATCH_DIR; an object with a `text` key is rendered inline.
 */
export const STAGES = {
  spec: {
    role: "spec",
    body: "spec-body.md",
    fragments: () => ["spec-criteria.md"],
  },
  plan: {
    role: "plan",
    body: "plan-body.md",
    fragments: ({ config, worktreeHas }) => [
      "plan-budget.md",
      ...(laddered(config) ? ["plan-minimalism-lite.md"] : []),
      ...(fullLadder(config) ? ["plan-minimalism-full.md"] : []),
      ...(worktreeHas("docs/autopilot/learnings.md") ? ["plan-learnings.md"] : []),
    ],
  },
  sdd: {
    role: "implement",
    body: "sdd-body.md",
    fragments: ({ config }) => [
      "sdd-model-map.md",
      { text: roleTable(config) },
      "sdd-verification.md",
      "sdd-findings.md",
      ...(laddered(config) ? ["sdd-minimalism-lite.md"] : []),
      ...(fullLadder(config) ? ["sdd-minimalism-full.md"] : []),
    ],
  },
  verify: {
    role: "verify",
    body: "verify-body.md",
    fragments: () => ["verify-browser.md"],
  },
  "verify-fix": {
    role: "implement",
    body: "verify-fix-body.md",
    fragments: () => [],
  },
  learnings: {
    role: "learnings",
    body: "learnings-body.md",
    fragments: () => ["learnings.md"],
  },
  "land-conflict": {
    role: "implement",
    body: "land-conflict-body.md",
    fragments: () => [],
  },
  pr: {
    role: "implement",
    body: "pr-body.md",
    fragments: () => [],
  },
};

/** Flags that never fill a placeholder. */
const RESERVED = new Set(["run", "config"]);

const flagFor = (placeholder) => `--${placeholder.replace(/_/g, "-")}`;

/**
 * The role's merged config entry, or an error naming what is absent.
 *
 * Deliberately redundant with validateConfig, which already errors on a role
 * missing from ROLES. The guarantee has to be this script's own: a future edit
 * to ROLES must not be able to turn "role missing" into "role defaulted"
 * without failing a test.
 */
function requireRole(config, role) {
  const entry = config?.roles?.[role];
  if (!entry || typeof entry !== "object") {
    throw new Error(`roles.${role}: missing from the merged config — a dispatch cannot default its model`);
  }
  if (!entry.model) throw new Error(`roles.${role}: missing model`);
  if (!entry.effort) throw new Error(`roles.${role}: missing effort`);
  return entry;
}

/** The markdown table of the six roles' actual model and effort values. */
export function roleTable(config) {
  const rows = ROLE_TABLE_ROLES.map((role) => {
    const entry = requireRole(config, role);
    return `| \`${role}\` | ${entry.model} | ${entry.effort} |`;
  });
  return [
    "Values for this run:",
    "",
    "| Role | model | effort |",
    "|---|---|---|",
    ...rows,
  ].join("\n");
}

/** Every distinct `{{placeholder}}` in a template, in order of first appearance. */
export function placeholdersIn(template) {
  const found = [];
  for (const m of template.matchAll(/\{\{([a-z0-9_]+)\}\}/g)) {
    if (!found.includes(m[1])) found.push(m[1]);
  }
  return found;
}

/**
 * Interpolate `{{placeholder}}` markers, single-pass.
 *
 * A substituted value is inserted verbatim and never rescanned, so a design
 * document containing the literal text `{{run}}` reaches the agent unchanged
 * rather than being expanded. An unfilled placeholder is left in place;
 * `compose` reports it before this is ever called on a real dispatch.
 */
export function render(template, values) {
  return template.replace(/\{\{([a-z0-9_]+)\}\}/g, (match, key) =>
    Object.prototype.hasOwnProperty.call(values, key) ? values[key] : match,
  );
}

/** Read a fragment or body template, naming both paths when it cannot be read. */
export function readFragment(rel) {
  const path = join(DISPATCH_DIR, rel);
  try {
    return readFileSync(path, "utf8");
  } catch {
    throw new Error(
      `references/dispatch/${rel} cannot be read at ${path} — ` +
        `a dispatch that ships without its contract reports success on work that skipped the process`,
    );
  }
}

/** `.superpowers/autopilot/<run>/agents/<stage>.md` — keyed by stage. */
export const outputPath = (run, stage) =>
  `.superpowers/autopilot/${run}/agents/${stage}.md`;

/**
 * Build a stage's subagent definition. Pure: no writes, no process.exit.
 *
 * Order is frontmatter, then the rendered body, then each fragment in the
 * stage's declared order, separated by a blank line. Order is part of the
 * contract: `sdd-minimalism-lite.md` before `sdd-minimalism-full.md` is a
 * ladder, not a set.
 */
export function compose({
  stage,
  config,
  values,
  fragmentReader = readFragment,
  worktreeHas = () => false,
}) {
  const entry = STAGES[stage];
  if (!entry) {
    throw new Error(
      `unknown stage "${stage}" — known stages: ${Object.keys(STAGES).join(", ")}`,
    );
  }

  const role = requireRole(config, entry.role);
  const template = fragmentReader(entry.body);
  const placeholders = placeholdersIn(template);

  // An unfilled placeholder is an error, not an empty string: an empty
  // {{spec_path}} produces an agent told to write its spec to nowhere, which it
  // resolves by inventing a path — and the run continues, wrong, to completion.
  const missing = placeholders.filter(
    (p) => !Object.prototype.hasOwnProperty.call(values, p),
  );
  if (missing.length > 0) {
    throw new Error(
      `stage "${stage}": no value for ${missing.map((p) => `{{${p}}}`).join(", ")} — ` +
        `pass ${missing.map(flagFor).join(", ")}`,
    );
  }

  // And an unconsumed flag on the same grounds: a typo'd flag means the value
  // the orchestrator meant to pass never reached the agent.
  const unconsumed = Object.keys(values).filter(
    (k) => !placeholders.includes(k) && !RESERVED.has(k),
  );
  if (unconsumed.length > 0) {
    throw new Error(
      `stage "${stage}": ${unconsumed.map(flagFor).join(", ")} fills no placeholder in ` +
        `references/dispatch/${entry.body} — the value would never reach the agent`,
    );
  }

  const frontmatter = [
    "---",
    `name: autopilot-${entry.role}`,
    `description: ${stage} stage of an autopilot run`,
    `model: ${role.model}`,
    `effort: ${role.effort}`,
    "---",
  ].join("\n");

  const parts = [frontmatter, render(template, values)];
  for (const fragment of entry.fragments({ config, worktreeHas })) {
    parts.push(typeof fragment === "string" ? fragmentReader(fragment) : fragment.text);
  }
  return `${parts.map((p) => p.replace(/\s+$/, "")).join("\n\n")}\n`;
}

/**
 * Parse `--key=value` flags. `--key=@path` reads the value from a file, because
 * multi-line values do not survive as shell flag values and the github
 * wrapper's untrusted-input rule forbids printf-ing issue text into a command
 * at all. `--key=@@literal` escapes a value that genuinely starts with `@`.
 */
export function parseFlags(argv, readFile) {
  const values = {};
  for (const arg of argv) {
    const m = /^--([a-z0-9-]+)=([\s\S]*)$/.exec(arg);
    if (!m) throw new Error(`unrecognized argument "${arg}" — flags are --key=value`);
    const key = m[1].replace(/-/g, "_");
    let value = m[2];
    if (value.startsWith("@@")) {
      value = value.slice(1);
    } else if (value.startsWith("@")) {
      const path = value.slice(1);
      try {
        value = readFile(path).replace(/\n+$/, "");
      } catch {
        throw new Error(`--${m[1]}=@${path}: cannot read ${path}`);
      }
    }
    values[key] = value;
  }
  return values;
}

export function main(argv = process.argv.slice(2), io = {}) {
  const {
    readFile = (p) => readFileSync(p, "utf8"),
    readFragment: fragmentReader = readFragment,
    exists = existsSync,
    writeOut = (p, text) => {
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, text);
    },
    log = console.log,
    err = console.error,
    env = process.env,
  } = io;

  const [stage, ...rest] = argv;
  if (!stage || stage.startsWith("--")) {
    err("usage: autopilot-dispatch.mjs <stage> --run=<run> [--key=value ...]");
    return 1;
  }

  try {
    const values = parseFlags(rest, readFile);
    if (!values.run) throw new Error("--run=<run> is required — it names the run directory");

    const configPath = values.config ?? ".claude/autopilot.json";
    const { config, warnings } = loadConfig(configPath, env, readFile);
    for (const warning of warnings) err(`warning: ${warning}`);

    const worktree = values.worktree;
    const worktreeHas = (rel) => Boolean(worktree) && exists(join(worktree, rel));

    const text = compose({ stage, config, values, fragmentReader, worktreeHas });
    const path = outputPath(values.run, stage);
    writeOut(path, text);
    log(path);
    return 0;
  } catch (error) {
    err(error.message);
    return 1;
  }
}

// pathToFileURL rather than a `file://` template: the plugin's install path is
// user-controlled and a space in it would silently skip main().
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main();
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run plugins/autopilot/scripts/autopilot-dispatch.test.mjs`
Expected: PASS, every test.

- [ ] **Step 5: Mutation-check the three assertions that matter most**

These three guard failures that report success, so confirm each can actually fail:

1. Delete the `requireRole` `!entry` branch's `throw` and return `{}` instead — "names the missing roles.<role> field rather than defaulting" must fail. Restore.
2. Delete the `missing.length > 0` block — "rejects an unfilled placeholder" must fail. Restore.
3. Delete the `unconsumed.length > 0` block — "rejects a flag no placeholder consumes" must fail. Restore.

Run after each: `npx vitest run plugins/autopilot/scripts/autopilot-dispatch.test.mjs`

- [ ] **Step 6: Run the whole suite**

Run: `npm test`
Expected: PASS. Nothing else reads this module yet, so no existing test changes.

- [ ] **Step 7: Commit**

```bash
git add plugins/autopilot/scripts/autopilot-dispatch.mjs plugins/autopilot/scripts/autopilot-dispatch.test.mjs
git commit -m "feat(autopilot): add autopilot-dispatch.mjs, the one thing that composes a stage definition"
```

---
## Task 2: Move the stage bodies out of SKILL.md into templates

This is one task because it is one move. `skill-sections.test.mjs` asserts that
no dispatch fragment's text is duplicated back into SKILL.md, so a template
created while its source prose still sits in SKILL.md reds the suite — and the
five contract tests that slice SKILL.md sections go red the moment the prose
leaves. Templates, deletions and repoints land together.

**Files:**
- Create: `plugins/autopilot/skills/autopilot/references/dispatch/spec-body.md`
- Create: `plugins/autopilot/skills/autopilot/references/dispatch/plan-body.md`
- Create: `plugins/autopilot/skills/autopilot/references/dispatch/sdd-body.md`
- Create: `plugins/autopilot/skills/autopilot/references/dispatch/verify-body.md`
- Create: `plugins/autopilot/skills/autopilot/references/dispatch/verify-fix-body.md`
- Create: `plugins/autopilot/skills/autopilot/references/dispatch/learnings-body.md`
- Create: `plugins/autopilot/skills/autopilot/references/dispatch/land-conflict-body.md`
- Create: `plugins/autopilot/skills/autopilot/references/dispatch/pr-body.md`
- Create: `plugins/autopilot/scripts/dispatch-fixture.mjs`
- Modify: `plugins/autopilot/skills/autopilot/SKILL.md`
- Modify: `plugins/autopilot/skills/autopilot/references/stages/verify-run.md`
- Modify: `plugins/autopilot/skills/autopilot-github/SKILL.md`
- Modify: `plugins/autopilot/scripts/skill-sections.test.mjs`
- Modify: `plugins/autopilot/scripts/autopilot-sdd-contract.test.mjs`
- Modify: `plugins/autopilot/scripts/autopilot-minimalism-contract.test.mjs`
- Modify: `plugins/autopilot/scripts/autopilot-learnings-contract.test.mjs`
- Modify: `plugins/autopilot/scripts/autopilot-verify-contract.test.mjs`
- Modify: `plugins/autopilot/scripts/autopilot-findings-contract.test.mjs`

**Interfaces:**
- Consumes from Task 1: `STAGES`, `compose`, `placeholdersIn`, `readFragment` from `./autopilot-dispatch.mjs`.
- Produces for Task 3: `plugins/autopilot/scripts/dispatch-fixture.mjs` exporting `defaultConfig(overrides)`, `dummyValues(stage)` and `composeStage(stage, opts)` — the six test files that assert on composed output all go through it.

- [ ] **Step 1: Write the shared test fixture**

Six test files need the same "compose this stage against the real fragments"
helper. `skill-sections.mjs` exists for exactly this reason and is the
precedent to follow.

Create `plugins/autopilot/scripts/dispatch-fixture.mjs`:

```javascript
// Composing a stage definition against the real files, for the tests that
// assert what a dispatch actually carries.
//
// Six test files need this. `skill-sections.mjs` was extracted when six test
// files had independently grown the same SKILL.md slicer; this is the same
// extraction for its successor. It is not production code — nothing under
// `main()` imports it — but it is not a test file either, so it lives here
// beside the module it exercises.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { STAGES, compose, placeholdersIn, readFragment } from "./autopilot-dispatch.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULTS_PATH = join(HERE, "..", "autopilot.default.json");

/**
 * The plugin's shipped defaults, optionally with the `minimalism` block
 * replaced or removed. `minimalism: null` deletes the key entirely — which is
 * how the byte-identity pin builds a config that predates the key.
 */
export function defaultConfig({ minimalism } = {}) {
  const config = JSON.parse(readFileSync(DEFAULTS_PATH, "utf8"));
  if (minimalism === null) delete config.minimalism;
  else if (minimalism !== undefined) config.minimalism = minimalism;
  return config;
}

/**
 * A value for every placeholder the stage's body template declares, derived
 * from the template itself so a new placeholder cannot silently go unfilled.
 * Values are `<name>` markers, distinguishable in an assertion failure.
 */
export function dummyValues(stage) {
  const template = readFragment(STAGES[stage].body);
  return Object.fromEntries(placeholdersIn(template).map((p) => [p, `<${p}>`]));
}

/**
 * The stage's composed definition, exactly as a dispatch would carry it.
 *
 * `hasLearnings` answers the `plan` stage's worktree check; it defaults to
 * true so assertions about the learnings instruction see it.
 */
export function composeStage(stage, { minimalism, hasLearnings = true } = {}) {
  return compose({
    stage,
    config: defaultConfig({ minimalism }),
    values: dummyValues(stage),
    worktreeHas: () => hasLearnings,
  });
}

/** Collapse whitespace — these files are hard-wrapped, so a phrase straddles lines. */
export const unwrap = (s) => s.replace(/\s+/g, " ");
```

- [ ] **Step 2: Write the eight body templates**

Each template is the **agent-facing half** of its SKILL.md stage section,
transcribed rather than rewritten. Orchestrator-facing prose — ledger lines,
outcome tables, park conditions, gates about whether to run at all — stays in
SKILL.md and is not copied here.

Every template must use exactly the placeholders its row in the Global
Constraints table lists, and no others.

Create `plugins/autopilot/skills/autopilot/references/dispatch/spec-body.md`:

````markdown
SPEC STAGE — write the approved design into a spec file inside the worktree and
commit it. This is the run's first commit.

Run: {{run}}
Worktree (work only here): {{worktree}}
Branch: {{branch}}
Spec path: {{spec_path}}

{{criteria_source}}

Write the spec to `{{spec_path}}` **inside the worktree** and commit it there.
Do not write it into the main checkout, and do not open a pull request.

Harness note: the Write tool is blocked in this worktree. Use Bash heredocs
(`cat > path <<'EOF'`) to create files.

The approved design this spec must carry:

{{design}}

Return one line: the spec path. Do not paste the spec back.
````

Create `plugins/autopilot/skills/autopilot/references/dispatch/plan-body.md`:

````markdown
PLAN STAGE — invoke `superpowers:writing-plans` against the approved spec and
return the plan path plus the task count.

Run: {{run}}
Worktree (work only here): {{worktree}}
Approved spec: {{spec_path}}

Read the spec first. It is the authority on what to build; do not redesign it.

Answer `writing-plans`' execution-choice question with `subagent-driven` — do
not ask.

Harness note: the Write tool is blocked in this worktree. Use Bash heredocs
(`cat > path <<'EOF'`) to create files.

Return under 15 lines: the plan path and the number of tasks. Do not paste the
plan back.
````

Create `plugins/autopilot/skills/autopilot/references/dispatch/sdd-body.md`:

````markdown
SDD STAGE — run `superpowers:subagent-driven-development` against the plan.

Run: {{run}}
Worktree (work only here): {{worktree}}
Plan: {{plan_path}}

Answer these gates from this prompt rather than asking — the run is unattended:

| Gate | Answer |
|---|---|
| `writing-plans` execution choice | `subagent-driven` |
| SDD pre-flight plan-conflict scan | Resolve; report each resolution in your final line |
| SDD plan-vs-review contradiction | Plan governs; report it |

A load-bearing finding that survives the round-5 breaker is the one thing you
do not answer yourself: report BLOCKED and stop.

Return one line:
`sdd complete (<n> tasks, <k> parked, <f> fix rounds across <t> tasks)` — for
example `sdd complete (10 tasks, 0 parked, 7 fix rounds across 4 tasks)`. Count
a fix round every time a task returns to its implementer after a review
finding; `<t>` is how many distinct tasks needed at least one. Without the
fix-round clause, a run where every task needed three rounds renders
identically to one where all passed first try, so a struggling run is invisible
at a glance.
````

Create `plugins/autopilot/skills/autopilot/references/dispatch/verify-body.md`:

````markdown
VERIFY STAGE — author the browser checks for this run's UI acceptance criteria.
You write the checks; the script runs them.

Run: {{run}}
Worktree (read the implementation here): {{worktree}}
Spec (the acceptance criteria to cover): {{spec_path}}
Run directory (write everything here): {{verify_dir}}

Everything you write goes to `{{verify_dir}}` in the **main checkout** —
`specs/` for the test files, `fixtures/` for mock data. Nothing is committed,
and nothing goes in the worktree. These artifacts are per-run and worth exactly
one run.

A worktree-isolated session cannot Write or Edit into the main checkout, but
**Bash redirects work**. Write spec files with `cat > <path> <<'EOF'` heredocs.

Specs import `@playwright/test` normally, even though they sit outside the
project: the script symlinks the project's `node_modules` into the run
directory so Node's upward resolution finds it. Do not work around this with
absolute import paths — if an import fails, the stage returns the
infrastructure exit and parks rather than reporting uncovered criteria.
````

Create `plugins/autopilot/skills/autopilot/references/dispatch/verify-fix-body.md`:

````markdown
VERIFY FIX ROUND — fix the UI acceptance criteria that failed browser
verification.

Run: {{run}}
Worktree (work only here): {{worktree}}

Failing criteria: {{failing_criteria}}

What the browser saw:

{{failures}}

Fix the implementation in the worktree so these criteria pass. Do not edit the
verification specs to make them pass — a check tuned to the bug verifies
nothing, and the criteria come from the committed spec, which governs.

There is exactly one fix round. If a criterion cannot be satisfied without a
design decision, say so and stop rather than guessing; a human decides.

Return one line naming what you changed.
````

Create `plugins/autopilot/skills/autopilot/references/dispatch/learnings-body.md`:

````markdown
LEARNINGS STAGE — rewrite `docs/autopilot/learnings.md` inside the worktree and
commit it to the branch.

Run: {{run}}
Worktree (work only here): {{worktree}}

Harness note: the Write tool is blocked in this worktree. Use Bash heredocs
(`cat > path <<'EOF'`) to create files.
````

Create `plugins/autopilot/skills/autopilot/references/dispatch/land-conflict-body.md`:

````markdown
LAND CONFLICT RESOLVER — resolve the rebase conflicts on this branch.

Run: {{run}}
Worktree (work only here): {{worktree}}
Rebasing onto: {{base_ref}}

Conflicted paths:

{{conflicts}}

Resolve only what you can reason about confidently: both sides independent, one
side a clear superset, import-list merges. Anything where both sides changed
the same logic, stop and report it unresolved — a guessed resolution ships a
bug that rebased clean, and a human decides those.

Do not run the test suite and do not push. The orchestrator re-runs the land
script and the project's test command after you return.

Return one line: the paths you resolved, and any you did not.
````

Create `plugins/autopilot/skills/autopilot/references/dispatch/pr-body.md`:

````markdown
PR STAGE — run `superpowers:finishing-a-development-branch` for this branch.

Run: {{run}}
Worktree (work only here): {{worktree}}

Answer its menu with option 2 — push and create a PR. It handles the push and
`gh pr create` itself; do not push by hand and do not open the PR with a raw
`gh` call.

Do not ask which option to take. This run is unattended.

Return one line: `pr: <url>`.
````

- [ ] **Step 3: Rewrite SKILL.md's "Composing a dispatch" section**

Replace the whole `### Composing a dispatch` section (SKILL.md lines 157–195,
from the heading to the line before `### The ledger`) with:

````markdown
### Composing a dispatch

You do not compose dispatches. `autopilot-dispatch.mjs` does:

```bash
node "$AP/scripts/autopilot-dispatch.mjs" <stage> \
  --run=<run> --config=.claude/autopilot.json [--key=value ...]
```

It writes `.superpowers/autopilot/<run>/agents/<stage>.md` — the subagent
definition, carrying the role's model and effort from config plus every
contract that stage owes its agent — and prints **that path and nothing else**.
Dispatch the Agent by the printed path.

The Agent tool has no `effort` parameter; frontmatter is the only way to set
it, which is why a dispatch is a file rather than a string.

Four rules:

1. **Any non-zero exit stops the run.** The message on stderr names what is
   absent — the stage, the placeholder, the flag, the fragment, the
   `roles.<role>` field. Never work around it by writing a prompt yourself: a
   stage dispatched without its contract produces plausible work that skipped
   the process, and reports success.
2. **Do not read the composed file.** The fragments travel from the plugin
   directory into the definition inside the node process, so they are never a
   tool result and cost you nothing. Reading the file spends exactly the
   context the script exists to save.
3. **Multi-line values go to a file, and the flag says `@path`.** Write the
   value into the run directory with a quoted heredoc (`cat > path <<'EOF'`),
   then pass `--key=@path`. Single-line values — paths, the run name, the
   branch — are passed inline. `--key=@@literal` escapes a value that
   genuinely starts with `@`.
4. **Flags are kebab-case; the template's placeholders are snake_case.**
   `--spec-path` fills `{{spec_path}}`. A flag no template consumes is an
   error, because the value it carried would never have reached the agent.

`$AP` is written here for readability only. Shell variables do not persist
between Bash calls, so substitute the literal path into every command you
actually run — or set it again at the top of each call.
````

- [ ] **Step 4: Collapse the six stage sections in SKILL.md**

Each stage section keeps its orchestrator-facing prose and loses the
agent-facing prose that is now a template. Replace as follows.

**`### \`spec\`** — replace the section body (keeping the heading) with:

````markdown
Dispatch the `spec` role to write the approved design into
`docs/superpowers/specs/YYYY-MM-DD-<topic>-design.md` **inside the worktree**
and commit it. This is the run's first commit.

**The spec must carry an `## Acceptance criteria` section** — the run's one
statement of what "done" means, which `verify` reads to decide what to check in
a browser and whether to open one at all.

The design is multi-line, so it goes to a file first:

```bash
cat > .superpowers/autopilot/<run>/design.md <<'EOF'
<the design the brainstorm settled>
EOF
node "$AP/scripts/autopilot-dispatch.mjs" spec \
  --run=<run> \
  --config=.claude/autopilot.json \
  --worktree=<worktree path> \
  --branch=<branch> \
  --spec-path=docs/superpowers/specs/YYYY-MM-DD-<topic>-design.md \
  --design=@.superpowers/autopilot/<run>/design.md \
  --criteria-source="The acceptance criteria for this spec come from the design settled in the brainstorm, above."
```

Dispatch by the printed path.

`/autopilot-github` seeds the criteria from the issue body, a plain
`/autopilot` from the brainstorm's design — that difference is what
`--criteria-source` carries, and nothing else in the stage changes. Either way
the spec is where they land, which is what lets `plan` and `verify` both read
one list.

Append: `spec committed → <path>`.
````

**`### \`plan\`** — replace everything from the heading down to (but not
including) the `#### Derive the verify recipe` subheading with:

````markdown
### `plan`

Dispatch the `plan` role. It invokes `superpowers:writing-plans` against the
approved spec and returns the plan path.

```bash
node "$AP/scripts/autopilot-dispatch.mjs" plan \
  --run=<run> \
  --config=.claude/autopilot.json \
  --worktree=<worktree path> \
  --spec-path=<path-to-spec>
```

Dispatch by the printed path.

Task count is the single largest driver of a run's wall-clock time, so the
composed definition carries a task-count budget. It also carries a minimalism
ladder when `minimalism.mode` is `lite` or `full`, and a learnings instruction
when the worktree has `docs/autopilot/learnings.md` — the plan agent is the one
consumer of the run's accumulated learnings, and every other stage is
deliberately learnings-free. The script reads all three conditions from merged
config and the worktree; there is nothing to gate by hand.

The plan ladder governs task decomposition only — `sdd` carries a separate
minimalism contract about how code gets written, and the two must not be
collapsed.
````

Keep `#### Derive the verify recipe` and everything after it in that section
**unchanged**, including the trailing `Append: \`plan complete → <path> (<n> tasks)\`.`

**`### \`sdd\`** — replace everything from the heading down to (but not
including) the `Append: \`sdd complete (...` line with:

````markdown
### `sdd`

Dispatch the `implement` role to run `superpowers:subagent-driven-development`
against the plan.

```bash
node "$AP/scripts/autopilot-dispatch.mjs" sdd \
  --run=<run> \
  --config=.claude/autopilot.json \
  --worktree=<worktree path> \
  --plan-path=<path-to-plan>
```

Dispatch by the printed path.

SDD picks models by its own judgment and cannot accept an externally supplied
map, so the composed definition overrides that with a literal mapping plus a
rendered table of the six roles' actual `model` and `effort` values, read from
merged config at compose time. It also carries a verification contract, which
stops the stage agent narrating its own verification into the developer's
transcript, and a findings capture contract, which stops SDD's review findings
being discarded — and a minimalism contract when `minimalism.mode` is `lite` or
`full`.

The verification contract reduces transcript noise; it does not eliminate it.
SDD's own nested dispatches still render their tool calls.

SDD reporting BLOCKED is not answered from config. It parks.
````

Keep the `Append: \`sdd complete (<n> tasks, <k> parked, <f> fix rounds across <t> tasks)\``
paragraph **unchanged**, including the sentence "Keep the `sdd complete (`
prefix exactly — `nextStage` matches it to resume the run at `verify`."

**`### \`verify\`** — leave `#### Whether to run at all`, `#### Running it` and
`#### Outcomes` structurally intact. Only the fix-round paragraph under
`#### Outcomes` changes: replace the sentence "On exit 1, dispatch the
`implement` role with the failing criteria and the summarized failures — not
the raw report — then re-run the script **with `--round=2`**:" and the code
block that follows it with:

````markdown
On exit 1, write the summarized failures — not the raw report — to a file,
compose the fix-round dispatch, dispatch by the printed path, then re-run the
script **with `--round=2`**:

```bash
cat > .superpowers/autopilot/<run>/verify/failures.md <<'EOF'
<the summarized failures>
EOF
node "$AP/scripts/autopilot-dispatch.mjs" verify-fix \
  --run=<run> \
  --config=.claude/autopilot.json \
  --worktree=<worktree path> \
  --failing-criteria="AC3, AC5" \
  --failures=@.superpowers/autopilot/<run>/verify/failures.md

node "$AP/scripts/autopilot-verify.mjs" run \
  --config=.claude/autopilot.json \
  --run-dir=.superpowers/autopilot/<run>/verify \
  --cwd=<worktree path> \
  --spec=<path-to-spec> \
  --round=2
```
````

**`### \`learnings\`** — replace the first two paragraphs (down to but not
including "A `learnings`-stage failure does not park.") with:

````markdown
Dispatch the `learnings` role to rewrite `docs/autopilot/learnings.md` inside
the worktree and commit it. This is the one artifact the pipeline both writes
and reads: `sdd` and `verify` both capture findings, the learnings role
distills them into planning rules, and the next run's `plan` stage reads the
doc.

```bash
node "$AP/scripts/autopilot-dispatch.mjs" learnings \
  --run=<run> \
  --config=.claude/autopilot.json \
  --worktree=<worktree path>
```

Dispatch by the printed path.
````

Keep the rest of the section unchanged.

**`### \`land\`** — in the `conflict` bullet, replace "dispatch the `implement`
role to resolve. It resolves only what it can reason about confidently: both
sides independent, one side a clear superset, import-list merges. Anything
where both sides changed the same logic, it parks." with:

````markdown
- `conflict` — write the conflicted paths to a file, compose the resolver, and
  dispatch by the printed path:

  ```bash
  node "$AP/scripts/autopilot-land.mjs" <base_ref> > .superpowers/autopilot/<run>/conflicts.txt
  node "$AP/scripts/autopilot-dispatch.mjs" land-conflict \
    --run=<run> \
    --config=.claude/autopilot.json \
    --worktree=<worktree path> \
    --base-ref=<config.base_ref> \
    --conflicts=@.superpowers/autopilot/<run>/conflicts.txt
  ```

  It resolves only what it can reason about confidently and reports anything
  where both sides changed the same logic as unresolved; that parks. Then
  re-run the land script to confirm clean, then run `test_command`. Only green
  continues.
````

**`### \`pr\`** — replace the first paragraph ("Dispatch the `implement` role to
run `superpowers:finishing-a-development-branch`, answering its menu with
option 2 (push and create a PR). It handles the push and `gh pr create`
itself.") with:

````markdown
```bash
node "$AP/scripts/autopilot-dispatch.mjs" pr \
  --run=<run> \
  --config=.claude/autopilot.json \
  --worktree=<worktree path>
```

Dispatch by the printed path. It runs
`superpowers:finishing-a-development-branch`, answering the menu with option 2
(push and create a PR), and handles the push and `gh pr create` itself.
````

Keep the rest of the `pr` section unchanged — the ledger-first ordering, the
timing commands, the PR-body steps and the reporting format.

- [ ] **Step 5: Rewrite the three Common Rationalizations rows**

In the `## Common Rationalizations` table, replace these two rows:

| Excuse | Reality |
|---|---|
| "I'll read the dispatch fragment to make sure it fits" | ... |
| "I'll paraphrase the contract into the prompt, it's shorter" | ... |

with these three:

````markdown
| "I'll peek at the definition before dispatching" | The script already composed it. Reading the file spends exactly the context the script exists to save, and there is nothing in it you can act on. |
| "The script errored, but I know what the prompt should say — I'll write it" | A hand-written prompt is a different contract. A stage dispatched without its contract produces plausible work that skipped the process, and reports success. |
| "I'll paraphrase the contract into the prompt, it's shorter" | You do not write the prompt. `autopilot-dispatch.mjs` does, from verbatim fragments, because their exact phrasing is what binds. |
````

- [ ] **Step 6: Edit `references/stages/verify-run.md`**

Under `## The dispatch`, replace the code block

```bash
cat "$AP/skills/autopilot/references/dispatch/verify-browser.md" >> "$A"
```

and the sentence introducing it ("The dispatch prompt carries the browser
verification contract:") with:

````markdown
Compose it and dispatch by the printed path:

```bash
node "$AP/scripts/autopilot-dispatch.mjs" verify \
  --run=<run> \
  --config=.claude/autopilot.json \
  --worktree=<worktree path> \
  --spec-path=<path-to-spec> \
  --verify-dir=.superpowers/autopilot/<run>/verify
```

The composed definition carries the browser verification contract.
````

Then **delete** the three paragraphs that now live in `verify-body.md` — the
one beginning "Everything it writes goes to", the one beginning "The same
harness constraint as the ledger applies", and the one beginning "Specs import
`@playwright/test` normally". Keep everything else: the recipe's shape and
rules, the `@playwright/test` prerequisite, the `autopilot-verify.mjs run`
invocation, and the teardown rationale.

- [ ] **Step 7: Edit `autopilot-github/SKILL.md` Delta 1a**

Replace the sentence "What this delta adds is one instruction to carry into the
`spec` dispatch:" and keep the blockquoted instruction that follows it
**unchanged, word for word**. After the blockquote, before the paragraph
beginning "The reason to pin this:", insert:

````markdown
Write it to a file in the run directory with a quoted heredoc, and pass the
file to the `spec` dispatch as `--criteria-source=@<path>` in place of
autopilot's default sentence:

```bash
cat > .superpowers/autopilot/<run>/criteria-source.md <<'EOF'
The acceptance criteria for this spec come from GitHub issue #<n>. Where the
issue states criteria — a checklist, an "acceptance criteria" heading, a
"should" list — carry every one of them into the spec's
`## Acceptance criteria` section, preserving their meaning. Where the
brainstorm settled a criterion the issue left implicit, add it. Do not drop a
stated criterion because it looks hard to verify: tag it `(non-ui)` if it is
not browser-observable, but keep it.
EOF
```

Only the issue **number** is interpolated, and only into a `<<'EOF'` heredoc,
which performs no expansion. Issue title and body text still reach the agent
only through a file the dispatch script reads — never through a shell string.
````

Change the introducing sentence to: "What this delta adds is one instruction,
carried into the `spec` dispatch in place of autopilot's default
`--criteria-source` sentence:"

- [ ] **Step 8: Repoint `skill-sections.test.mjs`'s orphan check**

The check "every fragment on disk is named by the skill or by another
reference" resolves `references/dispatch/*.md` paths out of SKILL.md — a route
that no longer exists, and one the eight new body templates were never on.
Repoint it at `STAGES`, which is now the authority on which fragments a
dispatch carries.

Replace that one `it(...)` block with:

```javascript
  it("every fragment on disk is declared by a STAGES row", () => {
    // An orphan fragment is a contract nobody dispatches — it reads as live
    // documentation while reaching no agent at all. SKILL.md no longer names
    // these files; `STAGES` does, so that is what the check follows.
    const declared = new Set();
    for (const [, entry] of Object.entries(STAGES)) {
      declared.add(entry.body);
      // Both minimalism modes and both learnings branches, so a fragment
      // reachable only under one setting is not reported as an orphan.
      for (const mode of ["off", "lite", "full"]) {
        for (const has of [true, false]) {
          const config = defaultConfig({ minimalism: { mode } });
          for (const f of entry.fragments({ config, worktreeHas: () => has })) {
            if (typeof f === "string") declared.add(f);
          }
        }
      }
    }
    const dispatchDir = join(SKILL_DIR, "references", "dispatch");
    const orphans = readdirSync(dispatchDir)
      .filter((f) => f.endsWith(".md"))
      .filter((f) => !declared.has(f));
    expect(orphans).toEqual([]);
  });
```

Add to that file's imports:

```javascript
import { STAGES } from "./autopilot-dispatch.mjs";
import { defaultConfig } from "./dispatch-fixture.mjs";
```

Leave the other three assertions in that describe block alone. "every
reference SKILL.md names can be read" still matters — SKILL.md still names
`references/stages/verify-run.md`. "the dispatch fragments are not duplicated
back into SKILL.md" still matters, and now also guards the eight new
templates. The `< 40_000` size guard still matters.

- [ ] **Step 9: Repoint the five contract tests**

Each test currently slices a SKILL.md section with
`sectionOf(readSkill(), "<stage>")` and asserts phrases inside it. The route
that made those assertions meaningful — `resolveReferences` inlining the
fragments SKILL.md names — is gone. Repoint by this rule, applied
assertion by assertion:

- An assertion whose phrase now lives in a `references/dispatch/*.md` file
  (a fragment or a body template) reads `composeStage("<stage>")` from
  `dispatch-fixture.mjs`.
- An assertion whose phrase is **orchestrator-facing** — a ledger line, an
  outcome table, a park condition, stage ordering, the run-directory rules,
  README prose — keeps reading `readSkill()` or its existing source.

To classify one, grep its phrase against both artifacts after the move:

```bash
node -e '
  import("./plugins/autopilot/scripts/dispatch-fixture.mjs").then(({composeStage})=>{
    console.log(composeStage(process.argv[1]));
  })' <stage> | grep -n "<phrase>"
grep -n "<phrase>" plugins/autopilot/skills/autopilot/SKILL.md
```

File by file:

**`autopilot-sdd-contract.test.mjs`** — replace
`const section = sectionOf(readSkill(), "sdd");` with
`const section = composeStage("sdd");` and swap the import to
`import { composeStage } from "./dispatch-fixture.mjs";`. All six assertions
match `sdd-verification.md` text and carry over unchanged. Update the header
comment: the contract now reaches the agent through `autopilot-dispatch.mjs`,
and this composes it the same way a dispatch does.

**`autopilot-findings-contract.test.mjs`** — replace
`const section = unwrap(sectionOf(skill, "sdd"));` with
`const section = unwrap(composeStage("sdd"));`. The `sdd findings-capture
contract` describe block carries over unchanged (its phrases are all in
`sdd-findings.md`). The `sdd complete records fix rounds` describe block also
carries over: all three phrases are in `sdd-body.md`. The `run directory
placement` and `plugin packaging` blocks read `whole`/other files and do not
change.

**`autopilot-learnings-contract.test.mjs`** —
- `learnings dispatch prompt` → `unwrap(composeStage("learnings"))` for the
  four assertions whose phrases live in `references/dispatch/learnings.md`:
  the corpus file and main-checkout placement, the two doc sections, the
  bounded-rewrite instruction, and the worktree/commit assertion. **Two stay on
  SKILL.md**, because their phrases are ledger prose the templates deliberately
  do not carry: `it("keeps the learnings stage inside its own section, not
  merely in the file")` (matches `/learnings committed/`) and
  `it("records the non-parking failure mode")` (matches `/does not park/` and
  `learnings failed — <reason>`). Point those two at
  `unwrap(sectionOf(skill, "learnings"))`. Verified: `learnings committed`
  appears in no fragment on disk.
- `plan dispatch prompt reads the learnings doc` → `unwrap(composeStage("plan"))`.
  All four assertions match `plan-learnings.md` and `plan-budget.md`.
- `the sdd section resumes sdd completion into verify` — the phrase
  `resume the run at \`verify\`` is orchestrator-facing and stays in SKILL.md.
  Leave it reading `sectionOf(skill, "sdd")`.
- `the resume section lists the learnings stage` reads `whole`. Unchanged.

**`autopilot-minimalism-contract.test.mjs`** —
- Delete `minimalismContract()` and `planLadder()`; the composed definition no
  longer needs slicing, because at mode `off` there is nothing to slice out.
- `sdd minimalism contract` → `const contract = composeStage("sdd", { minimalism: { mode: "full" } });`
  The content assertions (the scoping, the three excluded roles, the reason,
  the four lite rungs, the three full rungs, plan-governs, the findings
  routing) carry over unchanged. **One exception:**
  `it("grades the two modes that do emit")` matches `` /`lite`/ `` and
  `` /`full`/ ``, and those backticked words appear in **no fragment on disk** —
  only in the mode-gating prose, which now reads "when `minimalism.mode` is
  `lite` or `full`" in SKILL.md's `sdd` section. Point that one `it` at
  `sectionOf(skill, "sdd")`.
- Replace `it("emits nothing at all when the mode is off")` with the direct
  pin, which is strictly stronger than the prose it replaces:

```javascript
  it("emits no contract at all when the mode is off", () => {
    const off = composeStage("sdd", { minimalism: { mode: "off" } });
    expect(off).not.toMatch(/implementer dispatches only/i);
    expect(off).not.toMatch(/the code you never wrote/i);
  });
```

- `plan minimalism ladder` → `const ladder = composeStage("plan", { minimalism: { mode: "full" } });`
  The six rung assertions and the distinctness assertion carry over. Replace
  the two SKILL.md-shaped assertions with:

```javascript
  it("emits no ladder at all when the mode is off", () => {
    const off = composeStage("plan", { minimalism: { mode: "off" } });
    expect(off).not.toMatch(/Prefer no task/i);
    expect(off).not.toMatch(/Prefer plans that delete/i);
  });

  it("sits alongside the task-count budget in the same definition", () => {
    // Two instructions about how many tasks to plan reach the plan agent
    // together or not at all.
    expect(ladder).toMatch(/Task-count budget for this plan/);
  });
```

- The `README ponytail documentation` describe block reads `README.md`.
  Unchanged.

**`autopilot-verify-contract.test.mjs`** — this file mixes both kinds, so
classify per describe block:
- `const verify = unwrap(section(skill, "verify"));` stays, and a second
  binding is added: `const verifyPrompt = unwrap(composeStage("verify"));`
- `verify token contract` and every other block whose phrases come from
  `verify-browser.md` (rules 1–7 and the closing sentence) → `verifyPrompt`.
- `verify stage placement`, `SKILL.md <-> nextStage coupling for verify`,
  `pr stage carries the verification result`, `parking conditions include the
  verify failures`, and the recipe-shape assertions → keep reading `skill`
  / `verify`.
- `spec stage supplies the criteria verify reads` → `unwrap(composeStage("spec"))`
  for the two assertions matching `spec-criteria.md` text; the github-wrapper
  assertion reads `autopilot-github/SKILL.md` and is unchanged.
- `plan stage derives the verify recipe` → keep reading `section(skill, "plan")`;
  the recipe derivation is orchestrator-facing and stays in SKILL.md.

- [ ] **Step 10: Verify no ledger prefix was lost**

`nextStage` prefix-matches ten strings plus `PARKED`. A rewrite that reworded
one silently breaks resume detection, and nothing in the suite catches it until
Task 3. Check by hand now:

```bash
node -e '
const fs = require("node:fs");
const src = fs.readFileSync("plugins/autopilot/scripts/autopilot-ledger.mjs", "utf8");
const skill = fs.readFileSync("plugins/autopilot/skills/autopilot/SKILL.md", "utf8");
const prefixes = [...src.matchAll(/has\("([^"]+)"\)/g)].map((m) => m[1]).concat("PARKED");
const missing = prefixes.filter((p) => !skill.includes(p));
console.log(missing.length === 0 ? "all prefixes present" : "MISSING: " + missing.join(", "));
process.exitCode = missing.length === 0 ? 0 : 1;
'
```

Expected: `all prefixes present`, exit 0.

- [ ] **Step 11: Verify AC3 mechanically**

```bash
grep -n 'references/dispatch/' plugins/autopilot/skills/autopilot/SKILL.md
grep -n 'cat > "\$A"\|cat >> "\$A"\|A=\.superpowers' plugins/autopilot/skills/autopilot/SKILL.md
```

Expected: no output from either, exit 1 from both greps.

- [ ] **Step 12: Run the whole suite**

Run: `npm test`
Expected: PASS, every test.

- [ ] **Step 13: Mutation-check three repointed assertions**

A repointed assertion that now matches something incidental is worse than no
assertion. Confirm each still fails when the text it guards is deleted:

1. Delete rule 3 ("Never read a full-page DOM…") from
   `references/dispatch/verify-browser.md` — the `verify token contract`
   assertion must fail. Restore.
2. Delete the `"stage_at_fault":"plan"` example from
   `references/dispatch/sdd-minimalism-lite.md` — the findings-routing
   assertion must fail. Restore.
3. Delete the `Task-count budget for this plan` heading from
   `references/dispatch/plan-budget.md` — the "sits alongside the task-count
   budget" assertion must fail. Restore.

Run after each: `npm test`

- [ ] **Step 14: Commit**

```bash
git add -A plugins/autopilot
git commit -m "refactor(autopilot): move stage bodies into dispatch templates and route SKILL.md through the script"
```

---
## Task 3: The composition contract test

**Files:**
- Create: `plugins/autopilot/scripts/autopilot-dispatch-contract.test.mjs`

**Interfaces:**
- Consumes: `STAGES`, `ROLE_TABLE_ROLES`, `compose`, `roleTable`, `placeholdersIn`, `readFragment`, `outputPath` from `./autopilot-dispatch.mjs`; `defaultConfig`, `dummyValues`, `composeStage` from `./dispatch-fixture.mjs`; `SKILL_DIR`, `SKILL_PATH`, `readSkill` from `./skill-sections.mjs`.
- Produces: nothing consumed by a later task.

- [ ] **Step 1: Write the failing test**

Create `plugins/autopilot/scripts/autopilot-dispatch-contract.test.mjs`:

```javascript
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
      /autopilot-dispatch\.mjs\s+([a-z][a-z-]*)((?:[^\n]*\\\n)*[^\n]*)/g,
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

  it("passes exactly the flags each stage's template consumes", () => {
    // The seam no single file exposes: a flag the template does not consume is
    // a value that never reaches the agent, and the script errors on it — so a
    // drift here parks every run of that stage.
    for (const { stage, flags } of all) {
      const expected = new Set(placeholdersIn(readFragment(STAGES[stage].body)));
      expected.add("run");
      expected.add("config");
      const passed = new Set(flags);
      expect([...expected].filter((f) => !passed.has(f)), `${stage}: flags not passed`).toEqual([]);
      expect([...passed].filter((f) => !expected.has(f)), `${stage}: flags that fill nothing`).toEqual([]);
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
```

- [ ] **Step 2: Run test to verify it fails, then passes**

Run: `npx vitest run plugins/autopilot/scripts/autopilot-dispatch-contract.test.mjs`

Expected: PASS. If a fragment-order or flag assertion fails, the failure names
the stage and the fragment — fix the template or the SKILL.md command it names,
not the assertion. If `finds the ten prefixes` reports a count other than 9,
read `nextStage` and correct the number to what its source actually contains;
do not delete the assertion.

- [ ] **Step 3: Mutation-check the four load-bearing assertions**

1. Reorder `sdd-minimalism-lite.md` after `sdd-minimalism-full.md` in the
   `STAGES` table — "each stage carries its declared fragments, in order" must
   fail for `sdd`. Restore.
2. Change `name: autopilot-${entry.role}` to `name: autopilot-${stage}` in
   `compose` — "still names autopilot-implement in every one of them" must
   fail. Restore.
3. Delete `--verify-dir=...` from the `verify` command in
   `references/stages/verify-run.md` — "passes exactly the flags each stage's
   template consumes" must fail. Restore.
4. Change `verify: skipped (no ui criteria)` in SKILL.md to
   `verify skipped (no ui criteria)` — the full-verify-lines assertion must
   fail. Restore.

Run after each: `npx vitest run plugins/autopilot/scripts/autopilot-dispatch-contract.test.mjs`

- [ ] **Step 4: Run the whole suite**

Run: `npm test`
Expected: PASS, every test.

- [ ] **Step 5: Commit**

```bash
git add plugins/autopilot/scripts/autopilot-dispatch-contract.test.mjs
git commit -m "test(autopilot): compose every stage through the dispatch script and assert its contracts"
```

---

## Acceptance criteria coverage

| AC | Where it is satisfied |
|---|---|
| AC1 — writes a valid definition at `.superpowers/autopilot/<run>/agents/<stage>.md` with the role's model and effort, printing only that path | Task 1 `main` + its "prints the path and nothing else" test; Task 3 "every stage composes a valid subagent definition" |
| AC2 — exits non-zero rather than defaulting on a missing role, naming `roles.<role>` | Task 1 `requireRole` + "names the missing roles.<role> field rather than defaulting" |
| AC3 — SKILL.md routes every stage through the script, with no prompt heredoc and no fragment `cat` | Task 2 Steps 3–5 and Step 11; Task 3 "no stage section composes a prompt by hand" |
| AC4 — a contract test composes each stage and asserts its contract sections | Task 3, plus the five repointed contract tests in Task 2 Step 9 |
| AC5 — unknown stage, unfilled placeholder, unreadable fragment each exit non-zero naming what is absent, writing nothing | Task 1 `compose` + `main`'s "writes nothing and prints nothing on stdout when composition fails" |
| AC6 — the four `implement` stages write four distinct files, each still naming `autopilot-implement` | Task 1 `outputPath`; Task 3 "the four implement-role stages do not overwrite each other" |
| AC7 — `minimalism.mode: off` composes byte-identically to no `minimalism` key, for `plan` and `sdd` | Task 1 "emits no ladder at mode off"; Task 3 "minimalism mode off is byte-identical to no minimalism key" |
| AC8 — every ledger prefix `nextStage` matches survives in SKILL.md, and the ledger-coupling test stays green | Task 2 Step 10; Task 3 "every ledger prefix nextStage matches still appears in SKILL.md"; `autopilot-ledger-coupling.test.mjs` untouched |

## Known seams, named

- **Flags and placeholders are one contract read from both ends.** Task 1
  errors on both an unfilled placeholder and an unconsumed flag. Task 2's
  SKILL.md commands and Task 3's `EXPECTED` table must agree with the eight
  templates. Task 3's "passes exactly the flags each stage's template consumes"
  is what holds the three in place.
- **`skill-sections.test.mjs` breaks in Task 2, not Task 1.** Two of its
  assertions depend on SKILL.md naming the dispatch fragments; the orphan check
  is repointed at `STAGES` in Task 2 Step 8, and the duplication guard is what
  forces the templates and the SKILL.md deletions into one commit.
- **`resolveReferences` keeps one live consumer after this change** —
  `skill-sections.test.mjs`'s "every reference SKILL.md names can be read",
  which still follows `references/stages/verify-run.md`. Removing it is out of
  scope.
- **`autopilot-ledger-coupling.test.mjs` and `autopilot-github-ledger-coupling.test.mjs`
  are untouched.** They pin `nextStage` against hand-written strings and must
  stay green without edits; if one goes red, a ledger line was reworded and the
  fix is in SKILL.md, not the test.
