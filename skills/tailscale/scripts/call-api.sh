#!/bin/bash
# usage: call-api.sh METHOD PATH [curl args...]   (PATH is relative to https://api.tailscale.com/api/v2/)
# The OAuth client secret is read from Infisical (core:/tools/tailscale) and stays in memory;
# the access token reaches curl through a file descriptor. Neither is ever printed or passed as an argument.
# The HTTP status is printed on stderr ("HTTP 200"); curl exits non-zero (22) for any status >= 400, body still printed.
# Responses that contain credentials (POST tailnet/-/keys) must go to a file: "-o FILE" is required for them.
set -euo pipefail
. "${INFISICAL_CORE_ENV:-$HOME/.config/infisical/core.env}"
export TS_METHOD="$1" TS_PATH="$2"; shift 2
if [ "$TS_METHOD" = POST ] && [[ "$TS_PATH" == */keys ]] && [[ " $* " != *" -o "* ]]; then
  echo "refusing POST $TS_PATH without -o FILE: the response contains a credential" >&2; exit 2
fi
export TS_EXTRA=""; if [ $# -gt 0 ]; then TS_EXTRA="$(printf "%q " "$@")"; fi
exec infisical run --domain "$INFISICAL_DOMAIN" --projectId "$INFISICAL_CORE_ID" --env main --path /tools/tailscale --silent -- bash -c '
set -euo pipefail
s="$TAILSCALE_ADMIN_OAUTH_CLIENT_SECRET"; unset TAILSCALE_ADMIN_OAUTH_CLIENT_SECRET
id="${s#tskey-client-}"; id="${id%%-*}"
tok=$(printf "client_id=%s&client_secret=%s&grant_type=client_credentials" "$id" "$s" \
  | curl -fsS https://api.tailscale.com/api/v2/oauth/token -d @- | jq -r ".access_token // empty")
unset s
[ -n "$tok" ] || { echo "could not get a Tailscale access token" >&2; exit 1; }
eval "extra=($TS_EXTRA)"
curl -sS --fail-with-body -X "$TS_METHOD" -H @<(printf "Authorization: Bearer %s\n" "$tok") -w "%{stderr}HTTP %{http_code}\n" \
  ${extra[@]+"${extra[@]}"} "https://api.tailscale.com/api/v2/$TS_PATH"
'
