# Releasing

There're no hard rules about when to release this project. Release bug fixes frequently, features not so frequently and breaking API changes rarely.

Releases use [npm-package-release](https://github.com/dblock/npm-package-release), configured in `npr.config.js` and run by the [Release workflow](.github/workflows/release.yml). The action is not published to npm; each release is a Git tag and a GitHub Release.

## Prerequisites

These are one-time repository settings, changed only by an administrator:

- An environment named `release` under **Settings → Environments**, with deployments restricted to the `main` branch. Optionally add required reviewers.
- Rules on `main` must allow the release workflow's direct fast-forward pushes of its release and next-development commits. Keep the deletion and force-push protections, but do not require pull requests or status checks on `main`, since that blocks the pushes. This allows direct pushes by all writers, not only the workflow; ordinary development still uses pull requests.
- No tag ruleset may block creating `vX.Y.Z` tags or updating the `vX` and `vX.Y` tags, such as `v3` and `v3.5`.

## Release

Make sure the `### X.Y.Z (Next)` section in [CHANGELOG](CHANGELOG.md) has real entries and that the version in the [package manifest](package.json) is the version to release. Run tests and lint locally and check that `main` is green in CI:

```sh
npm ci
npm test
npm run lint
```

Dispatch the Release workflow from `main`:

```sh
gh workflow run release.yml --ref main
```

To release another version than the checked-in one, pass it explicitly, for example `-f version=3.6.0`. A release of `3.5.1`:

1. Runs `npm test` and `npm run lint`, dates `### 3.5.1 (Next)` as `### 3.5.1 (YYYY/MM/DD)`, removes `* Your contribution here.`, and commits `Prepare release 3.5.1` on `main`.
2. Runs `npm run build` and creates the build commit `Build release 3.5.1` on top of the release commit, containing the full release tree plus every file in the ignored `dist/` directory. Only the build commit contains `dist/`; it is never on `main`.
3. Runs the built `dist/index.js` from a zip of `action.yml` and `dist/` to check that the action loads and rejects an invalid input without a token or API requests.
4. Tags the build commit `v3.5.1` and pushes the release commit to `main` and the tag, without force.
5. Creates the `v3.5.1` GitHub Release with the release notes and the `create-a-github-issue-v3.5.1.zip` archive, and moves `v3.5` and `v3` to the build commit. Floating tags never move backwards, so a maintenance release of an older line leaves a newer `v3` in place.
6. Commits `Prepare next development iteration, 3.5.2` on `main`, with version `3.5.2` and a new `### 3.5.2 (Next)` section containing `* Your contribution here.`.

Workflows using `dblock/create-a-github-issue@v3`, `@v3.5`, or `@v3.5.1` then run `dist/index.js` from the build commit. Unlike releases before 3.5.1, whose build commit contained only `action.yml` and `dist/`, the build commit contains the full source tree plus `dist/`.

After the workflow succeeds, verify the run summary, the [GitHub Release](https://github.com/dblock/create-a-github-issue/releases), and the `v3.5.1`, `v3.5`, and `v3` tags. The release is created with the workflow token, so it does not trigger other workflows, and npm-package-release does not publish it to the GitHub Marketplace; edit the release on GitHub to publish it there if desired.

## Recovery

If a release fails, do not rerun it blindly. Download the run's retained `npm-release-*` artifacts, inspect `release.json`, the remote `main` branch and tags, and the GitHub Release, then follow [Recovery and Reconciliation](https://github.com/dblock/npm-package-release/blob/master/docs/recovery.md). A matching rerun from `main` reuses the existing release commit, build commit, tag, and GitHub Release. Never move or delete a `vX.Y.Z` release tag.
