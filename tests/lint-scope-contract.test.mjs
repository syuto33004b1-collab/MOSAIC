import assert from "node:assert/strict";
import { test } from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ESLint } from "eslint";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * `eslint .` is the only check that walks the whole tree.
 *
 * `tsc` reads `tsconfig.json`'s `include` (`src`, `vite.config.ts`) and vitest reads the
 * tests under `src`, so neither of them ever sees the agents' worktrees. ESLint does, and
 * the worktrees sit at `.claude/worktrees/<name>/` — inside the repository.
 *
 * On main a build in one of them put 1635 errors of minified bundle in front of whoever ran
 * step 8 from the main checkout, and the worktree's `src` was read as well: another
 * session's branch, part-way through a change, reported as this one's (#342).
 *
 * ## Why this asks ESLint rather than reading the config
 *
 * The config on main already said `dist/**`. What was wrong was where that pattern is
 * anchored — flat config resolves it against the config file's own directory, so it matched
 * the top-level `dist` and nothing nested. A test that looked for the string `dist` would
 * have passed on the broken config, so this one asks ESLint what it would actually do.
 *
 * No files are written. A path under `.claude/worktrees/` would collide with a real
 * worktree, and `isPathIgnored` does not need the file to exist.
 */
test("the lint pass reads this checkout's sources and nobody else's", async () => {
  const eslint = new ESLint({ cwd: root });
  const ignored = async (relative) => eslint.isPathIgnored(path.join(root, relative));

  // Build output, wherever it is. The top-level one was already ignored; the nested one is
  // what a worktree leaves behind.
  assert.equal(await ignored("dist/assets/index.js"), true, "the top-level build output stays ignored");
  assert.equal(await ignored(".claude/worktrees/sample/dist/assets/index.js"), true,
    "a worktree's build output is minified bundle, and reading it buried 1635 errors (#342)");

  // The half the `dist` pattern cannot cover: another session's source, mid-change.
  assert.equal(await ignored(".claude/worktrees/sample/src/App.tsx"), true,
    "a worktree's source belongs to whoever is working in it, not to the checkout running the check (#342)");
  assert.equal(await ignored(".claude/worktrees/sample/tests/thing.test.mjs"), true,
    "the same goes for a worktree's tests");

  // And this checkout's own sources are still read, which is the point of the pass.
  for (const kept of ["src/App.tsx", "src/domain.ts", "tests/lint-scope-contract.test.mjs", "eslint.config.mjs"]) {
    assert.equal(await ignored(kept), false, `${kept} must still be linted`);
  }
});
