---
name: autopilot-github
description: Use when the developer runs /autopilot-github with a GitHub issue number or URL, or /autopilot-github resume with a run name - resolves the issue, then drives autopilot end to end while moving the issue's Projects v2 card and commenting on the issue at each transition
---

# Autopilot for GitHub issues

Take a GitHub issue from brainstorm to pull request, keeping its Projects v2
card and its comment thread in step with the run.

```
/autopilot-github <issue-number-or-URL>
/autopilot-github resume <run>
```

**Announce at start:** "I'm using the autopilot-github skill to take issue #\<n\>
from brainstorm to PR."

## This is a wrapper, not a copy

The run itself is `autopilot:autopilot`, unchanged. Brainstorm → setup → spec →
plan → sdd → verify → learnings → land → pr, the ledger format, stage
idempotency, the SDD dispatch contracts, and all nine parking conditions all
come from that skill. Read it and follow it. Everything in this file is a delta
layered on top.

The `learnings` stage runs within this wrapped pipeline unchanged — both plain
`/autopilot` and `/autopilot-github` summarize automatically: the run's review
findings become `docs/autopilot/learnings.md` with no wrapper hook involved.

Two structural rules make that work.

1. **Invoke `autopilot:autopilot` in this session with the active host's skill
   mechanism, and follow it directly. Do not dispatch autopilot into a
   subagent.** The deltas below interleave with autopilot's own stages and read
   and write the same ledger. Behind a subagent boundary the hooks would be
   unreachable, and a park would be reported to you instead of to your human
   partner. This delegates through the host-aware autopilot flow, including its
   Codex JSON-record and `spawn_agent` protocol.
2. **Never touch autopilot's pattern-matched seams.** `nextStage` resumes a run
   by prefix-matching ledger text — `pr:`, `rebase clean`, `learnings committed`,
   `verify`, `sdd complete`, `plan complete`, `spec committed`, `spec written`,
   `worktree:`, `design approved` — and
   detects a park by `PARKED` at the start of the ledger's **last** entry. Every
   line this wrapper appends is prefixed `github: `, which collides with none of
   them, subject to the ordering rule in Delta 3c.

## Locating the plugin's scripts

Identical to autopilot's own "Locating the plugin's scripts" section, with one
difference: this skill's base directory is `<plugin root>/skills/autopilot-github`,
so the plugin root is that path with `/skills/autopilot-github` removed.

Do not rely on a plugin-root environment variable in Bash tool calls. Resolve the path once
and substitute the literal value into every `"$AP"/...` command below — you
write each command fresh, and shell variables do not persist between Bash calls.

```bash
AP="<the base directory, minus /skills/autopilot-github>"
ls "$AP"/scripts/autopilot-github-issue.mjs   # must exist; if not, stop
```

Run every command below from the **repository root**, so the relative selected
config path and `.superpowers/autopilot/...` paths resolve. Autopilot preflight
selects `<host>` and `<config>`: Claude uses `.claude/autopilot.json`; Codex
uses `.codex/autopilot.json`. Keep that same pair throughout this wrapper.

## Delta 0 — preflight

Run autopilot's own preflight first, exactly as it prescribes, and retain its
selected `<host>` / `<config>` pair. Then, before asking your human partner
anything:

```bash
node "$AP"/scripts/autopilot-github-issue.mjs preflight --config=<config>
```

This is a **hard requirement**, at the same tier as autopilot's "skills resolve"
check. A non-zero exit prints exactly which `github` keys are missing. Report
those key names and **stop** — do not start the brainstorm. The fix is a
`github` block in the project's selected `<config>` file (for Codex,
`.codex/autopilot.json`):

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

On success, `preflight` prints the three resolved status names alongside `ok`:

```
ok — status names: ready="Ready", in_progress="In Progress", in_review="In Review"
```

**Those printed strings — not the defaults shown in the JSON example above — are
what you substitute for `<status_ready>` / `<status_in_progress>` /
`<status_in_review>` in Delta 3.** They are the merged values: the plugin's
defaults, overridden per key by anything the project sets. Read them off this
line rather than assuming the defaults, or a project that renames one status
gets a `move` that fails on an option name its board does not have.

The four status keys have defaults in the selected host's shipped defaults and
merge per key, so a project usually needs only `project_owner` and
`project_number`. Those two have no default: they are irreducibly
project-specific, and a guessed value fails confusingly.

This is the wrapper's one hard stop. Every later transition failure is recorded
and stepped past — see "Transition failures do not park".

## Delta 1 — resolve the issue, before Phase 1

