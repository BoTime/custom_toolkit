# Mechanical stage dispatch for autopilot

**Date:** 2026-08-25
**Status:** Approved design, ready for planning
**Source:** GitHub issue #25 — "autopilot: make stage dispatch mechanical so the
orchestrator stops running stages inline (lever 5 from #23)"

## Problem

`plugins/autopilot/skills/autopilot/SKILL.md` states the rule the whole design
rests on:

> Stage outputs go to files; a stage returns a status line and a path, never
> content. This is what keeps your context small enough to avoid compaction.

Measured across 55 confirmed orchestrator sessions (issue #23), it does not
hold:

| Metric | Measured | Design intent |
|---|---|---|
| Median turns | **133** | ~40 |
| Median Bash calls | 42 | ~20 |
| Median Agent dispatches | **4** | ~7–9 |
| Median peak context | 165k | small |
| Tool results >3KB resident | **5.0 MB** (max 386KB) | none |

The controller runs stages inline instead of dispatching them. Every inline
stage's tool output stays resident and is re-billed on every later turn, and
cost is roughly quadratic in session length — a turn in a long session costs
3.6× the same turn in a short one. 69% of spend is cache reads of accumulated
run content, which no amount of prompt trimming touches.

The cause is upstream of discipline. SKILL.md's "Composing a dispatch" section
hands the orchestrator a heredoc recipe and tells it to assemble each stage's
prompt itself. Assembling a prompt means holding the prompt — and, in practice,
means reading the files around it "just to check", which is the behaviour the
Common Rationalizations table already argues against three separate times. The
rule is prose, with nothing enforcing it.

Issue #27 (landed in v1.8.1) took the first half of the fix: it extracted the
static contract text into `references/dispatch/*.md` so fragments travel into a
prompt by `cat` without passing through the orchestrator's context. This spec is
the second half — the thing that assembles them.

## Approach

Make dispatch mechanical rather than exhortative, so the cheap path and the
correct path are the same path.

Add one script, `plugins/autopilot/scripts/autopilot-dispatch.mjs`, that is the
one thing that builds a subagent definition. The orchestrator runs it, gets back
a single line of stdout — the path — and dispatches the Agent by that path. It
never composes a prompt in its own context, because there is no longer a recipe
for doing so.

The lever is that a correct dispatch now costs the orchestrator one short tool
result instead of a heredoc, several `cat` appends, and the temptation to read
what it just wrote.

## Architecture

### One script, one output line

```
node "$AP/scripts/autopilot-dispatch.mjs" <stage> --run=<run> [--key=value ...]
```

Writes `.superpowers/autopilot/<run>/agents/<stage>.md` and prints **that path
and nothing else**. One line on stdout, terminated by a newline. No banner, no
"wrote N bytes", no echo of the composed prompt. Diagnostics go to stderr.

Everything else is a non-zero exit naming what is absent (see
[Error handling](#error-handling)). **Defaulting is never the fallback.** A
stage dispatched at the wrong model, or missing a contract, produces plausible
work that skipped the process — the most expensive failure this pipeline has,
because it reports success.

### Composition lives in a `STAGES` table in JS

A `STAGES` table in the script maps each stage to its role, its body template,
and the fragments it carries. Conditionals are ordinary JavaScript.

This was chosen over declaring the recipe in template frontmatter or in
`autopilot.json`, because the conditionals are not one uniform shape:

| Stage | Conditional |
|---|---|
| `plan`, `sdd` | gate on `minimalism.mode` being one of two values, appending one or two files |
| `sdd` | the role table is **not a file at all** — it is a markdown table rendered from config values at dispatch time |
| `plan` | the learnings fragment depends on whether a file exists in the worktree |
| `verify` | reaches its fragment through a second hop, via `references/stages/verify-run.md` |

Expressing those declaratively means inventing a config language. In JS they are
four conditionals in a table literal.

Config was ruled out on a second ground: safety. A recipe in
`.claude/autopilot.json` would let a project silently drop the findings-capture
contract or the verification contract from a dispatch, and the run would still
report success. The contracts a stage carries are not a project's choice.

### Keyed by stage, not by role

**This deviates from the issue text**, which says the script writes
`.superpowers/autopilot/<run>/agents/<role>.md`.

Four stages dispatch the `implement` role:

| Stage | What it does |
|---|---|
| `sdd` | runs `superpowers:subagent-driven-development` against the plan |
| `verify-fix` | the one fix round after a failed UI criterion |
| `land-conflict` | resolves a rebase conflict |
| `pr` | runs `superpowers:finishing-a-development-branch` |

A role-keyed path has all four overwrite each other's definitions mid-run. The
written file is therefore keyed by **stage**.

The **frontmatter `name` stays role-keyed** — `name: autopilot-<role>` — for two
reasons. It is what the README documents as the target of ponytail's
`PONYTAIL_SUBAGENT_MATCHER` (`^autopilot-(plan|implement|implement_complex)$`),
which a stage-keyed name would silently stop matching; and the role is what the
model and effort come from, so the name naming the role keeps the definition
self-describing. Only the filename differs.

### Eight dispatched stages

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

Phase 1's brainstorm is not in the table: it is a skill the orchestrator invokes
in conversation with the human partner, not a dispatched subagent definition.
`setup` and `land` are not dispatched stages either — they run scripts. `land`
appears here only through its conflict resolver.

Fragment order within a stage is the order of the table row, and it reproduces
the order SKILL.md's `cat` lines produce today. Order is part of the contract:
`sdd-minimalism-lite.md` before `sdd-minimalism-full.md` is a ladder, not a set.

## Components

### 1. `plugins/autopilot/scripts/autopilot-dispatch.mjs` (new)

Follows the module shape every other script in `scripts/` uses: pure exported
functions, an exported `main(argv)`, injectable readers so tests never touch the
filesystem, and the `import.meta.url === pathToFileURL(process.argv[1]).href`
guard (`pathToFileURL` rather than a `file://` template, because the plugin's
install path is user-controlled and a space in it would silently skip `main()`).

Exports, at minimum:

- `STAGES` — the table, so tests can enumerate stages rather than restating them
- `compose({ stage, config, values, fragmentReader, worktreeHas })` — returns the
  definition text. Pure: no writes, no `process.exit`.
- `render(template, values)` — placeholder interpolation
- `main(argv)` — parses flags, loads config, calls `compose`, writes, prints

Composition order inside `compose`:

1. frontmatter, from the stage's role entry in merged config
2. the rendered body template
3. each fragment, in table order, separated by a blank line

```
---
name: autopilot-<role>
description: <stage> stage of an autopilot run
model: <config.roles.<role>.model>
effort: <config.roles.<role>.effort>
---

<rendered body>

<fragment 1>

<fragment 2>
```

Merged config comes from the existing `autopilot-config.mjs` `loadConfig()` —
plugin defaults with the project's optional `.claude/autopilot.json` layered
over them, merged per key and per role. The script adds no config keys of its
own.

### 2. `plugins/autopilot/skills/autopilot/references/dispatch/<stage>-body.md` (new, ×8)

Each dispatched stage's instructions move out of `SKILL.md` prose and into a
body template, joining the contract fragments #27 extracted. A body template is
the stage's own instructions with `{{placeholder}}` markers for the run-specific
values.

The templates are written by transcribing what SKILL.md's stage section tells
the dispatched agent today — this change is a relocation, not a rewrite of
instructions. Where SKILL.md's prose mixes orchestrator-facing rules with
agent-facing ones, only the agent-facing half moves.

Run-specific values per stage:

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

There are **no optional placeholders**. Where a value varies by entry point, the
caller supplies both variants' text rather than the template growing a branch —
`{{criteria_source}}` is the case that exists today: a plain `/autopilot` run
passes the sentence naming the brainstorm's design, and `/autopilot-github`
passes its Delta 1a instruction naming the issue.

### 3. `plugins/autopilot/skills/autopilot/SKILL.md` (rewritten in place)

Each dispatched stage's section collapses to three things:

1. the `autopilot-dispatch.mjs` command, with this stage's flags
2. "dispatch by the printed path"
3. its ledger line

The **"Composing a dispatch"** section loses its heredoc recipe and gains the
script's contract: what the script does, that stdout is one line, that any
non-zero exit stops the run, and that the orchestrator does not read the
composed file. The two Common Rationalizations rows about fragments
(`"I'll read the dispatch fragment"`, `"I'll paraphrase the contract"`) are
rewritten to name the composed definition instead, and a row is added for
`"I'll peek at the definition before dispatching"` — reading the file spends
exactly the context the script exists to save.

The prose that **survives** is rationale and the non-dispatch mechanics: the
ledger, parking, stage ordering, the run directory rules, preflight, resume,
`setup`, `land`'s script and its outcome table, `verify`'s gate and outcome
table, the `pr` stage's timing and PR-body steps.

**Every ledger-line prefix must survive verbatim.** `nextStage` prefix-matches
ten strings — `started (phase 1)`, `design approved`, `worktree:`,
`spec committed`, `plan complete`, `sdd complete (`, `verify`,
`learnings committed`, `rebase clean`, `pr:` — plus `PARKED` for park
detection. A rewrite that reworded one would silently break resume detection.

Expected effect on the skill's own size is a reduction, but reducing SKILL.md is
not the goal and is not an acceptance criterion — the goal is that the
orchestrator stops holding stage prompts.

### 4. `plugins/autopilot/skills/autopilot/references/stages/verify-run.md` (edited)

Keeps everything orchestrator-facing: the recipe's shape and rules, the
`@playwright/test` prerequisite, the `autopilot-verify.mjs run` invocation, and
the teardown rationale. Its `cat ... verify-browser.md >> "$A"` block is replaced
by the `autopilot-dispatch.mjs verify` command, since the fragment now reaches
the agent through the table.

### 5. `plugins/autopilot/skills/autopilot-github/SKILL.md` (edited, one delta)

Delta 1a currently says to carry an instruction "into the `spec` dispatch". With
mechanical dispatch that becomes: write the instruction to a file in the run
directory with a quoted heredoc and pass `--criteria-source=@<path>`. The
instruction text is unchanged.

This preserves the wrapper's existing untrusted-input rule. Only the issue
*number* is interpolated, and only into a `<<'EOF'` heredoc, which performs no
expansion; issue title and body text still reach the agent only by a file the
script reads, never through a shell string.

## Data flow

A dispatched stage, end to end:

1. **The orchestrator writes any multi-line value to a file** in the run
   directory using a quoted heredoc — the approved design for `spec`, the
   summarized verify failures for `verify-fix`, the conflict list for
   `land-conflict`. Single-line values (paths, the run name, the branch) need no
   file.
2. **It runs the script**, from the repository root:

   ```bash
   node "$AP/scripts/autopilot-dispatch.mjs" spec \
     --run=<run> \
     --config=.claude/autopilot.json \
     --worktree=<worktree path> \
     --branch=<branch> \
     --spec-path=docs/superpowers/specs/YYYY-MM-DD-<topic>-design.md \
     --design=@.superpowers/autopilot/<run>/design.md \
     --criteria-source="the approved design settled in the brainstorm"
   ```

3. **The script composes and writes.** Load merged config → look up
   `STAGES[stage]` → resolve the role's `model`/`effort` → read the body
   template → interpolate → evaluate the fragment list against the context
   (config, worktree) → read each fragment → concatenate → `mkdir -p` →
   write `.superpowers/autopilot/<run>/agents/<stage>.md`.
4. **It prints the path.** One line.
5. **The orchestrator dispatches the Agent by that path**, records the returned
   status line, and appends its ledger entry.

The fragment text travels from the plugin directory to the subagent definition
entirely inside the node process. It is never a tool result, so it costs the
orchestrator nothing — the same property `cat` gave, now with the assembly
included.

### Flag conventions

- **Flags are kebab-case; placeholders are snake_case.** `--spec-path` fills
  `{{spec_path}}`. Dashes normalize to underscores; nothing else is
  transformed.
- **`--key=@path` reads the value from a file.** Multi-line values — the
  approved design especially — do not survive as shell flag values, and the
  github wrapper's untrusted-input rule forbids `printf`-ing issue text into a
  command at all. `--key=@@literal` escapes a value that genuinely starts with
  `@`.
- **`--run` and `--config` are reserved.** `--run` also fills `{{run}}`;
  `--config` defaults to `.claude/autopilot.json` relative to the working
  directory and is passed explicitly by SKILL.md, mirroring how the skill
  already invokes `autopilot-verify.mjs`.
- **Interpolation is single-pass.** A substituted value is inserted verbatim and
  never rescanned, so a design document containing the literal text `{{run}}`
  reaches the agent unchanged rather than being expanded.
- **The written file is overwritten** on every run of the script. Stages are
  idempotent, and a resumed run must recompose from current config rather than
  inherit a stale definition.

## Error handling

Every failure exits non-zero with a message on stderr naming what is absent, and
writes nothing. There is one non-zero code (`1`) rather than a taxonomy: the
orchestrator's response to any composition failure is identical — stop and
report, never continue — so a code to branch on would have no reader. (This
differs deliberately from `autopilot-verify.mjs`, whose codes distinguish a park
from a fix round, which *are* different responses.)

| Condition | Message names |
|---|---|
| Unknown stage | the stage given, and the known stage names |
| Role absent from merged config, or missing `model`/`effort` | `roles.<role>` and the missing field |
| A `{{placeholder}}` with no value | the stage, the placeholder, and the flag that would fill it |
| A flag no placeholder consumes | the flag and the stage — a typo'd flag means the value the orchestrator meant to pass never reached the agent |
| A fragment file that cannot be read | the fragment's relative path and the absolute path tried |
| A `@path` value that cannot be read | the path, and the flag that named it |
| Config invalid or malformed | whatever `loadConfig` already reports, unchanged |

Two of these deserve their reason stated in the code, because both look like
over-strictness:

**The role check is deliberately redundant.** `validateConfig` already errors on
a role missing from `ROLES`. The script re-checks anyway, because AC2's
guarantee must be the script's own — a future edit to `ROLES` must not be able
to turn "role missing" into "role defaulted" without failing a test.

**An unfilled placeholder is an error, not an empty string.** An empty
`{{spec_path}}` produces an agent told to write its spec to nowhere, which it
will resolve by inventing a path — and the run continues, wrong, to completion.

## Testing

### The contract test — `autopilot-dispatch-contract.test.mjs` (new)

Composes each stage's definition **through the script** and asserts the required
contract sections are present in the result. This replaces today's
`sectionOf`-based assertions, which prove a contract reaches the agent by
resolving the `references/**.md` paths SKILL.md names — a route that ceases to
exist once SKILL.md no longer names them.

It asserts, per stage:

- the frontmatter carries the role's configured `model` and `effort`, and
  `name: autopilot-<role>`
- the composed text contains each fragment the stage's row declares, in order
- the four `implement`-role stages write four distinct paths

Plus, once for the whole skill: every ledger prefix `nextStage` matches still
appears verbatim in SKILL.md. `autopilot-ledger-coupling.test.mjs` pins
`nextStage` against hand-written ledger strings, so it cannot catch SKILL.md
dropping a line; this closes that gap.

### The five existing contract tests (repointed)

`autopilot-sdd-contract`, `autopilot-minimalism-contract`,
`autopilot-learnings-contract`, `autopilot-verify-contract` and
`autopilot-findings-contract` each slice a SKILL.md section with
`sectionOf(readSkill(), "<stage>")` and assert load-bearing phrases inside it.
Each swaps that one line for a composed definition and keeps every assertion.
The assertions match phrases in the fragments, so they carry over unchanged.

Folding all five into the new contract test was rejected: it would delete
topic-specific assertions this change has no reason to lose.

`skill-sections.mjs` stays. Its `unwrap`, `maskFences`, `sectionOf` and
`topSection` still serve the prose pins (`autopilot-no-design-gate.test.mjs`,
the README assertions, its own unit tests). `resolveReferences` becomes
exercised only by `skill-sections.test.mjs`; removing it is out of scope.

### The minimalism pin

`minimalism.mode: off` must still compose a prompt byte-identical to one
composed before the key existed. Today that is pinned indirectly, by asserting
SKILL.md's prose says "include nothing". Composition makes the pin direct and
strictly stronger:

```
compose("sdd", { config: modeOff })  ===  compose("sdd", { config: noMinimalismKey })
```

and neither result contains any ladder text. Same assertion for `plan`. The
existing prose assertions in `autopilot-minimalism-contract.test.mjs` that
describe the *ladder content* stay, repointed at composed output.

### Unit tests — `autopilot-dispatch.test.mjs` (new)

Cover the error paths named above, each asserting the message names the absent
thing rather than merely that the call threw: unknown stage; a role absent from
merged config; an unfilled placeholder; an unconsumed flag; a missing fragment
file; an unreadable `@path`. Plus the happy-path mechanics: kebab-to-snake flag
mapping, `@path` reading and its `@@` escape, single-pass interpolation, and the
rendered `sdd` role table matching the six roles' merged config values.

Fragment reads and config reads are injected, following `loadConfig`'s existing
`readFile` parameter, so the unit tests construct a config with a role removed
without needing a fixture file on disk.

`npm test` (vitest) is the whole suite; no new tooling.

Per `CLAUDE.md`: **no test asserts a version literal.**

## Mechanical details chosen here

The approved design was silent on these; each is resolved toward what the
codebase already does, and each is stated so a reviewer can see it was a choice:

1. **Module shape** — exported pure functions plus `main(argv)` with the
   `pathToFileURL` guard, matching `autopilot-land.mjs` and
   `autopilot-verify.mjs`.
2. **One non-zero exit code**, not a taxonomy — nothing branches on it.
3. **`--key=@path`** for multi-line values, because a heredoc-written file is
   the only route the github wrapper's untrusted-input rule permits.
4. **An unconsumed flag is an error**, on the same grounds as an unfilled
   placeholder.
5. **`name: autopilot-<role>` in frontmatter**, so the README's documented
   ponytail matcher keeps working while filenames go stage-keyed.
6. **Eight stage keys**, named `spec`, `plan`, `sdd`, `verify`, `verify-fix`,
   `learnings`, `land-conflict`, `pr` — the pipeline's stage names, with the two
   `implement`-role sub-stages named for the stage they belong to.

## Out of scope

- No new configuration key, and no change to `autopilot.default.json`.
- No change to the stage graph, the ledger format, `nextStage`, or any parking
  condition.
- No change to the fragment files #27 extracted; they are read as-is.
- Removing `resolveReferences` from `skill-sections.mjs`.
- Measuring the effect. Issue #23's target — median orchestrator turns 133 → ~40
  — is confirmed by observing later runs, not by a test in this branch.

## Acceptance criteria

- AC1 (non-ui) — `autopilot-dispatch.mjs <stage> --run=<run>` writes a valid
  subagent definition at `.superpowers/autopilot/<run>/agents/<stage>.md`
  carrying the role's configured model and effort, and prints only that path on
  stdout
- AC2 (non-ui) — the script exits non-zero rather than defaulting when the
  stage's role is missing from merged config, and the message names the missing
  `roles.<role>` field
- AC3 (non-ui) — `SKILL.md` routes every dispatched stage through the script
  instead of describing prompt composition inline: no stage section contains a
  prompt-assembling heredoc or a `cat` of a `references/dispatch/*.md` fragment
- AC4 (non-ui) — a contract test composes each stage's definition through the
  script and asserts that stage's required contract sections are present in the
  result
- AC5 (non-ui) — an unknown stage, an unfilled placeholder, and an unreadable
  fragment file each exit non-zero with a message naming what is absent, and
  write no definition file
- AC6 (non-ui) — the four stages that dispatch the `implement` role (`sdd`,
  `verify-fix`, `land-conflict`, `pr`) write four distinct definition files,
  none overwriting another, while each frontmatter still names
  `autopilot-implement` with the `implement` role's model and effort
- AC7 (non-ui) — with `minimalism.mode` at `off`, a composed definition is
  byte-identical to one composed from a config with no `minimalism` key at all,
  for both `plan` and `sdd`
- AC8 (non-ui) — every ledger-entry prefix `nextStage` matches still appears
  verbatim in `SKILL.md` after the rewrite, and the existing ledger-coupling
  test stays green
