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
agent-gates install commit-subject no-comments
agent-gates doctor
```

## Gates

| Gate | Hook | Workflow | Refuses |
| --- | --- | --- | --- |
| `commit-subject` | `.githooks/commit-msg` | `commits.yml` | A subject that is not a Conventional Commit, is over 50 characters or is not ASCII, and any message body |
| `format` | `.githooks/pre-commit.d/format` | `format.yml` | A partly staged file the format command changes, and a failing command; anything else it formats into the commit |
| `no-comments-<language>` | `.githooks/pre-commit.d/no-comments` | `no-comments.yml` | A comment the change adds, other than a [kept form](#kept-comments) |

The languages are `javascript` (JavaScript and TypeScript), `dart`, `sql` (PostgreSQL), `shell`, `rust` and `python`. `agent-gates install no-comments` installs the gate for each language the tracked files hold, and refuses when they hold none.

Installed files:

- are committed with the project, so contributors and CI are gated without installing agent-gates;
- carry a marker, `# agent-gate:<part>:<version>` (`//` in a `.cjs`), from which agent-gates reads back what is installed, so there is no config file. To remove a language, delete its `.githooks/no-comments/<language>.cjs`.

Install also points `core.hooksPath` at `.githooks` in the current clone, and `.githooks/.gitattributes` marks the hooks `linguist-generated` with LF endings. With a `package.json`, install adds the same wiring to its `prepare` script, so a fresh clone wires itself. Without one, each contributor runs `git config core.hooksPath .githooks` once. CI checks every push either way.

`.githooks/pre-commit` runs the `format` step first, then each other executable in `.githooks/pre-commit.d/` in name order, and stops at the first failure. Your own pre-commit step belongs there.

No gate judges a merge commit locally.

### Commit subjects

Allowed types: `feat`, `fix`, `refactor`, `docs`, `test`, `chore`, `style`, `perf`, `build` and `ci`, with an optional lowercase scope and `!`.

`commits.yml` checks every non-merge commit a push or pull request brings. Set the repository's squash-merge message to the pull request title alone, because GitHub's default squash body is refused. Revert messages and `fixup!`, `squash!` and `amend!` commits are refused too.

### Format

The hook runs the project's format command on each commit, then stages what it changed in the files the commit stages whole, so the commit goes through formatted. It refuses a partly staged file the command changes, naming it, and stages nothing. A file the commit leaves out that the command changed stays in the worktree, listed. A command that fails refuses the commit with its output.

agent-gates does not look for a formatter: `agent-gates install format --command "<command>"` names it, such as `--command "npm run lint:fix"` or `--command "cargo fmt"`, and install refuses `format` without one. Install writes the command into the hook as `command='<command>'`, so it shows in the diff, and a reinstall without `--command` keeps it.

`format.yml` runs `.githooks/ci-setup`, then the hook with `--check`, which runs the command and refuses each tracked file it changes. `agent-gates install format --setup "<command>"` writes the project's setup into `.githooks/ci-setup`, such as `--setup "mise install && pnpm install --frozen-lockfile"`; every gate workflow that needs the project set up runs that one file, and a reinstall without `--setup` keeps it. Without one, the setup step does nothing.

`doctor` fails when the format command's program is not on `PATH`, and warns when no setup command is installed or its program is not on `PATH`.

The `format` step runs before every other `pre-commit.d/` step, so each of them judges the formatted change.

### No comments

A comment is where a coding agent excuses a workaround instead of fixing it, and a reviewer reading the diff tends to accept it. Without comments, the reason for a choice goes into a name, a test or the docs, and a workaround is fixed or left visibly unfinished. Cursor's [pstack `/no-comments`](https://github.com/cursor/plugins/blob/main/pstack/skills/no-comments/SKILL.md) skill works from the same idea; these gates enforce it at commit time and in CI.

What is judged:

