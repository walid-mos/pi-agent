# Operating the self-hosted instance

The instance runs with Docker Compose (official `docker-compose.prod.yml`, kept next to the untouched original
`docker-compose.prod.yml.orig`) in `~/infisical/` on its host, inside a Colima VM. Host name, address and paths beyond
that are in `core:/homelab/reference`.

Deviations from the official compose, and why:
- image tags pinned (never `latest`);
- no published port: a `tailscale` sidecar serves HTTPS on the tailnet (`tailscale serve`), the backend shares its network
  namespace (`network_mode: service:tailscale`);
- PostgreSQL 18+: the data volume is mounted on `/var/lib/postgresql`, **not** `/var/lib/postgresql/data` (the image
  changed `PGDATA`; the old mount silently writes to an anonymous volume that is lost when the container is recreated).

## Keys

`ENCRYPTION_KEY` decrypts every secret; without it a database dump is useless. `ENCRYPTION_KEY`, `AUTH_SECRET` and the
database password are kept by the user outside the homelab (password manager), verified by hash. Never print them; never
display `docker compose config`.

## Backup

`~/infisical/backup.sh`, run nightly by a launchd agent:
`docker compose -f docker-compose.prod.yml exec -T db pg_dump -U infisical infisical`,
gzip, `gzip -t`, check the end-of-dump marker in the **last 8 lines** (pg_dump 18 ends with a `\unrestrict` line after
the "dump complete" comment), keep 14 days. Log: `~/infisical/backups/backup.log`.

Check: `launchctl print gui/$(id -u)/local.infisical-backup` (`last exit code = 0`) and the last `OK` line of the log.

## Restore test (do it after any change to backups, and at least once per upgrade)

- [ ] Fresh dump.
- [ ] Throwaway compose project in its own directory: same images, a copy of `.env` (`0600`), its own volume,
      **no port, no tailscale**, and a network declared `internal: true` (no egress), so secret syncs, rotations or
      webhooks stored in the database cannot act on real systems.
- [ ] `gzip -dc dump | docker compose exec -T db psql -q -v ON_ERROR_STOP=1 -U infisical infisical`.
- [ ] Start the backend, read one real secret through the API inside the container (token on stdin), print only its
      SHA-256, compare with the live instance.
- [ ] `docker compose down -v`, `rm -P` the `.env` copy, remove the directory, and check that no container, volume or
      network of the throwaway project is left.

## Upgrade (official procedure)

See also the vendored `infisical-self-host` skill (`references/docker-deployment.md`) and the official
"Upgrading Infisical" guide. Database migrations run forward only.

- [ ] Note the running version (pinned tag) and read the release notes up to the new one.
- [ ] **Inventory before**: for every project, environment and folder, the names and the SHA-256 of each value, into a
      `0600` file (walk folders with `sm folders get`; never print values).
- [ ] Backup, check it, and keep that dump aside as the rollback point.
- [ ] Change the pinned tag in the compose file (and the same tag in any throwaway compose).
- [ ] `docker compose -f docker-compose.prod.yml pull` then `up -d`.
- [ ] `/api/status` through the tailnet returns 200.
- [ ] **Inventory after**, same method: the diff with the inventory before must be empty. Destroy both files.
- [ ] Rollback if anything fails: old tag, new empty volume, restore the kept dump (restore-test procedure), then
      switch the compose back.
- [ ] For PostgreSQL or Redis major versions: check the supported range in the current docs first; a PostgreSQL major
      upgrade needs a dump and restore into a new volume.

## Health

- `curl -s "$INFISICAL_DOMAIN/api/status"` from a tailnet machine.
- `lsof -iTCP -sTCP:LISTEN` on the host: nothing of the stack listens on the LAN.
- After a host reboot, the stack comes back once the user session is open (Colima runs as a `brew services` agent).
