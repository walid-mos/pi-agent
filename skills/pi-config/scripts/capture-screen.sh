#!/bin/sh
# capture-screen.sh [options] [-- pi arguments] : runs capture-screen.py in its own virtualenv, created on first use.
# `capture-screen.sh --help` lists the options. Exit status: capture-screen.py's, or 1 when the virtualenv cannot be set up.
set -eu

# Outside the repository: the skill directory is tracked by git.
VENV="${XDG_CACHE_HOME:-$HOME/.cache}/pi-config/capture-screen-venv"
# capture-screen.py subclasses pyte's Screen and relies on its internals, so every dependency stays at the tested version.
DEPS="pyte==0.8.2 pillow==13.0.0 fonttools==4.69.1"

if [ ! -f "$VENV/.deps" ] || [ "$(cat "$VENV/.deps")" != "$DEPS" ]; then
  rm -rf "$VENV"
  python3 -m venv "$VENV" >&2 || { echo "capture-screen: cannot create $VENV with python3; install Python 3 and retry" >&2; exit 1; }
  # shellcheck disable=SC2086 # DEPS is a list of requirements
  "$VENV/bin/pip" install --quiet --disable-pip-version-check $DEPS >&2 ||
    { echo "capture-screen: installing $DEPS into $VENV failed (network?); fix it and retry" >&2; rm -rf "$VENV"; exit 1; }
  printf '%s' "$DEPS" > "$VENV/.deps"
fi
exec "$VENV/bin/python" "$(dirname "$0")/capture-screen.py" "$@"
