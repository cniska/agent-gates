# src/

Flat, so a module is found by name. A file's prefix is its module: `gates-contract.ts` belongs to `gates`, `no-comments-scan.ts` to `no-comments`. A module that is one file carries its bare name (`git.ts`, `assert.ts`). A test sits beside its module as `<module>.test.ts`, or `<module>-<concern>.test.ts`; a test of a gate's installed hook or workflow is named for that file (`commit-msg-hook.test.ts`), and a test of the whole tree, such as `modules.test.ts`, belongs to no module. A `.test-support.ts` file holds helpers only tests import.

A module's files are named for their layer:

| File | Holds |
| --- | --- |
| `<module>.ts` | The module's operations, where it has more than a contract |
| `<module>-contract.ts` | Its types and constants, what other modules import |
| `<name>-command.ts` | The one `agent-gates` command `<name>`: parse the arguments, call the operations, return the result |
| `<module>-<concern>.ts` | One concern of the module, named for it (`no-comments-scan.ts`, `cli-output.ts`) |

Another module, or a test of one, reaches a module only through its public files; any other file of it, such as `no-comments-spans.ts`, is its own ([`modules.test.ts`](modules.test.ts), which lists each module's public files).

Only an entry, such as `cli.ts`, reads the environment; it passes what a module needs down as arguments ([`modules.test.ts`](modules.test.ts), which lists the entries).

## Modules

| Prefix | Responsibility |
| --- | --- |
| `cli` | Dispatch a command and print its result or error as TOON |
| `install` | The `install` command |
| `doctor` | Report the installed gates' health: their files, the hooks path, `prepare`, the format command, the commit prefixes, the workflows choice, the project's own hook steps no workflow runs while workflows are on, the comments tracked files already hold that `.no-comments-keep` does not keep, the secrets they hold that `.no-secrets-allow` does not name, and the unpinned actions their workflow and action files hold |
| `gates` | The registry of gate files, their text embedded in the build, the command, prefixes and workflows choice install writes into them, and installing them into a project |
| `gate` | Gate names and parts, the marker an installed file carries, and bundling the `no-comments`, `no-secrets` and `pinned-actions` scanners into `gates/` |
| `no-comments` | The scanner a `no-comments` gate runs: route a file to its language, read its comments, keep those `.no-comments-keep` lists, judge a change and report findings |
| `no-secrets` | The scanner a `no-secrets` gate runs: gitleaks' rules translated for Node's RegExp, the matcher, the allow file's fingerprints, reading a change and judging what it adds |
| `pinned-actions` | The scanner a `pinned-actions` gate runs: read each `uses:` of a changed workflow or action file, judge whether its reference is pinned and report the rest |
| `scanner` | What every scanner shares: reading the staged, pushed or whole change out of git, the call (`--format github`, `--all`, a base and a head), its usage error, the reply's capping and GitHub annotations, and running a scanner's main to the process's streams and exit code |
| `package-manifest` | The `prepare` script in a project's `package.json` |
| `git` | Run git and read its output |
| `github` | Read from GitHub, through `gh`, whether the checkout's `origin` is a private repository |
| `file-backup` | Copy a file aside before install replaces it |
| `coded-error`, `assert` | Errors with a code and kind; `unreachable` and `invariant` |

## Where to start

- `cli-commands.ts` lists the commands; `cli-contract.ts` is what one is.
- `gates-contract.ts` lists every gate's files, their versions and hashes; `gates.ts` installs them, from the text `gates-sources.ts` reads out of `gates/` when the code is bundled, so a compiled binary carries every gate file.
- `no-comments-main.ts` is the no-comments scanner's entry, and `no-comments-<language>.ts` each language's adapter; `no-secrets-main.ts` is the no-secrets scanner's and `pinned-actions-main.ts` the pinned-actions scanner's; `gate-bundles.ts` bundles them into `gates/`.
- Read a module's `.test.ts` before changing its contract.
