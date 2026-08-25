VERIFY FIX ROUND — fix the UI acceptance criteria that failed browser
verification.

Run: {{run}}
Worktree (work only here): {{worktree}}

Failing criteria: {{failing_criteria}}

What the browser saw:

{{failures}}

Fix the implementation in the worktree so these criteria pass. Do not edit the
verification specs to make them pass — a check tuned to the bug verifies
nothing, and the criteria come from the committed spec, which governs.

There is exactly one fix round. If a criterion cannot be satisfied without a
design decision, say so and stop rather than guessing; a human decides.

Return one line naming what you changed.
