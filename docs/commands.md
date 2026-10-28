# Commands

The `agent-gates` commands, what each prints, and the states `install` and `doctor` report for each gate file.

Each command prints [TOON](https://toonformat.dev): the command, `ok`, then its result, or its error with `kind`, `code`, `message`, `meta` and `resolve`. `install` and `doctor` lead their result with how many files or checks are in each state, zeros included, and a list of records prints as a table. By default a list holds no `null`: `install` lists the backups it made apart from the files, and `doctor` lists only the checks that warn or fail, each with its fix; `--full` gives each file its backup and lists every check with its fix, `null` where there is none. An error goes to stderr and exits 2 for `usage`, 1 for a `refusal` you can resolve, and 3 for a `fault`.

| Command | Does |
| --- | --- |
| `agent-gates install [<gate>] [--command <format command>] [--prefixes <a,b,c>] [--full]` | Install the named gate, update the installed ones, and report each file's state before acting, the format command and the commit prefixes |
| `agent-gates --version` | Print the version alone on one line, the one output that is not TOON |
| `agent-gates doctor [--full]` | Check each gate file, `core.hooksPath`, the `prepare` script and the format command, and check the commit prefixes; report each tracked language without its no-comments gate, each installed language with no files left to read, each of the project's own steps in `.githooks/pre-commit.d` or `pre-push.d` that no workflow runs, the comment count, the count of secrets `.no-secrets-allow` does not name and the count of unpinned actions; exit 1 on a failure |

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

With a `no-comments` gate installed, `install` also reports `.no-comments-keep`: `installed` when it holds every line install writes, `missing` when install creates it, and `behind` when install appends the lines it lacks, leaving the project's own lines as they are ([kept comments](no-comments.md#kept-comments)).

`install` also refuses when `core.hooksPath` or `prepare` already hold something else, when `package.json` does not parse, when no gate is named and none is installed, when a hook records a value of another form than its flag takes, such as a hand-edited prefix list, and, for `format`, when no command is given or installed. `commit-subject` owns `.githooks/commit-msg`.

`--command` and `--prefixes` go with the gate that runs them, or, with no gate named, with that gate installed: `agent-gates install --prefixes feat,fix` rewrites the list of an installed `commit-subject`.
