# pi-agent

User-level configuration for [Pi](https://github.com/earendil-works/pi), checked out at `~/.pi/agent`.

`.gitignore` is an allowlist: only configuration is tracked. Credentials (`auth.json`), sessions, the managed install (`install/`, `bin/`) and caches stay local.

## Contents

- `settings.json`: preferences and package declarations.
- `AGENTS.md`: global instructions applied in every directory.
- `extensions/`, `skills/`, `prompts/`, `themes/`: user resources, when present.

Third-party packages are vendored in the `pi-vendor` repo, checked out at `~/.config/pi-vendor`, and declared in `settings.json` as local packages.

## New machine

```sh
git clone git@github.com:walid-mos/pi-agent.git ~/.pi/agent   # before installing Pi, or merge into the existing dir
git clone git@github.com:walid-mos/pi-vendor.git ~/.config/pi-vendor
```

Then log in to providers again (for example `/login magpie`), since `auth.json` is not tracked.
