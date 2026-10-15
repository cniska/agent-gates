# agent-gates Specification

> Gate your agents' work and save them round trips: git hooks refuse a bad commit locally and GitHub workflows refuse its subject and comments again in CI, for every contributor, and an optional Claude Code plugin formats each edit and shows the agent the comments it added, right after the edit.

This document states what must hold, not how. [`README.md`](README.md) lists every gate with a summary of what it refuses, [`docs/`](docs/) states those refusals in full, says how the gates judge and holds the commands, and [`src/README.md`](src/README.md) maps the modules that meet these requirements.

**Status: reverse-engineered from the code at `db5b96e`, unverified.** Each requirement states behavior the code shows today. None is contract until the owner confirms it. §9 lists the open questions.

## 1. Purpose & context

A coding agent excuses a workaround in a comment, writes a commit message nobody can scan, or commits unformatted code that fails the project's check, and a reviewer reading the diff tends to accept all of it. agent-gates installs gates that git hooks enforce on commit and push, for every developer: the commit subject, the format and no added comments, and the hooks run the project's own check steps, which `doctor` holds CI to running. GitHub workflows enforce the commit subject and no added comments again in CI. The format gate formats, so it runs only where code is written, on commit and after an agent's edit, and never in CI, where the project's own check refuses unformatted code. The gates are files committed with the project, so contributors and CI are gated without installing agent-gates; agent-gates installs them, brings them up to date, and judges their health. The optional `cniska-gates` Claude Code plugin optimizes the agent's loop: it formats each edit with the project's own command and shows the agent the comments the edit added, before a gate refuses the commit, and denies a git command that skips the gates.

**Primary user:** coding agents and their owner, installing gates into a project, reading why a commit was refused, and running the plugin in the agent's sessions. Not the audience: projects that want a configurable linter; a gate here has no options.

## 2. Functional requirements

### 2.1 The CLI

- **FR-1** — `agent-gates` with no command prints the commands, each with its name, usage and summary, and `--version` (FR-115) the same way as a flag, and exits 0.
- **FR-2** — A command that succeeds prints one JSON line on stdout naming the command, with `ok: true` and its result.
- **FR-3** — A command that fails prints one JSON line on stderr naming the command, with `ok: false` and an error carrying its kind, code, message, meta and resolve, and prints nothing on stdout.
- **FR-4** — An error exits 2 for the kind `usage`, 1 for `refusal` and 3 for `fault`.
- **FR-5** — An unknown command, a wrong number of arguments and an unknown gate name are usage errors whose resolve is the usage to follow.
- **FR-6** — A command acts on the root of the git checkout it runs in, from any directory below it; outside a checkout it is refused as `not_a_checkout`.
- **FR-7** — A command that cannot run git fails as the fault `git_unavailable`.

### 2.2 Install

- **FR-8** — The gates are `commit-subject`, `format`, and `no-comments-<language>` for each of `javascript`, `dart`, `sql`, `shell`, `rust` and `python`.
- **FR-9** — `install <gate>` installs that one gate and updates every gate already installed, and `install` alone updates every installed gate. Named none with none installed, it is refused as `no_gates_chosen`; naming two gates is the usage error `wrong_arity`.
- **FR-10** — `commit-subject` installs `.githooks/commit-msg`, `.github/workflows/commits.yml`, `.githooks/.gitattributes`, `.githooks/pre-push`, `.githooks/pre-push.d/commit-subject` and `.githooks/judge-push`.
- **FR-11** — `no-comments-<language>` installs `.githooks/pre-commit`, `.githooks/pre-commit.d/no-comments`, `.githooks/pre-push`, `.githooks/pre-push.d/no-comments`, `.githooks/judge-push`, `.githooks/no-comments/scan.cjs`, `.githooks/no-comments/<language>.cjs`, `.github/workflows/no-comments.yml` and `.githooks/.gitattributes`.
- **FR-12** — The installed hooks and hook steps are executable, and the other installed files are not.
- **FR-13** — Each installed file carries a marker, `agent-gate:<part>:<version>`, and the installed gates are read back from these markers alone; deleting a language's adapter uninstalls that language's gate.
- **FR-14** — `.githooks/.gitattributes` marks every file under `.githooks` `linguist-generated` with LF line endings.
- **FR-15** — A file holding an earlier release's bytes is `behind`, and install replaces it without a backup.
- **FR-16** — A file matching no release is `changed`, and install copies it aside to `<file>.agent-gates-backup`, or to the first free `<file>.agent-gates-backup-<n>` from 2, before replacing it.
- **FR-17** — A file whose marker names a later version of its part is `ahead`, and install leaves it.
- **FR-18** — A hook holding the current bytes without its executable bit is `not-executable`, and install restores the bit without a backup.
- **FR-19** — An executable gate file, a hook or a hook step, with no `agent-gate` marker is `occupied`, and install is refused as `hook_occupied`, writing nothing. A gate file that is not executable and has no marker is `changed`.
- **FR-20** — Install's result names the gates it installed, each file's path, the file's state before install acted and its backup, the `prepare` script's state, and the format command and the commit prefixes installed, each `null` when there is none.
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

