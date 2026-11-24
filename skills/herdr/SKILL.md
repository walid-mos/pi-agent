---
name: herdr
description: Drives Herdr - the Herdr App window (spaces, tabs, panes) through herdr-app, and persistent terminals, programs and coding agents through herdr-core (hc), on this machine or another machine of the user. Use when starting, delegating to, watching, messaging or cleaning up agents or long-running programs in terminals, when changing what the user sees in the Herdr window, or when working across the user's machines with hc.
---

# Herdr

Herdr ships its own agent manuals inside its binaries, always matching the installed version. This skill only says
which manual to read and adds our local rules; it never replaces the manuals.

## Read the manual first

Before the first Herdr command of a task, read the relevant manual in full:

- `hc --skill`: herdr-core, persistent terminals, programs and agents (start, read, send, wait, clean up, other
  machines, files). This is the one to use for any work done in a terminal.
- `herdr-app --skill`: the Herdr App window only (spaces, tabs, panes, focus, layout): what the user sees.

If a command is missing or behaves differently from what you expect, read `hc <command> --help` or
`herdr-app commands` rather than guessing. Never rely on a copy of a manual kept elsewhere: it may be outdated.

## Our rules

- **Never install Herdr on another machine.** `hc machine add` is fine to connect a machine where Herdr is already
  installed; `--install` (or any copy of herdr-core to another machine) needs the user's explicit go first.
- Check which machines are connected (`hc machine ls`) before targeting `machine/t…` addresses; do not add or
  remove machines unless asked.
- Name every terminal you start and give it an exact scope; clean up the terminals you started when the task ends,
  unless the user wants them kept.
- Long or slow commands (builds, installs, deploys, tests) run in an hc terminal, not in your own shell.
- Secrets follow the `infisical` skill: never type a secret into a terminal, a `send` or a task description.