- **On commit:** the staged changes against `HEAD`.
- **One file:** `node .githooks/no-comments/scan.cjs --file <path>` judges the file as it stands in the working tree against `HEAD`, whatever the index holds, and skips what a commit would not judge, an ignored file included. It reads no other file and pairs the file only with its own path at `HEAD`, so a comment moved in from another file, and every comment of a file moved or renamed since `HEAD`, reads as added.
- **In CI:** a pull request against the point it left its base branch; a push against the branch's previous tip, or against the default branch when the push creates the branch.
- **Added** means the comment's text, trimmed and with whitespace collapsed, is not among the comments the changed files held before. Moving, reindenting or renaming keeps a comment; editing a word, splitting, joining or duplicating one adds it. A file the change deletes, and git does not pair as a rename, counts for none, since removing comments is the goal: a comment moved out of it is added.
- **Not parsing:** JavaScript and TypeScript refuse any syntax error Babel reports, at its line. The other languages refuse a string, comment, quote, character, expansion or heredoc that never closes, at the line where it opens. Dart and SQL also refuse an unbalanced bracket, Python one that never closes and a line continuation at the end of the file, and SQL a `$` that starts neither a dollar quote nor a parameter.
- **Skipped:** files marked `linguist-generated` or `linguist-vendored`, binary files, symlinks, and code embedded in another language (shell in a workflow's `run:`, SQL in a string, `.vue` files). A file without an extension is routed by its shebang.

The gates need `node` on `PATH` and nothing installed in the project.

A refusal:

- starts with the total and the fix, then lists findings by file and line, each comment's first line cut at 120 characters;
- stops at 4,000 bytes, which every [measured](docs/no-comments-measurements.md) agent harness shows whole;
- in CI, also annotates each finding, or the first nine and a count of the rest when there are more than ten. The step's log holds the full reply.

The gates stop the comment count from growing; they do not drive it to zero. `node .githooks/no-comments/scan.cjs --all` lists every comment in the tracked files, and `agent-gates doctor` warns while that count is above zero.

#### Kept comments

A comment stays only when a tool reads it, and deleting it changes what that tool does. Even then, only the forms below are kept: every doc comment, suppression, formatter hint, tool setting and test expectation is refused. Fix the code, or put the setting in the tool's config file, where a reason can live.

| Language | Kept comments |
| --- | --- |
| JavaScript and TypeScript | the first-line shebang, with no `#` word or `\c` after `#!`; a leading `/// <reference …/>` holding only its attributes |
| Dart | the first-line shebang, with no `#` word or `\c` after `#!` |
| SQL | drizzle's `--> statement-breakpoint` |
| shell | the first-line shebang, with no `#` word or `\c` after `#!` |
| Rust | the first-line shebang, with no `#` word or `\c` after `#!` |
| Python | the first-line shebang, with no `#` word or `\c` after `#!` |
| Every language | a gate marker on a line of its own |

- Every kept form stands alone in its comment: no reason, no trailing text. A directive in a block comment that spans lines is refused.
- Every TypeScript, ESLint and Biome suppression is refused, `@ts-expect-error` included, and so are `prettier-ignore`, `@ts-check` and `@vitest-environment`; their settings belong in `tsconfig.json`, the linter's config, `.prettierignore` and the Vitest config. Every `shellcheck` directive is refused; its settings belong in `.shellcheckrc`. Every Dart `ignore:` and `ignore_for_file:` is refused; the analyzer's settings belong in `analysis_options.yaml`. Tool configuration in a comment is refused too: `eslint-env`, `/* eslint … */`, `/* global */`, Dart's `coverage:`.
- A gate marker is `agent-gate:<part>:<version>`, where `<part>` is one of agent-gates' parts, or another tool's `<tool>-gate:[<part>:]<version>`, where `<tool>` and `<part>` are each one lowercase word.
- A refusal lists the kept forms of each language it refused a comment in.

How each language is read:

- **JavaScript and TypeScript** with Babel's parser.
- **SQL** as PostgreSQL, with dollar quotes and `E''` strings. A dollar-quoted body that parses as SQL is judged as code; one that does not is text.
- **Dart, shell, Rust and Python** by lexers that find the comments the language's own tokenizer finds. Shell treats `#` as a comment only where a word starts.
- **Rust** reads an attribute carrying `doc = …` anywhere, such as `#[cfg_attr(docsrs, doc = …)]`, as a doc comment; `#[doc(hidden)]` is code.
- **Python** judges a string that stands alone as a statement, a docstring included, as a comment. Indentation is not checked.

## Commands

Each command prints one JSON line. An error goes to stderr and exits 2 for `usage`, 1 for a `refusal` you can resolve, and 3 for a `fault`.

| Command | Does |
| --- | --- |
| `agent-gates install [<gate>...] [--command <format command>] [--setup <CI setup command>]` | Install the named gates, update the installed ones, and report each file's state before acting and the format and setup commands |
| `agent-gates doctor` | Check each gate file, `core.hooksPath`, the `prepare` script, the format and CI setup commands, whether a no-comments gate is installed for each language the tracked files hold, even when none is, and whether each installed one still has files to read, and how many comments the tracked files hold; exit 1 on a failure |

Gate file states:

| State | Means | `install` |
| --- | --- | --- |
| `installed` | the current version | leaves it |
| `missing` | not there | writes it |
| `behind` | an earlier version | writes it |
| `changed` | matches no version | sets it aside as `<file>.agent-gates-backup`, then writes it |
| `ahead` | written by a newer agent-gates | leaves it |
| `not-executable` | a hook git would skip | writes it |
| `reconfigured` | the current version, holding another command than `--command` or `--setup` gave | writes it |
| `occupied` | a hook without an `agent-gate` marker | refuses, writing nothing |

`install` also refuses when `core.hooksPath` or `prepare` already hold something else, when `package.json` does not parse, when no gate is named and none is installed, and, for `format`, when no command is given or installed. `commit-subject` owns `.githooks/commit-msg`.

## Claude Code plugin

The gates stay the check for every contributor. The optional `cniska-gates` plugin in `plugin/` saves a Claude Code agent the round trip through them: after each `Edit`, `Write` or `MultiEdit`, in a repo that commits `.githooks/no-comments/scan.cjs`, it runs `scan.cjs --file` on the edited file and hands the agent the scanner's reply, so it removes the comments before it commits. It never blocks an edit, never changes a file, and does nothing in a repo without the gate. It needs `jq` and `node` on `PATH`; without either, or with a scanner too old for `--file`, it leaves only a note on stderr.

```bash
claude plugin marketplace add cniska/agent-skills
claude plugin install cniska-gates@cniska
```

## Extending

To add a language:

1. Add it to `LANGUAGE_NAMES` and `LANGUAGES` in `src/no-comments-languages.ts`, with its extensions and shebang interpreters.
2. Write `src/no-comments-<language>.ts` on the model of `src/no-comments-dart.ts`, the smallest adapter: `export const { comments, kept } = adapter({ lex, kept })`. `lex` returns each comment's `Span`, or `unterminated(<offset>, "<construct>")` where the file stops parsing. A comment the toolchain reads is kept with `directive(shown, { pattern, where })`, which matches the whole comment body and nothing after it; any other rule is a `{ shown, keeps }` form.
3. Check the lexer against the language's own tokenizer on real and deliberately broken files: same comments, and no refusal of a file the tokenizer accepts.
4. Add tests, a `GATES` and an `ADAPTER_FILES` entry in `src/gates-contract.ts`, a row in the kept-comments table (a test checks it), and the language in the list under Gates.
5. Run `bun run gates:bundle` and record the hash, as [AGENTS.md](AGENTS.md) describes. `bun run check` fails until the entry, bundle and hash agree.

Another SQL dialect (MySQL, BigQuery, Snowflake) would need per-dialect lexer rules, chosen per path by a git attribute such as `agent-gates-sql=mysql`.

## Development

`bun run check` runs lint, typecheck and tests. `bun run acceptance` proves the criteria in [`SPEC.md`](SPEC.md) through the CLI and the files it installs alone, as the spec's D-4 says; each test in `acceptance/` is named for the criteria it proves, and a check in `bun run check` fails when a criterion has no test or todo, or a test cites none. A change to any file in `gates/` bumps its version first; see [AGENTS.md](AGENTS.md).
