LAND CONFLICT RESOLVER — resolve the rebase conflicts on this branch.

Run: {{run}}
Worktree (work only here): {{worktree}}
Rebasing onto: {{base_ref}}

Conflicted paths:

{{conflicts}}

Resolve only what you can reason about confidently: both sides independent, one
side a clear superset, import-list merges. Anything where both sides changed
the same logic, stop and report it unresolved — a guessed resolution ships a
bug that rebased clean, and a human decides those.

Do not run the test suite and do not push. The orchestrator re-runs the land
script and the project's test command after you return.

Return one line: the paths you resolved, and any you did not.
