# Ponytail-style minimalism contracts for autopilot

**Date:** 2026-08-25
**Status:** Approved design, ready for planning

## Problem

[Ponytail](https://github.com/DietrichGebert/ponytail) is a YAGNI
decision-ladder plugin for AI coding agents. It installs a `SessionStart` hook
that injects its ruleset into the main session, and a `PreToolUse` hook on the
`Agent` tool that injects it into spawned subagents, scoped by a
`PONYTAIL_SUBAGENT_MATCHER` regex that defaults to **all** subagents when
unset. Its modes are `off` / `lite` / `full` / `ultra`.

Autopilot dispatches at two depths, and only one of them is addressable by that
regex:

| Depth | What runs there | Agent definition | Reachable by a matcher? |
|---|---|---|---|
| 1 | Autopilot's own stage roles | generated, named `autopilot-<role>` | Yes — individually |
| 2 | SDD's nested roles | `Subagent (general-purpose)` | **No** |

In `superpowers:subagent-driven-development`, the implementer prompt, the
task-reviewer prompt and the re-review prompt **all** declare
`Subagent (general-purpose)`. No regex can separate the implementer from the
reviewer that judges it. Depth 2 is where ~66% of a run's wall clock and 100%
of its code writing happen.

So a purely configuration-based integration — setting
`PONYTAIL_SUBAGENT_MATCHER` — reaches autopilot's own stage agents and cannot
reach the SDD implementers at all. The only mechanism that crosses the depth-2
boundary is **literal contract text composed by autopilot's SKILL.md into the
`sdd` dispatch prompt**. That is not a new mechanism: the `sdd` section already
carries three contracts written exactly this way — the model-mapping override,
the verification contract, and the findings capture contract.

## Key decision: autopilot ships its own ladder

Autopilot ships its **own self-contained minimalism ladder text**. Ponytail is
**never required** — no preflight check, no dependency, no install step, no
version pin. Ponytail stays an optional, independent layer a user may point at
depth-1 roles through the env var (documented in the README, section 4 below).

Two consequences, both deliberate:

- The feature cannot break any existing autopilot user. With `mode` at its
  default `off`, every dispatch prompt is byte-identical to today's.
- Nothing in the run depends on a third-party plugin's prompt text staying
  stable, which is the failure mode a dependency would have bought us.

## Scope

Five files. No new script, no new stage, no change to the stage graph.

### 1. `plugins/autopilot/autopilot.default.json`

Add a nested block beside the existing `browser` and `github` blocks:

```json
"minimalism": {
  "mode": "off"
}
```

### 2. `plugins/autopilot/scripts/autopilot-config.mjs`

Two edits, each following a precedent already in the same file.

**`mergeConfig` — merge `minimalism` per key**, the way `browser` is already
merged, and for the reason that comment already gives: the top-level merge is
shallow, so a project supplying an unrelated key alongside a partial
`minimalism` block would replace it wholesale. A project overriding nothing
must still inherit the default mode.

```js
if (defaults.minimalism || project.minimalism) {
  merged.minimalism = { ...defaults.minimalism, ...(project.minimalism ?? {}) };
}
```

**`validateConfig` — validate with optional chaining**, following the
`browser.ready_timeout_ms` precedent: `obj.minimalism?.mode`, **when present**,
must be one of `"off"`, `"lite"`, `"full"`. An invalid value is an **error**, so
it surfaces at preflight rather than silently disabling the feature mid-run.
Absence is not an error.

**Do not add `minimalism` to the `TOP_LEVEL` array.** That list is a hard error
on absence. The file's own existing comment on `github` explains why nested
optional blocks stay out of it: listing one there breaks every project whose
config predates the key.

### 3. `plugins/autopilot/skills/autopilot/SKILL.md` — two injection points

Both blocks emit **nothing at all** when `mode` is `off`. That is the load-
bearing property of this whole design: the default run is unchanged, so there
is no population of users this feature can regress.

The two ladders are about different things and must not be collapsed into one:
the `plan` ladder is about **task decomposition**, the `sdd` ladder is about
**code**.

#### 3a. The `plan` stage — a decomposition ladder

Sits alongside the task-count budget already documented in that section. The
budget says *how many* tasks; this says *which tasks are worth planning at all*.

At `lite`, include text equivalent to:

> Minimalism ladder for this plan, in order:
>
> 1. **Prefer no task.** If a stated outcome is already true in the repo, do
>    not plan a task to make it true again.
> 2. **Prefer fewer tasks.** Two steps that cannot be reviewed apart are one
>    task.
> 3. **Prefer the smallest task that satisfies the spec.** Plan what the
>    acceptance criteria require, not what the subsystem might want later.
> 4. **Do not plan an abstraction with one consumer.** If the plan cannot name
>    the second consumer today, plan the direct thing.

At `full`, the same four rungs plus:

> 5. **Prefer plans that delete.** A task that removes a code path and a task
>    that adds one are not equally priced; the removal is cheaper to review,
>    cheaper to run and cheaper to maintain. Where both reach the criteria,
>    plan the removal.
> 6. **Correctness outranks minimalism**, exactly as it outranks the
>    task-count budget. A task that cannot be reviewed as one diff is two
>    tasks, whatever the ladder says.

Rung 6 mirrors the existing budget's rule 3 for the same reason that rule is
load-bearing: an unqualified instruction to plan less produces oversized,
unreviewable tasks, converting a wall-clock saving into fix rounds.

#### 3b. The `sdd` stage — a fourth contract

A **minimalism contract**, alongside the three contracts already there. Its
load-bearing clause is the **scoping instruction**, not the ladder.

**The scoping instruction.** The SDD controller must include the contract text
in **implementer** dispatches — the `implement` and `implement_complex` roles —
and must **explicitly withhold** it from `task_review`, `re_review` and
`final_review` dispatches. The reason belongs *inside the contract*, because an
unexplained exclusion gets "helpfully" generalized by the agent applying it:

> Include this contract in implementer dispatches only (`implement` and
> `implement_complex`). **Do not include it in `task_review`, `re_review` or
> `final_review` dispatches.** A reviewer told "the best code is the code you
> never wrote" approves under-built work — it reads a thin implementation as
> discipline rather than as a gap. Rigor is the entire point of the review
> roles, and this contract is corrosive to it. All three review roles are the
> same `general-purpose` agent type as the implementer, so this instruction is
> the only mechanism that can scope them apart; there is no matcher, no agent
> name and no config key that can do it for you.

**The ladder, at `lite`** — four rungs:

> Minimalism ladder for implementation, in order:
>
> 1. **Don't write it.** The best code is the code you never wrote. If the
>    task's outcome holds without new code, that is the implementation.
> 2. **Extend what exists.** A parameter or a branch in a function that is
>    already there beats a new module that does nearly the same thing.
> 3. **Write the smallest thing that satisfies the task.** No options, hooks,
>    or indirection with a single caller.
> 4. **Generalize last, and only for a caller that exists today.** "We'll need
>    it later" is not a caller.

**At `full`** — the same four rungs plus prefer-deletion framing:

> 5. **Prefer the diff that removes lines.** Where two implementations both
>    satisfy the task, take the one with fewer files, fewer exports and fewer
>    branches. Deleting a code path the task makes dead is part of the task,
>    not a separate cleanup.
> 6. **No config key, flag or extension point without a named present-day
>    consumer.** Every knob is a permanent branch in behavior and a permanent
>    line in the test matrix.
> 7. **No speculative error handling** for conditions the code as written
>    cannot reach.

Grade the **intensity**, not the correctness: `full` is not permission to skip
what the task requires, and `lite` is not permission to over-build.

#### 3c. The plan-governs rule — unconditional, in both modes

SDD's standing invariant is **"Plan governs."** Minimalism governs *how* a task
is built; it **never** governs *whether* it is built. This rule appears
verbatim in both `lite` and `full`, and is what makes the feature safe to ship:

> **Plan governs.** This ladder tells you how to build a task, never whether to
> build it. Implement every task the plan states, including one you judge
> unnecessary.
>
> When you judge a planned task unnecessary: **implement it anyway**, and
> append one line to `findings.jsonl` with `stage_at_fault` set to `"plan"` and
> the canonical `pattern` phrase `plan specified unnecessary work`. The line
> carries all seven fields required by the findings capture contract above —
> `task`, `round`, `severity`, `stage_at_fault`, `pattern`, `detail`,
> `verdict` — or the analyzer drops it.
>
> ```
> {"task":3,"round":1,"severity":"minor","stage_at_fault":"plan","pattern":"plan specified unnecessary work","detail":"the flag task 3 adds has no caller in this branch; implemented as planned","verdict":"IMPLEMENTED AS PLANNED"}
> ```
>
> Skipping the task would contradict "Plan governs", desynchronize the branch
> from the plan, and produce a review finding against you rather than against
> the plan.

Why this shape rather than letting the implementer skip:

- **It can never cause a fix round.** The branch always matches the plan, so no
  reviewer can find a missing task, and this feature cannot lengthen a run.
- **The signal is not lost, it is routed.** The `learnings` stage already
  prioritizes findings with `stage_at_fault == "plan"` when distilling planning
  rules, so the judgment reaches the one stage that can act on it.
- **It compounds.** A planning rule distilled this run lands in
  `docs/autopilot/learnings.md`, which the `plan` stage reads on the next run.
  The unnecessary task is not built next time — by the stage that should have
  caught it, not by an implementer overriding its brief.

### 4. `README.md`

Document the **optional depth-1 amplifier** under the autopilot configuration
section:

```sh
export PONYTAIL_SUBAGENT_MATCHER='^autopilot-(plan|implement|implement_complex)$'
```

The prose must state plainly that:

- ponytail is **optional and never required** — autopilot ships its own ladder
  and has no dependency on it;
- the matcher deliberately **excludes the three reviewer roles**, for the same
  rigor reason the `sdd` contract gives — and that ponytail's own default,
  unset, is *all* subagents, so the variable must be set rather than omitted if
  a user wants the reviewers protected.

### 5. Tests

Follow the repo's established contract-test pattern — there are already seven
`*-contract.test.mjs` files in `plugins/autopilot/scripts/`, and
`autopilot-sdd-contract.test.mjs` is the closest model: it extracts the
the `sdd` section by heading boundary and asserts on load-bearing phrases
rather than full sentences, so ordinary editing does not break it but removal
does.

**Extend `autopilot-config.test.mjs`:**

- the default `minimalism.mode` is `"off"`;
- a project overriding nothing in the block still inherits that default
  (per-key merge);
- `"lite"` and `"full"` pass validation;
- an unknown mode is an **error**, not a warning;
- an absent `minimalism` block is neither an error nor a warning.

**Add a new contract test** asserting the SKILL.md text states:

- the ladder itself;
- the implementer-only scoping;
- all three excluded reviewer role names, by name;
- the plan-governs rule and its `findings.jsonl` line with
  `stage_at_fault: "plan"`.

`npm test` is the gate.

## Acceptance criteria

- AC1 (non-ui) — `loadConfig` on a project with no `minimalism` key returns a
  config whose `minimalism.mode` is `"off"`
- AC2 (non-ui) — a project whose `.claude/autopilot.json` sets
  `minimalism.mode` to `"lite"` loads with mode `"lite"`, and one setting
  `"full"` loads with mode `"full"`
- AC3 (non-ui) — a project that supplies a `minimalism` block without a `mode`
  key inherits the default `"off"` rather than losing the key
- AC4 (non-ui) — a project setting `minimalism.mode` to any value other than
  `"off"`, `"lite"` or `"full"` fails to load with an error naming
  `minimalism.mode`
- AC5 (non-ui) — a config with no `minimalism` block at all loads without error
  and without warning
- AC6 (non-ui) — the `sdd` section of SKILL.md states that the minimalism
  contract goes to implementer dispatches only, naming `implement` and
  `implement_complex`
- AC7 (non-ui) — the `sdd` section of SKILL.md names all three excluded review
  roles: `task_review`, `re_review` and `final_review`
- AC8 (non-ui) — the `sdd` section of SKILL.md states the plan-governs rule:
  every planned task is implemented, and a task judged unnecessary is
  implemented anyway and recorded in `findings.jsonl` with `stage_at_fault` set
  to `plan`
- AC9 (non-ui) — the `plan` section of SKILL.md carries the decomposition
  ladder alongside the existing task-count budget
- AC10 (non-ui) — `README.md` documents the `PONYTAIL_SUBAGENT_MATCHER` export
  and states that ponytail is optional and that the matcher excludes the three
  reviewer roles
- AC11 (non-ui) — with `minimalism.mode` at `"off"`, neither dispatch prompt
  carries any minimalism text
- AC12 (non-ui) — `npm test` passes

Every criterion here is `(non-ui)`: this is a CLI plugin repository with no
browser surface, so the `verify` stage will skip.

## Non-goals

Named so a reader does not reintroduce them:

- **No measurement or A/B reporting instrument.** Explicitly deferred. Whether
  the ladder shortens runs is a question this design does not try to answer.
- **No ponytail dependency, install step or preflight check.** Ponytail is an
  optional external layer, never a requirement.
- **No change to `spec`, `verify`, `task_review`, `re_review`, `final_review`
  or `learnings` behavior.** The `learnings` stage's existing
  `stage_at_fault == "plan"` prioritization is used as-is, not modified.
- **No `ultra` mode.** Three modes only.
- **No per-role config list.** A user must not be able to hand the ladder to
  `final_review`. The exclusion is written into the contract prose precisely so
  that it cannot be configured away.

## Repo conventions

- Node helpers live in `plugins/autopilot/scripts/` with colocated `.test.mjs`
  files (vitest).
- Prose contracts in SKILL.md are pinned by `*-contract.test.mjs` guard tests,
  matched on load-bearing phrases and scoped to their section.
- Nested optional config blocks are merged per key in `mergeConfig` and
  validated with optional chaining in `validateConfig`; they stay out of
  `TOP_LEVEL`.
- Test command: `npm test`.
