# agent-gates Specification

> Commit gates a project owns: git hooks that refuse a bad commit locally, and GitHub workflows that check the same thing in CI, installed and judged by one CLI.

This document states what must hold, not how. [`README.md`](README.md) lists the gates and commands, and [`src/README.md`](src/README.md) maps the modules that meet these requirements.

**Status: reverse-engineered from the code at `db5b96e`, unverified.** Each requirement states behavior the code shows today. None is contract until the owner confirms it. §9 lists the open questions.

## 1. Purpose & context

A coding agent excuses a workaround in a comment, writes a commit message nobody can scan, and a reviewer reading the diff tends to accept both. agent-gates installs gates that refuse them at commit time and again in CI. The gates are files committed with the project, so contributors and CI are gated without installing agent-gates; agent-gates installs them, brings them up to date, and judges their health.

**Primary user:** coding agents and their owner, installing gates into a project and reading why a commit was refused. Not the audience: projects that want a configurable linter; a gate here has no options.

## 2. Functional requirements

### 2.1 The CLI

- **FR-1** — `agent-gates` with no command prints the commands, each with its name, usage and summary, and exits 0.
- **FR-2** — A command that succeeds prints one JSON line on stdout naming the command, with `ok: true` and its result.
- **FR-3** — A command that fails prints one JSON line on stderr naming the command, with `ok: false` and an error carrying its kind, code, message, meta and resolve, and prints nothing on stdout.
- **FR-4** — An error exits 2 for the kind `usage`, 1 for `refusal` and 3 for `fault`.
- **FR-5** — An unknown command, a wrong number of arguments and an unknown gate name are usage errors whose resolve is the usage to follow.
- **FR-6** — A command acts on the root of the git checkout it runs in, from any directory below it; outside a checkout it is refused as `not_a_checkout`.
- **FR-7** — A command that cannot run git fails as the fault `git_unavailable`.

### 2.2 Install

- **FR-8** — The gates are `commit-subject`, `format`, and `no-comments-<language>` for each of `javascript`, `dart`, `sql`, `shell`, `rust` and `python`.
- **FR-9** — `install` installs the named gates and every gate already installed. Named none with none installed, it is refused as `no_gates_chosen`.
- **FR-10** — `commit-subject` installs `.githooks/commit-msg`, `.github/workflows/commits.yml` and `.githooks/.gitattributes`.
- **FR-11** — `no-comments-<language>` installs `.githooks/pre-commit`, `.githooks/pre-commit.d/no-comments`, `.githooks/no-comments/scan.cjs`, `.githooks/no-comments/<language>.cjs`, `.github/workflows/no-comments.yml` and `.githooks/.gitattributes`.
- **FR-12** — The installed hooks are executable, and the other installed files are not.
- **FR-13** — Each installed file carries a marker, `agent-gate:<part>:<version>`, and the installed gates are read back from these markers alone; deleting a language's adapter uninstalls that language's gate.
- **FR-14** — `.githooks/.gitattributes` marks every file under `.githooks` `linguist-generated` with LF line endings.
- **FR-15** — A file holding an earlier release's bytes is `behind`, and install replaces it without a backup.
- **FR-16** — A file matching no release is `changed`, and install copies it aside to `<file>.agent-gates-backup`, or to the first free `<file>.agent-gates-backup-<n>` from 2, before replacing it.
- **FR-17** — A file whose marker names a later version of its part is `ahead`, and install leaves it.
- **FR-18** — A hook holding the current bytes without its executable bit is `not-executable`, and install restores the bit without a backup.
- **FR-19** — An executable gate file, a hook or a pre-commit step, with no `agent-gate` marker is `occupied`, and install is refused as `hook_occupied`, writing nothing. A gate file that is not executable and has no marker is `changed`.
- **FR-20** — Install's result names the gates it installed, each file's path, the file's state before install acted and its backup, the `prepare` script's state, and the format and CI setup commands installed, each `null` when there is none.
- **FR-21** — Install sets `core.hooksPath` to `.githooks` when it is unset, and accepts any value that resolves to `.githooks`.
- **FR-22** — When `core.hooksPath` names another directory, install is refused as `hooks_path_occupied`, writing nothing.
- **FR-23** — With a `package.json`, install sets its `prepare` script to one that wires `core.hooksPath` in a git checkout and does nothing outside one, keeping every other key, the keys' order and the file's indent. An earlier wiring is replaced the same way. Without a `package.json`, install writes none.
- **FR-24** — A `prepare` script that holds anything else is refused as `prepare_occupied`, writing nothing.
- **FR-25** — A `package.json` that does not parse as a JSON object with an object of scripts is refused as `manifest_unparseable`, writing nothing.
- **FR-26** — A file install cannot write is refused as `write_failed`, naming the path.

