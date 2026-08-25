# Automatic Version Bump on Every Landing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every commit that lands on `main` automatically bumps one repo-wide version across all six version fields, with no manual step.

**Architecture:** A new root-level `scripts/bump-version.mjs` — pure exported functions plus a thin `main()` CLI, with an injected `io` object so its tests need no temp directories. It derives the bump kind from the head commit's conventional-commit message, reads the *highest* version across all six target fields (self-healing: repairs today's drift on the first run), and rewrites each version field **in place by character offset** so surrounding formatting stays byte-stable. A `version` job appended to `.github/workflows/test.yml` runs it after `test` passes and pushes a `chore(release): vX.Y.Z [skip ci]` commit back to `main`. Two guard tests pin the pieces that fail silently.

**Tech Stack:** Node 22 ESM (`.mjs`), Vitest (`npm test` → `vitest run`), GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-08-24-auto-version-bump-design.md`

## Global Constraints

- **Do not hand-bump any version field in this run.** The spec's usual "bump to X in both files" instruction is deliberately absent; shipping this design is the point at which that instruction stops applying. The current drift (`package.json` `1.0.1`, `package-lock.json` `1.0.0`, the other four `1.7.0`) is left exactly as-is and is repaired by the first automated run.
- The six target fields, in full:
  - `package.json` → `version`
  - `.claude-plugin/marketplace.json` → `metadata.version`
  - `.claude-plugin/marketplace.json` → the `plugins[]` entry with `"name": "autopilot"` → `version`
  - `plugins/autopilot/.claude-plugin/plugin.json` → `version`
  - `package-lock.json` → top-level `version`
  - `package-lock.json` → `packages[""].version`
- Locate the marketplace plugin entry by its `"name": "autopilot"`, never by array index.
- Version format is plain `X.Y.Z` everywhere. A target whose value is not plain `X.Y.Z` is an **error**, not something to parse leniently.
- `package-lock.json` has 103 `"version"` keys in 1603 lines. Only two may ever change. A rewrite that touches any dependency's version is a corruption bug — it changes what `npm ci` installs.
- Repo conventions: pure exported functions + a thin `main()` guarded by `import.meta.url === pathToFileURL(process.argv[1]).href`; colocated `*.test.mjs`; dependency injection for side effects (see `syncBase(baseRef, run)` in `plugins/autopilot/scripts/autopilot-sync-base.mjs`). No repo test uses temp directories — keep it that way by injecting `io`.
- No new npm dependencies. Vitest has no config file; its default discovery already picks up `scripts/*.test.mjs`. No config change is needed.
- Test command: `npm test`. Baseline before this plan: 297 tests across 14 files, all passing.

---

## Task decomposition note

Four tasks, inside the 3–5 budget. Task 1 is separated from the rest because a
reviewer could reasonably reject deleting a contract assertion while approving
new code, and because the deletion is load-bearing (see below) and must not get
folded into a large diff where it can be forgotten. Tasks 2 and 3 split
`bump-version.mjs` at its natural seam: Task 2 is pure string/arithmetic logic
with no notion of files; Task 3 is the file-targeting layer plus the CLI. Task 4
is the workflow and its contract test, which must move together — a workflow
with no guard test is exactly the silent-drift case the repo's `*-contract`
convention exists to prevent.

**Task 1 goes first, and is not optional cleanup.** Three assertions in
`plugins/autopilot/scripts/autopilot-findings-contract.test.mjs` hard-pin the
version at `1.7.0`. If they survive, the first automated bump pushes `1.7.1`
onto a tree whose test suite demands `1.7.0`; `main` goes permanently red, and
because the version job is gated on `needs: test`, the automation disables
itself one commit after it ships.

---

### Task 1: Delete the three version-pinning assertions

**Files:**
- Modify: `plugins/autopilot/scripts/autopilot-findings-contract.test.mjs:156-171` (delete three `it()` blocks inside `describe("plugin packaging")`)

**Interfaces:**
- Consumes: nothing.
- Produces: a test suite that no longer pins a version literal, which is the precondition for every later task. No code interface.

The suite is green today (the tree *is* at `1.7.0`), so this deletion must leave
it green — it removes three passing tests, it does not fix a failure.

Do **not** replace them with an assertion that the live tree's six version
fields agree with each other. The current tree does not satisfy that
(`package.json` is `1.0.1`, `marketplace.json` is `1.7.0`), so such a test would
fail this run's own PR CI and force exactly the manual seed commit the
max-reading design exists to avoid. The lockstep invariant moves to
`scripts/bump-version.test.mjs` in Task 3, where it becomes a property of
`writeVersion` covering all six fields instead of three.

- [ ] **Step 1: Record the current test count**

```bash
npm test 2>&1 | tail -5
```

Expected: `Tests  297 passed (297)` across 14 files. Write the number down; Step 4 checks it went down by exactly 3.

- [ ] **Step 2: Delete the three `it()` blocks**

In `plugins/autopilot/scripts/autopilot-findings-contract.test.mjs`, inside
`describe("plugin packaging", ...)`, delete these three blocks in their
entirety (lines ~156–171), including the blank lines that separated them:

```js
  it("is at version 1.7.0", () => {
    expect(pluginJson.version).toBe("1.7.0");
  });

  it("bumps the marketplace plugin entry to the same version", () => {
    const entry = marketplace.plugins.find((p) => p.name === "autopilot");
    expect(entry.version).toBe("1.7.0");
  });

  it("bumps the marketplace metadata block too", () => {
    // Two places in one file. Bumping only the plugin entry is the drift this
    // pins.
    expect(marketplace.metadata.version).toBe("1.7.0");
  });
```

Everything else in the file stays: the SKILL.md prose assertions, the
`it("registers the commands directory so the new command loads", ...)` check,
and the `it("ships the findings command", ...)` check.

- [ ] **Step 3: Leave a comment where they were**

Immediately after the `registers the commands directory` block, and before the
`ships the findings command` block, insert:

```js
  // No assertion pins the version literal here. scripts/bump-version.mjs now
  // owns the version digits and rewrites them on every landing, so a pinned
  // literal would red `main` on the first automated bump — and because the
  // version job is gated on `needs: test`, the automation would then never run
  // again. The lockstep invariant these assertions protected lives in
  // scripts/bump-version.test.mjs, over all six fields instead of three.
```

Without this, the next person to read the file sees a `plugin packaging`
describe block that suspiciously does not check the version, and puts it back.

- [ ] **Step 4: Run the suite and confirm it is green with 3 fewer tests**

```bash
npm test 2>&1 | tail -5
```

Expected: all PASS, `Tests  294 passed (294)`.

- [ ] **Step 5: Confirm no version literal survives anywhere in the test suite**

```bash
grep -rn "1\.7\.0" plugins/ .github/ 2>/dev/null | grep -v "\.claude-plugin/"
```

Expected: no output. (The two `.claude-plugin/*.json` manifests still say
`1.7.0` — that is the tree's real version, and it stays.)

- [ ] **Step 6: Commit**

```bash
git add plugins/autopilot/scripts/autopilot-findings-contract.test.mjs
git commit -m "test(autopilot): unpin the version literal from the packaging contract"
```

---

### Task 2: `bumpKind` and the semver arithmetic

**Files:**
- Create: `scripts/bump-version.mjs`
- Create: `scripts/bump-version.test.mjs`

**Interfaces:**
- Consumes: nothing.
- Produces, all from `scripts/bump-version.mjs`:
  - `bumpKind(message: string) → "major" | "minor" | "patch"` — total; never throws, never returns null.
  - `parseVersion(text: string) → { major: number, minor: number, patch: number } | null`
  - `formatVersion(v: { major, minor, patch }) → string`
  - `compareVersions(a: string, b: string) → number` — negative / 0 / positive; throws on a non-`X.Y.Z` argument.
  - `nextVersion(current: string, kind: "major"|"minor"|"patch") → string` — throws on a non-`X.Y.Z` `current`.

This task creates the file with only these five exports. Task 3 appends to the
same file; it does not modify anything written here.

- [ ] **Step 1: Write the failing tests**

Create `scripts/bump-version.test.mjs`:

```js
import { describe, it, expect } from "vitest";
import {
  bumpKind,
  parseVersion,
  formatVersion,
  compareVersions,
  nextVersion,
} from "./bump-version.mjs";

describe("bumpKind", () => {
  it("treats a plain feat as minor", () => {
    expect(bumpKind("feat: add a CSV export button")).toBe("minor");
  });

  it("treats a scoped feat as minor", () => {
    expect(bumpKind("feat(autopilot): capture SDD review findings")).toBe("minor");
  });

  it("treats a ! after the type as major", () => {
    expect(bumpKind("feat!: drop the design-approval gate")).toBe("major");
  });

  it("treats a ! after the scope as major", () => {
    expect(bumpKind("feat(autopilot)!: drop the design-approval gate")).toBe("major");
  });

  it("treats a ! on a non-feat type as major", () => {
    expect(bumpKind("fix!: stop writing the wrong lockfile field")).toBe("major");
  });

  it("treats a BREAKING CHANGE line in the body as major", () => {
    const message = [
      "fix: rename the config key",
      "",
      "BREAKING CHANGE: base_ref is now required.",
    ].join("\n");
    expect(bumpKind(message)).toBe("major");
  });

  it("accepts the hyphenated BREAKING-CHANGE spelling too", () => {
    expect(bumpKind("fix: x\n\nBREAKING-CHANGE: y")).toBe("major");
  });

  it("ignores BREAKING CHANGE prose in the subject line", () => {
    // Only a body line counts. A subject that merely mentions the phrase is
    // describing a change, not declaring one.
    expect(bumpKind("docs: explain what BREAKING CHANGE: means")).toBe("patch");
  });

  for (const type of [
    "fix", "perf", "chore", "docs", "refactor", "test", "style", "build", "ci",
  ]) {
    it(`treats ${type} as patch`, () => {
      expect(bumpKind(`${type}: some change`)).toBe("patch");
      expect(bumpKind(`${type}(autopilot): some change`)).toBe("patch");
    });
  }

  it("treats a merge commit as patch rather than skipping", () => {
    // Not hypothetical: this repo's history contains these.
    expect(bumpKind("Merge pull request #3 from BoTime/sdd-visibility")).toBe("patch");
  });

  it("treats a bare non-conventional message as patch", () => {
    expect(bumpKind("update docs")).toBe("patch");
  });

  it("treats an empty message as patch", () => {
    expect(bumpKind("")).toBe("patch");
  });

  it("is total — it never throws on odd input", () => {
    expect(bumpKind(undefined)).toBe("patch");
    expect(bumpKind("\n\n\n")).toBe("patch");
    expect(bumpKind(":")).toBe("patch");
  });

  it("does not mistake a longer type starting with feat for feat", () => {
    // `feature` is not a conventional-commit type, so it falls through.
    expect(bumpKind("feature: add a thing")).toBe("patch");
  });
});

describe("parseVersion", () => {
  it("parses a plain X.Y.Z", () => {
    expect(parseVersion("1.10.3")).toEqual({ major: 1, minor: 10, patch: 3 });
  });

  it("rejects a prerelease or build-metadata suffix", () => {
    expect(parseVersion("1.7.0-beta.1")).toBeNull();
    expect(parseVersion("1.7.0+build5")).toBeNull();
  });

  it("rejects a two-part version and surrounding junk", () => {
    expect(parseVersion("1.7")).toBeNull();
    expect(parseVersion(" 1.7.0")).toBeNull();
    expect(parseVersion("v1.7.0")).toBeNull();
  });
});

describe("formatVersion", () => {
  it("round-trips with parseVersion", () => {
    expect(formatVersion(parseVersion("2.0.9"))).toBe("2.0.9");
  });
});

describe("compareVersions", () => {
  it("compares numerically, not lexicographically", () => {
    // The whole point: "1.10.0" < "1.9.0" as strings.
    expect(compareVersions("1.10.0", "1.9.0")).toBeGreaterThan(0);
    expect(compareVersions("1.9.0", "1.10.0")).toBeLessThan(0);
  });

  it("returns 0 for equal versions", () => {
    expect(compareVersions("1.7.0", "1.7.0")).toBe(0);
  });

  it("orders by major, then minor, then patch", () => {
    expect(compareVersions("2.0.0", "1.99.99")).toBeGreaterThan(0);
    expect(compareVersions("1.7.1", "1.7.0")).toBeGreaterThan(0);
  });

  it("throws on a non-X.Y.Z argument", () => {
    expect(() => compareVersions("1.7.0-beta", "1.7.0")).toThrow(/1\.7\.0-beta/);
  });
});

describe("nextVersion", () => {
  it("increments the patch digit", () => {
    expect(nextVersion("1.7.0", "patch")).toBe("1.7.1");
  });

  it("increments the minor digit and resets patch", () => {
    expect(nextVersion("1.7.3", "minor")).toBe("1.8.0");
  });

  it("increments the major digit and resets minor and patch", () => {
    expect(nextVersion("1.7.3", "major")).toBe("2.0.0");
  });

  it("throws on a non-X.Y.Z current version", () => {
    expect(() => nextVersion("1.7", "patch")).toThrow(/1\.7/);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npx vitest run scripts/bump-version.test.mjs
```

Expected: FAIL — `Failed to resolve import "./bump-version.mjs"`.

- [ ] **Step 3: Write the minimal implementation**

Create `scripts/bump-version.mjs`:

```js
// One repo-wide version, bumped automatically on every landing. The bump kind
// comes from the head commit's conventional-commit message; the current
// version is the HIGHEST across every target field, so no field is ever moved
// backwards and today's drift repairs itself on the first run.

/**
 * The conventional-commit bump rule, plus the fallback.
 *
 * Total: every input, including "" and undefined, returns one of the three
 * kinds. It never throws and never returns null — "every landing updates the
 * version" must hold with no silent no-ops, so an unparseable message is the
 * ordinary case (patch), not an error.
 */
