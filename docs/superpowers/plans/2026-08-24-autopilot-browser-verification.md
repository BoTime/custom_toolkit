# Autopilot browser verification (revised design) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Amend the already-implemented `verify` stage so it runs between `sdd`
and `learnings`, is enabled purely by a `(ui)` acceptance criterion, and drives
a per-run *derived* recipe instead of hand-written `browser` config.

**Architecture:** The branch already contains a working `verify` stage built to
the *previous* design. Every task below is an amendment to existing code, not
greenfield work. Four seams change: `nextStage`'s stage order, the `browser`
config surface (shrunk to one key), `autopilot-verify.mjs`'s inputs (a
`recipe.json` the `plan` stage derives, a base URL resolved by command at run
time), and the prose contracts in `SKILL.md` / `README.md` that the contract
tests pin.

**Tech Stack:** Node ESM (standard library only — the plugin ships zero runtime
dependencies), vitest, markdown skill files pinned by "contract tests" that
assert prose and code agree.

**Spec:** `docs/superpowers/specs/2026-08-24-autopilot-browser-verification-design.md`

## Global Constraints

- **Tests are vitest, co-located** as `<script>.test.mjs` beside each `.mjs`.
- **`npm test` is the gate.** It currently passes **361 tests across 16 files**
  and must still pass at the end of every task.
- **Contract tests pin prose.** Changing a stage order, a ledger prefix, or a
  documented exit code means updating the code AND the contract test that pins
  the SKILL.md wording. Never delete a contract assertion to make a build green
  — rewrite it against the new wording.
- **No new runtime dependencies.** Node standard library only in `scripts/`.
- **Stage order after this plan:** `phase1 → setup → spec → plan → sdd →
  verify → learnings → land → pr`.
- **Exit taxonomy after this plan:** `0` pass · `1` criterion failed · `2`
  infrastructure · `3` skip (no `(ui)` criteria) · `4` cannot verify despite
  `(ui)` criteria (park).
- **Recipe path, verbatim:** `.superpowers/autopilot/<run>/verify/recipe.json`,
  in the **main checkout**, gitignored, rederived every run, never committed.
- **Recipe keys, verbatim:** `dev_command`, `base_url_command`, `stop_command`,
  `seed_command`. The first two are required; the last two are optional.
- **Surviving config key, verbatim:** `browser.ready_timeout_ms`, default
  `120000`.
- **Findings contract is not widened.** Seven fields — `task`, `round`,
  `severity`, `stage_at_fault`, `pattern`, `detail`, `verdict` — with
  `stage_at_fault` drawn from the existing four values only, and `task: 0` as
  the "not a task" sentinel.
- Run every command from the worktree root:
  `/Users/bo/workspace/custom_toolkit/.claude/worktrees/worktree-autopilot-verify-before-learnings`.

## File Structure

| File | Responsibility | Task |
|---|---|---|
| `plugins/autopilot/scripts/autopilot-ledger.mjs` | `nextStage` prefix order | 1 |
| `plugins/autopilot/scripts/autopilot-ledger.test.mjs` | resume-order unit tests | 1 |
| `plugins/autopilot/scripts/autopilot-ledger-coupling.test.mjs` | SKILL.md ↔ `nextStage` pipeline order | 1 |
| `plugins/autopilot/scripts/autopilot-github-ledger-coupling.test.mjs` | same, with `github:` lines woven in | 1 |
| `plugins/autopilot/skills/autopilot/SKILL.md` | orchestrator prose: stage order (1), verify contract (3), plan recipe derivation (4) | 1, 3, 4 |
| `plugins/autopilot/skills/autopilot-github/SKILL.md` | wrapper's pipeline sentence | 1 |
| `plugins/autopilot/scripts/autopilot-verify.mjs` | the stage driver: recipe, base URL, lifecycle, exits, findings | 2 |
| `plugins/autopilot/scripts/autopilot-verify.test.mjs` | driver unit tests | 2 |
| `plugins/autopilot/scripts/autopilot-config.mjs` | config schema — loses the `browser` key list | 3 |
| `plugins/autopilot/scripts/autopilot-config.test.mjs` | config unit tests | 3 |
| `plugins/autopilot/autopilot.default.json` | `ready_timeout_ms` default | 3 |
| `plugins/autopilot/scripts/autopilot-verify-contract.test.mjs` | SKILL.md ↔ verify script contract | 1, 3, 4 |
| `README.md` | enablement answer + config table | 4 |

---

### Task 1: Reorder the pipeline to `sdd → verify → learnings → land → pr`

**Files:**
- Modify: `plugins/autopilot/scripts/autopilot-ledger.mjs:27-49` (`nextStage`)
- Modify: `plugins/autopilot/scripts/autopilot-ledger.test.mjs:60-95`
- Modify: `plugins/autopilot/scripts/autopilot-ledger-coupling.test.mjs:20-34`
- Modify: `plugins/autopilot/scripts/autopilot-github-ledger-coupling.test.mjs:32-45`
- Modify: `plugins/autopilot/scripts/autopilot-verify-contract.test.mjs:63-74, 196-235`
- Modify: `plugins/autopilot/skills/autopilot/SKILL.md` (resume list at ~line 20;
  move the whole `### \`verify\`` section from ~515 to sit between `### \`sdd\``
  and `### \`learnings\``; rewrite its opening rationale paragraph)
- Modify: `plugins/autopilot/skills/autopilot-github/SKILL.md:20-22`

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: `nextStage(ledger)` returning, in order, `done | pr | land |
  learnings | verify | sdd | plan | spec | setup | phase1 | parked`. Tasks 3
  and 4 edit the same SKILL.md, so the `### \`verify\`` heading must end up
  **before** `### \`learnings\`` here and stay there.

- [ ] **Step 1: Update the three coupling test fixtures to the new order**

In `autopilot-ledger-coupling.test.mjs`, replace the `STAGE_ENTRIES` array
(lines 20–34, including its comment) with:

```javascript
// The ten ledger entries SKILL.md instructs the orchestrator to append,
// in pipeline order, paired with the stage `nextStage` must return once a
// ledger ends with that entry.
const STAGE_ENTRIES = [
  ["started (phase 1)", "phase1"],
  ["design approved", "setup"],
  ["worktree: .claude/worktrees/x (branch x)", "spec"],
  ["spec committed → docs/superpowers/specs/2026-07-29-x-design.md", "plan"],
  ["plan complete → docs/superpowers/plans/2026-07-29-x.md", "sdd"],
  ["sdd complete (6 tasks, 0 parked)", "verify"],
  ["verify: 3/3 ui criteria passed", "learnings"],
  ["learnings committed → docs/autopilot/learnings.md", "land"],
  ["rebase clean, tests green (42 passed)", "pr"],
  ["pr: https://example.com/pull/23", "done"],
];
```

