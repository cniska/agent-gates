# No Comments

What the `no-comments-<language>` gates judge, what a refusal holds, the comments each language keeps and how each language is read.

A comment is where a coding agent excuses a workaround instead of fixing it, and a reviewer reading the diff tends to accept it. Without comments, the reason for a choice goes into a name, a test or the docs, and a workaround is fixed or left visibly unfinished. Cursor's [pstack `/no-comments`](https://github.com/cursor/plugins/blob/main/pstack/skills/no-comments/SKILL.md) skill works from the same idea; these gates enforce it on commit, on push and in CI.

The languages are `javascript` (JavaScript and TypeScript), `dart`, `sql` (PostgreSQL), `shell`, `rust` and `python`. `agent-gates install no-comments` installs the gate for each language the tracked files hold, and `no-comments-shell` for the hooks it installs, which are shell and judged like any other code, since only the `.cjs` bundles under `.githooks` are marked generated. It refuses when the tracked files hold no language. The gates need `node` on `PATH` and nothing installed in the project.

## What is judged

- **On commit:** the staged changes against `HEAD`.
- **One file:** `node .githooks/no-comments/scan.cjs --file <path>` judges the file as it stands in the working tree against `HEAD`, whatever the index holds, and skips what a commit would not judge, an ignored file included. It compares the file only with the same path at `HEAD`: a comment moved in from another file reads as added, and so does every comment of a file moved or renamed since `HEAD`.
- **In CI:** a pull request against the point it left its base branch; a push against the branch's previous tip, or against the default branch when the push creates the branch.
- **Added** means the comment's text, trimmed and with whitespace collapsed, is not among the comments the changed files held before. Moving, reindenting or renaming keeps a comment; editing a word, splitting, joining or duplicating one adds it. A file the change deletes, and git does not pair as a rename, counts for none, since removing comments is the goal: a comment moved out of it is added.
- **Not parsing:** JavaScript and TypeScript refuse any syntax error Babel reports, at its line. The other languages refuse a string, comment, quote, character, expansion or heredoc that never closes, at the line where it opens. Dart and SQL also refuse an unbalanced bracket, Python one that never closes and a line continuation at the end of the file, and SQL a `$` that starts neither a dollar quote nor a parameter.
- **Skipped:** files marked `linguist-generated` or `linguist-vendored`, binary files, symlinks, and code embedded in another language (shell in a workflow's `run:`, SQL in a string, `.vue` files). A file without an extension is routed by its shebang.

## The refusal

- It starts with the total and the fix, then lists findings by file and line, each comment's first line cut at 120 characters.
- It stops at 4,000 bytes.
- In CI, it also annotates each finding, or the first nine and a count of the rest when there are more than ten. The step's log holds the full reply.

The gates stop the comment count from growing; they do not drive it to zero. `node .githooks/no-comments/scan.cjs --all` lists every comment in the tracked files, and `agent-gates doctor` warns while that count is above zero.

## Kept comments

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

## How each language is read

- **JavaScript and TypeScript** with Babel's parser.
- **SQL** as PostgreSQL, with dollar quotes and `E''` strings. A dollar-quoted body that parses as SQL is judged as code; one that does not is text.
- **Dart, shell, Rust and Python** by lexers that find the comments the language's own tokenizer finds. Shell treats `#` as a comment only where a word starts.
- **Rust** reads an attribute carrying `doc = …` anywhere, such as `#[cfg_attr(docsrs, doc = …)]`, as a doc comment; `#[doc(hidden)]` is code.
- **Python** judges a string that stands alone as a statement, a docstring included, as a comment. Indentation is not checked.

Another SQL dialect (MySQL, BigQuery, Snowflake) would need per-dialect lexer rules, chosen per path by a git attribute such as `agent-gates-sql=mysql`.
