# Autopilot findings capture and analysis

**Date:** 2026-08-11
**Status:** Approved design, ready for planning

## Problem

SDD generates review findings but they are effectively discarded. Task reports
are written by the implementer AFTER the fix and describe the corrected state —
they are success narratives. Verified in a real repo: 10 task reports, not one
mentions a review finding, fix round, or rejected verdict.

SDD's own `progress.md` does capture some findings, in prose. Real examples from
a completed run:

- Task 4: "Implementer correctly rewrote filter_records else-branch to
  CompRow(**row_dict); brief's 'body stays same' was internally inconsistent
  with the new return type" — a PLANNING defect, surfacing as an implementation
  workaround.
- Task 5: "service._logger is unused (brief added it; wire or remove in final
  polish)" — same root cause: the brief introduced dead code.

Two independent findings, both attributable to the brief, in a single run. This
proves the signal exists and is valuable. But the record is lossy: every line
reads "review clean, approved" (the outcome after fixing, not the finding), 9 of
11 tasks record no finding at all — indistinguishable from findings that were
resolved in-loop and never written down — and the useful attribution is a
comma-spliced clause in the middle of a completion sentence, written differently
by a different agent each time.

The autopilot ledger has the same blind spot: `sdd complete (<n> tasks, <k>
parked)` renders a run where every task needed three fix rounds identically to
one where all passed first try.

A log alone changes nothing, because nothing reads it back. Preventing recurrence
requires a READ path that re-enters the pipeline where the mistake would be made.

## Scope

Two of the three loop stages: **capture** and **analysis**.

Rule promotion is human-approved via a command. **Injection of rules into stage
prompts is explicitly OUT OF SCOPE** — deferred until the corpus proves what is
worth injecting. This run does not modify `writing-plans` or the SDD verification
contract's existing rules. An approved candidate is recorded for later, not wired
into a prompt.

## Capture

SDD's review roles append one JSON line per finding to
`.superpowers/autopilot/<run>/findings.jsonl` in the MAIN CHECKOUT, beside
`run.md`.

Fields: `task`, `round`, `severity`, `stage_at_fault`, `pattern`, `detail`,
`verdict`.

`stage_at_fault` is the field that makes this actionable rather than a blame log.
It names which stage produced the bad input — `brief`, `plan`, `spec`,
`implementation` — so a brief defect like Task 4 above does not read as an
implementer error. Framing every finding as a model mistake would tune the wrong
stage.

`pattern` is a short canonical phrase used for clustering; `detail` carries the
specifics. This keeps clustering a pure lexical function over JSON rather than
something requiring a model call.

A task that passes review writes an explicit clean line:
`{"task": N, "clean": true}`. Without it, absence of evidence is
indistinguishable from evidence of absence, occurrence counts are a floor rather
than a count, and no threshold can be trusted. This is why the design requires it.

This requires a dispatch-contract change in the `sdd` section of the autopilot
SKILL.md, written the way the existing verification contract is: naming the
concrete expected behavior. A general instruction to "log findings" will not
bind — the existing contract's rules 2 and 3 work precisely because they name
observed behaviors (`md5` comparisons, throwaway repositories).

## Analysis

A new `plugins/autopilot/scripts/autopilot-findings.mjs` helper plus a command
that:

- reads the corpus across runs
- clusters by `(stage_at_fault, pattern)`
- reports candidates above a configurable threshold, each with its evidence —
  run, task, and round for every occurrence

The threshold is a new key in `.claude/autopilot.json` with a sane default,
tunable once real data shows how noisy clustering is. It belongs with the other
config keys and must be handled by `autopilot-config.mjs` (note: `TOP_LEVEL`
there currently lists `worktree_dir`, `base_ref`, `reaper`).

The command proposes; the human approves, rejects, or edits. Nothing writes a
rule without a human yes. A pipeline that silently rewrites its own prompts from
its own review output can drift, and instruction drift is harder to notice and
trace than code drift.

## Ledger

`sdd complete` gains fix-round counts:
`sdd complete (10 tasks, 0 parked, 7 fix rounds across 4 tasks)`

This is the cheap signal — it needs no prompt change and makes a struggling run
visible at a glance.

## Placement fix

The run also pins an ambiguity found during this brainstorm. The ledger lives in
the main checkout, for two reasons the skill never states:

1. The ledger exists BEFORE the worktree does — `started (phase 1)` and
   `design approved` are appended during Phase 1, and `setup` (which creates the
   worktree) is the next stage.
2. It must SURVIVE the worktree — the reaper deletes worktrees after merge, so a
   ledger inside one would destroy the record of every completed run, including
   the PR URL that `nextStage` returns `done` on.

This has already drifted in practice: in a real repo, some runs wrote ledgers
INSIDE the worktree, and `<branch>` is interpreted inconsistently — sometimes the
run name, sometimes the `worktree-` prefixed git branch. This very run
demonstrates it: ledger dir `autopilot-mistake-feedback-loop`, worktree dir
`autopilot-findings-capture`, git branch `worktree-autopilot-findings-capture` —
three strings for one run.

The SKILL.md must state the main-checkout placement with both reasons, and give
`<run>` a single definition. `findings.jsonl` inherits the same placement.

### Known constraint (not solved here)

A harness-level constraint was discovered during this run: a worktree-isolated
session cannot WRITE (Write/Edit) to the main checkout, though Bash appends and
reads still work. This is recorded as a known constraint affecting where run
scaffolding can live. It is NOT solved by this design.

## Testing

- `autopilot-findings.mjs` gets colocated vitest coverage: parsing, clustering,
  threshold behavior, malformed-line tolerance, and clean-line handling.
- The dispatch-contract prose gets a guard test in the style of
  `autopilot-sdd-contract.test.mjs`, since prose changes break nothing else.

## Version

Bump to 1.3.0 in BOTH `plugins/autopilot/.claude-plugin/plugin.json` and
`.claude-plugin/marketplace.json` (both the plugin entry and the marketplace
metadata block).

## Repo conventions

- Node helpers live in `plugins/autopilot/scripts/` with colocated
  `.test.mjs` files (vitest).
- Test command: `npm test`.
- Prose contracts in SKILL.md files are pinned by guard tests.

## Deferred

- **Injection of rules into stage prompts.** Explicitly out of scope for this
  run; deferred until the corpus proves what is worth injecting. Approved
  candidates are recorded for later, not wired into a prompt.
- **The worktree-cannot-write-to-main-checkout constraint.** Recorded above as a
  known constraint; not addressed by this design.
