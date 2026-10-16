# Releasing

A `v*` tag on `main` runs `.github/workflows/release.yml`. It compiles darwin-arm64 and linux-x64 with `scripts/build-compiled.sh`, smoke-tests each build with `scripts/smoke.sh` (it prints its version, installs `commit-subject` into a scratch repository and passes `doctor` there), attaches each build's tarball and sha256, `install.sh` and `SHA256SUMS.txt` to a GitHub release, publishes the three npm packages with provenance, and dispatches `cniska/homebrew-tap` to repin `Formula/agent-gates.rb`. Once the registry serves all three published packages, a job on each platform installs the version with `npm install -g` and with `bun add -g`, and runs `scripts/smoke.sh` on each install's launcher with no `node` or `bun` on `PATH`; either install failing fails the run, and a patch release carries the fix. Run by `workflow_dispatch` instead, it builds, smoke-tests and packs everything and publishes nothing: the release files and `npm pack --dry-run` are its output.

A release never updates itself. Each channel updates the way it installed, as the [README](../README.md#install) says.

## The owner's setup, once

Each step is done once for each package and for the token, and each is done. Releases go through [Each later release](#each-later-release), and the `homebrew` job's dispatch repins the formula.

1. Publish each npm package once by hand, so trusted publishing can be set on it: `@cniska/agent-gates-darwin-arm64`, `@cniska/agent-gates-linux-x64`, then `@cniska/agent-gates`. Build them from a release's files with `bun scripts/build-npm.ts <release files> dist/npm`, then `npm publish ./dist/npm/<package> --access public` for each.
2. On npmjs.com, add a trusted publisher to each of the three packages: GitHub Actions, repository `cniska/agent-gates`, workflow `release.yml`. Later releases publish with no npm token.
3. In each package's settings on npmjs.com, require two-factor authentication and disallow tokens, so only the trusted publisher can publish.
4. In `cniska/agent-gates`'s Actions secrets, add `AGENT_GATES_TAP_DISPATCH_TOKEN`: a fine-grained token on `cniska/homebrew-tap` with Contents read and write, which the `homebrew` job uses to dispatch the repin.

## Each later release

1. On a clean `main`, run `scripts/release.sh patch|minor|major`. It bumps `package.json`, refuses a version the release check rejects, runs `bun run check`, commits `chore: release vX.Y.Z` and tags it.
2. Push `main`, then the tag, as it prints.
3. The release body is GitHub's generated notes.

The release check, `scripts/release-check.ts`, runs on every tag in the workflow too: the tag must be `v` and the `package.json` version, and newer than the previous tag.

## A bad release

A tag whose build failed published nothing, since every publish job waits on the builds, so delete it on origin and locally, then, once the fix is on `main`, tag `main` again with the same version (`git tag -m vX.Y.Z vX.Y.Z`) and push that tag. Once a tag has published anything, publish the fix as a new, higher version; a tag is never moved. A machine that installed the bad release takes the fix through its channel's update.
