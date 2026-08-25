PLAN STAGE — invoke `superpowers:writing-plans` against the approved spec and
return the plan path plus the task count.

Run: {{run}}
Worktree (work only here): {{worktree}}
Approved spec: {{spec_path}}

Read the spec first. It is the authority on what to build; do not redesign it.

Answer `writing-plans`' execution-choice question with `subagent-driven` — do
not ask.

Harness note: the Write tool is blocked in this worktree. Use Bash heredocs
(`cat > path <<'EOF'`) to create files.

Return under 15 lines: the plan path and the number of tasks. Do not paste the
plan back.
