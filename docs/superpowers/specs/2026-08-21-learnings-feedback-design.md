# Autopilot: feed run learnings back into planning

**Date:** 2026-08-21
**Status:** Approved design, ready for planning

## Problem

Every autopilot run already captures review findings during `sdd` — SDD's review
roles append one JSON line per finding to `.superpowers/autopilot/<run>/findings.jsonl`,
and the findings-capture work gave that corpus a read path that clusters it into
rule candidates for a human to approve. But that read path ends at a human
reviewing a report. Nothing re-enters the pipeline, so the corpus does not change
what the next run *does*: the same planning mistakes recur run after run, and the
findings corpus keeps naming them without anyone applying them.

This is lever #2 of issue #13. The loop this spec builds:

1. every run captures findings during `sdd` (already in place),
2. a new `learnings` stage summarizes those findings into a git-tracked doc,
3. that doc rides the run's PR to main,
4. and every subsequent run's **plan** stage reads the doc and applies it.

Over successive runs, planning stops repeating the mistakes the findings corpus
names.

## Scope

One git-tracked doc, one new stage in the pipeline, one new role, one
dispatch-prompt change, and one `nextStage` extension. The read path is scoped
to the **plan** stage only.

Explicitly out of scope:

- **Injection into any other stage's prompt.** `sdd`, `spec`, `land`, `pr`, and
  the brainstorm all read no learnings. The plan stage is the single, deliberate
  relaxation of the plugin's no-injection stance (see "The plan stage change").
- **Deterministic summarization.** The doc is agent-written narrative by a
  dispatched `learnings` role, not a script that mechanically renders the corpus.
  The existing `autopilot-findings.mjs` report stays human-facing and unchanged.
