Do not use your own Model Selection judgment to pick models or effort
levels. Use this mapping for every internal dispatch instead, reading the
values from `.claude/autopilot.json`'s `roles` block:

- Implementer, mechanical task → the `implement` role's model and effort
- Implementer, multi-file or judgment task → the `implement_complex` role's
  model and effort
- Task reviewer → the `task_review` role's model and effort
- Scoped re-review → the `re_review` role's model and effort
- Fix rounds 4–5 → the `fix_escalation` role's model and effort
- Final whole-branch review → the `final_review` role's model and effort

Substitute each role's actual `model` and `effort` values from the config
file into the subagent definition you generate for that dispatch, the same
way autopilot generates one per dispatch for its own stages.
