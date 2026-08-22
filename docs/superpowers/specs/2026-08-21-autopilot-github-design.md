# autopilot-github: GitHub Issues + Projects v2 wrapper around autopilot

**Date:** 2026-08-21
**Status:** Approved design, ready for planning

## Problem

`/autopilot` takes a free-text task description from idea to pull request, but
it is blind to where that task came from and where the team tracks it. When the
work originates as a GitHub issue on a Projects v2 board, a human still has to:

- copy the issue title and body into the `/autopilot` invocation by hand,
- pick a run name that has nothing to do with the issue number, so the ledger
  directory, the branch, and the board card share no identifier,
- drag the card Ready → In Progress when the run starts, and In Progress → In
  Review when the PR opens,
- and comment on the issue so the next person can find the run and the PR.

Every one of those is mechanical, and every one of them is the step that gets
skipped — leaving a board that says "Ready" for work that already has an open
pull request.

## Scope

One new skill, one new tested script, one config block, and a small extension
to the existing config loader. **No change to the `autopilot` skill's pipeline.**
The wrapper adds exactly four deltas at four anchors; everything else in
`plugins/autopilot/skills/autopilot/SKILL.md` is used as-is.

Explicitly out of scope: creating issues, closing issues, reading issue
comments back into the run, reacting to board moves made by humans, and any
board field other than the single-select Status field.

## Architecture

`plugins/autopilot/skills/autopilot-github/SKILL.md` is a **thin wrapper, not a
copy**. It does not restate the pipeline. It resolves the issue, then invokes
`autopilot:autopilot` and follows that skill for the actual run — brainstorm →
setup → spec → plan → sdd → land → pr, the ledger format, stage idempotency,
the SDD dispatch contracts, and all five parking conditions, unchanged — while
layering four deltas anchored to specific points in autopilot's process.

Two structural rules make that work:

1. **The wrapper invokes `autopilot:autopilot` in the same session** (the Skill
   tool), and follows it directly. It must **not** dispatch autopilot into a
   subagent. The deltas interleave with autopilot's own stages and read and
   write the same ledger; behind a subagent boundary the hooks would be
   unreachable, and parking would report to the wrapper instead of to the
   human.
2. **The deltas never touch autopilot's pattern-matched seams.** `nextStage`
   resumes a run by prefix-matching ledger text (`pr:`, `rebase clean`,
   `sdd complete`, `plan complete`, `spec committed`, `worktree:`,
   `design approved`) and detects a park by `PARKED` at the start of the
   ledger's **last** entry. Every line this wrapper appends is prefixed
   `github: `, which collides with none of them — with one ordering constraint
   pinned under "The PARKED ordering constraint" below.

### Invocation and registration

```
/autopilot-github <issue-number-or-URL>
/autopilot-github resume <run>
```

No command file is needed. `plugins/autopilot/commands/` contains only
`autopilot-findings.md`; the `autopilot` skill itself has no `commands/`
entry and triggers purely off its `description` frontmatter matching
`/autopilot` in the developer's message. `autopilot-github` follows the same
pattern, with frontmatter shaped like:

```yaml
---
name: autopilot-github
description: Use when the developer runs /autopilot-github with a GitHub issue number or URL, or /autopilot-github resume with a run name - resolves the issue, then drives autopilot end to end while moving the issue's Projects v2 card and commenting on the issue at each transition
---
```

`plugins/autopilot/.claude-plugin/plugin.json` already declares `"skills":
["./skills/"]`, so the directory is picked up with no manifest change.

**Announce at start**, matching autopilot's own convention: "I'm using the
autopilot-github skill to take issue #\<n\> from brainstorm to PR."

## Delta 1 — input resolution, before Phase 1

Accept either a bare issue number or a full issue URL; `gh` accepts both, so the
argument is passed through unchanged.

The wrapper runs, from the repository root:

```bash
node "$AP/scripts/autopilot-github-issue.mjs" resolve --issue <n>
```

which wraps exactly the call the design names — `gh issue view <n> --json
number,title,body,url` — and prints a single JSON object:

```json
{
  "number": 42,
  "title": "CSV export drops unicode",
  "url": "https://github.com/owner/repo/issues/42",
  "run": "issue-42-csv-export-drops-unicode",
  "task": "GitHub issue #42: CSV export drops unicode\n\n<body>"
}
```

`task` is the task description handed to `autopilot:autopilot-brainstorm`,
built as `"GitHub issue #<n>: <title>\n\n<body>"`. That is the same shape
autopilot already expects as a task description, so **Phase 1 itself needs no
changes** — the brainstorm asks its clarifying questions against the issue text
exactly as it would against text a human typed.

`$AP` is the plugin root, resolved the way autopilot's "Locating the plugin's
scripts" section already prescribes (derived from the skill's base-directory
line; `$CLAUDE_PLUGIN_ROOT` is not set in Bash tool calls).

