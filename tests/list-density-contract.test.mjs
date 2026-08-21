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
 * table exceed its wrapper and scroll sideways instead. And that bargain does
 * not scale down: the wrapper is roughly the viewport less 374px, so the same
 * 1120px floor costs 56px of sideways scroll at 1440px and 130px at 1360px, and
 * would cost about 530px at 620px. Hence a breakpoint, with both halves inside
 * it.
 *
 * So: the `nowrap` declarations and the `min-width` floor live or die together,
 * in the same block. That is what these check.
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
 * Both are contract values, so both ends are checked. A floor below 1100 does not
 * stop the wrapping (measured: 1080 leaves the rows at 94px, 1100 drops them to
 * 67px); one far above it buys scroll nobody asked for. A breakpoint below 1360
 * applies the trade where the sideways cost is worse than the height it saves;
 * one far above it withholds the fix from the screens that can afford it.
 */
const FLOOR = { min: 1100, max: 1200 };
const BREAKPOINT = { min: 1360, max: 1440 };

test("the two nowraps only exist where the table may outgrow its wrapper", async () => {
  const css = withoutComments(await read());
  const blocks = minWidthBlocks(css);

  for (const [name, pattern] of NOWRAPS) {
    const holders = blocks.filter((block) => pattern.test(block.body));
    // Outside any min-width block, the declaration would apply at every width,
    // including the narrow ones where it makes the rows taller rather than
    // shorter. Compare the whole file against the blocks that hold it.
    const outside = blocks.reduce((rest, block) => rest.replace(block.body, ""), css);
    assert.doesNotMatch(outside, pattern,
      `${name} must not carry nowrap outside a min-width block — on a narrow screen it moves `
      + "the squeeze onto the name and skills cells and the rows get taller (#136)");
    assert.ok(holders.length > 0, `${name} should take nowrap inside a min-width block`);

    for (const block of holders) {
      // The floor has to be there, wide enough to actually stop the wrapping, and
      // the block has to start where the sideways cost is still tolerable. A
      // `min-width: 1px` or a 700px breakpoint would satisfy "there is a floor"
      // and reintroduce the defect.
      const floor = block.body.match(/\.member-table\s*\{[^}]*min-width:\s*(\d+)px/u);
      assert.ok(floor,
        `the @media (min-width: ${block.width}px) block sets nowrap on ${name} without the `
        + ".member-table min-width floor that makes it pay off (#136)");
      const width = Number(floor[1]);
      assert.ok(width >= FLOOR.min && width <= FLOOR.max,
        `the floor is ${width}px, outside ${FLOOR.min}-${FLOOR.max}: below that the cells wrap `
        + "anyway and the nowrap just moves the squeeze onto the name and skills cells, above it "
        + "the sideways scroll grows for nothing (#136)");
      assert.ok(block.width >= BREAKPOINT.min && block.width <= BREAKPOINT.max,
        `this block starts at ${block.width}px, outside ${BREAKPOINT.min}-${BREAKPOINT.max}: the `
        + "floor costs about (1120 - (viewport - 374))px of sideways scroll, already 130px at "
        + `${BREAKPOINT.min} (#136)`);
    }
  }
});

/**
 * The other half of the pairing, and the one a tidy-up would take out. The base
 * rule has to say `wrap` out loud: deleting it does not restore wrapping, it
 * leaves the initial value, which is `nowrap` — the broken state at every width
 * below the breakpoint, with nothing in the file to show it was ever a choice.
 */
test("the row actions wrap by default", async () => {
  const css = withoutComments(await read());
  const base = css.match(/\.member-row-actions\s*\{([^}]*)\}/u);
  assert.ok(base, "expected the base .member-row-actions rule");
  assert.match(base[1], /flex-wrap:\s*wrap/u,
    "the base rule must declare wrap; the initial value is nowrap, which is the defect (#136)");
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