export function bumpKind(message) {
  const text = String(message ?? "");
  const newline = text.indexOf("\n");
  const subject = (newline === -1 ? text : text.slice(0, newline)).trim();
  const body = newline === -1 ? "" : text.slice(newline + 1);

  // A `!` after the type or scope, or a BREAKING CHANGE line in the body.
  // The body, not the subject: a subject that merely mentions the phrase is
  // describing a breaking change, not declaring one.
  if (/^[a-zA-Z]+(\([^)]*\))?!:/.test(subject)) return "major";
  if (/^BREAKING[ -]CHANGE:/m.test(body)) return "major";

  // `feat` must be the whole type — `feature:` is not a conventional type and
  // falls through to patch.
  if (/^feat(\([^)]*\))?:/i.test(subject)) return "minor";

  return "patch";
}

const VERSION_RE = /^(\d+)\.(\d+)\.(\d+)$/;

/**
 * Plain X.Y.Z only. A prerelease or build-metadata suffix returns null so the
 * caller can fail loudly — the repo uses plain X.Y.Z throughout, and parsing
 * something else leniently would let a field quietly stop being versioned.
 */
export function parseVersion(text) {
  const match = VERSION_RE.exec(String(text ?? ""));
  if (!match) return null;
  return { major: +match[1], minor: +match[2], patch: +match[3] };
}

