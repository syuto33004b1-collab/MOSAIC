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
 * A declaration contract, not the rendered geometry: that the tick for a value and the
 * line for the same value name the same offset, that the offset is the fraction the
 * value implies, and that the structure which lets them share a row is intact. A drift
 * like the one above shows up as a mismatch here rather than as a chart that quietly
 * reads 20% off.
 *
 * The structural half exists because of one spec detail. A scroll container establishes
 * an independent formatting context, which makes `grid-template-rows: subgrid` compute
 * to `none` — so the sideways scroll has to belong to the plot rather than to the grid
 * that borrows its rows, and the ticks have to be sticky inside it. Chrome 148 honours
 * subgrid on a scroller either way, measured, and an earlier version of this change
 * relied on that; a conforming browser would have put the ticks back on their own scale
 * with every assertion here still green. That is what the `overflow-x` checks are for.
 *
 * ## What it cannot do
 *
 * It reads declarations, so it does not weigh the cascade and cannot see a rendered
 * coordinate. The figures above and below are browser measurements, in the PR: at 1425,
 * 605 and 375, and at 4, 8 and 12 weeks.
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
  for (const value of TICKS) {
    const top = declaration(css, `.horizon-y-labels .t${value}`, "top");
    assert.ok(top !== null, `no offset for the ${value}% tick — is it still .t${value}?`);
    const got = fraction(top);
    assert.ok(typeof got === "number", `the ${value}% tick is at 「${top}」, which this file cannot read (#133)`);
    assert.ok(Math.abs(got - expected(value)) < 1e-9,
      `the ${value}% tick is at ${(got * 100).toFixed(3)}% of the track; ${value} of ${CEILING} is `
      + `${(expected(value) * 100).toFixed(3)}%`);
  }
});

/**
 * Which side of its own offset each tick's box sits on. The interior ticks are centred,
 * because being centred on the line is the pairing the issue was about. The two at the
 * ends turn inward: centred, half of 「120%」 sat above the plot and was cut by
 * `overflow-y: hidden` — 8.1px of a 16.2px line box, measured. So the ceiling label
 * hangs from its line and the baseline label sits on it, and both stay legible.
 */
test("the end ticks turn inward so nothing is clipped", async () => {
  const css = withoutComments(await readCss());
  const transform = (value) => declaration(css, `.horizon-y-labels .t${value}`, "transform")
    ?? declaration(css, ".horizon-y-labels span", "transform");
  assert.equal(transform(120), "none", "the ceiling tick hangs from its line, or its top half is clipped");
  assert.equal(transform(0), "translateY(-100%)", "the baseline tick sits on the baseline rather than straddling it");
  for (const value of [100, 60]) {
    assert.equal(transform(value), "translateY(-50%)",
      `the ${value}% tick has to be centred on its line — that pairing is the whole of #133`);
  }
});

test("each grid line names the same offset as its tick", async () => {
  const css = withoutComments(await readCss());
  // The 0 line is drawn by the bar's own baseline rather than a `.horizon-guide`, so
  // only the three that have one are paired.
  for (const value of TICKS.filter((tick) => tick !== 0)) {
    const guide = declaration(css, `.horizon-guide.g${value}`, "top");
    assert.ok(guide !== null, `no .horizon-guide.g${value}`);
    const tick = declaration(css, `.horizon-y-labels .t${value}`, "top");
    assert.deepEqual(fraction(guide), fraction(tick),
      `the ${value}% line is at 「${guide}」 and its tick at 「${tick}」. Two scales for one chart is #133`);
  }
  assert.equal(fraction(declaration(css, ".horizon-y-labels .t0", "top")), 1,
    "the 0 tick belongs at the bar's baseline, which is the bottom of the track");
});

/**
 * The offsets key off a class per tick rather than a position, so the markup has to
 * carry those classes and each has to sit on the label for that value. A first version
 * used `:nth-child`, which made the document order load-bearing for every tick at once.
 */
test("each label carries the class its offset is keyed on", async () => {
  const tsx = await readTsx();
  const block = /<div className="horizon-y-labels">([\s\S]*?)<\/div>/u.exec(tsx);
  assert.ok(block, "expected the tick labels");
  const written = [...block[1].matchAll(/<span className="(t\d+)">([^<]+)<\/span>/gu)]
    .map(([, className, text]) => [className, text.trim()]);
  assert.deepEqual(written, [["t120", "120%"], ["t100", "100%"], ["t60", "60%"], ["t0", "0"]],
    "each tick's class has to name the value it labels (#133)");
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
  // The one that keeps the borrowing legal. A scroll container is an independent
  // formatting context, which makes `subgrid` compute to `none` — so the sideways
  // scroll has to be the plot's, and the ticks sticky inside it. Chrome 148 honours
  // subgrid on a scroller anyway, measured; this is so a conforming browser does not
  // quietly put the ticks back on their own scale.
  assert.equal(declaration(css, ".horizon-grid", "overflow-x"), null,
    ".horizon-grid must not be the scroll container, or `subgrid` is allowed to become `none`");
  assert.equal(declaration(css, ".horizon-plot", "overflow-x"), "auto",
    "the sideways scroll belongs to the plot");
  assert.equal(declaration(css, ".horizon-y-labels", "position"), "sticky",
    "inside the scroller the ticks have to be pinned, or they scroll away with the columns");
  assert.ok((declaration(css, ".horizon-y-labels", "background") ?? "").length > 0,
    "a sticky tick column needs an opaque background — the bars pass underneath");
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
