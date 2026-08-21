import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * #133: the forecast chart's ticks and its grid lines were drawn from two different
 * scales.
 *
 * The ticks were a 188px flex column with `space-between` over 163px of content box;
 * the lines were percentages of the `bar` row of a 188px grid less three rows of
 * labels, which came to 103.4px. Measured from the grid's top:
 *
 * | tick | label was at | line was at | where the bars put it |
 * | ---- | ------------ | ----------- | --------------------- |
 * | 120% | 0px          | 0px         | 0px                   |
 * | 100% | **48.9px**   | 17.6px      | 17.2px                |
 * | 60%  | **97.9px**   | 51.7px      | 51.7px                |
 * | 0    | 146.8px      | (no line)   | 103.4px               |
 *
 * So the label reading 100% sat 31px below the line for 100%, and a reader pairing
 * them read a different value off the chart. #100 had already put the lines on the
 * bars' own track; the labels were outside it.
 *
 * Both halves borrow one row now — `.horizon-plot` owns it, the ticks take it as their
 * box, the grid subgrids it — and every offset is the same fraction of that row:
 * `(120 − v) / 120`. After: ticks and lines both at 0 / 17.2 / 51.7, and the 0 tick at
 * the bar's baseline, 103.4.
 *
 * ## What this checks
 *
 * That the two halves still agree, expressed the only way a stylesheet can be asked:
 * the tick for a value and the line for the same value name the same offset, and that
 * offset is the fraction the value implies. A drift like the one above shows up as a
 * mismatch here rather than as a chart that quietly reads 20% off.
 *
 * ## What it cannot do
 *
 * It reads declarations, not the cascade or the render. In particular it cannot see
 * whether `grid-template-rows: subgrid` is honoured — the spec makes a scroll container
 * an independent formatting context, which would turn `subgrid` into `none` and let the
 * ticks drift again while every assertion here still passed. Chrome 148 does honour it;
 * that is a browser measurement, and it is in the PR along with the after figures.
 */

const readCss = async () => (await readFile(path.join(root, "src", "styles.css"), "utf8")).replaceAll("\r\n", "\n");
const readTsx = () => readFile(path.join(root, "src", "expanded-views.tsx"), "utf8");
const withoutComments = (source) => source.replace(/\/\*[\s\S]*?\*\//gu, "");

/** The last declaration of `property` inside the rule for `selector`. */
function declaration(css, selector, property) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const rules = [...css.matchAll(new RegExp(`(?:^|\\})\\s*${escaped}\\s*\\{([^}]*)\\}`, "gu"))];
  for (const rule of rules.reverse()) {
    const found = [...rule[1].matchAll(new RegExp(`(?:^|;)\\s*${property}\\s*:\\s*([^;]+)`, "gu"))];
    if (found.length > 0) return found.at(-1)[1].trim();
  }
  return null;
}

/**
 * The three offset forms this chart uses, as a fraction of the row. Deliberately not a
 * general CSS evaluator: an offset written some other way should fail here and be read
 * by a person, not guessed at.
 */
function fraction(value) {
  if (value === null) return null;
  const text = value.trim();
  if (/^0(?:px|%)?$/u.test(text)) return 0;
  const percent = /^(\d+(?:\.\d+)?)%$/u.exec(text);
  if (percent) return Number(percent[1]) / 100;
  const ratio = /^calc\(\s*100%\s*\/\s*(\d+(?:\.\d+)?)\s*\)$/u.exec(text);
  if (ratio) return 1 / Number(ratio[1]);
  return { unparsed: text };
}

/** The scale the chart draws: the top of the bar is 120%, the bottom is 0. */
const CEILING = 120;
const TICKS = [120, 100, 60, 0];
const expected = (value) => (CEILING - value) / CEILING;

