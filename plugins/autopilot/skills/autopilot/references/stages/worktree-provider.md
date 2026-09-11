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

**The ledger's `worktree:` line is the sole source of the worktree path and the
branch name for every later stage.** Orca names the branch, and the name it
picks has nothing to do with `<run>`. Every stage that needs the branch — the
`--branch=` flag on a dispatch, `land`, `pr` — reads it back from that line.
Never derive it from `<run>`.
