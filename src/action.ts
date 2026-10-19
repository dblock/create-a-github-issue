import * as core from '@actions/core'
import * as github from '@actions/github'
import { throttling } from '@octokit/plugin-throttling'
import * as fs from 'fs/promises'
import * as path from 'path'
import fm from 'front-matter'
import nunjucks from 'nunjucks'
// @ts-ignore
import dateFilter from 'nunjucks-date-filter'
import { IssueStatus, listToArray, readBooleanInput, setOutputs, validateFrontMatter } from './helpers'
import { findExistingIssue } from './issues'

function retryRateLimit(retryAfter: number, _options: unknown, _octokit: unknown, retryCount: number) {
  if (retryCount >= 2) {
    core.warning('GitHub rate limit reached; no retries remaining.')
    return false
  }
  core.warning(`GitHub rate limit reached; retrying in ${retryAfter} seconds (${retryCount + 1}/2).`)
  return true
}

function issueError(template: string, action: 'creating' | 'updating', cause: unknown) {
  const message = cause instanceof Error ? cause.message : String(cause)
  return new Error(`An error occurred while ${action} the issue. Check the title, labels, and assignees in ${template}.\n\n${message}`, { cause })
}

export async function createAnIssue () {
  const template = core.getInput('filename') || '.github/ISSUE_TEMPLATE.md'
  const assignees = core.getInput('assignees')
  const context = github.context
  const targetRepository = core.getInput('repo') || `${context.repo.owner}/${context.repo.repo}`
  const [owner, repo, ...extra] = targetRepository.split('/')
  if (!owner || !repo || extra.length || /\s/.test(targetRepository)) {
    throw new Error(`Invalid value repo=${targetRepository}, must be in owner/repo format`)
  }
  const repository = { owner, repo }

  const searchExistingType: string = core.getInput('search_existing') || 'open'
  if (!['open', 'closed', 'all'].includes(searchExistingType)) {
    throw new Error(`Invalid value search_existing=${searchExistingType}, must be one of open, closed or all`)
  }

  const updateExisting = readBooleanInput('update_existing')
  const reopenExisting = readBooleanInput('reopen_existing') ?? false

  const workspace = process.env.GITHUB_WORKSPACE || process.cwd()
  const env = nunjucks.configure(workspace, { autoescape: false })
  env.addFilter('date', dateFilter)

  const templateVariables = {
    ...context,
    repo: context.repo,
    env: process.env,
    date: Date.now()
  }

  // Get the file
  const templatePath = path.join(workspace, template)
  core.debug(`Reading from file ${templatePath}`)
  const file = await fs.readFile(templatePath, 'utf8')

  // Grab the front matter as JSON
  const { attributes, body } = fm<unknown>(file)
  validateFrontMatter(attributes, template)
  core.info(`Front matter for ${template} is ${JSON.stringify(attributes)}`)

  const templated = {
    body: env.renderString(body, templateVariables),
    title: env.renderString(attributes.title, templateVariables),
    ...(attributes.type ? { type: env.renderString(attributes.type, templateVariables) } : {}),
    assignees: listToArray(assignees || attributes.assignees).map(assignee => env.renderString(assignee, templateVariables)),
    labels: listToArray(attributes.labels).map(label => env.renderString(label, templateVariables)),
  }
  core.debug(`Templates compiled ${JSON.stringify(templated)}`)

  const token = process.env.GITHUB_TOKEN || core.getInput('token')
  const octokit = github.getOctokit(token, {
    throttle: {
      onRateLimit: retryRateLimit,
      onSecondaryRateLimit: retryRateLimit
    }
  }, throttling)

  let issue = updateExisting === null
    ? undefined
    : await findExistingIssue(octokit, repository, templated.title, searchExistingType)
  let status: IssueStatus

  if (issue) {
    status = 'found'
    if (updateExisting) {
      core.info(`Updating existing issue ${issue.title}#${issue.number}: ${issue.html_url}`)
      try {
        await octokit.rest.issues.update({
          ...repository,
          issue_number: issue.number,
          body: templated.body,
          ...(reopenExisting && issue.state === 'closed' ? { state: 'open' as const } : {})
        })
      } catch (err) {
        throw issueError(template, 'updating', err)
      }
      status = 'updated'
    }
  } else {
    if (updateExisting !== null) core.info('No existing issue found to update')
    core.info(`Creating new issue ${templated.title}`)
    try {
      issue = (await octokit.rest.issues.create({
        ...repository,
        ...templated,
        milestone: Number(core.getInput('milestone') || attributes.milestone) || undefined
      })).data
    } catch (err) {
      throw issueError(template, 'creating', err)
    }
    status = 'created'
  }

  setOutputs(issue, status)
  const action = status === 'created' ? 'Created' : status === 'updated' ? 'Updated' : 'Existing'
  core.info(`${action} issue ${issue.title}#${issue.number}: ${issue.html_url}${status === 'found' ? ' found but not updated' : ''}`)
}
