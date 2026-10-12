# agent-gates

Commit gates a project owns: git hooks that refuse a bad commit locally, and the GitHub workflows that judge the same thing in CI.

## Install

agent-gates runs on [Bun](https://bun.sh), which [mise](https://mise.jdx.dev) installs for it. With mise installed:

```bash
git clone https://github.com/cniska/agent-gates.git
cd agent-gates
mise trust && mise install
```

`mise install` installs Bun and the dependencies, and puts `agent-gates` in `~/.bun/bin` with `bun link`. Add that directory to your `PATH` if it is not there yet. Then, in the project you want to gate:

```bash
agent-gates install commit-subject no-comments-javascript
agent-gates doctor
```

## Gates

| Gate | Hook | Workflow | Refuses |
| --- | --- | --- | --- |
| `commit-subject` | `.githooks/commit-msg` | `commits.yml` | A subject that is not a Conventional Commit, over 50 characters or not ASCII, and a message with a body |
| `no-comments-javascript` | `.githooks/pre-commit.d/no-comments` | `no-comments.yml` | A comment in a JavaScript or TypeScript file the commit changes, other than one a tool reads |
| `no-comments-dart` | `.githooks/pre-commit.d/no-comments` | `no-comments.yml` | A comment in a Dart file the commit changes, other than one the analyzer reads |
| `no-comments-sql` | `.githooks/pre-commit.d/no-comments` | `no-comments.yml` | A comment in a PostgreSQL file the commit changes, other than one a tool reads |
| `no-comments-shell` | `.githooks/pre-commit.d/no-comments` | `no-comments.yml` | A comment in a shell script the commit changes, other than the shebang and a `shellcheck` directive |
| `no-comments-rust` | `.githooks/pre-commit.d/no-comments` | `no-comments.yml` | A comment in a Rust file the commit changes, doc comments and `#[doc = …]` attributes included |

### Installed files

- **No config file.** Each installed file carries `# agent-gate:<part>:<version>` (`//` in a `.cjs`), and the installed gates are read back from those markers.
- **Committed with the project.** Its contributors and CI are gated without installing agent-gates.
- **Wired on install.** Installing points `core.hooksPath` at `.githooks` in the current clone and marks `.githooks/` `linguist-generated`. Where the project has a `package.json`, it adds the same wiring to the `prepare` script, so a fresh clone wires itself on install.
- **Without a `package.json`,** each contributor runs `git config core.hooksPath .githooks` once. CI judges every push either way.

### Commit subjects

`commits.yml` judges every commit a push or pull request brings. A gated repository therefore merges pull requests by squashing, with the pull request's title as the whole message. The workflow refuses:

- GitHub's default squash body
- a revert's generated message
- a `fixup!`, `squash!` or `amend!` commit

### Pre-commit steps

`.githooks/pre-commit` runs each executable in `.githooks/pre-commit.d/` in name order, and stops at the first that fails. A project runs its own check on commit by adding one there.

### No comments

A comment is where a coding agent excuses a workaround instead of fixing it. The comment makes the shortcut read as deliberate, and the reviewer of the diff accepts it. Without comments, the reason for a choice has to go into a name, a test that holds the invariant, or the docs, and a workaround has to be fixed or left visibly unfinished.

Cursor's [pstack](https://github.com/cursor/plugins/tree/main/pstack) plugin works from the same observation. Its [`/no-comments`](https://github.com/cursor/plugins/blob/main/pstack/skills/no-comments/SKILL.md) skill hands comments to a reviewer that did not write them, because an author defends its own comments, and fixes each workaround that reviewer names at its root cause. These gates hold the same line at commit time and in CI, keeping only comments a tool reads.

The `no-comments-<language>` gates judge whole files:

- On commit, each file the commit changes, read from the index.
- In CI, each file the push changes, read at its head.
- A file that does not parse is refused.

They need `node` on `PATH` and nothing installed in the project. A file with no extension is routed by its shebang. They skip:

- files git marks `linguist-generated` or `linguist-vendored`
- binary files and symlinks
- files whose first 400 characters say `GENERATED` or `auto-generated`
- code embedded in another language, such as shell in a workflow's `run:` or SQL in a string, and mixed files such as `.vue`

A comment a tool reads stays:

| Language | Kept comments |
| --- | --- |
| JavaScript, TypeScript | `@ts-`, `eslint-`, `biome-ignore`, `prettier-ignore`, `#__PURE__`, `/// <reference`, `/*!`, `@vitest-environment`; in plain JavaScript, the JSDoc `@type`, `@typedef` and all-`@param` blocks it types itself with |
| Dart | `ignore:`, `ignore_for_file:`, `coverage:`, `@dart=` |
| SQL | drizzle's `--> statement-breakpoint` |
| Shell | the first-line shebang, `shellcheck` directives |
| Rust | none; a first-line shebang is not a comment, and an attribute without doc text, such as `#[doc(hidden)]`, is code |
| Every language | the `agent-gate` markers |

How SQL, shell and Rust are read:

- **SQL** is read as PostgreSQL, with its dollar quotes and `E''` strings. A dollar-quoted body that reads as SQL is judged as code, so a `--` in a dollar-quoted text literal is refused. A body that does not read as SQL is left alone as text.
- **Shell** is read by a lexer, not a parser. A `#` starts a comment only where a word starts, and never inside quotes, parameter and arithmetic expansions, the regex after `=~`, or heredoc bodies. Only an unclosed quote, substitution or heredoc is refused as not parsing.
- **Rust** is read by a lexer that finds the comments rustc's own lexer finds, with raw strings, byte and C strings, char literals, lifetimes and raw identifiers. An attribute that carries doc text is refused as one comment, from its `#` to its closing `]`: one with `doc = …` anywhere inside it, so `#[doc = …]`, `#![doc = …]` and `#[cfg_attr(docsrs, doc = …)]` alike. `#[doc(hidden)]`, `#[doc(alias = …)]` and `#[cfg(doc)]` carry none. A `#[doc = $doc]` that a `macro_rules!` forwards is refused too, so a macro that generates docs is refused with them. Only an unclosed literal or block comment is refused as not parsing.

To remove a language, delete its `.githooks/no-comments/<language>.cjs`.

## Commands

Each command prints one JSON line.

| Command | Does |
| --- | --- |
| `agent-gates install [<gate>...]` | Install the named gates, bring the installed ones up to date, and report each file's state before it acted |
| `agent-gates doctor` | Judge each gate file, `core.hooksPath`, the `prepare` script and, with a `no-comments` gate installed, whether its languages match the tracked files, as `ok`, `warn` or `fail` with the fix; exit 1 when one fails |

Each gate file is in one of these states, and `install` acts on it:

| State | Means | `install` |
| --- | --- | --- |
| `installed` | the current version | leaves it |
| `missing` | not there | writes it |
| `behind` | an earlier version's bytes | writes it |
| `changed` | matches no version | sets it aside as `<file>.agent-gates-backup`, then writes it |
| `ahead` | a newer agent-gates wrote it | leaves it alone |
| `not-executable` | a hook git would skip | writes it |

`install` refuses when `core.hooksPath` or `prepare` already hold something else, or when `.githooks/pre-commit` is the project's own hook rather than this one.

## Extending

To add a language:

1. Add its extensions and shebang interpreters to `LANGUAGES` in `src/no-comments-languages.ts`.
2. Write a lexer in `src/no-comments-<language>.ts` that exports `comments`, which returns the comments it refuses, or `null` for a file that does not parse.
3. Check the lexer against the language's own tokenizer over real and deliberately broken files. It must find the same comments, and never refuse a file the tokenizer accepts.
4. Add its tests, its `GATES` entry and its README row.
5. Run `bun run gates:bundle`, and record the bundle's hash as [AGENTS.md](AGENTS.md) describes.

`bun run check` fails until the entry, the bundle and the hash agree. JavaScript and TypeScript are the exception to step 2: they use Babel's parser, because their comments cannot be found without parsing.

To support another SQL dialect: `.sql` is read as PostgreSQL, which SQLite also passes but MySQL, BigQuery and Snowflake do not. Supporting them takes a table of lexer rules per dialect in the SQL adapter, chosen per path by a git attribute such as `agent-gates-sql=mysql`.

## Development

`bun run check` is the repository check: lint, typecheck and tests.
