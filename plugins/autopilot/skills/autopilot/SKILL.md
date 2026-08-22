---
name: autopilot
description: Use when the developer runs /autopilot with a task description, or /autopilot resume with a branch name - brainstorms interactively, then drives plan, implementation, landing, and PR automatically
---

# Autopilot

Take a task from idea to pull request. Phase 1 is a conversation with your
human partner. Phase 2 runs without them.

**Announce at start:** "I'm using the autopilot skill to take this from
brainstorm to PR."

## Resume

If invoked as `/autopilot resume <branch>`, read
`.superpowers/autopilot/<branch>/run.md`, call `nextStage` on it, and jump to
that stage. Do not redo completed stages. Then follow the pipeline from there.

`nextStage` returns one of ten values: the eight stages — `phase1`, `setup`,
`spec`, `plan`, `sdd`, `learnings`, `land`, `pr` — plus `done` and `parked`.

- A stage name — jump to that stage and follow the pipeline from there.
- `done` — the run reached its PR. Report the URL from the ledger and stop.
- `parked` — **do not continue.** The run stopped deliberately and needs a
  decision from your human partner. Read the park reason from the ledger's
  last entry, report it plainly, and stop. Resuming past a park defeats its
  purpose: a run parked on red tests would otherwise retry landing and open a
  pull request on a failing branch.

## Locating the plugin's scripts

This skill ships four Node helpers in the plugin's `scripts/` directory. They
do **not** live in your human partner's project, so every command below needs
the plugin's absolute path.

**`$CLAUDE_PLUGIN_ROOT` is not set in Bash tool calls** — it is populated only
for processes the plugin system launches, such as hooks. Using it here yields
an empty string and `ERR_MODULE_NOT_FOUND`. Derive the path instead:

When this skill loaded, the harness prefixed it with a line reading
`Base directory for this skill: <abs path>`, pointing at
`<plugin root>/skills/autopilot`. The plugin root is that path with
`/skills/autopilot` removed.

Resolve it once at preflight and reuse it for the rest of the run:

```bash
AP="<the base directory, minus /skills/autopilot>"
ls "$AP/scripts/autopilot-config.mjs"   # must exist; if not, stop
```

Substitute that literal path into every `"$AP/..."` below — you are writing
each command fresh, and shell variables do not persist between Bash calls.

If the base-directory line is somehow absent, fall back to locating the
scripts and stop if the search comes up empty:

```bash
ls ~/.claude/plugins/cache/*/autopilot/*/scripts/autopilot-config.mjs 2>/dev/null
```

## Preflight

Run before asking your human partner anything. On any failure, report what is
missing and stop — do not start the brainstorm.

1. **Skills resolve.** Confirm each of these is available:
   `autopilot:autopilot-brainstorm`, `superpowers:writing-plans`,
   `superpowers:subagent-driven-development`,
   `superpowers:requesting-code-review`,
   `superpowers:finishing-a-development-branch`,
   `superpowers:using-git-worktrees`.
   A missing skill is the most dangerous failure here: an agent told to follow
   an absent skill improvises the stage and returns plausible output that
   skipped the process entirely.
2. **SDD scripts are executable.** Check `sdd-workspace`, `task-brief`, and
   `review-package` in the subagent-driven-development skill's `scripts/`.
3. **Config is valid.** Run from the repository root:

   ```bash
   AP="<plugin root>" && node -e "const{pathToFileURL}=require('node:url');import(pathToFileURL(process.argv[1]+'/scripts/autopilot-config.mjs').href).then(m=>{const r=m.loadConfig('.claude/autopilot.json');r.warnings.forEach(w=>console.log('warning:',w));console.log(r.usedProjectConfig?'ok (project config)':'ok (plugin defaults)')})" "$AP"
   ```

   Report any warning. Two matter especially:

   - **`test_command` not set** — the project supplied no test command, so
     `land` will park instead of reporting tests green. Say so plainly before
     starting the brainstorm; the fix is one key in the project's
     `.claude/autopilot.json`.
   - `CLAUDE_CODE_EFFORT_LEVEL` in the environment overrides every configured
     effort level.

   Config comes from two layers: the plugin's `autopilot.default.json`, and
   the project's optional `.claude/autopilot.json` layered over it, merged per
   key (and per role within `roles`). A project with no config file is normal —
   it runs on defaults.
4. **Repository preconditions.** A git repo with an `origin` remote, and
   `gh auth status` succeeding.

## Phase 1 — brainstorm