### Ledger header

`autopilot-ledger.mjs`'s `HEADER` regex is single-line
(`^#\s*autopilot run\s*—\s*task:\s*(.+)$`). The ledger header therefore uses the
**single-line** form:

```
# autopilot run — task: GitHub issue #42: CSV export drops unicode
```

The full multi-line `task` string (title plus body) is what goes to the
brainstorm, not into the header. Writing the multi-line form into `run.md`
would strand the body as untimestamped lines that `parseLedger` silently drops.

## Delta 2 — run naming

`<run>` is `issue-<n>-<slug>`, e.g. `issue-42-csv-export-drops-unicode`. The
git branch is `worktree-issue-42-csv-export-drops-unicode`, the `worktree-`
prefix coming from `superpowers:using-git-worktrees` as it already does;
`<run>` itself never carries the prefix, per autopilot's "The run directory"
rule that `<run>` is one string that does not change to follow the worktree
directory or the git branch.

The value is **computed once, at input resolution** (delta 1 prints it as
`run`), and **declared at `setup`** as the worktree/branch name passed to
`superpowers:using-git-worktrees`, in place of a name falling out of the
brainstorm. Everything downstream — ledger directory, generated agent-definition
paths under `.superpowers/autopilot/<run>/agents/`, the PR branch — threads it
exactly as autopilot already does. Only how the value is *chosen* changes, not
how it is used.

Computing it at resolution rather than at `setup` is a resolved ambiguity; see
"Resolved ambiguities" below.

### Slug derivation (pinned, and implemented in the script)

The slug is derived by an exported pure function, not by prose, because a
resumed run that re-derives a different slug points at a different ledger
directory and loses the run:

1. Lowercase the title.
2. Replace every run of characters outside `[a-z0-9]` with a single `-`.
3. Strip leading and trailing `-`.
4. Truncate to 40 characters, then strip a trailing `-` again.
5. If the result is empty (a title that is entirely punctuation or non-ASCII),
   the run name is just `issue-<n>`.

## Delta 3 — issue transitions

### The script

New `plugins/autopilot/scripts/autopilot-github-issue.mjs`, in the same style as
`autopilot-land.mjs` / `autopilot-reaper.mjs` / `autopilot-sync-base.mjs`: pure,
injectable functions plus a thin `main()` CLI, so every branch is testable
without a live GitHub project. `gh` is reached through an injected runner with
the same `{ code, stdout, stderr }` shape `autopilot-land.mjs`'s `run()` uses.
The `main()` guard uses `pathToFileURL(process.argv[1])`, matching the other
scripts.

Four subcommands:

| Command | Behavior |
|---|---|
| `preflight` | Load config, validate the `github` block, print `ok` or the missing keys. Exit non-zero if invalid. |
| `resolve --issue <n>` | Print the JSON object in delta 1. |
| `move --issue <n> --to "<option>"` | Set the issue's Projects v2 Status field to the named option. |
| `comment --issue <n> --body "<text>"` or `--body-file <path>` | Post an issue comment. |

`--body-file` exists alongside `--body` because park reasons and PR
announcements are multi-line, and the `pr` stage already establishes the
convention of writing such a body into the run directory (`pr-body.md`) rather
than shell-quoting it.

The wrapper's SKILL.md calls these with simple CLI args. It does not embed raw
`gh` project invocations in prose.

### Project item resolution

1. `gh issue view <n> --json projectItems`, matched against the configured
   `project_owner` + `project_number`. One issue-scoped call, so this is the
   first attempt.
2. If that returns nothing usable, fall back to
   `gh project item-list <project_number> --owner <project_owner> --format json`
   and match the item whose content number is `<n>`.
3. Field and option ids come from
   `gh project field-list <project_number> --owner <project_owner> --format
   json`: find the single-select field named `status_field`, then the option
   named by the target status.
4. The move itself is `gh project item-edit --id <item-id> --project-id
   <project-id> --field-id <field-id> --single-select-option-id <option-id>`.

Failure modes are named, never silent: an issue that is on no matching board
errors with the issue number and the configured owner/number; a status option
that does not exist errors listing the option names the field actually has.

### Hook points

| Anchor in autopilot's pipeline | Action |
|---|---|
| Immediately after `started (phase 1)` is appended | Move Ready → In Progress; comment that the run started, naming `<run>` and the ledger path. |
| Immediately after `pr: <url>` is appended (the `pr` stage) | Move In Progress → In Review; comment with the PR link. |
| Immediately **before** a `PARKED — <reason>` entry is appended | Leave Status as-is (In Progress); comment the park reason, pointing at the ledger path. |

The start hook can reference `<run>` because delta 2 pins the run name at
resolution time, before Phase 1 begins.

