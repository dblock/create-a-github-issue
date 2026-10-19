import { jest, describe, beforeEach, afterEach, it, expect } from '@jest/globals'

const mockWarning = jest.fn()
const mockSetFailed = jest.fn()
const mockFetch = jest.fn<typeof globalThis.fetch>()
const undici = await import('undici')

jest.unstable_mockModule('undici', () => ({
  ...undici,
  fetch: mockFetch
}))

jest.unstable_mockModule('@actions/core', () => ({
  getInput: () => '',
  debug: jest.fn(),
  info: jest.fn(),
  warning: mockWarning,
  error: jest.fn(),
  setFailed: mockSetFailed,
  setOutput: jest.fn()
}))

jest.unstable_mockModule('fs/promises', () => ({
  readFile: jest.fn(async () => '---\ntitle: Hello!\n---\nHello\n')
}))

function response(status: number, body: object, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers }
  })
}

describe('GitHub rate limits', () => {
  beforeEach(() => {
    jest.resetModules()
    jest.useFakeTimers()
    mockFetch.mockReset().mockRejectedValue(new Error('Unexpected network request'))
  })

  afterEach(() => {
    jest.restoreAllMocks()
    jest.clearAllMocks()
    jest.useRealTimers()
  })

  it('honors Retry-After when retrying a secondary rate limit', async () => {
    const fetch = mockFetch
      .mockResolvedValueOnce(response(403, { message: 'You have exceeded a secondary rate limit.' }, { 'retry-after': '2' }))
      .mockResolvedValueOnce(response(201, { number: 1, title: 'Hello!', html_url: 'www' }))
    const { createAnIssue } = await import('../src/action')

    const action = createAnIssue()
    await jest.advanceTimersByTimeAsync(1000)
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(mockWarning).toHaveBeenCalledWith('GitHub rate limit reached; retrying in 2 seconds (1/2).')

    await jest.advanceTimersByTimeAsync(3000)
    await action

    expect(fetch).toHaveBeenCalledTimes(2)
    expect(mockSetFailed).not.toHaveBeenCalled()
  })

  it('waits for the primary rate limit reset before retrying', async () => {
    const reset = Math.floor(Date.now() / 1000) + 2
    const fetch = mockFetch
      .mockResolvedValueOnce(response(403, { message: 'API rate limit exceeded' }, {
        'x-ratelimit-remaining': '0',
        'x-ratelimit-reset': String(reset)
      }))
      .mockResolvedValueOnce(response(201, { number: 1, title: 'Hello!', html_url: 'www' }))
    const { createAnIssue } = await import('../src/action')

    const action = createAnIssue()
    await jest.advanceTimersByTimeAsync(1000)
    expect(fetch).toHaveBeenCalledTimes(1)

    await jest.advanceTimersByTimeAsync(4000)
    await action

    expect(fetch).toHaveBeenCalledTimes(2)
    expect(mockSetFailed).not.toHaveBeenCalled()
  })

  it('waits 60 seconds for a secondary limit without Retry-After', async () => {
    const fetch = mockFetch
      .mockResolvedValueOnce(response(429, { message: 'You have exceeded a secondary rate limit.' }))
      .mockResolvedValueOnce(response(201, { number: 1, title: 'Hello!', html_url: 'www' }))
    const { createAnIssue } = await import('../src/action')

    const action = createAnIssue()
    await jest.advanceTimersByTimeAsync(59000)
    expect(fetch).toHaveBeenCalledTimes(1)

    await jest.advanceTimersByTimeAsync(3000)
    await action

    expect(fetch).toHaveBeenCalledTimes(2)
    expect(mockSetFailed).not.toHaveBeenCalled()
  })

  it('fails after two retries rather than retrying indefinitely', async () => {
    const fetch = mockFetch.mockImplementation(async () =>
      response(403, { message: 'You have exceeded a secondary rate limit.' }, { 'retry-after': '1' })
    )
    const { createAnIssue } = await import('../src/action')

    const action = createAnIssue()
    const rejection = expect(action).rejects.toThrow('secondary rate limit')
    await jest.advanceTimersByTimeAsync(10000)
    await rejection

    expect(fetch).toHaveBeenCalledTimes(3)
    expect(mockWarning).toHaveBeenCalledWith('GitHub rate limit reached; no retries remaining.')
  })

  it('does not retry a permission error', async () => {
    const fetch = mockFetch.mockResolvedValue(
      response(403, { message: 'Resource not accessible by integration' })
    )
    const { createAnIssue } = await import('../src/action')

    const action = createAnIssue()
    const rejection = expect(action).rejects.toThrow('Resource not accessible by integration')
    await jest.advanceTimersByTimeAsync(10000)
    await rejection

    expect(fetch).toHaveBeenCalledTimes(1)
    expect(mockWarning).not.toHaveBeenCalled()
  })
})