Create the ledger at `.superpowers/autopilot/<branch>/run.md` once the branch
name is known; until then, hold the start timestamp. Its header names the
task, not the spec, because the ledger exists before the spec file does:

```
# autopilot run — task: <description>
```

Invoke `autopilot:autopilot-brainstorm` with the task description. It is a fork of
`superpowers:brainstorming` that stops short of writing a spec file: it
explores, asks clarifying questions one at a time, proposes approaches, then
states the resulting design and hands it back to you in conversation. It does
not ask for design approval — the clarifying questions are where your human
partner steers. Nothing is written to disk or committed during this phase.

Append to the ledger: `started (phase 1)` at invocation, `design approved`
when the brainstorm hands the design back. That ledger entry keeps its name —
`nextStage` matches on it to resume a run at `setup` — and it now records the
design settling, not a separate approval step. The spec file itself is written
and committed at the `spec` stage, inside the worktree — nothing is written to
the developer's checkout.

**The brainstorm's handoff ends Phase 1.** When it hands the design back,
append `design approved` and go straight into `setup` in the same turn. Do not
re-present the design, do not summarize it back for confirmation, and do not
ask whether to proceed. The clarifying questions already collected every
decision, so a proceed-check adds nothing but a second pass over the same
answers — exactly the handoff friction Phase 2 exists to remove. Announce the
transition in one line ("Design settled — starting Phase 2") and dispatch.

## Phase 2 — automated

Do not ask your human partner anything in Phase 2 unless a stage parks.

### The run directory

`<run>` is **one string for the whole run**: the run name chosen at Phase 1.
The `<branch>` placeholder in the run-directory paths below refers to this same
string — the two are interchangeable names for one value, not two. It is not
the worktree directory name and not the `worktree-` prefixed git branch. Those
may differ; `<run>` does not change to follow them. Pick it once and reuse it
verbatim in every run-directory path.

The run directory is `.superpowers/autopilot/<run>/` in the **main checkout** —
never inside the worktree. Both `run.md` and `findings.jsonl` live there, and
`findings.jsonl` inherits this placement for the same two reasons:

1. **It exists before the worktree does.** `started (phase 1)` and
   `design approved` are appended during Phase 1, and `setup` — the stage that
   creates the worktree — comes after them.
2. **It must survive the worktree.** The reaper deletes worktrees after merge.
   A ledger inside one destroys the record of every completed run, including
   the PR URL that `nextStage` returns `done` on.

**Known constraint:** a worktree-isolated session cannot Write or Edit files in
the main checkout, though **Bash appends (`>>`) and reads still work**. Use a
Bash append for `run.md` (via `autopilot-ledger.mjs`) and for `findings.jsonl`.
This is a harness limitation, recorded here so it is not rediscovered mid-run.

**Every dispatch:** generate a subagent definition carrying the role's model
and effort from `.claude/autopilot.json`, write it to
`.superpowers/autopilot/<branch>/agents/<role>.md`, and dispatch by that
definition. The Agent tool has no `effort` parameter; frontmatter is the only
way to set it.

```
---
name: autopilot-<role>
description: <role> stage of an autopilot run
model: <config.roles.<role>.model>
effort: <config.roles.<role>.effort>
---

<the dispatch prompt>
```

**Every stage:** re-read the ledger before dispatching, append after. Stage
outputs go to files; a stage returns a status line and a path, never content.
This is what keeps your context small enough to avoid compaction.

**Always append via the plugin's `autopilot-ledger.mjs`, never by hand.**
Every entry must carry an ISO timestamp, and `append()` is what stamps it:

```bash
node -e "const{pathToFileURL}=require('node:url');import(pathToFileURL(process.argv[1]+'/scripts/autopilot-ledger.mjs').href).then(m=>m.append('.superpowers/autopilot/<branch>/run.md','<entry text>'))" "$AP"
```

Writing entries with `cat`/heredoc or the Write tool produces untimestamped
lines. `parseLedger` skips them, so they are invisible to `nextStage` — a
resumed run redoes completed stages — and the run's duration cannot be
recovered afterward. Run the command from the repository root so the relative
paths resolve.

**Every stage is idempotent:** check whether its output already exists and
skip if so.

### `setup`

Run this unconditionally, first, from the repository root — before the
reaper conditional below, regardless of `reaper`'s value. It fetches
`origin` and best-effort fast-forwards `base_ref`'s local branch, so the
worktree below is always built from fresh state even when the reaper is
disabled or `base_ref` names a bare local branch the reaper's own fetch
never touches:

