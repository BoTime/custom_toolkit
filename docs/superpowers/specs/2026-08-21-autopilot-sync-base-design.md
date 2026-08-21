# Autopilot: always freshen base_ref before setup

**Date:** 2026-08-21
**Status:** Approved design, ready for planning

## Problem

The `setup` stage builds the run's worktree from `base_ref` (default
`origin/main`) and runs `autopilot-reaper.mjs`, which classifies worktrees as
reapable by cherry-picking against `base_ref` too. Today, the only thing that
freshens the local `origin/main` tracking ref before either of those happens is
a `git fetch origin` embedded as the first line of `autopilot-reaper.mjs`'s own
`main()`.

That means freshness is a side effect of the reaper running, not a guarantee:

- If a project sets `reaper: false` in `.claude/autopilot.json`, the fetch
  never happens, and the worktree gets built from whatever the local
  `origin/main` ref happened to be at last fetch — possibly stale, possibly
  from a previous session days earlier.
- Even with the reaper enabled, nothing pulls the local `main` branch forward.
  If a project's `base_ref` is configured as a bare local branch name (not an
  `origin/`-prefixed remote ref), the reaper's fetch refreshes remote-tracking
  refs but never touches that local branch, so the worktree is still built
  from stale state.

Verified live during this run: running the reaper against this repo fetched
`eaacc1f..e57aafa` on `origin/main` — i.e. this repo's local `origin/main` was
already behind before this very run started.

## Scope

One new script, one `SKILL.md` instruction change. No change to
`autopilot-reaper.mjs`'s or `autopilot-land.mjs`'s existing fetch calls — both
are harmless to run twice, and this is additive, not a replacement.

## Design

New script `plugins/autopilot/scripts/autopilot-sync-base.mjs`, in the same
style as `autopilot-reaper.mjs` / `autopilot-land.mjs`: pure, injectable
functions plus a thin `main()` CLI, so the branching logic is testable without
a live git repo.

Behavior, run unconditionally as the first action of the `setup` stage —
before the reaper conditional and before worktree creation, regardless of
`reaper`'s value:

1. `git fetch origin`. If this fails (network, auth), the script exits
   non-zero with the error — this is the one part that must not fail
   silently, since it's what actually keeps `origin/main` current for both the
   reaper's merge-check and the worktree's base.
2. Parse `base_ref` (e.g. `origin/main`, or a bare branch name like `main`) to
   find its local branch counterpart: strip a leading `origin/` if present,
   otherwise use the value as-is.
3. Best-effort fast-forward that local branch, never a merge commit, never
   overwriting anything:
   - Currently checked out here (this checkout) with a clean tree → fast
     -forward it in place (`merge --ff-only`).
   - Checked out in a *different* worktree → skip, record why. Never touch a
     checkout that belongs to another worktree.
   - Checked out here but the tree is dirty → skip, record why. Never risks
     uncommitted work.
   - Not checked out anywhere, and it *is* a fast-forward → move the local ref
     directly.
   - Not a fast-forward (local branch has diverged) → skip, record why. Never
     resolve divergence silently.
4. This local-branch step is best-effort and never blocks the run — the
   worktree's actual base is `base_ref` as a git rev (which step 1 already
   made fresh), so a skipped local fast-forward doesn't affect correctness,
   only convenience. `main()` prints one line per outcome (updated / skipped +
   reason).

## `SKILL.md` change

In the `### setup` section, add this as the unconditional first line of the
stage, ahead of the existing reaper paragraph:

```bash
node "$AP/scripts/autopilot-sync-base.mjs" --base=<config.base_ref>
```

Report its outcome (updated-or-skipped, with reason) the same way the
reaper's keep/reason list is already reported.

## Testing

- `autopilot-sync-base.test.mjs`, colocated, covering: clean current-branch
  fast-forward, dirty current-branch skip, checked-out-elsewhere skip,
  diverged skip, not-checked-out-anywhere fast-forward, and initial-fetch
  failure surfacing as an error. Same dependency-injection pattern
  `autopilot-land.mjs`'s `land(baseRef, run)` already uses — a fake `run()`,
  no real git repo needed.

## Version

Bump to 1.5.0 in both `plugins/autopilot/.claude-plugin/plugin.json` and
`.claude-plugin/marketplace.json` (plugin entry and marketplace metadata
block).

## Repo conventions

- Node helpers live in `plugins/autopilot/scripts/` with colocated
  `.test.mjs` files (vitest).
- Test command: `npm test`.

## Deferred

- Refactoring `autopilot-reaper.mjs` to reuse this script's fetch instead of
  its own inline one. Out of scope — the duplicate fetch is harmless and
  touching working, tested code for a cosmetic dedupe isn't worth the diff.
