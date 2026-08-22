# Autopilot learnings

Distilled from the findings corpus across autopilot runs. Future runs' plan stages read this before planning.

## Planning rules

- Verify every asserted index, quoted substring, or literal against the artifact as written, not the intended one. A plan that cites a fixture entry at the wrong index (or quotes prose with the wrong quoting) produces a brief whose own tests contradict it.
- Never route user- or issue-supplied text through shell string interpolation. When plan-specified prose or code embeds an untrusted GitHub issue title (or similar), mandate `spawnSync` array args or an injected file write instead — double-quoted interpolation is a command-injection path.
- Surface cross-task seams explicitly. When one task's output is consumed by another, name the exact value passed across the boundary and pin it with a test; don't let the producer print only "ok" while a downstream task needs the resolved data.
- Verify the plan's tests exercise the real desired outcome, not a degenerate no-op that passes trivially (e.g. fast-forwarding a branch onto itself) and hides the gap from the suite.
- Guard load-bearing prose and error-handling instructions. When a plan adds SKILL.md prose a dispatched agent must follow — or an exit/error semantic that must not fail silently — add a contract test or an explicit instruction, check subprocess exit codes, and remove stale prose that contradicts the new semantics.

## Recent runs

- issue-13-autopilot-feed-run-learnings-back-into-p — plan 3 (all minor: test index mismatch, unguarded load-bearing prose, stale prose), 2 tasks clean.
- autopilot-sync-base-ref — plan 7, impl 1, 2 tasks clean. Notable: bare-branch no-op fast-forward success, missing error-handling instruction in dispatched prose, unchecked git subprocess exit codes.
- autopilot-github-skill — plan 6 (2 major), impl 1, 3 tasks clean. Notable: untrusted issue title interpolated into shell printf (injection), cross-task seam data not surfaced at the CLI boundary.
