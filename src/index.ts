import * as core from '@actions/core'
import { createAnIssue } from './action'

createAnIssue().catch((err: unknown) => {
  let detail = err
  while (detail !== undefined) {
    core.error(detail instanceof Error ? detail : String(detail))
    if (typeof detail === 'object' && detail !== null && 'errors' in detail) {
      core.error(JSON.stringify(detail.errors))
    }
    detail = detail instanceof Error ? detail.cause : undefined
  }
  core.setFailed(err instanceof Error ? err.message : String(err))
})