### 2.3 Doctor

- **FR-27** — `doctor` reports its checks, each with a name, a state of `ok`, `warn` or `fail`, a detail and a fix (`null` when it passes), and how many fail. It exits 1 when a check fails and 0 otherwise.
- **FR-28** — With no gate installed, `doctor` warns that no gate is installed, with the install usage as its fix.
- **FR-29** — With a gate installed, `doctor` reports the installed gates, each of their files, `core.hooksPath` and the `prepare` script, in that order.
- **FR-30** — A file passes when `installed`, warns when `behind`, `changed` or `ahead`, and fails when `missing` or `not-executable`; an `occupied` hook, and a format hook that holds no command, fail with install's refusal as their detail and fix.
- **FR-31** — An unset `core.hooksPath` fails, and one naming another directory fails with install's refusal.
- **FR-32** — The `prepare` check passes with no `package.json` or a wired script, warns when the script is missing or an earlier wiring, and fails with install's refusal when it is occupied or the manifest does not parse.
- **FR-33** — `doctor`, with or without a gate installed, warns in one check about each language the project tracks files of whose `no-comments` gate is not installed, and each installed language the project tracks no file of, with one fix that runs `agent-gates install no-comments` and deletes the second's adapters.
- **FR-34** — With a `no-comments` gate installed, `doctor` counts the comments the tracked files hold and the tracked files that do not parse, through the installed adapters, and warns while either is above zero, naming `node .githooks/no-comments/scan.cjs --all` as the fix.
- **FR-35** — `doctor` does not count while the installed scanner or an installed adapter differs from this agent-gates' release, and warns naming install as the fix.

### 2.4 Hook wiring

- **FR-36** — `.githooks/pre-commit` runs `.githooks/pre-commit.d/format` first when it is executable, then each other executable file in `.githooks/pre-commit.d/` in name order, and stops at the first that fails, exiting with its status.

### 2.5 Commit subjects

- **FR-37** — The `commit-msg` hook refuses a subject that is not `<type>[(<scope>)][!]: <description>`, where the type is one of `feat`, `fix`, `refactor`, `docs`, `test`, `chore`, `style`, `perf`, `build` and `ci`, the scope is lowercase letters, digits and hyphens, and the description starts with a character other than whitespace.
- **FR-38** — It refuses a subject over 50 bytes.
- **FR-39** — It refuses a subject holding a character outside printable ASCII.
- **FR-40** — It refuses a message with a body: a line after the subject that is neither blank nor a `#` line.
- **FR-41** — It refuses a subject that is empty or only whitespace.
- **FR-42** — It judges the message git keeps: nothing from the scissors line down, and no carriage return.
- **FR-43** — It judges a `fixup!` or `squash!` subject by the subject after its prefixes, and an `amend!` message by the message after its first line.
- **FR-44** — It does not judge a merge commit.
- **FR-45** — A refusal names the reason and the subject on stderr, and the commit is not made.
- **FR-46** — The commits workflow judges every non-merge commit in the pushed range by the hook's rules.
- **FR-47** — The commits workflow refuses a `fixup!`, `squash!` or `amend!` commit.
- **FR-48** — The commits workflow's range starts at a pull request's base, at a push's previous tip, or, for a push that creates a branch other than the default, at the default branch on origin; with none of those, it holds every commit the head reaches.

