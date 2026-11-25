# Agent Guidance

## Project

This is a TypeScript ESM GitHub Action running on Node.js 24. See `CONTRIBUTING.md` for setup, development commands, and the contribution workflow.

## Layout

- `src/index.ts`: action entry point and failure reporting.
- `src/action.ts`: workflow inputs, template rendering, and issue orchestration.
- `src/issues.ts`: exact-title duplicate searches and completeness safeguards.
- `src/attachments.ts`: workspace file matching and workflow artifact uploads for the `attachments` input.
- `src/helpers.ts`: front matter validation, input parsing, and outputs.
- `tests/`: Jest tests and template fixtures. `tests/action-setup.ts` shares mocked action setup; search and rate-limit suites exercise the real Octokit client with mocked HTTP transport.
- `action.yml`: public action metadata and inputs.

## Changes

Keep changes focused and preserve existing defaults. Update `README.md` and `action.yml` when their documented behavior or inputs change.

Preserve the distinction between omitted `update_existing` and explicit `false`. Keep exact-title search safeguards and publish outputs only after issue operations succeed. Labels and assignees support comma-separated strings.

Propagate operation errors to the entry point, retaining useful context and original API error details. Validate front matter before API requests and artifact uploads. Follow the existing TypeScript style and avoid weakening types with `any` or unchecked casts.

Keep TypeScript below 7 when updating dependencies, because ts-jest does not support TypeScript 7 yet. Keep `@types/node` on the major version of the action runtime (`runs.using` in `action.yml`, currently Node 24), so code cannot use APIs the runtime lacks.

Add focused regression tests for behavior changes. Unit tests must not contact GitHub or upload workspace files; mock API calls or the HTTP transport. Keep real-Octokit coverage for pagination and retries. The explicitly live CI job in `.github/workflows/test.yml` is the exception: it builds this checkout and exercises disposable issues using `tests/integration/`. Its helper tests run offline with `node --test tests/integration/workflow.test.mjs`.

Releases use [npm-package-release](https://github.com/dblock/npm-package-release), configured in `npr.config.js` and dispatched with `.github/workflows/release.yml`; see `RELEASING.md`. Its `GitHubAction` project adds every file in `dist/`, including `ncc` chunks such as the dynamically imported `apache-arrow` code from `@azure/storage-blob`, to a build commit tagged `vX.Y.Z` that is never on `main`. Keep `dist/` ignored, keep the `npm-package-release` development dependency and the reusable workflow tag in `release.yml` on the same version, and keep `npm test` and `npm run lint` offline, since release validation runs them. Unit tests mock `@actions/artifact`; suites that mock `@actions/core` themselves must also mock it.

## Validation

Follow the validation commands in `CONTRIBUTING.md`, including `npm run lint`, before committing code changes. Use Title Case for Markdown headings and workflow, job, and step display names, and add reviewed vocabulary to `.spellcheck.txt`. Run targeted tests when sufficient and build production-code or dependency changes.

## Documentation and Pull Requests

Keep Markdown prose unwrapped. Add a changelog entry under the current `(Next)` heading, preserving `Your contribution here.` and existing entries. Include a linked issue or PR number; once a PR is opened, add its number to the entry.

Use focused commits and retain separate commits when requested. Rebase onto `main` and use `--force-with-lease` when updating a published feature branch; never force-push `main`. Do not publish a release or create tags unless requested; see `RELEASING.md` for release steps.
