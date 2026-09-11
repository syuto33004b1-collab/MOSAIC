import { defineConfig, globalIgnores } from "eslint/config";
import eslint from "@eslint/js";
import jsxA11y from "eslint-plugin-jsx-a11y";
import react from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

export default defineConfig([
  // The worktrees are the fourth entry. These patterns resolve against this file's own
  // directory, so the first one is the top-level build output and nothing deeper — and the
  // agents' worktrees live at `.claude/worktrees/<name>/`, inside the repository. A build in
  // one of them put 1635 errors of minified bundle in front of whoever ran the checks from
  // the main checkout, and the worktree's `src` was being read as well: another session's
  // branch, part-way through a change, reported as this one's (#342).
  //
  // Ignoring the worktrees covers both halves, so the other three stay as they are. A
  // recursive build-output pattern would be a wider promise than anything here has asked
  // for. Line comments, because a glob starting with two stars closes a block one.
  globalIgnores(["dist/**", "node_modules/**", "coverage/**", ".claude/worktrees/**"]),
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