### 2.6 No comments: what is judged

- **FR-49** — The `no-comments` pre-commit hook judges the change the commit makes, as the index git commits holds it, `git commit <paths>` included.
- **FR-50** — The no-comments workflow judges a pull request's or a push's head against its merge base with the pull request's base, the push's previous tip, or, for a push that creates a branch other than the default, the default branch on origin; with no merge base, it judges every file of the head.
- **FR-51** — `scan.cjs --all` judges every comment of every tracked file, as the index holds it.
- **FR-52** — A comment is added when its text, with each line trimmed and its runs of whitespace collapsed, is not among the comments the changed files held before, each counted as often as they held it. So a comment moved within a file or to another changed file, reindented, or renamed with its file is not added, and a comment edited, split, joined, duplicated or copied is.
- **FR-53** — A file the change deletes, which git does not pair with a new path as a rename, held no comments.
- **FR-54** — A file whose earlier version did not parse held no comments.
- **FR-55** — Files marked `linguist-generated` or `linguist-vendored` by the attributes the index holds, binary files, symlinks and other files that are not regular are not judged; what a file says of itself does not exempt it.
- **FR-56** — A file is routed to a language by its extension, and a file with no extension by its first-line shebang's interpreter: `node`, `bun` or `deno` to JavaScript, `dart` to Dart, `sh`, `bash`, `dash` or `zsh` to shell, and `python`, `pypy` or `uv run --script` to Python, through `/usr/bin/env` and its flags, and with a version suffix dropped.
- **FR-57** — A file of a language whose adapter is not installed, or of no language, is not judged, and no adapter is loaded for it.
- **FR-58** — A merge commit is not judged on commit.

### 2.7 No comments: the reply

- **FR-59** — A file that does not parse is refused at the line where it stops parsing, with the reason.
- **FR-60** — A refusal starts with the counts and the fix, then the kept forms of each language it refused a comment in, then each file in path order with each finding under it as its line and the comment's first line, trimmed.
- **FR-61** — A comment's first line is shown cut at 120 characters, ending in `…`.
- **FR-62** — Without `--format github`, a refusal stops at 4,000 bytes, ending with a count of the findings it does not show.
- **FR-63** — With `--format github`, the scanner annotates each finding at its file and line on stdout, each finding when there are ten or fewer, and otherwise the first nine and one annotation counting the rest, and writes the whole reply, uncut, to stderr.
- **FR-64** — The scanner exits 0 when it finds nothing and 1 when it refuses.
- **FR-65** — The scanner exits 2 when called with anything but no arguments, `--all`, `--file <path>`, or a base and a head, each optionally after `--format github`.
- **FR-66** — The scanner exits 3, naming the fault, when an installed adapter does not export or return what the scanner reads.
- **FR-67** — The `no-comments` hook exits 3, naming the fix, when `node` is not on `PATH`.

### 2.8 No comments: the kept forms

- **FR-68** — In every language, a gate marker alone on a line comment at the start of its line is kept: `agent-gate:<part>:<version>` where `<part>` is one of agent-gates' parts, or `<tool>-gate:[<part>:]<version>` where `<tool>` and `<part>` are each one lowercase word.
- **FR-69** — In JavaScript and TypeScript, Dart, shell, Rust and Python, a shebang on the first line is kept, unless a `#` word or `\c` follows its `#!`.
- **FR-70** — In JavaScript and TypeScript, a `/// <reference …/>` among the leading line comments, holding only its attributes, is kept.
- **FR-71** — In SQL, drizzle's `--> statement-breakpoint` is kept.
- **FR-72** — A kept form with any other text in its comment, or written in a block comment that spans lines, is refused.
- **FR-73** — Every other comment is refused, doc comments, suppressions, formatter hints and tool settings included.
- **FR-74** — A refusal names the forms kept in each language it refused a comment in.