```bash
node "$AP/scripts/autopilot-sync-base.mjs" --base=<config.base_ref>
```

Report its outcome (updated or skipped, with reason) the same way the
reaper's keep/reason list is already reported.

Unless `reaper` is `false` in config, also run from the repository root:

```bash
node "$AP/scripts/autopilot-reaper.mjs" --apply \
  --dir=<config.worktree_dir> --base=<config.base_ref>
```

Pass both flags explicitly from config. Their defaults (`.claude/worktrees`,
`origin/main`) match the plugin defaults, but a project that overrides either
would otherwise have the reaper scanning the wrong directory — where it finds
no worktrees and silently reaps nothing.

Report what it kept and why.

Create the worktree from `base_ref` using `superpowers:using-git-worktrees`.
Phase 2 is unattended, so its consent question must already be answered when
you invoke it: declare the worktree preference up front in the same
instruction rather than letting it ask. State explicitly that a worktree is
wanted, and pass `worktree_dir` from `.claude/autopilot.json` as the declared
directory — this repository uses `.claude/worktrees/` (also what
`scripts/autopilot-reaper.mjs` scans), not that skill's own `.worktrees/`
default. With both declared, its consent branch is already satisfied and it
proceeds without asking.
Append: `worktree: <path> (branch <name>)`.

### `spec`

Dispatch the `spec` role to write the approved design into
`docs/superpowers/specs/YYYY-MM-DD-<topic>-design.md` **inside the worktree**
and commit it. This is the run's first commit. Nothing was written to the
developer's checkout during Phase 1, and nothing is written there now.

Append: `spec committed → <path>`.

### `plan`

Dispatch the `plan` role. It invokes `superpowers:writing-plans` against the
approved spec and returns the plan path.

The dispatch prompt also carries a task-count budget. Task count is the single
largest driver of a run's wall-clock time: `sdd` is ~66% of every run measured,
and it costs a near-constant 3–12 minutes per task because
`subagent-driven-development` forbids parallel implementer dispatch, so tasks
run strictly serially. Across real runs, 5 tasks landed in 17–23m, 10 tasks in
80m, and 16 tasks in 191m. Nothing else in the pipeline moves the total that
far, so this budget belongs at the stage that sets the multiplier. Include text
equivalent to:

> Task-count budget for this plan:
>
> 1. **Target 3–5 tasks.** Every task costs a serial implementer dispatch plus
>    a review round, so task count multiplies the run's wall clock directly.
> 2. **Merge trivially-coupled steps into one task.** Two steps belong together
>    when one cannot be reviewed or tested without the other — a function and
>    its only caller, a field and the migration that adds it. Splitting those
>    buys no reviewability and costs a full dispatch cycle.
> 3. **Do not merge steps that touch unrelated subsystems**, and do not merge
>    to hit the number. A task that cannot be reviewed as one diff is two
>    tasks. Correctness outranks the budget.
> 4. **If the work genuinely needs more than 5 tasks, write them** and say why
>    in the plan. This is a budget, not a cap.

Rule 3 is load-bearing: a bare instruction to emit fewer tasks produces
oversized tasks whose diffs defeat task review, which converts a wall-clock
saving into fix rounds that cost more than the tasks saved.

The dispatch prompt also carries a learnings instruction. The plan agent is the
one consumer of the run's accumulated learnings; every other stage is
deliberately learnings-free. Include text equivalent to:

> Read `docs/autopilot/learnings.md` if present and apply its planning rules to
> this plan. If the file is absent — an early run, or a repo that has never
> produced learnings — plan without it. No error, no parking.

Append: `plan complete → <path> (<n> tasks)`.

### `sdd`

Dispatch the `implement` role to run `superpowers:subagent-driven-development`
against the plan. `subagent-driven-development` has no mechanism for accepting
an externally supplied model map — it has its own Model Selection section
telling its controller to choose models by its own judgment. Naming "the
roles block" to it is not an instruction it can act on. Instead, the dispatch
prompt must contain the actual role-to-model-and-effort mapping as literal
text, read from `.claude/autopilot.json` at dispatch time, framed as an
override of SDD's own Model Selection heuristics. Include text equivalent to:

