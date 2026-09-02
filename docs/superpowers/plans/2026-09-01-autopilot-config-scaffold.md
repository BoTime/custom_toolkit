# Autopilot Config Scaffold Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When `/autopilot` preflight finds no project config file, write the selected host's full shipped defaults (led by an empty `test_command`) to that file and stop the run so the developer can fill it in.

**Architecture:** One new exported function, `scaffoldConfig`, in the existing config module, with injectable `readFile`/`writeFile`/`exists` exactly as `loadConfig` injects `readFile`. Its only caller is a `node -e` one-liner added to preflight step 4 of the autopilot skill, guarded by "if `<config>` is absent". The shipped defaults file is the template; nothing new is introduced under `plugins/autopilot/`.

**Tech Stack:** Node ESM (`.mjs`), `node:fs`, vitest (`npm test` runs `vitest run` from the repo root).

**Spec:** `docs/superpowers/specs/2026-09-01-autopilot-config-scaffold-design.md`

## Global Constraints

- Never hand-edit a version field and never assert a version literal in any test (`CLAUDE.md`; spec AC6).
- `scaffoldConfig` never overwrites an existing file, even a malformed one — it throws naming the path (spec, Error handling).
- No merging, no interpretation, no validation on write; the shipped defaults are already valid (spec, Scaffold function).
- The written JSON is two-space-indented with a trailing newline, `test_command: ""` is the first key, and the remaining keys keep the shipped file's order (spec AC1).
- Scope of the prose change is the `/autopilot` preflight only. `/autopilot-github` inherits it by handing off; `/autopilot-findings` and `loadConfig` are unchanged (spec, Preflight change).
- Contract tests read `SKILL.md` and assert phrases; per `docs/autopilot/learnings.md`, whitespace is normalised before matching so line wrapping cannot break an assertion.

## File Structure

- Modify: `plugins/autopilot/scripts/autopilot-config.mjs` — add `scaffoldConfig` after `loadConfig`; widen the `node:fs` import to include `existsSync` and `writeFileSync`.
- Modify: `plugins/autopilot/scripts/autopilot-config.test.mjs` — import `scaffoldConfig` and `hostDefaultsPath`; append a `describe("scaffoldConfig")` block (AC1–AC4).
- Create: `plugins/autopilot/scripts/autopilot-config-scaffold-contract.test.mjs` — reads the autopilot `SKILL.md` and asserts step 4's scaffold instruction (AC5). Sits beside the ten existing `autopilot-*-contract.test.mjs` files and copies their pattern.
- Modify: `plugins/autopilot/skills/autopilot/SKILL.md:92-109` — preflight step 4 gains the absent-config branch before the validate command; the trailing "runs on that host's defaults" sentence is rewritten.
- Modify: `README.md:70-76` — the "Configuration" paragraph gains one sentence saying a first plain `/autopilot` run scaffolds the file and stops. The README is the only user-facing doc that describes the no-config case; leaving it unchanged would leave it describing behaviour the skill no longer has.

Nothing else in the repo asserts or restates the sentence being rewritten (checked: `grep -rn "host's defaults\|no config file" README.md plugins/ docs/autopilot` hits only `SKILL.md:109`).

## Seams no single diff hides

All of this change is one task, so per-task review sees every seam. The two values that cross a boundary are named here anyway:

- The `node -e` one-liner in `SKILL.md` calls `m.scaffoldConfig(process.argv[2],{host:process.argv[3]})`. The function's signature is `scaffoldConfig(path, { host, readFile, writeFile, exists })`; the one-liner passes only `path` and `host`, so the `node:fs` defaults are what run in production. The contract test pins that exact call text, and the unit tests pin the signature.
- A throw inside the `.then` callback rejects the promise; Node exits non-zero on an unhandled rejection and prints the error, so an "already exists" or unwritable-directory failure stops preflight like any other non-zero exit. No extra handling is needed in the one-liner.

---

### Task 1: `scaffoldConfig`, its preflight caller, and the tests that pin both

