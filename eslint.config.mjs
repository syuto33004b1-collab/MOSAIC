import { defineConfig, globalIgnores } from "eslint/config";
import eslint from "@eslint/js";
import jsxA11y from "eslint-plugin-jsx-a11y";
import react from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

export default defineConfig([
  /*
   * Anchored patterns only match at the top, and the agents' worktrees live at
   * `.claude/worktrees/<name>/`. A build in one of those put 1635 errors of minified bundle
   * in front of whoever ran the checks from the main checkout, and the worktree's `src` was
   * being read too — another session's branch, mid-change, reported as this one's (#342).
   */
  globalIgnores(["**/dist/**", "**/node_modules/**", "**/coverage/**", ".claude/worktrees/**"]),
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  react.configs.flat.recommended,
  react.configs.flat["jsx-runtime"],
  reactHooks.configs.flat["recommended-latest"],
  jsxA11y.flatConfigs.recommended,
  {
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    settings: {
      react: { version: "detect" },
    },
  },
]);
