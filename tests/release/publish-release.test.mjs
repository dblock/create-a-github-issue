import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import publishRelease, { floatingTags, releaseFiles } from '../../scripts/publish-release.mjs'

async function workspace(files) {
  const root = await mkdtemp(path.join(tmpdir(), 'publish-release-'))
  for (const [file, content] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(root, file)), { recursive: true })
    await writeFile(path.join(root, file), content)
  }
  return root
}

function fakeGitHub(existingTags = []) {
  const calls = []
  const record = (name, result) => async params => {
    calls.push([name, params])
    return { data: typeof result === 'function' ? result(params) : result }
  }
  const github = {
    rest: {
      git: {
        createBlob: record('createBlob', params => ({ sha: `blob-${Buffer.from(params.content, 'base64').toString()}` })),
        createTree: record('createTree', { sha: 'tree-sha' }),
        createCommit: record('createCommit', { sha: 'commit-sha' }),
        updateRef: record('updateRef', {}),
        createRef: record('createRef', {}),
        getRef: async params => {
          calls.push(['getRef', params])
          if (existingTags.includes(params.ref)) return { data: {} }
          throw Object.assign(new Error('Not Found'), { status: 404 })
        }
      }
    }
  }
  return { github, calls }
}

const core = { info: () => {} }
const repo = { owner: 'dblock', repo: 'create-a-github-issue' }
const files = {
  'action.yml': 'name: test',
  'dist/index.js': 'index',
  'dist/835.index.js': 'chunk',
  'dist/package.json': '{"type":"module"}',
  'src/index.ts': 'not published'
}

test('commits action.yml and every dist file, then moves the release and floating tags', async t => {
  const root = await workspace(files)
  t.after(() => rm(root, { recursive: true, force: true }))
  const { github, calls } = fakeGitHub(['tags/v3'])
  const context = { repo, sha: 'release-sha', payload: { release: { tag_name: 'v3.6.0', draft: false, prerelease: false } } }

  assert.equal(await publishRelease({ github, context, core, workspace: root }), 'commit-sha')

  const tree = calls.find(([name]) => name === 'createTree')[1]
  assert.deepEqual(tree.tree.map(entry => [entry.path, entry.sha]), [
    ['action.yml', 'blob-name: test'],
    ['dist/835.index.js', 'blob-chunk'],
    ['dist/index.js', 'blob-index'],
    ['dist/package.json', 'blob-{"type":"module"}']
  ])
  assert.equal(tree.base_tree, undefined)
  assert.deepEqual(calls.find(([name]) => name === 'createCommit')[1], {
    ...repo, message: 'Automatic compilation', tree: 'tree-sha', parents: ['release-sha']
  })
  assert.deepEqual(calls.filter(([name]) => ['updateRef', 'createRef'].includes(name)), [
    ['updateRef', { ...repo, ref: 'tags/v3.6.0', sha: 'commit-sha', force: true }],
    ['createRef', { ...repo, ref: 'refs/tags/v3.6', sha: 'commit-sha' }],
    ['updateRef', { ...repo, ref: 'tags/v3', sha: 'commit-sha', force: true }]
  ])
})

test('moves only the release tag for drafts and prereleases', async t => {
  const root = await workspace(files)
  t.after(() => rm(root, { recursive: true, force: true }))
  for (const release of [{ draft: true }, { prerelease: true }]) {
    const { github, calls } = fakeGitHub()
    const context = { repo, sha: 'release-sha', payload: { release: { tag_name: 'v4.0.0-rc.1', ...release } } }
    await publishRelease({ github, context, core, workspace: root })
    assert.deepEqual(calls.filter(([name]) => ['updateRef', 'createRef', 'getRef'].includes(name)), [
      ['updateRef', { ...repo, ref: 'tags/v4.0.0-rc.1', sha: 'commit-sha', force: true }]
    ])
  }
})

test('fails before writing anything when the build output is missing', async t => {
  const root = await workspace({ 'action.yml': 'name: test', 'dist/package.json': '{}' })
  t.after(() => rm(root, { recursive: true, force: true }))
  const { github, calls } = fakeGitHub()
  const context = { repo, sha: 'release-sha', payload: { release: { tag_name: 'v3.6.0' } } }
  await assert.rejects(publishRelease({ github, context, core, workspace: root }), /dist\/index\.js is missing/)
  assert.deepEqual(calls, [])
})

test('surfaces tag lookup errors other than a missing tag', async t => {
  const root = await workspace(files)
  t.after(() => rm(root, { recursive: true, force: true }))
  const { github } = fakeGitHub()
  github.rest.git.getRef = async () => { throw Object.assign(new Error('Server Error'), { status: 500 }) }
  const context = { repo, sha: 'release-sha', payload: { release: { tag_name: 'v3.6.0' } } }
  await assert.rejects(publishRelease({ github, context, core, workspace: root }), /Server Error/)
})

test('lists release files and derives floating tags', async t => {
  const root = await workspace(files)
  t.after(() => rm(root, { recursive: true, force: true }))
  assert.deepEqual(await releaseFiles(root), ['action.yml', 'dist/835.index.js', 'dist/index.js', 'dist/package.json'])
  assert.deepEqual(floatingTags('v3.5.1'), ['v3.5', 'v3'])
  assert.deepEqual(floatingTags('10.2.0'), ['v10.2', 'v10'])
  assert.throws(() => floatingTags('latest'), /not a semantic version/)
})
