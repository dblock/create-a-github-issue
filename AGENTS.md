# Agent guidance

## Project

This is a TypeScript ESM GitHub Action running on Node.js 24. Use npm and keep `package-lock.json` synchronized with dependency changes. Some instructions in `CONTRIBUTING.md` refer to an unrelated Ruby project; use the commands and layout below for this repository.

## Layout

- `src/index.ts`: action entry point and failure reporting.
- `src/action.ts`: workflow inputs, template rendering, and issue orchestration.
- `src/issues.ts`: exact-title duplicate searches and completeness safeguards.
- `src/helpers.ts`: front matter validation, input parsing, and outputs.
- `tests/`: Jest tests and template fixtures. `tests/action-setup.ts` shares mocked action setup; search and rate-limit suites exercise the real Octokit client with mocked HTTP transport.
- `action.yml`: public action metadata and inputs.

## Changes

Keep changes focused and preserve existing defaults. Update `README.md` and `action.yml` when their documented behavior or inputs change.

Preserve the distinction between omitted `update_existing` and explicit `false`. Keep exact-title search safeguards and publish outputs only after issue operations succeed. Labels and assignees support comma-separated strings.

Propagate operation errors to the entry point, retaining useful context and original API error details. Validate front matter before API requests. Follow the existing TypeScript style and avoid weakening types with `any` or unchecked casts.

Add focused regression tests for behavior changes. Do not contact GitHub or upload workspace files from tests; mock API calls or the HTTP transport. Keep real-Octokit coverage for pagination and retries.

## Validation

Install dependencies with `npm ci` when needed. Before committing code changes, run the relevant tests and type-check:

```sh
npx tsc --noEmit
npm test -- --runInBand
```

For a targeted run, append test paths to the test command. Run `npm run build` for production-code or dependency changes. Do not commit generated `dist/`, coverage output, or `node_modules/`. Documentation-only edits do not require tests.

## Documentation and pull requests

Keep Markdown prose unwrapped. Add a changelog entry under the current `(Next)` heading, preserving `Your contribution here.` and existing entries. Include a linked issue or PR number; once a PR is opened, add its number to the entry.

Use focused commits and retain separate commits when requested. Rebase onto `main` and use `--force-with-lease` when updating a published feature branch; never force-push `main`. Do not publish a release or create tags unless requested; see `RELEASING.md` for release steps.