- **FR-37** — The `commit-msg` hook refuses a subject that is not `<type>[(<scope>)][!]: <description>`, where the type is one of the prefixes installed with the gate (FR-114), or, with none installed, one of the default set `build`, `chore`, `ci`, `docs`, `feat`, `fix`, `perf`, `refactor`, `revert`, `style` and `test`, the scope is lowercase letters, digits and hyphens, and the description starts with a character other than whitespace. The refusal names the allowed types.
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

- **FR-83** — `install no-comments` installs the `no-comments-<language>` gate of each language the tracked files hold. With no tracked file a language's gate reads, it is refused as `no_language_tracked`, writing nothing.

### 2.11 Format

- **FR-84** — `format` installs `.githooks/pre-commit`, `.githooks/pre-commit.d/format` and `.githooks/.gitattributes`.
- **FR-85** — `install format --command <command>` writes the project's format command into the hook; agent-gates looks up no format task of its own. A reinstall without `--command` keeps the installed command. With none given and none installed, install is refused as `fill_missing`, naming `--command` with an example, and writes nothing.
- **FR-86** — `format` installs no workflow and no CI setup: it runs on commit and, through the plugin, after an agent's edit (FR-119), never in CI.
- **FR-87** — `--command` with no command, `--prefixes` with no list, either given twice, or with no gate named that runs it, `format` for the command and `commit-subject` for the list, is a usage error, `flag_misplaced`; another argument starting with `-`, `--setup` included, is an `unknown_gate`.
- **FR-88** — A hook holding the current release with another command or list than install was given is `reconfigured`, and install rewrites it without a backup.
- **FR-89** — On commit, the `format` hook runs the command; when it fails, the commit is refused with its output.
- **FR-90** — The hook stages what the command changed in each file the commit stages whole, so the commit holds the formatted file.
- **FR-91** — A partly staged file the command changes refuses the commit, naming the file, and nothing is staged.
- **FR-92** — A file the commit leaves out that the command changed stays in the worktree unstaged, and the hook lists it.
- **FR-93** — The `format` hook does not run during a merge.
- **FR-94** — The `format` hook with `--run`, from any directory of the checkout, runs the command from the checkout's root and exits with its status, staging nothing.
- **FR-95** — `doctor` fails when the format command's program is not on `PATH`. It reports the installed commit prefixes, or, with none installed, that the default set applies, and checks no `PATH` for them.

### 2.12 No comments: one file

- **FR-96** — `scan.cjs --file <path>` judges the one file at `<path>`, relative to the working directory or absolute, as the working tree holds it, whatever the index holds.
- **FR-97** — `--file` does not judge a file a commit would not judge (FR-55, FR-57), a file git ignores, or a path holding no file.
- **FR-98** — `--file` on a path outside the checkout it runs in exits 2, naming the path and the checkout.
- **FR-99** — Under `--file`, a comment is added unless the file held it at `HEAD` under the same path; so every comment of a file new, moved or renamed since `HEAD`, and a comment moved in from another file, is added.
- **FR-100** — `--file` writes nothing: the working tree and the index stay as they were.

### 2.13 The Claude Code plugin

