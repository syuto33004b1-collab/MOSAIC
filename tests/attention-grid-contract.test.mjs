import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * #260 / #391: the attention panel is a three-column grid under the board at every
 * width — title in 145px, cards in two 1fr columns. Even/odd children name their
 * column so a third card never lands in the title track.
 */

const read = async (...segments) => (await readFile(path.join(root, ...segments), "utf8")).replaceAll("\r\n", "\n");
const withoutComments = (css) => css.replace(/\/\*[\s\S]*?\*\//gu, "");

function rules(css, selector) {
  return [...css.matchAll(new RegExp(`(?:^|\\})\\s*${selector}\\s*\\{([^}]*)\\}`, "gu"))].map((m) => m[1]);
}
const declares = (css, selector, pattern) => rules(css, selector).some((body) => pattern.test(body));

test("the cards take the two card columns and leave the title its own", async () => {
  const css = withoutComments(await read("src", "styles.css"));
  assert.ok(declares(css, "\\.attention-panel", /grid-template-columns:\s*145px 1fr 1fr/u), "the panel must keep its three columns, title first");
  assert.ok(declares(css, "\\.attention-panel > \\.alert-card:nth-child\\(even\\)", /grid-column:\s*2\b/u), "even children must take the second column");
  assert.ok(declares(css, "\\.attention-panel > \\.alert-card:nth-child\\(odd\\)", /grid-column:\s*3\b/u), "odd children must take the third column");
  assert.ok(declares(css, "\\.board-layout", /grid-template-columns:\s*minmax\(0,\s*1fr\)/u),
    "the board layout is a single column so the aside sits under the schedule (#391)");
});

test("the panel's children are the title, then the cards, then the link", async () => {
  const tsx = await read("src", "App.tsx");
  const start = tsx.indexOf('<aside className="attention-panel"');
  assert.ok(start >= 0, "no .attention-panel in App.tsx");
  const end = tsx.indexOf("</aside>", start);
  const panel = tsx.slice(start, end);
  const order = [...panel.matchAll(/className=\{?"(attention-title|alert-card|all-alerts)/gu)].map((m) => m[1]);
  assert.equal(order[0], "attention-title", `the first child must be the title, got ${order[0]}`);
  assert.equal(order.at(-1), "all-alerts", `the last child must be the link, got ${order.at(-1)}`);
  const cards = order.slice(1, -1);
  assert.ok(cards.length > 0 && cards.every((name) => name === "alert-card"), `only cards may sit between the title and the link, got ${cards.join(", ")}`);
});
