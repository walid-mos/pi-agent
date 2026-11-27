#!/bin/sh
# check-skill.sh <skill-dir>... : mechanical checks on our skills. Prints one line per problem, nothing on success.
# Exit status: 0 = clean, 1 = at least one problem, 2 = usage error.
set -u

NAME_MAX=64          # Agent Skills specification: name is 1-64 characters
DESC_MAX=1024        # Agent Skills specification: description is 1-1024 characters
BODY_MAX=500         # Agent Skills specification: keep SKILL.md under 500 lines
TOC_FROM=100         # past this length a reference file is often read partially, so it needs a table of contents
# references/nomenclature.md: every name is lowercase kebab-case, with any number of extensions (.test.ts)
KEBAB='^[a-z0-9]+(-[a-z0-9]+)*(\.[a-z0-9]+)*$'

[ $# -ge 1 ] || { echo "usage: sh check-skill.sh <skill-dir>..." >&2; exit 2; }

status=0
for dir in "$@"; do
  dir=${dir%/}
  f="$dir/SKILL.md"
  fail() { echo "$f: $*"; status=1; }

  [ -f "$f" ] || { echo "$dir: no SKILL.md (pass the skill directory, not a file)"; status=1; continue; }

  # Frontmatter: line 1 is '---', closed by the next '---'.
  [ "$(sed -n 1p "$f")" = "---" ] || { fail "line 1 must be '---' (frontmatter)"; continue; }
  end=$(awk 'NR>1 && $0=="---" {print NR; exit}' "$f")
  [ -n "$end" ] || { fail "frontmatter is never closed by '---'"; continue; }
  front=$(sed -n "2,$((end - 1))p" "$f")

  name=$(printf '%s\n' "$front" | sed -n 's/^name:[[:space:]]*//p' | head -n 1)
  desc=$(printf '%s\n' "$front" | sed -n 's/^description:[[:space:]]*//p' | head -n 1)

  if [ -z "$name" ]; then
    fail "frontmatter has no 'name:'"
  else
    printf '%s' "$name" | grep -Eq '^[a-z0-9]+(-[a-z0-9]+)*$' ||
      fail "name '$name' must be lowercase letters, digits and single hyphens"
    [ "${#name}" -le "$NAME_MAX" ] || fail "name is ${#name} characters, the limit is $NAME_MAX"
    [ "$name" = "$(basename "$(cd "$dir" && pwd)")" ] ||
      fail "name '$name' differs from the directory name '$(basename "$(cd "$dir" && pwd)")'"
  fi

  case "$desc" in
    "")       fail "frontmatter has no one-line 'description:'" ;;
    "|"*|">"*) fail "write the description on one line, not as a YAML block" ;;
    *)
      n=$(printf '%s' "$desc" | wc -m | tr -d ' ')
      [ "$n" -le "$DESC_MAX" ] || fail "description is $n characters, the limit is $DESC_MAX"
      printf '%s' "$desc" | grep -Eqi '(^|[^a-z])use (when|whenever|before|for) ' ||
        fail "description never says when to load the skill (add 'Use when ...')"
      ;;
  esac

  case "$desc" in
    "Our rules for "*) ;;
    *) fail "description must start with 'Our rules for ' (references/nomenclature.md)" ;;
  esac

  title=$(sed "1,${end}d" "$f" | grep -m 1 '^# ')
  printf '%s' "$title" | grep -Eq '^# [^:]+: .+' ||
    fail "title '$title' must be '# <Name>: <what it covers>' (references/nomenclature.md)"
  sed "1,${end}d" "$f" | grep -En '^#+ +[0-9]+[.)] ' | while IFS= read -r line; do
    echo "$f: numbered heading '${line#*:}' (references/nomenclature.md)"
  done
  sed "1,${end}d" "$f" | grep -Eq '^#+ +[0-9]+[.)] ' && status=1

  # Names and layout of the skill directory.
  for p in "$dir"/* "$dir"/.[!.]*; do
    [ -e "$p" ] || continue
    case "$(basename "$p")" in
      SKILL.md|references|scripts|assets) ;;
      *) fail "$(basename "$p") is not SKILL.md, references/, scripts/ or assets/" ;;
    esac
  done
  for sub in scripts references assets; do
    [ -d "$dir/$sub" ] || continue
    for p in "$dir/$sub"/*; do
      [ -e "$p" ] || continue
      base=$(basename "$p")
      printf '%s' "$base" | grep -Eq "$KEBAB" || fail "$sub/$base is not lowercase kebab-case"
      if [ "$sub" = scripts ]; then
        case "${base%%.*}" in *-*) ;; *) fail "scripts/$base must be named <verb>-<object>" ;; esac
      fi
    done
  done

  body=$(($(wc -l < "$f") - end))
  [ "$body" -le "$BODY_MAX" ] ||
    fail "body is $body lines, the limit is $BODY_MAX: move a section to references/ and link it"

  # Every bundled file is named in SKILL.md, otherwise no agent will ever open it.
  for sub in scripts references assets; do
    [ -d "$dir/$sub" ] || continue
    for p in "$dir/$sub"/*; do
      [ -e "$p" ] || continue
      rel="$sub/$(basename "$p")"
      grep -Fq "$rel" "$f" || fail "$rel is never mentioned in SKILL.md"
      if [ "$sub" = references ] && [ "$(wc -l < "$p")" -gt "$TOC_FROM" ]; then
        head -n 15 "$p" | grep -Eqi '^#+ *(contents|table of contents)' ||
          fail "$rel is longer than $TOC_FROM lines and has no '## Contents' at the top"
      fi
    done
  done

  # Every bundled path named in SKILL.md exists (paths starting with ~ or / are outside the skill: not checked).
  for rel in $(sed "1,${end}d" "$f" | grep -oE '[A-Za-z0-9._~/-]*(scripts|references|assets)/[A-Za-z0-9._-]+' | sort -u); do
    case "$rel" in "~"*|/*) continue ;; esac
    [ -e "$dir/${rel%.}" ] || fail "mentions $rel, which does not exist"
  done
done
exit "$status"
