# pi-agent

User-level configuration for [Pi](https://github.com/earendil-works/pi), checked out at `~/.pi/agent`.

`.gitignore` is an allowlist: only configuration is tracked. Credentials (`auth.json`), sessions, the managed install (`install/`, `bin/`) and caches stay local.

## Contents

- `settings.json`: preferences and package declarations.
- `AGENTS.md`: global instructions applied in every directory.
- `extensions/`, `skills/`, `prompts/`, `themes/`: user resources, when present.

Third-party packages and private skills live outside this repository, in `~/.config/pi` (see its README): `settings.json`
declares that directory once as a local package, and its `package.json` picks up the skills and extensions of the
repositories cloned there. This repository names none of them.

- `models.json.tmpl`: the `magpie` provider (the Magpie gateway's routing groups). chezmoi renders it into
  `models.json` with the machine's gateway address; the rendered file is never tracked. The key is in each Mac's login
  Keychain, and `auth.json` reads it with a command (`"key": "!security find-generic-password -s pi-magpie -a api-key -w"`),
  so it is never written to a file. `pi-magpie-key MAGPIE_KEY_<machine>` (from the dotfiles) copies it there from
  Infisical and writes that line: run it on a new machine and after every rotation. Pi gives a key command 10 s and
  caches a failure, so it must not depend on the network.
- `skills/infisical`, `skills/tailscale`: our rules for secrets, vaults, identities and the tailnet policy. They read
  every homelab value from Infisical at run time (`~/.config/infisical/core.env`, `core:/homelab/reference`); none is
  written in this repo. The generic Infisical documentation comes from the vendored `infisical-ai-skills` package.
  `skills/infisical/scripts/run.sh` gives any repository its environment from its own vault, so no repository needs
  a `.env` and none shows a trace of Infisical; `AGENTS.md` makes that the rule everywhere, and a repository's own
  `AGENTS.md` is the only place an exception is recorded.
- `skills/harness`: our rules for authoring skills (placement, description, body, scripts) and
  `scripts/check.sh`, the mechanical checks. `AGENTS.md` makes it mandatory for any skill change.
- `skills/chezmoi`: our rules for the dotfiles chezmoi manages: every change to one is saved with `dots -m`, as one
  commit of the named files, pushed.
- `skills/herdr`: points agents to the manuals built into Herdr (`hc --skill`, `herdr-app --skill`) and adds our rules.
- `skills/pi-config`: where a theme, extension, renderer or setting goes, and `scripts/pishot.sh`, which screenshots
  Pi's terminal UI on a fake or real session, without a model call, to check a visual change.
- `extensions/claude-skills/`: at each Pi start, links every skill Pi loads from the user's directories into
  `~/.claude/skills`, so Claude Code has the same skills, read where Pi keeps them. Tests:
  `node --test extensions/claude-skills/`.
- `extensions/chezmoi/`: adds a note to the result of an `edit` or `write` on a file chezmoi manages, so the agent
  saves it as `skills/chezmoi` says. Tests: `node --test extensions/chezmoi/`.
- `extensions/footer/`: replaces Pi's footer with a powerline one coloured from the theme: repository, branch, git
  state and last commit on the left; generation speed, the Magpie routing group and the model it routed the latest
  request to (`x-magpie-model` header, also written as the message's `responseModel`), thinking level, context,
  tokens and subscription quotas on the right. Gives the working loader a comet animation. `/footer` switches back to
  Pi's footer. Tests: `node --test extensions/footer/`.
- `extensions/decide.ts`: the `decide` tool, which asks Jev (`group/decide` on Magpie) a closed question; auto-discovered, not declared in `settings.json`.

## New machine

The dotfiles (chezmoi) clone this repository into `~/.pi/agent` and set up `~/.config/pi` with the repositories it
holds. Without the dotfiles:

```sh
git clone git@github.com:walid-mos/pi-agent.git ~/.pi/agent   # before installing Pi, or merge into the existing dir
```

Then run `pi-magpie-key MAGPIE_KEY_<machine>` in a terminal of the GUI session, since `auth.json` is not tracked.
