import { jest, describe, beforeEach, afterEach, it, expect } from '@jest/globals'

const mockFetch = jest.fn<typeof globalThis.fetch>()
const mockSetOutput = jest.fn()
const undici = await import('undici')
let inputs: Record<string, string>

const title = 'JasonEtco: "build" NOT repo:elsewhere/project \\ failed'
const query = `is:open is:issue repo:JasonEtco/waddup in:title ${JSON.stringify(title)}`

jest.unstable_mockModule('undici', () => ({
  ...undici,
  fetch: mockFetch
}))

jest.unstable_mockModule('@actions/core', () => ({
  getInput: (name: string) => inputs[name] || '',
  debug: jest.fn(),
  info: jest.fn(),
  warning: jest.fn(),
  error: jest.fn(),
  setFailed: jest.fn(),
  setOutput: mockSetOutput
}))

jest.unstable_mockModule('fs/promises', () => ({
  readFile: jest.fn(async () => `---\ntitle: ${JSON.stringify('{{ repo.owner }}: "build" NOT repo:elsewhere/project \\ failed')}\n---\nUpdated body\n`)
}))

function response(body: object, nextPage?: number, status = 200) {
  const url = new URL('https://api.github.com/search/issues')
  url.searchParams.set('q', query)
  url.searchParams.set('per_page', '100')
  url.searchParams.set('page', String(nextPage))
  const result = new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json',
      ...(nextPage ? { link: `<${url}>; rel="next"` } : {})
    }
  })
  Object.defineProperty(result, 'url', { value: 'https://api.github.com/search/issues' })
  return result
}

describe('exact-title duplicate detection', () => {
  beforeEach(() => {
    jest.resetModules()
    jest.useFakeTimers()
    inputs = { update_existing: 'true' }
    mockFetch.mockReset().mockRejectedValue(new Error('Unexpected network request'))
  })

  afterEach(() => {
    jest.restoreAllMocks()
    jest.clearAllMocks()
    jest.useRealTimers()
  })

  it.each(['true', 'false'])('finds a rendered title on page two with update_existing=%s and stops searching', async updateExisting => {
    inputs.update_existing = updateExisting
    mockFetch
      .mockResolvedValueOnce(response({
        total_count: 3, incomplete_results: false,
        items: [{ number: 1, title: `${title} again`, html_url: 'other' }]
      }, 2))
      .mockResolvedValueOnce(response({
        total_count: 3, incomplete_results: false,
        items: [{ number: 42, title, html_url: 'found', state: 'open' }]
      }, 3))
    if (updateExisting === 'true') mockFetch.mockResolvedValueOnce(response({}))
    const { createAnIssue } = await import('../src/action')

    const action = createAnIssue()
    await jest.advanceTimersByTimeAsync(10000)
    await action

    const firstUrl = new URL(String(mockFetch.mock.calls[0][0]))
    expect(firstUrl.searchParams.get('q')).toBe(query)
    expect(firstUrl.searchParams.get('per_page')).toBe('100')
    const secondUrl = new URL(String(mockFetch.mock.calls[1][0]))
    expect(secondUrl.searchParams.get('page')).toBe('2')
    expect(mockSetOutput).toHaveBeenCalledWith('number', '42')
    if (updateExisting === 'true') {
      expect(mockFetch).toHaveBeenCalledTimes(3)
      expect(String(mockFetch.mock.calls[2][0])).toBe('https://api.github.com/repos/JasonEtco/waddup/issues/42')
      expect(mockFetch.mock.calls[2][1]).toMatchObject({
        method: 'PATCH',
        body: JSON.stringify({ body: 'Updated body\n' })
      })
      expect(mockSetOutput).toHaveBeenCalledWith('status', 'updated')
    } else {
      expect(mockFetch).toHaveBeenCalledTimes(2)
      expect(mockSetOutput).toHaveBeenCalledWith('status', 'found')
    }
  })

  it('creates an issue only after exhausting pages without an exact title match', async () => {
    mockFetch
      .mockResolvedValueOnce(response({
        total_count: 2, incomplete_results: false,
        items: [{ number: 1, title: `${title} again` }]
      }, 2))
      .mockResolvedValueOnce(response({
        total_count: 2, incomplete_results: false,
        items: [{ number: 2, title: title.toLowerCase() }]
      }))
      .mockResolvedValueOnce(response({ number: 43, title, html_url: 'created' }, undefined, 201))
    const { createAnIssue } = await import('../src/action')

    const action = createAnIssue()
    await jest.advanceTimersByTimeAsync(10000)
    await action

    expect(mockFetch).toHaveBeenCalledTimes(3)
    expect(String(mockFetch.mock.calls[2][0])).toBe('https://api.github.com/repos/JasonEtco/waddup/issues')
    expect(mockFetch.mock.calls[2][1]).toMatchObject({ method: 'POST' })
    expect(mockSetOutput).toHaveBeenCalledWith('status', 'created')
  })

  it.each([
    { total_count: 0, incomplete_results: true },
    { total_count: 1001, incomplete_results: false }
  ])('does not create a possible duplicate after incomplete results: %j', async metadata => {
    mockFetch.mockResolvedValueOnce(response({ ...metadata, items: [] }))
    const { createAnIssue } = await import('../src/action')

    const action = createAnIssue()
    const rejection = expect(action).rejects.toThrow('GitHub returned incomplete issue search results; refusing to create a possible duplicate.')
    await jest.advanceTimersByTimeAsync(10000)
    await rejection

    expect(mockFetch).toHaveBeenCalledTimes(1)
    expect(mockSetOutput).not.toHaveBeenCalled()
  })

  it.each([403, 409])('does not create an issue if fetching a later page fails with status %s', async status => {
    mockFetch
      .mockResolvedValueOnce(response({ total_count: 1, incomplete_results: false, items: [] }, 2))
      .mockResolvedValueOnce(response({ message: 'Issue search failed' }, undefined, status))
    const { createAnIssue } = await import('../src/action')

    const action = createAnIssue()
    const rejection = expect(action).rejects.toThrow()
    await jest.advanceTimersByTimeAsync(10000)
    await rejection

    expect(mockFetch).toHaveBeenCalledTimes(2)
    expect(mockSetOutput).not.toHaveBeenCalled()
  })
})
