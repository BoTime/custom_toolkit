# SDD Dispatch Quieting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a four-rule verification contract to autopilot's `sdd` dispatch prompt so the dispatched agent stops narrating verification work into the developer's transcript.

**Architecture:** One prose addition to `plugins/autopilot/skills/autopilot/SKILL.md`'s `sdd` section, placed alongside the existing Model Selection override and written in the same style — literal text the dispatched agent can act on. One new test file that reads SKILL.md and asserts the contract is present, because prose has no other regression guard.

**Tech Stack:** Node ESM, vitest. No new dependencies.

## Global Constraints

- The contract is **literal text in the dispatch prompt**, not a reference to a policy the agent cannot read. This mirrors the existing Model Selection override, which exists because naming "the roles block" to SDD is not actionable.
- **No ledger entry strings change.** `autopilot-ledger-coupling.test.mjs` pins SKILL.md's ledger vocabulary to `nextStage`; this work must leave every one of those strings untouched.
- Rules must **name the specific observed patterns** (`md5` comparisons, `echo` separators, throwaway repos, idempotence re-runs). A general "be concise" has no purchase on an agent that believes each individual check is justified.
- The contract **redirects** verification, it does not remove it. Rule 1 names `test_command` as the gate.
- Test command: `npx vitest run`.

---

### Task 1: Pin the verification contract with a test

**Files:**
- Create: `plugins/autopilot/scripts/autopilot-sdd-contract.test.mjs`
- Test: same file

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: nothing later tasks import. This is a standalone guard on SKILL.md's prose.

**Context:** No existing test reads SKILL.md — `autopilot-ledger-coupling.test.mjs` hand-writes its strings and documents that choice in its header. This is the first test that reads the file, so it resolves the path from `import.meta.url` rather than assuming a working directory.

- [ ] **Step 1: Write the failing test**

Create `plugins/autopilot/scripts/autopilot-sdd-contract.test.mjs`:

```javascript
// SKILL.md's `sdd` section carries a verification contract: four rules that
// stop the dispatched agent from narrating verification into the developer's
// transcript. The contract is prose, so nothing else fails if it is deleted,
// reworded past recognition, or moved out of the `sdd` section — where a
// dispatched agent would never read it.
//
// This test reads SKILL.md and asserts each rule is present within the `sdd`
// section. It matches on the load-bearing phrases, not full sentences, so
// ordinary editing does not break it but removal does.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const SKILL_PATH = join(HERE, "..", "skills", "autopilot", "SKILL.md");

/** The `### \`sdd\`` section: from its heading to the next `###` heading. */
function sddSection(markdown) {
  const start = markdown.indexOf("### `sdd`");
  if (start === -1) throw new Error("SKILL.md has no `### \\`sdd\\`` section");
  const rest = markdown.slice(start + 1);
  const end = rest.indexOf("\n### ");
  return end === -1 ? rest : rest.slice(0, end);
}