In the same file, the three trailing tests assert `"learnings"` for a ledger
that ends at `sdd complete`. `sdd complete` now resolves to `verify`, so change
those three expectations:

```javascript
  it('a ledger ending in "PARKED — tests red after rebase (3 failures)" returns "parked"', () => {
    const cumulative = [
      ...STAGE_ENTRIES.slice(0, 6).map(([text]) => text), // through "sdd complete"
      "PARKED — tests red after rebase (3 failures)",
    ];
    const ledger = buildLedger(cumulative);
    expect(nextStage(parseLedger(ledger))).toBe("parked");
  });

  it('"sdd complete (6 tasks, 2 parked)" as the last entry returns "verify", not "parked"', () => {
    const cumulative = [
      ...STAGE_ENTRIES.slice(0, 5).map(([text]) => text), // through "plan complete"
      "sdd complete (6 tasks, 2 parked)",
    ];
    expect(nextStage(parseLedger(buildLedger(cumulative)))).toBe("verify");
  });

  it('"sdd complete" with fix-round counts still returns "verify"', () => {
    // The entry grew a fix-round clause. nextStage matches it by PREFIX, so
    // the longer wording must keep resolving to the same stage.
    const cumulative = [
      ...STAGE_ENTRIES.slice(0, 5).map(([text]) => text), // through "plan complete"
      "sdd complete (10 tasks, 0 parked, 7 fix rounds across 4 tasks)",
    ];
    expect(nextStage(parseLedger(buildLedger(cumulative)))).toBe("verify");
  });
```

In `autopilot-github-ledger-coupling.test.mjs`, replace its `STAGE_ENTRIES`
(lines 32–45) with the same order, keeping that file's own entry texts:

```javascript
const STAGE_ENTRIES = [
  ["started (phase 1)", "phase1"],
  ["design approved", "setup"],
  ["worktree: .claude/worktrees/issue-42 (branch worktree-issue-42)", "spec"],
  ["spec committed → docs/superpowers/specs/2026-08-21-x-design.md", "plan"],
  ["plan complete → docs/superpowers/plans/2026-08-21-x.md (6 tasks)", "sdd"],
  ["sdd complete (6 tasks, 0 parked, 0 fix rounds across 0 tasks)", "verify"],
  ["verify: 3/3 ui criteria passed", "learnings"],
  ["learnings committed → docs/autopilot/learnings.md", "land"],
  ["rebase clean, tests green (42 passed)", "pr"],
  ["pr: https://example.com/pull/23", "done"],
];
```

Its final describe block (`the PARKED ordering constraint`) slices through
index 6 and asserts the non-parked fallthrough is `"learnings"`. That
fallthrough is now `"verify"`:

```javascript
    const stage = stageOf([...throughSdd, REASON, "github: parked comment posted"]);
    expect(stage).not.toBe("parked");
    expect(stage).toBe("verify");
```

Also extend that file's `RESUME_PREFIXES` (line 27) with `"verify"`, so the
inertness check covers every prefix `nextStage` now matches:

```javascript
const RESUME_PREFIXES = [
  "pr:", "rebase clean", "learnings committed", "verify", "sdd complete",
  "plan complete", "spec committed", "worktree:", "design approved", "PARKED",
];
```

- [ ] **Step 2: Update the ledger unit tests to the new order**

In `autopilot-ledger.test.mjs`, the fixture ledger at lines 14–20 runs
`sdd complete` → `learnings committed` → `rebase clean`. Insert a verify line so
the fixture matches the new pipeline, and fix the three `nextStage` tests at
lines 62–95. The two tests currently named "returns verify when landing
finished…" and "returns pr once verify has reported" become:

```javascript
  it("returns verify when sdd finished but nothing was verified", () => {
    const partial = LEDGER.split("\n").slice(0, 6).join("\n"); // through "sdd complete"
    expect(nextStage(parseLedger(partial))).toBe("verify");
  });

  it("returns learnings once verify has reported", () => {
    const partial = LEDGER.split("\n").slice(0, 6).join("\n");
    const verified = `${partial}\n2026-07-29T16:15:02Z  verify: 3/3 ui criteria passed`;
    expect(nextStage(parseLedger(verified))).toBe("learnings");
  });

  // The skip lines are the reason `nextStage` matches the bare `verify`
  // prefix rather than a pass-specific one: a skipped stage that appends
  // nothing would resolve to `verify` forever.
  it("returns learnings when verify skipped rather than passed", () => {
    const partial = LEDGER.split("\n").slice(0, 6).join("\n");
    for (const line of [
      "verify: skipped (no ui criteria)",
      "verify: skipped (no ui acceptance criteria)",
    ]) {
      const skipped = `${partial}\n2026-07-29T16:15:02Z  ${line}`;
      expect(nextStage(parseLedger(skipped))).toBe("learnings");
    }
  });
```

Read the surrounding fixture before editing and adjust the `slice()` indices to
whatever actually lands on `sdd complete` in that file — the numbers above
assume the header plus five entries. Every other assertion in the file that
mentions `rebase clean` is about durations/timing, not ordering; leave those
alone.

- [ ] **Step 3: Update the verify contract test's placement and coupling blocks**

In `autopilot-verify-contract.test.mjs`, replace the `verify stage placement`
describe (lines 63–74):

```javascript
describe("verify stage placement", () => {
  it("runs after sdd and before learnings", () => {
    const order = ["### `sdd`", "### `verify`", "### `learnings`", "### `land`", "### `pr`"]
      .map((h) => skill.indexOf(h));
    expect(order.every((i) => i > 0)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  // The previous design verified the rebased branch. Moving earlier trades
  // that away deliberately; the section must name the trade rather than
  // quietly dropping the old rationale.
  it("names what moving it before land costs", () => {
    expect(verify).toMatch(/pre-rebase|before `?land/i);
    expect(verify).toMatch(/rebase/i);
  });

  it("says learnings runs after it so the browser evidence is distillable", () => {
    expect(verify).toMatch(/learnings/i);
  });
});
```

Then in the `SKILL.md <-> nextStage coupling for verify` describe (lines
196–235), reorder the `upTo` ledger so `sdd complete` is the last entry before
the injected one, and change the expected stages:

```javascript
  const upTo = (entry) =>
    [
      HEADER,
      "2026-08-24T10:00:00Z  started (phase 1)",
      "2026-08-24T10:01:00Z  design approved",
      "2026-08-24T10:02:00Z  worktree: .claude/worktrees/x (branch x)",
      "2026-08-24T10:03:00Z  spec committed → docs/x.md",
      "2026-08-24T10:04:00Z  plan complete → docs/y.md",
      "2026-08-24T10:05:00Z  sdd complete (3 tasks, 0 parked)",
      ...(entry ? [`2026-08-24T10:06:00Z  ${entry}`] : []),
    ].join("\n");

  it("resumes at verify once sdd has finished", () => {
    expect(nextStage(parseLedger(upTo(null)))).toBe("verify");
  });

  // Every ledger string the section tells the orchestrator to append must
  // clear the stage. A skip line that did not would loop the resume forever.
  it.each([
    "verify: 3/3 ui criteria passed",
    "verify: skipped (no ui criteria)",
  ])('"%s" advances the run to learnings', (entry) => {
    expect(nextStage(parseLedger(upTo(entry)))).toBe("learnings");
  });

  it("parks on the verify park lines", () => {
    expect(nextStage(parseLedger(upTo("PARKED — verify red after fix round: AC3")))).toBe("parked");
  });

  it("lists verify among the stages the resume section documents", () => {
    expect(whole).toMatch(/one of eleven values/i);
    expect(whole).toMatch(/the nine stages/i);
    expect(whole).toMatch(/`sdd`, `verify`, `learnings`/);
  });
