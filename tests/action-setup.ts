import { jest, beforeEach, afterEach } from '@jest/globals'

// Mock @actions/core before importing the module that uses it
export const mockSetOutput = jest.fn()
export const mockSetFailed = jest.fn()
const mockGetInput = jest.fn()
const mockDebug = jest.fn()
export const mockInfo = jest.fn()
const mockError = jest.fn()

jest.unstable_mockModule('@actions/core', () => ({
  setOutput: mockSetOutput,
  setFailed: mockSetFailed,
  getInput: mockGetInput,
  debug: mockDebug,
  info: mockInfo,
  warning: jest.fn(),
  error: mockError,
}))

// Mock GitHub API responses
export const mockIssuesCreate = jest.fn<(data: any) => Promise<any>>()
export const mockIssuesUpdate = jest.fn<(data: any) => Promise<any>>()
export const mockSearchIssuesAndPullRequests = jest.fn<(query: any) => Promise<any>>()
export const mockGraphql = jest.fn<(query: string, variables: Record<string, unknown>) => Promise<unknown>>()

jest.unstable_mockModule('@actions/github', () => ({
  context: {
    repo: { owner: 'JasonEtco', repo: 'waddup' },
    payload: {},
    action: 'create-a-github-issue',
  },
  getOctokit: jest.fn(() => ({
    paginate: async (
      search: typeof mockSearchIssuesAndPullRequests,
      options: unknown,
      map: (response: { data: unknown[] }, done: () => void) => unknown[]
    ) => {
      const response = await search(options)
      const data = Object.assign(response.data.items, {
        incomplete_results: response.data.incomplete_results ?? false,
        total_count: response.data.total_count ?? response.data.items.length
      })
      return map({ data }, () => {})
    },
    graphql: mockGraphql,
    rest: {
      issues: {
        create: mockIssuesCreate,
        update: mockIssuesUpdate,
      },
      search: {
        issuesAndPullRequests: mockSearchIssuesAndPullRequests,
      },
    },
  })),
}))

// Import after mocking
export const { createAnIssue } = await import('../src/action')

export let params: any

beforeEach(() => {
  params = undefined

  // Reset mock implementations
  mockIssuesCreate.mockImplementation(async (data: any) => {
    params = data
    return {
      data: {
        title: data.title,
        number: 1,
        node_id: 'I_created',
        html_url: 'www'
      }
    }
  })

  mockIssuesUpdate.mockImplementation(async (data: any) => {
    params = data
    return { data: {} }
  })

  mockSearchIssuesAndPullRequests.mockImplementation(async () => ({
    data: { items: [] }
  }))
  mockGraphql.mockReset()

  // Reset input mocks
  mockGetInput.mockImplementation((name: unknown) => {
    // Map INPUT_* env vars to inputs
    const envKey = `INPUT_${String(name).toUpperCase()}`
    return process.env[envKey] || ''
  })

  // Ensure that the filename input isn't set at the start of a test
  delete process.env.INPUT_FILENAME
  delete process.env.INPUT_UPDATE_EXISTING
  delete process.env.INPUT_SEARCH_EXISTING
  delete process.env.INPUT_ASSIGNEES
  delete process.env.INPUT_MILESTONE
  delete process.env.INPUT_REPO
  delete process.env.ISSUE_TYPE
  delete process.env.INPUT_REOPEN_EXISTING
  delete process.env.PROJECT_URL

  // Simulate an environment variable added for the action
  process.env.EXAMPLE = 'foo'
})

afterEach(() => {
  jest.clearAllMocks()
})
