# agent-gates

Installs commit gates into a project and judges their health. [`README.md`](README.md) lists the gates and commands. [`SPEC.md`](SPEC.md) states what must hold and changes in the same commit as the behavior it describes.

## Rules

- `bun run check` is the check: lint, typecheck and tests. It passes before every commit.
- `src/README.md` maps the modules and their boundaries; `src/modules.test.ts` lists each module's public files and holds the boundary.
- `gates/` holds each gate file as it is installed. A change to a file's bytes bumps the version in its `agent-gate:<part>:<version>` marker and appends that version's hash to the file's `versions` in `src/gates-contract.ts`; the registry tests in `src/gates.test.ts` hold both, and the earlier hashes let install update an unedited file without setting it aside. `gates/no-comments/*.cjs` are bundled from `src/` by `bun run gates:bundle`, taking their marker from `GATES`, so a change to their sources bumps the version first, then bundles; a test fails while a bundle is stale. Then `bin/agent-gates install` brings this repo's own gates up to date, and a test fails until it has.
- `plugin/` is the optional Claude Code plugin. Its hooks run in other people's sessions, so they stay bash needing only `jq`, `node`, git and the base system, and do nothing in a checkout without the gates they serve. They never block an edit, gate files included, since install needs them; the one block is a git command that skips the gates. `acceptance/plugin.acceptance.ts` holds that contract.
- A file several gates share carries a shared part (`githooks`, `no-comments`), never a gate name, so it does not read back as a chosen gate.
- Fix the cause, never work around it, and add no debt. Debt you find is fixed where it is found.
- Code carries no comments, tool contracts aside. A why goes into a name, a test, or this file.
- Commit directly to `main`, in Conventional Commits. The message is the subject line alone: no body, no trailers. The user stays the author.
- Push each commit to `main` once `bun run check` passes and a fresh reviewer accepts it; that accept is the owner's standing sign-off, so no push waits on them.