> Do not use your own Model Selection judgment to pick models or effort
> levels. Use this mapping for every internal dispatch instead, reading the
> values from `.claude/autopilot.json`'s `roles` block:
>
> - Implementer, mechanical task → the `implement` role's model and effort
> - Implementer, multi-file or judgment task → the `implement_complex` role's
>   model and effort
> - Task reviewer → the `task_review` role's model and effort
> - Scoped re-review → the `re_review` role's model and effort
> - Fix rounds 4–5 → the `fix_escalation` role's model and effort
> - Final whole-branch review → the `final_review` role's model and effort
>
> Substitute each role's actual `model` and `effort` values from the config
> file into the subagent definition you generate for that dispatch, the same
> way autopilot generates one per dispatch for its own stages.

Write the literal `model`/`effort` values for all six roles into the dispatch
prompt so the dispatched agent knows exactly what to use for each of SDD's six
internal dispatch roles without needing to consult autopilot's config itself.

The dispatch prompt also carries a verification contract. Without it the
stage agent narrates its own verification into the developer's transcript —
`md5` comparisons before and after a re-run, `echo` separators, throwaway
repositories built to prove a guard fires — and each one renders as a tool
call the developer cannot act on. SDD's implementer prompt already caps what
an agent *returns* ("under 15 lines — the detail lives in the report file");
nothing caps the work it narrates getting there. This is that cap, and it
applies to the agent we dispatch. Include text equivalent to:

> Verification contract for this stage:
>
> 1. **Verify through `test_command`.** The project states its test command in
>    `.claude/autopilot.json`. That is the gate. Do not construct ad-hoc
>    equivalents to check the same thing.
> 2. **Do not narrate verification.** No `md5` before/after comparisons, no
>    `echo` separators, no `ls` existence probes, no re-running a command to
>    demonstrate its idempotence. If a check is worth running, its result is
>    worth recording in the report file — not in the transcript.
> 3. **Do not build throwaway repositories to prove a guard fires.** A guard
>    that needs testing needs a test in the suite.
> 4. **One gate, one result.** Run the suite once per verification point and
>    report the outcome.
>
> This redirects verification; it does not remove it. Run the gate in rule 1.

Rules 2 and 3 name patterns observed in real runs. Naming them is
load-bearing: a general instruction to be concise has no purchase on an agent
that believes each individual check is justified.

This reduces transcript noise; it does not eliminate it. SDD's own nested
dispatches — implementer, task reviewer, re-reviewer — run under prompts
belonging to `superpowers:subagent-driven-development`, and their tool calls
still render.

The dispatch prompt also carries a findings capture contract. SDD generates
review findings and then discards them: task reports are written after the fix
and describe the corrected state, so they read as success narratives. In a real
repository, ten task reports mentioned not one review finding, fix round, or
rejected verdict. The signal is real — two findings in a single run were both
attributable to the brief rather than the implementer — but nothing survives to
show it. Include text equivalent to:

> Findings capture contract for this stage:
>
> 1. **Append one JSON line per review finding** to
>    `.superpowers/autopilot/<run>/findings.jsonl` in the **main checkout**,
>    beside `run.md` — not inside the worktree, which the reaper deletes. Use a
>    Bash append (`>>`); a worktree-isolated session cannot Write/Edit to the
>    main checkout, but Bash appends work.
> 2. **Every finding line carries all seven fields**: `task` (number), `round`
>    (number), `severity`, `stage_at_fault`, `pattern`, `detail`, `verdict`.
>    A line missing any of them is dropped by the analyzer.
> 3. **`stage_at_fault` is one of `brief`, `plan`, `spec`, `implementation`** —
>    the stage that produced the bad input, not the stage that surfaced it. A
>    defect the brief introduced must not be recorded as an implementation
>    error; framing every finding as a model mistake tunes the wrong stage.
>    Invent no other values.
> 4. **`pattern` is a short canonical phrase; `detail` carries the specifics.**
>    Clustering is a pure lexical match over `pattern`, so a phrase rewritten
>    per finding clusters with nothing. Reuse a phrase you have used before
>    when the defect is the same kind.
> 5. **A task that passes review writes an explicit clean line**:
>    `{"task": N, "clean": true}`. This is not optional bookkeeping. Without
>    it, absence of evidence is indistinguishable from evidence of absence:
>    occurrence counts become a floor rather than a count, and no threshold can
>    be trusted.
>
> Example lines:
>
> ```
> {"task":4,"round":1,"severity":"major","stage_at_fault":"brief","pattern":"brief introduced dead code","detail":"service._logger added by the brief is never wired","verdict":"CONFIRMED"}
> {"task":5,"clean":true}
> ```