- **Automatic rule promotion.** Nothing writes a rule without the learnings agent
  distilling it into prose and a human reviewing the resulting PR, exactly as the
  findings-capture design already established ("the command proposes; the human
  disposes").
- **Reading the doc back into `sdd` or into the findings analyzer.** The doc
  informs planning; it does not feed the analyzer or the implementer.

## Architecture

The loop has two halves that already exist on either side and one new joining
half. The capture half (`sdd` → `findings.jsonl`) and the human-review half
(`autopilot-findings.mjs` → candidates) are unchanged. The new half is a
**learnings doc** that is the only artifact both written *and* read by the
pipeline:

```
sdd  ──writes──▶  findings.jsonl (per-run, main checkout, uncommitted)
                        │
learnings  ──reads corpus + this run's findings, rewrites──▶  docs/autopilot/learnings.md (committed)
                        │  rides the PR to main
plan  ──reads──▶  docs/autopilot/learnings.md  (next run)
```

Three placement facts make the loop work, and each is load-bearing:

1. **The doc is committed inside the worktree and rides the PR.** It is a
   repo-level file (`docs/autopilot/learnings.md`), written to the run's branch
   and merged to main with the rest of the run's work. Nothing pushes directly to
   main. This is the same mechanism the `spec` stage already uses for the spec
   doc.
2. **The corpus is read from the main checkout, not the worktree.** The
   accumulated findings live at `.superpowers/autopilot/<run>/findings.jsonl` in
   the main checkout (per the findings-capture design's placement rule), and
   survive the reaper. A worktree-isolated session cannot Write/Edit the main
   checkout, but **Bash reads work**, so the learnings role reads the corpus via
   Bash.
3. **The doc is a rewrite, not an append.** Each run rewrites the whole file so
   it stays bounded. A living doc that only ever grew would become unreadable and,
   worse, an unmaintained graveyard that the plan agent stops trusting.

## The learnings doc

New git-tracked file `docs/autopilot/learnings.md` at the repository root. It is
repo-level (not run-level) because the plugin runs in many repos, and each repo
carries its own accumulated learnings.

It holds two sections:

- **"Planning rules"** — concise, actionable prose rules for the plan stage,
  distilled from the findings corpus. Plan-stage patterns
  (`stage_at_fault == "plan"`) are prioritized, per lever #2, since they are the
  ones the plan agent can directly stop repeating. Each rule is phrased as an
  instruction the plan agent can act on ("merge trivially-coupled steps", "do not
  merge steps that touch unrelated subsystems"), never as a blame record.
- **Recent runs** — compact summaries of recent runs, so a reader sees what the
  rules are grounded in and what has been tried. This section is trimmed to the
  most recent runs; it does not grow without bound.

The doc is **seeded on the first run from the existing corpus** — the findings
files accumulated across prior runs (22 findings files, 56% plan-sourced at the
time of writing). When the learnings role finds no `docs/autopilot/learnings.md`
on the branch, it creates one from the corpus rather than starting empty, so the
first rewritten doc already carries distilled rules.

## The `learnings` stage

A new stage in the autopilot pipeline, **between `sdd` and `land`**. It is a
normal stage in every respect: it re-reads the ledger before dispatching, appends
after, generates a subagent definition from the role config, and is idempotent
(skips if its output already exists on the branch).

It dispatches the `learnings` role (see below) with a prompt that instructs it to:

1. Read this run's `.superpowers/autopilot/<run>/findings.jsonl` from the main
   checkout (via Bash — reads work from a worktree-isolated session).
2. Read the accumulated corpus across `.superpowers/autopilot/*/findings.jsonl`
   the same way.
3. Read the existing `docs/autopilot/learnings.md` on the branch, if present.
4. Rewrite the doc — **condensed, bounded, not endlessly appended** — preserving
   the two-section shape above, with plan-stage patterns prioritized into the
   "Planning rules" section.
5. Write the rewritten doc **inside the worktree** at `docs/autopilot/learnings.md`.
6. Commit it to the branch.

Ledger entry, appended via `autopilot-ledger.mjs` like every other stage:

```
learnings committed → docs/autopilot/learnings.md
```

Because `autopilot-github` runs this same pipeline unchanged (it is a wrapper, not
a copy), plain `/autopilot` and `/autopilot-github` both summarize automatically.
The `autopilot-github` wrapper SKILL.md gains a note to that effect (see "Where
this changes code").

## The `learnings` role

A new entry in `plugins/autopilot/autopilot.default.json`'s `roles` block:

```json
"learnings": { "model": "opus", "effort": "high" }
```

It is dispatched through the standard pattern: the orchestrator generates a
subagent definition carrying the role's model and effort from config and writes it
to `.superpowers/autopilot/<run>/agents/learnings.md`. Summarizing a corpus into
actionable planning rules is a judgment-heavy task, hence opus/high — it sits
with `spec`, `plan`, and `final_review`, not the sonnet/medium mechanical roles.

Supporting change: `autopilot-config.mjs`'s `ROLES` array gains `"learnings"` so
`validateConfig` enforces its `model` and `effort` exactly as it does for the nine
existing roles. Without that, a project that overrides the role with a bad value
passes validation silently and the generated agent definition reads
`model: undefined` / `effort: undefined`. This is a validation-parity edit, not a
behavioral change (the role lives in the plugin defaults, so `mergeConfig` already
carries it through; only its validation is gated by `ROLES`).

## The plan stage change

The `plan` stage's dispatch prompt gains one instruction, alongside the existing
task-count budget:

> Read `docs/autopilot/learnings.md` if present and apply its planning rules to
> this plan.

Absence is handled: early runs have no file, and a run in a repo that has never
produced learnings finds none — the plan agent simply plans without them. No
parking, no error, no prompt-injection into anything else.

This is the deliberate, bounded relaxation of the plugin's no-injection stance
(pinned in the findings-capture design's "Deferred" section). It is scoped to the
**plan stage only**, and it injects prose that a human already reviewed by way of
the PR that carried the doc to main — not the pipeline silently rewriting its own
prompts from its own raw output.

## Error handling

A `learnings`-stage failure does **not** park. Log it and continue: append a
failure entry that does **not** carry the `learnings committed` prefix (e.g.
`learnings failed — <reason>`) and proceed to `land`.

This matches the existing precedent — autopilot-github's "transition failures do
not park" and the `pr` stage's "if the `gh pr edit` fails, do not park". The run's
product is the pull request; a stale learnings doc is a reporting defect, not a
reason to abandon a green branch. The ledger line is what makes it visible
afterwards.

The consequence for resume is deliberate: `nextStage` treats only
`learnings committed` as "this stage is done", so a ledger that ends in
`learnings failed` (with `sdd complete` present) resumes at `learnings`, retrying
the stage. The rewrite is idempotent and cheap, so a transient failure gets a
second chance on the next resume rather than being silently skipped.

The one hard stop anywhere in this design is unchanged: autopilot's preflight
(and autopilot-github's preflight) run before the brainstorm. Nothing new parks a
run.

## Concurrency

Concurrent runs each rewrite the doc on their own branch. The `land` stage's
rebase is what reconciles them: when two branches both changed
`docs/autopilot/learnings.md`, the full-file conflict is resolved **wholesale —
the later run's rewrite wins** — never a textual three-way merge, which would
interleave two independent agent rewrites into prose neither wrote. The doc is a
single authoring surface per run; wholesale replacement is the only merge that
preserves a coherent narrative.

## Data flow

Stage order for a full run, with the new stage in place:

```
started (phase 1)
design approved
worktree: <path> (branch <name>)
spec committed → <path>
plan complete → <path> (<n> tasks)      ← reads docs/autopilot/learnings.md if present
sdd complete (<n> tasks, <k> parked, <f> fix rounds across <t> tasks)
learnings committed → docs/autopilot/learnings.md   ← new
rebase clean, tests green (<n> passed)
pr: <url>
```

The `learnings` stage reads from the main checkout (corpus + this run's
findings) and writes to the worktree (the doc), so the doc is the only new
artifact that is committed and shipped. The findings files remain uncommitted
runtime scaffolding, exactly as the findings-capture design left them.

## `nextStage` change

`autopilot-ledger.mjs`'s `nextStage` gains a `learnings` resume case. The
`learnings` stage sits between `sdd` and `land`, so two lines of the chain move:

```
if (has("pr:")) return "done";
if (has("rebase clean")) return "pr";
if (has("learnings committed")) return "land";   // new — and MUST precede the sdd check
if (has("sdd complete")) return "learnings";      // was "land"
if (has("plan complete")) return "sdd";
if (has("spec committed")) return "plan";
if (has("worktree:")) return "spec";
if (has("design approved")) return "setup";
return "phase1";
```

The ordering constraint is load-bearing: `learnings committed` must be checked
**before** `sdd complete`. Both are `has()` matches over the whole ledger, so a
ledger that contains both lines matches both; if `sdd complete` were checked
first, a run whose learnings stage already finished would resolve to `learnings`
again and resume would re-dispatch the stage. Prefix order encodes stage order
here, exactly as it already does for `rebase clean` before `sdd complete`.

`learnings committed` is also a non-colliding prefix: it starts with neither
`spec` nor any other existing entry string, so it cannot be shadowed by an
earlier `has()` check. The autopilot SKILL.md's Resume section's stage list
("one of nine values … the seven stages") becomes "one of ten values … the eight
stages" with `learnings` inserted between `sdd` and `land`.

## Where this changes code

- `plugins/autopilot/skills/autopilot/SKILL.md` — new `### \`learnings\`` stage
  between `sdd` and `land`; the plan-stage prompt change; the Resume section's
  stage list gains `learnings`.
- `plugins/autopilot/skills/autopilot-github/SKILL.md` — a note that the
  `learnings` stage runs within the wrapped pipeline (both plain `/autopilot` and
  `/autopilot-github` summarize automatically), and the wrapper's restated
  pipeline/prefix list gains `learnings committed` so its structural-rule prose
  does not drift from autopilot's.
- `plugins/autopilot/autopilot.default.json` — new `learnings` role (opus/high).
- `plugins/autopilot/scripts/autopilot-config.mjs` — `ROLES` gains `"learnings"`
  (validation parity; see "The `learnings` role").
- `plugins/autopilot/scripts/autopilot-ledger.mjs` — `nextStage` gains the
  `learnings committed` resume case and redirects `sdd complete` to `learnings`.

## Testing

Colocated vitest files, matching the repo's existing pattern (`npm test`).

**`autopilot-learnings-contract.test.mjs`** (new) — a prose guard test in the
style of `autopilot-sdd-contract.test.mjs` and
`autopilot-findings-contract.test.mjs`, since a stage made of prose breaks nothing
else when it drifts:

- the `learnings` section names the corpus file and its main-checkout placement,
- it names the two doc sections ("Planning rules", "Recent runs") and the
  bounded-rewrite instruction (condense, do not append),
- it says the doc is written inside the worktree and committed to the branch,
- the plan section's dispatch prompt contains the instruction to read
  `docs/autopilot/learnings.md` and to apply its planning rules, and handles
  absence,
- the plan-section change does not displace the existing task-count budget.

**`autopilot-ledger.test.mjs`** (extended) — `nextStage` resume:

- a ledger ending in `sdd complete (...)` resolves to `learnings`, not `land`,
- a ledger ending in `learnings committed → docs/autopilot/learnings.md`
  resolves to `land`,
- a ledger containing both `sdd complete` and `learnings committed` resolves to
  `land` (the ordering constraint: the later stage wins),
- a ledger ending in `learnings failed — <reason>` (with `sdd complete` present)
  resolves to `learnings` (failure retries on resume).

**`autopilot-ledger-coupling.test.mjs`** (extended) — pin `learnings committed`
as a resumable, non-colliding prefix by adding it to the `STAGE_ENTRIES` table
in pipeline order (after `sdd complete`, before `rebase clean`), so the
coupling between SKILL.md's append instruction and `nextStage`'s match stays
tested end to end. The existing `sdd complete … returns "land"` rows flip to
`"learnings"` as part of the same change.

**`autopilot-github-contract.test.mjs`** (extended) — the wrapper still delegates
to `autopilot:autopilot`, still does not dispatch it as a subagent, and its
restated prefix list includes `learnings committed`.

## Resolved ambiguities

Three points the design left open are pinned here rather than left to the
implementer.

1. **`sdd complete` redirects to `learnings`, not `land`.** The design says only
   that `nextStage` "gains a learnings resume case", but the stage sits between
   `sdd` and `land`, so the `sdd complete` arm must move too. Pinned: `sdd
   complete` → `learnings`; `learnings committed` → `land`; and the `learnings
   committed` check precedes the `sdd complete` check (see "`nextStage` change").
2. **The failure entry is named and its resume consequence is intended.** The
   design says "log it and continue" without naming the entry. Pinned:
   `learnings failed — <reason>`, which deliberately does **not** start with
   `learnings committed`, so only a successful commit marks the stage done and a
   failed one retries on resume.
3. **`ROLES` in `autopilot-config.mjs` grows too.** The design's file list does
   not name the config loader, but adding a role without adding it to `ROLES`
   means `validateConfig` never checks it. Pinned as a supporting edit, not a new
   feature.

## Repo conventions

- Node helpers live in `plugins/autopilot/scripts/` with colocated `.test.mjs`
  files (vitest).
- Test command: `npm test`.
- Prose contracts in SKILL.md files are pinned by guard tests.
- Ledger entries are always appended via `autopilot-ledger.mjs` (ISO timestamped),
  never by hand.

## Deferred

- **Injecting learnings into any other stage.** The `sdd` verification contract,
  the `spec` prompt, and the brainstorm stay learnings-free until the plan-stage
  relaxation proves out and a specific next stage demonstrates a need.
- **A deterministic summarizer.** The doc is agent-written narrative. If the
  rewrite drifts or bloats in practice, a scripted condensation step belongs in a
  later run, not in this one.
- **Version bump.** The approved design does not specify one and its file-change
  list is exhaustive (it names no `plugin.json` / `marketplace.json` edit). If the
  additive role and stage warrant a minor bump, that is a planning-time decision,
  not part of this spec.
