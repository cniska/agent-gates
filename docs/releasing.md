# Releasing

A `v*` tag on `main` runs `.github/workflows/release.yml`. It compiles darwin-arm64 and linux-x64 with `scripts/build-compiled.sh`, smoke-tests each build by printing its version, installing `commit-subject` into a scratch repository and running `doctor` there, attaches each build's tarball and sha256, `install.sh` and `SHA256SUMS.txt` to a GitHub release, publishes the three npm packages with provenance, and dispatches `cniska/homebrew-tap` to repin `Formula/agent-gates.rb`. Run by `workflow_dispatch` instead, it builds, smoke-tests and packs everything and publishes nothing: the release files and `npm pack --dry-run` are its output.

A release never updates itself. Each channel updates the way it installed: `brew upgrade agent-gates`, `npm update -g @cniska/agent-gates`, or the curl line run again.

## The owner's setup, once

Step 4 comes before the first tag. Steps 1 to 3 need the first release's files, so they come in the first release's step 1.

1. Publish each npm package once by hand, so trusted publishing can be set on it: `@cniska/agent-gates-darwin-arm64`, `@cniska/agent-gates-linux-x64`, then `@cniska/agent-gates`. Build them from the first release's files with `bun scripts/build-npm.ts <release files> dist/npm`, then `npm publish ./dist/npm/<package> --access public` for each.
2. On npmjs.com, add a trusted publisher to each of the three packages: GitHub Actions, repository `cniska/agent-gates`, workflow `release.yml`. Later releases publish with no npm token.
3. In each package's settings on npmjs.com, require two-factor authentication and disallow tokens, so only the trusted publisher can publish.
4. In `cniska/agent-gates`'s Actions secrets, add `AGENT_GATES_TAP_DISPATCH_TOKEN`: a fine-grained token on `cniska/homebrew-tap` with Contents read and write, which the `homebrew` job uses to dispatch the repin.

## The first release

`package.json` already reads `0.1.0`, so the first release is a tag, not `scripts/release.sh`.

1. `git tag -m v0.1.0 v0.1.0 && git push origin v0.1.0`, and watch the workflow. The npm job fails on a package not yet set up for trusted publishing: do setup steps 1 to 3 from the release's files, then re-run the job.
2. In `cniska/homebrew-tap`, on the `agent-gates-formula` branch, which adds `Formula/agent-gates.rb` and its README section, repin the formula to the release before merging, so `main` never pins checksums of a build no release holds: download the release's `SHA256SUMS.txt`, run `python3 scripts/bump-formula.py Formula/agent-gates.rb cniska/agent-gates SHA256SUMS.txt v0.1.0`, commit, then merge. `brew install cniska/tap/agent-gates` installs it. From the next release on, the `homebrew` job's dispatch repins it.
3. Land the channel lines in `README.md`'s Install section, above the clone steps, and say there that each channel updates itself as above:

   ```bash
   curl -fsSL https://github.com/cniska/agent-gates/releases/latest/download/install.sh | sh
   brew install cniska/tap/agent-gates
   npm install -g @cniska/agent-gates
   ```

## Each later release

1. On a clean `main`, run `scripts/release.sh patch|minor|major`. It bumps `package.json`, refuses a version the release check rejects, runs `bun run check`, commits `chore: release vX.Y.Z` and tags it.
2. Push `main`, then the tag, as it prints.
3. The release body is GitHub's generated notes.

The release check, `scripts/release-check.ts`, runs on every tag in the workflow too: the tag must be `v` and the `package.json` version, and newer than the previous tag.

## A bad release

Publish the fix as a new, higher version; a tag is never moved. A machine that installed the bad release takes the fix through its channel's update.
