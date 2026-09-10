# Orca as the worktree provider

## Goal

Autopilot's `setup` stage creates its isolated checkout with
`superpowers:using-git-worktrees`: a plain `git worktree add` under
`config.worktree_dir`, on a branch the skill names `worktree-<run>`. That works,
but the resulting worktree is invisible to Orca — the tool that actually manages
this developer's workspaces. It does not appear in `orca worktree list`, it is
not linked to the GitHub issue that started the run, and it cannot be opened,
tracked or archived from the Orca app.

This change makes Orca the default worktree provider for autopilot runs, with
git kept as an explicit, fully supported alternative and as the automatic
fallback whenever Orca cannot serve. A run must never fail — or park — because
of the worktree provider: the provider is an ergonomic upgrade, not a new
dependency of the pipeline.

Two consequences follow from adopting Orca, and both are part of this design:

- **The branch name is no longer derivable.** Orca names the branch, and the
  name it picks (`BoTime/use-the-orca-as-the-worktree-provider` for this very
  run) has nothing to do with `worktree-<run>`. Every stage that wants the
  branch must read it from the ledger's `worktree:` line, which becomes the sole
  source of truth for both the path and the branch.
- **Removal goes through Orca too.** A worktree Orca created must be removed with
  `orca worktree rm`, so Orca's own record disappears with the checkout. The
  reaper grows a provider mode for that.

## Config

A new top-level key, `worktree_provider`, in both shipped defaults:

| File | Key | Value |
|---|---|---|
| `plugins/autopilot/autopilot.default.json` | `worktree_provider` | `"orca"` |
| `plugins/autopilot/autopilot.codex.default.json` | `worktree_provider` | `"orca"` |

Allowed values are exactly `"orca"` and `"git"`. The key is handled by
`plugins/autopilot/scripts/autopilot-config.mjs` the same way `worktree_dir`
already is:

- added to the module's `TOP_LEVEL` list, so an absent value is a load error
  rather than a silent default (the shipped defaults always supply it, so the
  merged config always has it — a project config that predates the key still
  loads, because the merge fills it in);
- validated against the allowed set, with a clear error naming the offending
  value and the two legal ones, e.g.
  `worktree_provider: "orka" is not one of orca, git`. A typo must not degrade
  quietly into one of the two providers — that is indistinguishable from never
  having configured the feature.

`scaffoldConfig` materialises the shipped defaults verbatim, so the scaffolded
project config carries `worktree_provider` with no extra work; the contract test
pins that it is present.

`worktree_dir` keeps its meaning and stays required. Under the `git` provider it
is where worktrees are created and what the reaper scans; under `orca` it is
unused for creation (Orca owns the layout, e.g.
`~/orca/workspaces/<repo>/<name>`), and the reaper's orca mode does not apply
the directory filter.

## New script: `plugins/autopilot/scripts/autopilot-worktree.mjs`

One subcommand, `create`:

```bash
node "$AP/scripts/autopilot-worktree.mjs" create \
  --config=<config path> --host=<host> --name=<run> --base=<base_ref> [--issue=<n>]
```

Behaviour:

1. Load and merge config through `loadConfig` from `autopilot-config.mjs` — the
   same path every other script uses, so the provider decision is read from the
   same merged view the rest of the stage sees.
2. **`worktree_provider` is `git`** — print `provider: git` and exit 0. Nothing
   about the git path changes; the setup stage reads that line and uses
   `superpowers:using-git-worktrees` exactly as today.
3. **`worktree_provider` is `orca`** —
   a. Locate the main checkout with `git rev-parse --git-common-dir`, resolved
      upward to the repository root, reusing the reaper's `resolveMainPath`
      logic rather than a second implementation.
   b. Probe for the `orca` binary.
   c. Resolve the Orca repo id by running `orca worktree current --json` from
      the main checkout, falling back to
      `orca repo show --repo path:<main> --json` when that yields nothing usable
      (the main checkout may not itself be an Orca-managed worktree, but the
      repo is still registered).
   d. Create:
      ```
      orca worktree create --name <run> --repo id:<id> --base-branch <base> \
        [--issue <n>] --no-parent --json
      ```
      `--no-parent` is deliberate: an autopilot run is independent work, and
      Orca would otherwise infer the caller's worktree as a parent and inherit
      lineage that does not apply.
   e. Print `worktree: <path> (branch <branch>)` parsed from the JSON result,
      with the branch stripped of its `refs/heads/` prefix.

### Orca JSON shapes

Observed from the installed CLI, and what the parser must accept:

```json
{ "ok": true,
  "result": { "worktree": { "repoId": "…", "path": "/abs/path",
                            "branch": "refs/heads/Some/Branch",
                            "isMainWorktree": false } } }
```

`orca worktree current --json` and `orca worktree create --json` both return a
single `result.worktree`; `orca worktree list --json` returns
`result.worktrees[]` with the same per-worktree fields. Any response whose top
level is not `ok: true`, or whose `result.worktree` lacks a usable `path` or
`branch`, is a failure and takes the fallback path below.

### Base ref normalisation

`base_ref` is `origin/main` in the shipped defaults, but `--base-branch` wants a
branch name. An `origin/` (more generally, `<remote>/`) prefix is stripped to
the bare branch name before it is passed to Orca. A `base_ref` with no prefix
passes through unchanged.

### Failure is always a fallback, never a park

On **any** failure at any step — binary missing, repo not registered, repo id
unresolvable, non-`ok` JSON, unparsable output, a non-zero `orca worktree
create` — the script prints

```
fallback: git — <reason>
```

and exits 0. It never parks, and it never exits non-zero for a provider
problem. The only non-zero exit is a usage error: a missing or malformed flag,
an unreadable config, or an invalid `worktree_provider` — problems with the
call, not with Orca.

This asymmetry is the whole safety story. Autopilot's Phase 2 is unattended; a
provider that can halt a run is worse than no provider at all.

### Process hygiene

All subprocesses run through `execFileSync` with argv arrays. Run names, paths
and branch names never pass through a shell string — a run name is derived from
a GitHub issue title, which is untrusted third-party text.

### Testability

The script exports pure functions and keeps `main()` thin:

- argv building for `orca worktree create` (with and without `--issue`);
- base-ref normalisation;
- JSON result parsing (`create`, `current`, `list` shapes) into
  `{ path, branch }` or a typed failure;
- output-line formatting (`worktree:`, `provider: git`, `fallback: git — …`).

`main()` takes an injectable exec so tests stub the `orca` and `git`
subprocesses entirely; no test shells out to a real binary.

## Setup stage prose (`plugins/autopilot/skills/autopilot/SKILL.md`)

The `setup` section keeps its current order — `autopilot-sync-base.mjs` first,
unconditionally, then the reaper unless `reaper` is `false` — and then runs the
create script instead of going straight to `superpowers:using-git-worktrees`.

Three outcomes, one line of output each:

| Script output | Setup does |
|---|---|
| `worktree: <path> (branch <branch>)` | Append that line **verbatim** to the ledger. Skip `superpowers:using-git-worktrees` entirely. |
| `fallback: git — <reason>` | Append `worktree provider: fell back to git — <reason>`, then create the worktree with `superpowers:using-git-worktrees` as today and append `worktree: <path> (branch <name>)`. |
| `provider: git` | Go straight to the `superpowers:using-git-worktrees` path and append `worktree: <path> (branch <name>)`. |

The git path is unchanged in every detail: the consent question is still
answered up front in the dispatch instruction, and `worktree_dir` from config is
still passed as the declared directory rather than letting the skill use its own
`.worktrees/` default.

The reaper invocation gains the provider flag:

```bash
node "$AP/scripts/autopilot-reaper.mjs" --apply \
  --dir=<config.worktree_dir> --base=<config.base_ref> \
  --provider=<config.worktree_provider>
```

**The ledger's `worktree:` line is the sole source of the worktree path and
branch name for every later stage.** The prose that assumes the branch is
`worktree-<run>` is removed. Stages that need the branch — land, PR — read it
from the ledger.

## `plugins/autopilot/skills/autopilot-github/SKILL.md`

Delta 2 (run naming) is updated:

- the create script is called with `--issue <n>`, so Orca links the new worktree
  to the GitHub issue and the Orca app shows the run against its issue;
- the claim that the git branch "becomes `worktree-issue-42-…`" is qualified: it
  holds for the git provider, while under Orca the branch is whatever Orca names
  and is read from the ledger's `worktree:` line. `<run>` itself is unchanged —
  it is still `issue-<n>-<slug>`, computed once at resolution, and still the
  ledger directory's key.

## Reaper (`plugins/autopilot/scripts/autopilot-reaper.mjs`)

A new flag, `--provider=orca|git`, defaulting to `git`. Without it the reaper
behaves exactly as it does today: `git worktree list --porcelain`, the
`worktree_dir` filter, the merged/clean/unlocked probe, `git worktree remove`
plus `git worktree prune`.

In **orca mode**:

- resolve the repo id the same way the create script does;
- enumerate with `orca worktree list --repo id:<id> --json`;
- skip any entry with `isMainWorktree: true` — that is the main checkout, and
  the existing `mainPath` guard alone is not enough once paths come from Orca;
- apply the **existing** reapability probe unchanged to each remaining path:
  `git cherry <base> <branch>` for unmerged commits and `git status --porcelain`
  in the worktree for uncommitted changes, plus the detached-HEAD and lock
  guards;
- remove each reapable one with
  `orca worktree rm --worktree path:<path> --json`, so Orca's record and the git
  checkout go together.

The `worktree_dir` containment filter does not apply in orca mode: Orca chooses
the layout, and a directory filter written for `.claude/worktrees` would reject
every candidate.

If the Orca CLI is absent or the repo id cannot be resolved, the reaper prints

```
orca unavailable — <reason>; nothing reaped
```

and exits 0. Reaping is opportunistic housekeeping; failing the setup stage over
it would be a poor trade.

`--apply` keeps its meaning in both modes: without it, the reaper reports what
it would remove and removes nothing.

## Tests

| File | Covers |
|---|---|
| `plugins/autopilot/scripts/autopilot-worktree.test.mjs` (new) | argv building with and without `--issue`; base-ref normalisation (`origin/main` → `main`, bare name unchanged); parsing of the `create`/`current` JSON shapes; `worktree:` line formatting including the `refs/heads/` strip; each fallback reason (binary missing, repo unresolvable, non-`ok` JSON, create failure, unparsable output) printing `fallback: git — …` and exiting 0; the `git` provider short-circuit printing `provider: git`. All via a stubbed exec. |
| `plugins/autopilot/scripts/autopilot-reaper.test.mjs` | orca listing → reap plan; `isMainWorktree` entries skipped; `orca worktree rm` argv; the unavailable path printing `orca unavailable — …` and exiting 0; the existing git-mode tests unchanged. |
| `plugins/autopilot/scripts/autopilot-config.test.mjs` | `worktree_provider` defaults to `orca`; `git` accepted; any other value rejected with a clear error; a missing value is a validation error; the scaffolded config carries the key. |
| Skill contract tests (`skill-sections.test.mjs` or a sibling) | `skills/autopilot/SKILL.md` references `autopilot-worktree.mjs`, the `fallback: git —` line and `--provider=`; `skills/autopilot-github/SKILL.md` references `--issue`. |

No test asserts a version literal, per this repository's release automation
rules.

## Non-goals

- Teaching any other stage to talk to Orca. Only `setup` creates and only the
  reaper removes; land, verify and the PR stages continue to work from the
  ledger and from git.
- Orca-managed terminals or agents for stage dispatch. `--agent`/`--prompt` are
  not used; autopilot's own dispatch is unchanged.
- Migrating worktrees that already exist under `config.worktree_dir`. They stay
  git worktrees and are reaped by the git-mode reaper.

## Acceptance criteria

- AC1 (non-ui) — `worktree_provider` is present in both shipped default configs
  with the value `orca`, and a config carrying any value other than `orca` or
  `git` fails validation with an error naming the offending value.
- AC2 (non-ui) — with `worktree_provider` set to `git`, the create script prints
  `provider: git` and the setup stage creates the worktree through
  `superpowers:using-git-worktrees` exactly as it does today.
- AC3 (non-ui) — with `worktree_provider` set to `orca` and Orca available, the
  worktree is created through `orca worktree create` and the ledger records a
  `worktree: <path> (branch <branch>)` line carrying the path and branch Orca
  reported, with no `refs/heads/` prefix.
- AC4 (non-ui) — with `worktree_provider` set to `orca` and Orca unavailable or
  failing, the create script prints `fallback: git — <reason>` and exits 0, the
  ledger records `worktree provider: fell back to git — <reason>`, and the run
  continues to a green finish on a git worktree.
- AC5 (non-ui) — under `/autopilot-github`, the Orca worktree is created with
  `--issue <n>` so it is linked to the issue that started the run.
- AC6 (non-ui) — the reaper run with `--provider=orca --apply` removes merged,
  clean, unlocked Orca worktrees through `orca worktree rm` and never removes
  the entry reported with `isMainWorktree: true`.
- AC7 (non-ui) — the reaper run with `--provider=orca` when the Orca CLI is
  absent or the repo id is unresolvable prints `orca unavailable — <reason>;
  nothing reaped` and exits 0.
- AC8 (non-ui) — later stages take the worktree path and branch from the
  ledger's `worktree:` line rather than deriving `worktree-<run>`, and both
  SKILL.md files no longer state that the branch is always `worktree-<run>`.
