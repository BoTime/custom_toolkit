---
name: autopilot
description: Use when the developer runs /autopilot with a task description, or /autopilot resume with a branch name - brainstorms interactively, then drives plan, implementation, landing, and PR automatically
---

# Autopilot

Take a task from idea to pull request. Phase 1 is a conversation with your
human partner. Phase 2 runs without them.

**Announce at start:** "I'm using the autopilot skill to take this from
brainstorm to PR."

Why each rule below is worded as it is — the run data, the failures that
produced it — lives in `references/rationale.md`. Read it when editing this
skill, not when running it.

## Resume

If invoked as `/autopilot resume <branch>`, read
`.superpowers/autopilot/<branch>/run.md`, call `nextStage` on it, and jump to
that stage. Do not redo completed stages.

`nextStage` returns one of eleven values: the nine stages — `phase1`, `setup`,
`spec`, `plan`, `sdd`, `verify`, `learnings`, `land`, `pr` — plus `done` and
`parked`.

- A stage name — jump to it and follow the pipeline from there.
- `done` — report the PR URL from the ledger and stop.
- `parked` — **do not continue.** Read the park reason from the ledger's last
  entry, report it plainly, and stop. A run parked on red tests would
  otherwise retry landing and open a pull request on a failing branch.

**Read the ledger and the paths it names. Nothing else.** A handoff only pays
while the context crossing it stays small; re-reading the spec, the plan and
the diff to get oriented rebuilds exactly what the handoff shed. The next
stage's dispatch tells the subagent what to read.

## Locating the plugin's scripts

The plugin's `scripts/` and `references/` do **not** live in your human
partner's project, so every command below needs the plugin's absolute path.

**Do not rely on a plugin-root environment variable in Bash tool calls.** The
host may set one only for processes it launches, such as hooks; in an agent
shell it can be empty and lead to `ERR_MODULE_NOT_FOUND`.

When this skill loaded, the harness prefixed it with
`Base directory for this skill: <abs path>`, pointing at
`<plugin root>/skills/autopilot`. The plugin root is that path minus
`/skills/autopilot`. Resolve it once at preflight:

```bash
AP="<the base directory, minus /skills/autopilot>"
ls "$AP/scripts/autopilot-config.mjs"   # must exist; if not, stop
```

Substitute that literal path into every `"$AP/..."` below — you write each
command fresh, and shell variables do not persist between Bash calls. If the
base-directory line is absent, fall back to either supported host's plugin
cache, and stop if this finds nothing:

```bash
find ~/.claude/plugins/cache ~/.codex/plugins/cache -path '*/autopilot/*/scripts/autopilot-config.mjs' -type f 2>/dev/null
```

## Preflight

Run before asking your human partner anything. On any failure, report what is
missing and stop — do not start the brainstorm.

1. **Select the host.** Identify the harness running this skill and keep one
   matching pair for the whole run:

   | Harness | `<host>` | `<config>` |
   |---|---|---|
   | Claude Code | `claude` | `.claude/autopilot.json` |
   | Codex | `codex` | `.codex/autopilot.json` |

   Stop if the harness is neither one. Every config read and stage composition
   below uses this selected pair; never mix a config from one row with the host
   from the other.
2. **Skills resolve.** `autopilot:autopilot-brainstorm`,
   `superpowers:writing-plans`, `superpowers:subagent-driven-development`,
   `superpowers:requesting-code-review`,
   `superpowers:finishing-a-development-branch`,
   `superpowers:using-git-worktrees`. A missing skill is the most dangerous
   failure here: an agent told to follow an absent skill improvises the stage
   and returns plausible output that skipped the process entirely.
3. **SDD scripts are executable.** `sdd-workspace`, `task-brief`, and
   `review-package` in the subagent-driven-development skill's `scripts/`.
4. **Config is valid.** From the repository root, substitute the selected
   literals for `<config>` and `<host>`:

   ```bash
   AP="<plugin root>" && node -e "const{pathToFileURL}=require('node:url');import(pathToFileURL(process.argv[1]+'/scripts/autopilot-config.mjs').href).then(m=>{const r=m.loadConfig(process.argv[2],process.env,undefined,undefined,{host:process.argv[3]});r.warnings.forEach(w=>console.log('warning:',w));console.log(r.usedProjectConfig?'ok (project config)':'ok (plugin defaults)')})" "$AP" "<config>" "<host>"
   ```

   Report any warning. Two matter especially:

   - **`test_command` not set** — `land` will park instead of reporting tests
     green. Say so plainly before starting the brainstorm; the fix is one key
     in the selected `<config>` file.
   - `CLAUDE_CODE_EFFORT_LEVEL` on Claude or `CODEX_REASONING_EFFORT` on Codex
     overrides every configured effort level.

   Config is the selected host's shipped defaults with the project's optional
   `<config>` layered over them, merged per key (and per role within `roles`).
   A project with no config file runs on that host's defaults.