### 2.9 No comments: reading each language

- **FR-75** — A language's comments are those its own tokenizer finds; nothing inside a string, a heredoc or an expansion is a comment.
- **FR-76** — JavaScript and TypeScript are read with Babel's parser, in either decorator dialect TypeScript accepts, and a file Babel cannot parse is refused at the line and with the reason Babel gives.
- **FR-77** — In shell, `#` starts a comment only where a word starts.
- **FR-78** — SQL is read as PostgreSQL: a dollar-quoted body that parses as SQL is judged as code, and one that does not is text.
- **FR-79** — In Rust, an attribute carrying `doc = …` anywhere is a doc comment, and `#[doc(hidden)]` is code.
- **FR-80** — In Python, a string that stands alone as a statement, a docstring included, is a comment.
- **FR-81** — In Dart, SQL, shell, Rust and Python, a string, comment, quote, character, expansion or heredoc that never closes refuses the file at the line where it opens.
- **FR-82** — Dart and SQL refuse an unbalanced bracket, Python a bracket that never closes and a line continuation at the end of the file, and SQL a `$` that starts neither a dollar quote nor a parameter.

### 2.10 Installing by language

- **FR-83** — `install no-comments` installs the `no-comments-<language>` gate of each language the tracked files hold, beside any gate named with it. With no tracked file a language's gate reads, it is refused as `no_language_tracked`, writing nothing.

### 2.11 Format

- **FR-84** — `format` installs `.githooks/pre-commit`, `.githooks/pre-commit.d/format`, `.githooks/ci-setup`, `.github/workflows/format.yml` and `.githooks/.gitattributes`.
- **FR-85** — `install format --command <command>` writes the project's format command into the hook; agent-gates looks up no format task of its own. A reinstall without `--command` keeps the installed command. With none given and none installed, install is refused as `fill_missing`, naming `--command` with an example, and writes nothing.
- **FR-86** — `install --setup <command>` writes the CI setup command into `.githooks/ci-setup`, which the format workflow runs before its check, as will any later gate's workflow that needs the project set up. A reinstall without `--setup` keeps the installed command; with none ever given, the setup runs nothing.
- **FR-87** — `--command` or `--setup` with no command, given twice, or with no gate named that runs it, is a usage error, `flag_misplaced`; another argument starting with `-` is an `unknown_gate`.
- **FR-88** — A hook or setup file holding the current release with another command than install was given is `reconfigured`, and install rewrites it without a backup.
- **FR-89** — On commit, the `format` hook runs the command; when it fails, the commit is refused with its output.
- **FR-90** — The hook stages what the command changed in each file the commit stages whole, so the commit holds the formatted file.
- **FR-91** — A partly staged file the command changes refuses the commit, naming the file, and nothing is staged.
- **FR-92** — A file the commit leaves out that the command changed stays in the worktree unstaged, and the hook lists it.
- **FR-93** — The `format` hook does not run during a merge.
- **FR-94** — The format workflow runs `.githooks/ci-setup`, then the hook with `--check`, which runs the command and refuses each tracked file it changes, naming it.
- **FR-95** — `doctor` fails when the format command's program is not on `PATH`, and warns when no CI setup command is installed or its program is not on `PATH`.

### 2.12 No comments: one file

- **FR-96** — `scan.cjs --file <path>` judges the one file at `<path>`, relative to the working directory or absolute, as the working tree holds it, whatever the index holds.
- **FR-97** — `--file` does not judge a file a commit would not judge (FR-55, FR-57), a file git ignores, or a path holding no file.
- **FR-98** — `--file` on a path outside the checkout it runs in exits 2, naming the path and the checkout.
- **FR-99** — Under `--file`, a comment is added unless the file held it at `HEAD` under the same path; so every comment of a file new, moved or renamed since `HEAD`, and a comment moved in from another file, is added.
- **FR-100** — `--file` writes nothing: the working tree and the index stay as they were.

