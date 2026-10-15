# Gates

The files `agent-gates install` writes, how the hooks and workflows run them, and the `commit-subject` and `format` gates in detail; the [README](../README.md#gates) lists every gate with a summary of what it refuses, which this page states in full for `commit-subject` and `format`, and [No comments](no-comments.md) for the no-comments gates.

## Installed files

| Gate | Files in `.githooks/` | Workflow in `.github/workflows/` |
| --- | --- | --- |
| `commit-subject` | `commit-msg`, `pre-push`, `pre-push.d/commit-subject`, `judge-push` | `commits.yml` |
| `format` | `pre-commit`, `pre-commit.d/format` | none |
| `no-comments-<language>` | `pre-commit`, `pre-commit.d/no-comments`, `pre-push`, `pre-push.d/no-comments`, `judge-push`, `no-comments/scan.cjs`, `no-comments/<language>.cjs` | `no-comments.yml` |

Every gate also installs `.githooks/.gitattributes`. A file two gates list is installed once and shared.

Installed files:

- are committed with the project, so contributors and CI are gated without installing agent-gates;
- carry a marker, `# agent-gate:<part>:<version>` (`//` in a `.cjs`), from which agent-gates reads back what is installed, so there is no config file. To remove a language, delete its `.githooks/no-comments/<language>.cjs`.

Install also points `core.hooksPath` at `.githooks` in the current clone, and `.githooks/.gitattributes` marks the hooks `linguist-generated` with LF endings. With a `package.json`, install adds the same wiring to its `prepare` script, so a fresh clone wires itself. Without one, each contributor runs `git config core.hooksPath .githooks` once. CI checks every push either way.

## How the hooks run

- **Pre-commit:** `.githooks/pre-commit` runs the `format` step first, then each other executable in `.githooks/pre-commit.d/` in name order, and stops at the first failure. Your own pre-commit step belongs there, and judges the formatted change.
- **Pre-push:** `.githooks/pre-push` runs each executable in `.githooks/pre-push.d/` in name order, handing each git's arguments and pushed refs, and stops at the first failure. Your own pre-push step belongs there.
- **Push and CI alike:** the `commit-subject` and `no-comments` steps judge each pushed ref with `.githooks/judge-push`, the script their workflows run in CI, so a push the workflows would refuse never leaves. The range starts at the remote's tip, or, for a new branch, at the remote's default branch.
- **Merges:** no gate judges a merge commit locally.

## Commit subjects

The `commit-msg` hook refuses a subject that is empty, is not a Conventional Commit of an allowed type, is over 50 characters or holds a character outside printable ASCII, and a message with a body: a line after the subject that is neither blank nor a `#` line.

Allowed types, by default: `build`, `chore`, `ci`, `docs`, `feat`, `fix`, `perf`, `refactor`, `revert`, `style` and `test`, the set `@commitlint/config-conventional` allows, each with an optional lowercase scope and `!`. `agent-gates install commit-subject --prefixes <a,b,c>` replaces the set with the project's own, lowercase words joined by commas, such as `--prefixes feat,fix,docs`. Install writes the list into the hook as `prefixes='<a,b,c>'`, so it shows in the diff, and a reinstall without `--prefixes` keeps it. A refusal names the allowed types.

`commits.yml` and the pre-push step check every non-merge commit a push or pull request brings. Set the repository's squash-merge message to the pull request title alone, because GitHub's default squash body is refused. Git's own `Revert "..."` message is refused too; a `revert:` subject passes. The `commit-msg` hook lets a `fixup!`, `squash!` or `amend!` commit through, judging the subject it carries, and the push refuses it, so it is squashed before it leaves.

## Format

The hook runs the project's format command on each commit, then stages what it changed in the files the commit stages whole, so the commit goes through formatted. It refuses a partly staged file the command changes, naming it, and stages nothing. A file the commit leaves out that the command changed stays in the worktree, listed. A command that fails refuses the commit with its output.

agent-gates does not look for a formatter: `agent-gates install format --command "<command>"` names it, such as `--command "npm run lint:fix"` or `--command "cargo fmt"`, and install refuses `format` without one. Install writes the command into the hook as `command='<command>'`, so it shows in the diff, and a reinstall without `--command` keeps it.

Formatting writes files, so the gate runs only where code is written, on commit. The hook with `--run` runs the command from the checkout's root and exits with its status, staging nothing. The gate installs no workflow: CI can only refuse, and the project's own check already refuses unformatted code.

`doctor` fails when the format command's program is not on `PATH`.