The park hook adds **no new parking condition**. A run still parks for exactly
autopilot's five existing reasons; the only new behavior on park is the comment.

### Ledger entries and idempotency

Every hook appends its own `github: `-prefixed line via `autopilot-ledger.mjs`
— the same `append()` call, from the repository root, that every other stage
uses, so the entry carries an ISO timestamp and is visible to `parseLedger`:

```
github: moved to in-progress
github: start comment posted
github: moved to in-review
github: pr comment posted
github: parked comment posted
```

Before acting, each hook re-reads the ledger (autopilot already requires
re-reading before dispatch) and **skips if its own line is already present**,
using the same `entries.some(e => e.text.startsWith(prefix))` semantics
`nextStage` uses. Resuming a run therefore never double-moves a card and never
double-posts a comment.

Move and comment get **separate** ledger lines rather than one line per hook, so
a hook that moved the card but failed to comment resumes into the comment alone
instead of redoing the move or skipping the comment.

### The PARKED ordering constraint

`nextStage` returns `parked` only when the **last** ledger entry starts with
`PARKED`. A `github: parked comment posted` line appended *after* the
`PARKED — <reason>` line would therefore make a parked run look resumable, and
`/autopilot resume` would drive it straight past the park — precisely the
failure autopilot's parking section warns about.

The park hook therefore runs **before** the `PARKED` append, in this order:

1. Post the park comment.
2. Append `github: parked comment posted`.
3. Append `PARKED — <reason>` (last).
4. Report the duration, as autopilot's parking section already prescribes.

This is load-bearing and gets a coupling test (see Testing).

### Transition failures do not park

If a `move` or `comment` fails, the wrapper appends
`github: <action> failed — <reason>` and **continues**. It does not park and it
does not retry. This follows the precedent already set in autopilot's `pr`
stage: "If the `gh pr edit` fails, do not park — the PR exists and the branch is
green." The run's product is the pull request; a stale board card is a reporting
defect, not a reason to abandon a green branch. The ledger line is what makes it
visible afterwards.

The one hard stop is delta 4's preflight check, which runs before anything else
happens.

## Delta 4 — config

A new `github` block in the project's `.claude/autopilot.json`, beside the
existing `test_command`:

```json
"github": {
  "project_owner": "<org-or-user>",
  "project_number": 7,
  "status_field": "Status",
  "status_ready": "Ready",
  "status_in_progress": "In Progress",
  "status_in_review": "In Review"
}
```

**Defaults.** `plugins/autopilot/autopilot.default.json` gains a `github` block
carrying only the four non-project-specific keys — `status_field`,
`status_ready`, `status_in_progress`, `status_in_review` — with the values shown
above. `project_owner` and `project_number` get **no default**, for the same
reason `test_command` has none: they are irreducibly project-specific, and a
guessed value fails confusingly.

**Merging.** `mergeConfig` is shallow per top-level key, deep only for `roles`.
Left alone, a project supplying just `project_owner` and `project_number` would
replace the defaults' `github` block wholesale and lose all four status names.
So `mergeConfig` gains `github` as a second per-key merge, written exactly like
the existing `roles` branch. A project then needs only the two keys it cannot
inherit.

**Validation.** `github` must **not** join `TOP_LEVEL` in `validateConfig` —
that list is a hard error on absence, and adding it there would break every
plain `/autopilot` run in a project with no board. Instead
`autopilot-config.mjs` exports a new `validateGithubConfig(config)` returning
the names of the missing keys. It is called only by `autopilot-github`'s
preflight and by the script's own subcommands, so both fail on the same check.

**Preflight.** The `github` block is a **hard requirement** at the same tier as
autopilot's "skills resolve" check. The wrapper runs
`autopilot-github-issue.mjs preflight` after autopilot's own preflight; if any
key is missing it reports **exactly which** and stops before starting the
brainstorm. Config validation lives with the config loader so that a project
that has never used the wrapper is unaffected.

## Resume

`/autopilot-github resume <run>` recovers the issue number from the run name's
`issue-<n>-` prefix, so the hooks still know which issue to act on, then
delegates to autopilot's own resume path: read
`.superpowers/autopilot/<run>/run.md`, call `nextStage`, jump to that stage. Each
hook's idempotency check then decides whether it has work to do.

If `nextStage` returns `parked`, the run stops as autopilot prescribes — the
park comment was already posted and its `github:` line already recorded, so the
wrapper posts nothing new.

## What is unchanged

Ledger append conventions (always via `autopilot-ledger.mjs`, always
timestamped); stage idempotency; the `setup` stage's sync-base and reaper calls;
the `spec` stage; the `plan` stage's task-count budget; the `sdd` dispatch's
model/effort mapping, verification contract, and findings-capture contract; the
`land` stage's rebase-then-test gate; the `pr` stage's timing append; and all
five parking conditions.

