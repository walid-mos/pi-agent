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

- **Copying herdr-core to another machine needs the user's explicit go** for that machine: `hc machine add --install`,
  `hc machine update`, or any other copy. A request that names the machine and asks to set Herdr up there is that go;
  otherwise ask. `hc machine add` without `--install`, to a machine that already has herdr-core, is fine.
- Machine names: read them with `hc machine ls` (the `name` field is the address prefix, as in `name/t7`). If the
  user's wording does not match one name exactly, ask; do not add, rename or remove machines unless asked.
- A new machine must first be reachable over SSH with a verified host key (see the `tailscale` skill and
  `~/.ssh/AGENTS.md`); an agent CLI on it gets its credentials through the `infisical` skill, never typed in a terminal.
- Name every terminal you start and give it an exact scope. Clean up the terminals you started when the task ends,
  except those the user wants to watch or keep: start those with `--outlive-parent` and, to show one, give it a tab
  (`herdr-app do terminal.keep --terminal <id> --place tab`, see `herdr-app --skill`).
- An agent you started that stops on a permission or trust prompt is a blocker for the user, as the global
  `AGENTS.md` says: never answer it with `hc keys` or `hc send --force`, even though the manual shows
  `hc keys <t> down enter` for a trust dialog. Tell the user which prompt it is and where, and carry on with the work
  that does not need that agent.
- `hc send` delivers a message, never a command: the text reaches the other agent marked as coming from you, so a
  slash command sent this way (`/compact`, for example) is read as plain text and does nothing.
- Long or slow commands (builds, installs, deploys, tests) run in an hc terminal, not in your own shell.
- A run that goes on while nobody is at the machine (an agent, a long test suite) starts under `caffeinate -is`:
  otherwise the Mac goes to sleep, which freezes the run and fails every test that measures time.
- Before starting several heavy programs or agents at once, read `references/machine-load.md`: how much the
  machine can carry and what to do when it struggles.
- Secrets follow the `infisical` skill: never type a secret into a terminal, a `send` or a task description.
