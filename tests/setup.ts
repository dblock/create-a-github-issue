import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

Object.assign(process.env, {
  GITHUB_REPOSITORY: 'JasonEtco/waddup',
  GITHUB_ACTION: 'create-a-github-issue',
  GITHUB_EVENT_PATH: path.join(__dirname, 'fixtures', 'event.json'),
  GITHUB_WORKSPACE: path.join(__dirname, 'fixtures')
})
