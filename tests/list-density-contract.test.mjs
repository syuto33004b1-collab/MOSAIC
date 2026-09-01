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
 * Sweeping the floor at 605px, nine columns, with both nowraps:
 *
 * | floor       | page | rows    | visible | sideways | name column |
 * | ----------- | ---- | ------- | ------- | -------- | ----------- |
 * | 968 (was)   | 1838 | 111-130 | 3/9     | 393px    | 111.8px     |
 * | 1100        | 1462 |  67- 94 | 4/9     | 525px    | 159px       |
 * | 1140        | 1433 |  67- 94 | 4/9     | 565px    | 181px       |
 * | 1160        | 1433 |  67- 94 | 4/9     | 585px    | 190px       |
 * | 1240        | 1433 |  67- 94 | 4/9     | 665px    | 190px       |
 * | max-content | 1433 |  67- 94 | 4/9     | 581px    | 190px       |
 *
 * So the pair does scale down, given a floor the columns fit inside. And #142 removed
 * the other half of #136's cost by pinning the name column at every width, so the extra
 * sideways scroll no longer costs the row's identity.
 *
 * ## Why the floor is not a number
 *
 * 1160 was the knee — and only for nine columns. The column count changes at runtime: a
 * user can put any number of custom fields in the list view. With five list fields
 * instead of two, twelve columns at 1425px, a 1160px floor left the name column 80px and
 * the rows 243-372px, for a page of 3291 — the same defect, and the same numbers the old
 * 968 floor gave. `max-content` instead: page 1270, rows 67-94, 9 of 9 rows visible.
 *
 * It does not run away either. The text cells cap and ellipsis — `.col-custom` is
 * `max-width: 150px` — so `max-content` is bounded by the declarations. With a 72-char
 * unbreakable value in all 45 custom cells the columns grew 88px → 174px and the scroll
 * 356px → 786px, while the page stayed 1270 and the rows stayed 67-94.
 *
 * So: the `nowrap` declarations and the floor still live or die together, at every width
 * rather than behind a breakpoint, and the floor is `max-content` rather than a number
 * that goes stale when a column is added. That is what these check.
 *
 * ## What they cannot do
 *
 * They read declarations. Rendered heights, visible row counts and the sideways
 * scroll are browser measurements, recorded in the PR. jsdom has no layout and
 * this repo has no browser test harness.
 *
 * Nor do they say anything about data the demo does not contain, beyond what the
 * measurements above cover. `max-content` follows the column count, which is what #132
 * changed — twelve columns and a 72-char unbreakable value were both measured — but a
 * row given a longer name and three extra skill chips still measured 150px, with the two
 * cells this file is about holding at 48px and 54px while the name and the chips grew.
 * That growth is #87's, on purpose, and nothing here bounds it.
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

test("the nowraps and the floor apply together, at every width", async () => {
  const css = withoutComments(await read());
  const blocks = minWidthBlocks(css);

  const floor = css.match(/(?:^|\})\s*\.member-table\s*\{[^}]*min-width:\s*([^;}]+)/u);
  assert.ok(floor, "expected an unconditional .member-table min-width floor (#132)");
  // Content-derived, not a number. Any number is a guess about how many columns there
  // are, and the count changes at runtime — 1160 was the knee for nine columns and left
  // twelve at rows 243-372px, page 3291 (measured, and in the docstring above).
  assert.equal(floor[1].trim(), "max-content",
    `the floor is 「${floor[1].trim()}」. A fixed width starves the columns as soon as a list `
    + "field is added, which is the defect #75 was about and #132 measured again (#132)");

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
 * The 1360px block held the pair and nothing else. A floor put back into a breakpoint
 * wins there over the unconditional one, and since that one already asks for exactly
 * what the columns need, a second can only ask for less.
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

/**
 * The board's strip is the same part as those ribbons, and #136 missed it.
 *
 * Measured at 1425px before this: 108px against the ribbons' 69.2px, while holding shorter
 * content — a 37.8px metric against their 45.2px stat. `min-height: 108px` in the theme and
 * 82px in the base put 28px of nothing inside the box, 21px of padding against their 12px
 * put more, and `margin-bottom: 24px` against their 16px put 8px under it.
 *
 * Both min-heights had to go, which is the shape of #136's own bug: editing the base rule
 * alone changed nothing on screen, because the theme rule wins. After: 61.8px, 7px under the
 * ribbons because their stat stacks its label under the number where a metric keeps it
 * alongside. The pixels were never the contract — following the content is (#193).
 */
test("no rule gives the board's strip a min-height either", async () => {
  const css = withoutComments(await read());
  const rules = [...css.matchAll(/(?:^|\})\s*\.pulse-strip\s*\{([^}]*)\}/gu)];
  assert.ok(rules.length >= 2, `expected the base and theme strip rules, found ${rules.length}`);
  for (const [, body] of rules) {
    assert.doesNotMatch(body, /min-height:/u,
      "the strip holds one 37.8px metric; a min-height taller than that is dead space above the board (#193)");
  }
  // And the box it does keep is the ribbons', so the two are measured the same way. By the
  // theme rule's own declaration rather than by position: the last `.pulse-strip` rule in the
  // file is a breakpoint's `padding`, not this one.
  const theme = rules.map(([, body]) => body).filter((body) => /background:\s*var\(--ink\)/u.test(body));
  assert.equal(theme.length, 1, `expected one theme rule for the strip, found ${theme.length}`);
  assert.match(theme[0], /padding:\s*12px 24px/u, "the strip takes the ribbons' padding (#136, #193)");
  assert.match(theme[0], /margin-bottom:\s*16px/u, "and their space beneath it");
});
