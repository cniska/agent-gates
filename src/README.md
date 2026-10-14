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
| `cli` | Dispatch a command and print its result or error as JSON |
| `install` | The `install` command |
| `doctor` | Report the installed gates' health: their files, the hooks path, `prepare`, the format and CI setup commands, and the comments tracked files already hold |
| `gates` | The registry of gate files, the commands install writes into them, and installing them into a project |
| `gate` | Gate names and parts, the marker an installed file carries, and bundling the `no-comments` scanner into `gates/` |
| `no-comments` | The scanner a `no-comments` gate runs: route a file to its language, read its comments, judge a change and report findings |
| `package-manifest` | The `prepare` script in a project's `package.json` |
| `git` | Run git and read its output |
| `file-backup` | Copy a file aside before install replaces it |
| `coded-error`, `assert` | Errors with a code and kind; `unreachable` and `invariant` |

## Where to start

- `cli-commands.ts` lists the commands; `cli-contract.ts` is what one is.
- `gates-contract.ts` lists every gate's files, their versions and hashes; `gates.ts` installs them.
- `no-comments-main.ts` is the scanner's entry, and `no-comments-<language>.ts` each language's adapter; `gate-bundles.ts` bundles them into `gates/no-comments/`.
- Read a module's `.test.ts` before changing its contract.
