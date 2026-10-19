import * as core from '@actions/core'

export interface FrontMatterAttributes {
  title: string
  type?: string
  assignees?: string[] | string
  labels?: string[] | string
  milestone?: string | number
}

export function validateFrontMatter(attributes: unknown, template: string): asserts attributes is FrontMatterAttributes {
  if (typeof attributes !== 'object' || attributes === null || !('title' in attributes) || typeof attributes.title !== 'string') {
    throw new Error(`The title field in ${template} must be a string.`)
  }
  for (const [field, value] of Object.entries(attributes)) {
    if (value === undefined) continue
    if (['assignees', 'labels'].includes(field)) {
      if (typeof value !== 'string' && !(Array.isArray(value) && value.every(item => typeof item === 'string'))) {
        throw new Error(`The ${field} field in ${template} must be a string or a list of strings.`)
      }
    } else if (field === 'type' && typeof value !== 'string') {
      throw new Error(`The type field in ${template} must be a string.`)
    } else if (field === 'milestone' && typeof value !== 'string' && typeof value !== 'number') {
      throw new Error(`The milestone field in ${template} must be a string or a number.`)
    }
  }
}

export function readBooleanInput(name: string): boolean | null {
  const value = core.getInput(name)
  if (!value) return null
  if (value === 'true') return true
  if (value === 'false') return false
  throw new Error(`Invalid value ${name}=${value}, must be one of true or false`)
}

export type IssueStatus = 'created' | 'updated' | 'found'

export function setOutputs (issue: { number: number, html_url: string }, status: IssueStatus) {
  core.setOutput('number', String(issue.number))
  core.setOutput('url', issue.html_url)
  core.setOutput('status', status)
}

export function listToArray (list?: string[] | string) {
  if (!list) return []
  return Array.isArray(list) ? list : list.split(', ')
}
