#!/bin/bash
# usage: run.sh VAULT ENV FOLDER -- COMMAND [ARG...]
# Runs COMMAND with the secrets of one folder of one vault as environment variables, through the user's CLI session.
# VAULT is the vault's name as `infisical sm projects list` shows it ("Accor - Product-data-apps", core, ...), ENV an
# environment slug of that vault (dev, main, ...), FOLDER an absolute path in it: / for a project vault, whose
# secrets sit at the root.
# Prints nothing of its own on success. When COMMAND fails, the CLI names its status on stderr and this script exits 1.
# COMMAND is not run when the vault is unknown, the folder is missing or it holds no secret: a program must never
# start silently without its environment.
set -euo pipefail

die() { echo "run.sh: $*" >&2; exit 1; }

[ $# -ge 5 ] && [ "$4" = "--" ] || { echo "usage: run.sh VAULT ENV FOLDER -- COMMAND [ARG...]" >&2; exit 2; }
vault=$1 environment=$2 folder=$3; shift 4
case "$folder" in /*) ;; *) die "FOLDER must be an absolute path, got '$folder'" ;; esac

core="${INFISICAL_CORE_ENV:-$HOME/.config/infisical/core.env}"
[ -f "$core" ] || die "$core is missing: this machine has no user session pointers. On a machine with a machine identity, follow 'Use it on the machine' in references/identities.md with the same folder."
. "$core"

# The ID is looked up by exact name at each run, so no vault ID is written anywhere.
ids=$(infisical sm projects list --domain "$INFISICAL_DOMAIN" -o json --silent | jq -r --arg n "$vault" '.[] | select(.name == $n) | .id') \
  || die "cannot list the vaults (see the error above: expired session or tailnet down); COMMAND was not run"
[ -n "$ids" ] || die "no vault named '$vault': names are listed by 'infisical sm projects list'"
[ "$(printf '%s\n' "$ids" | wc -l)" -eq 1 ] || die "several vaults are named '$vault'; COMMAND was not run"

# Names are counted, values never leave the pipe.
count=$(infisical sm secrets get --domain "$INFISICAL_DOMAIN" --projectId "$ids" --env "$environment" --path "$folder" \
  -o json --silent | jq 'length') \
  || die "cannot read $vault ($environment) $folder (see the error above: missing environment or folder, expired session or tailnet down); COMMAND was not run"
[ "$count" -gt 0 ] || die "$vault ($environment) $folder holds no secret; COMMAND was not run. Fill it, do not fall back to a file."

# --silent drops the tips, --log-level error drops the "Injecting N secrets" line; errors still reach stderr.
exec infisical run --domain "$INFISICAL_DOMAIN" --projectId "$ids" --env "$environment" --path "$folder" \
  --silent --log-level error -- "$@"
