import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * The chat launcher is fixed to the bottom-right corner, so whatever sits under
 * it at the end of the page cannot be scrolled clear. Measured before the fix,
 * at the very bottom of each screen: 組織's 削除 button, スキルマップ's
 * メンバーを確認 and レポート's 候補を見る each stayed partly underneath.
 *
 * The reserve has to track the launcher's offset and size. The first attempt
 * hard-coded 78px, which silently under-reserved on a device whose
 * env(safe-area-inset-bottom) exceeds 22px. So both now read the same tokens,
 * and this file checks that they do — there is no arithmetic left to drift.
 *
 * ## What this cannot do
 *
 * It reads declarations from source. A later rule, a media query, or a
 * specificity win could change the effective value where this cannot see it,
 * and it says nothing about rendered geometry. Overlap is measured by hand
 * against the running app and recorded in the PR.
 */

const read = () => readFile(path.join(root, "src", "styles.css"), "utf8");
const withoutComments = (css) => css.replace(/\/\*[\s\S]*?\*\//gu, "");

function declaration(css, selector, property) {
  const rule = css.match(new RegExp(`${selector}\\s*\\{([^}]*)\\}`, "u"));
  assert.ok(rule, `rule not found: ${selector}`);
  const found = rule[1].match(new RegExp(`(?:^|;)\\s*${property}\\s*:\\s*([^;]+)`, "u"));
  assert.ok(found, `${selector} has no ${property}`);
  return found[1].trim();
}

test("the launcher's geometry comes from tokens, not literals", async () => {
  const css = withoutComments(await read());
  for (const name of ["fab-size", "fab-inset", "fab-inset-raised", "fab-clearance"]) {
    assert.match(css, new RegExp(`--${name}\\s*:`, "u"), `token --${name} is not defined`);
  }
  assert.equal(declaration(css, "\\.ai-chat-root", "bottom"), "var(--fab-inset)");
  assert.equal(declaration(css, "\\.change-bar ~ \\.ai-chat-root", "bottom"), "var(--fab-inset-raised)");
  assert.equal(declaration(css, "\\.ai-chat-launcher", "width"), "var(--fab-size)");
  assert.equal(declaration(css, "\\.ai-chat-launcher", "height"), "var(--fab-size)");
});

test("the reserve is derived from the same tokens the launcher uses", async () => {
  const css = withoutComments(await read());
  const resting = declaration(css, "\\.app-shell > \\.workspace::after", "height");
  for (const part of ["var(--fab-inset)", "var(--fab-size)", "var(--fab-clearance)"]) {
    assert.ok(resting.includes(part), `the reserve must include ${part}, got: ${resting}`);
  }
  const raised = declaration(css, "\\.app-shell:has\\(> \\.change-bar\\) > \\.workspace::after", "height");
  assert.ok(raised.includes("var(--fab-inset-raised)"), `the raised reserve must use the raised inset, got: ${raised}`);
  assert.ok(raised.includes("var(--fab-size)"), `the raised reserve must include the launcher height, got: ${raised}`);
});

test("the reserve is a spacer, not padding that a shorthand can drop", async () => {
  const css = withoutComments(await read());
  // .workspace padding is set by several rules across the breakpoints; a
  // padding-bottom added once would be dropped by any later `padding:`.
  const shorthands = [...css.matchAll(/\.workspace[^{}]*\{[^}]*(?:^|;|\{)\s*padding\s*:/gu)].length;
  assert.ok(shorthands >= 2, `expected several .workspace padding shorthands, found ${shorthands}`);
  assert.match(css, /\.app-shell > \.workspace::after\s*\{[^}]*content:\s*""/u);
  assert.match(css, /\.app-shell > \.workspace::after\s*\{[^}]*display:\s*block/u);
});

test("print drops the reserve wherever it drops the launcher", async () => {
  const css = withoutComments(await read());
  const printBlocks = [...css.matchAll(/@media print\s*\{([\s\S]*?)\n\}/gu)].map((m) => m[1]);
  const hidingLauncher = printBlocks.filter((b) => /\.ai-chat-root\s*\{[^}]*display:\s*none/u.test(b));
  assert.ok(hidingLauncher.length >= 1, "expected a print block that hides the launcher");
  for (const block of hidingLauncher) {
    assert.match(
      block,
      /\.workspace::after\s*\{[^}]*display:\s*none/u,
      "a print block that hides the launcher must hide the reserve too, or it prints as blank space",
    );
  }
});
