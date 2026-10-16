# Pinned Actions

What the `pinned-actions` gate judges, which references pass, and what a refusal holds.

A workflow that pulls an action by a tag runs whatever that tag points at next, and a tag moves with one push to the action's repository, by its owner or by whoever takes the account. Pinned to a commit SHA, the workflow runs the code that was reviewed. The gate refuses a commit, a push and, in CI, a pull request that leaves a workflow or action file with an unpinned reference; it needs `node` on `PATH` and nothing installed in the project.

## What is judged

- **On commit:** the staged change against `HEAD`; a merge commit is not judged.
- **In CI and before a push:** a pull request against the point it left its base branch; a push against the branch's previous tip, or against the default branch when the push creates the branch, through `.githooks/judge-push` as [Gates](gates.md#how-the-hooks-run) says.
- **Workflow and action files:** the `.yml` and `.yaml` files directly under `.github/workflows/`, and every `action.yml` or `action.yaml`, wherever it sits. A file the change adds or modifies is judged whole, every `uses:` it holds, since an unpinned reference has no innocent move the way a comment or a secret has, and the fix is mechanical. No other file is judged: a `uses:` in a doc, or in a file under a subdirectory of `.github/workflows/`, is text.
- **Line by line:** the gate reads YAML without a YAML library. It reads a `uses:` that starts a line's content, after an optional `- `, or follows `{` or `,` in a flow mapping, with its value bare or quoted; a trailing `# v7.0.1` comment is ignored, and each `uses:` on a line is read. A comment line and the lines of a `run: |` or any other block scalar are not read.

## What passes

| Reference | Passes when |
| --- | --- |
| `owner/repo@<ref>`, `owner/repo/path@<ref>` | The ref is a full 40-hex commit SHA |
| `owner/repo/.github/workflows/<name>.yml@<ref>` (a reusable workflow) | The ref is a full 40-hex commit SHA |
| `docker://<image>` | The image ends with `@sha256:` and its 64-hex digest, with or without a tag before it |
| `./<path>`, `./` | Always: the repository's own action at the checked-out commit |
| `$/<path>` | Always: the repository's own action or workflow at the running commit |

A tag, a branch, a short SHA and an image named by tag alone are refused. The pin's version goes in a trailing comment, `owner/repo@<40 hex> # vX.Y.Z`, so a reader and a dependency updater still see it.

## The refusal

- It starts with the count and the fix, then lists each file in path order with each unpinned reference under it as its line and the reference as written.
- It stops at 4,000 bytes.
- In CI, it also annotates each finding at its file and line, or the first nine and a count of the rest when there are more than ten. The step's log holds the full reply.

`node .githooks/pinned-actions/scan.cjs --all` lists every unpinned reference the tracked workflow and action files hold, for a project adopting the gate over workflows pinned by tag. `agent-gates doctor` warns with their count while any remains.

## Design rule

The gate judges the reference alone, as the file states it: whether the pinned commit is the release the comment names, and what the pinned action itself uses, is the reviewer's and the action's own, which the [spec](../SPEC.md#4-out-of-scope) leaves out.
