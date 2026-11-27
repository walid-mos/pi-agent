#!/bin/sh
# check-layout.sh <repository>... : checks that a repository holding Pi resources follows references/nomenclature.md:
# the layout and names of extensions/ and prompts/, then every skill of skills/ with check-skill.sh.
# Prints one line per problem, nothing on success. Exit status: 0 = clean, 1 = at least one problem, 2 = usage error.
set -u

# references/nomenclature.md: every name is lowercase kebab-case
KEBAB='^[a-z0-9]+(-[a-z0-9]+)*$'

[ $# -ge 1 ] || { echo "usage: sh check-layout.sh <repository>..." >&2; exit 2; }
here=$(cd "$(dirname "$0")" && pwd)

status=0
fail() { echo "$*"; status=1; }
kebab() { printf '%s' "$1" | grep -Eq "$KEBAB"; }

for repo in "$@"; do
  repo=${repo%/}
  [ -d "$repo" ] || { echo "$repo: not a directory" >&2; exit 2; }

  for p in "$repo"/extensions/*; do
    [ -e "$p" ] || continue
    name=$(basename "$p")
    [ -d "$p" ] || { fail "$p: an extension is a directory, extensions/<extension>/index.ts"; continue; }
    kebab "$name" || fail "$p: '$name' is not lowercase kebab-case"
    [ -f "$p/index.ts" ] || fail "$p: no index.ts"
    for m in "$p"/*; do
      [ -e "$m" ] || continue
      file=$(basename "$m")
      case "$file" in
        *.test.ts)
          kebab "${file%.test.ts}" || fail "$m: '$file' is not lowercase kebab-case"
          [ -f "$p/${file%.test.ts}.ts" ] || fail "$m: no ${file%.test.ts}.ts beside it" ;;
        *.ts) kebab "${file%.ts}" || fail "$m: '$file' is not lowercase kebab-case" ;;
        *) fail "$m: only <module>.ts and <module>.test.ts go in an extension" ;;
      esac
    done
  done

  for p in "$repo"/prompts/*; do
    [ -e "$p" ] || continue
    file=$(basename "$p")
    case "$file" in
      *.md) kebab "${file%.md}" || fail "$p: '$file' is not lowercase kebab-case" ;;
      *) fail "$p: only <domain>-<verb>.md goes in prompts/" ;;
    esac
  done

  for p in "$repo"/skills/*; do
    [ -e "$p" ] || continue
    [ -d "$p" ] || { fail "$p: skills/ holds one directory per skill"; continue; }
    sh "$here/check-skill.sh" "$p" || status=1
  done
done
exit "$status"
