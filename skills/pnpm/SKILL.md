---
name: pnpm
description: Our rules for pnpm's release-age gate (`minimumReleaseAge`), which refuses a package version published too recently - what to do when an install or an update is refused for that reason, and how the user's own packages are exempted. Use when a pnpm command fails on the minimum release age or with "no mature matching version", when adding or updating a dependency to a version published in the last days, when installing a package the user has just published, or before changing `minimumReleaseAge` or `minimumReleaseAgeExclude` in any pnpm configuration, even for a one-line change.
---

# pnpm: the release-age gate

## Release-age gate

pnpm refuses a version younger than `minimumReleaseAge`, so that a compromised release is caught by others before it
is installed here. The gate stays as it is for every package that is not the user's.

- Never wait for a version to become old enough: a refused version is a blocker, handled at once as below.
- A third-party version is refused: install the newest version that is old enough (`pnpm view <package> time --json`
  gives each version's publication date) and tell the user which one you took and why. If the task needs the refused
  version itself, tell the user at once which version it is and when it becomes installable, and carry on with the
  work that does not need it.
- Never get a third-party version past the gate: no lowering of `minimumReleaseAge`, no third-party name in
  `minimumReleaseAgeExclude`, no other package manager for that install. The delay is the protection.
- The user's own packages are exempt, because the user is their publisher. Their scopes are the entries of
  `pnpm config get --global minimumReleaseAgeExclude`, a per-machine file that no repository holds. If a package
  under a scope the user has named as theirs is refused, that machine's list lacks the scope: add it with
  `pnpm config set --global --json minimumReleaseAgeExclude '<the whole list>'`, keeping the entries already there,
  and tell the user. A scope the user has not named as theirs is never added without asking.
