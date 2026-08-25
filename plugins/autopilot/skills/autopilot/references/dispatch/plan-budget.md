Task-count budget for this plan:

1. **Scale task count to complexity — 1 to 5 tasks.** A change confined to
   one module, satisfying one acceptance criterion, is ONE task — not three.
   Five is for work that genuinely spans separate subsystems. Every task
   costs a serial implementer dispatch plus a review round, so task count
   multiplies the run's wall clock directly.
2. **Merge trivially-coupled steps into one task.** Two steps belong together
   when one cannot be reviewed or tested without the other — a function and
   its only caller, a field and the migration that adds it. Splitting those
   buys no reviewability and costs a full dispatch cycle.
3. **Do not merge steps that touch unrelated subsystems, and do not pad or
   compress to hit a number.** A task that cannot be reviewed as one diff is
   two tasks; a task invented only to fill the range is not a task.
   Correctness outranks the budget in both directions.
4. **If the work genuinely needs more than 5 tasks, write them** and say why
   in the plan. This is a budget, not a cap.
