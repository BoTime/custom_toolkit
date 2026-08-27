# Brainstorm question capture

**Date:** 2026-08-26
**Status:** Approved design, ready for planning
**Issue:** #34

## Problem

Autopilot's Phase 1 is the only stage that needs a human. Every clarifying
question the brainstorm asks marks context the pipeline could not find on its
own — in the task description, in the repo, in `CLAUDE.md`, or in config.

Today those questions live only in the conversation. They never reach the
ledger, so there is no way to see which ones recur — and therefore no way to
know what standing context would let a future run answer itself.

This design captures the questions into a per-run corpus and clusters that
corpus into candidate standing context, mirroring the review-findings loop the
pipeline already has (`#6`): capture, then cluster into rule candidates,
pointed at Phase 1 instead of Phase 3.

## The artifact

`.superpowers/autopilot/<run>/questions.jsonl`, in the **main checkout**,
beside `run.md` and `findings.jsonl`.

The placement is not incidental: the file must exist before the worktree does
(Phase 1 precedes `setup`) and must survive the reaper, which deletes
worktrees after merge.

One JSON object per line, five fields:

- `seq` — positive integer, 1-based within the run, the order asked
- `question` — the clarifying question as asked
- `answer` — the answer the human gave
- `answer_source` — a closed enum, below
- `pattern` — a short canonical phrase; the clustering key

There is no `run` field. The run is the directory name, exactly as
`collectCorpus` already attributes findings.

## `answer_source`

The enum names where the answer *should* have lived — not what the question
was about:

| Value | Meaning |
|---|---|
| `task` | The issue or task description could have stated it |
| `repo` | Discoverable by reading code, docs, or tests already present |
| `claude_md` | A project convention that belongs in `CLAUDE.md` |
| `config` | A key in `.claude/autopilot.json` |
| `judgment` | Genuine human preference; no artifact could have supplied it |

`judgment` is the load-bearing value. A recurring judgment question is not a
defect and must never be proposed as something to fix — proposing it would
push the pipeline toward guessing at product decisions. But it must still be
recorded, because without it the corpus has no denominator: a run that asked
two answerable questions is indistinguishable from one that asked two
answerable and twenty judgment calls, and "are we needing the human less?"
stops being measurable.

`pattern` follows the same discipline as the findings contract's field of the
same name: a short phrase, reused verbatim across runs when the gap is the
same kind, with specifics left to `question` and `answer`. Clustering is a
pure lexical match, so a phrase reworded per question clusters with nothing.

## Capture

A new script, `plugins/autopilot/scripts/autopilot-questions.mjs`, with a
`capture` subcommand:

```
node autopilot-questions.mjs capture \
  --run-dir=<dir> --questions=@<path-to-json-array>
```

It reads a JSON array, validates every element — all five fields present and
non-empty, `answer_source` in the enum, `seq` a positive integer — and appends
one line per element to `<run-dir>/questions.jsonl`.

Validation is **all-or-nothing**: on any bad element it writes nothing and
exits non-zero, naming the offending index and field. A half-landed batch
would be worse than no batch, because the missing lines are invisible
afterwards.

Capture happens **once, in a single batch, at the handoff** — not per
question. The interactive phase stays as fast as it is today. The trade this
accepts, deliberately: a brainstorm interrupted before the handoff records
nothing.

The contract lives in `autopilot/SKILL.md`'s `## Phase 1` section, which is
where `<run>` is already known and where `design approved` is already
appended. The order is fixed: write the batch JSON with a quoted heredoc, run
`capture`, then append `design approved`. Capture before the ledger entry, so
a resume that lands at `setup` never re-captures — the same idempotency rule
every other stage follows.

**A capture failure never parks.** It appends
`questions capture failed — <reason>` to the ledger and the run continues,
mirroring the `learnings` stage. The run's product is the pull request; a
missing question log is a reporting defect.

`autopilot-brainstorm/SKILL.md` is not modified. Its header explicitly sets
out to keep the fork free of autopilot-specific coupling, and the run
directory is autopilot's concern, not the brainstorm's.

## Report

The same module carries pure functions mirroring `autopilot-findings.mjs`,
with file access injected so the logic is testable without a fixture tree:

- `parseQuestions(contents)` → `{ questions, malformed }`. Tolerant per line:
  a truncated or interleaved write costs that line, never the file.
- `collectQuestionCorpus(root, deps)` → walks each run directory for
  `questions.jsonl`. A missing file is a run with no questions, which every
  run predating this feature is — not an error.
- `clusterQuestions(entries)` → clusters on `(answer_source, pattern)`,
  sorted count-descending with an `(answer_source, pattern)` tiebreak so
  repeated runs over an unchanged corpus print identical output. Each
  occurrence carries run, seq, question, and answer.
- `summarize(entries)` → totals: questions, runs, judgment count, answerable
  count.
- `candidates(clusters, threshold)` → clusters at or over the threshold,
  **filtered to answerable sources**. `judgment` is excluded here, by
  construction rather than by a caller-supplied flag.
- `formatQuestionSection(...)` → the markdown section.

The threshold reuses the existing `findings_threshold` config key (plugin
default 2). No new key: there is no evidence yet that the two corpora want
different thresholds, and the project's config philosophy is to add a key only
when a default cannot serve.

## Command

`plugins/autopilot/commands/autopilot-findings.md` gains a second report
invocation and a second walkthrough section. Output order:

1. the existing review-finding candidates, unchanged;
2. a one-line summary —
   `Brainstorm questions: N across R runs — J judgment, A answerable`;
