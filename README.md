# agent-gates

Commit gates a project owns: git hooks that refuse a bad commit locally, and the GitHub workflows that judge the same thing in CI.

## Gates

| Gate | Hook | Workflow | Refuses |
| --- | --- | --- | --- |
| `commit-subject` | `.githooks/commit-msg` | `commits.yml` | A subject that is not a Conventional Commit, over 50 characters or not ASCII, and a message with a body |

Each installed file carries `# agent-gate:<part>:<version>`; the installed gates are read back from those markers, so there is no config file. The files are committed with the project, so its contributors and CI are gated without agent-gates. Installing wires `core.hooksPath` to `.githooks` in this clone, adds the same as `package.json`'s `prepare` script where there is one, so a fresh clone wires itself on install, and marks `.githooks/` `linguist-generated`. A project without `package.json` asks its contributors to run `git config core.hooksPath .githooks` once; CI judges every push either way.

`commits.yml` judges every commit a push or pull request brings, so a gated repository merges pull requests by squashing with the pull request's title as the whole message; GitHub's default squash body, a revert's generated message and a `fixup!`, `squash!` or `amend!` commit are refused.

Running the project's own check on commit is left to the project.

## Commands

Each command prints one JSON line.

| Command | Does |
| --- | --- |
| `agent-gates install [<gate>...]` | Install the named gates, bring the installed ones up to date, and report each file's state before it acted |
| `agent-gates doctor` | Judge each gate file, `core.hooksPath` and the `prepare` script as `ok`, `warn` or `fail` with the fix; exit 1 when one fails |

A gate file is `installed`, `missing`, `behind` (an earlier version's bytes), `changed`, `ahead` (a newer agent-gates wrote it) or `not-executable`. `install` writes a missing, behind or not-executable file, sets a changed one aside as `<file>.agent-gates-backup` before replacing it, leaves an ahead one alone, and refuses when `core.hooksPath` or `prepare` already hold something else.

## Setup

Install [mise](https://mise.jdx.dev), then:

```bash
mise install && bun install
ln -s "$PWD/bin/agent-gates" ~/.local/bin/agent-gates
```

`bun run check` is the repository check.
