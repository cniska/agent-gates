# Claude Code Plugin

The optional `cniska-gates` plugin in `plugin/` saves a Claude Code agent the round trip through the gates, which stay the check for every contributor.

## After each edit

After each `Edit`, `Write` or `MultiEdit`, in a repo that commits `.githooks/no-comments/scan.cjs`, the plugin runs `scan.cjs --file` on the edited file and hands the agent the scanner's reply, so it removes the comments before it commits. It never blocks an edit, never changes a file, and does nothing in a repo without the gate. It needs `jq` and `node` on `PATH`; without either, or with a scanner too old for `--file`, it leaves only a note on stderr.

## The skip block

Before each `Bash` command, the plugin judges each git command against the repo that command targets, after any `cd` before it and its own `git -C`. In a repo whose `.githooks` hooks carry agent-gates' markers, it denies a git command that skips the gates: `git commit` or `git push` with `--no-verify`, `git commit` with `-n`, and `core.hooksPath` set by `-c` or `git config`, or unset, to anything but `.githooks`.

- The denial names the gates the command skips, so the agent fixes what the refusing gate names instead. CI refuses what they refuse anyway, so the block saves the round trip.
- A command into a repo without the gates, such as a fresh scratch repo, passes.
- Text inside a quoted string, such as a commit message, or the body of a heredoc `cat`, `tee` or `git` reads with nothing piped after it, is not read as a command.
- Edits to installed gate files are never blocked, since install writes them.

## Install

```bash
claude plugin marketplace add cniska/agent-skills
claude plugin install cniska-gates@cniska
```