5. **Repository preconditions.** A git repo with an `origin` remote, and
   `gh auth status` succeeding.

## Phase 1 — brainstorm

Create the ledger at `.superpowers/autopilot/<branch>/run.md` once the branch
name is known; until then, hold the start timestamp. Its header names the
task, not the spec, because the ledger exists before the spec file does:

```
# autopilot run — task: <description>
```

Invoke `autopilot:autopilot-brainstorm` with the task description. It is a
fork of `superpowers:brainstorming` that stops short of writing a spec file:
it explores, asks clarifying questions one at a time, proposes approaches,
then states the resulting design and hands it back to you in conversation. It
does not ask for design approval — the clarifying questions are where your
human partner steers. Nothing is written to disk during this phase.

Append `started (phase 1)` at invocation and `design approved` when the
brainstorm hands the design back. That entry keeps its name — `nextStage`
matches on it to resume at `setup` — and records the design settling, not a
separate approval step.

### Capture the clarifying questions

Every clarifying question the brainstorm asked marks context the pipeline
could not find on its own — in the task description, in the repo, in
`CLAUDE.md`, or in config. Capture the whole set **once, in a single batch, at
the handoff**, never one question at a time: the interactive phase stays as
fast as it is today, and the trade — a brainstorm interrupted before the
handoff records nothing — is deliberate.

Write the batch with a quoted heredoc, then capture it. Capture appends one
line per element to `.superpowers/autopilot/<run>/questions.jsonl` in the
**main checkout**, beside `run.md`:

```bash
cat > /tmp/autopilot-questions.json <<'JSON'
[
  {
    "seq": 1,
    "question": "<the clarifying question, as asked>",
    "answer": "<the answer your human partner gave>",
    "answer_source": "repo",
    "pattern": "<short canonical phrase>"
  }
]
JSON
node "$AP/scripts/autopilot-questions.mjs" capture \
  --run-dir=.superpowers/autopilot/<run> \
  --questions=@/tmp/autopilot-questions.json
```

`seq` is 1-based within the run and records the order asked. `answer_source`
names where the answer **should have lived** — not what the question was
about:

| Value | Meaning |
|---|---|
| `task` | The issue or task description could have stated it |
| `repo` | Discoverable by reading code, docs, or tests already present |
| `claude_md` | A project convention that belongs in `CLAUDE.md` |
| `config` | A key in `.claude/autopilot.json` |
| `judgment` | Genuine human preference; no artifact could have supplied it |

Record the `judgment` questions too. A recurring judgment question is never a
defect and is never proposed as something to fix, but without it the corpus
has no denominator: a run that asked two answerable questions would look
identical to one that asked two answerable and twenty judgment calls.

`pattern` is the clustering key and clustering is a pure lexical match, so
reuse the same short phrase verbatim across runs when the gap is the same
kind, and leave the specifics to `question` and `answer`. A phrase reworded
per question clusters with nothing.

Validation is all-or-nothing: on any bad element the script writes nothing and
exits non-zero, naming the offending index and field.

**Capture before appending `design approved`.** That entry is what a resume
matches to jump straight to `setup`, so a run that captured after it would
re-capture the same batch on every resume.

**A capture failure never parks.** Append
`questions capture failed — <reason>` and continue the run, the way a
`learnings` failure is logged and passed over. The run's product is the pull
request; a missing question log is a reporting defect.

The brainstorm's handoff ends with `tier: <small|standard|large>`. Append that
line to the ledger verbatim, immediately after `design approved`:

```
2026-08-26T14:03:00Z  design approved
2026-08-26T14:03:01Z  tier: small
```

The tier caps how far `plan` may decompose the work. It never decides which
documents get written — `spec` and `plan` run on every tier. If the handoff
carries no tier, append nothing and omit `--tier` at the `plan` dispatch: the
run gets the untiered budget, which is more ceremony rather than less.

**The brainstorm's handoff ends Phase 1.** Append `design approved` and go
straight into `setup` in the same turn. Do not re-present the design, do not
summarize it back for confirmation, and do not ask whether to proceed. The
clarifying questions already collected every decision. Announce the transition
in one line ("Design settled — starting Phase 2") and dispatch.

## Phase 2 — automated

Do not ask your human partner anything in Phase 2 unless a stage parks.

### The run directory

`<run>` is **one string for the whole run**: the run name chosen at Phase 1.
The `<branch>` placeholder in run-directory paths refers to this same string —
two names for one value. It is not the worktree directory name and not the
`worktree-` prefixed git branch. Those may differ; `<run>` does not change to
follow them. Pick it once and reuse it verbatim.

The run directory is `.superpowers/autopilot/<run>/` in the **main checkout** —
never inside the worktree. `run.md`, `findings.jsonl` and `verify/` live there,
and `findings.jsonl` inherits this placement for two reasons:

1. **It exists before the worktree does.** `started (phase 1)` and
   `design approved` are appended during Phase 1, and `setup` — the stage that
   creates the worktree — comes after them.
2. **It must survive the worktree.** The reaper deletes worktrees after merge.
   A ledger inside one destroys the record of every completed run, including
   the PR URL that `nextStage` returns `done` on.

**Every stage:** re-read the ledger before dispatching, append after. Stage
outputs go to files; a stage returns a status line and a path, never content.
This is what keeps your context small enough to avoid compaction.

**Every stage is idempotent:** check whether its output already exists and skip
if so.

### Composing a dispatch

You do not compose dispatches. `autopilot-dispatch.mjs` does:

```bash
node "$AP/scripts/autopilot-dispatch.mjs" <stage> \
  --run=<run> --host=<host> --config=<config> [--key=value ...]
```

It writes one host-native stage artifact carrying the role's model and effort
from config plus every contract that stage owes its agent, then prints **that
path and nothing else**. Handle that path with the selected protocol below.

### Codex dispatch

For Codex, the concrete composition prefix is:

```bash
node "$AP/scripts/autopilot-dispatch.mjs" <stage> \
  --run=<run> --host=codex --config=.codex/autopilot.json [--key=value ...]
```

The printed path is
`.superpowers/autopilot/<run>/agents/<stage>.json`. Read that JSON record, then
call `spawn_agent` with `task_name` `${record.role}-${stage}`, `message`
`record.instructions`, `model` `record.model`, and `reasoning_effort`
`record.reasoning_effort`; set `fork_turns` `"none"` so Codex accepts those
explicit model settings and relies only on the self-contained rendered
instructions. A missing or malformed field is a hard stop; never fill it from
memory or substitute a different model. Wait for that agent's stage status/path
result, then apply the same ledger rule the stage states below.

### Claude dispatch

For Claude, the printed path is
`.superpowers/autopilot/<run>/agents/<stage>.md`. It is the subagent definition;
dispatch the Agent by that printed path. The Agent tool has no `effort`
parameter, so the definition's frontmatter carries it.

**Claude-only worktree caveat:** a worktree-isolated Claude session cannot
Write or Edit files in the main checkout, though **Bash appends (`>>`) and
redirects still work**. On Claude, use Bash for `run.md`, `findings.jsonl`, and
everything under `verify/`.

Four rules:

1. **Any non-zero exit stops the run.** The message on stderr names what is
   absent — the stage, the placeholder, the flag, the fragment, the
   `roles.<role>` field. Never work around it by writing a prompt yourself: a
   stage dispatched without its contract produces plausible work that skipped
   the process, and reports success.
2. **Consume only what the host protocol requires.** On Claude, do not read the
   composed definition; dispatch it by path. On Codex, read the JSON record
   exactly once because its four fields are the native spawn request. Do not
   separately open or reconstruct the rendered fragments.
3. **Multi-line values go to a file, and the flag says `@path`.** Write the
   value into the run directory with a quoted heredoc (`cat > path <<'EOF'`),
   then pass `--key=@path`. Single-line values — paths, the run name, the
   branch — are passed inline. `--key=@@literal` escapes a value that
   genuinely starts with `@`.
4. **Flags are kebab-case; the template's placeholders are snake_case.**
   `--spec-path` fills `{{spec_path}}`. A flag no template consumes is an
   error, because the value it carried would never have reached the agent.

`$AP` is written here for readability only. Shell variables do not persist
between Bash calls, so substitute the literal path into every command you
actually run — or set it again at the top of each call.

### The ledger

**Always append via `autopilot-ledger.mjs`, never by hand.** Every entry must
carry an ISO timestamp, and `append()` is what stamps it:

```bash
node -e "const{pathToFileURL}=require('node:url');import(pathToFileURL(process.argv[1]+'/scripts/autopilot-ledger.mjs').href).then(m=>m.append('.superpowers/autopilot/<branch>/run.md','<entry text>'))" "$AP"
```

`cat`/heredoc or the Write tool produce untimestamped lines. `parseLedger`
skips them, so they are invisible to `nextStage` — a resumed run redoes
completed stages — and the run's duration cannot be recovered. Run from the
repository root so relative paths resolve.

### The session cap

A session's cost grows with the square of its own length, so no one session
carries a whole run. **After appending a stage's completion line, record your
size and hand off if you are over cap:**

```bash
node "$AP/scripts/autopilot-session.mjs" record .superpowers/autopilot/<branch>/run.md <stage-just-finished>
```

It prints `{"turns":N,"ctx":N,"handoff":true|false,"over":[...]}`.

- `handoff: false` — continue to the next stage in this session.
- `handoff: true` — **stop.** Report the stage you finished, the measurement,
  and that the run continues with `/autopilot resume <branch>`. Do not start
  the next stage.

