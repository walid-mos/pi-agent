---
name: tailscale
description: Our rules for administering the user's tailnet through the Tailscale API - policy (ACL) changes with ETag and built-in tests, tag conventions, one-time tagged auth keys, device tags and key expiry, SSH host aliases. Use when adding a machine or service to the tailnet, changing who can reach what, creating an auth key, retagging a device, or debugging tailnet access.
---

# Tailscale: administering the tailnet

The tailnet policy is the source of truth for network access in the homelab. Every change goes through the API, is
validated, is protected by its own tests, and is read back. Nothing here is specific to a machine: tailnet name, tag
registry, addresses and IDs are read from Infisical (`core:/homelab/reference`), never written in this skill or in a repo.

## Before anything

- Load the local Infisical pointers: `. ~/.config/infisical/core.env` (`INFISICAL_DOMAIN`, `INFISICAL_CORE_ID`, rendered by
  chezmoi from the machine's local data). If the file is missing, stop and ask the user.
- Read the tag registry with the `infisical` skill's helper: `../infisical/scripts/print-reference.sh TAILSCALE_TAGS` (JSON `{tag: role}`).
- Every API call goes through `scripts/call-api.sh METHOD PATH [curl args]`. The OAuth client secret comes from Infisical and
  only lives in memory; the bearer token reaches curl through a file descriptor. The script prints `HTTP <code>` on stderr
  and exits non-zero for any status >= 400. Never print the secret or the token.
- Work in a temporary directory outside any repository (`d=$(mktemp -d)`): policy files are private homelab data.

## Tag conventions

- A tag is the **identity of a role**, not of a machine. Create a new tag only when its access rules differ from every
  existing tag; otherwise reuse the role tag (several machines can share it).
- If one caller must reach one member of a tag but not another, write the rule per port or per host, not a new tag.
- Owners of every tag: `autogroup:admin` and the admin OAuth client's tag (the one owning the other homelab tags in
  `tagOwners`, see the registry), so the agent can tag devices through the API. A tag must exist in `tagOwners`
  **before** an auth key or a device can carry it.
- Update `TAILSCALE_TAGS` in `core:/homelab/reference` in the same change (write the new JSON to a file, then
  `infisical secrets set TAILSCALE_TAGS=@file ...`).

## Policy change checklist

The policy is HuJSON with comments: always GET it as HuJSON (the default, or `-H 'Accept: application/hujson'`) and send it
with `--data-binary @file` (`-d @file` strips newlines, so a `//` comment would swallow the rest of the policy).

- [ ] `scripts/call-api.sh GET tailnet/-/acl -D "$d/h0" -o "$d/p0.hujson"`. ETag: `etag=$(sed -n 's/^etag: //Ip' "$d/h0" | tr -d '\r')`
      (the value already includes its double quotes). `p0.hujson` is the rollback.
- [ ] Edit a copy (`p1.hujson`) with a small script that replaces fixed text **anchors** (an existing line or block copied
      exactly) and asserts each anchor occurs exactly once, so the edit is idempotent and fails loudly on drift.
      The policy uses `acls` (`{"action": "accept", "src": [...], "dst": ["tag:x:443"]}`); the user is written as their
      login, user devices as `autogroup:member`.
- [ ] Add **tests** for the change, in the policy's `tests` block:
      `{"src": "<caller>", "accept": ["tag:x:443"]}` for each intended caller and
      `{"src": "tag:<other>", "deny": ["tag:x:443"]}` for every other tag. A rule without tests is not done.
- [ ] `scripts/call-api.sh POST tailnet/-/acl/validate -H 'Content-Type: application/hujson' --data-binary @"$d/p1.hujson"`
      returns `{}`.
- [ ] Show the user the diff and get a go, unless the change was already approved in a plan.
- [ ] `scripts/call-api.sh POST tailnet/-/acl -H 'Content-Type: application/hujson' -H "If-Match: $etag" --data-binary @"$d/p1.hujson"`.
- [ ] Read back into `p1.readback` and `cmp` it with `p1.hujson`; record the new ETag. Tailscale may re-wrap long lines:
      if `cmp` differs, compare the parsed content (comments and trailing commas stripped) before concluding.
- [ ] Test real access for the callers concerned (curl through the tailnet, SSH). Deny paths are covered by the tests.

Order changes so access is never cut: add the new rule and tests, move devices, then remove the old rule.

### If the POST returns 412

Someone (maybe an earlier run of yours) changed the policy since your GET.
1. GET again into `p2.hujson` with headers. If `p2` equals `p1`, your change is already live: stop, nothing to do.
2. `diff p0.hujson p2.hujson` shows the other change; tell the user.
3. Re-run the edit script on `p2` (it asserts its anchors), validate, show the new diff, get a new go.
4. POST with the new ETag, read back. From now on **`p2` is the rollback**; never restore `p0`, it would erase the other
   change.

## Auth keys

- Keys are **one-time**, **pre-authorized**, **tagged** with exactly the role tag, non-ephemeral for servers, valid 1 hour.
- Create and deliver them in one step: `scripts/create-auth-key.sh <tag> <description> <ssh-target> <remote-file>`. The script
  writes `TS_AUTHKEY=...` into the remote file (`0600`) over SSH, compares SHA-256 on both sides and prints only the key ID.
  Never create a key any other way: an agent's shell has no terminal, so anything printed lands in the transcript.
- After the node joins: find it with `GET tailnet/-/devices` (filter on `hostname`), check `tags` and `keyExpiryDisabled`
  with `GET device/<id>`, check the key with `GET tailnet/-/keys/<keyId>` (`invalid: true`), then empty the remote file.
- Containers (`tailscale/tailscale` image): no `file:` prefix is documented for `TS_AUTHKEY`; pass it through a compose
  `env_file` (`0600`) with `TS_AUTH_ONCE=true` and a persistent `TS_STATE_DIR` volume. Userspace networking (the default)
  needs no `/dev/net/tun`; `tailscale serve` (`TS_SERVE_CONFIG`) provides the HTTPS endpoint.

## Devices

- Retag: `POST device/<id>/tags` with `{"tags": ["tag:..."]}`. Tagged devices have key expiry disabled automatically;
  for a user-owned device that must stay up, `POST device/<id>/key` with `{"keyExpiryDisabled": true}`.
- Rename the machine on the device itself (`tailscale set --hostname=...`); the MagicDNS name and the `tailscale serve`
  certificate follow.

## SSH over the tailnet

- In `~/.ssh/config`, point `HostName` at the MagicDNS name and set `HostKeyAlias <short name>` so the same
  `known_hosts` entry works over the LAN and the tailnet.
- Never accept a host key blindly: compare `ssh-keyscan` fingerprints with the ones read on the machine itself, then
  append to `known_hosts`. Never disable `StrictHostKeyChecking`.

## Rollback

POST the rollback file with `If-Match` set to the current ETag, read it back, and restore the device tags that were
changed. Delete devices created for the change (`DELETE device/<id>`) and revoke unused keys (`DELETE tailnet/-/keys/<id>`).
