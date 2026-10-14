# src/

Flat, so a module is found by name. A file's prefix is its module: `gates-contract.ts` belongs to `gates`, `no-comments-scan.ts` to `no-comments`. A module that is one file carries its bare name (`git.ts`, `assert.ts`). A test sits beside its module as `<module>.test.ts`, or `<module>-<concern>.test.ts`; a test of a gate's installed hook or workflow is named for that file (`commit-msg-hook.test.ts`). A `.test-support.ts` file holds helpers only tests import.

A module's files are named for their layer:

| File | Holds |
| --- | --- |
| `<module>.ts` | The module's operations, where it has more than a contract |
| `<module>-contract.ts` | Its types and constants, what other modules import |
| `<name>-command.ts` | The one `agent-gates` command `<name>`: parse the arguments, call the operations, return the result |
| `<module>-<concern>.ts` | One concern of the module, named for it (`no-comments-scan.ts`, `cli-output.ts`) |

Another module, or a test of one, reaches a module only through its public files; any other file of it, such as `no-comments-spans.ts`, is its own ([`modules.test.ts`](modules.test.ts), which lists each module's public files).

## Modules

| Prefix | Responsibility | Public files |
| --- | --- | --- |
| `cli` | Dispatch a command and print its result or error as JSON | `cli-contract`, `cli-args` |
| `install` | The `install` command | `install-command` |
| `doctor` | Report the installed gates' health: their files, the hooks path, `prepare`, and the comments tracked files already hold | `doctor`, `doctor-command` |
| `gates` | The registry of gate files, and installing them into a project | `gates`, `gates-contract` |
| `gate` | Gate names and parts, the marker an installed file carries, and bundling the `no-comments` scanner into `gates/` | `gate-parts`, `gate-marker`, `gate-bundles` |
| `no-comments` | The scanner a `no-comments` gate runs: route a file to its language, read its comments, judge a change and report findings | `no-comments-languages`, `no-comments-scan`, `no-comments-report`, `no-comments-installed`, `no-comments-tracked` |
| `package-manifest` | The `prepare` script in a project's `package.json` | `package-manifest` |
| `git` | Run git and read its output | `git` |
| `file-backup` | Copy a file aside before install replaces it | `file-backup` |
| `coded-error`, `assert` | Errors with a code and kind; `unreachable` and `invariant` | `coded-error`, `assert` |

## Where to start

- `cli-commands.ts` lists the commands; `cli-contract.ts` is what one is.
- `gates-contract.ts` lists every gate's files, their versions and hashes; `gates.ts` installs them.
- `no-comments-main.ts` is the scanner's entry, and `no-comments-<language>.ts` each language's adapter; `gate-bundles.ts` bundles them into `gates/no-comments/`.
- Read a module's `.test.ts` before changing its contract.
