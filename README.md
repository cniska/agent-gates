# agent-gates

Commit gates a project owns: git hooks that refuse a bad commit locally, and GitHub workflows that check the same thing in CI.

## Install

agent-gates runs on [Bun](https://bun.sh); its tests also run the shipped scanner under Node. [mise](https://mise.jdx.dev) installs both:

```bash
git clone https://github.com/cniska/agent-gates.git
cd agent-gates
mise trust && mise install
```

`mise install` also links `agent-gates` into `~/.bun/bin`; put that directory on your `PATH`. Then, in the project you want to gate:

```bash
agent-gates install commit-subject no-comments-javascript
agent-gates doctor
```

## Gates

| Gate | Hook | Workflow | Refuses |
| --- | --- | --- | --- |
| `commit-subject` | `.githooks/commit-msg` | `commits.yml` | A subject that is not a Conventional Commit, is over 50 characters or is not ASCII, and any message body |
| `no-comments-<language>` | `.githooks/pre-commit.d/no-comments` | `no-comments.yml` | A comment the change adds, other than a [kept form](#kept-comments) |

The languages are `javascript` (JavaScript and TypeScript), `dart`, `sql` (PostgreSQL), `shell` and `rust`.

Installed files:

- are committed with the project, so contributors and CI are gated without installing agent-gates;
- carry a marker, `# agent-gate:<part>:<version>` (`//` in a `.cjs`), from which agent-gates reads back what is installed, so there is no config file. To remove a language, delete its `.githooks/no-comments/<language>.cjs`.

Install also points `core.hooksPath` at `.githooks` in the current clone, and `.githooks/.gitattributes` marks the hooks `linguist-generated` with LF endings. With a `package.json`, install adds the same wiring to its `prepare` script, so a fresh clone wires itself. Without one, each contributor runs `git config core.hooksPath .githooks` once. CI checks every push either way.

`.githooks/pre-commit` runs each executable in `.githooks/pre-commit.d/` in name order and stops at the first failure. Your own pre-commit step belongs there.

Neither gate judges a merge commit locally.

### Commit subjects

Allowed types: `feat`, `fix`, `refactor`, `docs`, `test`, `chore`, `style`, `perf`, `build` and `ci`, with an optional lowercase scope and `!`.

`commits.yml` checks every non-merge commit a push or pull request brings. Set the repository's squash-merge message to the pull request title alone, because GitHub's default squash body is refused. Revert messages and `fixup!`, `squash!` and `amend!` commits are refused too.

### No comments

A comment is where a coding agent excuses a workaround instead of fixing it, and a reviewer reading the diff tends to accept it. Without comments, the reason for a choice goes into a name, a test or the docs, and a workaround is fixed or left visibly unfinished. Cursor's [pstack `/no-comments`](https://github.com/cursor/plugins/blob/main/pstack/skills/no-comments/SKILL.md) skill works from the same idea; these gates enforce it at commit time and in CI.

What is judged:

- **On commit:** the staged changes against `HEAD`.
- **In CI:** a pull request against the point it left its base branch; a push against the branch's previous tip, or against the default branch when the push creates the branch.
- **Added** means the comment's text, trimmed and with whitespace collapsed, is not among the comments the changed files held before. Moving, reindenting or renaming keeps a comment; editing a word, splitting, joining or duplicating one adds it.
- **Not parsing:** JavaScript and TypeScript refuse any syntax error Babel reports, at its line. The other languages refuse a string, comment, quote, character, expansion or heredoc that never closes, at the line where it opens. Dart and SQL also refuse an unbalanced bracket, and SQL a `$` that starts neither a dollar quote nor a parameter.
- **Skipped:** files marked `linguist-generated` or `linguist-vendored`, binary files, symlinks, and code embedded in another language (shell in a workflow's `run:`, SQL in a string, `.vue` files). A file without an extension is routed by its shebang.

The gates need `node` on `PATH` and nothing installed in the project.

A refusal:

- starts with the total and the fix, then lists findings by file and line, each comment's first line cut at 120 characters;
- stops at 4,000 bytes, which every [measured](docs/no-comments-measurements.md) agent harness shows whole;
- in CI, also annotates each finding, or the first nine and a count of the rest when there are more than ten. The step's log holds the full reply.

The gates stop the comment count from growing; they do not drive it to zero. `node .githooks/no-comments/scan.cjs --all` lists every comment in the tracked files, and `agent-gates doctor` warns while that count is above zero.

#### Kept comments

A comment a tool reads stays:

| Language | Kept comments |
| --- | --- |
| JavaScript and TypeScript | `@ts-expect-error`; a leading `// @ts-check` in plain JavaScript; `eslint-disable-line` and `eslint-disable-next-line` naming rules; `/* eslint-disable */` and `/* eslint-enable */` naming rules; `biome-ignore`, `-all`, `-start` and `-end` naming only rules or `format`; `prettier-ignore` alone; `#__PURE__` or `@__PURE__` alone; `@vitest-environment <env>` alone; a leading `/// <reference`; in plain JavaScript, JSDoc blocks holding only `@type {…}`, `@typedef {…} Name` and `@param {…} name` |
| Dart | `ignore:` and `ignore_for_file:` naming only diagnostics; `// @dart = x.y` alone |
| SQL | drizzle's `--> statement-breakpoint` |
| shell | the first-line shebang; `shellcheck` directives of `source=`, `source-path=`, `shell=`, `external-sources=` and `enable=` |
| Rust | in library code, an outer doc comment (`///`, `/** */`, `#[doc]`) on a `pub` item, a `#[macro_export]` macro, or a variant or item of a `pub` enum or trait; an inner doc comment (`//!`, `/*! */`, `#![doc]`) in a library's `src/lib.rs` |
| Every language | one `SPDX-License-Identifier:` line; a gate marker on a line of its own |

- A form may carry a reason on the same line, unless it is marked "alone". A directive in a block comment that spans lines is refused.
- A suppression that silences every rule is refused: `@ts-ignore`, `@ts-nocheck`, a rule-less `eslint-disable`, `biome-ignore lint`. Every `shellcheck disable=` is refused, even one that names a rule. Dart refuses `type=lint` in `ignore:` or `ignore_for_file:`, and any text after the diagnostic names. Tool configuration in a comment is refused too: `eslint-env`, `/* eslint … */`, `/* global */`, Dart's `coverage:`.
- A gate marker is `agent-gate:<part>:<version>`, or another tool's `<tool>-gate:[<part>:]<version>`.
- A refusal lists the kept forms of each language it refused a comment in.

How each language is read:

- **JavaScript and TypeScript** with Babel's parser.
- **SQL** as PostgreSQL, with dollar quotes and `E''` strings. A dollar-quoted body that parses as SQL is judged as code; one that does not is text.
- **Dart, shell and Rust** by lexers that find the comments the language's own tokenizer finds. Shell treats `#` as a comment only where a word starts.
- **Rust library code** is a file under `src/` of a crate whose `Cargo.toml` and `src/lib.rs` are tracked, other than `src/main.rs` and `src/bin/`. `pub` means bare `pub`, not `pub(crate)`. An attribute carrying `doc = …` anywhere, such as `#[cfg_attr(docsrs, doc = …)]`, is a doc comment; `#[doc(hidden)]` is code. Each side of a change is judged by its own tree, so dropping `pub` or moving a file out of `src/` turns its docs into added comments.

## Commands

Each command prints one JSON line. An error goes to stderr and exits 2 for `usage`, 1 for a `refusal` you can resolve, and 3 for a `fault`.

| Command | Does |
| --- | --- |
| `agent-gates install [<gate>...]` | Install the named gates, update the installed ones, and report each file's state before acting |
| `agent-gates doctor` | Check each gate file, `core.hooksPath`, the `prepare` script and, for `no-comments`, whether the installed languages match the tracked files and how many comments the tracked files hold; exit 1 on a failure |

Gate file states:

| State | Means | `install` |
| --- | --- | --- |
| `installed` | the current version | leaves it |
| `missing` | not there | writes it |
| `behind` | an earlier version | writes it |
| `changed` | matches no version | sets it aside as `<file>.agent-gates-backup`, then writes it |
| `ahead` | written by a newer agent-gates | leaves it |
| `not-executable` | a hook git would skip | writes it |
| `occupied` | a hook without an `agent-gate` marker | refuses, writing nothing |

`install` also refuses when `core.hooksPath` or `prepare` already hold something else, when `package.json` does not parse, or when no gate is named and none is installed. `commit-subject` owns `.githooks/commit-msg`.

## Extending

To add a language:

1. Add it to `LANGUAGE_NAMES` and `LANGUAGES` in `src/no-comments-languages.ts`, with its extensions and shebang interpreters.
2. Write `src/no-comments-<language>.ts` on the model of `src/no-comments-dart.ts`, the smallest adapter: `export const { comments, kept } = adapter({ contextOf, lex, directiveLead, kept })`. `lex` returns each comment's `Span`, or `unterminated(<offset>, "<construct>")` where the file stops parsing. A tool directive is kept with `directive(shown, { pattern, reason })`; any other rule is a `{ shown, keeps }` form.
3. Check the lexer against the language's own tokenizer on real and deliberately broken files: same comments, and no refusal of a file the tokenizer accepts.
4. Add tests, a `GATES` and an `ADAPTER_FILES` entry in `src/gates-contract.ts`, a row in the kept-comments table (a test checks it), and the language in the list under Gates.
5. Run `bun run gates:bundle` and record the hash, as [AGENTS.md](AGENTS.md) describes. `bun run check` fails until the entry, bundle and hash agree.

Another SQL dialect (MySQL, BigQuery, Snowflake) would need per-dialect lexer rules, chosen per path by a git attribute such as `agent-gates-sql=mysql`.

## Development

`bun run check` runs lint, typecheck and tests. A change to any file in `gates/` bumps its version first; see [AGENTS.md](AGENTS.md).
