---
name: phase-review
description: Our rules for having finished work reviewed by another agent - the simplify pass and the code review that a Claude Code session runs over a phase of a plan or a finished change (when to start them, the scope and context to give, how the result comes back, which findings reach the user). Use when a plan or the user asks for a review, a `/simplify` or a `/code-review` of work just done, when a phase of a plan is finished, before starting a reviewer agent, and when sorting a reviewer's findings. Starting and watching the reviewer's terminal follows the `herdr` skill.
---

# Phase review

A reviewer is a Claude Code session that runs `/simplify --fix` or `/code-review <effort> --fix` on finished work, in
a terminal started as the `herdr` skill says.

## When, and on what

- One simplify pass and one code review per phase of a plan, each over the whole phase: never one per commit, per
  file or per module. Each reviewer rebuilds the same context, a narrow one cannot fix what it finds next to its
  files, and what is duplicated across modules only shows over the whole phase.
- Commit the phase first and give the reviewer its commit range, so that the reviewer's edits are the only
  uncommitted changes when it ends. Its edits mixed with yours cannot be told apart afterwards.
- Phases in different repositories do not depend on each other: start their reviewers together, and start the next
  phase while they run.

## What the reviewer is given

- The plan's path and the sections that hold its decisions and this phase. A reviewer given only a list of files
  questions decisions that are already taken.
- The commit range, the command that runs the tests, and a file scope that includes the tests of every file in it.
- How to end: it sends its report to your terminal with `hc send`. That message is the event that resumes you; a
  reviewer that looks idle is not finished, and is never stopped or started again for that reason.
- No copy of the rules it loads by itself (the global `AGENTS.md`, the repository's `CLAUDE.md`).

## Its findings

- A finding you can show (a failing run, or the lines that are wrong) and that breaks something is fixed, test
  first when it changes behaviour.
- The user is asked only about a finding that needs their decision: say in one or two plain sentences what goes
  wrong, in which real situation, and what you recommend. A finding that needs a situation the user's setup never
  meets is dropped, not reported.
