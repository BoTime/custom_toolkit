# The worktree provider

`autopilot-worktree.mjs create` prints exactly one line. Act on it, then append
to the ledger.

| Script output | What `setup` does |
|---|---|
| `worktree: <path> (branch <branch>)` | Append that line **verbatim**. Orca has already created the checkout — skip `superpowers:using-git-worktrees` entirely. |
| `provider: git` | Create the worktree the git way (below), then append `worktree: <path> (branch <name>)`. |
| `fallback: git — <reason>` | Append `worktree provider: fell back to git — <reason>`, create the worktree the git way (below), then append `worktree: <path> (branch <name>)`. |

**Starting inside an Orca worktree.** Orca's own handoff path — `orca worktree
create --agent claude --prompt "/autopilot-github 48"` from the main card —
starts the run *inside* a worktree Orca already made for it. The script checks
for that first: when the current directory is inside a non-main Orca worktree,
it prints that worktree's `worktree:` line, links the issue to it when
`--issue` was given, and creates nothing. The run directory then lives in that
checkout too, which is fine — `.superpowers/` is gitignored. The dashboard keeps
watching the one agent Orca launched, and the card carries the commits.

A provider problem is never a park and never a non-zero exit. A non-zero exit
means the call itself was wrong — a missing flag, an unreadable config, or a
`worktree_provider` that is neither `orca` nor `git`. Fix the call and rerun it.

**The git way.** Create the worktree from `base_ref` using
`superpowers:using-git-worktrees`. Phase 2 is unattended, so answer its consent
question up front in the same instruction rather than letting it ask: state
explicitly that a worktree is wanted, and pass `worktree_dir` from config as the
declared directory — this repository uses `.claude/worktrees/` (what
`autopilot-reaper.mjs` scans), not that skill's own `.worktrees/` default.

## When the recorded worktree is gone

A run's worktree can vanish mid-run: Orca's UI removes the card, a concurrent
run's reaper reaps it while it is still merged and clean, or someone deletes the
directory. The branch survives all three — every commit the run has made is on
it — so the checkout is recoverable. **Never improvise one.** A `git worktree
add` typed by hand in an Orca-managed project leaves the run somewhere the
dashboard is not watching, and leaves the ledger claiming a provider that no
longer owns it.

Run this from the repository root, passing the path and the branch exactly as
the ledger's `worktree:` line spells them:

```bash
node "$AP/scripts/autopilot-worktree.mjs" restore \
  --config=<config> --host=<host> --path=<path> --branch=<branch>
```

| Script output | What to do |
|---|---|
| `worktree intact: <path> (branch <branch>)` | Nothing was wrong. Append nothing; carry on with the stage. |
| `worktree restored: <path> (branch <branch>)` | Append that line **verbatim**, then carry on. |
| `worktree restored: … — no longer orca-managed: <reason>` | Append **verbatim**. The run continues in place; that note is the only thing telling your human partner the Orca card no longer tracks it. |
| `park: <reason>` | Park, with the reason verbatim: `PARKED — <reason>`. |

The path never moves. `restore` puts the checkout back where the ledger already
says it is, on the branch the ledger already names, because every later stage
reads both from that one line — a relocated worktree would need a second
`worktree:` line and nothing reads the second one.

Under the `orca` provider the restore is git's work and says so. Orca cannot
take back a checkout it did not create: `orca worktree set --worktree
path:<orphan>` answers `ok: true` and echoes a record, while `orca worktree
current` in that same directory still reports `selector_not_found`. Reporting
the downgrade is the alternative to a run that looks provider-managed and is
not.

A park here is not a provider problem — it is the run's state being
unrecoverable. The branch is gone, so the commits are gone with it; or the
recorded path holds some other branch, so the ledger no longer describes
reality. Both are decisions for your human partner.

**The ledger's `worktree:` line is the sole source of the worktree path and the
branch name for every later stage.** Orca names the branch, and the name it
picks has nothing to do with `<run>`. Every stage that needs the branch — the
`--branch=` flag on a dispatch, `land`, `pr` — reads it back from that line.
Never derive it from `<run>`.
