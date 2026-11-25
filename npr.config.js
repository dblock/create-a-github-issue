import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import process from "node:process";
import { GitHubAction, HookValidator, IntrideaChangelog, ReleaseWorkflow } from "npm-package-release";

export default new ReleaseWorkflow({
  changelog: new IntrideaChangelog("CHANGELOG.md", { placeholder: "* Your contribution here." }),
  project: new GitHubAction({ build: ["npm", "run", "build"], output: ["dist"], name: "create-a-github-issue" }),
  publisher: null,
  floatingTags: ["major", "minor"],
  validator: new HookValidator({
    // Run the released entry point without a token: it must load and reject an invalid input before any API request.
    async validateArtifact({ consumer }) {
      const result = spawnSync(process.execPath, ["dist/index.js"], {
        cwd: consumer,
        encoding: "utf8",
        env: { PATH: process.env.PATH, GITHUB_REPOSITORY: "owner/repo", INPUT_SEARCH_EXISTING: "invalid" },
      });
      assert.equal(result.status, 1, result.stderr);
      assert.match(result.stdout, /Invalid value search_existing=invalid/u);
    },
  }),
});