### 2.13 The Claude Code plugin

- **FR-101** — The `cniska-gates` plugin runs its hook after each `Edit`, `Write` or `MultiEdit`.
- **FR-102** — The hook runs `scan.cjs --file` on the edited file, a relative path read from the edit's working directory, in the checkout holding the file.
- **FR-103** — When the scanner refuses, the hook prints its reply as the PostToolUse `additionalContext`; otherwise it prints nothing.
- **FR-104** — The hook exits 0 whatever happens, and changes no file.
- **FR-105** — The hook does nothing for input naming no file, a file outside a checkout, or a checkout without `.githooks/no-comments/scan.cjs`.
- **FR-106** — Without `jq` or `node` on `PATH`, with input that is not JSON, or with a scanner that exits other than 0 or 1, the hook prints nothing and writes to stderr a note naming why the edit was not judged.

## 3. Non-functional requirements

- **NF-1** — The installed gates run with git, a POSIX shell and `node` alone: nothing installed in the project, and neither agent-gates nor Bun on `PATH`. The `format` gate also runs the project's own format command.
- **NF-2** — The plugin's hook runs with bash, git, `node` and `jq` alone.

## 4. Out of scope

- Configuring a gate: a gate has no options beyond the format and CI setup commands (FR-85, FR-86), and the installed files are the only state.
- Finding a project's format command: install is given it (FR-85).
- Driving a project's comment count to zero; the gates stop it growing (FR-34).
- Judging code embedded in another language: shell in a workflow's `run:`, SQL in a string, `.vue` files.
- Another SQL dialect than PostgreSQL.
- Checking Python's indentation.
- Uninstalling a gate, other than deleting its files (FR-13).

## 5. Acceptance criteria