```

Leave `describe("verify gating")` and the `browser`-config assertions exactly as
they are — Task 3 owns them. This step's tests will fail until Steps 4–6 land;
that is the point.

- [ ] **Step 4: Run the tests and watch them fail for the right reason**

Run: `npx vitest run plugins/autopilot/scripts/autopilot-ledger-coupling.test.mjs plugins/autopilot/scripts/autopilot-github-ledger-coupling.test.mjs plugins/autopilot/scripts/autopilot-ledger.test.mjs plugins/autopilot/scripts/autopilot-verify-contract.test.mjs`

Expected: FAIL — `expected "learnings" to be "verify"` from the coupling files
and a placement/ordering failure from the contract file. If anything fails with
a message about a *missing* file or import, stop and re-read the file.

- [ ] **Step 5: Reorder `nextStage`**

In `plugins/autopilot/scripts/autopilot-ledger.mjs`, replace the prefix ladder
(lines 36–48) with:

```javascript
  if (has("pr:")) return "done";
  if (has("rebase clean")) return "pr";
  if (has("learnings committed")) return "land";
  // `verify` covers both outcomes that let the run continue — a pass and a
  // documented skip — because a skipped stage that appends nothing would send
  // every resume back through verify forever.
  if (has("verify")) return "learnings";
  if (has("sdd complete")) return "verify";
  if (has("plan complete")) return "sdd";
  if (has("spec committed")) return "plan";
  if (has("worktree:")) return "spec";
  if (has("design approved")) return "setup";
  return "phase1";
```

- [ ] **Step 6: Move the `verify` section in SKILL.md and fix the order prose**

In `plugins/autopilot/skills/autopilot/SKILL.md`:

1. Cut the entire `### \`verify\`` section (from its heading through the line
   before `### \`pr\``) and paste it immediately **after** the `### \`sdd\``
   section, i.e. directly above `### \`learnings\``. Move the text verbatim —
   Task 3 rewrites its body.
2. Replace the section's opening two paragraphs (currently "…runs **after**
   `land`, on the rebased branch…") with:

```markdown
Browser-verify the spec's UI acceptance criteria against the branch `sdd` just
finished writing.

This stage runs **after** `sdd` and **before** `learnings`, on the pre-rebase
tree. That placement is a deliberate trade. The previous design verified the
landed branch, because a semantic conflict can rebase clean and still break the
UI — and that risk is real: the post-rebase `test_command` run inside `land`
remains the only gate after landing, and it sees no pixels.

What the trade buys is worth more. A failed criterion found here is a fix on
the working branch, in the same run, against a tree nobody has rebased and
while the implementation context is still fresh. And `learnings` now runs
*after* `verify`, so it can distil what the browser saw — the strongest
evidence a run produces about whether the spec described the feature correctly,
which previously arrived too late to be distilled at all.
```

3. In the `## Resume` section, change the stage list to the new order:

```markdown
`nextStage` returns one of eleven values: the nine stages — `phase1`, `setup`,
`spec`, `plan`, `sdd`, `verify`, `learnings`, `land`, `pr` — plus `done` and
`parked`.
```

4. In the `#### Whether to run at all` and `#### Outcomes` tables, change every
   "and go to `pr`" to "and go to `learnings`". Leave everything else in the
   section for Task 3.
5. In the `### \`pr\`` section, nothing changes — it still concatenates
   `verify/pr-section.md`, which now simply exists earlier in the run.

In `plugins/autopilot/skills/autopilot-github/SKILL.md`, line ~20, change the
pipeline sentence and the prefix list:

```markdown
The run itself is `autopilot:autopilot`, unchanged. Brainstorm → setup → spec →
plan → sdd → verify → learnings → land → pr, the ledger format, stage
idempotency, the SDD dispatch contracts, and all five parking conditions all
come from that skill. Read it and follow it. Everything in this file is a delta
layered on top.
```

and in rule 2 of "Two structural rules", add `verify` to the prefix list:

```markdown
   by prefix-matching ledger text — `pr:`, `rebase clean`, `learnings committed`,
   `verify`, `sdd complete`, `plan complete`, `spec committed`, `worktree:`,
   `design approved` — and
```

- [ ] **Step 7: Run the full suite**

Run: `npm test`
Expected: PASS, 361 tests. If `autopilot-verify-contract.test.mjs`'s *gating*
tests fail, you changed prose Task 3 owns — revert that wording.

- [ ] **Step 8: Commit**

```bash
git add plugins/autopilot/scripts/autopilot-ledger.mjs \
  plugins/autopilot/scripts/autopilot-ledger.test.mjs \
  plugins/autopilot/scripts/autopilot-ledger-coupling.test.mjs \
  plugins/autopilot/scripts/autopilot-github-ledger-coupling.test.mjs \
  plugins/autopilot/scripts/autopilot-verify-contract.test.mjs \
  plugins/autopilot/skills/autopilot/SKILL.md \
  plugins/autopilot/skills/autopilot-github/SKILL.md
git commit -m "refactor(autopilot): run verify between sdd and learnings"
```

---

### Task 2: Drive `verify` from a derived recipe

**Files:**
- Modify: `plugins/autopilot/scripts/autopilot-verify.mjs` (EXIT map at 13-19;
  `startServer`/`stopServer` at 249-265; `verify()` at 267-360)
- Modify: `plugins/autopilot/scripts/autopilot-verify.test.mjs` (add describes;
  update the `EXIT` describe at 233-241)

