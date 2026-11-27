# pi-agent

User-level configuration for [Pi](https://github.com/earendil-works/pi), checked out at `~/.pi/agent`. An extension
with tests runs them with `node --test extensions/<name>/`.

`.gitignore` is an allowlist, so that credentials, sessions, the managed install and caches can never be committed.

This repository is public. Third-party packages and private skills live in `~/.config/pi` (see its README), which
`settings.json` loads as one local package, so this repository names none of them.

## Magpie

`models.json.tmpl` declares the `magpie` provider. chezmoi renders it into `models.json` with the machine's gateway
address, so the rendered file is never tracked. The API key stays in each Mac's login Keychain and `auth.json` reads
it with a key command, so it is never written to a file: `pi-magpie-key MAGPIE_KEY_<machine>` (from the dotfiles)
copies it from Infisical and writes that command, on a new machine and after every rotation. Pi caches a key command
that fails or times out, so that command must not depend on the network.

## Compaction

`extensions/checkpoint` replaces Pi's compaction. Past a context ceiling chosen with `/ceiling`, for one session or
as the default kept in the machine-local `checkpoint.json`, it replaces older context with a checkpoint, and
`history_read` reads the originals back; `/checkpoint` shows its state. Pi's own compaction keeps its default
`compaction.reserveTokens`, so it fires only at the edge of a model's window, and the extension answers it too: a
reserve set in `settings.json` would lower the highest ceiling `/ceiling` offers. How it works is in the header of
`extensions/checkpoint/index.ts`.

## Browser MCP servers

`mcp.json` puts its browser servers on one shared Chromium: `e2e` acts on pages, `chrome` (chrome-devtools-mcp) only
inspects them. Their config and pinned tooling are in `pi-vendor/packages/web-tools`; the browser owner `pi-chromium`,
the launcher `pi-chrome-mcp` and the install script come from the dotfiles. `chrome` is `hidden` with an allowlist in
`toolExposure`, so a tool added by an update stays unreachable until someone classifies it: after updating
chrome-devtools-mcp, run `pi mcp list` and classify the new names. The skill `web` holds the rules for using them.

## New machine

The dotfiles (chezmoi) clone this repository into `~/.pi/agent` and set up `~/.config/pi` with the repositories it
holds. Without the dotfiles:

```sh
git clone git@github.com:walid-mos/pi-agent.git ~/.pi/agent   # before installing Pi, or merge into the existing dir
```

Then run `pi-magpie-key MAGPIE_KEY_<machine>` in a terminal of the GUI session, since `auth.json` is not tracked.