## Resolved ambiguities

The design left three points open. Each is pinned here rather than left to the
implementer.

1. **Where the run name is computed.** The design allowed the start comment at
   either `started (phase 1)` or `setup`, "whichever ordering keeps the comment
   able to reference the actual run name." Pinned: the name is *computed* at
   input resolution — it is fully derivable from the issue number and title,
   which are known before Phase 1 — and merely *declared* at `setup`. That
   keeps the start comment at its natural anchor, and it matches autopilot's own
   "create the ledger once the branch name is known" instruction, since the
   ledger directory needs the name from the very first append.
2. **Slug derivation lives in the script, not in prose.** The design named the
   rules (lowercase, hyphenated, truncated) without saying where they execute.
   Pinned in code because the slug is the ledger directory's key: prose rules
   re-applied by a different session on resume can produce a different string
   and orphan the run.
3. **Issue fetching goes through the script too.** The design named a raw
   `gh issue view` for delta 1 while asking that transitions avoid raw `gh` in
   prose. Pinned: `resolve` wraps that exact `gh issue view` call, so the run
   name and task description are produced by the same tested code path rather
   than assembled by hand.

## Testing

Colocated vitest files, matching the repo's existing pattern.

**`autopilot-github-issue.test.mjs`** — against an injected fake `gh` runner, no
network and no live board:

- slug and run name: ordinary title, punctuation-heavy title, over-length title
  truncation, a title that normalizes to empty (`issue-<n>`), and stability
  (same inputs, same string).
- task description assembly, including an issue with an empty body.
- ledger header stays single-line for a multi-line body.
- project item resolution: match via `projectItems`; fallback to `item-list`
  when `projectItems` yields nothing; no matching board → error naming the
  issue and the configured owner/number.
- field/option resolution: named option found; unknown option name → error
  listing the options the field actually has.
- `move` builds the expected `gh project item-edit` argument list.
- `comment` accepts both `--body` and `--body-file`.
- a non-zero `gh` exit surfaces as a non-zero exit with the message — never a
  silent success.
- `preflight` prints `ok` for a complete config and names exactly the missing
  keys otherwise.

**`autopilot-config.test.mjs`** (extended):

- `mergeConfig` merges `github` per key, so a project supplying only
  `project_owner` and `project_number` keeps the four default status names.
- a config with **no** `github` block still loads cleanly — plain `/autopilot`
  is unaffected.
- `validateGithubConfig` returns the missing key names, and an empty list when
  complete.

**`autopilot-github-contract.test.mjs`** — a prose guard test in the style of
`autopilot-sdd-contract.test.mjs`, since a wrapper made of prose breaks nothing
else when it drifts:

- the wrapper's SKILL.md still delegates to `autopilot:autopilot` and still
  says not to dispatch it as a subagent.
- each of the five `github: ` ledger strings appears in SKILL.md.
- the park hook is documented as running *before* the `PARKED` append.

**Ledger coupling**, in the style of `autopilot-ledger-coupling.test.mjs`:

- a ledger with `github: ` lines interleaved at every hook point resolves to the
  same `nextStage` value as the same ledger without them.
- a ledger whose last two entries are `github: parked comment posted` then
  `PARKED — <reason>` returns `parked`; the reversed order does **not**, which
  is what makes the ordering constraint a test rather than a comment.

## Version

Bump to **1.6.0** — a new skill is additive — in both
`plugins/autopilot/.claude-plugin/plugin.json` and `.claude-plugin/marketplace.json`
(the plugin entry and the marketplace metadata block).

## Documentation

The repo README's `### autopilot` section lists the plugin's commands and
skills. Add `/autopilot-github <issue>` / `/autopilot-github resume <run>` and
the `autopilot-github` skill there, with a one-line note that the `github`
config block is required for it and irrelevant to plain `/autopilot`.

## Repo conventions

- Node helpers live in `plugins/autopilot/scripts/` with colocated `.test.mjs`
  files (vitest).
- Test command: `npm test`.
- Prose contracts in SKILL.md files are pinned by guard tests.
- Scripts are pure functions plus a thin `main()`, with dependencies injected so
  tests need no live git repo, network, or `gh` session.

## Deferred

- **Reading the board back.** Nothing reacts to a human moving a card, and
  nothing reads issue comments into the run. One direction only, for now.
- **Non-Status fields.** No assignee, iteration, size, or priority writes.
- **Issue lifecycle.** The wrapper never opens or closes an issue; the PR's own
  closing keyword, if any, is the human's choice at PR time.
- **Retry on transition failure.** A failed move or comment is recorded and
  moved past. If board flakiness turns out to be common, a retry belongs in the
  script, not in the prose.