**Interfaces:**
- Consumes: `parseCriteria`, `uiCriteria`, `attribute`, `summarize`,
  `formatVerifySection`, `waitForServer`, `playwrightConfig`,
  `playwrightResolvable` — all already exported from this file, all unchanged.
- Produces, for Tasks 3 and 4 to document:
  - `EXIT = { pass: 0, criteria_failed: 1, infrastructure: 2, skipped: 3, cannot_verify: 4 }`
  - `RECIPE_KEYS = ["dev_command", "base_url_command"]` (the required two)
  - `loadRecipe(runDir, readFile?) -> { ok: true, recipe } | { ok: false, reason }`
  - `resolveBaseUrl(command, cwd, opts) -> Promise<{ ok: true, url } | { ok: false, reason }>`
  - `startDevCommand(command, cwd, spawnFn?) -> { child, exitCode: () => number|null }`
  - `teardown({ child, stopCommand, cwd }, runCommand?, kill?) -> "stop_command" | "process-group"`
  - `findingsLines(rows, { round? }) -> object[]`
  - `appendFindings(runDir, lines, append?) -> string` (the path written)
  - `verify()` no longer imports anything from `autopilot-config.mjs` except
    `loadConfig`.

- [ ] **Step 1: Write the failing tests for the recipe, the URL, and teardown**

Append to `plugins/autopilot/scripts/autopilot-verify.test.mjs`, and add
`EXIT, loadRecipe, resolveBaseUrl, teardown, findingsLines` to the import list
at the top:

```javascript
describe("loadRecipe", () => {
  const reader = (files) => (p) => {
    if (!(p in files)) throw new Error("ENOENT");
    return files[p];
  };
  const full = JSON.stringify({
    dev_command: "bash scripts/worktree-up.sh",
    base_url_command: "grep '^WEB_ORIGIN=' apps/api/.env | cut -d= -f2-",
    stop_command: "bash scripts/worktree-down.sh",
    seed_command: "npm run db:seed:test",
  });

  it("reads the recipe the plan stage derived", () => {
    const r = loadRecipe("/run/verify", reader({ "/run/verify/recipe.json": full }));
    expect(r.ok).toBe(true);
    expect(r.recipe.stop_command).toBe("bash scripts/worktree-down.sh");
  });

  // A missing recipe is a park, not a skip: the spec asked for browser
  // verification and the stage cannot deliver it.
  it("reports an absent recipe rather than throwing", () => {
    const r = loadRecipe("/run/verify", reader({}));
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/recipe\.json/);
  });

  it("reports malformed JSON distinctly from an absent file", () => {
    const r = loadRecipe("/run/verify", reader({ "/run/verify/recipe.json": "{oops" }));
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/not valid JSON/);
  });

  it("names the required keys the recipe left out", () => {
    const r = loadRecipe(
      "/run/verify",
      reader({ "/run/verify/recipe.json": JSON.stringify({ dev_command: "x" }) }),
    );
    expect(r.ok).toBe(false);
    expect(r.reason).toContain("base_url_command");
  });

  it("treats stop_command and seed_command as optional", () => {
    const r = loadRecipe(
      "/run/verify",
      reader({
        "/run/verify/recipe.json": JSON.stringify({ dev_command: "x", base_url_command: "y" }),
      }),
    );
    expect(r.ok).toBe(true);
  });
});

describe("resolveBaseUrl", () => {
  const deps = (overrides) => ({
    intervalMs: 10,
    sleep: async () => {},
    now: () => 0,
    devExitCode: () => null,
    ...overrides,
  });

  it("trims the command's stdout into the base url", async () => {
    const r = await resolveBaseUrl("print-url", "/wt", deps({
      runCommand: () => ({ code: 0, stdout: "http://localhost:4310\n", stderr: "" }),
    }));
    expect(r).toEqual({ ok: true, url: "http://localhost:4310" });
  });

  // The motivating case: a worktree-up script assigns ports late, so the
  // command answers nothing until setup finishes.
  it("retries until the command yields a url", async () => {
    let calls = 0;
    const r = await resolveBaseUrl("print-url", "/wt", deps({
      timeoutMs: 1000,
      runCommand: () => (++calls < 3
        ? { code: 1, stdout: "", stderr: "no such file" }
        : { code: 0, stdout: "http://localhost:4310", stderr: "" }),
    }));
    expect(r.ok).toBe(true);
    expect(calls).toBe(3);
  });

  // A clean exit means setup finished, not that the server died.
  it("keeps polling after the dev command exits zero", async () => {
    let calls = 0;
    const r = await resolveBaseUrl("print-url", "/wt", deps({
      timeoutMs: 1000,
      devExitCode: () => 0,
      runCommand: () => (++calls < 2
        ? { code: 1, stdout: "", stderr: "" }
        : { code: 0, stdout: "http://x", stderr: "" }),
    }));
    expect(r.ok).toBe(true);
  });

  it("gives up immediately when the dev command exits non-zero", async () => {
    const r = await resolveBaseUrl("print-url", "/wt", deps({
      timeoutMs: 1000,
      devExitCode: () => 3,
      runCommand: () => ({ code: 0, stdout: "http://x", stderr: "" }),
    }));
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/exited 3/);
  });

  it("gives up at the deadline", async () => {
    let clock = 0;
    const r = await resolveBaseUrl("print-url", "/wt", deps({
      timeoutMs: 100,
      sleep: async () => { clock += 50; },
      now: () => clock,
      runCommand: () => ({ code: 1, stdout: "", stderr: "still booting" }),
    }));
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/no url within 100ms/);
  });
});

describe("teardown", () => {
  // Without this, a script that starts docker containers and backgrounds its
  // app processes leaks the whole stack: the child autopilot holds has already
  // exited, so there is nothing left to signal.
  it("prefers the recipe's stop command", () => {
    const calls = [];
    const how = teardown(
      { child: { pid: 42 }, stopCommand: "bash scripts/worktree-down.sh", cwd: "/wt" },
      (cmd, cwd) => { calls.push([cmd, cwd]); return { code: 0, stdout: "", stderr: "" }; },
      () => calls.push(["kill"]),
    );
    expect(how).toBe("stop_command");
    expect(calls).toEqual([["bash scripts/worktree-down.sh", "/wt"]]);
  });

  // Still correct for the blocking-server case: a dev server that spawns a
  // child compiler must be signalled as a group or the port stays held.
  it("falls back to killing the process group when there is no stop command", () => {
    const killed = [];
    const how = teardown({ child: { pid: 42 }, cwd: "/wt" }, () => {
      throw new Error("must not run a command");
    }, (child) => killed.push(child.pid));
    expect(how).toBe("process-group");
    expect(killed).toEqual([42]);
  });
});

describe("findingsLines", () => {
  const rows = [
    { id: "AC1", text: "login prompt", status: "pass", message: null },
    { id: "AC3", text: "spinner", status: "fail", message: "expected visible" },
    { id: "AC4", text: "toast", status: "missing", message: "no test covered this criterion" },
  ];

  it("emits one seven-field line per unmet criterion, with the task sentinel", () => {
    const lines = findingsLines(rows, { round: 1 });
    expect(lines).toHaveLength(2);
    for (const line of lines) {
      expect(Object.keys(line).sort()).toEqual(
        ["detail", "pattern", "round", "severity", "stage_at_fault", "task", "verdict"],
      );
      expect(line.task).toBe(0);
      expect(line.round).toBe(1);
      expect(line.verdict).toBe("CONFIRMED");
    }
  });

  // The contract is emphatic that stage_at_fault names the stage that produced
  // the bad input, never the stage that surfaced it — so no "verify" value.
  it("uses only the four existing stage_at_fault values", () => {
    for (const line of findingsLines(rows, {})) {
      expect(["brief", "plan", "spec", "implementation"]).toContain(line.stage_at_fault);
    }
  });

  it("names the criterion in the detail so a cluster stays readable", () => {
    const [failed] = findingsLines(rows, {});
    expect(failed.detail).toContain("AC3");
    expect(failed.detail).toContain("expected visible");
  });

  // Absence of evidence: without the clean line, a run with no findings is
  // indistinguishable from a run whose findings were never written.
  it("emits one clean line when every criterion passed", () => {
    const lines = findingsLines([rows[0]], {});
    expect(lines).toEqual([{ task: 0, clean: true }]);
  });
});
```

