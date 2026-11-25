# pi-agent

User-level configuration for [Pi](https://github.com/earendil-works/pi), checked out at `~/.pi/agent`.

`.gitignore` is an allowlist: only configuration is tracked. Credentials (`auth.json`), sessions, the managed install (`install/`, `bin/`) and caches stay local.

## Contents

- `settings.json`: preferences and package declarations.
- `AGENTS.md`: global instructions applied in every directory.
- `extensions/`, `skills/`, `prompts/`, `themes/`: user resources, when present.

Third-party packages are vendored in the `pi-vendor` repo, checked out at `~/.config/pi/pi-vendor`, and declared in `settings.json` as local packages.

- `models.json.tmpl`: the `magpie` provider (the Magpie gateway's routing groups). chezmoi renders it into
  `models.json` with the machine's gateway address; the rendered file is never tracked. The key lives in `auth.json`
  as a command (`"key": "!infisical secrets get MAGPIE_KEY_<machine> ..."`), so it is never written to disk.
- `skills/infisical`, `skills/tailscale`: our rules for secrets, vaults, identities and the tailnet policy. They read
  every homelab value from Infisical at run time (`~/.config/infisical/core.env`, `core:/homelab/reference`); none is
  written in this repo. The generic Infisical documentation comes from the vendored `infisical-ai-skills` package.
  `skills/infisical/scripts/run.sh` gives any repository its environment from a vault folder, so no repository needs
  a `.env` and none shows a trace of Infisical; `AGENTS.md` makes that the rule everywhere, and a repository's own
  `AGENTS.md` is the only place an exception is recorded.
- `skills/harness`: our rules for authoring skills (placement, description, body, scripts) and
  `scripts/check.sh`, the mechanical checks. `AGENTS.md` makes it mandatory for any skill change.
- `skills/herdr`: points agents to the manuals built into Herdr (`hc --skill`, `herdr-app --skill`) and adds our rules.
- `extensions/decide.ts`: the `decide` tool, which asks Jev (`group/decide` on Magpie) a closed question; auto-discovered, not declared in `settings.json`.
Private skills and extensions live in private repositories cloned under `~/.config/pi/` by the dotfiles, which link
each one's `skills/` and `extensions/` into `skills/<name>` and `extensions/<name>` here and hide the links through
this checkout's `.git/info/exclude`. Pi loads them like the resources of this repository, which names none of them.

## New machine

```sh
git clone git@github.com:walid-mos/pi-agent.git ~/.pi/agent   # before installing Pi, or merge into the existing dir
git clone git@github.com:walid-mos/pi-vendor.git ~/.config/pi/pi-vendor
```

Then log in to providers again (for example `/login magpie`), since `auth.json` is not tracked.
