# Lightweight documents for `small`-tier runs

## Problem

A `small` run already caps the plan at one task, but the `spec` and `plan` stages write the same full-length documents a `large` run gets, and the spec is committed into `docs/superpowers/specs/` forever. For a 10 to 20 line fix, the two document dispatches are most of the run's wall clock and tokens, and the repo accumulates spec files nobody rereads. The tiered-ceremony design (`docs/superpowers/specs/2026-08-26-autopilot-tiered-ceremony-design.md`) kept `spec` and `plan` on every tier because they are the review surface where 92% of findings were caught. This design keeps that surface and shrinks the documents: on `small`, both are still written and still read by `plan`, `sdd` and `verify`, but they are short, live in the run's scratch directory (`.superpowers/autopilot/<run>/` in the main checkout, which is gitignored), and are never committed.

## The rule

A tier now binds three things: the plan ceiling, the review count, and — for `small` only — the document shape and location. `standard` and `large` are untouched. Every composed prompt for a run with no `--tier`, or with `--tier=standard` / `--tier=large`, must be byte-identical to today's output for the same inputs. That regression guarantee is the same one `minimalism.mode` and tiering relied on.

## Dispatch recipe (`plugins/autopilot/scripts/autopilot-dispatch.mjs`)

**`spec` stage.** `STAGES.spec.fragments` gains the same `values.tier` branch `plan` has. `spec-body.md` loses its inline "commit it / this is the run's first commit / do not open a pull request" sentences; those move verbatim into a new `spec-commit.md` fragment, emitted when tier is absent, `standard`, or `large`. When tier is `small`, the recipe emits a new `spec-small.md` instead: write a design paragraph of a few sentences plus the `## Acceptance criteria` section to `{{spec_path}}`, no other sections (no Problem, Non-goals, Measurement, per-file sections), do not commit, do not touch the worktree's tracked files. `spec-criteria.md` is emitted on every tier as today. `--tier` on the `spec` stage is validated with the same three-value error `plan` uses (the existing `tierBudget`/validation helper, or a shared validator extracted from it). Fragment order for the default path must reproduce today's byte-identical text: body (minus the moved sentences) + `spec-commit.md` must equal today's `spec-body.md` rendering, then `spec-criteria.md`.

**`plan` stage.** The same split. The `superpowers:writing-plans` invocation and its "answer the execution-choice question with `subagent-driven` — do not ask" instruction move from `plan-body.md` into a new `plan-writing-plans.md` fragment, emitted on every tier except `small`. On `small` the recipe emits a new `plan-inline-small.md`: write a single-task plan of roughly 20 to 40 lines to `{{plan_path}}` containing the files to touch, the change in a few sentences, the test to add, and which acceptance criteria it satisfies. It carries the same one-step escalation rule as `plan-budget-small.md`: if the work genuinely needs more than one task, write up to the `standard` ceiling in the same inline shape, open the plan with `## Escalation`, and say `escalated to standard: <reason>` in the return line. `plan-body.md` gains a `{{plan_path}}` placeholder so the orchestrator chooses the location on every tier; `--plan-path` therefore becomes required on `plan`. The budget, minimalism and learnings fragments are unchanged. Again the default path must be byte-identical to today except for the `{{plan_path}}` line, which is the one deliberate change on every tier — the test pins that difference precisely.

**`pr` stage.** When `--tier=small` is passed, the recipe emits a new `pr-small.md` fragment asking the agent to paste the spec's design paragraph and acceptance criteria into the PR description, reading them from `{{spec_path}}`. Because `{{spec_path}}` is consumed only by that fragment, the placeholder-check must accept a flag consumed by a fragment (or `spec_path` is added to RESERVED for `pr` — choose whichever keeps the existing "unconsumed flag" error intact for every other flag). Without `--tier`, or on other tiers, the `pr` prompt is byte-identical to today.

## Orchestrator (`plugins/autopilot/skills/autopilot/SKILL.md`)