describe("sdd dispatch verification contract", () => {
  const section = sddSection(readFileSync(SKILL_PATH, "utf8"));

  it("names test_command as the verification gate", () => {
    expect(section).toContain("test_command");
  });

  it("forbids narrating verification", () => {
    expect(section).toMatch(/do not narrate/i);
  });

  it("names the specific noise patterns it forbids", () => {
    // Naming them is the point — a general "be concise" does not bind an
    // agent that believes each individual check is justified.
    expect(section).toMatch(/md5/i);
    expect(section).toMatch(/echo/i);
    expect(section).toMatch(/idempotence/i);
  });

  it("forbids throwaway repositories for proving guards fire", () => {
    expect(section).toMatch(/throwaway/i);
  });

  it("keeps the contract inside the sdd section, not merely in the file", () => {
    // A rule outside the `sdd` section never reaches the dispatched agent.
    expect(section).toMatch(/verification contract/i);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run plugins/autopilot/scripts/autopilot-sdd-contract.test.mjs`

Expected: FAIL. Five assertions fail because the contract does not exist yet. `test_command` may already appear elsewhere in the file but not within the `sdd` section, so that assertion fails too. Confirm the failures name the missing phrases rather than a path error — a path error means `SKILL_PATH` is wrong and must be fixed before proceeding.

- [ ] **Step 3: Commit the failing test**

```bash
git add plugins/autopilot/scripts/autopilot-sdd-contract.test.mjs
git commit -m "test: pin the sdd dispatch verification contract"
```

---

### Task 2: Add the verification contract to the dispatch prompt

**Files:**
- Modify: `plugins/autopilot/skills/autopilot/SKILL.md` — insert after line 245 (the paragraph ending "without needing to consult autopilot's config itself.") and before the "Answer these gates from config rather than asking:" line at 247.
- Test: `plugins/autopilot/scripts/autopilot-sdd-contract.test.mjs` (from Task 1)

**Interfaces:**
- Consumes: the test from Task 1.
- Produces: nothing importable.

**Placement rationale:** the contract goes after the Model Selection override and before the gates table. Both are instructions to the same dispatched agent, so they belong together; the gates table answers questions SDD asks the controller, which is a different concern.

- [ ] **Step 1: Insert the contract**

In `plugins/autopilot/skills/autopilot/SKILL.md`, find this line (currently 245):

```
internal dispatch roles without needing to consult autopilot's config itself.
```

Immediately after it, insert a blank line and then this text verbatim:

```markdown
The dispatch prompt also carries a verification contract. Without it the
stage agent narrates its own verification into the developer's transcript —
`md5` comparisons before and after a re-run, `echo` separators, throwaway
repositories built to prove a guard fires — and each one renders as a tool
call the developer cannot act on. SDD's implementer prompt already caps what
an agent *returns* ("under 15 lines — the detail lives in the report file");
nothing caps the work it narrates getting there. This is that cap, and it
applies to the agent we dispatch. Include text equivalent to:

> Verification contract for this stage:
>
> 1. **Verify through `test_command`.** The project states its test command in
>    `.claude/autopilot.json`. That is the gate. Do not construct ad-hoc
>    equivalents to check the same thing.
> 2. **Do not narrate verification.** No `md5` before/after comparisons, no
>    `echo` separators, no `ls` existence probes, no re-running a command to
>    demonstrate it is idempotent. If a check is worth running, its result is
>    worth recording in the report file — not in the transcript.
> 3. **Do not build throwaway repositories to prove a guard fires.** A guard
>    that needs testing needs a test in the suite.
> 4. **One gate, one result.** Run the suite once per verification point and
>    report the outcome.
>
> This redirects verification; it does not remove it. Run the gate in rule 1.

Rules 2 and 3 name patterns observed in real runs. Naming them is
load-bearing: a general instruction to be concise has no purchase on an agent
that believes each individual check is justified.

This reduces transcript noise; it does not eliminate it. SDD's own nested
dispatches — implementer, task reviewer, re-reviewer — run under prompts
belonging to `superpowers:subagent-driven-development`, and their tool calls
still render.
```

- [ ] **Step 2: Run the contract test to verify it passes**

Run: `npx vitest run plugins/autopilot/scripts/autopilot-sdd-contract.test.mjs`

Expected: PASS, 5 tests.

- [ ] **Step 3: Run the full suite to verify nothing regressed**

Run: `npx vitest run`

Expected: PASS. All previously passing tests still pass — in particular `autopilot-ledger-coupling.test.mjs` (10 tests), which pins SKILL.md's ledger vocabulary. This change touches no ledger entry strings, so a failure there means the edit landed in the wrong place.

- [ ] **Step 4: Verify the contract sits in the right section**

Run:

```bash
awk '/^### `sdd`/,/^### `land`/' plugins/autopilot/skills/autopilot/SKILL.md | grep -c "Verification contract"
```

Expected: `1`. A `0` means the text landed outside the `sdd` section and would never reach the dispatched agent.

- [ ] **Step 5: Commit**

```bash
git add plugins/autopilot/skills/autopilot/SKILL.md
git commit -m "feat(autopilot): add a verification contract to the sdd dispatch"
```

---

## Self-Review

**Spec coverage:**

| Spec requirement | Task |
|---|---|
| Rule 1 — verify through `test_command` | Task 2, Step 1 |
| Rule 2 — do not narrate verification | Task 2, Step 1 |
| Rule 3 — no throwaway repositories | Task 2, Step 1 |
| Rule 4 — one gate, one result | Task 2, Step 1 |
| Contract present in the `sdd` section | Task 1 test; Task 2 Step 4 |
| Ledger coupling tests still pass | Task 2, Step 3 |
| Scope excludes SDD's nested dispatches | Task 2, Step 1 — stated in the inserted text |
| Failure mode: contract must not remove verification | Task 2, Step 1 — closing line of the quoted block |

No spec requirement is unimplemented. The spec's "open question" (filing a Claude Code feature request) is explicitly not an implementation task and has no plan entry.

**Placeholder scan:** No TBDs, no "similar to Task N", no "add appropriate error handling". Every step contains the literal text or command to run.

**Type consistency:** No types or signatures are introduced. The one identifier crossing task boundaries is the test file path `plugins/autopilot/scripts/autopilot-sdd-contract.test.mjs`, spelled identically in both tasks.

**One note on the test's nature:** it asserts the contract's *presence*, not its *effect*. Whether the dispatched agent actually obeys it is observational — the next run's `sdd` stage should show materially fewer `IN`/`OUT` blocks from the stage agent itself. The spec states this; the test cannot close that gap and does not pretend to.
