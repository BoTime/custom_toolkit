Task-count budget for this plan — tier `small`.

The ceiling for this plan is **{{ceiling}}**. Write no more tasks than that.

1. **Prefer one reviewable diff.** The brainstorm classified this work as
   `small`: confined to one module, satisfying one acceptance criterion.
   Every task costs a serial implementer dispatch plus a review round, so
   task count multiplies the run's wall clock directly.
2. **Merge trivially-coupled steps into one task.** Two steps belong together
   when one cannot be reviewed or tested without the other — a function and
   its only caller, a field and the migration that adds it. Splitting those
   buys no reviewability and costs a full dispatch cycle.
3. **Escalate once, and only if the work genuinely cannot be one reviewable
   diff.** Escalation moves this plan to tier `{{next_tier}}`, whose ceiling
   is **{{next_ceiling}}**. Write the tasks the work needs up to that number
   and no further. Escalation happens at most once in a run and never moves
   more than one step: a plan that believes this work needs
   more than {{next_ceiling}} tasks writes {{next_ceiling}} and says so.
4. **Report an escalation in two places.** Open the plan with an
   `## Escalation` heading naming the reason, and say
   `escalated to {{next_tier}}: <reason>` in your return line. The
   orchestrator records it in the ledger. A misclassification is a
   measurement, not a failure — it costs a ledger line and nothing else.
5. **Correctness outranks the budget in both directions.** A task that cannot
   be reviewed as one diff is two tasks; a task invented only to fill the
   ceiling is not a task.
