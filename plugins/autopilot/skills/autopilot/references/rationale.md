# Why the autopilot skill is worded the way it is

`SKILL.md` is loaded into the orchestrator's context for the whole of every
run, so it says what to do and little else. This file holds the reasoning
behind the rules that are non-obvious — the run data, and the specific
failures each rule was written against.

**Read this when editing the skill. Do not read it during a run.** Nothing
here changes what any stage does; a rule and its justification are only ever
needed by different readers at different times.

The rule of thumb for where a sentence belongs: if removing it would change
what an agent *does*, it belongs in `SKILL.md`. If removing it would only make
a future editor think a rule was arbitrary and delete it, it belongs here.

---

## Task-count budget (`plan`)

Task count is the single largest driver of a run's wall-clock time. `sdd` is
~66% of every run measured, and it costs a near-constant 3–12 minutes per task
because `subagent-driven-development` forbids parallel implementer dispatch, so
tasks run strictly serially.

Measured across real runs:

| Tasks | Wall clock |
|---|---|
| 5 | 17–23m |
| 10 | 80m |
| 16 | 191m |

Nothing else in the pipeline moves the total that far, which is why the budget
belongs at the stage that sets the multiplier rather than anywhere later.

**Rule 3 is load-bearing in both directions.** A bare instruction to emit fewer
tasks produces oversized tasks whose diffs defeat task review, converting a
wall-clock saving into fix rounds that cost more than the tasks saved. And a
range with a low end still reads as a number to reach, which produces tasks
invented to fill it — a full dispatch cycle plus a review round spent on work
no acceptance criterion asked for.

## Minimalism ladder (`plan`) and minimalism contract (`sdd`)

Two separate instruments, deliberately not collapsed. The plan ladder governs
**which tasks are worth planning**; the sdd contract governs **how code gets
written**. Collapsing them loses one.

The plan ladder's rung 6 ("correctness outranks minimalism") mirrors the
budget's rule 3 for the same reason that rule exists: an unqualified
instruction to plan less produces oversized, unreviewable tasks.

**In the sdd contract, the scoping instruction is the load-bearing half — not
the ladder.** A reviewer told "the best code is the code you never wrote"
approves under-built work: it reads a thin implementation as discipline rather
than as a gap. Rigor is the entire point of the review roles, and the ladder is
corrosive to it. All three review roles are the same `general-purpose` agent
type as the implementer, so the prompt instruction is the *only* mechanism that
can scope them apart — there is no matcher, no agent name, and no config key
that can do it.

Letting an implementer skip a task it judged unnecessary would desynchronize
the branch from the plan and cause a fix round. Routing the judgment into
`findings.jsonl` instead costs nothing, and the `learnings` stage already
prioritizes findings with `stage_at_fault == "plan"`, so the signal reaches the
one stage that can act on it next run.

`minimalism.mode` defaults to `off`, and `off` emits nothing at all. That is
what makes the feature unable to regress an existing run: the prompt stays
byte-identical to one composed before the key existed.

## Model mapping (`sdd`)

`subagent-driven-development` has no mechanism for accepting an externally
supplied model map. It has its own Model Selection section telling its
controller to choose models by its own judgment, so naming "the roles block" to
it is not an instruction it can act on — the mapping has to arrive as literal
text framed as an override, with the actual values rendered in.

## Verification contract (`sdd`)

Without it the stage agent narrates its own verification into the developer's
transcript: `md5` comparisons before and after a re-run, `echo` separators,
throwaway repositories built to prove a guard fires. Each renders as a tool
call the developer cannot act on.

SDD's implementer prompt already caps what an agent *returns* ("under 15
lines — the detail lives in the report file"); nothing caps the work it
narrates getting there. The contract is that cap.

**Rules 2 and 3 name patterns observed in real runs, and naming them is
load-bearing.** A general instruction to be concise has no purchase on an agent
that believes each individual check is justified.

This reduces transcript noise; it does not eliminate it. SDD's own nested
dispatches run under prompts belonging to
`superpowers:subagent-driven-development`, and their tool calls still render.

## Findings capture contract (`sdd`)

SDD generates review findings and then discards them. Task reports are written
after the fix and describe the corrected state, so they read as success
narratives. In a real repository, ten task reports mentioned not one review
finding, fix round, or rejected verdict. The signal is real — two findings in a
single run were both attributable to the brief rather than the implementer —
but nothing survived to show it.

A general instruction to "log findings" will not bind, which is why the
contract names concrete expected behavior, the same way the verification
contract's rules 2 and 3 do.

