import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * #137: the detail panel was `width: min(410px, 100%)` — the same 410px at every
 * viewport. On a 1440px screen that is 28% of it, while the panel's own content
 * overflowed by 268px and the other 1030px sat behind a dim backdrop.
 *
 * Widening it does not by itself shorten it. The 1038px of content in a project's
 * panel is almost no wrapped prose: two fact grids at 114 and 64, a five-person
 * member list at 283, four action rows at 44. Nothing there gets shorter from more
 * width. What gets it shorter is letting the blocks sit beside each other, which
 * is what the width is for. Measured, `scrollHeight / clientHeight` at 1440x900:
 *
 * | panel      | before | after |
 * | ---------- | ------ | ----- |
 * | project    | 1.31   | 1.02  |
 * | member     | 1.21   | 1.02  |
 * | assignment | 1.00   | 1.00  |
 *
 * ## What these check
 *
 * Three things that would each silently undo it, and are not obvious from reading
 * the rules:
 *
 * 1. The width has to stay responsive, with 410px as a floor rather than a value.
 * 2. The two columns are keyed on the panel's own width, not the viewport's, and
 *    a container query measures the **content** box — the panel's width less its
 *    48px of padding and 2px of border. So the 600px threshold is a 650px panel,
 *    confirmed by stepping the width in the browser: two columns at 650, one at
 *    649. The panel is 666px at a 1280px viewport and 749px at 1440px, so a first
 *    attempt at `min-width: 640px` did nothing at 1280, where the content box is
 *    616. The number to compare is never the one you can see — and `clientWidth`
 *    is not it either, since that excludes the scrollbar and reads 15px under.
 * 3. Every selector in that block is `.drawer`-prefixed for specificity. The
 *    blocks it lays out — `.profile-capacity`, `.detail-member-list` — are
 *    declared again further down the file, and a bare class here loses to them on
 *    source order. That was the second thing that silently did nothing.
 *
 * ## What they cannot do
 *
 * They read declarations. The ratios above are browser measurements, in the PR.
 *
 * The specificity check reads selector text, not the cascade: `.drawer`-prefixed
 * is enough to beat the single-class rules that exist today, and it would not
 * catch a future two-class rule declared later, or an `!important`.
 */

const read = async () => (await readFile(path.join(root, "src", "styles.css"), "utf8")).replaceAll("\r\n", "\n");
const withoutComments = (css) => css.replace(/\/\*[\s\S]*?\*\//gu, "");

/** The body of the panel's own `@container` block, by name, with its threshold. */
function containerBlock(css) {
  // By name, not by position: this file has more than one @container block, and an
  // earlier version of this helper took whichever came first.
  const marker = /@container detail-panel \(min-width: (\d+)px\) \{/u.exec(css);
  if (!marker) return null;
  let depth = 1;
  let index = marker.index + marker[0].length;
  const start = index;
  while (depth > 0 && index < css.length) {
    if (css[index] === "{") depth += 1;
    else if (css[index] === "}") depth -= 1;
    index += 1;
  }
  return { width: Number(marker[1]), body: css.slice(start, index - 1) };
}

test("the panel's width follows the viewport, with the old width as its floor", async () => {
  const css = withoutComments(await read());
  const rule = css.match(/(?:^|\n)\.drawer \{([^}]*)\}/u);
  assert.ok(rule, "expected the base .drawer rule");
  const width = rule[1].match(/width:\s*([^;]+)/u);
  assert.ok(width, ".drawer needs a width");
  assert.match(width[1], /clamp\(\s*410px/u,
    `width is ${width[1].trim()}; 410px belongs as the clamp floor, not as the width (#137)`);
  assert.match(width[1], /vw/u, "the middle term has to scale with the viewport, or this is a fixed width again");
});

test("the two columns key off the panel, and the mobile sheet opts out", async () => {
  const css = withoutComments(await read());
  const base = css.match(/(?:^|\n)\.drawer \{([^}]*)\}/u);
  assert.match(base[1], /container:\s*detail-panel\s*\/\s*inline-size/u,
    ".drawer has to be the named container: the viewport and the panel differ by a sidebar and two "
    + "paddings, and an anonymous query would walk outwards to .section-view when this one is off (#137)");

  // Several 620px blocks exist; the one that matters is whichever holds `.drawer`,
  // so they are all searched rather than the first one matched.
  const blocks = [];
  const marker = /@media \(max-width: 620px\) \{/gu;
  let found;
  while ((found = marker.exec(css)) !== null) {
    let depth = 1;
    let index = found.index + found[0].length;
    const start = index;
    while (depth > 0 && index < css.length) {
      if (css[index] === "{") depth += 1;
      else if (css[index] === "}") depth -= 1;
      index += 1;
    }
    blocks.push(css.slice(start, index - 1));
  }
  assert.ok(blocks.length > 0, "expected a 620px block");
  assert.ok(blocks.some((body) => /\.drawer \{[^}]*container:\s*none/u.test(body)),
    "the full-bleed sheet drops the container name and type outright — its content box sits near the "
    + "threshold, so leaving it to arithmetic means a padding change flips the layout, and dropping only "
    + "the type would let the query resolve against an ancestor instead (#137)");
});

test("the threshold is pinned, and every rule in the block is .drawer-prefixed", async () => {
  const css = withoutComments(await read());
  const block = containerBlock(css);
  assert.ok(block, "expected an @container block for the panel");
  // Exactly 600, not a range: the number is load-bearing at both ends. It puts the
  // switch at a 650px panel, so two columns from about a 1250px viewport at 52vw
  // with each column near 300px; and it leaves the 620px sheet's content box 18px
  // short, which is the only thing keeping that sheet in one column besides the
  // `container: none` above.
  assert.equal(block.width, 600,
    `the block starts at ${block.width}px. 600 is measured — moving it changes both which viewports `
    + "get two columns and how much clearance the mobile sheet has (#137)");

  const selectors = [...block.body.matchAll(/(?:^|\})\s*([^{}]+)\{/gu)]
    .flatMap(([, group]) => group.split(",").map((one) => one.trim()))
    .filter(Boolean);
  assert.ok(selectors.length >= 6, `expected the block's rules, found ${selectors.length}`);
  for (const selector of selectors) {
    assert.match(selector, /^\.drawer[\s.]/u,
      `「${selector}」 is not prefixed with .drawer — the blocks in here are declared again later in the `
      + "file, and a bare class loses to them on source order (#137)");
  }
});