Check at a stage boundary only, never mid-stage: a session that stops halfway
through `sdd` hands its successor no way to pick up, and the stage is redone.

Caps live under `session` in `.claude/autopilot.json` (`max_turns`,
`max_context_tokens`), layered over the plugin defaults.

### `setup`

Run this unconditionally, first, from the repository root — before the reaper
conditional, regardless of `reaper`'s value. It fetches `origin` and
best-effort fast-forwards `base_ref`'s local branch, so the worktree is always
built from fresh state even when the reaper is disabled or `base_ref` names a
bare local branch the reaper's own fetch never touches:

```bash
node "$AP/scripts/autopilot-sync-base.mjs" --base=<config.base_ref>
```

Report its outcome (updated or skipped, with reason).

Unless `reaper` is `false` in config, also run from the repository root:

```bash
node "$AP/scripts/autopilot-reaper.mjs" --apply \
  --dir=<config.worktree_dir> --base=<config.base_ref>
```

Pass both flags explicitly from config — a project that overrides either would
otherwise have the reaper scanning the wrong directory and silently reaping
nothing. Report what it kept and why.

Create the worktree from `base_ref` using `superpowers:using-git-worktrees`.
Phase 2 is unattended, so answer its consent question up front in the same
instruction rather than letting it ask: state explicitly that a worktree is
wanted, and pass `worktree_dir` from config as the declared directory — this
repository uses `.claude/worktrees/` (what `autopilot-reaper.mjs` scans), not
that skill's own `.worktrees/` default.

Append: `worktree: <path> (branch <name>)`.

### `spec`

Dispatch the `spec` role to write the approved design into
`docs/superpowers/specs/YYYY-MM-DD-<topic>-design.md` **inside the worktree**
and commit it. This is the run's first commit.

**The spec must carry an `## Acceptance criteria` section** — the run's one
statement of what "done" means, which `verify` reads to decide what to check in
a browser and whether to open one at all.

The design is multi-line, so it goes to a file first:

```bash
cat > .superpowers/autopilot/<run>/design.md <<'EOF'
<the design the brainstorm settled>
EOF
node "$AP/scripts/autopilot-dispatch.mjs" spec \
  --run=<run> \
  --host=<host> \
  --config=<config> \
  --worktree=<worktree path> \
  --branch=<branch> \
  --spec-path=docs/superpowers/specs/YYYY-MM-DD-<topic>-design.md \
  --design=@.superpowers/autopilot/<run>/design.md \
  --criteria-source="The acceptance criteria for this spec come from the design settled in the brainstorm, below."
```

Dispatch with the selected host protocol.

`/autopilot-github` seeds the criteria from the issue body, a plain
`/autopilot` from the brainstorm's design — that difference is what
`--criteria-source` carries, and nothing else in the stage changes. Either way
the spec is where they land, which is what lets `plan` and `verify` both read
one list.

Append: `spec committed → <path>`.

### `plan`

Dispatch the `plan` role. It invokes `superpowers:writing-plans` against the
approved spec and returns the plan path.

```bash
node "$AP/scripts/autopilot-dispatch.mjs" plan \
  --run=<run> \
  --host=<host> \
  --config=<config> \
  --worktree=<worktree path> \
  --spec-path=<path-to-spec> \
  --tier=<tier>
```

Dispatch with the selected host protocol.

`--tier` is the `tier:` entry's value, read from the ledger you re-read before
dispatching. **Omit the flag entirely when the ledger has no `tier:` entry** —
a resumed run whose ledger predates tiering, or a brainstorm that returned no
tier. Do not guess one. An unrecognised value is a compose-time error naming
the three accepted values, because a typo would otherwise produce a run whose
ceremony nobody chose.

Task count is the single largest driver of a run's wall-clock time, so the
composed definition carries a task-count budget — the tier's ceiling when
`--tier` is present, and the untiered 1–5 range when it is not. It also
carries a minimalism ladder when `minimalism.mode` is `lite` or `full`, and a
learnings instruction when the worktree has `docs/autopilot/learnings.md` —
the plan agent is the one consumer of the run's accumulated learnings, and
every other stage is deliberately learnings-free. The script reads all three
conditions from merged config and the worktree; there is nothing to gate by
hand.

The plan ladder governs task decomposition only — `sdd` carries a separate
minimalism contract about how code gets written, and the two must not be
collapsed.

#### Derive the verify recipe

If the committed spec carries no `(ui)` acceptance criterion, skip this — the
`verify` stage will skip too, and a recipe nothing reads is waste. Otherwise
derive one now, because `verify` runs next.

Read the project the way a new contributor would — `package.json` scripts, any
compose file, `scripts/`, the README — and answer four questions:

| Key | Question | Required |
|---|---|---|
| `dev_command` | What one command brings the app up? | yes |
| `base_url_command` | What one command prints the URL it came up on? | yes |
| `stop_command` | What one command takes it back down? | no |
| `seed_command` | What one command loads test data, if any is needed? | no |

Write them to `.superpowers/autopilot/<run>/verify/recipe.json` in the **main
checkout** with a Bash heredoc:

```bash
mkdir -p .superpowers/autopilot/<run>/verify
cat > .superpowers/autopilot/<run>/verify/recipe.json <<'EOF'
{
  "dev_command":      "bash scripts/worktree-up.sh",
  "base_url_command": "grep '^WEB_ORIGIN=' apps/api/.env | cut -d= -f2-",
  "stop_command":     "bash scripts/worktree-down.sh",
  "seed_command":     "npm run db:seed:test"
}
EOF
```

Three rules travel with it:

1. **`base_url_command` prints the URL and nothing else.** It runs in the
   worktree after `dev_command`, and its trimmed stdout *is* the base URL. Read
   it from wherever the project already states it — an env file, `docker
   compose port`, a `--print-url` flag — rather than hardcoding a port.
2. **The recipe is rederived every run and never committed.** It is gitignored
   under `.superpowers/`.
3. **Do not verify the recipe by running it.** A wrong derivation surfaces as a
   `verify` park several stages later.

If the plan agent's return line reports an escalation, append the escalation
first, then the completion — so `plan complete` stays the last entry and the
resume path is unambiguous:

```
tier escalated: small → standard — the config block and the dispatch wiring cannot be reviewed as one diff
plan complete → docs/superpowers/plans/2026-08-26-x-plan.md (2 tasks)
```

Escalation is the plan stage's own one-step move and needs no answer from you:
it is never a park and never a question. A tier is never lowered, and never
escalates twice in a run.

Append: `plan complete → <path> (<n> tasks)`.

### `sdd`

Dispatch the `implement` role to run `superpowers:subagent-driven-development`
against the plan.

```bash
node "$AP/scripts/autopilot-dispatch.mjs" sdd \
  --run=<run> \
  --host=<host> \
  --config=<config> \
  --worktree=<worktree path> \
  --plan-path=<path-to-plan> \
  --tasks=<n>
```

Dispatch with the selected host protocol.

SDD picks models by its own judgment and cannot accept an externally supplied
map, so the composed definition overrides that with a literal mapping plus a
rendered table of the six roles' actual `model` and `effort` values, read from
merged config at compose time. It also carries a verification contract, which
stops the stage agent narrating its own verification into the developer's
transcript, and a findings capture contract, which stops SDD's review findings
being discarded — and a minimalism contract when `minimalism.mode` is `lite` or
`full`.

The verification contract reduces transcript noise; it does not eliminate it.
SDD's own nested dispatches still render their tool calls.

SDD reporting BLOCKED is not answered from config. It parks.

`--tasks` is `<n>` from the `plan complete → <path> (<n> tasks)` ledger entry —
the count the plan actually wrote, not the tier the brainstorm declared. At
exactly 1 the composed definition instructs SDD to run one whole-branch
`final_review` and skip the per-task `task_review` dispatch, because at one
task the two reviewers read the same diff. At 2 or more, and when the flag is
omitted, the dispatch is today's two-stage review. An escalated run therefore
needs no extra plumbing: it has 2 or more tasks and gets both reviews.

Append: `sdd complete (<n> tasks, <k> parked, <f> fix rounds across <t> tasks)`
— for example `sdd complete (10 tasks, 0 parked, 7 fix rounds across 4 tasks)`.
Count a fix round every time a task returns to its implementer after a review
finding; `<t>` is how many distinct tasks needed at least one. Keep the
`sdd complete (` prefix exactly — `nextStage` matches it to resume the run at
`verify`. Without the fix-round clause, a run where every task needed three
rounds renders identically to one where all passed first try, so a struggling
run is invisible at a glance.

### `verify`

Browser-verify the spec's UI acceptance criteria against the branch `sdd` just
finished writing.

This stage runs **after** `sdd` and **before** `learnings`, on the pre-rebase
tree. It does not catch a semantic conflict that rebases clean and breaks the
UI — `land`'s post-rebase `test_command` is still the only gate after landing,
and it sees no pixels. What the placement buys: a failed criterion is a fix on
the working branch in the same run, and `learnings` runs after it and can
distil what the browser saw.

#### Whether to run at all

**Writing a `(ui)` acceptance criterion in the spec turns this stage on.**
There is no flag, no path glob, no auto-detection heuristic, and nothing to
configure.

Read the criteria out of the committed spec:

```bash
node "$AP/scripts/autopilot-verify.mjs" criteria <path-to-spec>
```

It prints the parsed criteria and a `ui` count, and exits non-zero when the
spec has no `## Acceptance criteria` section or an item is untagged. Then:

| Condition | Action |
|---|---|
| `ui` count is 0 | Run the `skip` subcommand below, append `verify: skipped (no ui criteria)`, and go to `learnings` |
| `(ui)` criteria and a usable `recipe.json` | Run |
| `(ui)` criteria, no usable `recipe.json` | **Park** — `PARKED — verify cannot run: <reason>` |
| `(ui)` criteria, `@playwright/test` absent | **Park** — same line |
| The criteria command exits non-zero | **Park** — the spec cannot state what done means |

Skipping is two steps, not one:

```bash
node "$AP/scripts/autopilot-verify.mjs" skip \
  --run-dir=.superpowers/autopilot/<run>/verify \
  --reason="no ui acceptance criteria"
```

then append `verify: skipped (no ui criteria)`.

Neither step is optional bookkeeping. The `skip` subcommand writes the
`pr-section.md` that the `pr` stage concatenates; without it a skipped run
silently has no section at all. And `nextStage` resumes at `learnings` by
matching an entry starting `verify`, so a stage that skips without appending
its ledger line sends every later resume back through `verify` forever.

A backend repo costs nothing: it writes no `(ui)` criteria and this stage never
speaks. A criterion with no test is a failure, not a pass — a run that declared
UI criteria and could not open a browser must not report success.

#### Running it

Everything needed to execute this stage — the recipe's shape and rules, the
`@playwright/test` prerequisite, and the dispatch — is in
`references/stages/verify-run.md`. **Read it now, before dispatching.** It is
a separate file because a repo whose spec declares no `(ui)` criterion never
reaches this point, and never pays for it.

#### Outcomes

The script's exit code says which kind of failure this is, because they earn
different responses:

| Exit | Meaning | Action |
|---|---|---|
| 0 | Every criterion passed | Append `verify: <n>/<n> ui criteria passed` and continue |
| 1 | A criterion failed | One fix round, below |
| 2 | Infrastructure — server never answered, no report produced | **Park.** Not a fix round: the branch was never exercised |
| 3 | No `(ui)` criteria | Skip, as above |
| 4 | Cannot verify despite `(ui)` criteria — no usable recipe, or `@playwright/test` absent | **Park** |

**The fix round.** On exit 1, write the summarized failures — not the raw
report — to a file, compose the fix-round dispatch, dispatch by the printed
path, then re-run the script **with `--round=2`**:

```bash
cat > .superpowers/autopilot/<run>/verify/failures.md <<'EOF'
<the summarized failures>
EOF
node "$AP/scripts/autopilot-dispatch.mjs" verify-fix \
  --run=<run> \
  --host=<host> \
  --config=<config> \
  --worktree=<worktree path> \
  --failing-criteria="AC3, AC5" \
  --failures=@.superpowers/autopilot/<run>/verify/failures.md

node "$AP/scripts/autopilot-verify.mjs" run \
  --config=<config> \
  --run-dir=.superpowers/autopilot/<run>/verify \
  --cwd=<worktree path> \
  --spec=<path-to-spec> \
  --round=2
```

Green continues. Still red parks:
`PARKED — verify red after fix round: <criteria>`.

One round, mirroring `land`'s conflict resolver: one dispatched attempt, then a
human decides. A stage that retries until green tunes the test to the bug.

The flag is not bookkeeping. The first `run` invocation omits it and is round 1;
this re-run must say `--round=2`, or a criterion still red writes a second
finding identical to the first. `2` is the only value it ever takes.

The script appends the findings itself, to
`.superpowers/autopilot/<run>/findings.jsonl` in the **main checkout**, under
the existing seven-field contract — `task`, `round`, `severity`,
`stage_at_fault`, `pattern`, `detail`, `verdict` — with `task: 0` as the
sentinel for "not a numbered SDD task", and `{"task": 0, "clean": true}` when
every criterion passed. This stage can only ever emit `implementation`. Invent
no new value — and in particular no `verify` value: the field names the stage
that produced the bad input, never the stage that surfaced it. Do not append
these lines yourself; the script has already written them.

Append: `verify: <n>/<n> ui criteria passed`.

#### Screenshots

When the project's `.claude/autopilot.json` carries an `artifacts` block, the
`run` subcommand also uploads one screenshot per UI criterion to the configured
bucket and writes `verify/artifacts/uploads.json`. Nothing is dispatched and
nothing is configured at this stage: the script does it, and the
criterion-to-image mapping is derived from Playwright's JSON report, never from
the agent — which is why the browser-verification contract's rule 4 still
stands untouched.

When it cannot — an unreadable env file, a missing credential, a failed upload —
the run **does not park**. The section degrades to its text-only form and the
script prints one extra line:

```
upload: skipped — <reason>
```

