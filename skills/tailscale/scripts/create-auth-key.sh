#!/bin/bash
# usage: create-auth-key.sh TAG DESCRIPTION SSH_TARGET REMOTE_FILE
# Creates a one-time, pre-authorized, non-ephemeral auth key tagged TAG (valid 1 hour) and writes
# "TS_AUTHKEY=<key>" into REMOTE_FILE (0600) on SSH_TARGET. The key never reaches stdout, stderr or an argument.
# Prints only the key ID and whether the SHA-256 of the remote file matches.
set -euo pipefail
[ $# -eq 4 ] || { echo "usage: create-auth-key.sh TAG DESCRIPTION SSH_TARGET REMOTE_FILE" >&2; exit 2; }
tag="$1"; desc="$2"; target="$3"; remote="$4"
[[ "$tag" == tag:* ]] || { echo "TAG must start with tag:" >&2; exit 2; }
here="$(cd "$(dirname "$0")" && pwd)"
umask 077
d="$(mktemp -d)"; trap 'find "$d" -type f -exec sh -c "rm -P \"\$1\" 2>/dev/null || shred -u \"\$1\" 2>/dev/null || rm -f \"\$1\"" _ {} \; ; rmdir "$d"' EXIT
body=$(jq -nc --arg t "$tag" --arg d "$desc" \
  '{capabilities:{devices:{create:{reusable:false,ephemeral:false,preauthorized:true,tags:[$t]}}},expirySeconds:3600,description:$d}')
"$here/call-api.sh" POST tailnet/-/keys -H 'Content-Type: application/json' -d "$body" -o "$d/resp.json"
jq -e '.key' "$d/resp.json" >/dev/null || { echo "key creation failed: $(jq -r '.message // "unknown error"' "$d/resp.json")" >&2; exit 1; }
echo "key id: $(jq -r '.id' "$d/resp.json")"
jq -j '"TS_AUTHKEY=" + .key + "\n"' "$d/resp.json" > "$d/line"
ssh -o BatchMode=yes "$target" "umask 077; cat > '$remote'; chmod 600 '$remote'" < "$d/line"
a=$(shasum -a 256 < "$d/line" | cut -d' ' -f1)
b=$(ssh -o BatchMode=yes "$target" "sha256sum < '$remote' 2>/dev/null || shasum -a 256 < '$remote'" | cut -d' ' -f1)
[ "$a" = "$b" ] && echo "written to $target:$remote (0600), SHA-256 matches" || { echo "remote copy DIFFERENT" >&2; exit 1; }