A general instruction to "log findings" will not bind. The rules above name the
concrete expected behavior for the same reason the verification contract's
rules 2 and 3 do.

Answer these gates from config rather than asking:

| Gate | Answer |
|---|---|
| `writing-plans` execution choice | `subagent-driven` |
| SDD pre-flight plan-conflict scan | Resolve; log each resolution to the ledger |
| SDD plan-vs-review contradiction | Plan governs; log to the ledger |

SDD reporting BLOCKED is not answered from config. It parks.

Append: `sdd complete (<n> tasks, <k> parked, <f> fix rounds across <t> tasks)`
— for example `sdd complete (10 tasks, 0 parked, 7 fix rounds across 4 tasks)`.
Count a fix round every time a task returns to its implementer after a review
finding; `<t>` is how many distinct tasks needed at least one. Keep the
`sdd complete (` prefix exactly — `nextStage` matches it to resume the run at
`learnings`. Without the fix-round clause, a run where every task needed three
rounds renders identically to one where all passed first try, so a struggling
run is invisible at a glance.

### `learnings`

Dispatch the `learnings` role to rewrite `docs/autopilot/learnings.md` inside
the worktree and commit it. This is the one artifact the pipeline both writes
and reads: `sdd` captures review findings, the learnings role distills them
into planning rules, and the next run's `plan` stage reads the doc.

The dispatch prompt instructs the role to:

1. Read this run's findings at `.superpowers/autopilot/<run>/findings.jsonl`
   in the **main checkout** — via Bash, not Write/Edit, because a
   worktree-isolated session cannot write the main checkout but Bash reads
   work.
2. Read the accumulated corpus across `.superpowers/autopilot/*/findings.jsonl`
   the same way.
3. Read the existing `docs/autopilot/learnings.md` on the branch, if present.
4. Rewrite the doc — **condensed and bounded, not endlessly appended** — keeping
   two sections: **"Planning rules"** (actionable prose rules for the plan
   stage, with `stage_at_fault == "plan"` findings prioritized) and **"Recent
   runs"** (compact summaries, trimmed to the most recent runs).
5. Write the rewritten doc **inside the worktree** at
   `docs/autopilot/learnings.md`.
6. Commit it to the branch.

If no `docs/autopilot/learnings.md` exists on the branch yet, seed it from the
accumulated corpus rather than starting empty — the first rewritten doc should
already carry distilled rules.

A `learnings`-stage failure does not park. Log it and continue: append
`learnings failed — <reason>` and proceed to `land`. Only a successful commit
appends `learnings committed → docs/autopilot/learnings.md`, which is what
`nextStage` matches to treat this stage as done.

Append: `learnings committed → docs/autopilot/learnings.md`.

### `land`

Run `node "$AP/scripts/autopilot-land.mjs" <base_ref>` from the
repository root.

**If `test_command` is not set, park immediately** — before rebasing. Without
it there is no way to tell a landed branch from a broken one, and the whole
point of this stage is that check. Append
`PARKED — test_command not set in .claude/autopilot.json`. Never treat an
absent test command as a pass.

- `clean` — run `test_command`. Green, append
  `rebase clean, tests green (<n> passed)` and continue. Red, park.
- `conflict` — dispatch the `implement` role to resolve. It resolves only what
  it can reason about confidently: both sides independent, one side a clear
  superset, import-list merges. Anything where both sides changed the same
  logic, it parks. Then re-run the land script to confirm clean, then run
  `test_command`. Only green continues.
- `error` — park.

The test run after the rebase is not optional. Semantic conflicts rebase
cleanly and still break the branch: task A renames a function, task B adds a
caller of the old name in a file A never touched, git reports nothing, and the
branch is broken. The suite is the only thing that catches this.

### `pr`

Dispatch the `implement` role to run
`superpowers:finishing-a-development-branch`, answering its menu with option 2
(push and create a PR). It handles the push and `gh pr create` itself.

Append `pr: <url>` **first**, then read the timing back out of the ledger —
appending first is what makes the PR entry the last timestamp, so the span
covers the whole run:

```bash
node "$AP/scripts/autopilot-ledger.mjs" timing .superpowers/autopilot/<branch>/run.md
node "$AP/scripts/autopilot-ledger.mjs" duration .superpowers/autopilot/<branch>/run.md
```

`timing` prints a markdown section — the total plus a per-stage table.
`duration` prints just the total, for reporting to your human partner.

