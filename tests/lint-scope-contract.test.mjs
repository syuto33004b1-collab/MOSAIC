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
 * the top-level `dist` and nothing deeper. A test that looked for the string `dist` would
 * have passed on the broken config, so this one asks ESLint what it would actually do.
 *
 * ## What it claims
 *
 * That a worktree's files are out of scope, whatever is in them, and that this checkout's
 * own are not. It does not claim anything about `dist` at other depths: one entry covers
 * both halves of #342, and a wider pattern would be a promise nothing here has asked for.
 *
 * `false` here means the path is not ignored, which is not quite the same as `eslint .`
 * enumerating it — that also depends on the extensions the config names.
 *
 * No files are written. A path under `.claude/worktrees/` would collide with a real
 * worktree, and `isPathIgnored` does not need the file to exist.
 */
test("the lint pass reads this checkout's sources and nobody else's", async () => {
  const eslint = new ESLint({ cwd: root });
  const ignored = async (relative) => eslint.isPathIgnored(path.join(root, relative));

  // Everything under a worktree, both halves of it. The build output is what produced the
  // 1635 errors; the source is what nobody noticed, because it passed.
  assert.equal(await ignored(".claude/worktrees/sample/dist/assets/index.js"), true,
    "a worktree's build output is minified bundle, and reading it buried 1635 errors (#342)");
  assert.equal(await ignored(".claude/worktrees/sample/src/App.tsx"), true,
    "a worktree's source belongs to whoever is working in it, not to the checkout running the check (#342)");
  assert.equal(await ignored(".claude/worktrees/sample/tests/thing.test.mjs"), true,
    "the same goes for a worktree's tests");

  // The top-level build output, which was already out and stays out.
  assert.equal(await ignored("dist/assets/index.js"), true, "the top-level build output stays ignored");

  // And this checkout's own files are still in scope, which is the point of the pass.
  for (const kept of ["src/App.tsx", "src/domain.ts", "tests/lint-scope-contract.test.mjs", "eslint.config.mjs"]) {
    assert.equal(await ignored(kept), false, `${kept} must remain unignored`);
  }
});
