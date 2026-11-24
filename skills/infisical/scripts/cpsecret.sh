#!/bin/bash
# usage: cpsecret.sh SRC_PROJECT SRC_ENV SRC_PATH SRC_NAME DST_PROJECT DST_ENV DST_PATH DST_NAME
# Copies one secret without ever printing it or passing it as an argument, then compares SHA-256 hashes.
# Projects are IDs (see ref.sh VAULT_<NAME>_ID). Login profile: set INFISICAL_PROFILE explicitly when several exist.
# Creates the destination folder if needed. Copies only; to move, delete the source afterwards (see SKILL.md).
set -euo pipefail
. "${INFISICAL_CORE_ENV:-$HOME/.config/infisical/core.env}"
umask 077
d="$(mktemp -d)"; trap 'find "$d" -type f -exec sh -c "rm -P \"\$1\" 2>/dev/null || shred -u \"\$1\"" _ {} \; ; rmdir "$d"' EXIT
D=(--domain "$INFISICAL_DOMAIN")
infisical sm secrets get "${D[@]}" --projectId "$1" --env "$2" --path "$3" --include-imports=false --expand=false --secret-overriding=false -o json --silent > "$d/src.json"
jq -e --arg k "$4" 'any(.[]; .secretKey==$k)' "$d/src.json" >/dev/null || { echo "$3/$4: not found at source" >&2; exit 1; }
jq -j --arg k "$4" '.[] | select(.secretKey==$k) | .secretValue' "$d/src.json" > "$d/v"
cur=/; IFS=/ read -ra parts <<< "${7#/}"
for part in ${parts[@]+"${parts[@]}"}; do [ -n "$part" ] || continue
  infisical sm folders get "${D[@]}" --projectId "$5" --env "$6" --path "$cur" -o json --silent | jq -e --arg n "$part" '(.//[]) | map(.name) | index($n)' >/dev/null \
    || infisical sm folders create "$part" "${D[@]}" --projectId "$5" --env "$6" --path "$cur" --silent >/dev/null
  cur="${cur%/}/$part"; done
infisical secrets set "${D[@]}" --projectId "$5" --env "$6" --path "$7" --silent "$8=@$d/v" >/dev/null
infisical sm secrets get "${D[@]}" --projectId "$5" --env "$6" --path "$7" --include-imports=false --expand=false --secret-overriding=false -o json --silent > "$d/dst.json"
a=$(shasum -a 256 < "$d/v")
b=$(jq -j --arg k "$8" '.[] | select(.secretKey==$k) | .secretValue' "$d/dst.json" | shasum -a 256)
if [ "$a" = "$b" ]; then echo "$3/$4 -> $7/$8: hashes match"; else echo "$3/$4 -> $7/$8: DIFFERENT" >&2; exit 1; fi
