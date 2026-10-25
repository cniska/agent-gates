# No Comments

What the `no-comments-<language>` gates judge, what a refusal holds, the comments a project keeps and how each language is read.

A comment is where a coding agent excuses a workaround instead of fixing it, and a reviewer reading the diff tends to accept it. Without comments, the reason for a choice goes into a name, a test or the docs, and a workaround is fixed or left visibly unfinished. Cursor's [pstack `/no-comments`](https://github.com/cursor/plugins/blob/main/pstack/skills/no-comments/SKILL.md) skill works from the same idea; these gates enforce it on commit, on push and in CI.

The languages are `javascript` (JavaScript and TypeScript), `dart`, `sql` (PostgreSQL), `shell`, `rust`, `python`, `yaml` (`.yml` and `.yaml`, GitHub workflows included) and `swift`. `agent-gates install no-comments` installs the gate for each language the tracked files hold, and `no-comments-shell` and `no-comments-yaml` for the hooks and workflows it installs, which are judged like any other code, since only the `.cjs` bundles under `.githooks` are marked generated. Every gate but `format` installs a workflow, so `agent-gates doctor` warns that `no-comments-yaml` is missing in a gated project until `agent-gates install no-comments` runs there. It refuses when the tracked files hold no language. The gates need `node` on `PATH` and nothing installed in the project.

## What is judged

- **On commit:** the staged changes against `HEAD`.
- **One file:** `node .githooks/no-comments/scan.cjs --file <path>` judges the file as it stands in the working tree against `HEAD`, whatever the index holds, and skips what a commit would not judge, an ignored file included. It compares the file only with the same path at `HEAD`: a comment moved in from another file reads as added, and so does every comment of a file moved or renamed since `HEAD`.
- **In CI:** a pull request against the point it left its base branch; a push against the branch's previous tip, or against the default branch when the push creates the branch.
- **Added** means the comment's text, trimmed and with whitespace collapsed, is not among the comments the changed files held before. Moving, reindenting or renaming keeps a comment; editing a word, splitting, joining or duplicating one adds it. A file the change deletes, and git does not pair as a rename, counts for none, since removing comments is the goal: a comment moved out of it is added.
- **Not parsing:** JavaScript and TypeScript refuse any syntax error Babel reports, at its line. YAML refuses any error its parser reports, a duplicate key included, at the parser's line, which for an unclosed `[` or quote is the line after the construct. The other languages refuse a string, comment, quote, character, expansion, heredoc or Swift regex literal that never closes, at the line where it opens. Dart, SQL and Swift also refuse an unbalanced bracket, Python one that never closes and a line continuation at the end of the file, and SQL a `$` that starts neither a dollar quote nor a parameter.
- **Skipped:** files marked `linguist-generated` or `linguist-vendored`, binary files, symlinks, and code embedded in another language (shell in a workflow's `run:`, SQL in a string, `.vue` files). A file without an extension is routed by its shebang.

## The refusal

- It starts with the total and the fix, the same with or without a keep file, then the [kept patterns](#kept-comments) of each language it refused a comment in, then lists findings by file and line, each comment's first line cut at 120 characters.
- It stops at 4,000 bytes.
- In CI, it also annotates each finding, or the first nine and a count of the rest when there are more than ten. The step's log holds the full reply.

The gates stop the comment count from growing; they do not drive it to zero. `node .githooks/no-comments/scan.cjs --all` lists every comment in the tracked files, and `agent-gates doctor` warns while that count is above zero.

## Kept comments

A comment stays only when a tool reads it, deleting it changes what that tool does, and the project lists it in `.no-comments-keep` at the checkout root. agent-gates keeps no comment of its own accord: every doc comment, suppression, formatter hint, tool setting and test expectation is refused unless a line of that file keeps it. Fix the code, or put the setting in the tool's config file, where a reason can live.

- **The file:** one pattern per line, `<language> <regex>`: a language from the list above, one space, then a JavaScript regex. Blank lines are skipped; the file has no comment syntax. A line naming another language, with no regex or with a regex that does not compile refuses the scan, naming its line.
- **Matching:** each regex must match the whole comment, its opener included and its surrounding blanks trimmed, so `shell # v1` keeps `# v1` and not `# v1 why`. A block comment spanning lines is matched whole, so `.` in a pattern stops at its first line break. Where the comment sits on its line is not checked.
- **The side read:** a commit, `--file` and `--all` read the file as the index holds it, and a push or CI as the pushed head holds it, so a pattern written but not staged keeps nothing.
- **Without the file**, every comment is refused.
- **The interpreter line:** a `#!` on line 1, with no `#` word or `\c` after the `#!`, is never judged, since the kernel or `env -S` reads it. A `#!` with such a trailer, or on any other line, is an ordinary comment.
- **Install** appends any of its own lines the file lacks, creating the file if needed, and never changes a line the project wrote. It writes the lines that keep the markers in the hooks and workflows it installs, and the version trailer the `pinned-actions` gate asks for after a pinned `uses:`.

| A comment a tool reads | Its line in `.no-comments-keep` |
| --- | --- |
| `# agent-gate:no-comments:2` | `shell # agent-gate:[a-z-]+:[0-9]+` |
| `# agent-gate:no-comments:5` | `yaml # agent-gate:[a-z-]+:[0-9]+` |
| `# v7.0.1` | `yaml # v?[0-9]+(\.[0-9]+)*(-[0-9A-Za-z.]+)?` |
| `/// <reference types="bun" />` | `javascript /// <reference types="[a-z]+" />` |
| `--> statement-breakpoint` | `sql --> statement-breakpoint` |
| `// SPDX-License-Identifier: MIT` | `javascript // SPDX-License-Identifier: MIT` |

A refusal names, for each language it refused a comment in, the patterns `.no-comments-keep` holds for it, or `none`.

## How each language is read

- **JavaScript and TypeScript** with Babel's parser.
- **YAML** with a YAML 1.2 parser: a comment is a `#` at a line's start or after whitespace outside a quoted scalar and a block scalar's body, so a `#` in a `run: |` script or a quoted value is never one. A comment line is judged by its text alone, so a YAML comment in a workflow's `run:` is refused like any other.
- **SQL** as PostgreSQL, with dollar quotes and `E''` strings. A dollar-quoted body that parses as SQL is judged as code; one that does not is text.
- **Dart, shell, Rust, Python and Swift** by lexers that find the comments the language's own tokenizer finds. Shell treats `#` as a comment only where a word starts.
- **Rust** reads an attribute carrying `doc = …` anywhere, such as `#[cfg_attr(docsrs, doc = …)]`, as a doc comment; `#[doc(hidden)]` is code.
- **Swift** is read in Swift 6 language mode with bare-slash regex literals on: `/…/` is a regex literal where the Swift parser reads one, so `a / b / c` is division, and `#/…/#` always is one. Block comments nest, and a comment inside a string's interpolation `\( )` is judged like any other.
- **Python** judges a string that stands alone as a statement, a docstring included, as a comment. Indentation is not checked.

Another SQL dialect (MySQL, BigQuery, Snowflake) would need per-dialect lexer rules, chosen per path by a git attribute such as `agent-gates-sql=mysql`.