`gh` accepts a bare number or a full issue URL, so pass the argument through
unchanged:

```bash
node "$AP"/scripts/autopilot-github-issue.mjs resolve --issue <n> --write-ledger .superpowers/autopilot
```

This one call does two things: it prints the JSON object below, **and** it
creates `.superpowers/autopilot/<run>/run.md` with its header line already
appended — before `started (phase 1)` is appended to it.

It prints one JSON object:

```json
{
  "number": 42,
  "title": "CSV export drops unicode",
  "url": "https://github.com/owner/repo/issues/42",
  "run": "issue-42-csv-export-drops-unicode",
  "task": "GitHub issue #42: CSV export drops unicode\n\n<body>"
}
```

- `task` is the task description you hand to `autopilot:autopilot-brainstorm`.
  It is the same shape autopilot already expects, so **Phase 1 itself needs no
  changes** — the brainstorm asks its clarifying questions against the issue
  text exactly as it would against text a human typed.
- `run` is `<run>` for the whole run. See Delta 2.
- Keep `number` and `url` — the hooks below need them.

### Ledger header

`--write-ledger` above is what creates the run directory and the ledger, so by
the time you append `started (phase 1)` the file already exists and already
holds its header — the **single-line** form, the first line of `task` and never
the whole string:

```
# autopilot run — task: GitHub issue #42: CSV export drops unicode
```

`autopilot-ledger.mjs`'s header regex is single-line. Writing the multi-line
`task` into `run.md` would strand the body as untimestamped lines that
`parseLedger` silently drops.

**Never build this header line yourself from the JSON's `title` field.** Not
with `printf`, not with `echo`, not with any shell command — and do not write it
by hand from the printed JSON either. An issue title is untrusted, third-party
text: it can contain quote characters that break the command's quoting, or shell
metacharacters like `$(...)` and backticks that execute in your human partner's
checkout. The script writes the file itself, in code, for exactly this reason —
the title never becomes part of a shell string. `--write-ledger` is the only
supported way this header reaches `run.md`.

### Delta 1a — the issue is the source of acceptance criteria

autopilot's `spec` stage requires an `## Acceptance criteria` section, and the
`verify` stage reads it to decide what to check in a browser. For a GitHub run,
that list has an authoritative source the plain pipeline lacks: the issue.

The issue body already reaches the brainstorm inside `task`, so nothing extra
needs fetching. What this delta adds is one instruction, carried into the
`spec` dispatch in place of autopilot's default `--criteria-source` sentence:

> The acceptance criteria for this spec come from GitHub issue #\<n\>. Where
> the issue states criteria — a checklist, an "acceptance criteria" heading, a
> "should" list — carry every one of them into the spec's
> `## Acceptance criteria` section, preserving their meaning. Where the
> brainstorm settled a criterion the issue left implicit, add it. Do not drop
> a stated criterion because it looks hard to verify: tag it `(non-ui)` if it
> is not browser-observable, but keep it.

Write it to a file in the run directory with a quoted heredoc, and pass the
file to the `spec` dispatch as `--criteria-source=@<path>` in place of
autopilot's default sentence:

```bash
cat > .superpowers/autopilot/<run>/criteria-source.md <<'EOF'
The acceptance criteria for this spec come from GitHub issue #<n>. Where the
issue states criteria — a checklist, an "acceptance criteria" heading, a
"should" list — carry every one of them into the spec's
`## Acceptance criteria` section, preserving their meaning. Where the
brainstorm settled a criterion the issue left implicit, add it. Do not drop a
stated criterion because it looks hard to verify: tag it `(non-ui)` if it is
not browser-observable, but keep it.
EOF
```

Only the issue **number** is interpolated, and only into a `<<'EOF'` heredoc,
which performs no expansion. Issue title and body text still reach the agent
only through a file the dispatch script reads — never through a shell string.

The reason to pin this: an issue's criteria are what the reporter will check
the PR against. A spec that quietly narrows them produces a run that verifies
its own reduced scope and reports success, and the gap only surfaces in review.

Criteria text is untrusted third-party input, exactly like the issue title in
the section above. It reaches the spec through a dispatched agent writing a
file, never through a shell string — do not `printf` or `echo` issue text into
any command.

## Delta 2 — run naming

`<run>` is the `run` field from Delta 1: `issue-<n>-<slug>`, e.g.
`issue-42-csv-export-drops-unicode`. The git branch becomes
`worktree-issue-42-csv-export-drops-unicode`, the `worktree-` prefix coming from
`superpowers:using-git-worktrees` as it already does; `<run>` itself never
carries the prefix, per autopilot's "The run directory" rule.

The value is **computed once, at resolution** — before Phase 1 begins, which is
what lets the start hook name it — and **declared at `setup`** as the
worktree/branch name passed to `superpowers:using-git-worktrees`, in place of a
name falling out of the brainstorm. Everything downstream threads it exactly as
autopilot already does: the ledger directory, the generated host-native stage
artifacts under `.superpowers/autopilot/<run>/agents/`, the PR branch.

**Never re-derive the slug by hand.** It is the ledger directory's key: a
different string points at a different directory and loses the run. Take it from
`resolve`, or from the run name on a resume.

## Delta 3 — issue transitions

### The commands

```bash
node "$AP"/scripts/autopilot-github-issue.mjs move --config=<config> --issue <n> --to "<option>"
node "$AP"/scripts/autopilot-github-issue.mjs comment --issue <n> --body "<text>"
node "$AP"/scripts/autopilot-github-issue.mjs comment --issue <n> --body-file <path>
node "$AP"/scripts/autopilot-github-issue.mjs screenshots --issue <n> --manifest <path>
```

Use these. Do not write raw `gh project` invocations yourself — the script owns
project-item, field, and option resolution, and reports each failure with the
issue number, the configured owner and board number, and the names the board
actually has.

`--body-file` is for multi-line bodies (park reasons, PR announcements). Write
the body into the run directory first, the way the `pr` stage already writes
`pr-body.md`, rather than shell-quoting it.

`<option>` is a status name from config: `status_ready`, `status_in_progress`,
or `status_in_review`. Take the exact strings from the status-names line Delta
0's `preflight` printed — those are the merged values, and they are the only
source that is right when the project overrides one.

### Ledger entries and idempotency

Every hook appends its own `github: `-prefixed line through
`autopilot-ledger.mjs` — the same `append()` call every other stage uses, so the
entry carries an ISO timestamp and is visible to `parseLedger`:

```bash
node -e "const{pathToFileURL}=require('node:url');import(pathToFileURL(process.argv[1]+'/scripts/autopilot-ledger.mjs').href).then(m=>m.append('.superpowers/autopilot/<run>/run.md','<entry text>'))" "$AP"
```

The six lines, in pipeline order:

```
github: moved to in-progress
github: start comment posted
github: verify screenshots posted
github: moved to in-review
github: pr comment posted
github: parked comment posted
```

Before acting, **re-read the ledger and skip the step if its own line is already
present** — the same `entries.some(e => e.text.startsWith(prefix))` semantics
`nextStage` uses. Resuming a run therefore never double-moves a card and never
double-posts a comment.

Move and comment get **separate** lines rather than one line per hook, so a hook
that moved the card but failed to comment resumes into the comment alone instead
of redoing the move or skipping the comment.

### Delta 3a — start hook

Anchor: **immediately after `started (phase 1)` is appended.**

1. `move --config=<config> --issue <n> --to "<status_in_progress>"` (from Ready). Append
   `github: moved to in-progress`.
2. `comment --issue <n>` saying the run started, naming `<run>` and the ledger
   path `.superpowers/autopilot/<run>/run.md`. Append
   `github: start comment posted`.

### Delta 3b — PR hook

Anchor: **immediately after `pr: <url>` is appended** in the `pr` stage.

1. `move --config=<config> --issue <n> --to "<status_in_review>"`. Append
   `github: moved to in-review`.
2. `comment --issue <n>` with the PR link. Append `github: pr comment posted`.

Appending after `pr:` is safe: `nextStage` matches `pr:` anywhere in the ledger,
not only as the last entry.

### Delta 3c — park hook, and the ordering constraint

Anchor: **immediately before a `PARKED — <reason>` entry is appended.**

Leave the card where it is (In Progress). The park hook adds **no new parking
condition** — a run still parks for exactly autopilot's nine existing reasons.
The only new behavior is the comment.

The order is fixed:

1. Post the park comment (`--body-file`, pointing at the ledger path).
2. Append `github: parked comment posted`.
3. Append `PARKED — <reason>` — **last**.
4. Report the duration, as autopilot's parking section prescribes.

This ordering is load-bearing and is pinned by a test. `nextStage` returns
`parked` only when the **last** ledger entry starts with `PARKED`. A
`github: parked comment posted` line appended *after* the `PARKED` line would
make a parked run look resumable, and `/autopilot resume` would drive it
straight past the park — precisely the failure autopilot's parking section
warns about.

### Delta 3d — verify screenshots hook

Anchor: **immediately after the `verify` stage's ledger entry** — and, when
verify is red after its one fix round, immediately **before** the
`PARKED — <reason>` entry, for exactly the reason Delta 3c gives.

```bash
node "$AP"/scripts/autopilot-github-issue.mjs screenshots \
  --issue <n> \
  --manifest .superpowers/autopilot/<run>/verify/artifacts/uploads.json
