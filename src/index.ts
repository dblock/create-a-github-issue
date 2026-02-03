import * as core from '@actions/core'
import { createAnIssue } from './action'

async function run() {
  try {
    await createAnIssue()
  } catch (error: any) {
    core.setFailed(error.message)
  }
}

run()
