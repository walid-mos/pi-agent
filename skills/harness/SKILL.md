---
name: harness
description: Our rules for authoring agent skills in this Pi harness - whether a rule belongs in a skill at all, where it goes, how a skill is named and its description routes, what a body may contain, how bundled scripts behave and how a skill is checked. Use before creating, editing, renaming, splitting, merging, reviewing or deleting any skill - a SKILL.md, its name or description, or any script, reference or asset in a skill directory - whether the skill is ours, a project's or vendored, even for a one-line change.
---

# Harness: authoring skills

A skill is a prompt loaded on demand. Its description sits in the system prompt of every session on every machine; its
body competes with the task it is loaded for. So a skill holds only what an agent got wrong or could not find, in as
few lines as possible.

For the format itself (frontmatter fields, discovery locations, `/skill:name`, `/reload`), read Pi's `docs/skills.md`
(its path is in the system prompt, under "Additional docs") rather than relying on memory.

## 1. Know why the change exists

A rule enters a skill for one of two reasons: an agent made a mistake that was seen (what was asked, what it did, what it
should have done), or the user stated the rule. Write that reason in one sentence; it goes in the commit message, not
in the skill. If there is neither, there is nothing to encode: tell the user and stop.

## 2. Put it in the right place

| The rule... | Goes in |
|---|---|
| can be checked or done by a program | a script, a linter or a Pi extension (`tool_call` can block a call), not prose |
| applies to every task in every repository | `~/.pi/agent/AGENTS.md`, in a line or two |
| applies to one repository | that repository's `AGENTS.md` |
| matters only for one kind of task | a skill: ours in `~/.pi/agent/skills/<name>/`, a project's in that project |
| is private to one client or company (its names, repositories, colleagues, tools) | a skill in that domain's private repository, `~/.config/pi/pi-<domain>/skills/`, never in this public repository |
| is third-party product documentation | a vendored package in `~/.config/pi/pi-vendor`, which we never edit |

Our rules about a vendored skill's product go in a skill of ours whose description says it takes precedence (as
`infisical` does). Extend an existing skill before creating a new one; a new skill needs a kind of task no existing
description covers.

## 3. Name and description

- Name the skill after the tool or the activity it covers (`tailscale`, `infisical`, `writing-migrations`): lowercase,
  digits and single hyphens, the same as its directory. Never a vague name (`helper`, `utils`, `tools`, `misc`) or one
  containing `anthropic` or `claude`. Follow the pattern of the skills next to it.
- One clause on what the skill covers, then `Use when ...` with the situations and the words a user would actually say.
- No workflow steps: an agent that finds the steps in the description follows them and skips the body.
- Third person, one line, at most 1024 characters.
- If the skill must load for a whole class of actions, name every action and add `even for a one-line change`.
- If it overlaps another skill, name that skill and say which one wins.

## 4. Body

- Keep only what a capable agent would not know or would get wrong here: our decisions, our constraints, traps we hit,
  exact commands. No general explanations, no tour of files the agent can list itself.
- Match the freedom to the risk. Fragile or irreversible operations get exact commands, a checklist or a script.
  Judgement calls get the goal, the constraint and the reason.
- Give each rule its reason in a clause. A rule with a reason is applied to cases you did not foresee; a shouted rule
  is applied literally or not at all, so no capitals for emphasis.
- Give one default way to do each thing. Add an alternative only with the observable condition that calls for it
  (`use X; if the file is binary, use Y`); a list of equal options makes the agent hesitate or pick at random.
- State the shape you want (`the report is: verdict, evidence, next step`). Keep prohibitions for things agents do
  while knowing better.
- Tie every condition to something observable (`if the file is missing, stop and ask`). "Unless it matters" is not a
  condition.
- One term per concept, the same one throughout.
- Nothing that rots: no dates, versions, "currently", or story of the session that produced the rule. Point to the
  source of truth (`<tool> --help`, a manual, a file) instead of copying it, as `herdr` does.
- No private or machine-specific value (address, ID, hostname, account, token): this repository is shared between
  machines. Such values are read at run time, see the `infisical` skill.
- Everything is in English.

## 5. Size and references

Keep `SKILL.md` under 500 lines. When a section serves only some of the skill's tasks, move it to a file in
`references/` and link it from `SKILL.md` with the situation in which to read it. Link every reference file directly
from `SKILL.md` (an agent reading a file it reached through another reference often reads only its first lines), and
start any reference longer than 100 lines with a `## Contents` list.

## 6. Scripts

- A deterministic operation is a script in `scripts/`, and `SKILL.md` says whether to run it or to read it.
- The script handles its own errors, says what to do about them, and exits non-zero.
- It prints nothing on success, or only what the agent needs: its output lands in the context and in the transcript.
  It never prints a secret.
- Every constant carries a comment giving its reason. `SKILL.md` lists the tools the script needs.

## 7. Before you finish

- [ ] `sh scripts/check.sh <skill-dir>` (path relative to this skill) prints nothing. It checks the frontmatter, the
      size limits and that bundled files and their mentions match.
- [ ] Reread the whole skill as an agent that has nothing else. Delete every line that agent would not miss.
- [ ] Renaming or deleting a skill: search the other skills, the `AGENTS.md` files and `README.md` for its name and fix
      every mention in the same change.
- [ ] A skill created, renamed or removed in `~/.pi/agent`: update the Contents list of `README.md` there.
- [ ] Give the user the diff.
