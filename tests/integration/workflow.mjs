import assert from 'node:assert/strict'
import { appendFile, readFile, writeFile } from 'node:fs/promises'
import { setTimeout } from 'node:timers/promises'
import { pathToFileURL } from 'node:url'
import { getOctokit } from '@actions/github'

export function identity(key) {
  assert.match(key, /^\d+-\d+$/, 'Expected a run ID and attempt')
  return {
    title: `Action integration ${key}: "quoted" \\ report`,
    marker: `<!-- action-integration:${key} -->`
  }
}

export async function waitForSearch(octokit, repository, key, number, sleep = setTimeout, state = 'open') {
  const { title } = identity(key)
  for (let attempt = 0; attempt < 30; attempt++) {
    const { data } = await octokit.rest.search.issuesAndPullRequests({
      q: `is:issue is:${state} repo:${repository.owner}/${repository.repo} in:title ${JSON.stringify(title)}`,
      per_page: 100
    })
    if (data.incomplete_results === false && data.items.some(issue => issue.number === number && issue.title === title)) return
    if (attempt < 29) await sleep(5000)
  }
  throw new Error(`Issue #${number} was not indexed within the search polling deadline`)
}

export async function cleanup(octokit, repository, key, knownNumbers = []) {
  const { title, marker } = identity(key)
  // Listing issues avoids relying on the search index if creation failed before setting outputs.
  const issues = await octokit.paginate(octokit.rest.issues.listForRepo, {
    ...repository, state: 'open', per_page: 100
  })
  for (const number of new Set(knownNumbers.filter(Boolean))) {
    assert.match(number, /^[1-9]\d*$/)
    const { data } = await octokit.rest.issues.get({ ...repository, issue_number: Number(number) })
    if (!issues.some(issue => issue.number === data.number)) issues.push(data)
  }
  for (const issue of issues) {
    if (issue.pull_request || issue.title !== title || !issue.body?.includes(marker)) continue
    await octokit.rest.issues.update({ ...repository, issue_number: issue.number, state: 'closed' })
    const { data } = await octokit.rest.issues.get({ ...repository, issue_number: issue.number })
    assert.equal(data.state, 'closed', `Cleanup did not close issue #${issue.number}`)
    await octokit.rest.issues.addLabels({ ...repository, issue_number: issue.number, labels: ['action-integration'] })
    console.log(`Closed integration issue #${issue.number}`)
  }
  // Discover resources by unique names even if setup failed before publishing their IDs.
  const milestones = await octokit.paginate(octokit.rest.issues.listMilestones, {
    ...repository, state: 'all', per_page: 100
  })
  for (const milestone of milestones) {
    if (milestone.title === `action-integration-${key}`) {
      await octokit.rest.issues.deleteMilestone({ ...repository, milestone_number: milestone.number })
    }
  }
  const labels = await octokit.paginate(octokit.rest.issues.listLabelsForRepo, { ...repository, per_page: 100 })
  for (const label of labels) {
    if ([`action-integration-${key}`, `action-integration-${key}-second`].includes(label.name)) {
      await octokit.rest.issues.deleteLabel({ ...repository, name: label.name })
    }
  }
}

export function verify(issue, env) {
  const { title, marker } = identity(env.INTEGRATION_KEY)
  assert.match(env.ISSUE_NUMBER || '', /^[1-9]\d*$/, 'Missing issue number output')
  assert.equal(String(issue.number), env.ISSUE_NUMBER)
  if (env.ORIGINAL_NUMBER !== undefined) assert.equal(env.ISSUE_NUMBER, env.ORIGINAL_NUMBER)
  assert.equal(env.ISSUE_STATUS, env.EXPECTED_STATUS)
  assert.equal(env.ISSUE_URL, issue.html_url)
  assert.equal(issue.title, title)
  assert.equal(issue.state, env.EXPECTED_STATE || 'open')
  assert.deepEqual(issue.assignees.map(assignee => assignee.login), [env.INTEGRATION_ASSIGNEE])
  assert.deepEqual(issue.labels.map(label => label.name).sort(), (
    env.EXPECTED_LABELS === 'two'
      ? ['action-integration', env.INTEGRATION_LABEL, env.INTEGRATION_SECOND_LABEL]
      : ['action-integration', env.INTEGRATION_LABEL]
  ).sort())
  assert.equal(String(issue.milestone.number), env.INTEGRATION_MILESTONE)
  assert.equal(issue.body.trimEnd(), [
    marker,
    `AI-generated integration test issue for ${env.GITHUB_REPOSITORY}, posted on behalf of @dblock.`,
    `Workflow run: [${env.GITHUB_RUN_ID}](${env.GITHUB_SERVER_URL}/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID})`,
    `Phase: ${env.EXPECTED_PHASE}`,
    `Year: ${new Date().getUTCFullYear()}`,
    `Filter: ${env.EXPECTED_PHASE.toUpperCase()}`,
    'Literal: {{ not_a_variable }}',
    '# Generated report',
    'All checks passed.',
    'Nested report details.'
  ].join('\n'))
}

