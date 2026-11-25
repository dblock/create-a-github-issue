import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["coverage/**", "dist/**", ".nyc_output/**", "node_modules/**"],
  },
  {
    files: ["**/*.{js,mjs}"],
    ...js.configs.recommended,
    languageOptions: {
      globals: globals.node,
    },
  },
  {
    files: ["**/*.ts"],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      globals: globals.node,
    },
  },
  {
    // The shared Jest mocks capture arbitrary Octokit request and response payloads.
    files: ["tests/action-setup.ts"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
);
