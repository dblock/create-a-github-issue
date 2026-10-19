import { jest, describe, beforeEach, it, expect } from '@jest/globals'

const mockCreateAnIssue = jest.fn<() => Promise<void>>()
const mockError = jest.fn()
const mockSetFailed = jest.fn()

jest.unstable_mockModule('../src/action', () => ({ createAnIssue: mockCreateAnIssue }))
jest.unstable_mockModule('@actions/core', () => ({
  error: mockError,
  setFailed: mockSetFailed
}))

describe('action failure reporting', () => {
  beforeEach(() => {
    jest.resetModules()
    jest.clearAllMocks()
  })

  it('reports failure once while retaining contextual and API error details', async () => {
    const cause = Object.assign(new Error('Validation failed'), {
      errors: [{ resource: 'Issue', field: 'title', code: 'missing_field' }]
    })
    const error = new Error('Could not create issue: Validation failed', { cause })
    mockCreateAnIssue.mockRejectedValueOnce(error)

    await import('../src/index')

    expect(mockSetFailed).toHaveBeenCalledTimes(1)
    expect(mockSetFailed).toHaveBeenCalledWith(error.message)
    expect(mockError).toHaveBeenCalledWith(error)
    expect(mockError).toHaveBeenCalledWith(cause)
    expect(mockError).toHaveBeenCalledWith(JSON.stringify(cause.errors))
  })

  it('reports non-Error rejections explicitly', async () => {
    mockCreateAnIssue.mockRejectedValueOnce('Upload failed')

    await import('../src/index')

    expect(mockSetFailed).toHaveBeenCalledTimes(1)
    expect(mockSetFailed).toHaveBeenCalledWith('Upload failed')
  })
})
