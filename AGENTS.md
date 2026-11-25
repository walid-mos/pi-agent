# Global rules

## Language

- Everything you write must always be in English: code, comments, commit messages, documentation, config files, AGENTS.md files, etc.
- Only use another language when the user explicitly asks for it.

## Skills

- Before creating, editing, renaming or deleting any skill, in any skills directory, read the `harness` skill and
  follow it, even for a one-line change.

## Harmful events

Never produce any of these, in any repository, whatever the size or urgency of the change. If a task seems to require
one, stop and say so.

- **Tautological tests**: a test that cannot fail when the behaviour it names is broken. It asserts what a mock was
  told to return, recomputes the expected value with the implementation's own logic, or only checks that code ran.
- **Tests outside red-green-refactor before QA**: until a feature has been battle-tested by QA, its only tests are the
  ones TDD produces: written before the code, seen failing for the expected reason, then made to pass. No test added
  after the fact, for coverage or as a broad suite before that point.
- **Hidden state machines**: behaviour that depends on a state nobody declared, such as a combination of booleans,
  nullable fields or the order of calls. When something has states, name them in one type and write the transitions
  in one place.
- **Hidden fallbacks**: when the intended path fails, quietly switching to another one (a default value, a stale or
  cached copy, a mock, another provider, a degraded mode), so the caller and the user cannot tell the result is not
  the real one. A fallback exists only when asked for, and each time it triggers it is logged and visible to the caller.
- **Silenced errors**: catching an error and carrying on without logging it or failing (an empty `catch`, `|| true`,
  `2>/dev/null` on a command whose failure matters, an ignored return code). A caught error is either handled and
  logged with its cause, or it fails hard.
