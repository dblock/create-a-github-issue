# Contributing to Create a GitHub Issue

Contributions, [bug reports](https://github.com/dblock/create-a-github-issue/issues), and [pull requests](https://github.com/dblock/create-a-github-issue/pulls) are welcome.

## Getting started

Fork [dblock/create-a-github-issue](https://github.com/dblock/create-a-github-issue), then clone your fork. Substitute your GitHub username for `contributor`:

```sh
git clone https://github.com/contributor/create-a-github-issue.git
cd create-a-github-issue
git remote add upstream https://github.com/dblock/create-a-github-issue.git
git switch main
git pull --ff-only upstream main
git switch -c my-feature-branch
```

Use Node.js 24 and npm:

```sh
npm ci
```

## Development

This is a TypeScript ESM GitHub Action. Production code lives in `src/`, Jest tests and template fixtures in `tests/`, and public action metadata in `action.yml`. Follow the existing code style, preserve defaults, and keep changes focused.

Add focused regression tests for behavior changes. Unit tests must not contact GitHub; mock API calls or HTTP transport. The search and rate-limit suites exercise the real Octokit client against mocked HTTP responses.

Before committing code changes, type-check, run the relevant tests, and build production-code or dependency changes:

```sh
npx tsc --noEmit
npm test -- --runInBand
npm run build
```

For a targeted test run, append test paths, for example:

```sh
npm test -- --runInBand tests/existing-issues.test.ts
```

Keep `package-lock.json` synchronized with dependency changes. Do not commit generated `dist/`, coverage output, or `node_modules/`. Documentation-only changes do not require tests.

CI runs the offline suite on pull requests and pushes to `main`; check the [Node CI workflow](.github/workflows/ci.yml) for the current configuration.

### Live integration tests

The live integration workflow introduced in [#210](https://github.com/dblock/create-a-github-issue/pull/210) builds the checked-out action and runs it with `uses: ./` after offline checks pass. It exercises create-on-no-match, find-without-update, open/closed/all searches, closed updates without reopening, reopening, and unconditional creation. It verifies number/URL/status outputs, special-character titles, list/scalar metadata, assignee/milestone input precedence, labels, dates, filters, literal template delimiters, and generated nested workspace includes. Expected-failure steps cover invalid front matter, invalid workflow inputs, and missing includes. Search indexing is polled for up to approximately 150 seconds before open/closed matching.

The live job uses job-scoped `contents: read` and `issues: write` permissions with the workflow token. It runs on `main` pushes, same-repository PRs other than Dependabot runs, and manual `workflow_dispatch` runs. Fork and Dependabot PRs receive offline checks only, with live coverage after merging. It does not use `pull_request_target` or personal tokens.

Cleanup runs even after setup failures, closes matching test issues, retains the `action-integration` label, and deletes run-specific labels and milestones. It discovers resources through action outputs and unique run ID/attempt names and body markers without relying on search indexing. Closed issues remain searchable by `label:action-integration` as an audit trail and link to their workflow run. Forced runner termination or GitHub outages may prevent cleanup; clean up that run's resources manually if needed.

Organization issue types are excluded because this repository is user-owned. Cross-repository writes require separate credentials and remain offline-tested; the explicit `repo` input is exercised against the workflow repository. Search pagination/incomplete results and rate-limit retries remain offline-tested rather than manufacturing large issue sets or exhausting API limits.

Run the integration helper tests offline with:

```sh
node --test tests/integration/workflow.test.mjs
```

Do not run live helper commands locally unless you intend to modify real issues.

## Documentation and changelog

Document user-facing behavior in [README.md](README.md), and update `action.yml` when changing public inputs or outputs. Keep Markdown prose unwrapped.

Add an entry under the current `(Next)` heading in [CHANGELOG.md](CHANGELOG.md). Preserve existing entries and `Your contribution here.` Include a linked issue or PR number and contributor attribution. Once the PR is open, add its number:

```markdown
* [#123](https://github.com/dblock/create-a-github-issue/pull/123): Describe the change - [@contributor](https://github.com/contributor).
```

## Pull requests

Use focused commits describing what changed and why, then push your topic branch:

```sh
git add <changed-files>
git commit
git push -u origin my-feature-branch
```

Open a pull request against `dblock/create-a-github-issue`'s `main` branch. Describe the behavior change and validation performed, and link related issues. Review the GitHub Actions checks and address failures.

If your branch needs updating, rebase onto the latest upstream `main`:

```sh
git fetch upstream
git rebase upstream/main
git push --force-with-lease origin my-feature-branch
```

Never force-push `main`. Retain separate commits when requested by the maintainer. See [RELEASING.md](RELEASING.md) for release instructions; do not create releases or tags as part of an ordinary contribution.
