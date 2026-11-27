# Starting several things at once

- A project's gates (its lint, typecheck, test and build commands) do not depend on each other: start them together,
  one terminal each, never one after the other.
- Mind the load you put on the machine, which also runs the user's own work. Before starting several heavy processes
  (gates, dev servers, agents), look at what already runs (`hc ls`) and start no more than the machine can carry.
- When a process is killed for lack of memory, the machine swaps, or a command that was fast times out, stop adding
  work, tell the user and offer to investigate the cause, instead of retrying.