Also replace the existing `describe("EXIT")` block with:

```javascript
describe("EXIT", () => {
  // The stage branches on these: a failed criterion earns a fix round, a dead
  // dev server does not, and a run with no (ui) criteria is neither.
  it("maps every outcome to a distinct code", () => {
    expect(EXIT).toEqual({
      pass: 0,
      criteria_failed: 1,
      infrastructure: 2,
      skipped: 3,
      cannot_verify: 4,
    });
  });
});
```

- [ ] **Step 2: Run the new tests and watch them fail**

Run: `npx vitest run plugins/autopilot/scripts/autopilot-verify.test.mjs`
Expected: FAIL with `loadRecipe is not a function` (and siblings), plus the
`EXIT` mismatch on `unconfigured`/`half_configured`.

- [ ] **Step 3: Implement the recipe, URL resolution, lifecycle and findings**

In `plugins/autopilot/scripts/autopilot-verify.mjs`:

1. Change the import on line 2 to add `appendFileSync`, and the import on
   line 7 to `import { loadConfig } from "./autopilot-config.mjs";` — the
   browser-config helpers are no longer used here.
2. Replace the `EXIT` map and its comment:

```javascript
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
```

3. Add, next to the other helpers:

```javascript
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
```

4. Replace `startServer`/`stopServer` with:

```javascript
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
```

5. Add the findings producers:

```javascript
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
```

6. Replace the body of `verify()` with:

```javascript
export async function verify({ configPath, runDir, cwd, specPath }) {
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

  if (seed_command) {
    const seeded = run(seed_command, cwd);
    if (seeded.code !== 0) {
      return { code: EXIT.infrastructure, message: `seed command failed: ${seeded.stderr.trim()}` };
    }
  }

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
    appendFindings(runDir, findingsLines(rows, { round: 1 }));

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
```

7. In `main()`'s `skip` branch, change the default reason to
   `"no ui acceptance criteria"`. Leave `criteria` and `run` otherwise as they
   are; `run` still takes `--config`, `--run-dir`, `--cwd` and `--spec`.
8. Change `waitForServer`'s default `timeoutMs` from `60000` to `120000` so an
   omitted budget matches the documented default.

- [ ] **Step 4: Run the verify tests**

Run: `npx vitest run plugins/autopilot/scripts/autopilot-verify.test.mjs`
Expected: PASS.

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: PASS except `autopilot-verify-contract.test.mjs`'s *gating* block,
which still pins the old `browser`-config prose. Task 3 fixes it. If anything
else fails, fix it here.

Note for the reviewer: this task deliberately leaves
`validateBrowserConfig` / `browserConfigured` / `BROWSER_KEYS` exported from
`autopilot-config.mjs` and unused by this file. Task 3 removes them together
with the prose that documents them.

- [ ] **Step 6: Commit**

```bash
git add plugins/autopilot/scripts/autopilot-verify.mjs \
  plugins/autopilot/scripts/autopilot-verify.test.mjs
git commit -m "feat(autopilot): drive verify from a derived per-run recipe"
```

---

### Task 3: Retire the `browser` config surface and rewrite the verify contract

**Files:**
- Modify: `plugins/autopilot/scripts/autopilot-config.mjs` (delete lines 35-70;
  the `browser` merge comment at 100-106; the warning at 174-185)
- Modify: `plugins/autopilot/scripts/autopilot-config.test.mjs` (add a
  `browser.ready_timeout_ms` describe)
- Modify: `plugins/autopilot/autopilot.default.json:19-21`
- Modify: `plugins/autopilot/skills/autopilot/SKILL.md` (the `### \`verify\``
  section body; the `## Parking` list; the "No `browser` config" rationalization row)
- Modify: `plugins/autopilot/scripts/autopilot-verify-contract.test.mjs`
  (the `BROWSER_KEYS` import; `describe("verify gating")`; `describe("verify
  prerequisites")`; the parking describe)

**Interfaces:**
- Consumes: `EXIT` and `RECIPE_KEYS` from Task 2's `autopilot-verify.mjs`.
- Produces: `autopilot-config.mjs` exporting `ROLES`, `EFFORTS`, `GITHUB_KEYS`,
  `validateGithubConfig`, `mergeConfig`, `validateConfig`, `loadConfig` —
  and **no** `BROWSER_KEYS`, `validateBrowserConfig`, or `browserConfigured`.

- [ ] **Step 1: Write the failing config tests**

Append to `plugins/autopilot/scripts/autopilot-config.test.mjs`:

```javascript
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
```

- [ ] **Step 2: Run the config tests and watch them fail**

Run: `npx vitest run plugins/autopilot/scripts/autopilot-config.test.mjs`
Expected: FAIL — `expected [ 'dev_command', 'base_url' ] to be undefined`, and
`expected { ready_timeout_ms: 60000 } to equal { ready_timeout_ms: 120000 }`.

- [ ] **Step 3: Shrink the config schema**

In `plugins/autopilot/scripts/autopilot-config.mjs`:

