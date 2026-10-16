# No Secrets

What the `no-secrets` gate judges, the rules it matches, what a refusal holds and how a reviewed false positive is allowed.

A coding agent that pastes a key into a config file, a test or a script leaks it with the first push, and rotating it costs more than refusing the commit. The gate refuses a commit, a push and, in CI, a pull request whose change adds a secret; it needs `node` on `PATH` and nothing installed in the project.

## What is judged

- **On commit:** the staged change against `HEAD`; a merge commit is not judged.
- **In CI and before a push:** a pull request against the point it left its base branch; a push against the branch's previous tip, or against the default branch when the push creates the branch, through `.githooks/judge-push` as [Gates](gates.md#how-the-hooks-run) says.
- **Every text file:** `linguist-generated` and `linguist-vendored` exempt nothing, since a generated file leaks a key as well as a written one. Binary files, symlinks, the gate's own files under `.githooks/no-secrets/` and `.no-secrets-allow` are skipped.
- **Added** means no rule found the same value in the changed files before the change, so a secret moved between files, reindented or renamed with its file is not added, and a new value is.

## The rules

- **gitleaks' rules.** The scanner carries the rule set of [gitleaks](https://github.com/gitleaks/gitleaks) at the tag its notice names, translated for Node's `RegExp`, and matches as gitleaks does: a rule runs only on a file holding one of its keywords, the secret is the rule's secret group, a finding below the rule's entropy bound or matching an allowlist is dropped, and a generic finding yields to a specific rule's. A rule Node cannot compile, one that matches a path alone, or one that backtracks past a bound on a long line is dropped; `src/no-secrets.test.ts` names each.
- **Assignments.** One rule of this gate's own refuses a literal value assigned to a name ending in `_TOKEN` or `_SECRET`, in a `.env` line, a shell export or a code assignment. A variable reference (`$FOO`, `${FOO}`, `${{ secrets.FOO }}`), an empty value and a placeholder (`<your token>`, `...`, `xxxx`, `changeme`) pass.
- **The notice.** The installed scanner carries gitleaks' MIT license notice after its marker; `vendor/gitleaks/` holds the rule set and license the build reads, and [Development](development.md#refreshing-the-secret-rules) says how the tag is moved.

## The refusal

- It starts with the count and the fix, then lists findings by file and line, each as its rule, the secret's first four characters and `allow:` with the finding's fingerprint. The value never appears in full.
- It stops at 4,000 bytes.
- In CI, it also annotates each finding, or the first nine and a count of the rest when there are more than ten. The step's log holds the full reply.

## Allowing a reviewed false positive

A finding that is no secret, such as a public sample key or a hash a rule mistakes for a token, is allowed by its fingerprint: the `allow:` value the refusal printed, `<rule>:<path>:<16 hex digits of the secret's SHA-256>`, on a line of its own in `.no-secrets-allow` at the checkout's root. The gate reads the file as the judged side holds it: staged on commit, committed on push and in CI, so an allow line goes into the same commit as the finding it allows, where a reviewer sees both. A fingerprint names one value in one file; the same value in another file is refused again. A line that is not a fingerprint refuses the commit.

`node .githooks/no-secrets/scan.cjs --all` lists every secret the tracked files hold that the allow file does not name, for a project adopting the gate with secrets already committed: each is rotated and removed, or allowed. `agent-gates doctor` warns with their count while any remains.