Record the timing in the PR description. Read the body the PR was created
with, append the timing section to it, and edit the PR — never replace the
body, the description written by `finishing-a-development-branch` is the part
a reviewer reads:

```bash
RUN=.superpowers/autopilot/<branch>
gh pr view <url> --json body --jq .body > "$RUN/pr-body.md"
printf '\n\n' >> "$RUN/pr-body.md"
node "$AP/scripts/autopilot-ledger.mjs" timing "$RUN/run.md" >> "$RUN/pr-body.md"
gh pr edit <url> --body-file "$RUN/pr-body.md"
```

The body file goes in the run directory, not `/tmp` — it is scoped to this
branch, so two runs finishing at once cannot overwrite each other's PR body.

If the `gh pr edit` fails, do not park — the PR exists and the branch is
green. Report the timing in your summary instead and say the description
could not be updated.

Report the URL and the duration together:

```
PR: <url>
Run duration: <formatted duration> (<n> stages)
```

This measures the ledger's first entry to its last, so it starts at
`started (phase 1)` and excludes preflight, which runs before the ledger
exists. Say "excludes preflight" when reporting, rather than presenting the
number as the complete wall-clock time.

Both the total and the per-stage breakdown (`durations()`) are derivable from
the ledger at any later point — including from a resumed session that never
saw the earlier stages.

## Parking

Five conditions park a run. Write the reason to the ledger, tell your human
partner plainly that the run needs a decision, and stop.

- SDD reports BLOCKED — the round-5 breaker on a load-bearing finding
- Rebase conflicts the resolver will not take confidently
- Tests red after rebase
- `test_command` not set, so the branch cannot be verified
- `gh pr create` fails

Never retry autonomously. Never push a red branch. Never resolve a
load-bearing ambiguity by guessing.

Append: `PARKED — <reason>`. Use that exact prefix — uppercase `PARKED`
followed by an em-dash. `nextStage` detects a parked run by matching
`PARKED` at the start of the ledger's last entry; any other wording silently
breaks resume detection, and a later `/autopilot resume` will drive the run
straight past the park.

Report elapsed time alongside the park reason — append the `PARKED` entry
first, then run the `duration` command from the `pr` stage against the same
ledger. A parked run is exactly when your human partner wants to know how much
time went in before it stopped. There is no PR to record it in, so the ledger
and your summary are the only places it lands.

Parking behaves the same whether or not Remote Control is connected. If it is,
your human partner gets a push notification; if not, they read the ledger.
Never check for it, never wait on it.

## Common Rationalizations

| Excuse | Reality |
|---|---|
| "The spec is approved, I can skip preflight" | Preflight runs before the brainstorm. A missing skill gets improvised into plausible output that skipped the process. |
| "I'll read the plan to check the work" | Stage outputs stay in files. Reading them into your context is what causes the compaction this design defends against. |
| "The rebase was clean, tests will pass" | Semantic conflicts rebase clean and break the branch. Run the suite. |
| "No `test_command` is configured, so there's nothing to run — continue" | An unverifiable branch is not a passing one. Park and say the key is missing. |
| "I'll infer the test command from package.json" | A guess that exits 0 for the wrong reason reads as green. The project states it, or the run parks. |
| "This conflict is obvious, I'll resolve it myself" | The resolver is a dispatched agent. Controller fixes skip review. |
| "I'll just ask about this one contradiction" | Plan governs, logged to the ledger. The final review sees the list. |
| "The ledger is bookkeeping overhead" | The ledger is what survives compaction. Without it, a resumed run redoes completed stages. |
| "Appending is just a line in a file — a heredoc is fine" | `append()` stamps the ISO timestamp. A hand-written line has none, so `parseLedger` drops it: `nextStage` goes blind and the run's duration is unrecoverable. |
| "The run parked, but I know the fix — I'll resume it" | A park is a decision point for your human partner. Resuming past it opens a PR on a branch that parked for a reason. |
| "Let me restate the design before I start Phase 2" | The clarifying questions already collected every decision. Re-presenting asks your human partner to approve their own answers and stalls the run on a reply it doesn't need. Append `design approved` and dispatch `setup`. |
| "I'll just confirm they're ready for me to start" | Running `/autopilot` *is* that confirmation. Phase 2 starts the moment the brainstorm hands the design back. |
| "The design has a gap — I'll present it and ask" | A gap is a missed clarifying question, and the questions are still open while the brainstorm runs. Ask it there. Once the brainstorm hands back, Phase 2 owns the run. |