- **FR-101** — The `cniska-gates` plugin runs its hook after each `Edit`, `Write` or `MultiEdit`, allowing it 60 s.
- **FR-102** — The hook runs `scan.cjs --file` on the edited file, a relative path read from the edit's working directory, in the checkout holding the file.
- **FR-103** — The hook prints as the PostToolUse `additionalContext` the format step's line (FR-120) and, when the scanner refuses, its reply; with neither, it prints nothing.
- **FR-104** — The hook exits 0 whatever happens, and changes no file but what the format command writes; the index stays as it was.
- **FR-105** — The hook does nothing for input naming no file, or a file outside a checkout. In a checkout without `.githooks/no-comments/scan.cjs` it does not scan, and without `.githooks/pre-commit.d/format` it does not format.
- **FR-106** — Without `jq` on `PATH`, or with input that is not JSON, the hook prints nothing and writes to stderr a note naming why the edit was neither formatted nor judged. Without `node` on `PATH`, or with a scanner that exits other than 0 or 1, it does not scan and writes to stderr a note naming why the edit's comments were not judged.

### 2.14 The project's own steps

- **FR-107** — With a gate installed, `doctor` warns about each executable file in `.githooks/pre-commit.d/` or `.githooks/pre-push.d/` that is no gate file and carries no `agent-gate` marker, while no workflow in `.github/workflows/` names its path, so CI never runs it; once a workflow names each, the check passes, and with no such file it is not reported.

### 2.15 Judging a push before it leaves

- **FR-108** — `.githooks/pre-push` runs each executable file in `.githooks/pre-push.d/` in name order, each given the arguments and the pushed refs git gives the hook, and stops at the first that fails, exiting with its status, so the push does not leave.
- **FR-109** — Before a push, `commit-subject` judges each ref the push updates or creates by the commits workflow's rules (FR-46, FR-47), its range starting at the remote's tip of the ref, or, for a ref the push creates other than the remote's default branch, at that default branch as the remote's `HEAD` names it; with none of those, it holds every commit the head reaches. A ref the push deletes is not judged.
- **FR-110** — Before a push, `no-comments` judges each ref the push updates or creates by the no-comments workflow's rules (FR-50), against its merge base with the base FR-109 names.
- **FR-111** — The commits and no-comments workflows and the pre-push steps judge through one installed script, `.githooks/judge-push`, so a push is judged by the same rules before it leaves and in CI.

### 2.16 The Claude Code plugin: skipping the gates

- **FR-112** — Before each `Bash` command, the plugin judges each git command in it against the checkout that command targets: the hook's working directory, moved by its own `git -C` and by each `cd` before it that the shell would follow: one not ended by `|` or `&`, into a directory that exists or that a `mkdir` earlier in the command makes, `cd -` returning to the directory before, and a `cd` inside `( … )` or `$( … )` holding only until the subshell closes, one inside backticks never, and one inside `{ … }` holding on. A quoted path keeps its spaces, and a `git -C` directory that does not exist stands for its nearest existing parent. In a checkout whose `.githooks/commit-msg`, `pre-commit` or `pre-push` carries an `agent-gate` marker, it denies a command that runs `git commit` or `git push` with `--no-verify`, `git commit` with `-n` among its short options, or git with `core.hooksPath`, its key in any case, set by `-c` or `git config` to anything but `.githooks`, or unset. The denial names the gates the command skips, the hooks' steps on commit or push, and tells the agent to fix what the refusing gate names instead.
- **FR-113** — The check lets through a command whose skip appears only inside a quoted string or the body of a heredoc written to a file or a message, a read of `core.hooksPath`, `git push -n`, and every command in a checkout without the marked hooks; a heredoc's body is skipped only when that heredoc's own command is `cat`, `tee` or `git` with nothing piped into or out of it, and its delimiter is quoted or its body substitutes no command; every other body, and one whose heredoc never ends, is read as commands. A git command inside `$( … )`, backticks or a group is judged like any other. Without `jq`, or with input that is not JSON, it lets the command through and writes to stderr a note naming why it was not checked.

### 2.17 Commit subjects: the prefixes