**Files:**
- Modify: `plugins/autopilot/scripts/autopilot-config.mjs:1` (import) and append after `loadConfig` (end of file)
- Modify: `plugins/autopilot/scripts/autopilot-config.test.mjs:1-9` (imports) and append at end of file
- Create: `plugins/autopilot/scripts/autopilot-config-scaffold-contract.test.mjs`
- Modify: `plugins/autopilot/skills/autopilot/SKILL.md:92-109`
- Modify: `README.md:70-76`

**Interfaces:**
- Consumes: `hostDefaultsPath(host)` from `./autopilot-host.mjs` (already imported in `autopilot-config.mjs`; throws `unknown host "<host>" (expected one of claude, codex)` via `assertHost`). `loadConfig(path, env, readFile, defaultsPath, { host })` for the round-trip test.
- Produces: `export function scaffoldConfig(path, { host = "claude", readFile, writeFile, exists } = {}) => path`. Throws `Error(`${path} already exists — refusing to overwrite it`)` when `exists(path)` is true.

- [ ] **Step 1: Write the failing unit tests**

Edit the import block at the top of `plugins/autopilot/scripts/autopilot-config.test.mjs` so it reads:

```js
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
```

Append this block at the end of the same file:

```js
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
```

- [ ] **Step 2: Run the unit tests to verify they fail**

Run from the repository root: `npx vitest run plugins/autopilot/scripts/autopilot-config.test.mjs -t scaffoldConfig`

Expected: FAIL — the import of `scaffoldConfig` resolves to `undefined`, so every test in the block throws `scaffoldConfig is not a function`. (If vitest instead reports a SyntaxError on the import line, that is also the expected RED: the export does not exist yet.)

- [ ] **Step 3: Implement `scaffoldConfig`**

In `plugins/autopilot/scripts/autopilot-config.mjs`, change line 1 from

```js
import { readFileSync } from "node:fs";
```

to

```js
import { existsSync, readFileSync, writeFileSync } from "node:fs";
```

Append at the end of the file, after `loadConfig`:

```js
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
  const defaults = JSON.parse(readFile(defaultsPath));
  if (!defaults || typeof defaults !== "object" || Array.isArray(defaults)) {
    throw new Error(
      `${defaultsPath} is not a JSON object — the plugin install is incomplete`,
    );
  }
  writeFile(path, `${JSON.stringify({ test_command: "", ...defaults }, null, 2)}\n`);
  return path;
}
```

- [ ] **Step 4: Run the unit tests to verify they pass**

Run: `npx vitest run plugins/autopilot/scripts/autopilot-config.test.mjs`

Expected: PASS, every test in the file including the seven new `scaffoldConfig` tests. Quote the summary line (`Tests  N passed`) in your report.

- [ ] **Step 5: Write the failing contract test**

Create `plugins/autopilot/scripts/autopilot-config-scaffold-contract.test.mjs`:

```js
// Preflight step 4's scaffold branch reaches the agent entirely as prose.
// Nothing else fails if it is deleted or reworded past recognition — the run
// just validates against plugin defaults and starts the brainstorm, which is
// exactly the behaviour the scaffold exists to replace. These assertions read
// the real SKILL.md the way the other autopilot-*-contract tests do.
//
// Whitespace is normalised before matching so a line wrap inside a sentence
// cannot turn a live assertion into a dead one.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, it, expect } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const SKILL_PATH = join(HERE, "..", "skills", "autopilot", "SKILL.md");

const skill = readFileSync(SKILL_PATH, "utf8").replace(/\s+/g, " ");

const SCAFFOLD_CALL = "m.scaffoldConfig(process.argv[2],{host:process.argv[3]})";
const VALIDATE_CALL = "m.loadConfig(process.argv[2],process.env,undefined,undefined,{host:process.argv[3]})";

describe("preflight step 4 scaffolds an absent config", () => {
  it("calls scaffoldConfig for the selected host when <config> is absent", () => {
    // AC5
    expect(skill).toContain("If `<config>` is absent, scaffold it");
    expect(skill).toContain(SCAFFOLD_CALL);
    expect(skill).toContain(`${SCAFFOLD_CALL}))" "$AP" "<config>" "<host>"`);
  });

  it("runs the scaffold branch before the validate command", () => {
    // AC5 — the order is the guard: validating first would report
    // "ok (plugin defaults)" and the scaffold would never run.
    expect(skill.indexOf(SCAFFOLD_CALL)).toBeGreaterThan(-1);
    expect(skill.indexOf(SCAFFOLD_CALL)).toBeLessThan(skill.indexOf(VALIDATE_CALL));
  });

  it("reports the created path and the test_command instruction, then stops", () => {
    // AC5
    expect(skill).toContain("report the created path");
    expect(skill).toContain("`test_command` must be filled in before rerunning `/autopilot`");
    expect(skill).toContain("stop the run — do not start the brainstorm");
    expect(skill).toContain("The file is left uncommitted on the current branch");
  });

  it("no longer says a project with no config file runs on the host's defaults", () => {
    // AC5 — the old trailing sentence contradicts the new branch.
    expect(skill).not.toContain("A project with no config file runs on that host's defaults.");
    expect(skill).toContain("scaffolds it from those defaults and stops instead of running on them");
  });
});
```

- [ ] **Step 6: Run the contract test to verify it fails**

Run: `npx vitest run plugins/autopilot/scripts/autopilot-config-scaffold-contract.test.mjs`

Expected: FAIL — 4 tests fail. The first three fail because `SCAFFOLD_CALL` and the quoted sentences are not yet in `SKILL.md`; the fourth fails on `not.toContain` because the old sentence is still present.

- [ ] **Step 7: Rewrite preflight step 4 in `SKILL.md`**

In `plugins/autopilot/skills/autopilot/SKILL.md`, replace lines 92–109 — everything from the line beginning `4. **Config is valid.**` through the line `   A project with no config file runs on that host's defaults.` inclusive — with the following. Line 110 (`5. **Repository preconditions.**`) is untouched. Keep the three-space continuation indent the list already uses.

````markdown
4. **Config is valid.** From the repository root, substitute the selected
   literals for `<config>` and `<host>` in both commands below.

   First check whether `<config>` exists. If `<config>` is absent, scaffold it
   from the selected host's shipped defaults:

   ```bash
   AP="<plugin root>" && node -e "const{pathToFileURL}=require('node:url');import(pathToFileURL(process.argv[1]+'/scripts/autopilot-config.mjs').href).then(m=>console.log('created',m.scaffoldConfig(process.argv[2],{host:process.argv[3]})))" "$AP" "<config>" "<host>"
   ```

   Then report the created path, say that `test_command` must be filled in
   before rerunning `/autopilot`, and stop the run — do not start the
   brainstorm. The file is left uncommitted on the current branch; committing
   it is the developer's decision. A non-zero exit here (the directory is
   unwritable, or the file appeared between the check and the write) is a
   preflight failure like any other: report the error and stop.

   If `<config>` exists, validate it:

   ```bash
   AP="<plugin root>" && node -e "const{pathToFileURL}=require('node:url');import(pathToFileURL(process.argv[1]+'/scripts/autopilot-config.mjs').href).then(m=>{const r=m.loadConfig(process.argv[2],process.env,undefined,undefined,{host:process.argv[3]});r.warnings.forEach(w=>console.log('warning:',w));console.log(r.usedProjectConfig?'ok (project config)':'ok (plugin defaults)')})" "$AP" "<config>" "<host>"
   ```

   Report any warning. Two matter especially:

   - **`test_command` not set** — `land` will park instead of reporting tests
     green. Say so plainly before starting the brainstorm; the fix is one key
     in the selected `<config>` file.
   - `CLAUDE_CODE_EFFORT_LEVEL` on Claude or `CODEX_REASONING_EFFORT` on Codex
     overrides every configured effort level.

   Config is the selected host's shipped defaults with the project's
   `<config>` layered over them, merged per key (and per role within `roles`).
   A plain `/autopilot` run in a project with no `<config>` file scaffolds it
   from those defaults and stops instead of running on them; the project pins
   those values from then on.
````

