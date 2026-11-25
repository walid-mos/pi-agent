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
  `models.json` with the machine's gateway address; the rendered file is never tracked. The key lives in `auth.json`
  as a command (`"key": "!infisical secrets get MAGPIE_KEY_<machine> ..."`), so it is never written to disk.
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
- `extensions/chezmoi/`: adds a note to the result of an `edit` or `write` on a file chezmoi manages, so the agent
  saves it as `skills/chezmoi` says. Tests: `node --test extensions/chezmoi/`.
- `extensions/decide.ts`: the `decide` tool, which asks Jev (`group/decide` on Magpie) a closed question; auto-discovered, not declared in `settings.json`.

## New machine

The dotfiles (chezmoi) clone this repository into `~/.pi/agent` and set up `~/.config/pi` with the repositories it
holds. Without the dotfiles:

```sh
git clone git@github.com:walid-mos/pi-agent.git ~/.pi/agent   # before installing Pi, or merge into the existing dir
```

Then log in to providers again (for example `/login magpie`), since `auth.json` is not tracked.