- **AC-1** — Run `agent-gates` alone, an unknown command, `doctor` with an argument and `install` with an unknown gate: the listing on stdout with exit 0, then three usage errors on stderr, each exiting 2 with its usage as the resolve and nothing on stdout, and nothing written. (FR-1, FR-3, FR-4, FR-5)
- **AC-2** — Run `doctor` and `install` outside a git checkout, and with no git on `PATH`: a `not_a_checkout` refusal exiting 1, and a `git_unavailable` fault exiting 3. (FR-4, FR-6, FR-7)
- **AC-3** — `install commit-subject` from a subdirectory of a fresh checkout: its three files at the checkout's root, the hook alone executable, each carrying its marker, `.githooks/.gitattributes` marking the hooks generated with LF endings, `core.hooksPath` set to `.githooks`, and one JSON line naming the gate, each file `missing` with no backup, and `prepare` `absent`. (FR-2, FR-6, FR-10, FR-12, FR-13, FR-14, FR-20, FR-21)
- **AC-4** — Install each `no-comments-<language>` gate: its six files; then `install` with no gate named reinstalls every one, and after one adapter is deleted, `doctor` no longer names its gate. (FR-8, FR-9, FR-11, FR-13)
- **AC-5** — `install` with no gate named in a checkout with none installed: refused as `no_gates_chosen`, and nothing written. (FR-9)
- **AC-6** — Over an install, put an earlier release's bytes in one file, edit another by hand, mark a third with a later version and clear the hook's executable bit: `doctor` warns `behind`, `changed` and `ahead` and fails `not-executable`, exiting 1; `install` reports each state, restores the behind and not-executable files without a backup, sets the changed one aside before replacing it, and leaves the ahead one. Edit the same file again and install: the second backup takes the next free name. (FR-15, FR-16, FR-17, FR-18, FR-20, FR-30)
- **AC-7** — A project's own `commit-msg` hook, and its own `pre-commit.d/no-comments` step, without a marker: `install` is refused as `hook_occupied` and writes nothing, and `doctor` fails the hook with the same message and fix. A project's own unmarked `commits.yml` is set aside and replaced instead. (FR-19, FR-30)
- **AC-8** — With `core.hooksPath` spelled `./.githooks/`, install succeeds; set to `.husky`, install is refused as `hooks_path_occupied`, writing nothing, and `doctor` fails it with that refusal; unset after an install, `doctor` fails it, exits 1 and prints its report on stdout. (FR-21, FR-22, FR-27, FR-31)
- **AC-9** — Install with a `package.json` holding no `prepare` and a four-space indent, one holding the earlier wiring, one holding another script and one that does not parse: the first two get the wiring with every key, their order and the indent kept, the last two are refused as `prepare_occupied` and `manifest_unparseable` writing nothing, and `doctor` gives each its state. Run the written script in a fresh clone and outside a checkout: the clone is wired, and outside it succeeds doing nothing. (FR-23, FR-24, FR-25, FR-32)
- **AC-10** — Install where `.github` is a file: refused as `write_failed`, naming the path. (FR-26)
- **AC-11** — `doctor` in an empty checkout with no gate, then after a clean install of `commit-subject` and `no-comments-javascript` with a tracked TypeScript file: one warning exiting 0, then every check passing in order, exiting 0. (FR-27, FR-28, FR-29)
- **AC-12** — Install `no-comments-javascript` and `no-comments-rust` where the project tracks TypeScript and Python files and no Rust: `doctor` warns that Python's gate is missing and Rust's is unused, in one check whose fix installs the one and deletes the other's adapter. (FR-33)
- **AC-13** — With tracked files holding comments and one that does not parse, `doctor` warns with their counts and the sweep as its fix; without them it passes; with the installed scanner edited, it warns that nothing was counted. (FR-34, FR-35)
- **AC-14** — Steps in `.githooks/pre-commit.d/` named to run in an order, one not executable, one failing with status 7: the executable steps before the failing one run in name order, the rest do not, and the hook exits 7. A step named `format` among them runs first. (FR-36)
- **AC-15** — Commit with the gate installed: each type, a scope and a `!` pass; a subject that is not a Conventional Commit, an uppercase scope, a 51-byte subject, a non-ASCII subject, a body, and an empty or blank subject are each refused, naming the reason and the subject, with no commit made. (FR-37, FR-38, FR-39, FR-40, FR-41, FR-45)
- **AC-16** — Commit messages with `#` lines after the subject, a scissors line with a body below it, and carriage returns pass; `fixup!` and `squash!` of a good subject pass and of a bad one are refused; an `amend!` message passes or is refused by the message after its first line. (FR-40, FR-42, FR-43)
- **AC-17** — Merge a branch with a bad subject and a comment added in the conflict resolution: the merge commit is made. (FR-44, FR-58)
- **AC-18** — Run the installed commits workflow's steps with the environment GitHub gives a push to the default branch, a push that creates a branch, the default branch's first push, a new branch with no default branch on origin, and a pull request: each judges the commits its range holds, merges skipped, and refuses an autosquash commit. (FR-46, FR-47, FR-48)
- **AC-19** — Commit with `no-comments-javascript` installed: a clean change passes; a change adding comments is refused with the reply, and no commit is made; a comment staged and then removed from the working tree is refused, and committing the path with `git commit <path>` passes. (FR-49, FR-60)
- **AC-20** — Commit changes that move a comment, reindent it, rename its file and move it to another file: each passes. Edit, split, join, duplicate and copy a comment, move one out of a deleted file, and keep one in a file whose earlier version did not parse: each is refused. (FR-52, FR-53, FR-54)
- **AC-21** — Commit generated, vendored, binary and symlinked files holding comments, a Markdown file, and a file whose first line says it is generated: only the last is refused. Commit files without an extension under `#!/usr/bin/env -S node`, `#!/usr/bin/python3.12` and `#!/usr/bin/env uv run --script`: each is judged as its language. Commit a Markdown file with a throwing adapter installed, and a Python file with no Python adapter: both pass. (FR-55, FR-56, FR-57)
- **AC-22** — Commit, in each language, a file that never closes a construct, and an unbalanced bracket in Dart and SQL: each is refused at the line where it opens, as not parsing, with its reason; a TypeScript syntax error is refused at Babel's line and reason. (FR-59, FR-76, FR-81, FR-82)
- **AC-23** — Commit a comment longer than 120 characters, and comments whose full reply passes 4,000 bytes: the first is cut with `…`, and the reply fits 4,000 bytes and ends counting what it does not show. (FR-61, FR-62)
- **AC-24** — Run the installed no-comments workflow's step with the environment GitHub gives a push to the default branch, a push that creates a branch, and a branch with no history in common: each judges the files its range changes, or every file. Run the scanner with `--format github` over more than ten findings: nine annotations and a count on stdout, and the whole reply on stderr. (FR-50, FR-63, FR-64)
- **AC-25** — Run `scan.cjs --all` over tracked files with comments, then with a base and no head, `--all` with a base, and an unknown flag; break an installed adapter; and commit with no `node` on `PATH`: the sweep lists every comment with exit 1, the calls exit 2, the broken adapter exits 3 naming it, and the hook exits 3 naming the fix. (FR-51, FR-64, FR-65, FR-66, FR-67)
- **AC-26** — Commit, in each language, each form it keeps, then each with trailing text, as a block spanning lines and placed off the start of its line, and a doc comment, a suppression and a tool setting: the kept forms pass, and the rest are refused, the reply naming each refused language's kept forms. (FR-68, FR-69, FR-70, FR-71, FR-72, FR-73, FR-74)
- **AC-27** — Commit files whose comment markers sit inside strings, heredocs and expansions; a shell `#` inside a word; a SQL dollar quote holding SQL with a comment and one holding text; a Rust `#[doc(hidden)]` and a `#[cfg_attr(…, doc = …)]`; a Python docstring; and TypeScript in each decorator dialect: only the SQL comment, the doc attribute and the docstring are refused. (FR-75, FR-76, FR-77, FR-78, FR-79, FR-80)
- **AC-28** — Install every gate, then commit with only git, the shell's utilities and `node` on `PATH`: the hooks judge the commit. (NF-1)
- **AC-29** — In a checkout tracking TypeScript and Python files with no gate, `doctor` warns that both languages' gates are missing, with `agent-gates install no-comments` as the fix; `install no-comments` then installs `no-comments-javascript` and `no-comments-python`. In a checkout tracking neither, `install no-comments` is refused as `no_language_tracked`, writing nothing. (FR-33, FR-83)
- **AC-30** — `install format` without `--command`, where the project declares a `format` script and a `format:` target: refused as `fill_missing`, naming `--command` first with an example, writing nothing. Then, where the task is a `Makefile` `fmt:` target, `install format --command "make fmt"` alone installs the five files, reports the command, changes no project file, and formats the next commit. (FR-8, FR-20, FR-84, FR-85)
- **AC-31** — Install with a command and a setup, then `install` alone: both kept, every file `installed`; then with another `--command`: the hook is `reconfigured` and rewritten without a backup, and the setup kept. `--command` or `--setup` without `format` named, with no command, or twice: usage errors, writing nothing. (FR-85, FR-86, FR-87, FR-88)
- **AC-32** — Commit with the gate installed: a file staged whole is committed formatted; a partly staged file the command changes is refused, naming it, with the index unchanged; a partly staged file it leaves alone is committed; another file it changed stays unstaged and is listed; a failing command refuses the commit with its output; a merge commit is made without running it. (FR-89, FR-90, FR-91, FR-92, FR-93)
- **AC-33** — Run the format workflow's steps before and after `--setup` is given: the setup step does nothing, then runs the command; the `--check` step passes over formatted files and refuses a file the command changes, naming it. (FR-86, FR-94)
- **AC-34** — `doctor` with a command whose program is not on `PATH`: it fails; with no setup command, or one whose program is not on `PATH`: it warns; with the hook's command emptied: it fails the hook with install's refusal. (FR-30, FR-95)
- **AC-35** — Run `scan.cjs --file` on a tracked file whose working tree adds a comment to one `HEAD` holds, a comment the index does not hold, from the checkout's root, from the file's directory, and by an absolute path from another directory; on a file whose index adds a comment its working tree removed; on an ignored, a generated and a binary file, a symlink and a missing path; on a new file, a renamed file and a file a comment moved into; and on a file outside the checkout: the first is refused with the reply naming only the new comment, the same each way; the next six pass; the next three are refused; the last exits 2 naming the path and the checkout; the files and git's status are unchanged. (FR-96, FR-97, FR-98, FR-99, FR-100)
- **AC-36** — Run the hook as `hooks.json` registers it, with only a shell to run the command, bash, git, `node` and `jq` on `PATH`, after an edit adding a comment, named by an absolute path and by a path relative to a subdirectory: it exits 0, printing the scanner's reply as the PostToolUse context, the file unchanged; after a clean edit, for a file outside a checkout, in a checkout without the gate, and for input naming no file: it exits 0, printing nothing. (FR-101, FR-102, FR-103, FR-104, FR-105, NF-2)
- **AC-37** — Run the hook without `jq`, without `node`, with input that is not JSON, and with a scanner that exits 2: each exits 0, prints nothing, and writes a note naming why. (FR-104, FR-106)