test("every tick sits where its own value does on the bar's track", async () => {
  const css = withoutComments(await readCss());
  for (const [index, value] of TICKS.entries()) {
    const top = declaration(css, `.horizon-y-labels span:nth-child(${index + 1})`, "top");
    assert.ok(top !== null, `no offset for the ${value}% tick — is it still :nth-child(${index + 1})?`);
    const got = fraction(top);
    assert.ok(typeof got === "number", `the ${value}% tick is at 「${top}」, which this file cannot read (#133)`);
    assert.ok(Math.abs(got - expected(value)) < 1e-9,
      `the ${value}% tick is at ${(got * 100).toFixed(3)}% of the track; ${value} of ${CEILING} is `
      + `${(expected(value) * 100).toFixed(3)}%`);
  }
});

test("each grid line names the same offset as its tick", async () => {
  const css = withoutComments(await readCss());
  // The 0 line is drawn by the bar's own baseline rather than a `.horizon-guide`, so
  // only the three that have one are paired.
  for (const value of TICKS.filter((tick) => tick !== 0)) {
    const guide = declaration(css, `.horizon-guide.g${value}`, "top");
    assert.ok(guide !== null, `no .horizon-guide.g${value}`);
    const tick = declaration(css, `.horizon-y-labels span:nth-child(${TICKS.indexOf(value) + 1})`, "top");
    assert.deepEqual(fraction(guide), fraction(tick),
      `the ${value}% line is at 「${guide}」 and its tick at 「${tick}」. Two scales for one chart is #133`);
  }
  assert.equal(fraction(declaration(css, ".horizon-y-labels span:nth-child(4)", "top")), 1,
    "the 0 tick belongs at the bar's baseline, which is the bottom of the track");
});

/**
 * `:nth-child` couples the offsets to the order the labels are written in. Reordering
 * the markup would move every tick without touching a single offset.
 */
test("the labels are written in the order the offsets assume", async () => {
  const tsx = await readTsx();
  const block = /<div className="horizon-y-labels">([\s\S]*?)<\/div>/u.exec(tsx);
  assert.ok(block, "expected the tick labels");
  const written = [...block[1].matchAll(/<span>([^<]+)<\/span>/gu)].map(([, text]) => text.trim());
  assert.deepEqual(written, ["120%", "100%", "60%", "0"],
    "the offsets are keyed by position, so this order is load-bearing (#133)");
});

/**
 * The structure that makes one scale possible: the rows and the definite height on the
 * wrapper, the grid borrowing them. Without a definite height `minmax(0, 1fr)` has
 * nothing to resolve against and the bar row collapses to 0 — measured, on the way to
 * this fix.
 */
test("one element owns the rows, and the grid borrows them", async () => {
  const css = withoutComments(await readCss());

  const rows = declaration(css, ".horizon-plot", "grid-template-rows");
  assert.ok(rows, "expected .horizon-plot to own the row template");
  assert.match(rows, /\[bar\]\s*minmax\(\s*0\s*,\s*1fr\s*\)/u,
    "the bar's track has to be the flexible row, or the labels below it steal from it");
  assert.match(declaration(css, ".horizon-plot", "height") ?? "", /^\d+px$/u,
    "a definite height, or minmax(0, 1fr) resolves to 0 and the bar row collapses");

  assert.equal(declaration(css, ".horizon-grid", "grid-template-rows"), "subgrid",
    ".horizon-grid must borrow the rows rather than define its own (#133)");
  // The height and the bottom reserve moved to the wrapper. Left on the grid they would
  // apply to a box that no longer sizes the rows.
  assert.equal(declaration(css, ".horizon-grid", "height"), null,
    ".horizon-grid should take its height from the rows it borrows");
  const padding = declaration(css, ".horizon-grid", "padding");
  assert.ok(padding === null || /^0\s+\S+$/u.test(padding),
    `.horizon-grid's padding is 「${padding}」; the bottom reserve belongs to .horizon-plot now`);

  assert.equal(declaration(css, ".horizon-y-labels", "grid-row"), "bar",
    "the ticks' box has to be the bar's row, which is the whole point (#133)");
});
