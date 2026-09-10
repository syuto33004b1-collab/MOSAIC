import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * #256: the board's search box is 238px the topbar row does not have between 621
 * and 900px, and the row paid for it out of the title — the eyebrow broke inside
 * 「第1週」 and the button inside 「アサインを追加」 (measured at 816px; at 700px the
 * label stood 66px tall in a 44px box). The bar now stacks while the box is out,
 * and the two labels refuse to break inside a word at the widths that stay a row.
 *
 * ## What this cannot do
 *
 * It reads declarations. Whether the stacked bar fits, and where the row starts
 * fitting again, were measured at 621, 660, 700, 816, 885, 900, 901, 935 and
 * 1285px and are in the PR. This pins the three rules the measurement relied on,
 * so that dropping any one of them fails here rather than at the next sweep.
 */

const read = async () => (await readFile(path.join(root, "src", "styles.css"), "utf8")).replaceAll("\r\n", "\n");
const withoutComments = (css) => css.replace(/\/\*[\s\S]*?\*\//gu, "");
const baseLayer = (css) => css.replace(/@(?:media|container)[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/gu, "");

function rule(css, selector) {
  const m = css.match(new RegExp(`(?:^|\\})\\s*${selector}\\s*\\{([^}]*)\\}`, "u"));
  return m ? m[1] : null;
}

/** Every `@media (max-width: <px>)` block whose upper bound is `px`, bodies joined. */
function mediaBlocks(css, px) {
  return [...css.matchAll(new RegExp(`@media\\s*\\(max-width:\\s*${px}px\\)\\s*\\{((?:[^{}]*\\{[^{}]*\\})*[^{}]*)\\}`, "gu"))].map((m) => m[1]).join("\n");
}

test("the bar stacks while the search box is out, below the width where the row fits", async () => {
  const css = withoutComments(await read());
  const block = mediaBlocks(css, 900);
  assert.ok(block, "no @media (max-width: 900px) block");
  const bar = rule(block, "\\.topbar\\.search-open");
  assert.ok(bar, ".topbar.search-open has no rule at ≤900px");
  assert.match(bar, /flex-direction:\s*column/u, "the open bar must stack");
  // The theme centres `.topbar` items; a centred column would float the title.
  assert.match(bar, /align-items:\s*stretch/u, "the stacked bar must stretch its rows");
  assert.match(rule(block, "\\.topbar\\.search-open \\.topbar-actions") ?? "", /width:\s*100%/u, "the actions row must take the full width once stacked");
});

test("the button and the range name never break inside a word", async () => {
  const css = baseLayer(withoutComments(await read()));
  const button = rule(css, "\\.primary-button");
  assert.ok(button, "no unconditional .primary-button rule");
  assert.match(button, /white-space:\s*nowrap/u, ".primary-button must not wrap its label");
  assert.match(button, /flex-shrink:\s*0/u, ".primary-button must not be the item that shrinks");
  const range = rule(css, "\\.eyebrow \\.eyebrow-range");
  assert.ok(range, "no .eyebrow .eyebrow-range rule");
  assert.match(range, /white-space:\s*nowrap/u, "the range name must stay on one line");
});