1. Delete the whole `BROWSER_KEYS` / `validateBrowserConfig` /
   `browserConfigured` block (the doc comment at lines 35–46 through line 70).
2. Replace the `browser` merge comment (lines 100–102) with:

```javascript
  // Likewise for `browser`: a project overriding nothing in the block must
  // still inherit the default `ready_timeout_ms`, leaving the verify stage
  // with a budget rather than none.
```

3. Delete the half-configured warning (the comment at lines 173–177 and the
   `if (missingBrowser…)` block through line 185). Keep the
   `browser.ready_timeout_ms` integer check exactly as it is.

In `plugins/autopilot/autopilot.default.json`, raise the default:

```json
  "browser": {
    "ready_timeout_ms": 120000
  },
```

- [ ] **Step 4: Run the config tests**

Run: `npx vitest run plugins/autopilot/scripts/autopilot-config.test.mjs`
Expected: PASS.

- [ ] **Step 5: Rewrite the verify section of SKILL.md**

In `plugins/autopilot/skills/autopilot/SKILL.md`, inside the `### \`verify\``
section (which Task 1 moved between `sdd` and `learnings`), replace
`#### Whether to run at all` and `#### What the project must already have`
with:

````markdown
#### Whether to run at all

**Writing a `(ui)` acceptance criterion in the spec turns this stage on.**
There is no flag, no path glob, no auto-detection heuristic, and nothing to
configure.

Read the criteria out of the committed spec:

```bash
node "$AP/scripts/autopilot-verify.mjs" criteria <path-to-spec>
```

It prints the parsed criteria and a `ui` count, and exits non-zero when the
spec has no `## Acceptance criteria` section or an item is untagged. Then:

| Condition | Action |
|---|---|
| `ui` count is 0 | Append `verify: skipped (no ui criteria)` and go to `learnings` |
| `(ui)` criteria and a usable `recipe.json` | Run |
| `(ui)` criteria, no usable `recipe.json` | **Park** — `PARKED — verify cannot run: <reason>` |
| `(ui)` criteria, `@playwright/test` absent | **Park** — same line |
| The criteria command exits non-zero | **Park** — the spec cannot state what done means |

The skip line is not optional bookkeeping. `nextStage` resumes at `learnings`
by matching an entry starting `verify`, so a stage that skips silently sends
every later resume back through `verify` forever.

A backend repo therefore costs nothing: it writes no `(ui)` criteria and this
stage never speaks. The two parks are the deliberate part. A criterion with no
test is a failure, not a pass — so a run that declared UI criteria and then
could not open a browser must not report success. Skipping there would report
green on the exact gap this stage exists to close.

#### The recipe the `plan` stage derived

The commands come from `.superpowers/autopilot/<run>/verify/recipe.json` in the
**main checkout**, written by the `plan` stage by reading the project the way a
new contributor would. Nothing here is configured by hand:

```json
{
  "dev_command":      "bash scripts/worktree-up.sh",
  "base_url_command": "grep '^WEB_ORIGIN=' apps/api/.env | cut -d= -f2-",
  "stop_command":     "bash scripts/worktree-down.sh",
  "seed_command":     "npm run db:seed:test"
}
```

`dev_command` and `base_url_command` are required; `stop_command` and
`seed_command` are optional. Do not write this file at this stage and do not
patch it by hand — a recipe that verify repaired for itself would hide the
derivation bug rather than surfacing it as a park.

`base_url_command` runs **in the worktree, after `dev_command`**, and its
trimmed stdout is the base URL. It is never written down and never persisted: a
worktree-up script that derives ports from the worktree name and reassigns them
when a block is occupied cannot state its URL in advance, and a static one is
wrong on the second concurrent run.

#### What the project must already have

`@playwright/test` resolvable from the project, and its browsers installed.
The script checks this before it starts anything and returns exit 4 if it is
missing.

**Autopilot never installs it.** A background `npx playwright install` on an
unattended run downloads hundreds of megabytes into a developer's machine
without asking, and a run that quietly provisions its own tooling is a run
whose green result nobody can reproduce. The park message names the two
commands to run; a human runs them once.
````

Then, further down in the same section, replace the paragraph beginning "The
script owns everything mechanical" with:

```markdown
The script owns everything mechanical: it reads the recipe, runs the optional
`seed_command`, starts `dev_command` in its own process group, resolves the base
URL with `base_url_command`, generates the Playwright config, polls the URL
until it answers or `ready_timeout_ms` (default 120000) expires, runs the specs,
and tears the stack down with `stop_command` in a `finally` — falling back to
killing the process group only when the recipe supplies no stop command. A
clean `dev_command` exit means setup finished, not that the server died; only a
non-zero exit is a failure. Do not start a dev server by hand, and do not check
the port yourself — a stray server from a hand-started run holds the port and
makes the next run look broken.
```

Replace the `#### Outcomes` exit table with:

```markdown
| Exit | Meaning | Action |
|---|---|---|
| 0 | Every criterion passed | Append `verify: <n>/<n> ui criteria passed` and continue |
| 1 | A criterion failed | One fix round, below |
| 2 | Infrastructure — server never answered, no report produced | **Park.** Not a fix round: the branch was never exercised |
| 3 | No `(ui)` criteria | Skip, as above |
| 4 | Cannot verify despite `(ui)` criteria — no usable recipe, or `@playwright/test` absent | **Park** |
```

And replace the findings paragraph at the end of the section with:

```markdown
The script appends the findings itself, to
`.superpowers/autopilot/<run>/findings.jsonl` in the **main checkout**, under
the existing seven-field contract — `task`, `round`, `severity`,
`stage_at_fault`, `pattern`, `detail`, `verdict` — with `task: 0` as the
sentinel for "not a numbered SDD task", and `{"task": 0, "clean": true}` when
every criterion passed. `stage_at_fault` stays inside the same four values:
`implementation` when the UI does not do what the criterion says, `spec` when
the criterion turned out to be ambiguous as written. Invent no new value — and
in particular no `verify` value: the field names the stage that produced the
bad input, never the stage that surfaced it. Do not append these lines
yourself; the script has already written them.

`learnings` now runs immediately after this stage, which is what lets it read
browser evidence and review evidence in one pass.
```

- [ ] **Step 6: Update the parking list and the rationalization row**

In the `## Parking` section, keep the count at nine and replace the
`browser` half-configured bullet:

```markdown
- The spec carries no usable `## Acceptance criteria` section
- UI criteria were declared but cannot be verified — no usable verify recipe,
  or `@playwright/test` is absent
```

In `## Common Rationalizations`, replace the "No `browser` config" row:

| Excuse | Reality |
|---|---|
| "No verify recipe, so I'll just start the dev server myself and look" | A hand-started server holds the port after the run and makes the next one look broken. No `(ui)` criteria skips; a `(ui)` criterion with no recipe parks. |

- [ ] **Step 7: Rewrite the contract test's gating and prerequisite blocks**

In `plugins/autopilot/scripts/autopilot-verify-contract.test.mjs`:

1. Change the import on line 18 from `BROWSER_KEYS` to
   `import { EXIT, RECIPE_KEYS } from "./autopilot-verify.mjs";` (merging with
   the existing `EXIT` import) and drop the `autopilot-config.mjs` import.
2. Replace `describe("verify gating")` with:

```javascript
describe("verify gating", () => {
  // The one-sentence enablement answer. A feature whose activation rule is
  // only inferable from source is one most users never knowingly turn on.
  it("says a (ui) acceptance criterion is what turns the stage on", () => {
    expect(verify).toMatch(/writing a `?\(ui\)`? acceptance criterion/i);
    expect(verify).toMatch(/nothing to configure|no flag/i);
  });

  it("skips a spec with no ui criteria and parks one that cannot be verified", () => {
    expect(verify).toMatch(/skipped \(no ui criteria\)/);
    expect(verify).toMatch(/PARKED — verify cannot run/);
  });

  it("explains why a skip must still append a ledger line", () => {
    expect(verify).toMatch(/back through `?verify`? forever|forever/i);
  });

  it("names the recipe the plan stage derived and its required keys", () => {
    expect(verify).toContain(".superpowers/autopilot/<run>/verify/recipe.json");
    for (const key of RECIPE_KEYS) expect(verify).toContain(key);
    expect(verify).toContain("stop_command");
    expect(verify).toContain("seed_command");
  });

  // Both lifecycle corrections. Neither is checkable from code alone: the
  // section is what tells a resuming orchestrator not to "fix" them.
  it("says a clean dev_command exit is setup finishing, not a death", () => {
    expect(verify).toMatch(/clean `?dev_command`? exit means setup finished/i);
    expect(verify).toMatch(/only a non-zero exit is a failure/i);
  });

  it("says teardown runs stop_command in a finally", () => {
    expect(verify).toMatch(/`stop_command` in a `finally`/);
    expect(verify).toMatch(/falling back to killing the process group/i);
  });

  it("says the base url is resolved in the worktree after dev_command", () => {
    expect(verify).toMatch(/in the worktree, after `?dev_command`?/i);
    expect(verify).toMatch(/never written down|never persisted/i);
  });
});
```

3. In `describe("verify prerequisites")`, change the exit reference:

```javascript
  it("names @playwright/test as the project's responsibility", () => {
    expect(verify).toMatch(/@playwright\/test/);
    expect(verify).toMatch(/resolvable from the project/i);
    expect(verify).toMatch(/exit 4/i);
  });
```

4. In `describe("verify outcomes")`, extend the findings test:

```javascript
  it("reuses the four existing stage_at_fault values and the seven fields", () => {
    expect(verify).toMatch(/invent no new value/i);
    expect(verify).toContain("findings.jsonl");
    expect(verify).toContain('"task": 0, "clean": true');
    for (const field of [
      "task", "round", "severity", "stage_at_fault", "pattern", "detail", "verdict",
    ]) {
      expect(verify).toContain(field);
    }
  });
```

5. In `describe("parking conditions include the verify failures")`, replace the
   `half-configured` assertion:

```javascript
    expect(parking).toMatch(/cannot be verified/i);
```

- [ ] **Step 8: Run the full suite**

Run: `npm test`
Expected: PASS. Any contract failure names the exact phrase that drifted —
reconcile the SKILL.md wording with the assertion rather than deleting either.

- [ ] **Step 9: Commit**

```bash
git add plugins/autopilot/scripts/autopilot-config.mjs \
  plugins/autopilot/scripts/autopilot-config.test.mjs \
  plugins/autopilot/autopilot.default.json \
  plugins/autopilot/skills/autopilot/SKILL.md \
  plugins/autopilot/scripts/autopilot-verify-contract.test.mjs
git commit -m "refactor(autopilot): replace browser config with the verify recipe"
```

---

### Task 4: Derive the recipe in `plan`, and document how to turn verify on

**Files:**
- Modify: `plugins/autopilot/skills/autopilot/SKILL.md` (the `### \`plan\``
  section — add a recipe-derivation subsection before `Append: plan complete`)
- Modify: `plugins/autopilot/scripts/autopilot-verify-contract.test.mjs`
  (add a `plan stage derives the verify recipe` describe)
- Modify: `README.md` (the autopilot blurb, the config table, the test count)

**Interfaces:**
- Consumes: `RECIPE_KEYS` and the recipe shape from Task 2; the verify-section
  wording from Task 3.
- Produces: nothing other tasks depend on. This is the last task.

- [ ] **Step 1: Write the failing contract test for the plan section**

Append to `plugins/autopilot/scripts/autopilot-verify-contract.test.mjs`:

```javascript
describe("plan stage derives the verify recipe", () => {
  const plan = unwrap(section(skill, "plan"));

  it("writes it to the per-run verify directory in the main checkout", () => {
    expect(plan).toContain(".superpowers/autopilot/<run>/verify/recipe.json");
    expect(plan).toMatch(/main checkout/i);
  });

  // Same harness constraint as the ledger: Write/Edit cannot reach the main
  // checkout from a worktree session, but Bash redirects can.
  it("names the Bash heredoc as how the file gets written", () => {
    expect(plan).toMatch(/heredoc/i);
  });

  it("names every recipe key and which two are required", () => {
    for (const key of [...RECIPE_KEYS, "stop_command", "seed_command"]) {
      expect(plan).toContain(key);
    }
    expect(plan).toMatch(/required/i);
  });

  it("tells the stage where to read the project's dev setup from", () => {
    expect(plan).toMatch(/package\.json/);
    expect(plan).toMatch(/README/);
  });

  // Rederived, not committed: a committed recipe is a second copy of the dev
  // setup that drifts silently, because nothing runs it except autopilot.
  it("says it is rederived every run and never committed", () => {
    expect(plan).toMatch(/rederived|derived every run/i);
    expect(plan).toMatch(/never committed|not committed/i);
  });

  it("skips the derivation when the spec declares no ui criteria", () => {
    expect(plan).toMatch(/\(ui\)/);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run plugins/autopilot/scripts/autopilot-verify-contract.test.mjs`
Expected: FAIL — six failures in the new describe, each naming a phrase the
`plan` section does not yet contain.

- [ ] **Step 3: Add the recipe-derivation instruction to the `plan` section**