export function formatVersion({ major, minor, patch }) {
  return `${major}.${minor}.${patch}`;
}

function requireVersion(text) {
  const parsed = parseVersion(text);
  if (!parsed) throw new Error(`"${text}" is not a plain X.Y.Z version`);
  return parsed;
}

/** Numeric and field-wise, never lexicographic: 1.10.0 is greater than 1.9.0. */
export function compareVersions(a, b) {
  const left = requireVersion(a);
  const right = requireVersion(b);
  return (
    left.major - right.major ||
    left.minor - right.minor ||
    left.patch - right.patch
  );
}

export function nextVersion(current, kind) {
  const { major, minor, patch } = requireVersion(current);
  if (kind === "major") return `${major + 1}.0.0`;
  if (kind === "minor") return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npx vitest run scripts/bump-version.test.mjs
```

Expected: PASS, all tests in the file green.

- [ ] **Step 5: Run the full suite**

```bash
npm test 2>&1 | tail -5
```

Expected: all PASS, 15 test files (the new one is picked up by vitest's default discovery with no config change).

- [ ] **Step 6: Commit**

```bash
git add scripts/bump-version.mjs scripts/bump-version.test.mjs
git commit -m "feat(version): add conventional-commit bump rule and semver math"
```

---

### Task 3: The target table, in-place rewriting, and the CLI

**Files:**
- Modify: `scripts/bump-version.mjs` (append; nothing from Task 2 changes)
- Modify: `scripts/bump-version.test.mjs` (append a second half; nothing from Task 2 changes)

**Interfaces:**
- Consumes, from Task 2: `parseVersion`, `compareVersions`, `nextVersion`, `bumpKind`.
- Produces, all from `scripts/bump-version.mjs`:
  - `TARGETS: Array<{ file: string, field: string, anchor: RegExp | null }>` — the six entries, `file` repo-relative.
  - `readVersion(content: string, target) → string` — throws naming file and field.
  - `replaceVersion(content: string, target, version: string) → string`
  - `currentVersion(targets, io) → string` — the highest across all targets.
  - `writeVersion(targets, version: string, io) → string[]` — the repo-relative paths actually written; `[]` when nothing changed.
  - `fsIo: { read(file) → string, write(file, content) → void }` — the real-filesystem `io`, resolving `file` against the repo root.
  - `main(argv = process.argv.slice(2), io = fsIo, readMessage = headCommitMessage) → void`

**The `io` seam:** every filesystem touch goes through an injected
`{ read, write }` object, mirroring `syncBase(baseRef, run)` in
`plugins/autopilot/scripts/autopilot-sync-base.mjs`. This is what lets the tests
use in-memory fixtures instead of temp directories — no repo test creates one
today, and these must not be the first.

**How a field is located.** Each target carries an optional `anchor` regex.
Locating means: find the anchor (or start at offset 0 when it is `null`), then
take the *first* `"version": "..."` after it, and rewrite only that value's
characters. Character-offset splicing, not `JSON.parse`/`JSON.stringify` — a
round-trip on `package-lock.json` would diff all 1603 lines on every landing,
burying the two-line real change in every future `git log -p` and every future
merge conflict.

The anchors, and why each one is unambiguous:

| Target | Anchor | Why it lands on the right field |
| --- | --- | --- |
| `package.json` → `version` | none | The file has exactly one `"version"` key. |
| `plugins/autopilot/.claude-plugin/plugin.json` → `version` | none | Same — one `"version"` key. |
| `package-lock.json` → top-level `version` | none | The first `"version"` in the file is the top-level one (line 3). `"lockfileVersion"` does not match: the pattern requires a quote immediately before `v`, and its `V` is capital. |
| `package-lock.json` → `packages[""].version` | `/"packages"\s*:\s*\{\s*""\s*:\s*\{/` | The root package entry is the first key inside `packages`; the next `"version"` after it is its own (line 9), not a dependency's. |
| `.claude-plugin/marketplace.json` → `metadata.version` | `/"metadata"\s*:\s*\{/` | The next `"version"` inside the metadata block. |
| `.claude-plugin/marketplace.json` → plugin entry `version` | `/"name"\s*:\s*"autopilot"/` | By name, never by index — adding a second plugin later cannot silently retarget the rewrite. The existing contract test reaches for that entry the same way. |

**Idempotence, precisely.** `writeVersion` writes a file only when its content
actually changed, and returns the list it wrote. Calling it twice with the same
version returns `[]` the second time and touches nothing. The CLI always prints
the computed version and exits 0; the workflow decides whether to commit by
looking at `git diff`, so an unchanged tree produces no empty commit. (Note that
running the *CLI* twice is not a no-op in the bump sense — the second run reads
the new max and bumps again. That is correct: one landing, one bump.)

**stdout discipline.** `main` prints the resulting version and *nothing else* to
stdout, because the workflow captures it with `$(...)`. Every diagnostic goes to
stderr.

- [ ] **Step 1: Write the failing tests**

Append to `scripts/bump-version.test.mjs`. First extend the import at the top of
the file so it reads:

```js
import { describe, it, expect, vi } from "vitest";
import {
  bumpKind,
  parseVersion,
  formatVersion,
  compareVersions,
  nextVersion,
  TARGETS,
  readVersion,
  replaceVersion,
  currentVersion,
  writeVersion,
  main,
} from "./bump-version.mjs";
```

Then append this block to the end of the file:

```js
// ---------------------------------------------------------------------------
// Fixtures: the six fields exactly as they are drifted on origin/main today —
// package.json 1.0.1, package-lock.json 1.0.0 twice, the other three 1.7.0.
// Four of the six would be REGRESSED by a naive package.json-as-source
// implementation, which is what the no-regression test below pins.
// ---------------------------------------------------------------------------

const PKG = `{
  "name": "custom-toolkit",
  "private": true,
  "version": "1.0.1",
  "description": "Personal Claude Code plugins",
  "type": "module",
  "scripts": {
    "test": "vitest run"
  },
  "devDependencies": {
    "vitest": "^3.2.4"
  }
}
`;

const MARKETPLACE = `{
  "name": "custom-toolkit",
  "owner": {
    "name": "Botime"
  },
  "metadata": {
    "description": "Personal Claude Code plugins",
    "version": "1.7.0"
  },
  "plugins": [
    {
      "name": "autopilot",
      "source": "./plugins/autopilot",
      "description": "Take a task from idea to pull request",
      "version": "1.7.0",
      "author": {
        "name": "Botime"
      },
      "keywords": ["workflow", "automation"],
      "category": "workflow"
    }
  ]
}
`;

const PLUGIN = `{
  "name": "autopilot",
  "displayName": "Autopilot",
  "description": "Take a task from idea to pull request",
  "version": "1.7.0",
  "author": {
    "name": "Botime"
  },
  "license": "MIT",
  "keywords": ["workflow", "automation"],
  "skills": ["./skills/"],
  "commands": ["./commands/"]
}
`;

const LOCK = `{
  "name": "custom-toolkit",
  "version": "1.0.0",
  "lockfileVersion": 3,
  "requires": true,
  "packages": {
    "": {
      "name": "custom-toolkit",
      "version": "1.0.0",
      "devDependencies": {
        "vitest": "^3.2.4"
      }
    },
    "node_modules/vitest": {
      "version": "3.2.4",
      "resolved": "https://registry.npmjs.org/vitest/-/vitest-3.2.4.tgz",
      "integrity": "sha512-placeholder",
      "dev": true
    },
    "node_modules/@esbuild/aix-ppc64": {
      "version": "0.28.1",
      "resolved": "https://registry.npmjs.org/@esbuild/aix-ppc64/-/aix-ppc64-0.28.1.tgz",
      "integrity": "sha512-placeholder",
      "dev": true
    }
  }
}
`;

function driftedFiles() {
  return {
    "package.json": PKG,
    ".claude-plugin/marketplace.json": MARKETPLACE,
    "plugins/autopilot/.claude-plugin/plugin.json": PLUGIN,
    "package-lock.json": LOCK,
  };
}

/** In-memory io, same shape as fsIo. No temp directories anywhere. */
function fakeIo(files) {
  const store = new Map(Object.entries(files));
  return {
    store,
    read(file) {
      if (!store.has(file)) {
        const err = new Error(`ENOENT: no such file, open '${file}'`);
        err.code = "ENOENT";
        throw err;
      }
      return store.get(file);
    },
    write(file, content) {
      store.set(file, content);
    },
  };
}

const targetFor = (file, field) =>
  TARGETS.find((t) => t.file === file && t.field === field);

const versionsNow = (io) =>
  TARGETS.map((t) => readVersion(io.read(t.file), t));

describe("TARGETS", () => {
  it("covers all six version fields", () => {
    expect(TARGETS.map((t) => `${t.file}#${t.field}`)).toEqual([
      "package.json#version",
      ".claude-plugin/marketplace.json#metadata.version",
      '.claude-plugin/marketplace.json#plugins[name="autopilot"].version',
      "plugins/autopilot/.claude-plugin/plugin.json#version",
      "package-lock.json#version",
      'package-lock.json#packages[""].version',
    ]);
  });
});

describe("readVersion", () => {
  it("reads the single version out of package.json", () => {
    expect(readVersion(PKG, targetFor("package.json", "version"))).toBe("1.0.1");
  });

  it("distinguishes marketplace metadata from the plugin entry", () => {
    const meta = targetFor(".claude-plugin/marketplace.json", "metadata.version");
    const entry = targetFor(
      ".claude-plugin/marketplace.json",
      'plugins[name="autopilot"].version',
    );
    expect(readVersion(MARKETPLACE, meta)).toBe("1.7.0");
    expect(readVersion(MARKETPLACE, entry)).toBe("1.7.0");
  });

  it("reads the lockfile's two root versions, not a dependency's", () => {
    const top = targetFor("package-lock.json", "version");
    const root = targetFor("package-lock.json", 'packages[""].version');
    expect(readVersion(LOCK, top)).toBe("1.0.0");
    expect(readVersion(LOCK, root)).toBe("1.0.0");
    // Not vitest's 3.2.4 and not esbuild's 0.28.1.
  });

  it("throws naming the file and field when the version key is missing", () => {
    const stripped = PKG.replace(/^  "version".*\n/m, "");
    expect(() =>
      readVersion(stripped, targetFor("package.json", "version")),
    ).toThrow(/package\.json.*version/);
  });

  it("throws naming the file and field when the anchor is missing", () => {
    const stripped = MARKETPLACE.replace('"metadata"', '"meta"');
    expect(() =>
      readVersion(
        stripped,
        targetFor(".claude-plugin/marketplace.json", "metadata.version"),
      ),
    ).toThrow(/marketplace\.json.*metadata\.version/);
  });

  it("throws on a version that is not plain X.Y.Z", () => {
    const pre = PKG.replace('"1.0.1"', '"1.0.1-beta.2"');
    expect(() =>
      readVersion(pre, targetFor("package.json", "version")),
    ).toThrow(/package\.json.*1\.0\.1-beta\.2/);
  });
});

describe("currentVersion", () => {
  it("returns the HIGHEST version across the drifted targets", () => {
    // 1.7.0, not package.json's 1.0.1 — this is what makes the first
    // automated run self-healing instead of a six-field regression.
    expect(currentVersion(TARGETS, fakeIo(driftedFiles()))).toBe("1.7.0");
  });

  it("compares numerically, so 1.10.0 beats 1.9.0", () => {
    const files = driftedFiles();
    files["package.json"] = PKG.replace('"1.0.1"', '"1.10.0"');
    files["plugins/autopilot/.claude-plugin/plugin.json"] = PLUGIN.replace(
      '"1.7.0"',
      '"1.9.0"',
    );
    expect(currentVersion(TARGETS, fakeIo(files))).toBe("1.10.0");
  });

  it("throws naming the file when a target file is missing", () => {
    const files = driftedFiles();
    delete files["package-lock.json"];
    expect(() => currentVersion(TARGETS, fakeIo(files))).toThrow(
      /package-lock\.json/,
    );
  });
});

describe("writeVersion", () => {
  it("brings all six fields to the same version (lockstep)", () => {
    const io = fakeIo(driftedFiles());
    writeVersion(TARGETS, "1.7.1", io);
    expect(versionsNow(io)).toEqual([
      "1.7.1", "1.7.1", "1.7.1", "1.7.1", "1.7.1", "1.7.1",
    ]);
  });

  it("never moves any field backwards", () => {
    // Four of the six would regress under a package.json-as-source
    // implementation. This is a structural property, not a rule to remember.
    const io = fakeIo(driftedFiles());
    const before = versionsNow(io);
    const target = nextVersion(currentVersion(TARGETS, io), "patch");
    writeVersion(TARGETS, target, io);
    const after = versionsNow(io);
    after.forEach((value, i) => {
      expect(compareVersions(value, before[i])).toBeGreaterThanOrEqual(0);
    });
  });

  it("changes exactly two lines of package-lock.json and no dependency", () => {
    const io = fakeIo(driftedFiles());
    writeVersion(TARGETS, "1.7.1", io);
    const before = LOCK.split("\n");
    const after = io.store.get("package-lock.json").split("\n");

    expect(after).toHaveLength(before.length);
    const changed = before
      .map((line, i) => [i, line, after[i]])
      .filter(([, oldLine, newLine]) => oldLine !== newLine);
    expect(changed).toHaveLength(2);
    for (const [, , newLine] of changed) expect(newLine).toContain('"1.7.1"');

    // The corruption case: a dependency version changing would alter what
    // `npm ci` installs.
    const parsed = JSON.parse(io.store.get("package-lock.json"));
    expect(parsed.packages["node_modules/vitest"].version).toBe("3.2.4");
    expect(parsed.packages["node_modules/@esbuild/aix-ppc64"].version).toBe("0.28.1");
    expect(parsed.version).toBe("1.7.1");
    expect(parsed.packages[""].version).toBe("1.7.1");
  });

  it("changes exactly two lines of marketplace.json and leaves the rest byte-identical", () => {
    const io = fakeIo(driftedFiles());
    writeVersion(TARGETS, "1.7.1", io);
    const before = MARKETPLACE.split("\n");
    const after = io.store.get(".claude-plugin/marketplace.json").split("\n");
    expect(after).toHaveLength(before.length);
    const changed = before.filter((line, i) => line !== after[i]);
    expect(changed).toHaveLength(2);
  });

  it("reports which files it wrote", () => {
    const io = fakeIo(driftedFiles());
    expect(writeVersion(TARGETS, "1.7.1", io).sort()).toEqual(
      [
        ".claude-plugin/marketplace.json",
        "package-lock.json",
        "package.json",
        "plugins/autopilot/.claude-plugin/plugin.json",
      ].sort(),
    );
  });

  it("is a no-op the second time (idempotence)", () => {
    const io = fakeIo(driftedFiles());
    writeVersion(TARGETS, "1.7.1", io);
    const snapshot = new Map(io.store);
    expect(writeVersion(TARGETS, "1.7.1", io)).toEqual([]);
    for (const [file, content] of snapshot) {
      expect(io.store.get(file)).toBe(content);
    }
  });

  it("throws rather than writing a version that is not plain X.Y.Z", () => {
    const io = fakeIo(driftedFiles());
    expect(() => writeVersion(TARGETS, "1.7.1-rc.1", io)).toThrow(/1\.7\.1-rc\.1/);
    expect(io.store.get("package.json")).toBe(PKG);
  });
});

describe("replaceVersion", () => {
  it("splices only the value's characters", () => {
    const target = targetFor("package.json", "version");
    const out = replaceVersion(PKG, target, "9.9.9");
    expect(out).toBe(PKG.replace('"1.0.1"', '"9.9.9"'));
  });
});

describe("main", () => {
  function withSilencedConsole(fn) {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const savedExitCode = process.exitCode;
    try {
      return fn(log, error);
    } finally {
      log.mockRestore();
      error.mockRestore();
      process.exitCode = savedExitCode;
    }
  }

  it("prints only the new version to stdout and writes the files", () => {
    const io = fakeIo(driftedFiles());
    withSilencedConsole((log) => {
      main([], io, () => "feat: add a thing");
      // max is 1.7.0, feat -> minor -> 1.8.0
      expect(log.mock.calls).toEqual([["1.8.0"]]);
      expect(process.exitCode).toBe(0);
    });
    expect(versionsNow(io)).toEqual([
      "1.8.0", "1.8.0", "1.8.0", "1.8.0", "1.8.0", "1.8.0",
    ]);
  });

  it("accepts a --message override instead of reading git", () => {
    const io = fakeIo(driftedFiles());
    withSilencedConsole((log) => {
      main(["--message=fix!: break it"], io, () => {
        throw new Error("git must not be consulted when --message is given");
      });
      expect(log.mock.calls).toEqual([["2.0.0"]]);
    });
  });

  it("exits non-zero and writes nothing when a target file is missing", () => {
    const files = driftedFiles();
    delete files["plugins/autopilot/.claude-plugin/plugin.json"];
    const io = fakeIo(files);
    withSilencedConsole((log, error) => {
      main([], io, () => "chore: x");
      expect(process.exitCode).toBe(1);
      expect(log).not.toHaveBeenCalled();
      expect(error.mock.calls.flat().join(" ")).toMatch(/plugin\.json/);
    });
    expect(io.store.get("package.json")).toBe(PKG);
  });

  it("exits non-zero when a target has no version field", () => {
    const files = driftedFiles();
    files["package.json"] = PKG.replace(/^  "version".*\n/m, "");
    const io = fakeIo(files);
    withSilencedConsole((log, error) => {
      main([], io, () => "chore: x");
      expect(process.exitCode).toBe(1);
      expect(error.mock.calls.flat().join(" ")).toMatch(/package\.json/);
    });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npx vitest run scripts/bump-version.test.mjs
```

Expected: FAIL — `TARGETS`, `readVersion`, `replaceVersion`, `currentVersion`, `writeVersion` and `main` are not exported (`SyntaxError: The requested module './bump-version.mjs' does not provide an export named 'TARGETS'`). The Task 2 tests in the same file fail alongside them for the same reason; that is expected until Step 3.

- [ ] **Step 3: Write the minimal implementation**

Append to `scripts/bump-version.mjs`. Add these three lines to the very top of
the file, above the existing header comment's code:

```js
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
```

Then append the rest to the end of the file:

```js
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Every version field this repo keeps in lockstep. `file` is repo-relative.
 *
 * `anchor` disambiguates files with more than one "version" key: the rewrite
 * takes the FIRST `"version"` at or after the anchor's end. A null anchor means
 * the file's first "version" is the right one.
 */
export const TARGETS = [
  { file: "package.json", field: "version", anchor: null },
  {
    file: ".claude-plugin/marketplace.json",
    field: "metadata.version",
    anchor: /"metadata"\s*:\s*\{/,
  },
  {
    file: ".claude-plugin/marketplace.json",
    field: 'plugins[name="autopilot"].version',
    // By name, not by array index: adding a second plugin later must not
    // silently retarget this rewrite at the wrong entry.
    anchor: /"name"\s*:\s*"autopilot"/,
  },
  {
    file: "plugins/autopilot/.claude-plugin/plugin.json",
    field: "version",
    anchor: null,
  },
  {
    file: "package-lock.json",
    field: "version",
    // The first "version" in the lockfile is the top-level one.
    // "lockfileVersion" cannot match: the pattern below needs a quote directly
    // before `v`, and that key's V is capital.
    anchor: null,
  },
  {
    file: "package-lock.json",
    field: 'packages[""].version',
    // The root package entry. Every OTHER "version" in this file belongs to a
    // dependency; rewriting one would change what `npm ci` installs.
    anchor: /"packages"\s*:\s*\{\s*""\s*:\s*\{/,
  },
];

// Three groups so the value's exact character range is known without guessing.
const VERSION_FIELD = /("version"\s*:\s*")([^"]*)(")/;

function locate(content, target) {
  let from = 0;
  if (target.anchor) {
    const anchored = target.anchor.exec(content);
    if (!anchored) {
      throw new Error(
        `${target.file}: cannot locate ${target.field} — anchor ${target.anchor} not found`,
      );
    }
    from = anchored.index + anchored[0].length;
  }
  const match = VERSION_FIELD.exec(content.slice(from));
  if (!match) {
    throw new Error(`${target.file}: no "version" field found for ${target.field}`);
  }
  const start = from + match.index + match[1].length;
  return { start, end: start + match[2].length, raw: match[2] };
}

/**
 * A repo-structure bug fails loudly. A missing file, a missing field, or a
 * value that is not plain X.Y.Z means the target table and the repo have gone
 * out of sync — and a silent skip would let a field quietly stop being
 * versioned, reintroducing drift through a different door.
 */
export function readVersion(content, target) {
  const { raw } = locate(content, target);
  if (!parseVersion(raw)) {
    throw new Error(
      `${target.file}: ${target.field} is "${raw}", not a plain X.Y.Z version`,
    );
  }
  return raw;
}

/**
 * Splices the value's characters. Deliberately NOT a JSON.parse/stringify
 * round-trip: that would rewrite all 1603 lines of package-lock.json on every
 * landing, burying the two-line real change in every future `git log -p`.
 */
export function replaceVersion(content, target, version) {
  const { start, end } = locate(content, target);
  return content.slice(0, start) + version + content.slice(end);
}

function readTarget(target, io) {
  try {
    return io.read(target.file);
  } catch (err) {
    throw new Error(`${target.file}: cannot read target file (${err.message})`);
  }
}

/**
 * The HIGHEST version across every target — deliberately not one designated
 * source file.
 *
 * It makes "no field is ever moved backwards" structural rather than a rule to
 * remember, and it makes the first run self-healing: it reads 1.7.0, not
 * 1.0.1, so package.json and package-lock.json are pulled UP to join the other
 * four instead of dragging them down.
 */
export function currentVersion(targets, io) {
  let best = null;
  for (const target of targets) {
    const found = readVersion(readTarget(target, io), target);
    if (best === null || compareVersions(found, best) > 0) best = found;
  }
  if (best === null) throw new Error("no version targets configured");
  return best;
}

/**
 * Rewrites every target to `version`. Returns the repo-relative paths actually
 * written — [] when every file already reads that version, which is what makes
 * a second run a no-op.
 */
export function writeVersion(targets, version, io) {
  if (!parseVersion(version)) {
    throw new Error(`"${version}" is not a plain X.Y.Z version`);
  }

  const originals = new Map();
  const updated = new Map();
  for (const target of targets) {
    if (!originals.has(target.file)) {
      const content = readTarget(target, io);
      originals.set(target.file, content);
      updated.set(target.file, content);
    }
    // Apply to the accumulated content: marketplace.json and package-lock.json
    // each carry two targets, and each locate() runs against the latest text.
    const before = updated.get(target.file);
    readVersion(before, target); // validates the existing value before touching it
    updated.set(target.file, replaceVersion(before, target, version));
  }

  const written = [];
  for (const [file, content] of updated) {
    if (content !== originals.get(file)) {
      io.write(file, content);
      written.push(file);
    }
  }
  return written;
}

/** The real filesystem, resolving repo-relative target paths against the root. */
export const fsIo = {
  read: (file) => readFileSync(join(REPO_ROOT, file), "utf8"),
  write: (file, content) => writeFileSync(join(REPO_ROOT, file), content),
};

function headCommitMessage() {
  const result = spawnSync("git", ["log", "-1", "--pretty=%B"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(`git log failed: ${(result.stderr ?? "").trim()}`);
  }
  return result.stdout ?? "";
}

/**
 * stdout carries the resulting version and nothing else — the workflow captures
 * it with $(...) to build its commit message. Diagnostics go to stderr.
 */
export function main(argv = process.argv.slice(2), io = fsIo, readMessage = headCommitMessage) {
  try {
    const override = argv.find((arg) => arg.startsWith("--message="));
    const message = override ? override.slice("--message=".length) : readMessage();
    const kind = bumpKind(message);
    const current = currentVersion(TARGETS, io);
    const next = nextVersion(current, kind);
    const written = writeVersion(TARGETS, next, io);

    console.log(next);
    console.error(
      written.length
        ? `bump-version: ${current} → ${next} (${kind}); wrote ${written.join(", ")}`
        : `bump-version: already at ${next}; nothing written`,
    );
    process.exitCode = 0;
  } catch (err) {
    console.error(`bump-version: ${err.message}`);
    process.exitCode = 1;
  }
}

// pathToFileURL rather than a `file://` template: a space in the checkout path
// would otherwise silently skip main().
if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npx vitest run scripts/bump-version.test.mjs
```

Expected: PASS — every test in the file, both halves.

- [ ] **Step 5: Prove the CLI works against the real tree, then undo it**

This is the only place the real files are touched, and the change is reverted
immediately — see the Global Constraint against hand-bumping.

```bash
node scripts/bump-version.mjs --message="fix: probe"
git --no-pager diff --stat
```

Expected: stdout prints `1.7.1`; stderr reports the four files written; the
diff touches exactly 4 files / 6 changed lines (`package.json` 1, `marketplace.json` 2,
`plugin.json` 1, `package-lock.json` 2). Then revert:

```bash
git checkout -- package.json package-lock.json .claude-plugin/marketplace.json plugins/autopilot/.claude-plugin/plugin.json
git --no-pager diff --stat
```

Expected: the second `git diff --stat` prints nothing. **If it does not, stop —
the working tree must not carry a hand-bump into the commit.**

- [ ] **Step 6: Run the full suite**

```bash
npm test 2>&1 | tail -5
```

Expected: all PASS.

- [ ] **Step 7: Commit**

```bash
git add scripts/bump-version.mjs scripts/bump-version.test.mjs
git commit -m "feat(version): rewrite all six version fields in place from a CLI"
```

---

### Task 4: The CI job that bumps and pushes, plus its contract test

**Files:**
- Modify: `.github/workflows/test.yml` (append a `version` job; the existing `test` job is untouched)
- Create: `scripts/version-workflow-contract.test.mjs`

**Interfaces:**
- Consumes, from Task 3: the CLI `node scripts/bump-version.mjs`, which prints the new version to stdout and exits non-zero on a repo-structure bug.
- Produces: a `version` job in `.github/workflows/test.yml`. No code interface.

**Why one file, not two.** The spec allows either `test.yml` or a separate
`version.yml`. Use `test.yml`: `needs:` is a job-level dependency that only
works *within* one workflow file, so a separate file would have to use
`workflow_run`, which is more machinery for the same property and harder for
the contract test to assert. `needs: test` in `test.yml` is the direct,
literal expression of "a red `main` is never versioned".

**Loop prevention is three layers, all required.** The failure mode is not a
failed run — it is an infinite series of *successful* ones, each pushing a
commit that triggers the next.

1. A push made with the default `GITHUB_TOKEN` does not trigger new workflow runs. Primary guard.
2. `[skip ci]` in the commit message. Backs it up, and covers someone later swapping the token for a PAT without thinking about loops.
3. The job's `if:` skips when the head commit message already starts with `chore(release):`. Last resort — the only one still standing if both of the above are bypassed.

**Consequence to accept:** because the bot's push does not trigger workflows,
the release commit itself is never tested. That is safe only because Task 1
removed the version pin — the release commit's entire content is version digits
in JSON, and nothing in the suite can be affected by it.

- [ ] **Step 1: Write the failing contract test**

Create `scripts/version-workflow-contract.test.mjs`:

```js
// .github/workflows/test.yml carries a `version` job that bumps the repo
// version and pushes back to main. Four of its properties fail SILENTLY rather
// than loudly if they are edited away:
//
//   - `needs: test` — without it, a red main still gets versioned.
//   - `contents: write` — this one actually fails visibly on the push, but it
//     is cheap to pin and the failure is remote-only.
//   - the `chore(release):` skip guard and `[skip ci]` — without them, the
//     job keeps SUCCEEDING while pushing a commit that triggers the next run.
//   - the invocation of scripts/bump-version.mjs — without it, the job runs
//     and commits nothing, forever.
//
// Matched on load-bearing phrases rather than whole lines, so ordinary editing
// of the workflow does not break this but removal does.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const WORKFLOW_PATH = join(HERE, "..", ".github", "workflows", "test.yml");

/**
 * The `version:` job: from its 2-space-indented key to the next job at the
 * same indent, or end of file.
 *
 * Scoped rather than matching the whole file, so a `needs: test` or a
 * `contents: write` that ends up on some OTHER job cannot satisfy assertions
 * about this one.
 */
function versionJob(yaml) {
  const start = /^ {2}version:\s*$/m.exec(yaml);
  if (!start) throw new Error("test.yml has no `version:` job");
  const rest = yaml.slice(start.index);
  // A sibling job header is `\n` + exactly two spaces + a word char. Keys
  // inside this job are indented four or more, so they cannot match.
  const end = /\n {2}[\w-]+:/.exec(rest.slice(start[0].length));
  return end ? rest.slice(0, start[0].length + end.index) : rest;
}

/**
 * The job's `if:` guard, collapsed to one line.
 *
 * The guard is a folded YAML block (`if: >-`) spread over several lines, so a
 * single-line regex would not see it. It is extracted rather than matched
 * against the whole job because `chore(release):` also appears in the commit
 * message further down — searching the whole job would keep passing after the
 * guard itself was deleted, which is the one thing a contract test must never
 * do.
 */
function ifGuard(job) {
  const match = /^ {4}if:([\s\S]*?)\n {4}[\w-]+:/m.exec(job);
  if (!match) throw new Error("the version job has no `if:` guard");
  return match[1].replace(/\s+/g, " ").trim();
}

describe("version workflow contract", () => {
  const yaml = readFileSync(WORKFLOW_PATH, "utf8");
  const job = versionJob(yaml);
  const guard = ifGuard(job);

  it("runs only after the test job passes", () => {
    // Without this, a red main is versioned anyway.
    expect(job).toMatch(/needs:\s*(\[\s*)?test/);
  });

  it("grants contents: write so the bot can push", () => {
    expect(job).toMatch(/contents:\s*write/);
  });

  it("skips when the head commit is already a release commit", () => {
    // Loop-prevention layer 3, and the only one that survives someone swapping
    // GITHUB_TOKEN for a PAT.
    expect(guard).toMatch(
      /startsWith\(github\.event\.head_commit\.message, 'chore\(release\):'\)/,
    );
    expect(guard).toMatch(/!\s*startsWith/);
  });

  it("marks its own commit [skip ci]", () => {
    // Loop-prevention layer 2.
    expect(job).toContain("[skip ci]");
  });

  it("invokes the bump script", () => {
    // Without this the job succeeds while doing nothing at all.
    expect(job).toContain("scripts/bump-version.mjs");
  });

  it("only ever runs on a push to main", () => {
    expect(guard).toContain("github.event_name == 'push'");
    expect(guard).toContain("refs/heads/main");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
npx vitest run scripts/version-workflow-contract.test.mjs
```

Expected: FAIL — every test errors with ``test.yml has no `version:` job``.

- [ ] **Step 3: Add the `version` job to the workflow**

Append to `.github/workflows/test.yml`, after the existing `test` job, keeping
its two-space job indentation. The `test` job above is unchanged.

```yaml
  # Bumps the one repo-wide version and pushes the result back to main.
  #
  # Loop prevention is three layers, all required: (1) a push made with the
  # default GITHUB_TOKEN does not trigger workflow runs, (2) [skip ci] in the
  # commit message, (3) the chore(release): guard in the `if` below. The
  # failure mode is an infinite series of SUCCESSFUL runs, so one layer is not
  # enough.
  version:
    needs: test
    if: >-
      github.event_name == 'push'
      && github.ref == 'refs/heads/main'
      && !startsWith(github.event.head_commit.message, 'chore(release):')
    runs-on: ubuntu-latest
    permissions:
      contents: write
    steps:
      - uses: actions/checkout@v4
        with:
          # The push below needs the checkout's credentials. Explicit rather
          # than relying on the action's default, so it is visible and pinnable.
          persist-credentials: true
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - id: bump
        # The script prints ONLY the new version to stdout; diagnostics go to
        # stderr. It exits non-zero if a target file or field has gone missing.
        run: echo "version=$(node scripts/bump-version.mjs)" >> "$GITHUB_OUTPUT"
      - name: Commit and push the bump
        run: |
          if git diff --quiet; then
            echo "version already current; nothing to commit"
            exit 0
          fi
          git config user.name "github-actions[bot]"
          git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
          git commit -am "chore(release): v${{ steps.bump.outputs.version }} [skip ci]"
          git push origin HEAD:main
```

Two details worth not "simplifying" away:

- The checkout takes no `ref:`. It lands on the pushed SHA, so `git log -1`
  inside the script reads the message that triggered the run. If `main` has
  moved on in the meantime the final push is rejected and the job fails
  visibly — better than `ref: main` silently versioning a different commit's
  message.
- On a `pull_request` event `github.event.head_commit` is null, but the
  `github.event_name == 'push'` conjunct is false first, so the whole `if` is
  false and the job is skipped. The `startsWith(null, ...)` never matters.

- [ ] **Step 4: Run the contract test to verify it passes**

```bash
npx vitest run scripts/version-workflow-contract.test.mjs
```

Expected: PASS — all six tests.

- [ ] **Step 5: Verify the YAML actually parses and the job slicer is right**

The contract test reads the file as text, so a YAML syntax error would not
fail it. Check the structure independently:

```bash
node -e '
const y = require("fs").readFileSync(".github/workflows/test.yml","utf8");
console.log(y.split("\n").filter(l => /^  [\w-]+:\s*$/.test(l)));
'
```

Expected: `[ '  test:', '  version:' ]` — exactly two jobs at the top level of
`jobs:`, confirming the appended block is indented as a sibling of `test` and
not nested inside it.

- [ ] **Step 6: Run the full suite**

```bash
npm test 2>&1 | tail -5
```

Expected: all PASS across 16 test files.

- [ ] **Step 7: Confirm the working tree carries no hand-bump**

```bash
git --no-pager diff --stat -- package.json package-lock.json .claude-plugin/ plugins/autopilot/.claude-plugin/
```

Expected: no output. The version fields must land exactly as they are today
(`1.0.1` / `1.0.0` / `1.7.0`); the first automated run repairs the drift.

- [ ] **Step 8: Commit**

```bash
git add .github/workflows/test.yml scripts/version-workflow-contract.test.mjs
git commit -m "ci: bump the repo version on every push to main"
```

---

## What happens on the first landing

Worth knowing so the first automated run is not mistaken for a bug. When this
branch merges to `main`:

1. `test` runs and passes on the merge commit.
2. `version` runs. `currentVersion` reads the six drifted fields and returns
   `1.7.0` (the max, not `package.json`'s `1.0.1`).
3. `bumpKind` reads the landing commit's message and picks a kind.
4. All six fields are written to the result — `package.json` and
   `package-lock.json` jump from `1.0.x` to join the other four. The Problem
   table's drift is repaired as the automation's first act.
5. `chore(release): vX.Y.Z [skip ci]` is pushed to `main` and triggers nothing.

---

## Self-review

**1. Spec coverage.**

| Spec section | Task |
| --- | --- |
| Scope — six target fields | Task 3 (`TARGETS`, with a test enumerating all six) |
| Bump rule: conventional commits | Task 2 (`bumpKind`) |
| Fallback: non-conventional message still bumps | Task 2 (merge-commit, bare, empty-message tests) |
| Mechanism: CI commits back to `main` | Task 4 |
| No tags, no releases | Nothing to build — the plan introduces neither |
| Implementation shape: script + vitest, root `scripts/` | Tasks 2–3 (pure exports + `main()`/`import.meta.url` guard) |
| `bumpKind` / `currentVersion` / `nextVersion` / `writeVersion` | Tasks 2–3 |
| Target table with disambiguation; `"name": "autopilot"` lookup | Task 3 (anchor table) |
| Max-reading `currentVersion`, numeric comparison | Task 3 |
| Line-level rewrite, no JSON round-trip | Task 3 (`replaceVersion` by character offset) |
| Version format strictness + error handling | Tasks 2–3 (`parseVersion` returns null; `readVersion`/`main` fail loudly) |
| CLI: reads git, `--message` override, prints version, no-op second time | Task 3 |
| Workflow: `needs: test`, `contents: write`, persisted credentials | Task 4 |
| Three loop-prevention layers | Task 4 (all three present; layers 2 and 3 pinned by the contract test) |
| Discovered constraint — delete the three pinning assertions | Task 1 |
| Lockstep invariant relocated to `writeVersion`'s tests | Task 3 |
| `scripts/bump-version.test.mjs` full test list | Tasks 2–3 (parse table, max-under-drift, 1.9.0-vs-1.10.0, no-regression, formatting preservation incl. no dependency touched, lockstep, idempotence, missing file, missing field) |
| `scripts/version-workflow-contract.test.mjs` four assertions | Task 4 (plus `[skip ci]` and the push-to-main guard) |
| Version section: do not hand-bump | Global Constraints; verified in Task 3 Step 5 and Task 4 Step 7 |
| Deferred items | Deliberately unbuilt |

No gaps.

**2. Placeholder scan.** No TBD/TODO, no "handle edge cases", no "similar to
Task N". Every code step carries the literal code; every run step carries the
exact command and its expected output. The two `"integrity": "sha512-placeholder"`
strings are fixture data, not plan placeholders — the tests never read them.

**3. Type consistency.** Cross-task symbols: Task 3 consumes `parseVersion`,
`compareVersions`, `nextVersion` and `bumpKind` from Task 2 with the exact
signatures declared in Task 2's **Produces** block. `io` is `{ read, write }`
in `fsIo`, in `fakeIo`, and in every `readTarget` call site. `TARGETS` entries
are `{ file, field, anchor }` in the implementation, in the `targetFor` helper,
and in the enumeration test — the `field` strings in the test match the
implementation character for character, including the quoting in
`plugins[name="autopilot"].version` and `packages[""].version`. `writeVersion`
returns `string[]` and both the "reports which files it wrote" and idempotence
tests treat it that way. Task 4's workflow invokes `node scripts/bump-version.mjs`
with no arguments, matching the CLI's git-reading default from Task 3.
