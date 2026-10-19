import * as core from '@actions/core'
import * as github from '@actions/github'
import { throttling } from '@octokit/plugin-throttling'
import * as fs from 'fs/promises'
import * as path from 'path'
import fm from 'front-matter'
import nunjucks from 'nunjucks'
// @ts-ignore
import dateFilter from 'nunjucks-date-filter'
import { FrontMatterAttributes, listToArray, setOutputs } from './helpers'
import { addIssueToProjects, resolveProject } from './projects'
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
  return new Error(`An error occurred while ${action} the issue or adding it to a project. Check the title, labels, and assignees in ${template}, and the token's project permissions if a project is configured.\n\n${message}`, { cause })
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

  const updateExistingInput = core.getInput('update_existing')
  let updateExisting: Boolean | null = null
  if (updateExistingInput) {
    if (updateExistingInput === 'true') {
      updateExisting = true
    } else if (updateExistingInput === 'false') {
      updateExisting = false
    } else {
      throw new Error(`Invalid value update_existing=${updateExistingInput}, must be one of true or false`)
    }
  }

  const reopenExistingInput = core.getInput('reopen_existing') || 'false'
  if (!['true', 'false'].includes(reopenExistingInput)) {
    throw new Error(`Invalid value reopen_existing=${reopenExistingInput}, must be one of true or false`)
  }
  const reopenExisting = reopenExistingInput === 'true'

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
  const { attributes, body } = fm<FrontMatterAttributes>(file)
  core.info(`Front matter for ${template} is ${JSON.stringify(attributes)}`)
  const projectUrls = attributes.projects === undefined
    ? []
    : Array.isArray(attributes.projects) ? attributes.projects : [attributes.projects]
  if (projectUrls.some(url => typeof url !== 'string')) {
    throw new Error(`The projects field in ${template} must be a Projects v2 URL or a list of URLs.`)
  }

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
  const projects = await Promise.all(projectUrls.map(url =>
    resolveProject(octokit, env.renderString(url, templateVariables))
  ))

  if (updateExisting !== null) {
    const existingIssue = await findExistingIssue(octokit, repository, templated.title, searchExistingType)
    if (existingIssue) {
      if (updateExisting === false) {
        await addIssueToProjects(octokit, projects, existingIssue)
        setOutputs(existingIssue, 'found')
        core.info(`Existing issue ${existingIssue.title}#${existingIssue.number}: ${existingIssue.html_url} found but not updated`)
        return
      } else {
        try {
          core.info(`Updating existing issue ${existingIssue.title}#${existingIssue.number}: ${existingIssue.html_url}`)
          await octokit.rest.issues.update({
            ...repository,
            issue_number: existingIssue.number,
            body: templated.body,
            ...(reopenExisting && existingIssue.state === 'closed' ? { state: 'open' as const } : {})
          })
          await addIssueToProjects(octokit, projects, existingIssue)
          setOutputs(existingIssue, 'updated')
          core.info(`Updated issue ${existingIssue.title}#${existingIssue.number}: ${existingIssue.html_url}`)
          return
        } catch (err) {
          throw issueError(template, 'updating', err)
        }
      }
    } else {
      core.info('No existing issue found to update')
    }
  }

  // Create the new issue
  core.info(`Creating new issue ${templated.title}`)
  try {
    const issue = await octokit.rest.issues.create({
      ...repository,
      ...templated,
      milestone: Number(core.getInput('milestone') || attributes.milestone) || undefined
    })

    await addIssueToProjects(octokit, projects, issue.data)
    setOutputs(issue.data, 'created')
    core.info(`Created issue ${issue.data.title}#${issue.data.number}: ${issue.data.html_url}`)
  } catch (err) {
    throw issueError(template, 'creating', err)
  }
}
