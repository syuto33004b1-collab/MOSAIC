import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * #260: between 621 and 1280px the attention panel is a three-column grid — the
 * title in a 145px column, the cards in two 1fr columns. Left to auto-placement a
 * third card fell into the title's column of the next row, 145px wide, and broke
 * 「未充足ロ／ール」. Even and odd children now name their column, which holds only
 * while the title is the first child and the cards follow it without anything in
 * between.
 *
 * ## What this cannot do
 *
 * It reads declarations and source order. Where a card actually lands was measured
 * with three and four cards at 700, 831 and 1100px and is in the PR. This fails
 * when either rule goes, or when the panel's children stop being title-then-cards.
 */

const read = async (...segments) => (await readFile(path.join(root, ...segments), "utf8")).replaceAll("\r\n", "\n");
const withoutComments = (css) => css.replace(/\/\*[\s\S]*?\*\//gu, "");

/** Every `@media (max-width: <px>)` block whose upper bound is `px`, bodies joined. */
function mediaBlocks(css, px) {
  return [...css.matchAll(new RegExp(`@media\\s*\\(max-width:\\s*${px}px\\)\\s*\\{((?:[^{}]*\\{[^{}]*\\})*[^{}]*)\\}`, "gu"))].map((m) => m[1]).join("\n");
}

/** Every body declared for `selector` — two 1280px blocks each set the panel's columns, and the later one wins. */
function rules(css, selector) {
  return [...css.matchAll(new RegExp(`(?:^|\\})\\s*${selector}\\s*\\{([^}]*)\\}`, "gu"))].map((m) => m[1]);
}
const declares = (css, selector, pattern) => rules(css, selector).some((body) => pattern.test(body));

test("the cards take the two card columns and leave the title its own", async () => {
  const block = mediaBlocks(withoutComments(await read("src", "styles.css")), 1280);
  assert.ok(block, "no @media (max-width: 1280px) block");
  assert.ok(declares(block, "\\.attention-panel", /grid-template-columns:\s*145px 1fr 1fr/u), "the panel must keep its three columns, title first");
  assert.ok(declares(block, "\\.attention-panel > \\.alert-card:nth-child\\(even\\)", /grid-column:\s*2\b/u), "even children must take the second column");
  assert.ok(declares(block, "\\.attention-panel > \\.alert-card:nth-child\\(odd\\)", /grid-column:\s*3\b/u), "odd children must take the third column");
});

test("the panel's children are the title, then the cards, then the link", async () => {
  const tsx = await read("src", "App.tsx");
  const start = tsx.indexOf('<aside className="attention-panel"');
  assert.ok(start >= 0, "no .attention-panel in App.tsx");
  const end = tsx.indexOf("</aside>", start);
  const panel = tsx.slice(start, end);
  // The parity rules count children, so the title must come first and only cards may
  // follow it until the link. Source order is what auto-placement reads.
  const order = [...panel.matchAll(/className=\{?"(attention-title|alert-card|all-alerts)/gu)].map((m) => m[1]);
  assert.equal(order[0], "attention-title", `the first child must be the title, got ${order[0]}`);
  assert.equal(order.at(-1), "all-alerts", `the last child must be the link, got ${order.at(-1)}`);
  const cards = order.slice(1, -1);
  assert.ok(cards.length > 0 && cards.every((name) => name === "alert-card"), `only cards may sit between the title and the link, got ${cards.join(", ")}`);
});
