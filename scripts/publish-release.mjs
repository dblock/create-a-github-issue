// Publish a built release: commit action.yml and every file in dist/ on top of the
// release commit, then point the release tag and its vX.Y and vX tags at that commit.
// Run from .github/workflows/publish.yml with actions/github-script.
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'

/** List action.yml and every file under dist/, as forward-slash paths relative to the workspace. */
export async function releaseFiles(workspace) {
  const entries = await readdir(path.join(workspace, 'dist'), { recursive: true, withFileTypes: true })
  const dist = entries
    .filter(entry => entry.isFile())
    .map(entry => path.relative(workspace, path.join(entry.parentPath, entry.name)).split(path.sep).join('/'))
    .sort()
  if (!dist.includes('dist/index.js')) throw new Error('dist/index.js is missing; run npm run build first.')
  return ['action.yml', ...dist]
}

/** Return the vX.Y and vX tags for a release tag such as v3.5.1. */
export function floatingTags(tagName) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(tagName)
  if (!match) throw new Error(`Release tag ${tagName} is not a semantic version such as v3.5.1.`)
  return [`v${match[1]}.${match[2]}`, `v${match[1]}`]
}

async function createOrUpdateTag(github, repo, tag, sha) {
  try {
    await github.rest.git.getRef({ ...repo, ref: `tags/${tag}` })
  } catch (error) {
    if (error.status !== 404) throw error
    return github.rest.git.createRef({ ...repo, ref: `refs/tags/${tag}`, sha })
  }
  return github.rest.git.updateRef({ ...repo, ref: `tags/${tag}`, sha, force: true })
}

export default async function publishRelease({ github, context, core, workspace = process.cwd() }) {
  const release = context.payload.release
  const tagName = release.tag_name
  const repo = context.repo
  const files = await releaseFiles(workspace)

  const tree = []
  for (const file of files) {
    const content = (await readFile(path.join(workspace, file))).toString('base64')
    const { data: blob } = await github.rest.git.createBlob({ ...repo, content, encoding: 'base64' })
    tree.push({ path: file, mode: '100644', type: 'blob', sha: blob.sha })
  }
  const { data: createdTree } = await github.rest.git.createTree({ ...repo, tree })
  const { data: commit } = await github.rest.git.createCommit({
    ...repo, message: 'Automatic compilation', tree: createdTree.sha, parents: [context.sha]
  })
  core.info(`Created commit ${commit.sha} with ${files.join(', ')}`)

  await github.rest.git.updateRef({ ...repo, ref: `tags/${tagName}`, sha: commit.sha, force: true })
  core.info(`Updated ${tagName}`)
  if (release.draft || release.prerelease) {
    core.info('Skipping floating tags for a draft or prerelease.')
    return commit.sha
  }
  for (const tag of floatingTags(tagName)) {
    await createOrUpdateTag(github, repo, tag, commit.sha)
    core.info(`Updated ${tag}`)
  }
  return commit.sha
}
