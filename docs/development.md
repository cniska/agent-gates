# Development

Setup, checks, layout and adding a language, for working on this repo.

## Setup

```bash
mise trust && mise install
bin/agent-gates doctor
```

- `mise install` sets up the clone as the [README](../README.md#from-a-clone) says, and the `bun install` its postinstall runs calls the `prepare` script, which points `core.hooksPath` at `.githooks/`. Only in the clone, never in a worktree, does it link `agent-gates` into `~/.bun/bin`, so removing a worktree never leaves the command pointing at a deleted checkout.
- `.worktree-hooks/setup` sets up a task worktree the same way, without linking the CLI.
- `.githooks/` holds the commit-subject, format and no-comments gates this repo installs on itself, and `bin/agent-gates doctor` reports their health.

## Checks

- `bun run check` runs lint, typecheck, knip (an export, file or dependency nothing uses) and tests, and `.githooks/pre-commit.d/check` runs it before each commit.
- `bun run acceptance` proves the criteria in [`SPEC.md`](../SPEC.md) through the CLI, the files it installs, and the release's binary, `install.sh` and npm packages alone, as the spec's D-4 says; each test in `acceptance/` is named for the criteria it proves, and `src/spec.test.ts`, in the check, fails when the tests and the criteria do not cite each other.
- `bun run format` formats `src/`, `acceptance/`, `scripts/` and `npm/` with Biome, and the format gate runs it with the linter off before each commit and stages what it changes in the staged files, as [Format](gates.md#format) says.
- `scripts/build-compiled.sh <outfile>` compiles the CLI into one executable with every gate file inside it, the binary a release ships.
- `scripts/release.sh patch|minor|major` bumps the version and tags it; `.github/workflows/release.yml` builds the tag into a GitHub release, the npm packages and a Homebrew repin, as [Releasing](releasing.md) says.
- `bun run gates:bundle` bundles `gates/no-comments/*.cjs` from `src/`; the tests also run the bundled scanner under Node.
- `.github/workflows/check.yml` runs the check and the acceptance suite on each push and pull request, and `commits.yml` and `no-comments.yml` run the gates.

## Layout

- `gates/` holds each gate file as it is installed, and a change to one bumps its version first, as [`AGENTS.md`](../AGENTS.md) describes.
- `plugin/` holds the optional Claude Code plugin, which [Claude Code plugin](plugin.md) describes.
- [`src/README.md`](../src/README.md) maps the modules and the boundaries between them.

## Adding a language

1. Add it to `LANGUAGE_NAMES` and `LANGUAGES` in `src/no-comments-languages.ts`, with its extensions and shebang interpreters.
2. Write `src/no-comments-<language>.ts` on the model of `src/no-comments-dart.ts`, the smallest adapter: `export const { comments, kept } = adapter({ lex, kept })`. `lex` returns each comment's `Span`, or `unterminated(<offset>, "<construct>")` where the file stops parsing. A comment the toolchain reads is kept with `directive(shown, { pattern, where })`, which matches the whole comment body and nothing after it; any other rule is a `{ shown, keeps }` form.
3. Check the lexer against the language's own tokenizer on real and deliberately broken files: same comments, and no refusal of a file the tokenizer accepts.
4. Add tests, a `GATES` and an `ADAPTER_FILES` entry in `src/gates-contract.ts`, a row in the [kept-comments table](no-comments.md#kept-comments) (a test checks it), the language in the list in [No comments](no-comments.md), and its gate's row in the [README's gate table](../README.md#gates).
5. Run `bun run gates:bundle` and record the hash, as [`AGENTS.md`](../AGENTS.md) describes. `bun run check` fails until the entry, bundle and hash agree.

## Rules

[`AGENTS.md`](../AGENTS.md) holds the repository's rules, and [`SPEC.md`](../SPEC.md) states what must hold.