The **explicit clean line** (`{"task": N, "clean": true}`) is not optional
bookkeeping. Without it, absence of evidence is indistinguishable from evidence
of absence: occurrence counts become a floor rather than a count, and no
threshold can be trusted.

`stage_at_fault` names the stage that produced the bad input, not the stage
that surfaced it. Framing every finding as a model mistake tunes the wrong
stage.

`pattern` is clustered by pure lexical match, so a phrase rewritten per finding
clusters with nothing.

## `verify` placement

The stage runs after `sdd` and before `learnings`, on the pre-rebase tree. This
is a deliberate trade.

The previous design verified the landed branch, because a semantic conflict can
rebase clean and still break the UI. That risk is real and this placement does
not cover it: the post-rebase `test_command` run inside `land` remains the only
gate after landing, and it sees no pixels.

What the trade buys is worth more. A failed criterion found here is a fix on
the working branch, in the same run, against a tree nobody has rebased and
while the implementation context is still fresh. And `learnings` now runs
*after* `verify`, so it can distil what the browser saw — the strongest
evidence a run produces about whether the spec described the feature
correctly, which previously arrived too late to be distilled at all.

## Browser verification contract (`verify`)

Rules 3 through 5 — never read a full-page DOM or accessibility dump, never
read a screenshot back, never read `results.json` whole — are the difference
between a stage that costs a few thousand tokens and one that compacts mid-run
and starts guessing.

The two parks are the deliberate part of the gating table. A criterion with no
test is a failure, not a pass, so a run that declared UI criteria and then
could not open a browser must not report success. Skipping there would report
green on the exact gap this stage exists to close.

**Autopilot never installs Playwright.** A background `npx playwright install`
on an unattended run downloads hundreds of megabytes into a developer's machine
without asking, and a run that quietly provisions its own tooling is a run
whose green result nobody can reproduce.

The `--round=2` flag is not bookkeeping. Without it, a criterion still red
writes a second finding identical to the first, and the findings clustering
reads one twice-failing criterion as two.

## The recipe

Rederived every run and never committed. A committed recipe is a second copy of
the project's dev setup that drifts the moment someone changes a port or
renames a script — and it drifts silently, because nothing runs it except
autopilot.

Nothing checks the recipe at the moment it is written; a wrong derivation
surfaces as a `verify` park several stages later. That is the accepted cost of
not keeping a hand-maintained copy of facts the repository already states.

`base_url_command` exists rather than a hardcoded port because a worktree-up
script that derives ports from the worktree name and reassigns them when a
block is occupied cannot state its URL in advance, and a static one is wrong on
the second concurrent run.

## The run directory lives in the main checkout

Two reasons, both structural:

1. It exists before the worktree does — `started (phase 1)` and
   `design approved` are appended during Phase 1, and `setup` creates the
   worktree after them.
2. It must survive the worktree — the reaper deletes worktrees after merge, and
   a ledger inside one destroys the record of every completed run, including
   the PR URL that `nextStage` returns `done` on.

The harness constraint that forces Bash appends (a worktree-isolated session
cannot Write or Edit files in the main checkout, though `>>` and reads work) is
recorded in `SKILL.md` itself so it is not rediscovered mid-run.

## No design-approval gate

The clarifying questions inside the brainstorm are where the human steers, so a
proceed-check after the handoff adds nothing but a second pass over the same
answers — exactly the handoff friction Phase 2 exists to remove.

A gap in the design is a missed clarifying question, and the questions are
still open while the brainstorm runs. That is the escape hatch; without one, an
agent facing real ambiguity reinvents the gate to resolve it.

## Dispatch fragments live in `references/dispatch/`

The verbatim prompt text each stage sends to its subagent used to sit inline in
`SKILL.md`. That cost the orchestrator the same ~10 KB twice: once reading the
skill, and again writing the text out into the subagent definition.

Keeping the fragments as files and appending them with `cat` costs zero — the
text travels from the plugin directory into the prompt without passing through
the orchestrator's context. This is also why `SKILL.md` tells the orchestrator
not to read, summarize, or paraphrase a fragment: reading one spends exactly
the context the arrangement exists to save, and rewording it produces a
different contract.

The contract tests follow the same route. `scripts/skill-sections.mjs` resolves
the reference files a section names before asserting on it, so a rule that
moved out of `SKILL.md` is still proven to reach the dispatched agent — and a
wrong path, a deleted fragment, or a dropped `cat` line now fails loudly.
