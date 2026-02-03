import * as core from '@actions/core'
import * as github from '@actions/github'
import { promises as fs } from 'fs'
import * as path from 'path'
import fm from 'front-matter'
import nunjucks from 'nunjucks'
// @ts-ignore
import dateFilter from 'nunjucks-date-filter'
import { FrontMatterAttributes, listToArray, setOutputs } from './helpers'

function logError(template: string, action: 'creating' | 'updating', err: any) {
  // Log the error message
  const errorMessage = `An error occurred while ${action} the issue. This might be caused by a malformed issue title, or a typo in the labels or assignees. Check ${template}!`
  core.error(errorMessage)
  core.error(err)

  // The error might have more details
  if (err.errors) core.error(err.errors)

  // Exit with a failing status
  core.setFailed(errorMessage + '\n\n' + err.message)
}

export async function createAnIssue () {
  const template = core.getInput('filename') || '.github/ISSUE_TEMPLATE.md'
  const assignees = core.getInput('assignees')
  const token = core.getInput('github-token') || process.env.GITHUB_TOKEN || ''
  
  const octokit = github.getOctokit(token)
  const context = github.context

  const searchExistingType: string = core.getInput('search_existing') || 'open'
  if (!['open', 'closed', 'all'].includes(searchExistingType)) {
    core.setFailed(`Invalid value search_existing=${core.getInput('search_existing')}, must be one of open, closed or all`)
    return
  }

  let updateExisting: Boolean | null = null
  const updateExistingInput = core.getInput('update_existing')
  if (updateExistingInput) {
    if (updateExistingInput === 'true') {
      updateExisting = true
    } else if (updateExistingInput === 'false') {
      updateExisting = false
    } else {
      core.setFailed(`Invalid value update_existing=${updateExistingInput}, must be one of true or false`)
      return
    }
  }

  const env = nunjucks.configure({ autoescape: false })
  env.addFilter('date', dateFilter)

  const templateVariables = {
    ...context,
    repo: context.repo,
    env: process.env,
    date: Date.now(),
    action: process.env.GITHUB_ACTION
  }

  // Get the file - use GITHUB_WORKSPACE if available
  const workspace = process.env.GITHUB_WORKSPACE || process.cwd()
  const templatePath = path.join(workspace, template)
  core.debug('Reading from file ' + templatePath)
  const file = await fs.readFile(templatePath, 'utf-8')

  // Grab the front matter as JSON
  const { attributes, body } = fm<FrontMatterAttributes>(file)
  core.info(`Front matter for ${template} is ${JSON.stringify(attributes)}`)

  const templated = {
    body: env.renderString(body, templateVariables),
    title: env.renderString(attributes.title, templateVariables),
    labels: listToArray(attributes.labels).map(label => env.renderString(label, templateVariables)),
  }
  core.debug('Templates compiled: ' + JSON.stringify(templated))

  if (updateExisting !== null) {
    core.info(`Fetching ${searchExistingType} issues with title "${templated.title}"`)
    const searchExistingQuery = (searchExistingType === 'all') ? '' : `is:${searchExistingType} `
    const existingIssues = await octokit.rest.search.issuesAndPullRequests({
      q: `${searchExistingQuery}is:issue repo:${process.env.GITHUB_REPOSITORY} in:title ${templated.title}`
    })
    const existingIssue = existingIssues.data.items.find((issue: any) => issue.title === templated.title)
    if (existingIssue) {
      if (updateExisting === false) {
        setOutputs(existingIssue, 'found')
        core.info(`Existing issue ${existingIssue.title}#${existingIssue.number}: ${existingIssue.html_url} found but not updated`)
        return
      } else {
        try {
          core.info(`Updating existing issue ${existingIssue.title}#${existingIssue.number}: ${existingIssue.html_url}`)
          await octokit.rest.issues.update({
            ...context.repo,
            issue_number: existingIssue.number,
            body: templated.body
          })
          setOutputs(existingIssue, 'updated')
          core.info(`Updated issue ${existingIssue.title}#${existingIssue.number}: ${existingIssue.html_url}`)
          return
        } catch (err: any) {
          return logError(template, 'updating', err)
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
      ...context.repo,
      ...templated,
      assignees: assignees ? listToArray(assignees) : listToArray(attributes.assignees),
      milestone: Number(core.getInput('milestone') || attributes.milestone) || undefined
    })

    setOutputs(issue.data, 'created')
    core.info(`Created issue ${issue.data.title}#${issue.data.number}: ${issue.data.html_url}`)
  } catch (err: any) {
    return logError(template, 'creating', err)
  }
}