- **FR-114** — `install commit-subject --prefixes <a,b,c>` writes the project's allowed types into the `commit-msg` hook, which the pre-push step and the commits workflow judge through. A reinstall without `--prefixes` keeps the installed list; with none ever given, the hook allows the default set (FR-37). The list is lowercase letters in words joined by single commas; any other value is a usage error, `fill_malformed`, and nothing is written.

### 2.18 The version

- **FR-115** — `agent-gates --version` prints the running build's version, as `package.json` states it, alone on one line and exits 0; with an argument after it, it is the usage error `wrong_arity`. It is the one invocation that prints no JSON line (FR-2), so an installer and a package manager's test can read it.

### 2.19 The release build

- **FR-116** — `scripts/build-compiled.sh <outfile>` compiles the CLI into one executable that carries every gate file and the version, so it runs every command with no checkout of agent-gates and no Bun on the machine.
- **FR-117** — `install.sh`, run by `curl … | sh`, downloads the latest release's build for this platform, checks it against its published sha256, runs it for its version, and installs it as `~/.local/bin/agent-gates`, writing it beside that path and renaming it into place. A download that fails, does not match its checksum, or reports a version that is not `x.y.z` installs nothing. Run again, it replaces the install.
- **FR-118** — The npm package `@cniska/agent-gates` installs the build for its platform from `@cniska/agent-gates-darwin-arm64` or `@cniska/agent-gates-linux-x64` and runs it with the arguments it was given, exiting as it exits. On another platform, or with the platform package missing, it refuses with `no_build_for_platform` or `platform_package_missing`; with a platform build that cannot start, with `binary_failed`.

### 2.20 The Claude Code plugin: formatting the edit

- **FR-119** — After each edit, before the scan, in a checkout whose `.githooks/pre-commit.d/format` carries `agent-gate:format:3` or later, the hook runs that file with `--run` (FR-94), so the project's own command formats the edited file before the scanner reads it.
- **FR-120** — The format run is stopped after 30 s, with every process it started. When the command fails or is stopped, the hook adds one line to the context naming the command and its exit status, or that it was stopped, then scans and exits 0, the index unchanged; when the command succeeds, it adds nothing. Without `sleep` on `PATH`, the run is not bounded.
- **FR-121** — Over a `format` hook before `agent-gate:format:3`, the hook does not format, and writes to stderr a note naming `agent-gates install`.

## 3. Non-functional requirements

- **NF-1** — The installed gates run with git, a POSIX shell and `node` alone: nothing installed in the project, and neither agent-gates nor Bun on `PATH`. The `format` gate also runs the project's own format command.
- **NF-2** — The plugin's hooks run with bash, git, `node`, `jq` and `sleep` alone; the format step also runs the project's own format command.

## 4. Out of scope

- Configuring a gate: a gate has no options beyond the format command (FR-85) and the commit prefixes (FR-114), and the installed files are the only state; configurable rules belong to the project's own linter.
- Finding a project's format command, and what its formatting is: the project's formatter owns that, and install is given its command (FR-85).
- Driving a project's comment count to zero; the project sweeps with `scan.cjs --all`, and the gates stop the count growing (FR-34).
- Blocking an edit, an installed gate file's included: the plugin formats the edit and reports the comments it added (FR-103, FR-119), and the gates refuse at commit.
- The workflow an agent follows.
- Recording or measuring agent work.
- Isolating the checkouts of agents working in parallel.
- Judging code embedded in another language: shell in a workflow's `run:`, SQL in a string, `.vue` files.
- Another SQL dialect than PostgreSQL.
- Checking Python's indentation; Python's own parser refuses it.
- Uninstalling a gate: the project deletes its files (FR-13).

## 5. Acceptance criteria

