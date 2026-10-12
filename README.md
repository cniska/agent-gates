# agent-gates

Commit gates a project owns: git hooks that refuse a bad commit locally, and the GitHub workflows that judge the same thing in CI.

## Gates

| Gate | Hook | Workflow | Refuses |
| --- | --- | --- | --- |
| `commit-subject` | `.githooks/commit-msg` | `commits.yml` | A subject that is not a Conventional Commit, over 50 characters or not ASCII, and a message with a body |
| `no-comments-javascript` | `.githooks/pre-commit.d/no-comments` | `no-comments.yml` | A comment in a JavaScript or TypeScript file the commit changes, other than one a tool reads |
| `no-comments-dart` | `.githooks/pre-commit.d/no-comments` | `no-comments.yml` | A comment in a Dart file the commit changes, other than one the analyzer reads |
| `no-comments-sql` | `.githooks/pre-commit.d/no-comments` | `no-comments.yml` | A comment in a PostgreSQL file the commit changes, other than one a tool reads |

Each installed file carries `# agent-gate:<part>:<version>` (`//` in a `.cjs`); the installed gates are read back from those markers, so there is no config file. The files are committed with the project, so its contributors and CI are gated without agent-gates. Installing wires `core.hooksPath` to `.githooks` in this clone, adds the same as `package.json`'s `prepare` script where there is one, so a fresh clone wires itself on install, and marks `.githooks/` `linguist-generated`. A project without `package.json` asks its contributors to run `git config core.hooksPath .githooks` once; CI judges every push either way.

`commits.yml` judges every commit a push or pull request brings, so a gated repository merges pull requests by squashing with the pull request's title as the whole message; GitHub's default squash body, a revert's generated message and a `fixup!`, `squash!` or `amend!` commit are refused.

`.githooks/pre-commit` runs each executable in `.githooks/pre-commit.d/` in name order and stops at the first that fails, so a project runs its own check on commit by adding one there. Install refuses while `.githooks/pre-commit` is the project's own hook rather than this one.

The `no-comments-<language>` gates judge each file a commit changes as a whole, read from the index, and in CI each file the push changes, read at its head; a file that does not parse is refused. They need `node` on `PATH` and nothing installed in the project. They skip files git marks `linguist-generated` or `linguist-vendored`, binary files, symlinks, and files whose first 400 characters say `GENERATED` or `auto-generated`; a file with no extension is routed by its shebang. A comment a tool reads stays: `@ts-`, `eslint-`, `biome-ignore`, `prettier-ignore`, `#__PURE__`, `/// <reference`, `/*!`, `@vitest-environment`, the JSDoc `@type`, `@typedef` and all-`@param` blocks plain JavaScript types itself with, Dart's `ignore:`, `ignore_for_file:`, `coverage:` and `@dart=`, drizzle's `--> statement-breakpoint`, and the `agent-gate` markers. `.sql` files are read as PostgreSQL, with its dollar quotes and `E''` strings; a dollar-quoted body that reads as SQL is judged as code, so a `--` in a dollar-quoted text literal is refused, and one that does not is left alone as text. Code embedded in another language, such as shell in a workflow's `run:` or SQL in a string, and mixed files such as `.vue` are not judged. Removing a language is deleting its `.githooks/no-comments/<language>.cjs`.

## Commands

Each command prints one JSON line.

| Command | Does |
| --- | --- |
| `agent-gates install [<gate>...]` | Install the named gates, bring the installed ones up to date, and report each file's state before it acted |
| `agent-gates doctor` | Judge each gate file, `core.hooksPath`, the `prepare` script and, with a `no-comments` gate installed, whether its languages match the tracked files, as `ok`, `warn` or `fail` with the fix; exit 1 when one fails |

A gate file is `installed`, `missing`, `behind` (an earlier version's bytes), `changed`, `ahead` (a newer agent-gates wrote it) or `not-executable`. `install` writes a missing, behind or not-executable file, sets a changed one aside as `<file>.agent-gates-backup` before replacing it, leaves an ahead one alone, and refuses when `core.hooksPath` or `prepare` already hold something else, or `.githooks/pre-commit` is the project's own hook.

## Extending

- **A language:** add its extensions and shebang interpreters to `LANGUAGES` in `src/no-comments-languages.ts`, and write `src/no-comments-<language>.ts` exporting `comments`, which returns the comments it refuses, or `null` for a file that does not parse. Then add its tests, its `GATES` entry and its README row, run `bun run gates:bundle`, and record the bundle's hash as [AGENTS.md](AGENTS.md) describes; `bun run check` fails until the entry, the bundle and the hash agree.
- **Another SQL dialect:** `.sql` is read as PostgreSQL, which SQLite also passes but MySQL, BigQuery and Snowflake do not. Supporting them takes a table of lexer rules per dialect in the SQL adapter, chosen per path by a git attribute such as `agent-gates-sql=mysql`.

## Setup

Install [mise](https://mise.jdx.dev), then:

```bash
mise install && bun install
ln -s "$PWD/bin/agent-gates" ~/.local/bin/agent-gates
```

`bun run check` is the repository check.
