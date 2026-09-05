PLAN STAGE — turn the approved spec into an implementation plan and return the
plan path plus the task count.

Run: {{run}}
Worktree (work only here): {{worktree}}
Approved spec: {{spec_path}}
Plan path: {{plan_path}}

Read the spec first. It is the authority on what to build; do not redesign it.

Harness note: the Write tool is blocked in this worktree. Use Bash heredocs
(`cat > path <<'EOF'`) to create files.

Return under 15 lines: the plan path and the number of tasks. Do not paste the
plan back.
