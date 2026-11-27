# Nomenclature

The layout and the names of every resource Pi loads, in every repository of ours that holds some: `~/.pi/agent` and
each `pi-<domain>` of `~/.config/pi`. One shape everywhere, so that a resource is found by guessing its path and the
load patterns of `~/.config/pi/package.json` keep matching it. A vendored package keeps upstream's names, and a Pi
package of `pi-vendor/packages/` keeps Pi's package layout.

## Layout

```
skills/<skill>/SKILL.md
skills/<skill>/references/<topic>.md
skills/<skill>/scripts/<verb>-<object>.<extension>
skills/<skill>/assets/<name>.<extension>
extensions/<extension>/index.ts
extensions/<extension>/<module>.ts
extensions/<extension>/<module>.test.ts
prompts/<domain>-<verb>.md
tests/<script>.test.sh
```

- An extension is always a directory, even with one file: its entry point is `index.ts`, the other files are modules
  it imports.
- The test of an extension module sits beside it. The test of a skill's script goes in `tests/` at the root of the
  repository, because every file of a skill directory must be one its `SKILL.md` names.
- A skill directory holds `SKILL.md`, `references/`, `scripts/` and `assets/`, nothing else.
- A repository's rules are in its `AGENTS.md`. None of our repositories has a `CLAUDE.md`: the only one allowed is
  the global `~/.claude/CLAUDE.md`, which sends Claude Code to Pi's global `AGENTS.md`.

## Names

- Every directory and file name is lowercase kebab-case with whole words (`copy-secret.sh`, not `cpsecret.sh`).
  `SKILL.md`, `AGENTS.md` and `README.md` keep the capitals their readers expect.
- A skill is named after the tool when it holds our rules for one tool, otherwise after the activity. A skill, an
  extension or a prompt of a `pi-<domain>` repository starts with `<domain>-`, or is `<domain>` alone, so that its
  name shows where it comes from once it is loaded next to the public ones.
- A script is `<verb>-<object>`: its name says what running it does.
- An extension is named after what it adds to Pi (`footer`, `claude-skills`).
- A prompt is `<domain>-<verb>`, and its description names the skill it loads.

## Inside a `SKILL.md`

- The title is `# <Name>: <what it covers>`, where `<Name>` is the skill's name or, in a `pi-<domain>` repository,
  the domain.
- The description starts with `Our rules for <thing> - <what they decide>.`, then `Use when ...`.
- Section headings are unnumbered and carry no emphasis (`(mandatory)`, capitals): a section's order and weight come
  from its place and its text.

## Check

`sh scripts/check-layout.sh <repository>` (path relative to this skill) prints nothing when the layout, the names and
every skill of the repository follow this file.
