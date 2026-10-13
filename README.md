# agent-gates

Commit gates a project owns: git hooks that refuse a bad commit locally, and the GitHub workflows that judge the same thing in CI.

## Install

agent-gates runs on [Bun](https://bun.sh), and its tests run the shipped scanner under Node; [mise](https://mise.jdx.dev) installs both. With mise installed:

```bash
git clone https://github.com/cniska/agent-gates.git
cd agent-gates
mise trust && mise install
```

`mise install` installs Bun, Node and the dependencies, and puts `agent-gates` in `~/.bun/bin` with `bun link`. Add that directory to your `PATH` if it is not there yet. Then, in the project you want to gate:

```bash
agent-gates install commit-subject no-comments-javascript
agent-gates doctor
```

## Gates

| Gate | Hook | Workflow | Refuses |
| --- | --- | --- | --- |
| `commit-subject` | `.githooks/commit-msg` | `commits.yml` | A subject that is not a Conventional Commit, over 50 characters or not ASCII, and a message with a body |
| `no-comments-javascript` | `.githooks/pre-commit.d/no-comments` | `no-comments.yml` | A comment in a JavaScript or TypeScript file the commit changes, other than a [kept form](#kept-comments) |
| `no-comments-dart` | `.githooks/pre-commit.d/no-comments` | `no-comments.yml` | A comment in a Dart file the commit changes, other than a [kept form](#kept-comments) |
| `no-comments-sql` | `.githooks/pre-commit.d/no-comments` | `no-comments.yml` | A comment in a PostgreSQL file the commit changes, other than a [kept form](#kept-comments) |
| `no-comments-shell` | `.githooks/pre-commit.d/no-comments` | `no-comments.yml` | A comment in a shell script the commit changes, other than a [kept form](#kept-comments) |
| `no-comments-rust` | `.githooks/pre-commit.d/no-comments` | `no-comments.yml` | A comment in a Rust file the commit changes, other than a [kept form](#kept-comments) |

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

The `no-comments-<language>` gates refuse the comments a change adds:

- On commit, the commit's changes, read from the index against `HEAD`.
- In CI, the push's changes, read at its head against the merge base.
- A comment is added when its text, each line trimmed and its runs of whitespace collapsed, is not left in the comments the changed files held before the change. A comment the change moves, reindents or carries through a rename is not added, nor one a copy carries out of a source that drops it. One it edits by a word, splits, joins or duplicates is, a copy's included, and a file is first matched against its own earlier comments, so the duplicate is the one refused.
- A file that does not parse is refused, with the line and the reason its parser gives, whatever it was before the change. A file that did not parse before the change brings no comments with it, so each of its comments is judged.

A refusal leads with its total and the fix, then lists each file's findings under its path, sorted by path and line, so a retry after a partial fix prints a subset of the same lines in the same order. A comment is shown by its first line, cut at 120 characters, and the reply stops at 4,000 bytes, which reaches every agent harness [measured](docs/no-comments-measurements.md) whole. Past that, each file with findings left gets a line counting them, and the files no line fits for share one count.

In CI, `scan.cjs --format github` also annotates each finding at its file and line, cut like the reply. GitHub shows ten error annotations per step, so past ten the first nine are annotated and the tenth counts the rest. The step's log then holds the whole reply, uncapped, since a log has no window to fit.

The gates stop the comment count from growing; they do not drive it to zero. Comments already in the tree wait for a deliberate sweep: `node .githooks/no-comments/scan.cjs --all` judges every comment of every tracked file, as the index holds it, and `agent-gates doctor` reports their count as a warning, never a failure.

They need `node` on `PATH` and nothing installed in the project. A file with no extension is routed by its shebang. They skip:

- files git marks `linguist-generated` or `linguist-vendored`
- binary files and symlinks
- code embedded in another language, such as shell in a workflow's `run:` or SQL in a string, and mixed files such as `.vue`

#### Kept comments

A comment a tool reads stays:

| Language | Kept comments |
| --- | --- |
| JavaScript and TypeScript | `@ts-expect-error`; a leading `// @ts-check` in plain JavaScript; `eslint-disable-line` and `eslint-disable-next-line` naming rules; `/* eslint-disable */` and `/* eslint-enable */` naming rules; `biome-ignore`, `-all`, `-start` and `-end` naming only rules or `format`; `prettier-ignore` alone; `#__PURE__` or `@__PURE__` alone; `@vitest-environment <env>` alone; a leading `/// <reference`; in plain JavaScript, JSDoc blocks holding only `@type {…}`, `@typedef {…} Name` and `@param {…} name` |
| Dart | `ignore:`; `ignore_for_file:`; `// @dart = x.y` alone |
| SQL | drizzle's `--> statement-breakpoint` |
| shell | the first-line shebang; `shellcheck` directives of `source=`, `source-path=`, `shell=`, `external-sources=` and `enable=` |
| Rust | in library code, an outer doc comment (`///`, `/** */`, `#[doc]`) on a `pub` item, a `#[macro_export]` macro, or a variant or item of a `pub` enum or trait; an inner doc comment (`//!`, `/*! */`, `#![doc]`) in a library's `src/lib.rs` |
| Every language | one `SPDX-License-Identifier:` line; a gate marker on a line of its own |

A form keeps the reason that follows it on the same line, unless it must stand alone; a directive in a block comment that spans lines is refused. A suppression that silences every rule, such as `@ts-ignore`, `@ts-nocheck`, a rule-less `eslint-disable`, a `biome-ignore lint` or `shellcheck disable=`, is refused, as is tool configuration in a comment, such as `eslint-env`, `/* eslint … */`, `/* global */` and Dart's `coverage:`. Dart's analyzer flags an `ignore:` that silences nothing under its opt-in `unnecessary_ignore` lint.

A refusal names these forms for each language it refused a comment in, on a line of its own after its total. A gate marker is this tool's `agent-gate:<part>:<version>` or another's `<tool>-gate:[<part>:]<version>`. In Rust a first-line shebang is not a comment, and an attribute without doc text, such as `#[doc(hidden)]`, is code.

How SQL, Dart, shell and Rust are read:

- **SQL** is read as PostgreSQL, with its dollar quotes and `E''` strings. A dollar-quoted body that reads as SQL is judged as code, so a `--` in a dollar-quoted text literal is refused. A body that does not read as SQL is left alone as text. An unclosed quote, comment or dollar quote, an unbalanced parenthesis or bracket, and a `$` that starts neither a dollar quote nor a positional parameter are refused as not parsing.
- **Dart** is read by a lexer that refuses an unclosed string, comment or interpolation and an unbalanced parenthesis, bracket or brace as not parsing.
- **Shell** is read by a lexer, not a parser. A `#` starts a comment only where a word starts, and never inside quotes, parameter and arithmetic expansions, the regex after `=~`, extended globs such as `@(a|b)`, or heredoc bodies. Only an unclosed quote, expansion, substitution, backquote, extended glob or heredoc is refused as not parsing, at the line where it opens.
- **Rust** is read by a lexer that finds the comments rustc's own lexer finds, with raw strings, byte and C strings, char literals, lifetimes and raw identifiers. An attribute that carries doc text is read as one doc comment, from its `#` to its closing `]`, and kept or refused like any other: one with `doc = …` anywhere inside it, so `#[doc = …]`, `#![doc = …]` and `#[cfg_attr(docsrs, doc = …)]` alike. `#[doc(hidden)]`, `#[doc(alias = …)]` and `#[cfg(doc)]` carry none. A `#[doc = $doc]` in a `macro_rules!` matcher, or in a repetition with no item after it, documents nothing and is refused. Library code is a file under the `src/` of a library crate: the nearest directory above the file with a tracked `Cargo.toml` also tracks `src/lib.rs`, and the file is neither `src/main.rs` nor under `src/bin/`. An outer doc belongs to the next item after the attributes and other docs that follow it: kept when that item starts with a bare `pub`, not `pub(crate)`, carries `#[macro_export]`, or sits directly in the body of a `pub enum` or `pub trait`. Each side of a change is judged by its own tree, so a doc kept before the change and refused after it, on a file moved out of `src/` or an item that lost its `pub`, is refused as added. Only an unclosed literal, char literal or block comment is refused as not parsing, at the line where it opens.

To remove a language, delete its `.githooks/no-comments/<language>.cjs`.

## Commands

Each command prints one JSON line. An error goes to stderr with its `kind` and exits by it: 2 for `usage`, 1 for a `refusal` the caller can resolve, 3 for a `fault` that leaves nothing judged.

| Command | Does |
| --- | --- |
| `agent-gates install [<gate>...]` | Install the named gates, bring the installed ones up to date, and report each file's state before it acted |
| `agent-gates doctor` | Judge each gate file, `core.hooksPath`, the `prepare` script and, with a `no-comments` gate installed, whether its languages match the tracked files and how many comments a sweep would refuse, as `ok`, `warn` or `fail` with the fix; exit 1 when one fails |

Each gate file is in one of these states, and `install` acts on it:

| State | Means | `install` |
| --- | --- | --- |
| `installed` | the current version | leaves it |
| `missing` | not there | writes it |
| `behind` | an earlier version's bytes | writes it |
| `changed` | matches no version | sets it aside as `<file>.agent-gates-backup`, then writes it |
| `ahead` | a newer agent-gates wrote it | leaves it alone |
| `not-executable` | a hook git would skip | writes it |
| `occupied` | a hook with no `agent-gate` marker: the project's own, or another tool's | refuses, writing nothing |

`install` refuses when `core.hooksPath` or `prepare` already hold something else, or when a hook it writes is occupied. A step the project runs before each commit moves to `.githooks/pre-commit.d/<name>`; `commit-subject` owns `.githooks/commit-msg`.

## Extending

To add a language:

1. Add its extensions and shebang interpreters to `LANGUAGES` in `src/no-comments-languages.ts`.
2. Write `src/no-comments-<language>.ts`, exporting `comments` and `kept` from `adapter()` in `src/no-comments-adapter.ts`. Its lexer returns each comment's span with its body's bounds, or `unterminated(<offset>, "<construct>")` where a construct never closes. Its kept forms are `directive(...)` rows for tool directives and plain forms for placement rules; the shared SPDX and marker forms are added for it.
3. Check the lexer against the language's own tokenizer over real and deliberately broken files. It must find the same comments, and never refuse a file the tokenizer accepts.
4. Add its tests, its `GATES` entry and its README row.
5. Run `bun run gates:bundle`, and record the bundle's hash as [AGENTS.md](AGENTS.md) describes.

`bun run check` fails until the entry, the bundle and the hash agree. JavaScript and TypeScript lex with Babel's parser, because their comments cannot be found without parsing.

To support another SQL dialect: `.sql` is read as PostgreSQL, which SQLite also passes but MySQL, BigQuery and Snowflake do not. Supporting them takes a table of lexer rules per dialect in the SQL adapter, chosen per path by a git attribute such as `agent-gates-sql=mysql`.

## Development

`bun run check` is the repository check: lint, typecheck and tests.