async function main(command) {
  const key = process.env.INTEGRATION_KEY
  identity(key)
  const [owner, repo] = process.env.GITHUB_REPOSITORY.split('/')
  const repository = { owner, repo }
  const octokit = getOctokit(process.env.GITHUB_TOKEN)
  if (command === 'cleanup') return cleanup(octokit, repository, key, [
    process.env.CREATED_NUMBER, process.env.INPUTS_NUMBER
  ])
  if (command === 'prepare') {
    await writeFile('tests/integration/generated-report.md', '# Generated report\nAll checks passed.\n{% include "./generated-details.md" %}')
    await writeFile('tests/integration/generated-details.md', 'Nested report details.\n')
    const { data: assignees } = await octokit.rest.issues.listAssignees({ ...repository, per_page: 100 })
    assert.ok(assignees[0], 'Repository must have at least one assignable user')
    const label = `action-integration-${key}`
    try {
      await octokit.rest.issues.getLabel({ ...repository, name: 'action-integration' })
    } catch (error) {
      if (error.status !== 404) throw error
      await octokit.rest.issues.createLabel({ ...repository, name: 'action-integration', color: 'ededed' })
    }
    await octokit.rest.issues.createLabel({ ...repository, name: label, color: 'ededed' })
    await octokit.rest.issues.createLabel({ ...repository, name: `${label}-second`, color: 'ededed' })
    const { data: milestone } = await octokit.rest.issues.createMilestone({ ...repository, title: label })
    // Milestone numbers are not templated by the action; write the actual number into the fixture.
    const template = await readFile('tests/integration/issue.md', 'utf8')
    await writeFile('tests/integration/generated-issue.md', template.replace('milestone: 0', `milestone: ${milestone.number}`))
    await appendFile(process.env.GITHUB_ENV, [
      `INTEGRATION_ASSIGNEE=${assignees[0].login}`,
      `INTEGRATION_LABEL=${label}`,
      `INTEGRATION_SECOND_LABEL=${label}-second`,
      `INTEGRATION_MILESTONE=${milestone.number}`,
      ''
    ].join('\n'))
    return
  }
  if (command === 'audit') {
    const { title, marker } = identity(key)
    for (let attempt = 0; attempt < 30; attempt++) {
      const issues = await octokit.paginate(octokit.rest.issues.listForRepo, { ...repository, state: 'all', per_page: 100 })
      const matches = issues.filter(issue => !issue.pull_request && issue.title === title && issue.body?.includes(marker))
      if (matches.length === 2) return
      assert.ok(matches.length < 2, 'A matching or failure step created an extra issue')
      if (attempt < 29) await setTimeout(5000)
    }
    throw new Error('The issue listing did not expose both created issues before the audit deadline')
  }
  assert.match(process.env.ISSUE_NUMBER || '', /^[1-9]\d*$/, 'Missing issue number output')
  const issue_number = Number(process.env.ISSUE_NUMBER)
  if (command === 'wait') return waitForSearch(octokit, repository, key, issue_number, setTimeout, process.env.EXPECTED_STATE || 'open')
  const { data: issue } = await octokit.rest.issues.get({ ...repository, issue_number })
  const { title, marker } = identity(key)
  assert.equal(issue.title, title)
  assert.ok(issue.body?.includes(marker), 'Refusing to operate on an unrelated issue')
  if (command === 'verify') return verify(issue, process.env)
  if (command === 'close') {
    await octokit.rest.issues.update({ ...repository, issue_number, state: 'closed' })
    const { data } = await octokit.rest.issues.get({ ...repository, issue_number })
    assert.equal(data.state, 'closed')
    return
  }
  throw new Error(`Unknown integration command: ${command}`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv[2]).catch(error => {
    console.error(error)
    process.exitCode = 1
  })
}