3. `## Missing-context candidates`, one entry per qualifying cluster, each
   printing its full evidence (run, seq, question, answer). The evidence is
   the point: a bare count gives the reader nothing to judge.

Approved candidates append to the existing `.superpowers/autopilot/rules.md`,
each recording the `answer_source`, the pattern, and a one-line count of the
evidence. The existing rules hold unchanged: nothing is written without an
explicit yes, and no approved candidate is ever injected into a stage prompt
automatically.

## Error handling

- Capture validation failure: nothing written, non-zero exit naming the index
  and field. The orchestrator logs and continues.
- Malformed corpus lines at report time: counted and skipped, and the report
  states that counts are a floor — the convention `formatReport` already uses.
- Empty corpus: the section says so plainly rather than printing an empty
  heading.

## Testing

Follows the split the repo already uses:

- `autopilot-questions.test.mjs` — the pure functions with injected deps:
  validation accepts and rejects, the all-or-nothing append, the clustering
  key and its determinism, `judgment` absent from candidates but present in
  the summary, threshold filtering, malformed tolerance, and a corpus walk
  over a run whose `questions.jsonl` is missing.
- `autopilot-questions-contract.test.mjs` — asserts that `autopilot/SKILL.md`
  Phase 1 carries the capture contract (script invocation, ordering relative
  to `design approved`, and the never-park rule) and that
  `commands/autopilot-findings.md` documents the questions section, read via
  `skill-sections.mjs` the way the existing contract tests do.

Per `CLAUDE.md`, no test asserts a version literal.

## Out of scope

- Automatic injection of approved candidates into stage prompts. As with the
  review-findings loop, an approved candidate is recorded for later, never
  wired into a prompt.
- Any modification of `autopilot-brainstorm/SKILL.md`.
- A new config key for the question threshold.

## Acceptance criteria

- AC1 (non-ui) — `autopilot-questions.mjs capture --run-dir=<dir>
  --questions=@<file>` appends one JSON line per array element to
  `<run-dir>/questions.jsonl`, each line carrying exactly `seq`, `question`,
  `answer`, `answer_source`, and `pattern`, and no `run` field
- AC2 (non-ui) — capture validates every element (five fields present and
  non-empty, `answer_source` one of `task`, `repo`, `claude_md`, `config`,
  `judgment`, and `seq` a positive integer) and on any invalid element writes
  nothing at all and exits non-zero with a message naming the offending index
  and field
- AC3 (non-ui) — capture appends to an existing `questions.jsonl` rather than
  truncating it, so a run directory that already holds lines keeps them
- AC4 (non-ui) — `parseQuestions(contents)` returns `{ questions, malformed }`,
  skipping and counting an unparseable line while still returning every valid
  line in the same file
- AC5 (non-ui) — `collectQuestionCorpus(root, deps)` attributes each entry to
  its run by directory name and treats a run directory with no
  `questions.jsonl` as a run with zero questions, not an error
- AC6 (non-ui) — `clusterQuestions(entries)` clusters on the
  `(answer_source, pattern)` pair, sorts count-descending with an
  `(answer_source, pattern)` tiebreak, and produces identical output on
  repeated runs over an unchanged corpus
- AC7 (non-ui) — each cluster carries every occurrence's run, seq, question,
  and answer as evidence
- AC8 (non-ui) — `summarize(entries)` reports total questions, total runs,
  judgment count, and answerable count, with `judgment` entries included in
  the totals
- AC9 (non-ui) — `candidates(clusters, threshold)` returns only clusters whose
  count is at or above the threshold and excludes `answer_source: judgment`
  unconditionally, with no caller-supplied flag able to include it
- AC10 (non-ui) — the question threshold reads from the existing
  `findings_threshold` config key (plugin default 2); no new config key is
  introduced
- AC11 (non-ui) — `autopilot/SKILL.md` Phase 1 documents the capture contract:
  the `autopilot-questions.mjs capture` invocation, capture ordered strictly
  before the `design approved` ledger entry, and the rule that a capture
  failure appends `questions capture failed — <reason>` and continues the run
  rather than parking it
- AC12 (non-ui) — `autopilot-brainstorm/SKILL.md` is unchanged by this work
- AC13 (non-ui) — `commands/autopilot-findings.md` documents a second report
  invocation whose output is ordered: existing review-finding candidates
  first, then the one-line summary
  `Brainstorm questions: N across R runs — J judgment, A answerable`, then a
  `## Missing-context candidates` section printing each qualifying cluster's
  full evidence (run, seq, question, answer)
- AC14 (non-ui) — approving a candidate appends to the existing
  `.superpowers/autopilot/rules.md`, recording the `answer_source`, the
  pattern, and a one-line count of the evidence; nothing is written without an
  explicit yes, and no approved candidate is injected into a stage prompt
- AC15 (non-ui) — with malformed lines in the corpus, the report counts and
  skips them and states that the counts are a floor
- AC16 (non-ui) — with an empty corpus, the report states so plainly rather
  than printing an empty heading
- AC17 (non-ui) — `autopilot-questions.test.mjs` covers validation accept and
  reject, the all-or-nothing append, the clustering key and its determinism,
  `judgment` absent from candidates but present in the summary, threshold
  filtering, malformed tolerance, and a corpus walk over a run missing
  `questions.jsonl`, using injected file-access deps rather than a fixture
  tree
- AC18 (non-ui) — `autopilot-questions-contract.test.mjs` reads sections via
  `skill-sections.mjs` and asserts both the Phase 1 capture contract and the
  documented questions section in `commands/autopilot-findings.md`
- AC19 (non-ui) — no test added by this work asserts a version literal, per
  `CLAUDE.md`
