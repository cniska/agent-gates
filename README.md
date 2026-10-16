# agent-gates

Gate your agents' work and save them round trips. A coding agent excuses a workaround in a comment, writes a commit message nobody can scan, or commits unformatted code, and a reviewer reading the diff tends to accept it. agent-gates installs git hooks that refuse such a commit locally, for every contributor, and GitHub workflows that refuse a bad subject or an added comment again in CI. It judges the commit only, and leaves how an agent works, and what it records, to other tools.

- `agent-gates install` writes the gates into the project, which commits them, so contributors and CI are gated without installing agent-gates.
- `agent-gates doctor` judges their health.
- An optional Claude Code plugin formats each edit, shows the agent the comments the edit added and stops it skipping the gates; the gates hold without it.

## Install

Install the `agent-gates` command for macOS on Apple silicon or Linux on x64 with one of these lines:

```bash
curl -fsSL https://github.com/cniska/agent-gates/releases/latest/download/install.sh | sh
brew install cniska/tap/agent-gates
npm install -g @cniska/agent-gates
bun add -g @cniska/agent-gates
```

The curl line installs `~/.local/bin/agent-gates` and, when that directory is not on your `PATH`, adds it to `~/.zshrc` for zsh or to an existing `~/.bashrc` or `~/.bash_profile` for bash, and otherwise asks you to add it. Each channel updates the way it installed: `brew upgrade agent-gates`, `npm update -g @cniska/agent-gates`, `bun update -g @cniska/agent-gates`, or the curl line run again.

### From a clone

To run agent-gates from source instead, clone it. It runs on [Bun](https://bun.sh), which [mise](https://mise.jdx.dev) installs:

```bash
git clone https://github.com/cniska/agent-gates.git
cd agent-gates
mise trust && mise install
```

In the clone, `mise install` links `agent-gates` into `~/.bun/bin`; put that directory on your `PATH`.

### Gate a project

In the project you want to gate, install each gate on its own line:

```bash
agent-gates install commit-subject
agent-gates install no-comments
agent-gates install format --command "npm run lint:fix"
agent-gates doctor
```

Each `install` takes one gate and also updates every gate already installed. `no-comments` installs the gate for each language the project's tracked files hold. `format` needs the project's own format command.

Then, once per machine, install the Claude Code plugin:

```bash
claude plugin marketplace add cniska/agent-skills
claude plugin install cniska-gates@cniska
```

The plugin acts only in a checkout with the gates installed.

## Gates

| Gate | Refuses |
| --- | --- |
| `commit-subject` | A subject that is not a Conventional Commit of an allowed type, is over 50 characters or is not ASCII, and any message body; on push and in CI, a `fixup!`, `squash!` or `amend!` commit |
| `format` | A commit the project's format command fails on, and a partly staged file the command changes, formatting the rest into the commit |
| `no-comments-javascript` | An added comment in JavaScript or TypeScript, and a file Babel cannot parse |
| `no-comments-dart` | An added comment in Dart, and a file that does not parse |
| `no-comments-sql` | An added comment in PostgreSQL, and a file that does not parse |
| `no-comments-shell` | An added comment in shell, and a file that does not parse |
| `no-comments-rust` | An added comment in Rust, and a file that does not parse |
| `no-comments-python` | An added comment in Python, and a file that does not parse |

Each gate refuses on commit, and `commit-subject` and `no-comments` also on push and again in CI. `format` never runs in CI: it formats, so it runs where code is written, and the project's own check refuses unformatted code there. Each `no-comments` gate also refuses every added doc comment, suppression, formatter hint, tool setting and test expectation; only a shebang, a gate marker and the few [forms a toolchain reads](docs/no-comments.md#kept-comments) are kept.

## Claude Code plugin

The optional [plugin](docs/plugin.md) tells the agent at session start which gates the checkout installs and how each refuses, formats each edit with the `format` gate's command, shows the agent the comments the edit added, and blocks a git command that skips the gates: `git commit` or `git push` with `--no-verify`, `git commit -n`, and `core.hooksPath` set or unset to anything but `.githooks`. The block holds only for a Claude Code agent with the plugin installed.

## Docs

- [Gates](docs/gates.md): the files install writes, how the hooks run, and the commit-subject and format gates in detail.
- [No comments](docs/no-comments.md): what the no-comments gates judge, the refusal, the comments each language keeps and how each is read.
- [Commands](docs/commands.md): `install` and `doctor`, their output, and the states of a gate file.
- [Claude Code plugin](docs/plugin.md): what the plugin does and how to install it.
- [Development](docs/development.md): setup, checks, layout and adding a language, for working on this repo.
- [Releasing](docs/releasing.md): the release workflow, the owner's one-time setup and each release's steps.
