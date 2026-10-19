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
const mockGraphql = jest.fn<(query: string, variables: Record<string, unknown>) => Promise<unknown>>()

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

  it('creates a new issue', async () => {
    await createAnIssue()
    expect(params).toMatchSnapshot()
    expect(params).not.toHaveProperty('type')
    expect(mockGraphql).not.toHaveBeenCalled()
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

  it.each(['created', 'updated'])('includes workspace files and nested templates in a %s issue', async status => {
    process.env.INPUT_FILENAME = '.github/include.md'
    if (status === 'updated') {
      process.env.INPUT_UPDATE_EXISTING = 'true'
      mockSearchIssuesAndPullRequests.mockResolvedValue({
        data: { items: [{ number: 42, title: 'Included report', html_url: 'www' }] }
      })
    }

    await createAnIssue()

    expect(params.body).toContain('Report:\n# JasonEtco/waddup\nResult: FOO\nNested report details.')
    expect(mockSetOutput).toHaveBeenCalledWith('status', status)
    expect(mockSetFailed).not.toHaveBeenCalled()
  })

  it('fails before searching or changing issues when an included workspace file is missing', async () => {
    process.env.INPUT_FILENAME = '.github/missing-include.md'
    process.env.INPUT_UPDATE_EXISTING = 'true'

    await expect(createAnIssue()).rejects.toThrow('template not found: reports/missing.md')

    expect(mockSearchIssuesAndPullRequests).not.toHaveBeenCalled()
    expect(mockIssuesCreate).not.toHaveBeenCalled()
    expect(mockIssuesUpdate).not.toHaveBeenCalled()
    expect(mockSetOutput).not.toHaveBeenCalled()
  })

  describe('project membership', () => {
    const serverUrl = process.env.GITHUB_SERVER_URL

    beforeEach(() => {
      process.env.INPUT_FILENAME = '.github/project.md'
      process.env.PROJECT_URL = 'https://github.com/orgs/example/projects/7'
      mockGraphql.mockImplementation(async query => query.includes('addProjectV2ItemById')
        ? { addProjectV2ItemById: { item: { id: 'PVTI_item' } } }
        : { owner: { projectV2: { id: 'PVT_project' } } }
      )
    })

    afterEach(() => {
      if (serverUrl === undefined) delete process.env.GITHUB_SERVER_URL
      else process.env.GITHUB_SERVER_URL = serverUrl
    })

    it.each([
      { url: 'https://github.com/orgs/example/projects/7', ownerType: 'organization' },
      { url: 'https://github.com/users/example/projects/7', ownerType: 'user' },
      { url: 'https://github.com/orgs/example/projects/7/views/1?filterQuery=is%3Aopen', ownerType: 'organization' }
    ])('adds a created issue to $url', async ({ url, ownerType }) => {
      process.env.PROJECT_URL = url

      await createAnIssue()

      expect(mockGraphql).toHaveBeenNthCalledWith(1, expect.stringContaining(`owner: ${ownerType}(login: $owner)`), {
        owner: 'example', number: 7
      })
      expect(mockGraphql).toHaveBeenNthCalledWith(2, expect.stringContaining('addProjectV2ItemById'), {
        projectId: 'PVT_project', contentId: 'I_created'
      })
      expect(mockGraphql).toHaveBeenCalledTimes(2)
      expect(params).not.toHaveProperty('projects')
      expect(mockSetOutput).toHaveBeenCalledWith('status', 'created')
      expect(mockSetFailed).not.toHaveBeenCalled()
    })

    it.each(['true', 'false'])('adds a matched existing issue with update_existing=%s', async updateExisting => {
      process.env.INPUT_UPDATE_EXISTING = updateExisting
      mockSearchIssuesAndPullRequests.mockResolvedValue({
        data: { items: [{ number: 42, node_id: 'I_existing', title: 'Hello!', html_url: 'www', state: 'open' }] }
      })

      await createAnIssue()

      expect(mockIssuesCreate).not.toHaveBeenCalled()
      expect(mockIssuesUpdate).toHaveBeenCalledTimes(updateExisting === 'true' ? 1 : 0)
      expect(mockGraphql).toHaveBeenNthCalledWith(2, expect.stringContaining('addProjectV2ItemById'), {
        projectId: 'PVT_project', contentId: 'I_existing'
      })
      expect(mockSetOutput).toHaveBeenCalledWith('status', updateExisting === 'true' ? 'updated' : 'found')
    })

    it('accepts project URLs on the configured enterprise server', async () => {
      process.env.GITHUB_SERVER_URL = 'https://github.example.com'
      process.env.PROJECT_URL = 'https://github.example.com/orgs/example/projects/7'

      await createAnIssue()

      expect(mockGraphql).toHaveBeenCalledTimes(2)
      expect(mockSetFailed).not.toHaveBeenCalled()
    })

    it.each([
      '',
      'not-a-url',
      'https://elsewhere.example/orgs/example/projects/7',
      'https://github.com/example/repository/projects/7',
      'https://github.com/orgs/example/projects/0',
      'https://github.com/orgs/example/projects/2147483648'
    ])('rejects invalid project URL "%s" before changing issues', async url => {
      process.env.PROJECT_URL = url

      await expect(createAnIssue()).rejects.toThrow('Invalid project URL')

      expect(mockGraphql).not.toHaveBeenCalled()
      expect(mockIssuesCreate).not.toHaveBeenCalled()
      expect(mockIssuesUpdate).not.toHaveBeenCalled()
      expect(mockSetOutput).not.toHaveBeenCalled()
    })

    it('fails before changing issues when the project is unavailable', async () => {
      mockGraphql.mockResolvedValueOnce({ owner: { projectV2: null } })

      await expect(createAnIssue()).rejects.toThrow('was not found or is not accessible')

      expect(mockIssuesCreate).not.toHaveBeenCalled()
      expect(mockIssuesUpdate).not.toHaveBeenCalled()
      expect(mockSetOutput).not.toHaveBeenCalled()
    })

    it('fails explicitly if adding the created issue is denied', async () => {
      mockGraphql
        .mockResolvedValueOnce({ owner: { projectV2: { id: 'PVT_project' } } })
        .mockRejectedValueOnce(new Error('Project write access denied'))

      await expect(createAnIssue()).rejects.toThrow('Project write access denied')

      expect(mockIssuesCreate).toHaveBeenCalledTimes(1)
      expect(mockSetOutput).not.toHaveBeenCalled()
    })

    it('does not report success if GitHub returns no project item', async () => {
      mockGraphql
        .mockResolvedValueOnce({ owner: { projectV2: { id: 'PVT_project' } } })
        .mockResolvedValueOnce({ addProjectV2ItemById: { item: null } })

      await expect(createAnIssue()).rejects.toThrow('GitHub did not confirm adding issue #1')

      expect(mockSetOutput).not.toHaveBeenCalled()
    })

    describe('multiple projects', () => {
      beforeEach(() => {
        process.env.INPUT_FILENAME = '.github/projects.md'
        process.env.PROJECT_URL = 'https://github.com/users/example/projects/3'
        mockGraphql.mockImplementation(async (query, variables) => query.includes('addProjectV2ItemById')
          ? { addProjectV2ItemById: { item: { id: 'PVTI_item' } } }
          : { owner: { projectV2: { id: `PVT_${variables.number}` } } }
        )
      })

      it.each(['created', 'updated', 'found'])('adds a %s issue to every project after resolving all URLs', async status => {
        if (status !== 'created') {
          process.env.INPUT_UPDATE_EXISTING = String(status === 'updated')
          mockSearchIssuesAndPullRequests.mockResolvedValue({
            data: { items: [{ number: 42, node_id: 'I_existing', title: 'Hello!', html_url: 'www', state: 'open' }] }
          })
        }

        await createAnIssue()

        expect(mockGraphql).toHaveBeenNthCalledWith(1, expect.stringContaining('owner: organization'), {
          owner: 'JasonEtco', number: 7
        })
        expect(mockGraphql).toHaveBeenNthCalledWith(2, expect.stringContaining('owner: user'), {
          owner: 'example', number: 3
        })
        expect(mockGraphql.mock.calls.slice(2).map(([, variables]) => variables)).toEqual([
          { projectId: 'PVT_7', contentId: status === 'created' ? 'I_created' : 'I_existing' },
          { projectId: 'PVT_3', contentId: status === 'created' ? 'I_created' : 'I_existing' }
        ])
        expect(mockGraphql).toHaveBeenCalledTimes(4)
        expect(mockSetOutput).toHaveBeenCalledWith('status', status)
        expect(mockSetFailed).not.toHaveBeenCalled()
      })

      it('does not change issues if a later project cannot be resolved', async () => {
        mockGraphql
          .mockResolvedValueOnce({ owner: { projectV2: { id: 'PVT_7' } } })
          .mockResolvedValueOnce({ owner: { projectV2: null } })

        await expect(createAnIssue()).rejects.toThrow('was not found or is not accessible')

        expect(mockGraphql).toHaveBeenCalledTimes(2)
        expect(mockIssuesCreate).not.toHaveBeenCalled()
        expect(mockIssuesUpdate).not.toHaveBeenCalled()
        expect(mockSetOutput).not.toHaveBeenCalled()
      })

      it('fails without reporting success when a later membership addition is denied', async () => {
        mockGraphql
          .mockResolvedValueOnce({ owner: { projectV2: { id: 'PVT_7' } } })
          .mockResolvedValueOnce({ owner: { projectV2: { id: 'PVT_3' } } })
          .mockResolvedValueOnce({ addProjectV2ItemById: { item: { id: 'PVTI_first' } } })
          .mockRejectedValueOnce(new Error('Second project write access denied'))

        await expect(createAnIssue()).rejects.toThrow('Second project write access denied')

        expect(mockGraphql).toHaveBeenCalledTimes(4)
        expect(mockInfo).toHaveBeenCalledWith('Added issue #1 to project https://github.com/orgs/JasonEtco/projects/7')
        expect(mockSetOutput).not.toHaveBeenCalled()
      })

      it('rejects non-string list entries before resolving projects or changing issues', async () => {
        process.env.INPUT_FILENAME = '.github/invalid-projects.md'

        await expect(createAnIssue()).rejects.toThrow('must be a Projects v2 URL or a list of URLs')

        expect(mockGraphql).not.toHaveBeenCalled()
        expect(mockIssuesCreate).not.toHaveBeenCalled()
        expect(mockIssuesUpdate).not.toHaveBeenCalled()
      })
    })
  })

  it('creates an issue in the target repository without changing template context', async () => {
    process.env.INPUT_REPO = 'another-owner/another-repo'
    process.env.INPUT_FILENAME = '.github/context-repo-template.md'

    await createAnIssue()

    expect(params).toMatchObject({ owner: 'another-owner', repo: 'another-repo' })
    expect(params.body).toContain('https://JasonEtco.github.io/waddup/')
  })

  it.each(['true', 'false'])('searches the target repository with update_existing=%s', async updateExisting => {
    process.env.INPUT_REPO = 'another-owner/another-repo'
    process.env.INPUT_UPDATE_EXISTING = updateExisting
    mockSearchIssuesAndPullRequests.mockResolvedValue({
      data: { items: [{ number: 42, title: 'Hello!', html_url: 'www' }] }
    })

    await createAnIssue()

    expect(mockSearchIssuesAndPullRequests).toHaveBeenCalledWith({
      q: 'is:open is:issue repo:another-owner/another-repo in:title "Hello!"',
      per_page: 100
    })
    expect(mockIssuesCreate).not.toHaveBeenCalled()
    if (updateExisting === 'true') {
      expect(mockIssuesUpdate).toHaveBeenCalledWith(expect.objectContaining({
        owner: 'another-owner', repo: 'another-repo', issue_number: 42
      }))
    } else {
      expect(mockIssuesUpdate).not.toHaveBeenCalled()
      expect(mockSetOutput).toHaveBeenCalledWith('status', 'found')
    }
  })

  it.each(['repository', '/repo', 'owner/', 'owner/repo/extra', 'owner/re po'])(
    'rejects invalid target repository %s before making API requests',
    async repository => {
      process.env.INPUT_REPO = repository

      await expect(createAnIssue()).rejects.toThrow(`Invalid value repo=${repository}, must be in owner/repo format`)
      expect(mockIssuesCreate).not.toHaveBeenCalled()
      expect(mockIssuesUpdate).not.toHaveBeenCalled()
      expect(mockSearchIssuesAndPullRequests).not.toHaveBeenCalled()
    }
  )

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

  it.each([
    { value: undefined, expected: 'Bug' },
    { value: 'Feature', expected: 'Feature' }
  ])('creates an issue with type $expected from front matter', async ({ value, expected }) => {
    process.env.INPUT_FILENAME = '.github/issue-type.md'
    if (value) process.env.ISSUE_TYPE = value

    await createAnIssue()

    expect(params.type).toBe(expected)
    expect(mockSetFailed).not.toHaveBeenCalled()
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

  it.each(['templated-assignees-string', 'templated-assignees-array'])(
    'renders assignee template variables in %s front matter',
    async template => {
      process.env.INPUT_FILENAME = `.github/${template}.md`

      await createAnIssue()

      expect(params.assignees).toEqual(['foo', 'JasonEtco'])
      expect(mockSetFailed).not.toHaveBeenCalled()
    }
  )

  it('renders assignee input template variables instead of front matter assignees', async () => {
    process.env.INPUT_FILENAME = '.github/kitchen-sink.md'
    process.env.INPUT_ASSIGNEES = '{{ env.EXAMPLE | upper }}, {{ repo.owner }}'

    await createAnIssue()

    expect(params.assignees).toEqual(['FOO', 'JasonEtco'])
    expect(mockSetFailed).not.toHaveBeenCalled()
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

    await expect(createAnIssue()).rejects.toThrow('Invalid value update_existing=invalid, must be one of true or false')
  })

  it('checks the value of search_existing', async () => {
    process.env.INPUT_SEARCH_EXISTING = 'invalid'

    await expect(createAnIssue()).rejects.toThrow('Invalid value search_existing=invalid, must be one of open, closed or all')
  })

  it('updates an existing closed issue with the same title', async () => {
    mockSearchIssuesAndPullRequests.mockResolvedValue({
      data: { items: [{ number: 1, title: 'Hello!', html_url: 'www', state: 'closed' }] }
    })

    process.env.INPUT_UPDATE_EXISTING = 'true'
    process.env.INPUT_SEARCH_EXISTING = 'all'

    await createAnIssue()
    expect(mockInfo).toHaveBeenCalledWith('Updated issue Hello!#1: www')
    expect(params).not.toHaveProperty('state')
  })

  it.each([
    { state: 'closed', reopen: 'true', search: 'all', expected: 'open' },
    { state: 'closed', reopen: 'true', search: 'closed', expected: 'open' },
    { state: 'closed', reopen: 'false', search: 'all', expected: undefined },
    { state: 'open', reopen: 'true', search: 'all', expected: undefined }
  ])('updates a $state issue with reopen_existing=$reopen and search_existing=$search', async ({ state, reopen, search, expected }) => {
    process.env.INPUT_UPDATE_EXISTING = 'true'
    process.env.INPUT_REOPEN_EXISTING = reopen
    process.env.INPUT_SEARCH_EXISTING = search
    mockSearchIssuesAndPullRequests.mockResolvedValue({
      data: { items: [{ number: 1, title: 'Hello!', html_url: 'www', state }] }
    })

    await createAnIssue()

    expect(mockIssuesUpdate).toHaveBeenCalledTimes(1)
    expect(params.state).toBe(expected)
    expect(params.body).toBeDefined()
    expect(mockSetOutput).toHaveBeenCalledWith('status', 'updated')
  })

  it('does not reopen a closed issue when updates are disabled', async () => {
    process.env.INPUT_UPDATE_EXISTING = 'false'
    process.env.INPUT_REOPEN_EXISTING = 'true'
    process.env.INPUT_SEARCH_EXISTING = 'all'
    mockSearchIssuesAndPullRequests.mockResolvedValue({
      data: { items: [{ number: 1, title: 'Hello!', html_url: 'www', state: 'closed' }] }
    })

    await createAnIssue()

    expect(mockIssuesUpdate).not.toHaveBeenCalled()
    expect(mockIssuesCreate).not.toHaveBeenCalled()
    expect(mockSetOutput).toHaveBeenCalledWith('status', 'found')
  })

  it('rejects invalid reopen_existing values', async () => {
    process.env.INPUT_REOPEN_EXISTING = 'invalid'

    await expect(createAnIssue()).rejects.toThrow('Invalid value reopen_existing=invalid, must be one of true or false')
    expect(mockIssuesUpdate).not.toHaveBeenCalled()
    expect(mockIssuesCreate).not.toHaveBeenCalled()
    expect(mockSearchIssuesAndPullRequests).not.toHaveBeenCalled()
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

    await expect(createAnIssue()).rejects.toThrow('Updating issue failed')
  })

  it('rejects with context if creating an issue fails', async () => {
    mockIssuesCreate.mockRejectedValue(new Error('Validation error'))

    await expect(createAnIssue()).rejects.toThrow('Validation error')
  })

  it('preserves API error details if creating an issue fails', async () => {
    const error = Object.assign(new Error('Validation error'), { errors: [{ foo: true }] })
    mockIssuesCreate.mockRejectedValue(error)

    await expect(createAnIssue()).rejects.toMatchObject({ cause: error })
  })

  it('preserves API error details if updating an issue fails', async () => {
    mockSearchIssuesAndPullRequests.mockResolvedValue({
      data: { items: [{ number: 1, title: 'Hello!' }] }
    })
    const error = Object.assign(new Error('Validation error'), { errors: [{ foo: true }] })
    mockIssuesUpdate.mockRejectedValue(error)

    process.env.INPUT_UPDATE_EXISTING = 'true'

    await expect(createAnIssue()).rejects.toMatchObject({ cause: error })
  })
})
