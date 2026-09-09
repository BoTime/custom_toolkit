Do not use `subagent-driven-development`'s waiting rule ("when idle, wait in
bounded stretches of five to ten minutes"). Never run `sleep`, a
`while … sleep` loop, a Monitor, or any other blocking wait to wait on a
dispatched child.

A child's result reaches you one of two ways, and neither needs a wait. If the
dispatch returns the result synchronously, there is nothing to wait for. If the
host runs the child in the background and delivers its completion as a
notification, that notification is only delivered when you are not inside a
tool call — a blocking wait swallows it until the wait expires, so a bounded
stretch always runs to its full length. When you have dispatched a child and
have no local work left, end your turn. The notification re-invokes you.

The run that produced this rule lost 30 of its 48 SDD minutes this way: four
dispatches, each followed by a 550-second sleep loop, each child already
finished minutes before the loop let go.
