# Commands

The `agent-gates` commands, what each prints, and the states `install` and `doctor` report for each gate file.

Each command prints one JSON line. An error goes to stderr and exits 2 for `usage`, 1 for a `refusal` you can resolve, and 3 for a `fault`.

| Command | Does |
| --- | --- |
| `agent-gates install [<gate>] [--command <format command>] [--prefixes <a,b,c>]` | Install the named gate, update the installed ones, and report each file's state before acting, the format command and the commit prefixes |
| `agent-gates --version` | Print the version alone on one line, the one output that is not JSON |
| `agent-gates doctor` | Check each gate file, `core.hooksPath`, the `prepare` script and the format command, and report the commit prefixes; report each tracked language without its no-comments gate, each installed language with no files left to read, each of the project's own steps in `.githooks/pre-commit.d` or `pre-push.d` that no workflow runs, and the comment count; exit 1 on a failure |

## Gate file states

| State | Means | `install` |
| --- | --- | --- |
| `installed` | the current version | leaves it |
| `missing` | not there | writes it |
| `behind` | an earlier version | writes it |
| `changed` | matches no version | sets it aside as `<file>.agent-gates-backup`, then writes it |
| `ahead` | written by a newer agent-gates | leaves it |
| `not-executable` | a hook git would skip | writes it |
| `reconfigured` | the current version, holding another command or list than `--command` or `--prefixes` gave | writes it |
| `occupied` | a hook without an `agent-gate` marker | refuses, writing nothing |

`install` also refuses when `core.hooksPath` or `prepare` already hold something else, when `package.json` does not parse, when no gate is named and none is installed, and, for `format`, when no command is given or installed. `commit-subject` owns `.githooks/commit-msg`.
