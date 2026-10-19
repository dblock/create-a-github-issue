import { jest, describe, beforeEach, it, expect } from '@jest/globals'

const mockReadFile = jest.fn<() => Promise<string>>()
const mockGetOctokit = jest.fn()

jest.unstable_mockModule('fs/promises', () => ({ readFile: mockReadFile }))
jest.unstable_mockModule('@actions/core', () => ({
  getInput: () => '',
  debug: jest.fn(),
  info: jest.fn()
}))
jest.unstable_mockModule('@actions/github', () => ({
  context: { repo: { owner: 'example', repo: 'repository' } },
  getOctokit: mockGetOctokit
}))

const { createAnIssue } = await import('../src/action')

describe('front matter validation', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it.each([
    { yaml: 'labels: []', field: 'title' },
    { yaml: 'title: 42', field: 'title' },
    { yaml: 'title: null', field: 'title' },
    { yaml: 'title: Report\ntype: true', field: 'type' },
    { yaml: 'title: Report\nassignees: [octocat, 42]', field: 'assignees' },
    { yaml: 'title: Report\nlabels: {name: bug}', field: 'labels' },
    { yaml: 'title: Report\nprojects: false', field: 'projects' },
    { yaml: 'title: Report\nmilestone: [1]', field: 'milestone' }
  ])('rejects invalid $field before creating an API client: $yaml', async ({ yaml, field }) => {
    mockReadFile.mockResolvedValueOnce(`---\n${yaml}\n---\nReport\n`)

    await expect(createAnIssue()).rejects.toThrow(`The ${field} field in .github/ISSUE_TEMPLATE.md must be`)

    expect(mockGetOctokit).not.toHaveBeenCalled()
  })
})
