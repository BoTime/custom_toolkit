Write the plan yourself, inline. This run is tier `small`: the plan is a
scratch document, not a repository artifact, and no planning sub-skill runs.

Write to `{{plan_path}}` — an absolute path in the main checkout's run
directory, outside the worktree — a single-task plan of roughly 20 to 40 lines
carrying exactly four things:

1. The files the task touches, each with what changes in it.
2. The change itself, in a few sentences.
3. The test to add, named by file and by what it asserts.
4. Which acceptance criteria the task satisfies, by AC id.

Do not commit it, and do not modify any tracked file in the worktree.

Escalate once, and only if the work genuinely cannot be one reviewable diff.
Escalation moves this plan to tier `standard`; write the tasks the work needs
up to that tier's ceiling and no further, in this same inline shape.
Escalation happens at most once in a run and never moves more than one step.
Report it in two places: open the plan with an `## Escalation` heading naming
the reason, and say `escalated to standard: <reason>` in your return line. The
orchestrator records it in the ledger, and the run continues with these same
scratch documents — nothing is promoted, rerun or committed.
