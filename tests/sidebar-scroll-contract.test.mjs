import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * #574: the sidebar is `position: sticky; height: 100vh`, and a tenth nav item pushed the
 * account row — the only way into settings in production — below a 1280×720 window.
 * Measured: at 720px tall the column's content ran to 733px and the page's own scroll
 * never brought the rest back. The column scrolls itself above 620px now.
 *
 * Reads declarations, not layout: that the row is reachable, and that the 84px rail
 * grows no sideways bar, are measured in the PR.
 */
const css = (await readFile(path.join(root, "src", "styles.css"), "utf8")).replace(/\/\*[\s\S]*?\*\//gu, "");

/** The bodies of every `@media (<feature>: Npx)` block, keyed by the query text. */
function mediaBlocks(query) {
  const bodies = [];
  let at = css.indexOf(query);
  while (at !== -1) {
    let index = css.indexOf("{", at) + 1;
    const start = index;
    let depth = 1;
    while (depth > 0 && index < css.length) {
      if (css[index] === "{") depth += 1;
      else if (css[index] === "}") depth -= 1;
      index += 1;
    }
    bodies.push(css.slice(start, index - 1));
    at = css.indexOf(query, index);
  }
  return bodies;
}

const sidebarRules = (body) => [...body.matchAll(/(?:^|\})\s*\.sidebar\s*\{([^}]*)\}/gu)].map((match) => match[1]);

test("above 620px the sidebar scrolls itself, and not sideways", () => {
  const rules = mediaBlocks("@media (min-width: 621px)").flatMap(sidebarRules);
  assert.equal(rules.length, 1, "expected one `.sidebar` rule inside `@media (min-width: 621px)`");
  const [rule] = rules;
  assert.match(rule, /overflow-y:\s*auto;/u, "without this the account row is out of reach on a short window");
  assert.match(rule, /overflow-x:\s*hidden;/u, "left visible, overflow-x computes to auto and the 84px rail scrolls sideways");
  assert.match(rule, /overscroll-behavior-y:\s*contain;/u);
  assert.match(rule, /scroll-padding-block:\s*8px;/u, "a focused item at the edge keeps its ring");
  assert.match(rule, /scrollbar-width:\s*thin;/u, "a classic 15px bar leaves the 84px rail's items 42px wide, under the 44px tap width");
});

test("the top bar below 620px does not scroll vertically", () => {
  const narrow = mediaBlocks("@media (max-width: 620px)").join("\n");
  assert.doesNotMatch(narrow, /\.sidebar\s*\{[^}]*overflow-y:\s*auto/u, "the top bar's nav scrolls sideways; the bar itself must not");
  const outside = css.replace(/@media[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/gu, "");
  assert.deepEqual(sidebarRules(outside).filter((rule) => /overflow-y/u.test(rule)), [],
    "a `.sidebar` overflow outside the media query would reach the top bar too");
});
