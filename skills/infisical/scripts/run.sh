#!/bin/bash
# usage: run.sh VAULT FOLDER -- COMMAND [ARG...]
# Runs COMMAND with the secrets of one folder of one vault as environment variables, through the user's CLI session.
# VAULT is a vault name (accor, perso, ...), FOLDER an absolute path in it (/projects/<repository>).
# Prints nothing of its own on success. When COMMAND fails, the CLI names its status on stderr and this script exits 1.
# COMMAND is not run when the vault is unknown, the folder is missing or it holds no secret: a program must never
# start silently without its environment.
set -euo pipefail

# Every vault of ours has the single environment `main` (the CLI would otherwise default to `dev`).
ENVIRONMENT=main

die() { echo "run.sh: $*" >&2; exit 1; }

[ $# -ge 4 ] && [ "$3" = "--" ] || { echo "usage: run.sh VAULT FOLDER -- COMMAND [ARG...]" >&2; exit 2; }
vault=$1 folder=$2; shift 3
case "$folder" in /*) ;; *) die "FOLDER must be an absolute path, got '$folder'" ;; esac

core="${INFISICAL_CORE_ENV:-$HOME/.config/infisical/core.env}"
[ -f "$core" ] || die "$core is missing: this machine has no user session pointers. On a machine with a machine identity, follow 'Use it on the machine' in references/identities.md with the same folder."
. "$core"

ref="VAULT_$(printf '%s' "$vault" | tr 'a-z-' 'A-Z_')_ID"
id=$(bash "$(dirname "$0")/ref.sh" "$ref") || die "no vault named '$vault' ($ref): list the names with ref.sh --list"

# Names are counted, values never leave the pipe.
count=$(infisical sm secrets get --domain "$INFISICAL_DOMAIN" --projectId "$id" --env "$ENVIRONMENT" --path "$folder" \
  -o json --silent | jq 'length') \
  || die "cannot read $vault:$folder (see the error above: missing folder, expired session or tailnet down); COMMAND was not run"
[ "$count" -gt 0 ] || die "$vault:$folder holds no secret; COMMAND was not run. Fill the folder, do not fall back to a file."

# --silent drops the tips, --log-level error drops the "Injecting N secrets" line; errors still reach stderr.
exec infisical run --domain "$INFISICAL_DOMAIN" --projectId "$id" --env "$ENVIRONMENT" --path "$folder" \
  --silent --log-level error -- "$@"
