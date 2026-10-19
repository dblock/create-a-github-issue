import * as core from '@actions/core'
import type { getOctokit } from '@actions/github'

interface Issue {
  number: number
  title: string
  html_url: string
  state: string
}

export async function findExistingIssue(
  octokit: ReturnType<typeof getOctokit>,
  repository: { owner: string, repo: string },
  title: string,
  state: string
): Promise<Issue | undefined> {
  core.info(`Fetching ${state} issues with title "${title}"`)
  const stateQuery = state === 'all' ? '' : `is:${state} `
  let incompleteSearch = false
  const issues = await octokit.paginate(
    octokit.rest.search.issuesAndPullRequests,
    {
      q: `${stateQuery}is:issue repo:${repository.owner}/${repository.repo} in:title ${JSON.stringify(title)}`,
      per_page: 100
    },
    (response, done) => {
      incompleteSearch ||= response.data.incomplete_results !== false || response.data.total_count > 1000
      const issue = response.data.find(issue => issue.title === title)
      if (!issue) return []
      done()
      return [issue]
    }
  )
  const issue = issues[0]
  if (!issue && incompleteSearch) {
    throw new Error('GitHub returned incomplete issue search results; refusing to create a possible duplicate.')
  }
  return issue
}
