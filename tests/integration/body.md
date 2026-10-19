<!-- action-integration:{{ env.INTEGRATION_KEY }} -->
AI-generated integration test issue for {{ repo.owner }}/{{ repo.repo }}, posted on behalf of @dblock.
Workflow run: [{{ env.GITHUB_RUN_ID }}]({{ env.GITHUB_SERVER_URL }}/{{ env.GITHUB_REPOSITORY }}/actions/runs/{{ env.GITHUB_RUN_ID }})
Phase: {{ env.INTEGRATION_PHASE }}
Year: {{ date | date("YYYY") }}
Filter: {{ env.INTEGRATION_PHASE | upper }}
{% raw %}Literal: {{ not_a_variable }}{% endraw %}
{% include "tests/integration/generated-report.md" %}
