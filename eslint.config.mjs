// ESLint 10 flat config — lints all TypeScript sources and the status-UI script.
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import unicorn from "eslint-plugin-unicorn";

// eslint-plugin-unicorn: these two rules are intentionally left off (the rest of
// the recommended set is enabled).
// - name-replacements: would force mass renames (res→response, ctx→context, m→…)
//   for no real benefit — pure churn against the established naming here.
// - no-null: `null` is deliberate in the scrape/status data shapes; those are
//   serialized to the /api/status feed, where `null` keeps fields explicit
//   whereas `undefined` would drop them from the JSON (changing REQ-UI-2's shape).
const disabledUnicornRules = {
  "unicorn/name-replacements": "off",
  "unicorn/no-null": "off",
};
const customUnicornRules = {
    "unicorn/filename-case": [
        "error",
        {
            case: 'camelCase',
            ignore: [
                "__tests__", // tests directory
            ],
        },
    ],
    "unicorn/prefer-ternary": ["error", "only-single-line"],
}

export default tseslint.config(
  { ignores: ["dist/", "coverage/", "node_modules/"] },
  {
    files: ["**/*.ts"],
    extends: [
      js.configs.recommended,
      ...tseslint.configs.recommended,
      unicorn.configs.recommended,
    ],
    rules: {
      ...disabledUnicornRules,
      ...customUnicornRules,
      // Always require braces around control-statement bodies (no single-line
      // `if (...) stmt;`).
      curly: ["error", "all"],
      // Defer to the type-aware rule below for unused-vars detection.
      // Intentionally-unused bindings get an inline eslint-disable-next-line.
      "no-unused-vars": "off",
      "@typescript-eslint/no-unused-vars": "error",
    },
  },
  {
    // Status-UI script: a classic browser <script> (no bundler/build step) that
    // relies on global Vue/Vuetify UMD builds. Plain JS, not TypeScript.
    files: ["src/web/app.js"],
    extends: [js.configs.recommended],
    languageOptions: {
      sourceType: "script",
      // Vue/Vuetify are declared via the file's inline `/* global */` comment.
      globals: {
        fetch: "readonly",
        setInterval: "readonly",
        clearInterval: "readonly",
      },
    },
    rules: {
      curly: ["error", "all"],
      "no-unused-vars": "error",
    },
  },
);
