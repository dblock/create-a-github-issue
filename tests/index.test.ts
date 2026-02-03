import { jest, describe, beforeEach, afterEach, it, expect } from '@jest/globals'

// Mock @actions/core before importing the module that uses it
const mockSetOutput = jest.fn()
const mockSetFailed = jest.fn()
const mockGetInput = jest.fn()
const mockDebug = jest.fn()
const mockInfo = jest.fn()
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
const mockIssuesCreate = jest.fn<(data: any) => Promise<any>>()
const mockIssuesUpdate = jest.fn<(data: any) => Promise<any>>()
const mockSearchIssuesAndPullRequests = jest.fn<(query: any) => Promise<any>>()

jest.unstable_mockModule('@actions/github', () => ({
  context: {
    repo: { owner: 'JasonEtco', repo: 'waddup' },
    payload: {},
    action: 'create-a-github-issue',
  },
  getOctokit: jest.fn(() => ({
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
const { createAnIssue } = await import('../src/action')

describe('create-a-github-issue', () => {
  let params: any

  beforeEach(() => {
    params = undefined
    
    // Reset mock implementations
    mockIssuesCreate.mockImplementation(async (data: any) => {
      params = data
      return {
        data: {
          title: data.title,
          number: 1,
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

    // Simulate an environment variable added for the action
    process.env.EXAMPLE = 'foo'
  })

  afterEach(() => {
    jest.clearAllMocks()
  })

  it('creates a new issue', async () => {
    await createAnIssue()
    expect(params).toMatchSnapshot()
    expect(mockInfo).toHaveBeenCalledWith(expect.stringContaining('Created issue'))

    // Verify that the outputs were set
    expect(mockSetOutput).toHaveBeenCalledTimes(3)
    expect(mockSetOutput).toHaveBeenCalledWith('url', 'www')
    expect(mockSetOutput).toHaveBeenCalledWith('number', '1')
    expect(mockSetOutput).toHaveBeenCalledWith('status', 'created')
  })

  it('creates a new issue from a different template', async () => {
    process.env.INPUT_FILENAME = '.github/different-template.md'
    await createAnIssue()
    expect(params).toMatchSnapshot()
    expect(mockInfo).toHaveBeenCalledWith(expect.stringContaining('Created issue'))
  })

  it('creates a new issue with some template variables', async () => {
    process.env.INPUT_FILENAME = '.github/variables.md'
    await createAnIssue()
    expect(params).toMatchSnapshot()
    expect(mockInfo).toHaveBeenCalledWith(expect.stringContaining('Created issue'))
  })

  it('creates a new issue with the context.repo template variables', async () => {
    process.env.INPUT_FILENAME = '.github/context-repo-template.md'
    await createAnIssue()
    expect(params).toMatchSnapshot()
    expect(mockInfo).toHaveBeenCalledWith(expect.stringContaining('Created issue'))
  })

  it('creates a new issue with assignees, labels and a milestone', async () => {
    process.env.INPUT_FILENAME = '.github/kitchen-sink.md'
    await createAnIssue()
    expect(params).toMatchSnapshot()
    expect(mockInfo).toHaveBeenCalledWith(expect.stringContaining('Created issue'))
  })

  it('creates a new issue with assignees and labels as comma-delimited strings', async () => {
    process.env.INPUT_FILENAME = '.github/split-strings.md'
    await createAnIssue()
    expect(params).toMatchSnapshot()
    expect(mockInfo).toHaveBeenCalledWith(expect.stringContaining('Created issue'))
  })

  it('creates a new issue with an assignee passed by input', async () => {
    process.env.INPUT_ASSIGNEES = 'octocat'
    await createAnIssue()
    expect(params).toMatchSnapshot()
    expect(mockInfo).toHaveBeenCalledWith(expect.stringContaining('Created issue'))
  })

  it('creates a new issue with multiple assignees passed by input', async () => {
    process.env.INPUT_ASSIGNEES = 'octocat, JasonEtco'
    await createAnIssue()
    expect(params).toMatchSnapshot()
    expect(mockInfo).toHaveBeenCalledWith(expect.stringContaining('Created issue'))
  })

  it('creates a new issue with a milestone passed by input', async () => {
    process.env.INPUT_MILESTONE = '1'
    await createAnIssue()
    expect(params).toMatchSnapshot()
    expect(params.milestone).toBe(1)
    expect(mockInfo).toHaveBeenCalledWith(expect.stringContaining('Created issue'))
  })

  it('creates a new issue when updating existing issues is enabled but no issues with the same title exist', async () => {
    mockSearchIssuesAndPullRequests.mockResolvedValue({ data: { items: [] } })

    process.env.INPUT_UPDATE_EXISTING = 'true'

    await createAnIssue()
    expect(params).toMatchSnapshot()
    expect(mockInfo).toHaveBeenCalledWith('No existing issue found to update')
    expect(mockInfo).toHaveBeenCalledWith(expect.stringContaining('Created issue'))
  })

  it('updates an existing open issue with the same title', async () => {
    mockSearchIssuesAndPullRequests.mockResolvedValue({
      data: { items: [{ number: 1, title: 'Hello!', html_url: 'www' }] }
    })

    process.env.INPUT_UPDATE_EXISTING = 'true'

    await createAnIssue()
    expect(mockInfo).toHaveBeenCalledWith(expect.stringContaining('Updated issue'))

    // Verify that the outputs were set
    expect(mockSetOutput).toHaveBeenCalledTimes(3)
    expect(mockSetOutput).toHaveBeenCalledWith('url', 'www')
    expect(mockSetOutput).toHaveBeenCalledWith('number', '1')
    expect(mockSetOutput).toHaveBeenCalledWith('status', 'updated')
  })
  
  it('checks the value of update_existing', async () => {
    process.env.INPUT_UPDATE_EXISTING = 'invalid'

    await createAnIssue()
    expect(mockSetFailed).toHaveBeenCalledWith('Invalid value update_existing=invalid, must be one of true or false')
  })

  it('checks the value of search_existing', async () => {
    process.env.INPUT_SEARCH_EXISTING = 'invalid'

    await createAnIssue()
    expect(mockSetFailed).toHaveBeenCalledWith('Invalid value search_existing=invalid, must be one of open, closed or all')
  })

  it('updates an existing closed issue with the same title', async () => {
    mockSearchIssuesAndPullRequests.mockResolvedValue({
      data: { items: [{ number: 1, title: 'Hello!', html_url: 'www' }] }
    })

    process.env.INPUT_UPDATE_EXISTING = 'true'
    process.env.INPUT_SEARCH_EXISTING = 'all'

    await createAnIssue()
    expect(mockInfo).toHaveBeenCalledWith('Updated issue Hello!#1: www')
  })

  it('finds, but does not update an existing issue with the same title', async () => {
    mockSearchIssuesAndPullRequests.mockResolvedValue({
      data: { items: [{ number: 1, title: 'Hello!', html_url: 'www' }] }
    })
    process.env.INPUT_UPDATE_EXISTING = 'false'

    await createAnIssue()
    expect(mockInfo).toHaveBeenCalledWith('Existing issue Hello!#1: www found but not updated')

    // Verify that the outputs were set
    expect(mockSetOutput).toHaveBeenCalledTimes(3)
    expect(mockSetOutput).toHaveBeenCalledWith('url', 'www')
    expect(mockSetOutput).toHaveBeenCalledWith('number', '1')
    expect(mockSetOutput).toHaveBeenCalledWith('status', 'found')
  })

  it('exits when updating an issue fails', async () => {
    mockSearchIssuesAndPullRequests.mockResolvedValue({
      data: { items: [{ number: 1, title: 'Hello!', html_url: 'www' }] }
    })
    mockIssuesUpdate.mockRejectedValue(new Error('Updating issue failed'))

    process.env.INPUT_UPDATE_EXISTING = 'true'

    await createAnIssue()
    expect(mockSetFailed).toHaveBeenCalled()
  })

  it('logs a helpful error if creating an issue throws an error', async () => {
    mockIssuesCreate.mockRejectedValue(new Error('Validation error'))

    await createAnIssue()
    expect(mockError).toHaveBeenCalled()
    expect(mockSetFailed).toHaveBeenCalled()
  })

  it('logs a helpful error if creating an issue throws an error with more errors', async () => {
    const error = new Error('Validation error') as any
    error.errors = [{ foo: true }]
    mockIssuesCreate.mockRejectedValue(error)

    await createAnIssue()
    expect(mockError).toHaveBeenCalled()
    expect(mockSetFailed).toHaveBeenCalled()
  })

  it('logs a helpful error if updating an issue throws an error with more errors', async () => {
    mockSearchIssuesAndPullRequests.mockResolvedValue({
      data: { items: [{ number: 1, title: 'Hello!' }] }
    })
    const error = new Error('Validation error') as any
    error.errors = [{ foo: true }]
    mockIssuesUpdate.mockRejectedValue(error)

    process.env.INPUT_UPDATE_EXISTING = 'true'

    await createAnIssue()
    expect(mockError).toHaveBeenCalled()
    expect(mockSetFailed).toHaveBeenCalled()
  })
})
