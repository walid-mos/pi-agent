---
name: infisical
description: Operates the user's self-hosted Infisical - reading and copying secrets without ever exposing them, the vault (project) and machine identity model, homelab reference values, backups, restore tests and upgrades of the instance. Use whenever a task reads, writes, moves or rotates a secret, creates a project or a machine identity, gives a machine access to secrets, or maintains the Infisical server. Takes precedence over the generic infisical-* skills, which remain the reference for general documentation.
---

# Infisical (self-hosted)

This skill holds **our rules**. For general product documentation (CLI flags, auth methods, SDKs, Docker and Kubernetes
deployment, roles), read the vendored official skills `infisical-setup`, `infisical-self-host` and
`infisical-access-control`. When they disagree with this file, this file wins.

## Where the values are

- `~/.config/infisical/core.env`: `INFISICAL_DOMAIN` and `INFISICAL_CORE_ID`, rendered by chezmoi from each machine's
  local data (never committed). Source it first: `. ~/.config/infisical/core.env`. Missing file: stop and ask the user.
- `core:/homelab/reference`: every other identifier (vault IDs, service URLs, tailnet name, tag registry, network
  plan). Not secret, but private: read them with `scripts/ref.sh NAME`, never copy them into a repository.
- The CLI user session belongs to the user. An agent running unattended must not borrow it (see identities below).

## Secret handling rules (non-negotiable)

1. **No value on screen, in a log, in shell history or in a command argument.** Only names, counts and SHA-256 hashes
   may be printed.
2. Values move through **pipes** or **files created with `umask 077` and destroyed with `rm -P` (macOS) or `shred -u`
   (Linux)**, in a temporary directory outside any repository that is emptied even on failure (`trap`).
3. Write with `infisical secrets set NAME=@file` (the CLI reads the file) and never `NAME=value`.
4. Read inside `infisical run ... -- sh -c '...'` and use the variable there; strip every variable the child does not
   need (`env -u ...`, including `INFISICAL_TOKEN` when a machine token was exported) before launching a program.
5. **Every copy is verified**: hash the source and the destination value and compare (`scripts/cpsecret.sh` does it).
6. Never run `docker compose config`, `env`, `printenv` or `set` where secrets are loaded; never `cat` a `.env`.
7. Anything printed by mistake is treated as leaked: tell the user and rotate it.

## Vaults and identities

Free self-hosted Infisical has only built-in project roles (Admin, Member, Viewer, No Access): an identity with access to
a project reads **all** of it. Hence:

- **One vault (project) per trust zone**, and a vault boundary only counts if it matches a machine (or sandbox) boundary.
- **One identity per workload**, with access to **exactly one vault**, role **Viewer** unless it must write.
- The `core` vault (admin secrets, homelab reference) has **no identity**: only the user's own account.
- **One source per secret**: a secret lives in the vault of its consumer; do not keep copies in several vaults. If a copy
  is ever unavoidable, record it in `references/identities.md` for rotations.
- Platform-native auth first: **OIDC** for GitHub Actions (subject pinned to repository + branch or environment, no
  wildcard); **Universal Auth** only for machines without a platform identity (LXC, VM).
- Access tokens short (TTL 1 h, max TTL 1 h), lockout kept on. Client secrets do not expire but are revocable and stored
  **only** on the machine that uses them (`0600`, owned by the service user), written there directly without display.
- Names: vault in lowercase, one per zone or per service; identity `<vault>-<purpose>` (for example `magpie-reader`,
  `nextnode-ci-<repo>`).
- Network replaces the paid IP allow-lists: the instance is reachable only through the tailnet, and the tailnet policy
  only lets the intended callers in (see the `tailscale` skill).

Details, creation steps and the current registry: `references/identities.md`.

## Checklists

**New machine identity**
- [ ] The vault exists and holds only what this workload needs.
- [ ] Identity created with organization role `no-access`; Universal Auth attached with TTL 1 h / max 1 h.
- [ ] Membership: Viewer on that one vault. Check that every other project lists no membership for it.
- [ ] Client secret created and piped straight into `0600` on the target; hashes compared; temporary file destroyed.
- [ ] Test from the machine: `infisical run` reads its vault; reading `core` (and one other vault) is **refused**;
      writing is refused for a Viewer.
- [ ] Registry in `references/identities.md` updated.

**Receiving a value from the user** (a new token, a password): never in the chat. Either the user types it directly in
the Infisical web UI at the agreed vault and path, or writes it to a file they create themselves with `umask 077`, which
you then send with `secrets set NAME=@file` and destroy. Confirm by name and hash only.

**Moving a secret** (one source per secret):
- [ ] `scripts/cpsecret.sh` to the destination (creates the folder, compares hashes).
- [ ] Check that nothing references it: search the source vault for `${...NAME}` (names only) and the consumers' code and
      scripts for the old vault ID and path.
- [ ] Switch every consumer to the new location and test it.
- [ ] Delete the source: `infisical sm secrets delete NAME --type shared --yes ...`, then list both sides.
- [ ] Remember that the source keeps the value in its version history and snapshots: rotate the secret if the source
      vault was readable by someone who must not have it.

**Copying many secrets**: `scripts/cpsecret.sh` for one secret; for many, a mapping file and the same pattern
(export the source folder as JSON into a `0600` file, write each value to its own file, `secrets set NAME=@file`, read
back, compare per-key hashes, check that the destination holds exactly the expected names, `rm -P` everything).

**Server operations** (backup, restore test, upgrade): `references/operations.md`.

## CLI pitfalls

- `infisical sm secrets delete` defaults to **personal** secrets: pass `--type shared --yes`, then list to confirm.
- Several login profiles can coexist (`infisical profile list`); scripts select one explicitly with `--profile` or
  `INFISICAL_PROFILE`, never by relying on the default during a migration.
- `infisical sm secrets get --recursive -o json` returns names and values without their folder: walk folders with
  `infisical sm folders get` when paths matter.
- Pass `--include-imports=false --expand=false` when copying, so references and imports are not resolved into values.
