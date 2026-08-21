import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * #136: the lists showed too few rows at once. Measured at 1440x900, the member
 * list put 4 of 9 rows on screen and the project list 6 of 8.
 *
 * The rows were tall for a reason worth writing down, because it is not the one
 * it looks like. Per cell, on a member row 92px tall:
 *
 * | cell                  | content | why                                   |
 * | --------------------- | ------- | ------------------------------------- |
 * | `.member-row-actions` | 78px    | two 36px buttons, wrapped to 2 lines  |
 * | load                  | 75px    | 39px ring + a 2-line capacity label   |
 * | name                  | 53px    | 16px name + a 2-line subtitle         |
 *
 * The name and its subtitle — the thing #87 made wrap on purpose — was only the
 * third tallest. The two above it were wrapping because their columns were too
 * narrow: nine columns, and a 1440px viewport leaves the wrapper 1066px, so
 * `table-layout: auto` squeezed whichever cell could wrap and the table paid in
 * height. #87's decision never had to be revisited.
 *
 * ## The trade this file guards
 *
 * Telling those two cells not to wrap is only half a fix. On its own it does not
 * widen the table — it moves the squeeze onto the cells that *can* still wrap,
 * the name and the skills chips. Measured at 620px: rows went from 112px to
 * **211px**, and the page from 1845px to 3097px. Strictly worse.
 *
 * It works only paired with a `min-width` the columns fit inside, which lets the
 * table exceed its wrapper and scroll sideways instead.
 *
 * ## #132 moved the pair out of its breakpoint
 *
 * #136 put both halves inside `@media (min-width: 1360px)`, reasoning that the bargain
 * does not scale down — the wrapper is roughly the viewport less 374px, so a 1120px
 * floor costs 56px of sideways scroll at 1440px and 130px at 1360px. True as far as it
 * was measured, and it was measured with the floor left at 960 below the breakpoint.
 * There the nine columns — 1086px of declared width plus cell padding — were all
 * starved, and the name cell became the tallest thing in the row at 84.9px.
 *
 * Sweeping the floor at 605px, nine columns, no nowrap:
 *
 * | floor | page | rows    | visible | sideways |
 * | ----- | ---- | ------- | ------- | -------- |
 * | 968   | 1838 | 111-130 | 3/9     | 393px    |
 * | 1120  | 1738 | 106-107 | 3/9     | 545px    |
 * | 1180  | 1546 |  83- 94 | 4/9     | 605px    |
 * | 1400  | 1546 |  83- 94 | 4/9     | 825px    |
 *
 * 1180 is where every column reaches its declared width and the rows reach their floor;
 * past it only the scroll grows. Add the two nowraps and 605px goes to page 1433, rows
 * 67 — the same row floor 1360px was getting. So the pair does scale down, given a
 * floor that fits the columns. And #142 removed the other half of #136's cost by
 * pinning the name column at every width, so the extra sideways scroll no longer costs
 * the row's identity.
 *
 * So: the `nowrap` declarations and the `min-width` floor still live or die together,
 * but at every width rather than behind a breakpoint. That is what these check.
 *
 * ## What they cannot do
 *
 * They read declarations. Rendered heights, visible row counts and the sideways
 * scroll are browser measurements, recorded in the PR. jsdom has no layout and
 * this repo has no browser test harness.
 *
 * Nor do they say anything about data the demo does not contain. The floor is a
 * fixed budget: a row given a longer name and three extra skill chips measured
 * 150px, with the two cells this is about holding at 48px and 54px while the name
 * and the chips grew. Column counts vary at runtime too — a user can add list
 * fields — and no width here adapts to that.
 */

