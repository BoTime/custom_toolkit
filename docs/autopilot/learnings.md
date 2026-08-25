# Autopilot learnings

Distilled from the findings corpus across autopilot runs. Future runs' plan stages read this before planning.

## Planning rules

- **Treat verbatim code in a brief as shipped code.** Implementers transcribe plan-given blocks exactly, so every defect in them lands on the branch and reviewers correctly file it against `plan`. Most of the corpus is this: unchecked subprocess exit codes, lenient regexes, unguarded `argv` access, silently-swallowed parse failures. Review your own snippets at the bar you'd apply to a diff.
- **Make shell snippets propagate failure.** `echo out=$(script) >> "$GITHUB_OUTPUT"` returns `echo`'s status, so a broken script leaves CI green forever. Split into an assignment then an echo. Likewise, check `.code` on every `spawnSync` whose stdout you then use.
- **Never interpolate untrusted text into a shell string.** An issue title, branch name, or user input in a double-quoted `printf` is a command-injection path. Mandate `spawnSync` array args (no shell) or a direct file write instead.
- **Get ordering and per-invocation values right in plan code.** State the dependency when one step must precede another (start the server before seeding it), and parameterize anything that must differ per call — a hardcoded `round: 1` duplicates records on the second pass.
- **Keep prose and code in the same plan consistent.** Don't document a case the plan's own code can't produce, don't leave stale prose asserting the old semantics, and when the change's payoff depends on another section or doc knowing about it, make that update an explicit step — no task will do it spontaneously.
- **Name cross-task seams explicitly.** When one task's output feeds another, state the exact value crossing the boundary and pin it with a test. A producer that prints only `ok` while a consumer needs resolved values is invisible to per-task review and only surfaces at whole-branch review.
- **Verify literals, indices, and verification commands against the artifact as written.** Wrong fixture indices, mis-quoted substrings, and unscoped one-liner checks produce briefs whose own tests contradict them.
- **Don't let a test pass on a degenerate no-op.** Fast-forwarding a branch onto itself, or asserting the no-op is correct, hides the gap the change was meant to close.
- **Write normative prose so it can't be misread.** These are instructions another agent executes literally: use "and"/"both" instead of a comma when two conditions are required, use one term per concept (not `separate` and `unrelated` subsystems), keep numeral style consistent, and avoid referent phrases that only resolve if you already know the intent.
- **Guard load-bearing prose with a contract test — unless the developer opts out.** SKILL.md text a dispatched agent must follow, and error/exit semantics that must not fail silently, should be pinned. This rule has been deliberately waived twice (once by the plan citing existing unguarded precedent, once by developer choice for a prose-only change); when it is waived, say so in the plan rather than leaving the omission unexplained.
- **Scale task count to complexity, 1–5.** The old "target 3–5" is retired. Don't pad a small change into extra tasks, and don't compress unrelated work into one.

## Recent runs

- plan-task-count-scale-to-complexity — spec 4 (all minor, all PARKED: ambiguous prose wording in the new rule text), 1 task, 0 fix rounds. Changed the plan budget from "3–5" to "1–5, scaled to complexity".
- ponytail-minimalism-contract — no findings recorded.
- autopilot-verify-before-learnings — plan 5 (all major: seed-before-server ordering, hardcoded round, prose documenting unreachable behavior, omitted `skip` CLI step, omitted cross-section doc update), impl 1, 4 tasks clean.
- auto-version-bump — plan 7 (1 important: CI step swallowed the script's exit code), 4 tasks clean. Rest were verbatim-reference-code leniencies and a missing contract-test assertion.
- issue-13-autopilot-feed-run-learnings-back-into-p — plan 3 (all minor: test index mismatch, unguarded load-bearing prose, stale contradicting prose), 2 tasks clean.
- autopilot-github-skill — plan 6 (2 major: untrusted issue title in a shell `printf`, cross-task seam data never surfaced at the CLI boundary), impl 1, 3 tasks clean.
