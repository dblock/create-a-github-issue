import assert from 'node:assert/strict'
import { test, mock } from 'node:test'
import { cleanup, identity, verify, waitForSearch } from './workflow.mjs'

const repository = { owner: 'example', repo: 'repository' }
const key = '123-1'
const { title, marker } = identity(key)

test('waits for a complete exact search match, not a different or incomplete result', async () => {
  const responses = [
    { incomplete_results: false, items: [{ number: 42, title: `${title} other` }] },
    { incomplete_results: true, items: [{ number: 42, title }] },
    { incomplete_results: false, items: [{ number: 42, title }] }
  ]
  const search = mock.fn(async () => ({ data: responses.shift() }))
  const sleep = mock.fn(async () => {})

  await waitForSearch({ rest: { search: { issuesAndPullRequests: search } } }, repository, key, 42, sleep)

  assert.equal(search.mock.callCount(), 3)
  assert.equal(sleep.mock.callCount(), 2)
  assert.ok(search.mock.calls[0].arguments[0].q.includes('repo:example/repository'))
})

test('fails after the bounded indexing timeout', async () => {
  const search = mock.fn(async () => ({ data: { incomplete_results: false, items: [] } }))
  const sleep = mock.fn(async () => {})

  await assert.rejects(waitForSearch({ rest: { search: { issuesAndPullRequests: search } } }, repository, key, 42, sleep), /polling deadline/)
  assert.equal(search.mock.callCount(), 30)
  assert.equal(sleep.mock.callCount(), 29)
})

test('cleanup finds all matching issues without search or action outputs and leaves unrelated issues alone', async () => {
  const update = mock.fn(async () => {})
  const addLabels = mock.fn(async () => {})
  const get = mock.fn(async () => ({ data: { state: 'closed' } }))
  const paginate = mock.fn(async endpoint => endpoint !== 'list' ? [] : [
    { number: 1, title, body: marker },
    { number: 2, title, body: 'Unrelated body' },
    { number: 3, title: 'Unrelated title', body: marker },
    { number: 4, title, body: marker, pull_request: {} },
    { number: 5, title, body: marker }
  ])

  await cleanup({ paginate, rest: { issues: { listForRepo: 'list', update, get, addLabels } } }, repository, key)

  assert.deepEqual(update.mock.calls.map(call => call.arguments[0]), [
    { ...repository, issue_number: 1, state: 'closed' },
    { ...repository, issue_number: 5, state: 'closed' }
  ])
  assert.equal(get.mock.callCount(), 2)
  assert.deepEqual(addLabels.mock.calls.map(call => call.arguments[0]), [
    { ...repository, issue_number: 1, labels: ['action-integration'] },
    { ...repository, issue_number: 5, labels: ['action-integration'] }
  ])
})

test('cleanup surfaces API failures', async () => {
  const octokit = {
    paginate: async () => [{ number: 1, title, body: marker }],
    rest: { issues: { update: async () => { throw new Error('Permission denied') } } }
  }
  await assert.rejects(cleanup(octokit, repository, key), /Permission denied/)
})

test('verification detects incorrect outputs, body changes, and failed reopening', () => {
  const env = {
    INTEGRATION_KEY: key, GITHUB_REPOSITORY: 'example/repository',
    GITHUB_RUN_ID: '123', GITHUB_SERVER_URL: 'https://github.com',
    ISSUE_NUMBER: '42', ORIGINAL_NUMBER: '42', ISSUE_URL: 'https://github.com/example/repository/issues/42',
    ISSUE_STATUS: 'found', EXPECTED_STATUS: 'found', EXPECTED_PHASE: 'created',
    INTEGRATION_ASSIGNEE: 'example', INTEGRATION_LABEL: 'test', INTEGRATION_MILESTONE: '7'
  }
  const issue = {
    number: 42, title, html_url: env.ISSUE_URL, state: 'open',
    assignees: [{ login: 'example' }], labels: [{ name: 'test' }, { name: 'action-integration' }], milestone: { number: 7 },
    body: `${marker}\nAI-generated integration test issue for example/repository, posted on behalf of @dblock.\nWorkflow run: [123](https://github.com/example/repository/actions/runs/123)\nPhase: created\nYear: ${new Date().getUTCFullYear()}\nFilter: CREATED\nLiteral: {{ not_a_variable }}\n# Generated report\nAll checks passed.\nNested report details.\n`
  }
  verify(issue, env)
  for (const change of [
    { ISSUE_NUMBER: '43' }, { ISSUE_STATUS: 'created' }, { ISSUE_URL: '' }, { EXPECTED_PHASE: 'updated' }
  ]) {
    assert.throws(() => verify(issue, { ...env, ...change }))
  }
  assert.throws(() => verify({ ...issue, state: 'closed' }, env))
  assert.throws(() => verify({ ...issue, assignees: [] }, env))
  assert.throws(() => verify({ ...issue, labels: [] }, env))
  assert.throws(() => verify({ ...issue, milestone: { number: 8 } }, env))
})

test('cleanup removes only the run-specific labels and milestone after closing issues', async () => {
  const deleteMilestone = mock.fn(async () => {})
  const deleteLabel = mock.fn(async () => {})
  const resource = `action-integration-${key}`
  const octokit = {
    paginate: async endpoint => ({
      issues: [],
      milestones: [{ title: resource, number: 7 }, { title: 'Keep', number: 8 }],
      labels: [{ name: resource }, { name: `${resource}-second` }, { name: 'Keep' }]
    })[endpoint],
    rest: { issues: { listForRepo: 'issues', listMilestones: 'milestones', listLabelsForRepo: 'labels', deleteMilestone, deleteLabel } }
  }

  await cleanup(octokit, repository, key)

  assert.deepEqual(deleteMilestone.mock.calls.map(call => call.arguments[0]), [{ ...repository, milestone_number: 7 }])
  assert.deepEqual(deleteLabel.mock.calls.map(call => call.arguments[0].name), [resource, `${resource}-second`])
})
