import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Below 620px the sidebar becomes a sticky bar across the top. #83 measured what
 * that bar did to nine nav items: `.primary-nav` never wraps, so the
 * `flex: 1 1 25%` that asked for four per row could not apply and every item was
 * squeezed to fit. Three labels broke over two lines at 485px and six at 390px —
 * 「プロジェ／クト」 and 「スキルマ／ップ」 among them, the second putting a small
 * kana at the start of a line.
 *
 * The row scrolls now. These pin the declarations that make that work, because
 * each one is load-bearing in a way the next reader would not guess:
 *
 * - `width: auto` because the base `.nav-item` is `width: 100%`, which wins as
 *   soon as the flex basis is `auto` — the items measured 422px without it
 * - `min-width: 44px` because the two shortest labels come out at 36px otherwise
 * - `white-space: nowrap` on the label, which is the whole point
 *
 * ## What this cannot do
 *
 * It reads declarations, not layout. Whether the row actually scrolls, how much,
 * and whether the labels stay whole are in the PR as measurements. It resolves
 * same-selector rules by document order, which is what this file's layers are;
 * it does not model `!important` or a more specific selector.
 */

const read = () => readFile(path.join(root, "src", "styles.css"), "utf8");
const withoutComments = (css) => css.replace(/\/\*[\s\S]*?\*\//gu, "");

/**
 * The bodies of every `@media (max-width: Npx)` block that applies at `width`, in
 * document order. Per width, not "everything below 620": a declaration placed in
 * a 390px block only would satisfy a combined scan while 485px stayed broken, and
 * this file has blocks at 620, 410 and 390 that all touch the nav item.
 */
async function blocksAt(width) {
  const css = withoutComments(await read());
  const blocks = [];
  const marker = /@media \(max-width: (\d+)px\) \{/gu;
  let match;
  while ((match = marker.exec(css)) !== null) {
    let depth = 1;
    let index = match.index + match[0].length;
    const start = index;
    while (depth > 0 && index < css.length) {
      if (css[index] === "{") depth += 1;
      else if (css[index] === "}") depth -= 1;
      index += 1;
    }
    if (Number(match[1]) >= width) blocks.push(css.slice(start, index - 1));
  }
  return blocks;
}

/** The two widths #83 measured, plus the top of the range where the bar applies. */
const WIDTHS = [620, 485, 390];

const rulesFor = (body, selectorPart) => [...body.matchAll(/([^{}]+)\{([^{}]*)\}/gu)]
  .filter(([, selector]) => selector.includes(selectorPart))
  .map(([, , declarations]) => declarations);

/** The value that wins for `property`, among the rules mentioning `selectorPart`. */
const winningValue = (blocks, selectorPart, property) => {
  const declarations = blocks.flatMap((body) => rulesFor(body, selectorPart)).join(";");
  const matches = [...declarations.matchAll(new RegExp(`(?:^|;)[\\s]*${property}[\\s]*:[\\s]*([^;]+)`, "gu"))];
  return matches.length > 0 ? matches.at(-1)[1].trim() : null;
};

for (const width of WIDTHS) {
  test(`at ${width}px the nav is one scrolling row, not nine squeezed columns`, async () => {
    const blocks = await blocksAt(width);
    assert.ok(blocks.length > 0, `no max-width block applies at ${width}px`);

    assert.equal(winningValue(blocks, ".primary-nav", "overflow-x"), "auto", ".primary-nav must scroll horizontally");
    assert.equal(winningValue(blocks, ".nav-item", "flex"), "0 0 auto", "items must not stretch or shrink");
    assert.equal(winningValue(blocks, ".nav-item", "width"), "auto", "without this the base width: 100% wins and each item fills the row");
    // 44px exactly, not "at least 24": the contract is a tap width, and a pattern
    // that only asked for a number was satisfied by a competing `min-width: 0`.
    assert.equal(winningValue(blocks, ".nav-item", "min-width"), "44px", "the shortest labels need a tap width");
    assert.equal(winningValue(blocks, ".nav-label", "white-space"), "nowrap", "labels must not break mid-word");
  });

  test(`at ${width}px the stacked header has one alignment baseline`, async () => {
    const blocks = await blocksAt(width);
    // The theme sets `align-items: center` on `.topbar`, which is vertical while
    // the bar is a row and horizontal once it stacks. The title block then sat
    // wherever its own text width put it — 14 to 103px, depending on the screen.
    assert.match(winningValue(blocks, ".topbar", "align-items") ?? "", /^(stretch|flex-start|start)$/u,
      ".topbar must not centre its children once it stacks");
  });

  test(`at ${width}px the result count and sort order are not dropped`, async () => {
    const blocks = await blocksAt(width);
    assert.notEqual(winningValue(blocks, ".toolbar-result", "display"), "none",
      ".toolbar-result is the answer to 「何が出ているのか」");
  });
}
