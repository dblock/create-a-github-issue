import * as core from '@actions/core'

export interface FrontMatterAttributes {
  title: string
  assignees?: string[] | string
  labels?: string[] | string
  milestone?: string | number
}

export function setOutputs (issue: { number: number, html_url: string }, status: string) {
  core.setOutput('number', String(issue.number))
  core.setOutput('url', issue.html_url)
  core.setOutput('status', status)
}

export function listToArray (list?: string[] | string) {
  if (!list) return []
  return Array.isArray(list) ? list : list.split(', ')
}
