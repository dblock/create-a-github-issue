<h3 align="center">Create an Issue Action</h3>
<p align="center">A GitHub Action that creates a new issue using a template file.<p>
<p align="center"><a href="https://github.com/dblock/create-a-github-issue"><img alt="GitHub Actions status" src="https://github.com/dblock/create-a-github-issue/workflows/Node%20CI/badge.svg"></a> <a href="https://codecov.io/gh/dblock/create-a-github-issue/"><img src="https://codecov.io/gh/dblock/create-a-github-issue/branch/main/graph/badge.svg?token=9wHcESNsRI" alt="Codecov"></a></p>

- [Fork](#fork)
- [Usage](#usage)
  - [Dates](#dates)
  - [Escaping template content](#escaping-template-content)
  - [Issue types](#issue-types)
  - [Projects](#projects)
  - [Custom templates](#custom-templates)
  - [Including workspace files](#including-workspace-files)
  - [Inputs](#inputs)
  - [Outputs](#outputs)

## Fork

This is a maintained fork of [JasonEtco/create-an-issue](https://github.com/JasonEtco/create-an-issue). See [CHANGELOG](CHANGELOG.md) for fixes and features.

## Usage

This GitHub Action creates a new issue based on an issue template file. Here's an example workflow that creates a new issue any time you push a commit:

```yaml
# .github/workflows/issue-on-push.yml
on: [push]
name: Create an issue on push
permissions:
  contents: read
  issues: write 
jobs:
  stuff:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: dblock/create-a-github-issue@v3
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

This reads from the `.github/ISSUE_TEMPLATE.md` file. This file should have front matter to help construct the new issue:

```markdown
---
title: Someone just pushed
assignees: JasonEtco, matchai
labels: bug, enhancement
---
Someone just pushed, oh no! Here's who did it: {{ payload.sender.login }}.
```

You'll notice that the above example has some `{{ mustache }}` variables. Your issue templates have access to several things about the event that triggered the action. Besides `issue` and `pullRequest`, you have access to all the template variables [on this list](https://github.com/JasonEtco/actions-toolkit#toolscontext). You can also use environment variables:

```yaml
- uses: dblock/create-a-github-issue@v3
  env:
    GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
    ADJECTIVE: great
```

```markdown
Environment variables are pretty {{ env.ADJECTIVE }}, right?
```

Assignees support the same template variables and filters, in both front matter and the `assignees` input. Front matter accepts a comma-separated string or a YAML list. Quote template expressions so they are valid YAML:

```markdown
---
title: Follow up
assignees: "{{ env.ASSIGNEE }}, {{ repo.owner }}"
---
Please follow up on this issue.
```

The `assignees` input takes precedence over front matter, for example `assignees: "{{ env.ASSIGNEE }}"`. Set `ASSIGNEE` in the workflow's `env` block to the GitHub username to assign.

Note that you can only assign people matching given [conditions](https://help.github.com/en/github/managing-your-work-on-github/assigning-issues-and-pull-requests-to-other-github-users).

GitHub API requests automatically retry up to twice when a primary or secondary rate limit is reached. The action logs each retry and waits until the primary limit resets or for the secondary limit's `Retry-After` delay (60 seconds if no delay is provided). If retries are exhausted, the action fails; permission errors are not retried.

### Dates

Additionally, you can use the `date` filter and variable to show some information about when this issue was created:

```markdown
---
title: Weekly Radar {{ date | date('dddd, MMMM Do') }}
---
What's everyone up to this week?
```

This example will create a new issue with a title like **Weekly Radar Saturday, November 10th**. You can pass any valid [Moment.js formatting string](https://momentjs.com/docs/#/displaying/) to the filter.

### Escaping template content

The action parses YAML front matter first, then renders the body and templated front matter fields with Nunjucks. YAML quoting and Nunjucks escaping solve different problems.

#### YAML front matter

A title beginning with a backtick must be quoted to be valid YAML:

```yaml
title: "`light-the-torch` is out of sync"
```

The surrounding YAML quotes are not included in the issue title. Quoting a value does not prevent Nunjucks expressions inside it from being rendered.

#### Literal Nunjucks syntax

Nunjucks interprets `{{` as the start of an expression, even inside Markdown backticks or code fences. To include literal template syntax in the issue body, wrap it in a raw block:

```text
{% raw %}
Example syntax: {{ value }}
{% endraw %}
```

The raw tags are omitted from the issue body, and their contents are preserved literally rather than interpolated. Raw blocks affect Nunjucks rendering only; front matter must still be valid YAML.

### Issue types

Set `type` in front matter to associate a new issue with an issue type available in the repository's organization:

```markdown
---
title: Something is broken
type: Bug
---
Describe the bug here.
```

The type name also supports template variables and filters, for example `type: "{{ env.ISSUE_TYPE }}"`. If no type is specified, the action omits it from the request. Updating an existing issue leaves its type unchanged. GitHub requires push access to set an issue's type and may silently ignore it without that access; see [Create an issue](https://docs.github.com/en/rest/issues/issues#create-an-issue).

### Projects

Set `projects` in front matter to the URL of an organization- or user-owned Projects v2 project:

```markdown
---
title: Follow up
projects: https://github.com/orgs/my-organization/projects/7
---
Please follow up on this issue.
```

To add an issue to multiple projects, use a YAML list instead of a single URL:

```yaml
projects:
  - https://github.com/orgs/my-organization/projects/7
  - https://github.com/users/octocat/projects/3
```

User project URLs such as `https://github.com/users/octocat/projects/7` and project view URLs ending in `/views/1` are also supported. Each URL supports template variables and filters, for example `projects: "{{ env.PROJECT_URL }}"` or a quoted expression in a list. On GitHub Enterprise Server, use URLs on the server identified by `GITHUB_SERVER_URL`. Classic repository projects are not supported.

The action adds newly created and matched existing issues to every listed project. This includes matches found with `update_existing: false`: the issue body is left unchanged, but project membership is still applied. Adding an issue already in a project reuses its existing project item. The action does not explicitly change project fields such as Status; each project's own workflows may apply their configured defaults.

Set `GITHUB_TOKEN` to a token with access to both the destination repository and every listed project. The workflow's default `GITHUB_TOKEN` does not have the organization/user project permissions needed here. For a classic personal access token, grant the `project` scope and repository access as needed; an appropriately permissioned GitHub App token can also be used. See [Using the API to manage Projects](https://docs.github.com/en/issues/planning-and-tracking-with-projects/automating-your-project/using-the-api-to-manage-projects).

Every project is resolved before issue creation or updates. Invalid URLs and inaccessible projects fail the action. Membership is then added in list order through separate API operations: if an addition fails, the action fails without rolling back issue changes or earlier successful additions. Output statuses remain `created`, `updated`, or `found` and are set only after all project memberships succeed.

### Custom templates

Don't want to use `.github/ISSUE_TEMPLATE.md`? You can pass an input pointing the action to a different template:

```yaml
steps:
  - uses: actions/checkout@v3
  - uses: dblock/create-a-github-issue@v3
    env:
      GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
    with:
      filename: .github/some-other-template.md
```

### Including workspace files

Use Nunjucks' `include` tag to add a file from the workspace to the issue body. For example, generate `reports/report.md` in an earlier step:

```yaml
steps:
  - uses: actions/checkout@v3
  - name: Generate report
    run: |
      mkdir -p reports
      printf '# Build report\nAll checks passed.\n' > reports/report.md
  - uses: dblock/create-a-github-issue@v3
    env:
      GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
    with:
      filename: .github/report-issue.md
```

Then reference that file in `.github/report-issue.md`:

```markdown
---
title: Build report
---
Results for {{ repo.owner }}/{{ repo.repo }}:

{% include "reports/report.md" %}
```

Include paths are relative to `GITHUB_WORKSPACE`, or the current working directory if that variable is unset, not the issue template's directory. Within an included file, paths beginning with `./` or `../` resolve relative to that file.

Included files are rendered as Nunjucks templates with the same variables and filters as the main template. To preserve literal `{{ ... }}` in a report, wrap that content in `{% raw %}` and `{% endraw %}` inside the included file. Only the main template's YAML front matter is parsed; any front matter in an included file becomes part of the body.

A missing included file fails the action before any issue is created or updated. File contents are published in the issue body, so include only files intended for that audience and keep GitHub's issue body size limit in mind.

### Inputs

Want to use Action logic to determine who to assign the issue to, to assign a milestone or to update an existing issue with the same title? You can pass an input containing the following options:

```yaml
steps:
  - uses: actions/checkout@v3
  - uses: dblock/create-a-github-issue@v3
    env:
      GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
    with:
      repo: owner/other-repository
      assignees: JasonEtco, octocat
      milestone: 1
      update_existing: true
      reopen_existing: true
      search_existing: all
```

* The `repo` input selects the repository to create, search for, and update issues in, in `owner/repo` format. It defaults to the workflow repository. For another repository, set `GITHUB_TOKEN` to a token with access to that repository and permission to write issues; the workflow's default token is normally limited to its own repository. Template variables such as `repo` and `env.GITHUB_REPOSITORY` still describe the workflow repository.
* The `assignees` and `milestone` speak for themselves.
* The `update_existing` param can be passed and set to `true` when you want to update an open issue with the **exact same title** when it exists and `false` if you don't want to create a new issue, but skip updating an existing one.
* The `reopen_existing` param defaults to `false`. Set it to `true` with `update_existing: true` and `search_existing: all` (or `closed`) to reopen a matched closed issue while updating its body. It does not reopen issues when updates are disabled. The output status remains `updated`.
* The `search_existing` param lets you specify whether to search `open`, `closed`, or `all` existing issues for duplicates (default is `open`).

Duplicate detection uses the fully rendered title as a quoted search phrase, escaping embedded quotes and backslashes. It compares titles exactly, including case and punctuation, across available result pages and stops at the first exact match. If no exact match is found and GitHub reports incomplete results or more than its 1,000-result search limit, the action fails rather than risk creating a duplicate. Newly created issues may not appear immediately because GitHub search indexing is asynchronous.

### Outputs

If you need the number or URL of the issue that was created or updated for another Action, you can use the `number`, `url` and `status` outputs, respectively. For example:

```yaml
steps:
  - uses: dblock/create-a-github-issue@v3
    env:
      GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
    id: create-issue
  - run: 'echo number: ${{ steps.create-issue.outputs.number }}'
  - run: 'echo status: ${{ steps.create-issue.outputs.status }}'
  - run: 'echo url: ${{ steps.create-issue.outputs.url }}'
```

* The `number` and `url` outputs speak for themselves.
* The `status` is one of `created`, `updated` or `found`.