const read = async () => (await readFile(path.join(root, "src", "styles.css"), "utf8")).replaceAll("\r\n", "\n");
const withoutComments = (css) => css.replace(/\/\*[\s\S]*?\*\//gu, "");

/** The body of every `@media (min-width: Npx)` block, with its N. */
function minWidthBlocks(css) {
  const blocks = [];
  const marker = /@media \(min-width: (\d+)px\) \{/gu;
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
    blocks.push({ width: Number(match[1]), body: css.slice(start, index - 1) });
  }
  return blocks;
}

const NOWRAPS = [
  [".member-row-actions", /\.member-row-actions[^{}]*\{[^}]*flex-wrap:\s*nowrap/u],
  [".capacity-limit", /\.capacity-limit[^{}]*\{[^}]*white-space:\s*nowrap/u],
];

/**
 * The floor is a contract value at both ends. Below 1100 the cells wrap anyway and the
 * nowraps only move the squeeze onto the name and skills cells (measured: 1080 leaves
 * the rows at 94px, 1100 drops them to 67px; the whole sweep is in the docstring
 * above). Above 1200 only the sideways scroll grows — 1240 and 1400 both sit at page
 * 1546, the same as 1180, for 60px and 220px more scroll.
 */
const FLOOR = { min: 1100, max: 1200 };

test("the nowraps and the floor apply together, at every width", async () => {
  const css = withoutComments(await read());
  const blocks = minWidthBlocks(css);

  const floor = css.match(/(?:^|\})\s*\.member-table\s*\{[^}]*min-width:\s*(\d+)px/u);
  assert.ok(floor, "expected an unconditional .member-table min-width floor (#132)");
  const width = Number(floor[1]);
  assert.ok(width >= FLOOR.min && width <= FLOOR.max,
    `the floor is ${width}px, outside ${FLOOR.min}-${FLOOR.max}: below that every column is `
    + "starved and the name cell becomes the tallest thing in the row, above it the sideways "
    + "scroll grows for nothing (#132)");

  for (const [name, pattern] of NOWRAPS) {
    // Unconditional, now that the floor is. Behind a breakpoint they would leave the
    // narrow widths with a floor that widens the table and cells that still wrap —
    // worse than either half alone (#132).
    const outside = blocks.reduce((rest, block) => rest.replace(block.body, ""), css);
    assert.match(outside, pattern,
      `${name} must take nowrap outside every min-width block: the floor applies at every width `
      + "now, and half the pair behind a breakpoint is worse than neither (#132)");
    for (const block of blocks) {
      assert.doesNotMatch(block.body, pattern,
        `${name} also takes nowrap inside @media (min-width: ${block.width}px). One place, or the `
        + "two can drift apart");
    }
  }
});

/**
 * The 1360px block held the pair and nothing else. If a floor is put back into a
 * breakpoint it wins there over the unconditional one, and since the unconditional one
 * is already at the knee, a second can only lower it.
 */
test("no min-width block sets a second floor for this table", async () => {
  const css = withoutComments(await read());
  for (const block of minWidthBlocks(css)) {
    assert.doesNotMatch(block.body, /\.member-table\s*\{[^}]*min-width:/u,
      `@media (min-width: ${block.width}px) sets a second .member-table floor, which wins over the `
      + "unconditional one at that width and can only lower it (#132)");
  }
});

/**
 * `height` on a table cell is a floor, and it was set above what the content
 * needs — 68px against the 53px of the tallest cell plus 12px of padding. That
 * added to every row and, worse, hid the fact that the member rows were tall for
 * an entirely different reason.
 */
test("the row floor stays below what a row's content needs", async () => {
  const css = withoutComments(await read());
  const rule = css.match(/\.portfolio-table td,\s*\n\.member-table td\s*\{([^}]*)\}/u);
  assert.ok(rule, "expected the shared td rule");
  const height = rule[1].match(/height:\s*(\d+)px/u);
  assert.ok(height, "the floor keeps an empty row from collapsing; it should stay declared");
  const value = Number(height[1]);
  assert.ok(value <= 56,
    `height is ${value}px; above 56 it binds instead of the content and pads every row (#136)`);
  // And it is a floor for an empty row, so it should not collapse to nothing
  // either — 0 would pass a one-sided check while losing the reason it exists.
  assert.ok(value >= 40, `height is ${value}px; the floor exists so an empty row still reads as a row`);
});

/**
 * The ribbon's `min-height` was 96px around a 45px stat. It is declared twice —
 * a base rule and a theme rule — and the theme one wins, which is why editing
 * only the base changed nothing on screen.
 */
test("neither ribbon rule sets a min-height", async () => {
  const css = withoutComments(await read());
  const rules = [...css.matchAll(/\.portfolio-ribbon,\s*\n\.member-ribbon\s*\{([^}]*)\}/gu)];
  assert.ok(rules.length >= 2, `expected the base and theme ribbon rules, found ${rules.length}`);
  for (const [, body] of rules) {
    assert.doesNotMatch(body, /min-height:/u,
      "the ribbon holds one 45px stat; a min-height taller than that is dead space above every list (#136)");
  }
});
