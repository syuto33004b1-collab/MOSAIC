import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Below 620px the sidebar becomes a sticky bar across the top. #83 measured what
 * that bar did to nine nav items at 485px: `.primary-nav` never wraps, so the
 * `flex: 1 1 25%` that asked for four per row could not apply and every item was
 * squeezed to 45px. Three labels broke over two lines and two of those broke
 * mid-word — 「プロジェ／クト」 and 「スキルマ／ップ」, the second putting a small
 * kana at the start of a line.
 *
 * The row scrolls now. These pin the declarations that make that work, because
 * each one is load-bearing in a way the next reader would not guess:
 *
 * - `width: auto` because the base `.nav-item` is `width: 100%`, which wins as
 *   soon as the flex basis is `auto` — the items measured 422px without it
 * - `min-width` because the two shortest labels come out at 36px otherwise, from
 *   45px today
 * - `white-space: nowrap` on the label, which is the whole point
 *
 * ## What this cannot do
 *
 * It reads declarations, not layout. Whether the row actually scrolls, how much,
 * and whether the labels stay whole are in the PR as measurements.
 */

const read = () => readFile(path.join(root, "src", "styles.css"), "utf8");
const withoutComments = (css) => css.replace(/\/\*[\s\S]*?\*\//gu, "");

/**
 * The body of every `@media (max-width: Npx)` block with N <= 620, in document
 * order. Not just the 620 blocks: a narrower one further down the file was
 * putting `min-width: 0` back on the nav item, which the cascade honours.
 */
async function narrowBlocks() {
  const css = withoutComments(await read());
  const blocks = [];
  const marker = /@media \(max-width: (\d+)px\) \{/gu;
  let match;
  while ((match = marker.exec(css)) !== null) {
    if (Number(match[1]) > 620) continue;
    let depth = 1;
    let index = match.index + match[0].length;
    const start = index;
    while (depth > 0 && index < css.length) {
      if (css[index] === "{") depth += 1;
      else if (css[index] === "}") depth -= 1;
      index += 1;
    }
    blocks.push(css.slice(start, index - 1));
  }
  return blocks;
}

const rulesFor = (body, selectorPart) => [...body.matchAll(/([^{}]+)\{([^{}]*)\}/gu)]
  .filter(([, selector]) => selector.includes(selectorPart))
  .map(([, , declarations]) => declarations);

test("the narrow nav is one scrolling row, not nine squeezed columns", async () => {
  const blocks = await narrowBlocks();
  assert.ok(blocks.length > 0, "expected at least one max-width: 620px block");
  const all = blocks.join("\n");

  const navRules = rulesFor(all, ".primary-nav").join(";");
  assert.match(navRules, /overflow-x:\s*auto/u, ".primary-nav must scroll horizontally at this width");

  const itemRules = rulesFor(all, ".nav-item").join(";");
  assert.match(itemRules, /flex:\s*0 0 auto/u, "items must not stretch or shrink");
  assert.match(itemRules, /width:\s*auto/u, "without this the base width: 100% wins and each item fills the row");
  // Not `match(/min-width:\s*\d/)`: the other 620px block already declares
  // `min-width: 0` on the same selector, and that satisfied the pattern while the
  // floor was gone. Compare the value.
  // The unit is optional: a competing rule wrote `min-width: 0`, with no `px`,
  // and a pattern that required the unit did not see it at all.
  const floors = [...itemRules.matchAll(/min-width:\s*(\d+)(?:px)?/gu)].map((m) => Number(m[1]));
  assert.ok(floors.length > 0, "no min-width on the nav item below 620px");
  assert.ok(floors.at(-1) >= 24, `the last min-width wins and it must be a tappable floor, found ${JSON.stringify(floors)}`);

  const labelRules = rulesFor(all, ".nav-label").join(";");
  assert.match(labelRules, /white-space:\s*nowrap/u, "labels must not break mid-word");
});

test("the stacked header has one alignment baseline", async () => {
  const all = (await narrowBlocks()).join("\n");
  // The theme sets `align-items: center` on `.topbar`, which becomes horizontal
  // centring once the bar stacks — the title block sat at 72px, everything else
  // at 14px.
  const topbar = rulesFor(all, ".topbar").join(";");
  assert.match(topbar, /align-items:\s*(stretch|flex-start|start)/u, ".topbar must not centre its children once it stacks");
});

test("the narrow breakpoint does not drop the result count and sort order", async () => {
  const all = (await narrowBlocks()).join("\n");
  const result = rulesFor(all, ".toolbar-result").join(";");
  assert.doesNotMatch(result, /display:\s*none/u, ".toolbar-result is the answer to 「何が出ているのか」");
});
