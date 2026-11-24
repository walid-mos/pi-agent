# Vaults and machine identities

## Model

| Zone | Machine | Identity | Vault |
|---|---|---|---|
| Admin | none (the user, on their Macs) | none: the user's account | `core` |
| Services | one LXC per service | `<vault>-reader` (one per service) | one per service (e.g. `magpie`) |
| Nextnode | VM (sandbox per domain) | `nextnode-<machine>`; `nextnode-ci-<repo>` (OIDC) | `nextnode` |
| Personal | VM (sandbox per domain) | `perso-<machine>` | `perso` |
| Accor | VM | `accor-<machine>`; `accor-ci-<repo>` (OIDC) | `accor` |

Vault IDs: `scripts/ref.sh VAULT_<NAME>_ID`. Projects not in this table (kept as-is from a migration) have no identity
until a consumer appears; decide their vault then.

## Registry

Keep one line per identity. No secret values, no client IDs.

| Identity | Auth | Vault (role) | Where the client secret lives | Created |
|---|---|---|---|---|
| `magpie-reader` | Universal Auth, TTL 1 h | `magpie` (Viewer) | Magpie LXC, `~magpie/.config/infisical/magpie-reader.env` | 2026-11-24 |
| `ops-reader` | Universal Auth, TTL 1 h | `ops` (Viewer) | ops LXC, `/etc/ops/ops-reader.env` (user `ops`) | 2026-11-24 |
| `relay-reader` | Universal Auth, TTL 1 h | `relay` (Viewer) | relay LXC, `/etc/relay/relay-reader.env` (user `relay`) | 2026-11-24 |

Copies of a secret in more than one vault: none.

## Create a Universal Auth identity (API, user session)

The CLI has no identity commands; use the API of the instance with the user's session token passed through a file
descriptor, never as an argument:
`tok=$(infisical user get token --plain --silent); curl -H @<(printf 'Authorization: Bearer %s\n' "$tok") ...`.
Create the vault first if needed: `infisical sm projects create --name <vault> --slug <vault>` (slugs need 5+ characters),
then give it exactly the environments it needs (`environments create` / `environments delete --force -y`).

1. `GET /api/v1/organization` for the organization ID.
2. `POST /api/v1/identities` `{"name", "organizationId", "role": "no-access"}`.
3. `POST /api/v1/auth/universal-auth/identities/{id}` with `accessTokenTTL` and `accessTokenMaxTTL` at 3600.
4. `POST /api/v2/workspace/{projectId}/identity-memberships/{id}` `{"role": "viewer"}`.
5. `GET /api/v1/auth/universal-auth/identities/{id}` for the client ID, then
   `POST .../client-secrets` `{"description", "ttl": 0, "numUsesLimit": 0}`: pipe the JSON through `jq` into an env file
   (`INFISICAL_DOMAIN=...`, `INFISICAL_UNIVERSAL_AUTH_CLIENT_ID=...`, `INFISICAL_UNIVERSAL_AUTH_CLIENT_SECRET=...`)
   written over SSH into `0600`, owned by the service user; compare hashes. The machine cannot read `core`, so the domain
   travels in this file.
6. Check isolation: `GET /api/v2/workspace/{projectId}/identity-memberships` on every other project must not list it.

## Use it on the machine

```sh
set -a; . ~/.config/infisical/<identity>.env; set +a
INFISICAL_TOKEN=$(infisical login --method=universal-auth --plain --silent); export INFISICAL_TOKEN
unset INFISICAL_UNIVERSAL_AUTH_CLIENT_ID INFISICAL_UNIVERSAL_AUTH_CLIENT_SECRET
infisical run --projectId <vault id> --env main --path /<folder> -- env -u INFISICAL_TOKEN <command>
```

Install the CLI with the official package command for the distribution (see `infisical-setup`); on a root-only LXC,
drop `sudo` from the documented commands.

## Rotate or revoke

Create the new client secret first, deploy it, test, then revoke the old one (`POST .../client-secrets/{secretId}/revoke`).
To remove access entirely: delete the project membership, then the identity, then `rm -P` the file on the machine.
