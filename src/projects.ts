import * as core from '@actions/core'
import type { getOctokit } from '@actions/github'

type Octokit = ReturnType<typeof getOctokit>

interface Project {
  id: string
  url: string
}

export async function resolveProject(octokit: Octokit, projectUrl: string): Promise<Project> {
  const server = new URL(process.env.GITHUB_SERVER_URL || 'https://github.com')
  const url = URL.canParse(projectUrl) ? new URL(projectUrl) : undefined
  const match = url?.pathname.match(/^\/(orgs|users)\/([A-Za-z0-9-]+)\/projects\/([1-9]\d*)(?:\/views\/[1-9]\d*)?\/?$/)
  if (!url || url.origin !== server.origin || url.username || url.password || !match || Number(match[3]) > 2147483647) {
    throw new Error(`Invalid project URL "${projectUrl}"; expected ${server.origin}/orgs/OWNER/projects/NUMBER or ${server.origin}/users/OWNER/projects/NUMBER.`)
  }

  const ownerType = match[1] === 'orgs' ? 'organization' : 'user'
  const result = await octokit.graphql<{
    owner: { projectV2: { id: string } | null } | null
  }>(`
    query($owner: String!, $number: Int!) {
      owner: ${ownerType}(login: $owner) {
        projectV2(number: $number) { id }
      }
    }
  `, { owner: match[2], number: Number(match[3]) })
  const id = result.owner?.projectV2?.id
  if (!id) {
    throw new Error(`Project ${projectUrl} was not found or is not accessible to the supplied token.`)
  }
  return { id, url: projectUrl }
}

export async function addIssueToProjects(octokit: Octokit, projects: Project[], issue: { node_id: string, number: number }) {
  for (const project of projects) {
    const result = await octokit.graphql<{
      addProjectV2ItemById: { item: { id: string } | null } | null
    }>(`
      mutation($projectId: ID!, $contentId: ID!) {
        addProjectV2ItemById(input: { projectId: $projectId, contentId: $contentId }) {
          item { id }
        }
      }
    `, { projectId: project.id, contentId: issue.node_id })
    if (!result.addProjectV2ItemById?.item?.id) {
      throw new Error(`GitHub did not confirm adding issue #${issue.number} to project ${project.url}.`)
    }
    core.info(`Added issue #${issue.number} to project ${project.url}`)
  }
}
