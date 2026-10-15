# Claude Code Plugin

The optional `cniska-gates` plugin in `plugin/` saves a Claude Code agent the round trip through the gates, which stay the check for every contributor.

## After each edit

After each `Edit`, `Write` or `MultiEdit`, the plugin formats the edit, then judges its comments, and hands the agent one context holding what each step found. It never blocks an edit, and does nothing in a repo without the gates. It needs `jq` on `PATH`; without it, it leaves only a note on stderr.

- **Format.** In a repo that commits the `format` gate, the plugin runs `.githooks/pre-commit.d/format --run`, so the project's own command formats the edited file before the scan reads it. The index stays as it was. A run that succeeds says nothing. A command that fails, or runs past 30 s and is stopped with every process it started, gives the agent one line naming the command and its exit. A hook from before `--run` is left alone, with a note on stderr that `agent-gates install` updates it. Bounding the run needs `sleep` on `PATH`; without it the run is not bounded, and Claude Code still stops the whole hook at 60 s.
- **Comments.** In a repo that commits `.githooks/no-comments/scan.cjs`, the plugin runs `scan.cjs --file` on the edited file and hands the agent the scanner's reply, so it removes the comments before it commits. It needs `node` on `PATH`; without it, it leaves only a note on stderr. A scanner from before `--file` is left alone, with a note on stderr that `agent-gates install` updates it.

## At session start

When a session starts, the plugin tells the agent which gates the checkout installs, so it learns them before its first commit rather than from a refusal. It reads each gate from its marker alone: `format` from `.githooks/pre-commit.d/format`, each `no-comments-<language>` from its `.githooks/no-comments/<language>.cjs` and `commit-subject` from `.githooks/commit-msg`. It never looks at the project's own scripts.

- The note names the format command and the commit prefixes as the installed hooks hold them.
- For each gate it says what the gate refuses at commit, and the note ends by saying that a refusal names what to fix. For `commit-subject` and the no-comments gates it also says whether a push is judged, which needs the gate's `.githooks/pre-push.d/` step installed. For `format` and the no-comments gates it says what the plugin does after an edit, or that it does nothing until `agent-gates install` updates a format hook or scanner too old for the plugin to use.
- The gates run only while `core.hooksPath` resolves to `.githooks`. In a clone where it does not, the note names no refusal and says instead that the gates do not run until `core.hooksPath` is `.githooks`.
- In a checkout without the gates, or outside one, it says nothing. Without `jq` it leaves only a note on stderr.

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
