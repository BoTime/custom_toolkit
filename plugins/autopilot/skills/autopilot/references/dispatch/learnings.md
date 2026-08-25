Rewrite this branch's `docs/autopilot/learnings.md`:

1. Read this run's findings at `.superpowers/autopilot/<run>/findings.jsonl`
   in the **main checkout** — via Bash, not Write/Edit. The file mixes both
   producers under one seven-field contract: `sdd`'s review findings and
   `verify`'s browser evidence, told apart by `stage_at_fault` and `pattern`,
   not by any producer tag.
2. Read the accumulated corpus across `.superpowers/autopilot/*/findings.jsonl`
   the same way.
3. Read the existing `docs/autopilot/learnings.md` on the branch, if present.
4. Rewrite the doc — **condensed and bounded, not endlessly appended** —
   keeping two sections: **"Planning rules"** (actionable prose rules for the
   plan stage, with `stage_at_fault == "plan"` findings prioritized) and
   **"Recent runs"** (compact summaries, trimmed to the most recent runs).
5. Write the rewritten doc **inside the worktree** at
   `docs/autopilot/learnings.md`.
6. Commit it to the branch.

If no `docs/autopilot/learnings.md` exists on the branch yet, seed it from the
accumulated corpus rather than starting empty.
