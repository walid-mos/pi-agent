---
name: harness
description: Our rules for authoring agent skills, for Pi and Claude Code alike, and for naming and placing every resource Pi loads - whether a rule belongs in a skill at all, where it goes, how a skill, a script, an extension or a prompt template is named and laid out, how a description routes, what a body may contain, how bundled scripts behave and how the result is checked. Use before creating, editing, renaming, splitting, merging, reviewing or deleting any skill - a SKILL.md, its name or description, or any script, reference or asset in a skill directory - whether the skill is ours, a project's, vendored or loaded by Claude Code only (`~/.claude/skills`, a project's `.claude/skills`), and before creating, renaming or moving an extension, a prompt template or one of their files, even for a one-line change. What an extension does and how it is tested stay with `pi-config`.
---

# Harness: authoring skills

A skill is a prompt loaded on demand. Its description sits in the system prompt of every session on every machine; its
body competes with the task it is loaded for. So a skill holds only what an agent got wrong or could not find, in as
few lines as possible.

For the format itself (frontmatter fields, discovery locations, `/skill:name`, `/reload`), read `docs/skills.md` in
Pi's manual,
`~/.pi/agent/install/releases/$(cat ~/.pi/agent/install/current-version)/node_modules/@earendil-works/pi-coding-agent/docs/`,
rather than relying on memory.

## Know why the change exists

A rule enters a skill for one of two reasons: an agent made a mistake that was seen (what was asked, what it did, what it
should have done), or the user stated the rule. Write that reason in one sentence; it goes in the commit message, not
in the skill. If there is neither, there is nothing to encode: tell the user and stop.

## Put it in the right place

| The rule... | Goes in |
|---|---|
| can be checked or done by a program | a script, a linter or a Pi extension (`tool_call` can block a call), not prose |
| applies to every task in every repository | `~/.pi/agent/AGENTS.md`, in a line or two |
| applies to one repository | that repository's `AGENTS.md` |
| matters only for one kind of task | a skill: ours in `~/.pi/agent/skills/<name>/`, a project's in that project |
| is private to one client or company (its names, repositories, colleagues, tools) | a skill in that domain's private repository, `~/.config/pi/pi-<domain>/skills/`, never in this public repository |
| is third-party product documentation | a vendored package in `~/.config/pi/pi-vendor`, which we never edit |

Every skill Pi loads from the user's directories is Claude Code's too: at each Pi start, the `claude-skills`
extension links it into `~/.claude/skills`. So a skill is created, edited and removed where Pi loads it; one created
in `~/.claude/skills` stays Claude Code's alone.

Our rules about a vendored skill's product go in a skill of ours whose description says it takes precedence (as
`infisical` does). Extend an existing skill before creating a new one; a new skill needs a kind of task no existing
description covers.

## Name and description

- Read [references/nomenclature.md](references/nomenclature.md) before naming, creating, renaming or moving a skill,
  one of its files, an extension or a prompt template: it holds the layout and the names all our repositories share.
- Name the skill after the tool or the activity it covers (`tailscale`, `infisical`, `writing-migrations`), the same
  as its directory. Never a vague name (`helper`, `utils`, `tools`, `misc`) or one containing `anthropic` or `claude`.
- One clause on what the skill covers, then `Use when ...` with the situations and the words a user would actually say.
- No workflow steps: an agent that finds the steps in the description follows them and skips the body.
- Third person, one line, at most 1024 characters.
- If the skill must load for a whole class of actions, name every action and add `even for a one-line change`.
- If it overlaps another skill, name that skill and say which one wins.

## Body

- Keep only what a capable agent would not know or would get wrong here: our decisions, our constraints, traps we hit,
  exact commands. No general explanations, no tour of files the agent can list itself.
- Match the freedom to the risk. Fragile or irreversible operations get exact commands, a checklist or a script.
  Judgement calls get the goal, the constraint and the reason.
- Write for any agent: Pi and Claude Code both read the skill, so name a file by its path and a tool by what it
  does, never by what only one of them shows (Pi's system prompt, Claude Code's tool names).
- Give each rule its reason in a clause. A rule with a reason is applied to cases you did not foresee; a shouted rule
  is applied literally or not at all, so no capitals for emphasis.
- Give one default way to do each thing. Add an alternative only with the observable condition that calls for it
  (`use X; if the file is binary, use Y`); a list of equal options makes the agent hesitate or pick at random.
- State the shape you want (`the report is: verdict, evidence, next step`). Keep prohibitions for things agents do
  while knowing better.
- Tie every condition to something observable (`if the file is missing, stop and ask`). "Unless it matters" is not a
  condition.
- One term per concept, the same one throughout.
- Nothing that goes stale, as the global `AGENTS.md` defines it: point to the source of truth (`<tool> --help`, a
  manual, a file) instead of copying it, as `herdr` does.
- No private or machine-specific value (address, ID, hostname, account, token): this repository is shared between
  machines. Such values are read at run time, see the `infisical` skill.
- Everything is in English.

## Size and references

Keep `SKILL.md` under 500 lines. When a section serves only some of the skill's tasks, move it to a file in
`references/` and link it from `SKILL.md` with the situation in which to read it. Link every reference file directly
from `SKILL.md` (an agent reading a file it reached through another reference often reads only its first lines), and
start any reference longer than 100 lines with a `## Contents` list.

## Scripts

- A deterministic operation is a script in `scripts/`, and `SKILL.md` says whether to run it or to read it.
- The script handles its own errors, says what to do about them, and exits non-zero.
- It prints nothing on success, or only what the agent needs: its output lands in the context and in the transcript.
  It never prints a secret.
- Every constant carries a comment giving its reason. `SKILL.md` lists the tools the script needs.

## Before you finish

- [ ] `sh scripts/check-skill.sh <skill-dir>` (path relative to this skill) prints nothing. It checks the frontmatter,
      the title, the names, the size limits and that bundled files and their mentions match.
- [ ] After creating, renaming or moving a skill, an extension or a prompt template:
      `sh scripts/check-layout.sh <repository>` prints nothing. It checks the layout and names of the repository's
      extensions and prompt templates, then each of its skills with `check-skill.sh`.
- [ ] Reread the whole skill as an agent that has nothing else. Delete every line that agent would not miss.
- [ ] Renaming or deleting a skill: search the other skills, the `AGENTS.md` files and `README.md` for its name and fix
      every mention in the same change.
- [ ] Give the user the diff.
