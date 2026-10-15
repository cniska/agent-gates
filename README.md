# agent-gates

Gate your agents' work and save them round trips. A coding agent excuses a workaround in a comment, writes a commit message nobody can scan, or commits unformatted code, and a reviewer reading the diff tends to accept it. agent-gates installs git hooks that refuse such a commit locally and GitHub workflows that refuse it again in CI, for every contributor. It judges the commit only, and leaves how an agent works, and what it records, to other tools.

- `agent-gates install` writes the gates into the project, which commits them, so contributors and CI are gated without installing agent-gates.
- `agent-gates doctor` judges their health.
- An optional Claude Code plugin shows the agent the comments each edit added and stops it skipping the gates; the gates hold without it.

## Install

agent-gates runs on [Bun](https://bun.sh), which [mise](https://mise.jdx.dev) installs:

```bash
git clone https://github.com/cniska/agent-gates.git
cd agent-gates
mise trust && mise install
```

In the clone, `mise install` links `agent-gates` into `~/.bun/bin`; put that directory on your `PATH`. Then, in the project you want to gate:

```bash
agent-gates install commit-subject no-comments
agent-gates doctor
```

`no-comments` installs the gate for each language the project's tracked files hold. `format` needs the project's format command, such as `agent-gates install format --command "npm run lint:fix"`.

## Gates

| Gate | Refuses |
| --- | --- |
| `commit-subject` | A subject that is not a Conventional Commit of an allowed type, is over 50 characters or is not ASCII, and any message body; on push and in CI, a `fixup!`, `squash!` or `amend!` commit |
| `format` | A commit the project's format command fails on, and a partly staged file the command changes, formatting the rest into the commit; in CI, each tracked file the command would change |
| `no-comments-javascript` | An added comment in JavaScript or TypeScript, and a file Babel cannot parse |
| `no-comments-dart` | An added comment in Dart, and a file that does not parse |
| `no-comments-sql` | An added comment in PostgreSQL, and a file that does not parse |
| `no-comments-shell` | An added comment in shell, and a file that does not parse |
| `no-comments-rust` | An added comment in Rust, and a file that does not parse |
| `no-comments-python` | An added comment in Python, and a file that does not parse |

Each gate refuses on commit and again in CI, and `commit-subject` and `no-comments` also on push. Each `no-comments` gate also refuses every added doc comment, suppression, formatter hint, tool setting and test expectation; only a shebang, a gate marker and the few [forms a toolchain reads](docs/no-comments.md#kept-comments) are kept.

## Claude Code plugin

The optional [plugin](docs/plugin.md) blocks a git command that skips the gates: `git commit` or `git push` with `--no-verify`, `git commit -n`, and `core.hooksPath` set or unset to anything but `.githooks`. The block holds only for a Claude Code agent with the plugin installed.

## Docs

- [Gates](docs/gates.md): the files install writes, how the hooks run, and the commit-subject and format gates in detail.
- [No comments](docs/no-comments.md): what the no-comments gates judge, the refusal, the comments each language keeps and how each is read.
- [Commands](docs/commands.md): `install` and `doctor`, their output, and the states of a gate file.
- [Claude Code plugin](docs/plugin.md): what the plugin does and how to install it.
- [Development](docs/development.md): setup, checks, layout and adding a language, for working on this repo.
- [Releasing](docs/releasing.md): the release workflow, the owner's one-time setup and each release's steps.
