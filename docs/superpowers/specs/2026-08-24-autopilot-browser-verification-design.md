# Autopilot browser verification — design

## Problem

Autopilot's `land` stage runs the project's test suite and treats green as
proof the branch works. For a frontend change that is not the same claim: the
suite proves the code does what the code says, while an acceptance criterion is
something a person confirms by opening the app. Nothing in the pipeline ever
opens it.

The gap has a specific shape. A GitHub issue states what "done" looks like in
user terms; the run implements it, tests it against its own unit assertions,
and opens a PR whose description asserts success. Whether the button actually
appears is checked for the first time by a human reviewer.

## Approach

One new stage, `verify`, between `land` and `pr`, plus deltas on `spec` and
`pr`. Everything else in the pipeline is unchanged.

```
phase1 → setup → spec → plan → sdd → learnings → land → verify → pr
                  ▲                                  ▲       │
          acceptance criteria                 tests green    └─ result → PR body
```

It runs **after** `land` because a semantic conflict rebases clean and still
breaks the UI — the same reason the post-rebase test run is not optional. It
runs **before** `pr` so a broken feature never reaches a reviewer under a green
description.

## Acceptance criteria are the gate

The `spec` stage gains a required `## Acceptance criteria` section:

```markdown
- AC1 (ui) — a signed-out visitor clicking "Save" sees the login prompt
- AC2 (non-ui) — POST /items rejects an empty title with 422
```

The `(ui)` / `(non-ui)` tag answers three questions with one classification:
what to check, whether to open a browser at all, and what the PR reports
against. A run with zero `ui` criteria skips the stage, so a backend-only
change in a frontend repo costs nothing — no path globs, no auto-detection
heuristic, and no `enabled` flag to forget.

An untagged criterion is an error rather than a default. Defaulting it to
`non-ui` would drop a criterion from verification while the run still reported
success, which is the failure mode this whole stage exists to remove.

Criteria enter from the issue body under `/autopilot-github` and from the
brainstorm under plain `/autopilot`. Both land in the spec, which is already
committed and already the `plan` stage's input, so no new plumbing carries them.

## Nothing generated here enters the repository

E2E specs and mock fixtures are worth exactly one run. They go to
`.superpowers/autopilot/<run>/verify/` in the **main checkout** — gitignored,
outside the worktree, and untouched by the reaper that deletes worktrees after
merge. The repository never carries a per-PR test.

This forced one non-obvious mechanism. Node resolves `@playwright/test` by
walking up from the importing file, which from the run directory never reaches
the project's `node_modules`. The script symlinks the project's tree into the
run directory so the walk finds it one level up. Without this every spec fails
to import, Playwright reports "No tests found", and the run reads as a feature
whose criteria were merely never covered — a false negative that looks exactly
like a true one. It was found by running the stage end to end, not by reading
the code.

## Playwright CLI, not a browser tool

Three modes were available: a Playwright MCP browser tool, the Playwright CLI,
and a hosted agent browser.

The MCP tool returns a full accessibility snapshot into the agent's context on
every interaction, so a six-step flow can consume the stage's entire budget.
The CLI costs roughly the spec file the agent authors. Since the stage runs as
a dispatch, an expensive driver does not compact the controller — it compacts
the verification agent mid-stage, which fails quietly by running out of room
three criteria into six and guessing the rest.

The usual objection to CLI-only is authoring selectors blind. That does not
apply here: the `sdd` stage wrote the UI in this same run, so locators come
from the worktree source, which is both cheaper and more accurate than the
rendered tree.

A hosted agent browser is equally cheap from the controller's seat, since its
observation loop runs elsewhere. It lost on three other axes. Its verdict is a
model judgment — "the form submitted successfully" — which is the false green
the `test_command` rule already exists to prevent. Re-running it after a fix
re-runs a *prompt*, so a pass cannot be distinguished from a more lenient
reading of the same broken page. And it cannot intercept network requests,
which is how throwaway mock data is supposed to work.

The driver is therefore not configurable in this version. A single-value enum
is dead surface: it needs validation, a park branch, and a test for a path
nothing exercises. Adding the second driver later is purely additive — an
absent key means Playwright.

## Failure taxonomy

The script's exit code distinguishes failures that earn a fix round from ones
that do not, because "non-zero" collapses two very different situations:

| Exit | Meaning | Action |
|---|---|---|
| 0 | Every criterion passed | Continue |
| 1 | A criterion failed | One fix round, then park |
| 2 | Infrastructure | Park — the branch was never exercised |
| 3 | Browser unconfigured | Skip |
| 4 | Browser half-configured | Park |

One fix round mirrors `land`'s conflict resolver: one dispatched attempt, then
a human decides. A stage that retries until green tunes the test to the bug.

Two classifications are deliberate and were both wrong in the first draft:

- **A criterion with no test is a failure, not a pass.** It is this stage
  failing to do its job, and reporting it as success is the exact gap the
  stage was built to close.
- **Zero collected tests is infrastructure, not a criteria failure.** A spec
  that failed to import looks identical to a feature nobody tested. Sending an
  implementer to fix code that was never exercised wastes a round and produces
  a confident, meaningless diff.

## Configuration

Split by what is universal and what is local. Process — extracting criteria,
authoring checks, the token contract, the failure taxonomy — lives in the
skill, because it is identical in every project and this plugin is consumed by
several. The project supplies only what is genuinely its own:

```json
"browser": {
  "dev_command": "npm run dev",
  "base_url": "http://localhost:3000",
  "ready_timeout_ms": 60000,
  "seed": "npm run db:seed:test"
}
```

`dev_command` and `base_url` have no defaults, for the same reason
`test_command` has none: a guessed dev command that serves the wrong thing
renders as a verified feature. Supplying neither is the normal backend-repo
case and skips silently. Supplying one is someone half-finishing the setup, and
parks.

`@playwright/test` is the project's responsibility. Autopilot never installs
it — an unattended run that provisions its own tooling downloads hundreds of
megabytes nobody approved and produces a green nobody can reproduce.

## Known limitation

Screenshots and traces do not reach the PR. `gh pr edit` takes markdown, and an
image renders only from a URL, which would mean committing the files — the one
thing this design refuses. The PR section names the artifact path instead, so a
reviewer who wants the pixels knows where they are. Closing this properly needs
a project-supplied upload hook, deliberately left out of this version.