## 6. Deliverables

- **D-1** — The `agent-gates` CLI, run by Bun from a checkout and linked onto `PATH` by `mise install` in the primary checkout, never in a worktree.
- **D-2** — The gate files in `gates/`, installed byte for byte, the `no-comments` scanner and adapters bundled into them from `src/`.
- **D-3** — `README.md` (install, the gates, what each refuses and keeps, the commands), `AGENTS.md` (repository rules), `src/README.md` (module map), and this spec.
- **D-4** — The test suite, run by `bun run check`, and the acceptance suite in `acceptance/`, run by `bun run acceptance`. The acceptance suite drives the CLI, the installed hooks through git, the installed scanner through `node`, the installed workflows' steps with the environment GitHub Actions gives them, and the plugin's hook as its `hooks.json` registers it; it imports nothing from `src/`.
- **D-5** — The optional `cniska-gates` Claude Code plugin in `plugin/`.

## 7. Constraints (fixed)

- **C-1** — The CLI is TypeScript on Bun; the installed gates are POSIX shell and CommonJS run by `node`.
- **C-2** — No config file: the installed files and their markers are the only state.
- **C-3** — Every CLI command's output is one JSON line, for agents to read.

## 8. Open decisions (left to the builder)

- How a lexer finds a language's comments, provided FR-75 holds.
- How the scanner and adapters are bundled, and how a release's bytes are recognised (bounded by FR-15).
- The wording of each message and fix, provided each refusal names its code.

### Policies chosen (not open)

- `ok` in a command's output means the command ran; `doctor`'s judgement is in its result and exit code (FR-27).
- A missing or unexecutable gate file fails `doctor`; a file that differs from this release only warns, since the gate still runs (FR-30).
- An executable gate file without a marker is refused rather than set aside, since it is the project's own hook or step; an unmarked file that is not executable is set aside (FR-19).
- The commits workflow refuses autosquash commits the hook lets through locally, so they are squashed before they land (FR-43, FR-47).

## 9. Open questions and known gaps

Each requirement still needs the owner's confirmation before it is contract.

- **The format hook misses paths git quotes.** It reads git's path lists one per line, and git quotes a path holding a control character, a double quote or a backslash even with `core.quotePath` off. So a partly staged file with such a name that the command changes is committed unformatted instead of refused (FR-91).

- **Not every criterion is proven yet.** A criterion with a passing test in the acceptance suite is proven; the rest are todos there. `src/spec.test.ts` ties the suite to this spec.
