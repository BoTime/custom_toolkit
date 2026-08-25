SDD STAGE — run `superpowers:subagent-driven-development` against the plan.

Run: {{run}}
Worktree (work only here): {{worktree}}
Plan: {{plan_path}}

Answer these gates from this prompt rather than asking — the run is unattended:

| Gate | Answer |
|---|---|
| `writing-plans` execution choice | `subagent-driven` |
| SDD pre-flight plan-conflict scan | Resolve; report each resolution in your final line |
| SDD plan-vs-review contradiction | Plan governs; report it |

A load-bearing finding that survives the round-5 breaker is the one thing you
do not answer yourself: report BLOCKED and stop.

Return one line:
`sdd complete (<n> tasks, <k> parked, <f> fix rounds across <t> tasks)` — for
example `sdd complete (10 tasks, 0 parked, 7 fix rounds across 4 tasks)`. Count
a fix round every time a task returns to its implementer after a review
finding; `<t>` is how many distinct tasks needed at least one. Without the
fix-round clause, a run where every task needed three rounds renders
identically to one where all passed first try, so a struggling run is invisible
at a glance.
