SPEC STAGE — write the approved design into a spec file inside the worktree and
commit it. This is the run's first commit.

Run: {{run}}
Worktree (work only here): {{worktree}}
Branch: {{branch}}
Spec path: {{spec_path}}

{{criteria_source}}

Write the spec to `{{spec_path}}` **inside the worktree** and commit it there.
Do not write it into the main checkout, and do not open a pull request.

Harness note: the Write tool is blocked in this worktree. Use Bash heredocs
(`cat > path <<'EOF'`) to create files.

The approved design this spec must carry:

{{design}}

Return one line: the spec path. Do not paste the spec back.
