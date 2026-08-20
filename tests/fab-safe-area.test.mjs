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
 * メンバーを確認 and レポート's 候補を見る each stayed partly under it.
 *
 * The reserve is a spacer whose height has to match the launcher's own offset
 * and size. Those live in three separate rules, so this checks the arithmetic
 * rather than trusting a comment to keep them in step.
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

/** The px floor inside `max(22px, env(...))`, or a bare px value. */
function pxFloor(value) {
  const found = value.match(/(\d+(?:\.\d+)?)px/u);
  assert.ok(found, `no px value in: ${value}`);
  return Number(found[1]);
}

function token(css, name) {
  const found = css.match(new RegExp(`--${name}\\s*:\\s*(\\d+(?:\\.\\d+)?)px`, "u"));
  assert.ok(found, `token --${name} not defined as a px value`);
  return Number(found[1]);
}

test("the reserved area matches the launcher's offset plus its own height", async () => {
  const css = withoutComments(await read());
  const size = pxFloor(declaration(css, "\\.ai-chat-launcher", "height"));
  assert.equal(size, pxFloor(declaration(css, "\\.ai-chat-launcher", "width")), "the launcher should stay circular");

  const resting = pxFloor(declaration(css, "\\.ai-chat-root", "bottom"));
  assert.equal(
    token(css, "fab-safe-area"),
    resting + size,
    `--fab-safe-area should be the launcher's bottom (${resting}px) plus its height (${size}px)`,
  );

  const raised = pxFloor(declaration(css, "\\.change-bar ~ \\.ai-chat-root", "bottom"));
  assert.equal(
    token(css, "fab-safe-area-raised"),
    raised + size,
    `--fab-safe-area-raised should be the raised bottom (${raised}px) plus the height (${size}px)`,
  );
});

test("the reserve is a spacer, not padding that a shorthand can drop", async () => {
  const css = withoutComments(await read());
  // .workspace padding is set by several rules across the breakpoints; a
  // padding-bottom added once would be dropped by any later `padding:`.
  const shorthands = [...css.matchAll(/\.workspace[^{}]*\{[^}]*(?:^|;|\{)\s*padding\s*:/gu)].length;
  assert.ok(shorthands >= 2, `expected several .workspace padding shorthands, found ${shorthands}`);

  assert.match(css, /\.app-shell > \.workspace::after\s*\{[^}]*height:\s*var\(--fab-safe-area\)/u);
  assert.match(css, /\.app-shell > \.workspace::after\s*\{[^}]*content:\s*""/u);
  assert.match(css, /\.app-shell:has\(\.change-bar\) > \.workspace::after\s*\{[^}]*height:\s*var\(--fab-safe-area-raised\)/u);
});
