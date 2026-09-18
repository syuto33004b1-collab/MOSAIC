import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * #256 stacked `.topbar.search-open` while the topbar search box was out.
 * #409 moved search onto the board filter row, so that class must not return.
 * The nowrap on the primary button and the range name still stop those labels
 * breaking inside a word.
 */

const read = async () => (await readFile(path.join(root, "src", "styles.css"), "utf8")).replaceAll("\r\n", "\n");
const withoutComments = (css) => css.replace(/\/\*[\s\S]*?\*\//gu, "");
const baseLayer = (css) => css.replace(/@(?:media|container)[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/gu, "");

function rule(css, selector) {
  const m = css.match(new RegExp(`(?:^|\\})\\s*${selector}\\s*\\{([^}]*)\\}`, "u"));
  return m ? m[1] : null;
}

test("the topbar no longer has a search-open stacking mode (#409)", async () => {
  const css = withoutComments(await read());
  assert.doesNotMatch(css, /\.topbar\.search-open/u, ".topbar.search-open must stay gone with the topbar search box");
  assert.doesNotMatch(css, /\.search-box/u, ".search-box belonged to the topbar search overlay");
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