```

The `verify` stage writes that manifest only when the project configures an
`artifacts` block and every upload succeeded, so the command has two outcomes
and they are not the same:

1. It prints `posted <n> screenshots to issue #<n>` — append
   `github: verify screenshots posted`.
2. It prints a line starting `skipped — ` (the manifest is absent or
   unreadable, or it carries no items) — append **nothing** and continue. A
   repository with no `artifacts` block must reach exactly the ledger it
   reached before this hook existed.

The ledger line is the idempotency guard: re-read the ledger first and skip the
step when `github: verify screenshots posted` is already present, the same way
every other hook does.

The park case is where these images are worth the most — a human is about to be
asked what went wrong, and the pictures are the answer — so the hook runs there
too, and the ordering is the same one Delta 3c fixes: post, append the
`github: ` line, then append `PARKED — <reason>` **last**. `PARKED` must remain
the ledger's final entry, or `nextStage` stops returning `parked` and
`/autopilot resume` drives the run straight past the park.

An r2.dev public development URL is world-readable. Anything visible in a
verified screenshot is public to anyone with the link, which is why the comment
the script writes says so too.

### Transition failures do not park

If a `move` or `comment` exits non-zero, append
`github: <action> failed — <reason>` and **continue**. Do not park, and do not
retry.

This follows the precedent autopilot's `pr` stage already sets: "If the
`gh pr edit` fails, do not park — the PR exists and the branch is green." The
run's product is the pull request; a stale board card is a reporting defect, not
a reason to abandon a green branch. The ledger line is what makes it visible
afterwards.

The one hard stop is Delta 0's preflight, which runs before anything else.

## Resume

`/autopilot-github resume <run>` recovers the issue number from the run name:
the digits between `issue-` and the next `-` or the end of the string. Both
`issue-42-csv-export-drops-unicode` and the bare `issue-42` fallback — the run
name a title that normalizes to an empty slug produces — parse to `42`. With the
number in hand the hooks still know which issue to act on. Then follow
autopilot's own resume path: read `.superpowers/autopilot/<run>/run.md`, call
`nextStage`, jump to that stage. Each hook's idempotency check decides whether
it has work left to do.

If `nextStage` returns `parked`, stop as autopilot prescribes. The park comment
was already posted and its `github: parked comment posted` line already
recorded, so post nothing new.

## What this skill does not do

Out of scope, deliberately: creating issues, closing issues, reading issue
comments back into the run, reacting to board moves made by humans, and any
board field other than the single-select Status field.

It also does not vet the issue. The issue's title and body flow verbatim into
the brainstorm and, from there, into an unattended pipeline that writes code,
commits, and opens a pull request — only point this skill at issues you trust.

## Common Rationalizations

| Excuse | Reality |
|---|---|
| "I'll dispatch autopilot as a subagent and hook the transitions around it" | The hooks interleave with autopilot's stages and share its ledger. Behind a subagent boundary they are unreachable, and a park reports to you instead of to your human partner. |
| "I know the slug rules — I'll derive the run name myself on resume" | The slug is the ledger directory's key. A second derivation that differs by one character orphans the run. Take it from `resolve` or from the run name. |
| "I'll just `printf` the header line myself, it's one command" | The issue title is untrusted text. A quote breaks the command's quoting and `$(...)` or a backtick executes in your human partner's checkout. `resolve --write-ledger` writes the file from code, where the title is only ever string content. |
| "The full issue body belongs in the ledger header" | The header regex is single-line. The body becomes untimestamped lines that `parseLedger` drops. The body goes to the brainstorm, not to `run.md`. |
| "I'll post the park comment after appending PARKED, it reads better" | Then `PARKED` is no longer the last entry, `nextStage` stops returning `parked`, and the next `/autopilot resume` drives the run past its park. |
| "The card move failed — I should park and ask" | A stale card is a reporting defect. Append `github: move failed — <reason>` and continue; the branch and the PR are the run's product. |
| "The issue isn't on the board, I'll just skip the config" | Preflight is a hard stop for a reason: a run with no board wiring silently produces none of this skill's value. Report the missing keys and stop. |
| "I'll run `gh project item-edit` directly, it's one command" | It needs an item id, a project id, a field id, and an option id, each from a separate call. The script resolves them and names every failure. Prose that shells out by hand gets them wrong silently. |
