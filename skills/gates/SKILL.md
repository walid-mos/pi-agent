---
name: gates
description: Our rule for running a project's gates - the lint, typecheck, test and build commands that say whether a change may be committed, pushed or opened as a pull request. Use when the development of a change is finished, when running a project's lint, typecheck, tests or build to check a change, before a commit, a push or a pull request, and when a skill or a plan says "run the gates", even for a one-line change. Which gates a project has is that project's own matter.
---

# Gates

A project's gates are the commands that decide whether a change may go on: its lint, typecheck, tests and build.
Which ones a project has, and their commands, come from the project (its `AGENTS.md`, its skill, its scripts).

- Run the gates once the development of a change is finished, on its final code, before it is committed or handed
  over. They validate one part of the code's quality (its form, its types, what the tests cover): green gates do not
  show that the change does what was asked.
- Start a project's gates together, never one after the other: they do not depend on each other, so running them in
  turn only adds their durations.
- They are slow commands: run them as the `herdr` skill says, which also says how much to start at once on this
  machine.
