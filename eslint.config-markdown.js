import markdown from "@eslint/markdown";
import preferences from "eslint-plugin-markdown-preferences";
import paragraph from "eslint-plugin-markdown-preferences-paragraph";
import proseSpellcheck from "eslint-plugin-prose-spellcheck";

export default [
  {
    files: ["*.md"],
    plugins: {
      markdown,
      "markdown-preferences": preferences,
      paragraph,
      "prose-spellcheck": proseSpellcheck,
    },
    language: "markdown/gfm",
    rules: {
      ...markdown.configs.recommended[0].rules,
      ...preferences.configs.standard.rules,
      "markdown/no-bare-urls": "error",
      "markdown-preferences/heading-casing": ["error", {
        style: "Title Case",
        preserveWords: ["GitHub", "JavaScript", "TypeScript", "Nunjucks", "API", "CI", "YAML"],
      }],
      "paragraph/wrap": ["error", { width: "nowrap" }],
      "prose-spellcheck/spellcheck": ["error", {
        dictionaries: ["@cspell/dict-en_us", "@cspell/dict-software-terms", "./.spellcheck.txt"],
        baseDir: import.meta.dirname,
      }],
    },
  },
  {
    // Keep the established "*" changelog entry format and leave released sections unchanged.
    files: ["CHANGELOG.md"],
    rules: {
      "markdown-preferences/bullet-list-marker-style": "off",
      "markdown-preferences/padding-line-between-blocks": "off",
    },
  },
];
