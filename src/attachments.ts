import * as core from '@actions/core'
import * as github from '@actions/github'
import { DefaultArtifactClient } from '@actions/artifact'
import * as glob from '@actions/glob'
import * as path from 'path'

export interface Attachments {
  /** Name of the uploaded workflow artifact. */
  name: string
  /** Link to the artifact on the workflow run page. */
  url: string
  /** Uploaded files, relative to the workspace, with forward slashes. */
  files: string[]
}

/** Parse newline-separated glob patterns, ignoring blank lines and surrounding whitespace. */
export function parsePatterns(input: string): string[] {
  return input.split(/\r?\n/).map(pattern => pattern.trim()).filter(Boolean)
}

/** Resolve relative patterns, including negated ones, against the workspace. */
function resolvePattern(pattern: string, workspace: string) {
  const negated = pattern.startsWith('!')
  const value = negated ? pattern.slice(1) : pattern
  const resolved = path.isAbsolute(value) ? value : path.join(workspace, value)
  return negated ? `!${resolved}` : resolved
}

/** A default artifact name that is unique for each action step and run attempt. */
export function defaultArtifactName(env: NodeJS.ProcessEnv = process.env) {
  return ['issue-attachments', env.GITHUB_JOB, env.GITHUB_ACTION, env.GITHUB_RUN_ATTEMPT]
    .filter(Boolean)
    .join('-')
    .replace(/[":<>|*?\\/\r\n]/g, '-')
}

/**
 * Upload the workspace files matching the attachments input as one workflow artifact.
 * Returns undefined when the input is empty.
 */
export async function uploadAttachments(input: string, name: string, workspace: string): Promise<Attachments | undefined> {
  const patterns = parsePatterns(input)
  if (!patterns.length) return undefined

  const globber = await glob.create(patterns.map(pattern => resolvePattern(pattern, workspace)).join('\n'), {
    matchDirectories: false
  })
  const matches = (await globber.glob()).sort()
  const root = path.resolve(workspace)
  const outside = matches.filter(file => path.relative(root, file).startsWith('..') || path.isAbsolute(path.relative(root, file)))
  if (outside.length) {
    throw new Error(`Attachments must be inside the workspace ${root}: ${outside.join(', ')}`)
  }
  if (!matches.length) {
    throw new Error(`No files matched attachments=${patterns.join(', ')}`)
  }

  const artifactName = name || defaultArtifactName()
  core.info(`Uploading ${matches.length} attachment(s) as artifact ${artifactName}`)
  let id: number | undefined
  try {
    ({ id } = await new DefaultArtifactClient().uploadArtifact(artifactName, matches, root))
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    throw new Error(`An error occurred while uploading attachments as artifact ${artifactName}.\n\n${message}`, { cause: err })
  }
  if (!id) throw new Error(`Uploading attachments as artifact ${artifactName} did not return an artifact ID.`)

  const { serverUrl, runId, repo } = github.context
  return {
    name: artifactName,
    url: `${serverUrl}/${repo.owner}/${repo.repo}/actions/runs/${runId}/artifacts/${id}`,
    files: matches.map(file => path.relative(root, file).split(path.sep).join('/'))
  }
}