- **AC-1** — Run `agent-gates` alone, an unknown command, `doctor` with an argument and `install` with an unknown gate: the listing, with `--version` among its flags, on stdout with exit 0, then three usage errors on stderr, each exiting 2 with its usage as the resolve and nothing on stdout, and nothing written. (FR-1, FR-3, FR-4, FR-5)
- **AC-2** — Run `doctor` and `install` outside a git checkout, and with no git on `PATH`: a `not_a_checkout` refusal exiting 1, and a `git_unavailable` fault exiting 3. (FR-4, FR-6, FR-7)
- **AC-3** — `install commit-subject` from a subdirectory of a fresh checkout: its six files at the checkout's root, the hooks and the step alone executable, each carrying its marker, `.githooks/.gitattributes` marking the hooks generated with LF endings, `core.hooksPath` set to `.githooks`, and one JSON line naming the gate, each file `missing` with no backup, and `prepare` `absent`. (FR-2, FR-6, FR-10, FR-12, FR-13, FR-14, FR-20, FR-21)
- **AC-4** — Install each `no-comments-<language>` gate: its nine files; then `install` with no gate named reinstalls every one, and after one adapter is deleted, `doctor` no longer names its gate. (FR-8, FR-9, FR-11, FR-13)
- **AC-5** — `install` with no gate named in a checkout with none installed: refused as `no_gates_chosen`, and nothing written. `install` naming two gates, `no-comments` among them or with `--command`: `wrong_arity`, writing nothing. (FR-5, FR-9)
- **AC-6** — Over an install, put an earlier release's bytes in one file, edit another by hand, mark a third with a later version and clear the hook's executable bit: `doctor` warns `behind`, `changed` and `ahead` and fails `not-executable`, exiting 1; `install` reports each state, restores the behind and not-executable files without a backup, sets the changed one aside before replacing it, and leaves the ahead one. Edit the same file again and install: the second backup takes the next free name. (FR-15, FR-16, FR-17, FR-18, FR-20, FR-30)
- **AC-7** — A project's own `commit-msg` hook, and its own `pre-commit.d/no-comments` step, without a marker: `install` is refused as `hook_occupied` and writes nothing, and `doctor` fails the hook with the same message and fix. A project's own unmarked `commits.yml` is set aside and replaced instead. (FR-19, FR-30)
- **AC-8** — With `core.hooksPath` spelled `./.githooks/`, install succeeds; set to `.husky`, install is refused as `hooks_path_occupied`, writing nothing, and `doctor` fails it with that refusal; unset after an install, `doctor` fails it, exits 1 and prints its report on stdout. (FR-21, FR-22, FR-27, FR-31)
- **AC-9** — Install with a `package.json` holding no `prepare` and a four-space indent, one holding the earlier wiring, one holding another script and one that does not parse: the first two get the wiring with every key, their order and the indent kept, the last two are refused as `prepare_occupied` and `manifest_unparseable` writing nothing, and `doctor` gives each its state. Run the written script in a fresh clone and outside a checkout: the clone is wired, and outside it succeeds doing nothing. (FR-23, FR-24, FR-25, FR-32)
- **AC-10** — Install where `.github` is a file: refused as `write_failed`, naming the path. (FR-26)
- **AC-11** — `doctor` in an empty checkout with no gate, then after a clean install of `commit-subject` and `no-comments-javascript` with a tracked TypeScript file: one warning exiting 0, then every check passing in order, exiting 0. (FR-27, FR-28, FR-29)
- **AC-12** — Install `no-comments-javascript` and `no-comments-rust` where the project tracks TypeScript and Python files and no Rust: `doctor` warns that Python's gate is missing and Rust's is unused, in one check whose fix installs the one and deletes the other's adapter. (FR-33)
- **AC-13** — With tracked files holding comments and one that does not parse, `doctor` warns with their counts and the sweep as its fix; without them it passes; with the installed scanner edited, it warns that nothing was counted. (FR-34, FR-35)
- **AC-14** — Steps in `.githooks/pre-commit.d/` named to run in an order, one not executable, one failing with status 7: the executable steps before the failing one run in name order, the rest do not, and the hook exits 7. A step named `format` among them runs first. (FR-36)
- **AC-15** — Commit with the gate installed: each type of the default set, `revert` among them, a scope and a `!` pass; a type outside it, a subject that is not a Conventional Commit, an uppercase scope, a 51-byte subject, a non-ASCII subject, a body, and an empty or blank subject are each refused, naming the reason and the subject, with no commit made, and the form's refusal names the default set. Installed with `--prefixes`, a type in the list passes, and a default type outside it is refused, naming the list. (FR-37, FR-38, FR-39, FR-40, FR-41, FR-45, FR-114)
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
- **AC-30** — `install format` without `--command`, where the project declares a `format` script and a `format:` target: refused as `fill_missing`, naming `--command` first with an example, writing nothing. Then, where the task is a `Makefile` `fmt:` target, `install format --command "make fmt"` alone installs the three files, reports the command, changes no project file, writes no workflow and no CI setup, and formats the next commit. (FR-8, FR-20, FR-84, FR-85, FR-86)
- **AC-31** — Install with a command, then `install` alone: the command kept, every file `installed`; then with another `--command`: the hook is `reconfigured` and rewritten without a backup. `--command` without `format` named, with no command, or twice: `flag_misplaced`; `--setup`: `unknown_gate`; each writing nothing. (FR-85, FR-87, FR-88)
- **AC-32** — Commit with the gate installed: a file staged whole is committed formatted; a partly staged file the command changes is refused, naming it, with the index unchanged, a name git quotes included; a partly staged file it leaves alone is committed; another file it changed stays unstaged and is listed; a failing command refuses the commit with its output; a merge commit is made without running it. (FR-89, FR-90, FR-91, FR-92, FR-93)
- **AC-33** — Run the `format` hook with `--run` from a subdirectory, over a staged file the command changes: it exits 0, the command runs at the checkout's root and formats the file in the working tree, and the index is unchanged; with a command that fails with status 3: it exits 3 with the command's output. (FR-94)
- **AC-34** — `doctor` with a command whose program is not on `PATH`: it fails; with one on `PATH`: every check passes; with the hook's command emptied: it fails the hook with install's refusal. With `commit-subject` installed, it passes the commit prefixes, saying the default set applies, then naming the installed list. (FR-30, FR-95)
- **AC-35** — Run `scan.cjs --file` on a tracked file whose working tree adds a comment to one `HEAD` holds, a comment the index does not hold, from the checkout's root, from the file's directory, and by an absolute path from another directory; on a file whose index adds a comment its working tree removed; on an ignored, a generated and a binary file, a symlink and a missing path; on a new file, a renamed file and a file a comment moved into; and on a file outside the checkout: the first is refused with the reply naming only the new comment, the same each way; the next six pass; the next three are refused; the last exits 2 naming the path and the checkout; the files and git's status are unchanged. (FR-96, FR-97, FR-98, FR-99, FR-100)
- **AC-36** — Run the hook as `hooks.json` registers it, with a 60 s timeout, from the plugin `plugin.json` names `cniska-gates`, with only a shell to run the command, bash, git, `node` and `jq` on `PATH`, after an edit adding a comment, named by an absolute path and by a path relative to a subdirectory: it exits 0, printing the scanner's reply as the PostToolUse context, the file unchanged; after a clean edit, for a file outside a checkout, for a file in a directory that does not exist, in a checkout without the gate, and for input naming no file: it exits 0, printing nothing. (FR-101, FR-102, FR-103, FR-104, FR-105, NF-2)
- **AC-37** — Run the hook without `jq`, without `node`, with input that is not JSON, and with a scanner that exits 2: each exits 0, prints nothing, and writes a note naming why. (FR-104, FR-106)
- **AC-38** — Over an install, add an executable step to `pre-commit.d` and one to `pre-push.d`, a step that is not executable and an executable one with a marker: `doctor` reports no step check before them, then, with a workflow naming only a longer path that starts with one of them, warns naming the first two, with a fix naming them; once a workflow runs both, the check passes. (FR-107)

