import * as core from '@actions/core'
import { createAnIssue } from './action'

createAnIssue().catch((err) => {
  core.setFailed(err.message)
})
