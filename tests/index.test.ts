import nock from 'nock'

// Mock the action's imports BEFORE importing them
jest.mock('@actions/core')
jest.mock('@actions/github')

import * as core from '@actions/core'
import * as github from '@actions/github'
import { createAnIssue } from '../src/action'

const mockGetInput = core.getInput as jest.MockedFunction<typeof core.getInput>
const mockSetOutput = core.setOutput as jest.MockedFunction<typeof core.setOutput>
const mockSetFailed = core.setFailed as jest.MockedFunction<typeof core.setFailed>
const mockInfo = core.info as jest.MockedFunction<typeof core.info>
const mockError = core.error as jest.MockedFunction<typeof core.error>
const mockDebug = core.debug as jest.MockedFunction<typeof core.debug>

describe('create-a-github-issue', () => {
  let params: any
  let mockOctokit: any

  beforeEach(() => {
    jest.clearAllMocks()
    
    // Setup default mock implementations
    mockGetInput.mockImplementation((name: string) => {
      const inputs: Record<string, string> = {
        'github-token': 'fake-token',
        'filename': process.env.INPUT_FILENAME || '',
        'assignees': process.env.INPUT_ASSIGNEES || '',
        'milestone': process.env.INPUT_MILESTONE || '',
        'update_existing': process.env.INPUT_UPDATE_EXISTING || '',
        'search_existing': process.env.INPUT_SEARCH_EXISTING || ''
      }
      return inputs[name] || ''
    })

    // Mock octokit
    mockOctokit = {
      rest: {
        issues: {
          create: jest.fn().mockImplementation(async (opts: any) => {
            params = opts
            return {
              data: { title: opts.title, number: 1, html_url: 'www' }
            }
          }),
          update: jest.fn().mockResolvedValue({
            data: { title: 'Hello!', number: 1, html_url: 'www' }
          })
        },
        search: {
          issuesAndPullRequests: jest.fn().mockResolvedValue({
            data: { items: [] }
          })
        }
      }
    }

    ;(github.getOctokit as jest.Mock).mockReturnValue(mockOctokit)
    ;(github as any).context = {
      repo: { owner: 'JasonEtco', repo: 'waddup' },
      payload: {}
    }

    // Setup nock for API calls (not used with mocked octokit, but kept for compatibility)
    nock('https://api.github.com')
      .post(/\/repos\/.*\/.*\/issues/).reply(200, (_, body: any) => {
        return {
          title: body.title,
          number: 1,
          html_url: 'www'
        }
      })

    // Ensure that the filename input isn't set at the start of a test
    delete process.env.INPUT_FILENAME
    delete process.env.INPUT_ASSIGNEES
    delete process.env.INPUT_MILESTONE
    delete process.env.INPUT_UPDATE_EXISTING
    delete process.env.INPUT_SEARCH_EXISTING

    // Simulate an environment variable added for the action
    process.env.EXAMPLE = 'foo'
    process.env.GITHUB_REPOSITORY = 'JasonEtco/waddup'
  })

  afterEach(() => {
    nock.cleanAll()
  })

  it('creates a new issue', async () => {
    await createAnIssue()
    expect(params).toMatchSnapshot()
    expect(mockInfo).toHaveBeenCalled()

    // Verify that the outputs were set
    expect(mockSetOutput).toHaveBeenCalledTimes(3)
    expect(mockSetOutput).toHaveBeenCalledWith('url', 'www')
    expect(mockSetOutput).toHaveBeenCalledWith('number', '1')
    expect(mockSetOutput).toHaveBeenCalledWith('status', 'created')
  })

  it('creates a new issue from a different template', async () => {
    process.env.INPUT_FILENAME = '.github/different-template.md'
    ;(github as any).context.payload = { repository: { owner: { login: 'JasonEtco' }, name: 'waddup' } }
    await createAnIssue()
    expect(params).toMatchSnapshot()
    expect(mockInfo).toHaveBeenCalled()
  })

  it('creates a new issue with some template variables', async () => {
    process.env.INPUT_FILENAME = '.github/variables.md'
    await createAnIssue()
    expect(params).toMatchSnapshot()
    expect(mockInfo).toHaveBeenCalled()
  })

  it('creates a new issue with the context.repo template variables', async () => {
    process.env.INPUT_FILENAME = '.github/context-repo-template.md'
    await createAnIssue()
    expect(params).toMatchSnapshot()
    expect(mockInfo).toHaveBeenCalled()
  })

  it('creates a new issue with assignees, labels and a milestone', async () => {
    process.env.INPUT_FILENAME = '.github/kitchen-sink.md'
    await createAnIssue()
    expect(params).toMatchSnapshot()
    expect(mockInfo).toHaveBeenCalled()
  })

  it('creates a new issue with assignees and labels as comma-delimited strings', async () => {
    process.env.INPUT_FILENAME = '.github/split-strings.md'
    await createAnIssue()
    expect(params).toMatchSnapshot()
    expect(mockInfo).toHaveBeenCalled()
  })

  it('creates a new issue with an assignee passed by input', async () => {
    process.env.INPUT_ASSIGNEES = 'octocat'
    await createAnIssue()
    expect(params).toMatchSnapshot()
    expect(mockInfo).toHaveBeenCalled()
  })

  it('creates a new issue with multiple assignees passed by input', async () => {
    process.env.INPUT_ASSIGNEES = 'octocat, JasonEtco'
    await createAnIssue()
    expect(params).toMatchSnapshot()
    expect(mockInfo).toHaveBeenCalled()
  })

  it('creates a new issue with a milestone passed by input', async () => {
    process.env.INPUT_MILESTONE = '1'
    await createAnIssue()
    expect(params).toMatchSnapshot()
    expect(params.milestone).toBe(1)
    expect(mockInfo).toHaveBeenCalled()
  })

  it('creates a new issue when updating existing issues is enabled but no issues with the same title exist', async () => {
    nock.cleanAll()
    nock('https://api.github.com')
      .get(/\/search\/issues.*/).reply(200, {
        items: []
      })
      .post(/\/repos\/.*\/.*\/issues/).reply(200, (_, body: any) => {
        return {
          title: body.title,
          number: 1,
          html_url: 'www'
        }
      })

    mockOctokit.rest.search.issuesAndPullRequests.mockResolvedValue({
      data: { items: [] }
    })

    process.env.INPUT_UPDATE_EXISTING = 'true'

    await createAnIssue()
    expect(params).toMatchSnapshot()
    expect(mockInfo).toHaveBeenCalledWith('No existing issue found to update')
    expect(mockInfo).toHaveBeenCalled()
  })

  it('updates an existing open issue with the same title', async () => {
    nock.cleanAll()
    nock('https://api.github.com')
      .get(/\/search\/issues.*/)
      .query(parsedQuery => {
        const q = parsedQuery['q']
        if (typeof(q) === 'string') {
          const args = q.split(' ')
          return (args.includes('is:open') || args.includes('is:closed')) 
            && args.includes('is:issue')
        } else {
          return false
        }
      })
      .reply(200, {
        items: [{ number: 1, title: 'Hello!', html_url: 'www' }]
      })
      .patch(/\/repos\/.*\/.*\/issues\/.*/).reply(200, {})

    mockOctokit.rest.search.issuesAndPullRequests.mockResolvedValue({
      data: { items: [{ number: 1, title: 'Hello!', html_url: 'www' }] }
    })

    process.env.INPUT_UPDATE_EXISTING = 'true'

    await createAnIssue()
    expect(params).toMatchSnapshot()

    // Verify that the outputs were set
    expect(mockSetOutput).toHaveBeenCalledTimes(3)
    expect(mockSetOutput).toHaveBeenCalledWith('url', 'www')
    expect(mockSetOutput).toHaveBeenCalledWith('number', '1')
    expect(mockSetOutput).toHaveBeenCalledWith('status', 'updated')
  })
  
  it('checks the value of update_existing', async () => {
    process.env.INPUT_UPDATE_EXISTING = 'invalid'

    await createAnIssue()
    expect(params).toMatchSnapshot()
    expect(mockSetFailed).toHaveBeenCalledWith('Invalid value update_existing=invalid, must be one of true or false')
  })

  it('checks the value of search_existing', async () => {
    process.env.INPUT_SEARCH_EXISTING = 'invalid'

    await createAnIssue()
    expect(params).toMatchSnapshot()
    expect(mockSetFailed).toHaveBeenCalledWith('Invalid value search_existing=invalid, must be one of open, closed or all')
  })

  it('updates an existing closed issue with the same title', async () => {
    nock.cleanAll()
    nock('https://api.github.com')
      .get(/\/search\/issues.*/)
      .query(parsedQuery => {
        const q = parsedQuery['q']
        if (typeof(q) === 'string') {
          const args = q.split(' ')
          if (args.includes('is:open') || args.includes('is:closed')) {
            return false
          } else {
            return args.includes('is:issue')
          }
        } else {
          return false
        }
      })
      .reply(200, {
        items: [{ number: 1, title: 'Hello!', html_url: 'www' }]
      })
      .patch(/\/repos\/.*\/.*\/issues\/.*/).reply(200, {})

    mockOctokit.rest.search.issuesAndPullRequests.mockResolvedValue({
      data: { items: [{ number: 1, title: 'Hello!', html_url: 'www' }] }
    })

    process.env.INPUT_UPDATE_EXISTING = 'true'
    process.env.INPUT_SEARCH_EXISTING = 'all'

    await createAnIssue()
    expect(mockInfo).toHaveBeenCalledWith('Updated issue Hello!#1: www')
  })

  it('finds, but does not update an existing issue with the same title', async () => {
    nock.cleanAll()
    nock('https://api.github.com')
      .get(/\/search\/issues.*/).reply(200, {
        items: [{ number: 1, title: 'Hello!', html_url: 'www' }]
      })
    
    mockOctokit.rest.search.issuesAndPullRequests.mockResolvedValue({
      data: { items: [{ number: 1, title: 'Hello!', html_url: 'www' }] }
    })

    process.env.INPUT_UPDATE_EXISTING = 'false'

    await createAnIssue()
    expect(params).toMatchSnapshot()
    expect(mockInfo).toHaveBeenCalledWith('Existing issue Hello!#1: www found but not updated')

    // Verify that the outputs were set
    expect(mockSetOutput).toHaveBeenCalledTimes(3)
    expect(mockSetOutput).toHaveBeenCalledWith('url', 'www')
    expect(mockSetOutput).toHaveBeenCalledWith('number', '1')
    expect(mockSetOutput).toHaveBeenCalledWith('status', 'found')
  })

  it('exits when updating an issue fails', async () => {
    nock.cleanAll()
    nock('https://api.github.com')
      .get(/\/search\/issues.*/).reply(200, {
        items: [{ number: 1, title: 'Hello!', html_url: 'www' }]
      })
      .patch(/\/repos\/.*\/.*\/issues\/.*/).reply(500, {
        message: 'Updating issue failed'
      })

    mockOctokit.rest.search.issuesAndPullRequests.mockResolvedValue({
      data: { items: [{ number: 1, title: 'Hello!', html_url: 'www' }] }
    })
    mockOctokit.rest.issues.update.mockRejectedValue(new Error('Updating issue failed'))

    process.env.INPUT_UPDATE_EXISTING = 'true'

    await createAnIssue()
    expect(mockSetFailed).toHaveBeenCalled()
  })

  it('logs a helpful error if creating an issue throws an error', async () => {
    nock.cleanAll()
    nock('https://api.github.com')
      .get(/\/search\/issues.*/).reply(200, { items:[] })
      .post(/\/repos\/.*\/.*\/issues/).reply(500, {
        message: 'Validation error'
      })

    mockOctokit.rest.issues.create.mockRejectedValue(new Error('Validation error'))

    await createAnIssue()
    expect(mockError).toHaveBeenCalled()
    expect(mockSetFailed).toHaveBeenCalled()
  })

  it('logs a helpful error if creating an issue throws an error with more errors', async () => {
    nock.cleanAll()
    nock('https://api.github.com')
      .get(/\/search\/issues.*/).reply(200, { items:[] })
      .post(/\/repos\/.*\/.*\/issues/).reply(500, {
        message: 'Validation error',
        errors: [{ foo: true }]
      })

    const error: any = new Error('Validation error')
    error.errors = [{ foo: true }]
    mockOctokit.rest.issues.create.mockRejectedValue(error)

    await createAnIssue()
    expect(mockError).toHaveBeenCalled()
    expect(mockSetFailed).toHaveBeenCalled()
  })

  it('logs a helpful error if updating an issue throws an error with more errors', async () => {
    nock.cleanAll()
    nock('https://api.github.com')
      .get(/\/search\/issues.*/)
      .reply(200, { items: [{ number: 1, title: 'Hello!' }] })
      .patch(/\/repos\/.*\/.*\/issues\/.*/).reply(500, {
        message: 'Validation error',
        errors: [{ foo: true }]
      })

    mockOctokit.rest.search.issuesAndPullRequests.mockResolvedValue({
      data: { items: [{ number: 1, title: 'Hello!', html_url: 'www' }] }
    })

    const error: any = new Error('Validation error')
    error.errors = [{ foo: true }]
    mockOctokit.rest.issues.update.mockRejectedValue(error)

    process.env.INPUT_UPDATE_EXISTING = 'true'

    await createAnIssue()
    expect(mockError).toHaveBeenCalled()
    expect(mockSetFailed).toHaveBeenCalled()
  })
})
