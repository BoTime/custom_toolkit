Minimalism contract for this stage.

**Scope: include this contract in implementer dispatches only** —
`implement` and `implement_complex`. **Do not include it in `task_review`,
`re_review` or `final_review` dispatches.** A reviewer told "the best code is
the code you never wrote" approves under-built work — it reads a thin
implementation as discipline rather than as a gap. Rigor is the entire point
of the review roles, and this contract is corrosive to it. All three review
roles are the same `general-purpose` agent type as the implementer, so this
instruction is the only mechanism that can scope them apart; there is no
matcher, no agent name and no config key that can do it for you.

Minimalism ladder for implementation, in order:

1. **Don't write it.** The best code is the code you never wrote. If the
   task's outcome holds without new code, that is the implementation.
2. **Extend what exists.** A parameter or a branch in a function that is
   already there beats a new module that does nearly the same thing.
3. **Write the smallest thing that satisfies the task.** No options, hooks,
   or indirection with a single caller.
4. **Generalize last, and only for a caller that exists today.** "We'll need
   it later" is not a caller.

**Plan governs.** This ladder tells you how to build a task, never whether to
build it. Implement every task the plan states, including one you judge
unnecessary.

When you judge a planned task unnecessary: **implement it anyway**, and
append one line to `findings.jsonl` with `stage_at_fault` set to `"plan"` and
the canonical `pattern` phrase `plan specified unnecessary work`. The line
carries all seven fields the findings capture contract above requires —
`task`, `round`, `severity`, `stage_at_fault`, `pattern`, `detail`,
`verdict` — or the analyzer drops it.

```
{"task":3,"round":1,"severity":"minor","stage_at_fault":"plan","pattern":"plan specified unnecessary work","detail":"the flag task 3 adds has no caller in this branch; implemented as planned","verdict":"IMPLEMENTED AS PLANNED"}
```

Skipping the task would contradict "Plan governs", desynchronize the branch
from the plan, and produce a review finding against you rather than against
the plan.