- **AC-39** — Steps in `.githooks/pre-push.d/` named to run in an order, one not executable, one failing with status 7: the executable steps before the failing one run in name order, each given the remote, its URL and the pushed refs, the rest do not, and the hook exits 7. (FR-108)
- **AC-40** — Push from a clone with `commit-subject` and `no-comments-javascript` installed, over a default branch holding a bad subject: a `fixup!` commit the `commit-msg` hook let through, a bad subject and an added comment are each refused before the push leaves, naming it, with the remote unchanged; a clean commit pushes; a new branch is judged from the default branch alone, passing with a good subject and refused with a bad one; a branch's deletion pushes. The installed workflows run the same `.githooks/judge-push`. (FR-47, FR-108, FR-109, FR-110, FR-111)

- **AC-41** — Run the `PreToolUse` hook as `hooks.json` registers it, with only a shell, bash, git and `jq` on `PATH`, in a checkout with `commit-subject` and `no-comments-javascript` installed: `git commit --no-verify`, `git commit -anm` after `&&`, `git push --no-verify`, `git -c Core.HooksPath=/dev/null` after `;`, `git config core.hooksPath .husky` and `git config --unset core.hooksPath` are each denied, naming the gates on commit, on push, or both; a commit message holding `--no-verify` or `; git push --no-verify`, `git push -n`, `git config core.hooksPath .githooks`, a read of it, `-c core.hooksPath=./.githooks/` and a write to a gate file pass, printing nothing; and in a checkout without the gates, without `jq`, and with input that is not JSON, the command passes, the last two with a note. (FR-112, FR-113, NF-2)
- **AC-42** — Run the same hook from that checkout: a commit with `--no-verify` to a fresh repo made after `cd` into a new scratch directory, to a checkout without the gates reached by `cd` or by `git -C`, a heredoc whose body holds `git commit --no-verify`, written by `cat` quoted or ended by a tab-indented delimiter after `<<-`, by `tee` after `&&`, or by `cat` inside `{ … }`, and a commit message from a quoted heredoc holding an apostrophe each pass, printing nothing; from a checkout without the gates, `git commit --no-verify` after `cd` or `cd -P` into the gated checkout, after `cd` into a quoted path with a space that leads there, and after `git -C` naming it, also after `cd ~`, and inside `( … )` or `{ … }` after `cd` there, are each denied; from the gated checkout, `git commit --no-verify` after a `cd` into a missing directory and `;`, after a `cd` ended by `&` or `|`, after `cd -` back from a checkout without the gates, and after `( cd … )`, `$( cd … )` or a backtick `cd` into one are each denied; and in the gated checkout `git commit --no-verify` is denied after a heredoc whose body holds an apostrophe, after a commit message or an arithmetic holding `<<`, in a heredoc fed to `bash`, `source` or `eval` or piped to `sh`, in a `bash` heredoc after a `cat` heredoc on the same line, inside `$(...)` in an unquoted heredoc's body, and after a heredoc whose quoted delimiter holds a space. (FR-112, FR-113)
- **AC-43** — Install `commit-subject` with `--prefixes`, then `install` alone: the list kept, every file `installed`; then with another `--prefixes`: the hook is `reconfigured` and rewritten without a backup, and a push carrying a type outside the new list is refused before it leaves. Over the hook's earlier release, `install` alone reports it `behind` and replaces it, keeping the default set. `--prefixes` with an uppercase letter, a space, an empty word or a trailing comma: `fill_malformed`; with no list, twice, or without `commit-subject` named: `flag_misplaced`; each writing nothing. (FR-15, FR-87, FR-88, FR-109, FR-114)
- **AC-44** — Run `agent-gates --version`, then with an argument after it: the version alone on stdout with exit 0 and nothing on stderr, then a `wrong_arity` usage error exiting 2 with nothing on stdout. (FR-115)
- **AC-45** — Compile the release binary and run it with only its own directory and git on `PATH`, in a fresh checkout of made-up content: `--version` prints the version, `install commit-subject` succeeds, and `doctor` then passes with no failing check. (FR-116)
- **AC-46** — Run `install.sh` in a fresh home against a stand-in for the release downloads, twice, then once with a wrong checksum in another fresh home, then against builds that report an empty version, `1.2.3.4` and `../x`: the installed `agent-gates --version` prints the release's version and `~/.local/bin` holds only it, and the bad download and each mislabelled build are refused with nothing written. (FR-117)
- **AC-47** — Build the npm packages from a release build, install the shim into a prefix and run it through Node, first with its manifest naming only another platform's package, then without its platform package, then with it unexecutable, then whole: the first is refused as `no_build_for_platform`, the second as `platform_package_missing`, the third as `binary_failed`; then `--version` prints the package version, `--version now` exits 2 with the build's `wrong_arity` usage refusal, and `install commit-subject` succeeds in a fresh checkout. (FR-118)
- **AC-48** — Install `no-comments-javascript` and `format` with a command that strips the edit's comment, stage another file, then run the `PostToolUse` hook with only bash, git, `node`, `jq` and `sleep` on `PATH` after an edit adding a comment: it exits 0 within seconds, printing nothing, the edited file is formatted, the scanner finds no comment, no watchdog is left running, and the index is unchanged. Without `sleep` on `PATH`, a command taking a second still formats the file, printing nothing. (FR-119, FR-120, FR-104, NF-2)
- **AC-49** — With a command that fails with status 3: the context holds one line naming the command, an apostrophe in it kept, and its status, then the scanner's reply, the index unchanged. With a command that would format only after 33 s: within 33 s the context holds one line saying it ran past 30 s and was stopped, then the scanner's reply; after 36 s the file is still unformatted and the index unchanged. (FR-120, FR-103)
- **AC-50** — Over the `format` hook's earlier release with its command filled in: the hook writes a note naming `agent-gates install`, prints nothing, and formats nothing, the index unchanged. In a checkout without the gate, it prints nothing and the file is unchanged. (FR-121, FR-105)

