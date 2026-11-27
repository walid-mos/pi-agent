# Global rules

## Language

- Everything you write must always be in English: code, comments, commit messages, documentation, config files, AGENTS.md files, etc.
- Only use another language when the user explicitly asks for it.

## Skills

- Before creating, editing, renaming or deleting any skill, in any skills directory, read the `harness` skill and
  follow it, even for a one-line change.

## Code and documentation

- The code is the context: to learn what exists, how something works or what a value is, read the code (with its
  configuration and what its commands print), because it is what actually runs. Documentation (a README, an
  `AGENTS.md` or `CLAUDE.md`, a skill, a comment) holds what the code cannot say: intent, decisions and their
  reasons, constraints, traps, and the file or command to start from.
- Where documentation describes the code and disagrees with it, the code is right: fix or delete the documentation in
  the same change if you are changing either, otherwise tell the user. Where documentation states a rule or an
  intended behaviour that the code breaks, the code is wrong: say so and keep the rule.

## What you tell the user

- State as a fact only what you checked in this session on the thing itself: its configuration, its logs, a command
  you ran. A design document, a manual or your memory says what was intended, not what runs. Say "not checked" for
  the rest before the user has to ask.
- Write for someone who was not watching: plain words, a term explained the first time it appears, and for each open
  point what it changes for them and what you recommend. Leave out what changes nothing for them.

## Git workflow

- Commit atomically: each commit is a small, self-contained change that builds, passes the tests and breaks
  nothing. Never bundle unrelated changes in one commit.
- Push according to the repository's rules (its AGENTS.md, CONTRIBUTING or equivalent). When the repository says
  nothing, push. When it says pushing is left to a human, commit only and tell the user the commits are waiting to be
  pushed.
- Every commit message follows commitlint: the repository's commitlint config when it has one, otherwise the
  Conventional Commits format (`type(scope): subject`) of `@commitlint/config-conventional`.

## Harmful events

Never produce any of these, in any repository, whatever the size or urgency of the change. If a task seems to require
one, stop and say so. Removing one is never a question for the user, even when it changes a design: do it, test
first, and report it.

- **Tautological tests**: a test that cannot fail when the behaviour it names is broken. It asserts what a mock was
  told to return, recomputes the expected value with the implementation's own logic, or only checks that code ran.
- **Tests without a known bug**: a test is written for one reason, to keep a known bug from coming back: reproduce
  the bug in a test, see it fail for that reason, then fix the bug. New code gets no test, before or after it is
  written, for coverage or as a suite. The tests a repository already has stay, and are kept passing.
- **Hidden state machines**: behaviour that depends on a state nobody declared, such as a combination of booleans,
  nullable fields or the order of calls. When something has states, name them in one type and write the transitions
  in one place.
- **Hidden fallbacks**: when the intended path fails, quietly switching to another one (a default value, a stale or
  cached copy, a mock, another provider, a degraded mode), so the caller and the user cannot tell the result is not
  the real one. A fallback exists only when asked for, and each time it triggers it is logged and visible to the caller.
- **Silenced errors**: catching an error and carrying on without logging it or failing (an empty `catch`, `|| true`,
  `2>/dev/null` on a command whose failure matters, an ignored return code). A caught error is either handled and
  logged with its cause, or it fails hard.
- **Documentation that goes stale**: writing in documentation something that turns false when the code changes or
  time passes, with no error or check to reveal it: a fact the code holds (a file tree, a list of every file,
  function, option or section, a count, a version, a default value, copied code or output), a link or path pinned to
  a version, a commit, a line or a heading, a restatement of another document's contents, or what only held when it
  was written (`currently`, `new`, the story of the change). Name the file or command that holds such a fact when the
  reader would not find it otherwise, else write nothing: a vaguer sentence is not a fix. A path, a name, or a command
  with the options a task needs is a pointer, not a copy, since following it fails once it is wrong: keep it exact. A
  copy is written only when the user asks for one.
- **Idle waiting**: letting time pass instead of working. A fixed delay (`sleep`, a timer, a retry or polling loop)
  is never the way to wait for anything: start whatever is slow in the background and let its event resume you (its
  exit, a line of its output, a report from the agent you started, a watcher on the file or the stream). While it
  runs, do every piece of work that does not depend on it: a review, a CI run or a test suite runs alongside the next
  step and its findings are applied when they arrive, it does not hold the next step back. Sleeping and
  then reading its output or its status again is polling, not work. When nothing independent is left to do, end your
  turn: what you started in the background reports its end to you, and that report resumes you. Give whatever can
  hang a time limit, so that being stuck is reported too instead of leaving you waiting for nothing.
- **Silent blockers**: losing time on something that will not unblock by itself (a permission or trust prompt, an
  agent you started that sits at a prompt or never took its task, a missing access or secret, a delay imposed by a
  tool or a registry, a decision that is the user's) without the user knowing. As soon as you meet one, take the
  intended non-blocking path if there is one, never a hack (forcing input past a check, disabling or loosening the
  check that blocks). Otherwise tell the user at once what is blocked, the exact action that unblocks it and what you
  carry on with meanwhile, then carry on with it. A blocker met by an agent you started is yours to pass on to the
  user the same way, with one exception: a harmless prompt of that agent is yours to accept at once, without asking.
  Harmless means a trust prompt for a folder of the user's machine, or a permission prompt for an action that
  destroys nothing, can be undone and reaches nobody outside the machine. A prompt for anything else stays the
  user's.

## Secrets

- Every machine secret (an API key, a token, a client secret, an environment variable) of every repository, the
  user's own or a client's, lives in the user's Infisical and reaches a program only at run time. Never create or fill
  a `.env` with a secret; read the `infisical` skill before any task that needs a secret or an environment variable.
- Website logins (a username, a password, a one-time code typed into a web page) live in Bitwarden, not in Infisical.
  An agent uses only the accounts of its own Bitwarden collection, as the `web` skill says, never the user's personal
  logins. The credentials that open the agent's Bitwarden account are machine secrets and live in Infisical.
- Infisical stays outside every repository: nothing of it is committed or pushed, unless that repository's
  `AGENTS.md` records the user's decision to integrate it.