Append `verify: screenshot upload skipped — <reason>` when, and only when, that
line is printed. Place it immediately **after** this stage's own `verify:`
entry — or, when the stage is parking, immediately **before** the
`PARKED — <reason>` entry, in the same step. `PARKED` must stay the ledger's
last entry, or `nextStage` stops returning `parked` and a parked run reads as
resumable.

A repository with **no `artifacts` block at all** is not a failed upload: the
script prints no such line, so there is none to append. Its ledger, its PR body
section and its issue comments are exactly what they were before screenshots
existed — that is the point, and it needs no feature flag.

### `learnings`

Dispatch the `learnings` role to rewrite `docs/autopilot/learnings.md` inside
the worktree and commit it. This is the one artifact the pipeline both writes
and reads: `sdd` and `verify` both capture findings, the learnings role
distills them into planning rules, and the next run's `plan` stage reads the
doc.

```bash
node "$AP/scripts/autopilot-dispatch.mjs" learnings \
  --run=<run> \
  --host=<host> \
  --config=<config> \
  --worktree=<worktree path>
```

Dispatch with the selected host protocol.

A `learnings`-stage failure does not park. Log it and continue: append
`learnings failed — <reason>` and proceed to `land`. Only a successful commit
appends `learnings committed → docs/autopilot/learnings.md`, which is what
`nextStage` matches to treat this stage as done.

Append: `learnings committed → docs/autopilot/learnings.md`.

### `land`

Run `node "$AP/scripts/autopilot-land.mjs" <base_ref> | tee .superpowers/autopilot/<run>/land.txt`
from the repository root, capturing its output. The `conflict` outcome below
reuses this capture — re-running the script here would hit a rebase already in
progress and misreport the error as the conflict list.

**If `test_command` is not set, park immediately** — before rebasing. Without
it there is no way to tell a landed branch from a broken one, and the whole
point of this stage is that check. Append
`PARKED — test_command not set in <config>`. Never treat an
absent test command as a pass.

- `clean` — run `test_command`. Green, append
  `rebase clean, tests green (<n> passed)` and continue. Red, park.
- `conflict` — write the conflicted paths to a file, compose the resolver, and
  dispatch by the printed path:

  ```bash
  node "$AP/scripts/autopilot-dispatch.mjs" land-conflict \
    --run=<run> \
    --host=<host> \
    --config=<config> \
    --worktree=<worktree path> \
    --base-ref=<config.base_ref> \
    --conflicts=@.superpowers/autopilot/<run>/land.txt
  ```

  It resolves only what it can reason about confidently and reports anything
  where both sides changed the same logic as unresolved; that parks. Then
  re-run the land script to confirm clean, then run `test_command`. Only green
  continues.
- `error` — park.

The test run after the rebase is not optional. Semantic conflicts rebase
cleanly and still break the branch: task A renames a function, task B adds a
caller of the old name in a file A never touched, git reports nothing, and the
branch is broken. The suite is the only thing that catches this.

### `pr`

```bash
node "$AP/scripts/autopilot-dispatch.mjs" pr \
  --run=<run> \
  --host=<host> \
  --config=<config> \
  --worktree=<worktree path>
```

Dispatch with the selected host protocol. It runs
`superpowers:finishing-a-development-branch`, answering the menu with option 2
(push and create a PR), and handles the push and `gh pr create` itself.

Append `pr: <url>` **first**, then read the timing back out of the ledger —
appending first is what makes the PR entry the last timestamp, so the span
covers the whole run:

```bash
node "$AP/scripts/autopilot-ledger.mjs" timing .superpowers/autopilot/<branch>/run.md
node "$AP/scripts/autopilot-ledger.mjs" duration .superpowers/autopilot/<branch>/run.md
```

`timing` prints a markdown section — the total plus a per-stage table.
`duration` prints just the total, for reporting to your human partner.

Record the timing in the PR description. Read the body the PR was created with,
append to it, and edit the PR — never replace the body, the description written
by `finishing-a-development-branch` is the part a reviewer reads:

```bash
RUN=.superpowers/autopilot/<branch>
gh pr view <url> --json body --jq .body > "$RUN/pr-body.md"
if [ -f "$RUN/verify/pr-section.md" ]; then
  printf '\n\n' >> "$RUN/pr-body.md"
  cat "$RUN/verify/pr-section.md" >> "$RUN/pr-body.md"
fi
printf '\n\n' >> "$RUN/pr-body.md"
node "$AP/scripts/autopilot-ledger.mjs" timing "$RUN/run.md" >> "$RUN/pr-body.md"
gh pr edit <url> --body-file "$RUN/pr-body.md"
```

The verification section is written by the `verify` stage, in both the passing
and the skipped case, so this stage formats nothing — it concatenates. A run
whose `verify` stage never wrote one (an older run resumed, say) simply has no
section, which is why the `cat` is guarded.

