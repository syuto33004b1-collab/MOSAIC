import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * #395: 要調整 is a dialog opened from the pulse count, not a three-column aside
 * under the board. The child order (title → cards → report link) still matters.
 */

const read = async (...segments) => (await readFile(path.join(root, ...segments), "utf8")).replaceAll("\r\n", "\n");
const withoutComments = (css) => css.replace(/\/\*[\s\S]*?\*\//gu, "");

function rules(css, selector) {
  return [...css.matchAll(new RegExp(`(?:^|\\})\\s*${selector}\\s*\\{([^}]*)\\}`, "gu"))].map((m) => m[1]);
}
const declares = (css, selector, pattern) => rules(css, selector).some((body) => pattern.test(body));

test("attention is a stacked dialog panel, not a board aside grid (#395)", async () => {
  const css = withoutComments(await read("src", "styles.css"));
  assert.equal(declares(css, "\\.attention-panel", /grid-template-columns:\s*145px 1fr 1fr/u), false,
    "the three-column board aside is retired");
  assert.ok(declares(css, "\\.attention-dialog \\\\.attention-panel", /flex-direction:\s*column/u)
    || declares(css, "\\.attention-dialog \\.attention-panel", /flex-direction:\s*column/u),
    "dialog content stacks title then cards");
  assert.ok(declares(css, "\\.board-layout", /grid-template-columns:\s*minmax\(0,\s*1fr\)/u),
    "the board layout stays a single column");
});

test("the dialog's children are the title, then the cards, then the link", async () => {
  const tsx = await read("src", "App.tsx");
  const start = tsx.indexOf('className="attention-panel"');
  assert.ok(start >= 0, "no .attention-panel in App.tsx");
  const end = tsx.indexOf("</div>\n          </section>", start);
  assert.ok(end > start, "could not find attention panel close");
  const panel = tsx.slice(start, end);
  const order = [...panel.matchAll(/className=\{?"(attention-title|alert-card|all-alerts)/gu)].map((m) => m[1]);
  assert.equal(order[0], "attention-title", `the first child must be the title, got ${order[0]}`);
  assert.equal(order.at(-1), "all-alerts", `the last child must be the link, got ${order.at(-1)}`);
  const cards = order.slice(1, -1);
  assert.ok(cards.length > 0 && cards.every((name) => name === "alert-card"), `only cards may sit between the title and the link, got ${cards.join(", ")}`);
  assert.match(tsx, /className="attention-dialog dialog-md"[\s\S]*?role="dialog"[\s\S]*?aria-modal="true"[\s\S]*?aria-labelledby="attention-heading"/u);
  assert.match(tsx, /attentionOpen && !drawer/u);
});
