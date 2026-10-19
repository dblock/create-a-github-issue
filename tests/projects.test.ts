import { describe, beforeEach, afterEach, it, expect } from '@jest/globals'
import { createAnIssue, params, mockSetOutput, mockSetFailed, mockInfo, mockIssuesCreate, mockIssuesUpdate, mockSearchIssuesAndPullRequests, mockGraphql } from './action-setup'

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

  it.each(['true', 'false'])('does not report success if adding an existing issue fails with update_existing=%s', async updateExisting => {
    process.env.INPUT_UPDATE_EXISTING = updateExisting
    mockSearchIssuesAndPullRequests.mockResolvedValue({
      data: { items: [{ number: 42, node_id: 'I_existing', title: 'Hello!', html_url: 'www' }] }
    })
    mockGraphql
      .mockResolvedValueOnce({ owner: { projectV2: { id: 'PVT_project' } } })
      .mockRejectedValueOnce(new Error('Project write access denied'))

    await expect(createAnIssue()).rejects.toThrow('Project write access denied')

    expect(mockIssuesUpdate).toHaveBeenCalledTimes(updateExisting === 'true' ? 1 : 0)
    expect(mockIssuesCreate).not.toHaveBeenCalled()
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