In `plugins/autopilot/skills/autopilot/SKILL.md`, immediately before
`Append: \`plan complete → <path> (<n> tasks)\``, insert:

````markdown
#### Derive the verify recipe

If the committed spec carries no `(ui)` acceptance criterion, skip this — the
`verify` stage will skip too, and a recipe nothing reads is waste. Otherwise,
derive one now, because `verify` runs next.

Read the project the way a new contributor would — `package.json` scripts, any
compose file, `scripts/`, the README — and answer four questions:

| Key | Question | Required |
|---|---|---|
| `dev_command` | What one command brings the app up? | yes |
| `base_url_command` | What one command prints the URL it came up on? | yes |
| `stop_command` | What one command takes it back down? | no |
| `seed_command` | What one command loads test data, if any is needed? | no |

Write the answers to `.superpowers/autopilot/<run>/verify/recipe.json` in the
**main checkout**. A worktree-isolated session cannot Write or Edit there, but
Bash redirects work — use a heredoc, the same way the `verify` stage writes its
spec files:

```bash
mkdir -p .superpowers/autopilot/<run>/verify
cat > .superpowers/autopilot/<run>/verify/recipe.json <<'EOF'
{
  "dev_command":      "bash scripts/worktree-up.sh",
  "base_url_command": "grep '^WEB_ORIGIN=' apps/api/.env | cut -d= -f2-",
  "stop_command":     "bash scripts/worktree-down.sh",
  "seed_command":     "npm run db:seed:test"
}
EOF
```

Three rules travel with it:

1. **`base_url_command` prints the URL and nothing else.** It runs in the
   worktree after `dev_command`, and its trimmed stdout *is* the base URL. Read
   it from wherever the project already states it — an env file, `docker
   compose port`, a `--print-url` flag. Prefer that to a hardcoded port: a
   worktree-up script that reassigns occupied ports has no fixed URL to state.
2. **The recipe is rederived every run and never committed.** It is gitignored
   under `.superpowers/`. A committed recipe is a second copy of the project's
   dev setup that drifts the moment someone changes a port or renames a script,
   and it drifts silently, because nothing runs it except autopilot.
3. **Do not verify the recipe by running it.** Nothing checks it at the moment
   it is written; a wrong derivation surfaces as a `verify` park several stages
   later. That is the accepted cost of not keeping a hand-maintained copy of
   facts the repository already states.
````

- [ ] **Step 4: Run the contract test**

Run: `npx vitest run plugins/autopilot/scripts/autopilot-verify-contract.test.mjs`
Expected: PASS.

- [ ] **Step 5: Update the README**

In `README.md`:

1. In the autopilot blurb (lines 19–22), name the stage:

```markdown
Takes a task from idea to pull request. Phase 1 is an interactive brainstorm —
clarifying questions one at a time, then a design stated once, with no
approval gate afterward. Phase 2 runs unattended from there through spec,
plan, implementation, browser verification, landing, and PR.
```

2. After the `test_command` paragraph (after line 68), add the enablement
   answer:

````markdown
#### Turning browser verification on

**Writing a `(ui)` acceptance criterion in the spec turns it on.** There is no
flag and nothing to configure:

```markdown
## Acceptance criteria

- AC1 (ui) — a signed-out visitor clicking "Save" sees the login prompt
- AC2 (non-ui) — POST /items rejects an empty title with 422
```

The `verify` stage — between `sdd` and `learnings` — then drives Playwright
against the running app and reports each criterion in the PR. A repo that
writes no `(ui)` criterion never pays for it, and the stage never speaks. What
the app needs is `@playwright/test` as a devDependency, with its browsers
installed; autopilot never installs it. The commands that bring the app up are
**derived**, not configured: the `plan` stage reads `package.json`, compose
files, `scripts/` and the README, and writes a per-run recipe under
`.superpowers/`. A declared `(ui)` criterion the stage cannot verify parks the
run rather than reporting green.
````

3. Add a row to the config table (after `roles`):

```markdown
| `browser.ready_timeout_ms` | `120000` | How long `verify` waits for the app to answer before calling the stack dead |
```

4. Fix the stale test count on line 106 to whatever `npm test` actually reports
   after this branch:

```bash
npm test 2>&1 | tail -5
```

Put that number in: `npm test                                    # vitest, <n> tests`.

- [ ] **Step 6: Run the full suite one last time**

Run: `npm test`
Expected: PASS — every file green, and the count matches what you wrote into
the README.

- [ ] **Step 7: Commit**

```bash
git add plugins/autopilot/skills/autopilot/SKILL.md \
  plugins/autopilot/scripts/autopilot-verify-contract.test.mjs \
  README.md
git commit -m "docs(autopilot): derive the verify recipe in plan and document enablement"
```

---

## Task-count note

Four tasks, inside the 3–5 budget. The seams are not arbitrary: Task 1 is a
prefix-order change whose blast radius is three coupling test files, Task 2 is a
single-script rewrite, Task 3 deletes a config surface *and* the prose that
documents it (they cannot be reviewed apart — the contract tests pin both), and
Task 4 adds a producer instruction to a different stage entirely. Task 2 must
precede Task 3, because Task 2 is what stops importing the exports Task 3
deletes.

## Self-review

**Spec coverage:**

| Spec section | Task |
|---|---|
| Stage reorder + `nextStage` ladder | 1 |
| The trade-off paragraph ("what moving it costs") | 1 |
| Acceptance criteria are the gate / four situations | 2 (code), 3 (prose) |
| Recipe derived, not configured | 4 (producer), 2 (consumer), 3 (prose) |
| Base URL resolved at run time | 2, 3 |
| Lifecycle: zero exit is not a death; `stop_command` in a `finally` | 2, 3 |
| Nothing generated enters the repository (symlink, run dir) | unchanged, already implemented |
| Playwright CLI, not a browser tool | unchanged |
| Failure taxonomy (0/1/2/3/4) | 2, 3 |
| Findings with `task: 0` and the clean line | 2, 3 |
| Configuration: one surviving key, default 120000 | 3 |
| Documentation is in scope (README + skill) | 3, 4 |
| Known limitation (screenshots not in PR) | unchanged — the `pr` section already says it |

**Type consistency:** `EXIT.skipped` and `EXIT.cannot_verify` are the names used
in Tasks 2 and 3 (never `unconfigured`/`half_configured`). `RECIPE_KEYS` names
only the two required keys and is used that way in Tasks 2, 3 and 4.
`findingsLines(rows, { round })` / `appendFindings(runDir, lines)` /
`resolveBaseUrl(command, cwd, opts)` / `teardown({ child, stopCommand, cwd })` /
`startDevCommand(command, cwd)` are used with those exact signatures everywhere
they appear.
