import globals from "globals";
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";

export default tseslint.config(
  {
    ignores: ["**/dist/**", "**/node_modules/**", "**/.terraform/**", "**/*.tsbuildinfo"],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  // Cloud Function sources are ESM Node modules deployed straight to GCP
  // — not part of the workspace TS build. Give them Node globals so
  // `process` / `console` / `Buffer` don't trip no-undef.
  {
    files: ["infra/**/functions/**/*.js"],
    languageOptions: {
      sourceType: "module",
      globals: { ...globals.node },
    },
  },
  prettier,
);
