# Tiered ceremony for autopilot

**Date:** 2026-08-26
**Status:** Approved design, ready for planning

## Problem

A `/autopilot` run costs a median 76 minutes, and `sdd` is 63% of it at roughly
9.5 minutes per planned task. Issue #23 measured this across 59 run ledgers and
197 session transcripts. The obvious response — decompose less — was already
tried twice (#12, #20 cut the plan budget from 5-8 to 3-5 to 1-5) and #23
retracted it as a lever: at the resulting median of 5 tasks there is no visible
time penalty.

The question this design answers is different. It is not "how many tasks should
a plan have" but "what does decomposition buy at all", and the findings corpus
in `.superpowers/autopilot/*/findings.jsonl` answers it. Across 7 runs and 29
tasks, 39 findings:

| Stage at fault | Findings | Major | Important |
|---|---|---|---|
| `plan` | 30 | 8 | 4 |
| `spec` | 6 | 1 | 0 |
| `implementation` | 3 | 0 | 0 |

Every major and every important finding was a defect in the spec or the plan.
The three implementation-fault findings are all minor and none is a code
defect: an unverified TDD evidence count in a report, a paraphrased instead of
quoted command output in a report, and one stale string. 20 of 29 tasks passed
review clean.

Two conclusions follow, and they point in opposite directions.

**The plan earns its keep.** It is a review surface. Eight major defects were
caught in prose, before they became code. Deleting the plan would not delete
those defects; it would relocate them into the diff, where nothing pre-reviewed
them.

**Decomposition does not.** Splitting the same plan across more tasks produced
no measurable quality gain, and the local timing data shows it does not save
time either. Correlation between task count and `sdd` wall clock is 0.34;
between fix rounds and `sdd` wall clock it is 0.57. Every run in the 3-7 task
band landed between 24 and 73 minutes with a mean of 45.7 and no trend — the
7-task run finished in 39.8 minutes, faster than both 3-task runs at 51.0 and
47.9. Meanwhile the single 1-task run finished `sdd` in 9.8 minutes.

Decomposition also has a cost already recorded in `docs/autopilot/learnings.md`
as a standing rule — *"Name the seams no single task's diff exposes"* — written
after a merge step resolved configuration a later task needed while the CLI
printed only `ok`, and after a cross-section documentation update that no task
owned.

So the ceremony worth scaling is decomposition, not documentation.

## Key decision: a tier binds decomposition, never which documents exist

A tier is two numbers: a task-count ceiling for `plan`, and how many reviews
`sdd` runs. `spec` and `plan` run on every tier without exception.

This is deliberately not the tiering described in the general advice that
prompted this work, which proposes skipping specs and plans for small changes.
That advice is sound in the abstract and wrong for this repository, because
this repository has measured where its defects come from and 92% of them are in
exactly the documents that advice would delete.

## Design

### 1. The ladder

| Tier | Plan ceiling | Escalation |
|---|---|---|
| `small` | 1 task | once, to `standard` |
| `standard` | 3 tasks | once, to `large` |
| `large` | 5 tasks | none; budget, not a cap |

Three tiers rather than four. After the decision above, a trivial change and a
small change are both 1 task reviewed once, so a fourth tier would add a
boundary that binds nothing. Misclassification is the only new risk this design
introduces, and each boundary is a place to misclassify.

### 2. Classification happens in the brainstorm

`autopilot-brainstorm` gains a classification step. It states the tier out loud
during Phase 1, early enough that the developer can override it in the same
conversation where they are already answering clarifying questions, and its
handoff carries `tier: <name>` beside the design.

Upstream `superpowers:brainstorming` 6.3.0 already classifies this way, into
`spike` / `bounded` / `architectural`, announcing the classification for
override. `autopilot-brainstorm` is a fork that predates that feature. This
step re-syncs the fork with upstream's approach while keeping autopilot's own
three names, for two reasons: upstream's tiers select which artifacts get
written whereas autopilot's select how far work is decomposed, and autopilot
has no analogue for `spike` because every run ends in a pull request.

The orchestrator appends `tier: <name>` to the ledger immediately after the
existing `design approved` entry.

### 3. Carrying the tier into the plan dispatch

This follows the mechanism `minimalism.mode` already uses, so no new machinery
is introduced. Today `STAGES.plan.fragments` returns `plan-budget.md`
unconditionally. It instead returns one of three files by tier:

- `plan-budget-small.md`
- `plan-budget-standard.md`
- `plan-budget-large.md`

`autopilot-dispatch.mjs plan` accepts `--tier=<small|standard|large>`. Three
existing behaviours in `compose()` constrain how this is wired:

1. `compose()` throws on any flag that fills no placeholder in the body
   template. `--tier` selects a fragment rather than filling a placeholder, so
   `tier` must be added to the `RESERVED` set alongside `run`, `config` and
   `worktree`.
2. `fragments()` currently receives `{ config, worktreeHas }`. It must also
   receive `values`, so the tier can be read at compose time.
3. **A string fragment is read verbatim and is never passed through
   `render()`** — `compose()` does
   `typeof fragment === "string" ? fragmentReader(fragment) : fragment.text`.
   A `{{ceiling}}` placeholder written into a fragment file would therefore
   ship to the agent literally.

Because of (3), the configured ceiling cannot be interpolated into a static
fragment file. The tier budget uses the inline-text form the `sdd` stage
already uses for its role table — `{ text: roleTable(config) }` at
`autopilot-dispatch.mjs:79`, defined at `:137`. A `tierBudget({ config, tier,
fragmentReader })` helper reads the tier's fragment file and returns it with
the ceiling rendered in, and `STAGES.plan.fragments` returns
`{ text: tierBudget(...) }` in the budget position.

An unrecognised `--tier` value throws at compose time, naming the flag and the
three accepted values. It does not fall back to a default: a silent fallback
would let a typo produce a run whose ceremony nobody chose.

### 4. Review depth is a function of task count, not of the declared tier

At 1 task, the per-task reviewer and the whole-branch final reviewer read the
same diff. The `plan-task-count-scale-to-complexity` run did exactly this: one
task, a `task_review` dispatch on sonnet, then a `final_review` dispatch on opus
over identical content.

So `STAGES.sdd.fragments` returns an additional `sdd-review-single.md` when the
plan wrote exactly 1 task. That fragment instructs the `sdd` controller to run
one review for the run — the `final_review` role — and to skip the per-task
`task_review` dispatch. `autopilot-dispatch.mjs sdd` accepts `--tasks=<n>` to
carry the count, added to `RESERVED` on the same grounds as `--tier`.

Keying this to the task count the plan actually wrote, rather than to the tier
the brainstorm declared, means escalation needs no plumbing into `sdd` at all.
An escalated run has 2 or more tasks and receives normal two-stage review
automatically.

The fix-round machinery is unchanged. A finding from the single review still
returns the task to its implementer, and the round-5 breaker still applies.

### 5. Escalation is one-way, one step, and unattended

`plan-budget-small.md` instructs: write 1 task. If the work genuinely cannot be
one reviewable diff, write the tasks it needs up to 3, open the plan with an
`## Escalation` heading naming the reason, and report the escalation in the
return line. `plan-budget-standard.md` carries the same instruction with a
ceiling of 5.

`plan-budget-large.md` carries today's `plan-budget.md` text, which already
states that the budget is not a cap. `large` does not escalate because it has
nowhere to escalate to.

On an escalation the orchestrator appends
`tier escalated: small → standard — <reason>` to the ledger.

A tier is never lowered mid-run, and never escalates more than one step in a
run. A plan that believes `small` work needs 5 tasks writes 3 and says so;
the developer reads the escalation line and reclassifies on the next run.

No new parking condition. A misclassification costs a ledger line, not an
interruption of a phase that is unattended by design.

### 6. Configuration

A `tiers` block in `autopilot.default.json`, beside the existing `browser`,
`github` and `minimalism` blocks:

```json
"tiers": {
  "small": 1,
  "standard": 3,
  "large": 5
}
```

Ceilings are tunable without editing fragment text, merged per key the way
`roles` already is. The ceiling is rendered into the composed fragment, so a
project that widens `standard` to 4 gets a plan prompt that says 4.

### 7. Backward compatibility and failure behaviour

`--tier` absent composes `plan-budget.md` exactly as today, byte for byte. That
covers two cases: a `/autopilot resume` on a ledger written before this change,
and a brainstorm that returns no tier. Absence resolves toward more ceremony,
never less.

`--tasks` absent composes the `sdd` prompt exactly as today, with two-stage
review.

## Scope

Files changed:

| File | Change |
|---|---|
| `plugins/autopilot/skills/autopilot-brainstorm/SKILL.md` | classification step; handoff carries the tier |
| `plugins/autopilot/skills/autopilot/SKILL.md` | ledger `tier:` and `tier escalated:` entries; `--tier` on the plan dispatch; `--tasks` on the sdd dispatch |
| `plugins/autopilot/scripts/autopilot-dispatch.mjs` | tier-selected plan fragment; task-count-selected sdd fragment; `tier` and `tasks` added to `RESERVED`; `values` passed to `fragments()` |
| `plugins/autopilot/scripts/autopilot-config.mjs` | validate the `tiers` block |
| `plugins/autopilot/autopilot.default.json` | `tiers` defaults |
| `plugins/autopilot/skills/autopilot/references/dispatch/plan-budget-{small,standard,large}.md` | new; `plan-budget.md` retained untouched as the no-tier fallback |
| `plugins/autopilot/skills/autopilot/references/dispatch/sdd-review-single.md` | new |
| `plugins/autopilot/scripts/*.test.mjs` | contract tests below |
| `README.md` | document the ladder and the `tiers` block |

No new stage, no change to the stage graph, no new parking condition.

`plan-budget-large.md` and the retained `plan-budget.md` carry near-identical
prose. This duplication is deliberate: `plan-budget.md` is what a ledger
predating this change composes, and keeping it byte-identical is what makes
AC5's byte-identity pin possible. `dispatch-fixture.mjs` already builds
configs that predate a key for exactly this kind of pin.

### Coordination with PR #33

PR #33 (`feat(autopilot): cap session length and hand off at stage
boundaries`) is open and touches five of the files above:
`autopilot.default.json`, `autopilot-config.mjs`, `autopilot-config.test.mjs`,
`autopilot-ledger.mjs` and `skills/autopilot/SKILL.md`. Both changes add a
top-level config block and a new ledger entry type, so they will conflict
textually if they land close together. Neither depends on the other.

PR #33 is also the precedent for AC15. It hit the same hazard with its
`session:` entries and states the failure directly: a `session:` line appended
after a `PARKED` line would have unparked a run, because `nextStage` reads only
the last entry to detect a park. Whichever lands second should reuse the other's
filtering rather than reinvent it.

## Acceptance criteria

- AC1 (non-ui) — `loadConfig` on a project with no `tiers` key returns ceilings
  of 1, 3 and 5 for `small`, `standard` and `large`
- AC2 (non-ui) — a project supplying a partial `tiers` block inherits the
  default ceiling for every key it omits
- AC3 (non-ui) — a `tiers` ceiling that is not a positive integer fails to load
  with an error naming the offending key
- AC4 (non-ui) — `compose()` for stage `plan` with `--tier=small` includes
  `plan-budget-small.md` and excludes `plan-budget-standard.md` and
  `plan-budget-large.md`, and the equivalent holds for the other two tiers
- AC5 (non-ui) — `compose()` for stage `plan` with no `--tier` produces output
  byte-identical to the current implementation's output for the same inputs
- AC6 (non-ui) — `compose()` for stage `plan` with `--tier=medium` throws an
  error naming `--tier` and listing `small`, `standard` and `large`
- AC7 (non-ui) — `--tier` and `--tasks` do not trigger the unconsumed-flag
  error, and every other unrecognised flag still does
- AC8 (non-ui) — `compose()` for stage `sdd` with `--tasks=1` includes
  `sdd-review-single.md`; with `--tasks=2` and with no `--tasks` it does not
- AC9 (non-ui) — each composed `plan-budget-<tier>.md` states its ceiling as a
  number matching that tier's configured ceiling
- AC10 (non-ui) — `plan-budget-small.md` and `plan-budget-standard.md` each
  state the one-step escalation rule and name the tier escalated to;
  `plan-budget-large.md` states no escalation rule
- AC11 (non-ui) — `sdd-review-single.md` names `final_review` as the review that
  runs and `task_review` as the dispatch that is skipped
- AC12 (non-ui) — `autopilot-brainstorm`'s SKILL.md states the classification
  step and names `small`, `standard` and `large`
- AC13 (non-ui) — autopilot's SKILL.md states that the orchestrator appends a
  `tier:` entry after `design approved`, and a `tier escalated:` entry when the
  plan reports one
- AC14 (non-ui) — `parseLedger` parses a ledger containing `tier:` and
  `tier escalated:` entries, and `nextStage` returns the same stage for that
  ledger as for the same ledger with those entries removed
- AC15 (non-ui) — a `tier:` or `tier escalated:` entry appended after a
  `PARKED` entry leaves the run parked; `nextStage` reads the last entry to
  detect a park, so a trailing entry must not unpark a run
- AC16 (non-ui) — `README.md` documents the three tiers, their ceilings, and
  that `spec` and `plan` run on every tier
- AC17 (non-ui) — `npm test` passes

Every criterion is `(non-ui)`: this is a CLI plugin repository with no browser
surface, so the `verify` stage will skip.

## Non-goals

- **Skipping `spec` or `plan` at any tier.** The evidence in the Problem
  section is the whole argument for this design; a tier that skips them
  contradicts it.
- **Parallel implementers.** Issue #31, separate work, gated on its own
  measurement.
- **Pipelining task reviews against the next implementer.** Issue #24,
  separate work.
- **Reducing fix rounds.** Issue #29. Fix rounds correlate with `sdd` wall
  clock at 0.57 against task count's 0.34, so this is the larger remaining
  lever, and it is untouched here.
- **Changing SDD's serial-implementer rule.**

## Measurement

The ledger already records task count on the plan entry. Adding `tier` lets the
corpus answer whether this helped, the same way issue #23 answered the previous
round.

Every `tier escalated:` entry is a labelled classifier miss. Their rate is the
one number that says whether the brainstorm judges complexity better than the
plan agent currently does — which is the assumption this design rests on and
cannot prove in advance.

The expected effect is asymmetric. On work that is already small the saving is
roughly 4 to 5 minutes: the 20-minute `plan-task-count` run becomes about 15.
The larger prize is preventing over-decomposition of medium work — a change
that today lands at 3 tasks and about 48 minutes of `sdd`, classified `small`,
lands at 1 task and 10 to 17 minutes instead.
