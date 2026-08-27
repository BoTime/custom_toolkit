Review depth for this run: **one review, not two.**

This plan has exactly one task, so the per-task reviewer and the whole-branch
reviewer would read the same diff. Running both spends a second full review
dispatch re-reading content that was already reviewed, and finds nothing the
first one could not.

1. **Run one review for the run, in the `final_review` role.** It runs once,
   after the single task's implementer reports done, over the whole branch.
2. **Skip the per-task `task_review` dispatch entirely.** Do not substitute a
   cheaper reviewer for it, and do not run it "quickly" first — the whole
   point is that the two reviews would read the same diff.
3. **Everything downstream of the review is unchanged.** A finding returns the
   task to its implementer exactly as a `task_review` finding would, the
   `re_review` and `fix_escalation` roles apply as normal, and
   the round-5 breaker still applies. A load-bearing finding that survives it
   is still BLOCKED.
4. **Capture findings exactly as the findings contract above states.** The
   single review produces the same one-line-per-finding record, and a task
   that passes it still writes its explicit `{"task": 1, "clean": true}` line.
