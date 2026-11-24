#!/bin/bash
# usage: ref.sh NAME        prints one NON-SECRET homelab reference value from core:/homelab/reference
#        ref.sh --list      prints the names only
# Refuses names that are not in /homelab/reference; references (${...}) and imports are never resolved,
# so it cannot be used to print a secret stored elsewhere.
set -euo pipefail
. "${INFISICAL_CORE_ENV:-$HOME/.config/infisical/core.env}"
j=$(infisical sm secrets get --domain "$INFISICAL_DOMAIN" --projectId "$INFISICAL_CORE_ID" --env main \
  --path /homelab/reference --include-imports=false --expand=false --secret-overriding=false -o json --silent)
if [ "${1:-}" = "--list" ]; then echo "$j" | jq -r '.[].secretKey'; exit; fi
echo "$j" | jq -e -r --arg k "$1" '.[] | select(.secretKey==$k) | .secretValue' \
  || { echo "$1: not in /homelab/reference" >&2; exit 1; }