- At `spec`: read the `tier:` ledger entry. On `small`, pass `--tier=small` and `--spec-path=<absolute run dir>/spec.md`. Otherwise pass the committed `docs/superpowers/specs/YYYY-MM-DD-<topic>-design.md` path as today, and `--tier=<tier>` when the ledger has one (omit when absent).
- The ledger entry on `small` becomes `spec written → <path>` instead of `spec committed → <path>`.
- At `plan`: pass `--plan-path`. On `small` it is `<absolute run dir>/plan.md`; otherwise `docs/superpowers/plans/YYYY-MM-DD-<topic>-plan.md` inside the worktree.
- Escalation on `small` records `tier escalated:` exactly as today and continues with the scratch documents and the inline plan shape. Nothing is promoted, rerun, or committed.
- At `pr`: on `small`, pass `--tier=small --spec-path=<absolute run dir>/spec.md`.
- Update the sentence "It never decides which documents get written — `spec` and `plan` run on every tier" to say both still run on every tier, and that on `small` they are short and live in the run directory uncommitted.

## Ledger (`plugins/autopilot/scripts/autopilot-ledger.mjs`)

`nextStage` treats `spec written` exactly as `spec committed`: either transitions to `plan`. It is a historical entry, not informational: a `spec written` line appended after a `PARKED` line must leave the run parked, the same guarantee AC15 of the tiered-ceremony design established for `tier:` lines.

## Error handling

Unknown tier values on `spec` and `pr` fail at compose time naming the three accepted values, as `plan` does now. A `small` spec or plan agent that commits anyway is a review finding, not a run failure. A missing `{{plan_path}}` is the existing unfilled-placeholder error.

## Testing

All in `plugins/autopilot/scripts/autopilot-dispatch.test.mjs` and `autopilot-ledger.test.mjs`, following the existing fixtures (`dispatch-fixture.mjs`). `npm test` must pass.

## Acceptance criteria

- AC1 (non-ui) — `compose()` for stage `spec` with no `--tier`, with `--tier=standard`, and with `--tier=large` produces output byte-identical to the current implementation's output for the same inputs
- AC2 (non-ui) — `compose()` for stage `spec` with `--tier=small` includes `spec-small.md`, includes `spec-criteria.md`, and contains neither the phrase "commit it" nor "first commit"
- AC3 (non-ui) — `compose()` for stage `spec` with `--tier=medium` throws an error naming `--tier` and listing `small`, `standard` and `large`
- AC4 (non-ui) — `compose()` for stage `plan` with no `--tier`, `--tier=standard`, or `--tier=large` includes `plan-writing-plans.md` and excludes `plan-inline-small.md`, and differs from the current implementation's output only by the rendered `{{plan_path}}` line
- AC5 (non-ui) — `compose()` for stage `plan` with `--tier=small` includes `plan-inline-small.md` and does not mention `superpowers:writing-plans`
- AC6 (non-ui) — `plan-inline-small.md` states the one-step escalation to `standard` and the `escalated to standard:` return-line form
- AC7 (non-ui) — `compose()` for stage `plan` without `--plan-path` throws the unfilled-placeholder error naming `{{plan_path}}`
- AC8 (non-ui) — `compose()` for stage `pr` with no `--tier` is byte-identical to the current implementation's output; with `--tier=small --spec-path=<p>` it includes `pr-small.md` and the rendered spec path
- AC9 (non-ui) — `--tier` on stages `spec` and `pr` does not trigger the unconsumed-flag error, and every other unrecognised flag still does
- AC10 (non-ui) — `nextStage` returns `plan` for a ledger whose last entry is `spec written → <path>`, and the same as for `spec committed → <path>`
- AC11 (non-ui) — a `spec written → <path>` entry appended after a `PARKED` entry leaves `nextStage` returning `parked`
- AC12 (non-ui) — autopilot's SKILL.md states the `small` routing at `spec`, `plan` and `pr` (scratch paths, `--tier`, `--plan-path`), the `spec written` ledger entry, and that escalation continues with the scratch documents
- AC13 (non-ui) — `README.md` documents that `small` runs keep their spec and plan in the run directory and commit neither, while `standard` and `large` are unchanged
- AC14 (non-ui) — `npm test` passes

## Non-goals

- Skipping either the `spec` or `plan` stage on any tier.
- Changing `standard` or `large` documents.
- A config knob to re-enable committed specs on `small`.
- Reducing fix rounds.