Two things to preserve exactly, because the contract test pins them after whitespace normalisation: the scaffold `node -e` line must contain `m.scaffoldConfig(process.argv[2],{host:process.argv[3]})` and end with `"$AP" "<config>" "<host>"`; and the sentence `stop the run — do not start the brainstorm` uses an em dash (U+2014), matching the em dashes already in this file.

- [ ] **Step 8: Run the contract test to verify it passes**

Run: `npx vitest run plugins/autopilot/scripts/autopilot-config-scaffold-contract.test.mjs`

Expected: PASS, 4 tests.

- [ ] **Step 9: Update the README's Configuration paragraph**

In `README.md`, the paragraph under `#### Configuration` currently ends with:

```markdown
is per key, and per role within `roles` — so overriding one role's model
leaves its effort and the other roles intact.
```

Change it to:

```markdown
is per key, and per role within `roles` — so overriding one role's model
leaves its effort and the other roles intact. A first plain `/autopilot` run
in a project with no config file writes that host's full defaults to the file,
with an empty `test_command` to fill in, and stops; the project pins those
values from then on until you edit them.
```

- [ ] **Step 10: Run the whole suite**

Run from the repository root: `npm test`

Expected: PASS with zero failures. Quote the `Test Files` and `Tests` summary lines in your report. If any pre-existing contract test fails on the `SKILL.md` edit, do not loosen that test — report the failing assertion and stop; the prose in Step 7 is the contract and the plan governs its wording.

Also confirm no version literal was introduced: `git diff --cached --stat` (after Step 11's `git add`) must not touch `package.json`, `package-lock.json`, `.claude-plugin/marketplace.json`, or `plugins/autopilot/.claude-plugin/plugin.json`, and `grep -n 'version' plugins/autopilot/scripts/autopilot-config.test.mjs plugins/autopilot/scripts/autopilot-config-scaffold-contract.test.mjs` must print nothing.

- [ ] **Step 11: Commit**

```bash
git add plugins/autopilot/scripts/autopilot-config.mjs \
        plugins/autopilot/scripts/autopilot-config.test.mjs \
        plugins/autopilot/scripts/autopilot-config-scaffold-contract.test.mjs \
        plugins/autopilot/skills/autopilot/SKILL.md \
        README.md
git commit -m "feat(autopilot): scaffold the project config from plugin defaults at preflight

When /autopilot finds no <config> file, preflight step 4 now writes the
selected host's full shipped defaults to it, led by an empty test_command,
and stops the run so the developer can fill it in. scaffoldConfig never
overwrites an existing file. loadConfig and /autopilot-findings are
unchanged and still run on plugin defaults when the file is absent.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MjGgdkaHwXKpCUCmBSPNiN"
```

---

## Self-review against the spec

- **AC1** — unit tests "writes the Claude defaults behind a leading empty test_command, in shipped order" and "writes two-space-indented JSON ending in exactly one newline".
- **AC2** — "reads and writes the Codex defaults on host codex" (asserts the read path is the codex defaults path) and "throws the assertHost error for an unknown host and writes nothing".
- **AC3** — "refuses to overwrite an existing file, naming the path, and never calls writeFile".
- **AC4** — "round-trips through loadConfig with ok and exactly the test_command warning".
- **AC5** — Step 7 prose; the four contract-test cases pin the scaffold call, its position before the validate call, the report-and-stop sentences, and the removal of the old trailing sentence.
- **AC6** — Step 10 runs `npm test` and checks for version literals; the plan adds none.
- Spec's "Error handling" — unwritable directory: the one-liner surfaces the `writeFileSync` error as a rejected promise and non-zero exit; the Step 7 prose names that as a preflight failure. Malformed existing file: `exists` is checked before anything is read, so a malformed file is never parsed and never overwritten.
- Type consistency: `scaffoldConfig(path, { host, readFile, writeFile, exists })` is the signature used in the implementation, every unit test, and (with only `host`) the `SKILL.md` one-liner.
- Minimalism ladder: no abstraction with one consumer was introduced; the shipped defaults file is the template, as the spec requires. The shape guard on the parsed defaults is the one addition beyond the spec's letter, taken from `learnings.md` ("shape guards on anything parsed") and pinned by its own test.