## 6. Deliverables

- **D-1** — The `agent-gates` CLI, run by Bun from a checkout and linked onto `PATH` by `mise install` in the primary checkout, never in a worktree.
- **D-2** — The gate files in `gates/`, installed byte for byte, the `no-comments` scanner and adapters bundled into them from `src/`.
- **D-3** — `README.md` (what agent-gates is, the install, and every gate with a summary of what it refuses), `docs/` (the installed files, each gate's refusals in full, what the gates judge and keep, the commands, the plugin, development and releasing), `AGENTS.md` (repository rules), `src/README.md` (module map), and this spec.
- **D-4** — The test suite, run by `bun run check`, and the acceptance suite in `acceptance/`, run by `bun run acceptance`. The acceptance suite drives the CLI, the installed hooks through git, the installed scanner through `node`, the installed workflows' steps with the environment GitHub Actions gives them, the plugin's hook as its `hooks.json` registers it, the compiled release binary, `install.sh` against a stand-in for the release downloads, and the npm packages through Node; it imports nothing from `src/`.
- **D-5** — The optional `cniska-gates` Claude Code plugin in `plugin/`.
- **D-6** — The release binary `scripts/build-compiled.sh` compiles, for darwin-arm64 and linux-x64, shipped by a GitHub release with `install.sh`, by the npm packages and by the `cniska/tap` Homebrew formula, as [`docs/releasing.md`](docs/releasing.md) says.

## 7. Constraints (fixed)

- **C-1** — The CLI is TypeScript on Bun; the installed gates are POSIX shell and CommonJS run by `node`.
- **C-2** — No config file: the installed files and their markers are the only state.
- **C-3** — Every CLI command's output is one JSON line, for agents to read; `--version` alone prints plain text (FR-115).

## 8. Open decisions (left to the builder)

- How a lexer finds a language's comments, provided FR-75 holds.
- How the scanner and adapters are bundled, and how a release's bytes are recognised (bounded by FR-15).
- The wording of each message and fix, provided each refusal names its code.

### Policies chosen (not open)

- `ok` in a command's output means the command ran; `doctor`'s judgement is in its result and exit code (FR-27).
- A missing or unexecutable gate file fails `doctor`; a file that differs from this release only warns, since the gate still runs (FR-30).
- An executable gate file without a marker is refused rather than set aside, since it is the project's own hook or step; an unmarked file that is not executable is set aside (FR-19).
- The `commit-msg` hook lets an autosquash commit through, since a local fixup is fine until pushed; the pre-push step and the commits workflow refuse it, so it is squashed before it leaves (FR-43, FR-47, FR-109).

## 9. Open questions and known gaps

Each requirement still needs the owner's confirmation before it is contract.

- **Not every criterion is proven yet.** A criterion with a passing test in the acceptance suite is proven; the rest are todos there. `src/spec.test.ts` ties the suite to this spec.
