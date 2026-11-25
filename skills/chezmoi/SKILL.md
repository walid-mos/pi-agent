---
name: chezmoi
description: Our rules for the user's dotfiles, which chezmoi deploys from a git repository and `dots` saves - how a change to one of them reaches that repository and the user's other machines. Use before creating, editing, renaming or deleting a file chezmoi manages (shell, git, ssh, editor, terminal and app configuration under the home directory, such as `~/.config/zsh`, `~/.config/nvim`, `~/.gitconfig` or `~/.claude/settings.json`) or a file of the chezmoi repository itself, even for a one-line change, when a tool result carries a `[chezmoi]` note, and whenever the user mentions dotfiles, chezmoi or `dots`.
---

# chezmoi: the user's dotfiles

chezmoi deploys the dotfiles from a git repository (`chezmoi source-path` prints where it is). A change is finished
only when the deployed file, the repository and its remote all hold it: every push is then applied on the user's
other machines by itself, so a change left on one machine is a stale file everywhere else.

## Know whether a file is managed

`chezmoi source-path <file>` prints the repository file behind a deployed file, and fails when chezmoi does not
manage it. Run it before changing a configuration file under the home directory that no git repository tracks:
nothing in its path says it is managed.

The `chezmoi` extension adds a `[chezmoi]` note to the result of an `edit` or `write` on a managed file. A change
made through `bash` gets no note.

## Save each change with `dots -m`

Edit the deployed file where it is. Then, before reporting the work as done:

```sh
dots -m "<type(scope): subject>" <file>...
```

- Name only the files of one self-contained change, and make one call per change: `dots -m` commits those files
  alone under that message, scans them for secrets and pushes. The header of the script (`command -v dots`)
  describes every case.
- A new file that belongs with the dotfiles (its directory holds managed files) is added by the same command.
- Exit status 0 means saved and pushed. Any other means the change is not saved: the message says what to do, do it
  and run the same command again. If it still fails, tell the user the change is not saved and why.
- Never run `dots` without `-m`: it commits everything pending on the machine in one commit, which includes changes
  that are not yours. It is the user's own command.
- Never commit in the chezmoi repository with git yourself: `dots -m` is what refuses a secret and a file that would
  stay out of step.
- When gitleaks blocks the commit, the file holds a secret. Take it out of the file (see the `infisical` skill);
  never bypass the scan.
- The repository can hold pending changes that are not yours. Leave them as they are.

## A file rendered from a template

When `chezmoi source-path <file>` ends in `.tmpl` or names a `modify_` script, chezmoi cannot copy the deployed file
back, and `dots -m` refuses it. Put the change in the repository file, run `chezmoi apply <deployed file>`, check the
deployed file, then give the repository file to `dots -m`.

`~/.claude/settings.json` is the exception: edit it where it is and give it to `dots -m`.

Files that exist only in the repository (`.chezmoiignore`, `.chezmoiexternal.toml`, `README.md`, a `run_` script)
are edited there and given to `dots -m` the same way. A `run_` script runs at the next `chezmoi apply` of the
machine it is applied on, and the other machines apply pushes without scripts: when a script must run elsewhere,
tell the user.

## Remove or rename a file

Note `chezmoi source-path <file>` first. `chezmoi forget --force <file>` stops managing the file and keeps it
deployed; `chezmoi destroy --force <file>` also deletes it. Then give the noted repository path to `dots -m`, which
commits the deletion.

A rename is the move of the deployed file, `chezmoi forget --force <old path>`, then one `dots -m` naming the old
repository path and the new deployed file.

## Other machines

Pushing is the whole job: each of the user's machines pulls the repository and applies it when the push arrives. Do
not run chezmoi on another machine to bring it a change.
