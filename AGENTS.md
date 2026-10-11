# agent-gates

Installs commit gates into a project and judges their health. [`README.md`](README.md) lists the gates and commands.

## Rules

- `bun run check` is the check: lint, typecheck and tests. It passes before every commit.
- `gates/` holds each gate file as it is installed. A change to a file's bytes bumps the version in its `# agent-gate:<part>:<version>` marker and appends that version's hash to the file's `versions` in `src/gates-contract.ts`; the registry tests in `src/gates.test.ts` hold both, and the earlier hashes let install update an unedited file without setting it aside. Then `bin/agent-gates install` brings this repo's own gates up to date, and a test fails until it has.
- A file every hook gate shares is marked `githooks`, never a gate name, so it does not read back as a chosen gate.
- Fix the cause, never work around it, and add no debt.
- Code carries no comments, tool contracts aside. A why goes into a name, a test, or this file.
- Commit directly to `main`, in Conventional Commits.