Screenshots reach the PR through a URL, not through the repository. When the
project configures an `artifacts` block, the `verify` stage has already uploaded
one image per UI criterion and written `verify/artifacts/uploads.json`, and the
section it wrote already carries a `Screenshot` column built from that manifest
— so this stage still concatenates and still formats nothing. With no manifest,
the section renders exactly as it always has: text-only, naming the local
artifact path. Traces are never uploaded. They are a debugging artifact for a
human at a terminal, and they stay local.

An r2.dev public development URL is **world-readable**. Anything visible in a
verified screenshot — seeded user data, an internal admin surface, a staging
banner — is public to anyone with the link. That is an acceptable trade for a
bucket seeded with fixture data and an unacceptable one for a bucket that ever
sees production screens, so point `artifacts` at the former.

Last, audit the run's own session sizes:

```bash
node "$AP/scripts/autopilot-session.mjs" check .superpowers/autopilot/<branch>/run.md
```

Exit 0 means every session handed off before its cap. Non-zero names the stages
that ran over — **report them to your human partner, do not park.** The work is
already pushed, and the finding is about how the run was executed rather than
whether its output is sound.

The body file goes in the run directory, not `/tmp` — it is scoped to this
branch, so two runs finishing at once cannot overwrite each other's PR body.

If the `gh pr edit` fails, do not park — the PR exists and the branch is green.
Report the timing in your summary instead and say the description could not be
updated.

Report the URL and the duration together:

```
PR: <url>
Run duration: <formatted duration> (<n> stages)
```

This measures the ledger's first entry to its last, so it starts at
`started (phase 1)` and excludes preflight. Say "excludes preflight" when
reporting, rather than presenting the number as the complete wall-clock time.

## Parking

Nine conditions park a run. Write the reason to the ledger, tell your human
partner plainly that the run needs a decision, and stop.

- SDD reports BLOCKED — the round-5 breaker on a load-bearing finding
- Rebase conflicts the resolver will not take confidently
- Tests red after rebase
- `test_command` not set, so the branch cannot be verified
- The spec carries no usable `## Acceptance criteria` section
- UI criteria were declared but cannot be verified — no usable verify recipe,
  or `@playwright/test` is absent
- Browser verification infrastructure failed — the dev server never answered,
  or Playwright produced no report
- UI criteria still failing after the one fix round
- `gh pr create` fails

Never retry autonomously. Never push a red branch. Never resolve a load-bearing
ambiguity by guessing.

Append: `PARKED — <reason>`. Use that exact prefix — uppercase `PARKED`
followed by an em-dash. `nextStage` detects a parked run by matching `PARKED`
at the start of the ledger's last entry; any other wording silently breaks
resume detection, and a later `/autopilot resume` will drive the run straight
past the park.

Report elapsed time alongside the park reason — append the `PARKED` entry
first, then run the `duration` command from the `pr` stage against the same
ledger. There is no PR to record it in, so the ledger and your summary are the
only places it lands.

Parking behaves the same whether or not Remote Control is connected. If it is,
your human partner gets a push notification; if not, they read the ledger.
Never check for it, never wait on it.

## Common Rationalizations

| Excuse | Reality |
|---|---|
| "The spec is approved, I can skip preflight" | Preflight runs before the brainstorm. A missing skill gets improvised into plausible output that skipped the process. |
| "I'll read the plan to check the work" | Stage outputs stay in files. Reading them into your context is what causes the compaction this design defends against. |
| "I'll peek at the definition before dispatching" | The script already composed it. Reading the file spends exactly the context the script exists to save, and there is nothing in it you can act on. |
| "The script errored, but I know what the prompt should say — I'll write it" | A hand-written prompt is a different contract. A stage dispatched without its contract produces plausible work that skipped the process, and reports success. |
| "I'll paraphrase the contract into the prompt, it's shorter" | You do not write the prompt. `autopilot-dispatch.mjs` does, from verbatim fragments, because their exact phrasing is what binds. |
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
| "The tests are green, so the feature works" | The suite proves the code does what the code says. A UI criterion is verified by opening it. That is what `verify` is for. |
| "No verify recipe, so I'll just start the dev server myself and look" | A hand-started server holds the port after the run and makes the next one look broken. No `(ui)` criteria skips; a `(ui)` criterion with no recipe parks. |
| "Verification failed but I can see the fix — I'll patch it here" | Controller fixes skip review. The fix round is a dispatch, and there is exactly one. |
| "One criterion has no test, but everything that ran passed" | Not covered is not passed. An uncovered criterion is this stage failing to do its job, and it is weighted as a failure. |
| "I'll snapshot the page to find the right selector" | The run wrote the component. Read it. A full-page dump costs more context than the whole stage budget. |
| "The design has a gap — I'll present it and ask" | A gap is a missed clarifying question, and the questions are still open while the brainstorm runs. Ask it there. Once the brainstorm hands back, Phase 2 owns the run. |
