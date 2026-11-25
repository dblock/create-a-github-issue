import { describe, it, expect } from '@jest/globals'
import * as path from 'path'
import { createAnIssue, params, mockIssuesCreate, mockSearchIssuesAndPullRequests, mockSetOutput, mockUploadArtifact } from './action-setup'

const { defaultArtifactName, parsePatterns } = await import('../src/attachments')

const workspace = process.env.GITHUB_WORKSPACE as string
const artifactUrl = 'https://github.com/JasonEtco/waddup/actions/runs/1234/artifacts/42'

describe('attachments', () => {
  it('uploads matching workspace files as one artifact and exposes it to the template', async () => {
    process.env.INPUT_FILENAME = '.github/attachments.md'
    process.env.INPUT_ATTACHMENTS = 'reports/*.md'
    process.env.INPUT_ATTACHMENTS_NAME = 'nightly-report'

    await createAnIssue()

    expect(mockUploadArtifact).toHaveBeenCalledTimes(1)
    expect(mockUploadArtifact).toHaveBeenCalledWith(
      'nightly-report',
      [path.join(workspace, 'reports', 'details.md'), path.join(workspace, 'reports', 'report.md')],
      path.resolve(workspace)
    )
    expect(params.body).toBe([
      `Results: [nightly-report](${artifactUrl})`,
      '',
      '- reports/details.md',
      '- reports/report.md',
      ''
    ].join('\n'))
    expect(mockSetOutput).toHaveBeenCalledWith('status', 'created')
  })

  it('uses a default artifact name unique to the step', async () => {
    process.env.INPUT_FILENAME = '.github/attachments.md'
    process.env.INPUT_ATTACHMENTS = 'reports/report.md'

    await createAnIssue()

    expect(mockUploadArtifact).toHaveBeenCalledWith('issue-attachments-test-create-a-github-issue-1', [path.join(workspace, 'reports', 'report.md')], path.resolve(workspace))
    expect(params.body).toContain(`[issue-attachments-test-create-a-github-issue-1](${artifactUrl})`)
  })

  it('supports multiple and negated patterns', async () => {
    process.env.INPUT_FILENAME = '.github/attachments.md'
    process.env.INPUT_ATTACHMENTS = '  reports/**\r\n\n!reports/details.md\n.github/attachments.md  '

    await createAnIssue()

    expect(mockUploadArtifact.mock.calls[0][1]).toEqual([
      path.join(workspace, '.github', 'attachments.md'),
      path.join(workspace, 'reports', 'report.md')
    ])
    expect(params.body).toContain('- .github/attachments.md\n- reports/report.md')
  })

  it('does not upload anything without the attachments input', async () => {
    process.env.INPUT_FILENAME = '.github/attachments.md'

    await createAnIssue()

    expect(mockUploadArtifact).not.toHaveBeenCalled()
    expect(params.body).toBe('Results: []()\n\n')
  })

  it('fails before searching or creating issues when no files match', async () => {
    process.env.INPUT_FILENAME = '.github/attachments.md'
    process.env.INPUT_ATTACHMENTS = 'reports/missing-*.log'
    process.env.INPUT_UPDATE_EXISTING = 'true'

    await expect(createAnIssue()).rejects.toThrow('No files matched attachments=reports/missing-*.log')

    expect(mockUploadArtifact).not.toHaveBeenCalled()
    expect(mockSearchIssuesAndPullRequests).not.toHaveBeenCalled()
    expect(mockIssuesCreate).not.toHaveBeenCalled()
    expect(mockSetOutput).not.toHaveBeenCalled()
  })

  it('rejects files outside the workspace', async () => {
    process.env.INPUT_FILENAME = '.github/attachments.md'
    process.env.INPUT_ATTACHMENTS = '../setup.ts'

    await expect(createAnIssue()).rejects.toThrow(`Attachments must be inside the workspace ${path.resolve(workspace)}`)

    expect(mockUploadArtifact).not.toHaveBeenCalled()
    expect(mockIssuesCreate).not.toHaveBeenCalled()
  })

  it('reports upload failures with the artifact name and original error', async () => {
    process.env.INPUT_FILENAME = '.github/attachments.md'
    process.env.INPUT_ATTACHMENTS = 'reports/report.md'
    process.env.INPUT_ATTACHMENTS_NAME = 'nightly-report'
    const cause = new Error('Conflict: an artifact with this name already exists on the workflow run')
    mockUploadArtifact.mockRejectedValueOnce(cause)

    const error = await createAnIssue().catch((err: unknown) => err)

    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toBe(`An error occurred while uploading attachments as artifact nightly-report.\n\n${cause.message}`)
    expect((error as Error).cause).toBe(cause)
    expect(mockIssuesCreate).not.toHaveBeenCalled()
    expect(mockSetOutput).not.toHaveBeenCalled()
  })

  it('accepts absolute patterns inside the workspace', async () => {
    process.env.INPUT_FILENAME = '.github/attachments.md'
    process.env.INPUT_ATTACHMENTS = path.join(workspace, 'reports', 'report.md')

    await createAnIssue()

    expect(mockUploadArtifact.mock.calls[0][1]).toEqual([path.join(workspace, 'reports', 'report.md')])
    expect(params.body).toContain('- reports/report.md')
  })

  it('reports non-Error upload rejections', async () => {
    process.env.INPUT_FILENAME = '.github/attachments.md'
    process.env.INPUT_ATTACHMENTS = 'reports/report.md'
    process.env.INPUT_ATTACHMENTS_NAME = 'nightly-report'
    mockUploadArtifact.mockRejectedValueOnce('Service unavailable')

    await expect(createAnIssue()).rejects.toThrow('An error occurred while uploading attachments as artifact nightly-report.\n\nService unavailable')
  })

  it('fails when the upload returns no artifact ID', async () => {
    process.env.INPUT_FILENAME = '.github/attachments.md'
    process.env.INPUT_ATTACHMENTS = 'reports/report.md'
    process.env.INPUT_ATTACHMENTS_NAME = 'nightly-report'
    mockUploadArtifact.mockResolvedValueOnce({})

    await expect(createAnIssue()).rejects.toThrow('Uploading attachments as artifact nightly-report did not return an artifact ID.')
    expect(mockIssuesCreate).not.toHaveBeenCalled()
  })
})

describe('parsePatterns', () => {
  it('splits newline-separated patterns and keeps commas inside patterns', () => {
    expect(parsePatterns(' a.log \r\n\n{b,c}.md\n')).toEqual(['a.log', '{b,c}.md'])
    expect(parsePatterns('')).toEqual([])
  })
})

describe('defaultArtifactName', () => {
  it('combines the job, step, and run attempt and replaces characters artifacts reject', () => {
    expect(defaultArtifactName({ GITHUB_JOB: 'report', GITHUB_ACTION: '__dblock_create-a-github-issue', GITHUB_RUN_ATTEMPT: '2' }))
      .toBe('issue-attachments-report-__dblock_create-a-github-issue-2')
    expect(defaultArtifactName({ GITHUB_JOB: 'a/b', GITHUB_ACTION: 'c:d' })).toBe('issue-attachments-a-b-c-d')
    expect(defaultArtifactName({})).toBe('issue-attachments')
  })
})
