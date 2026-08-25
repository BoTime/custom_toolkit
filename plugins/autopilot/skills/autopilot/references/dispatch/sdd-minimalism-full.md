5. **Prefer the diff that removes lines.** Where two implementations both
   satisfy the task, take the one with fewer files, fewer exports and fewer
   branches. Deleting a code path the task makes dead is part of the task,
   not a separate cleanup.
6. **No config key, flag or extension point without a named present-day
   consumer.** Every knob is a permanent branch in behavior and a permanent
   line in the test matrix.
7. **No speculative error handling** for conditions the code as written
   cannot reach.
