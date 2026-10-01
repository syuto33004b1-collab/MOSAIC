import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * The members list's month rail, and what keeps its labels apart and under their points.
 *
 * It began as bars, each with its label absolutely positioned inside: an out-of-flow box
 * belongs to no grid track, so the grid could not keep the weeks apart. Measured then,
 * "100%" was 26.2px at the 10px floor while a segment was 19.56px from 390 to 1024px, and
 * three pairs overlapped up to about 1400px.
 *
 * It is a line now (#580, #581): one line spanning the first row, each month's label its
 * own item in the second. Three things carry the layout, and this file pins all three:
 *
 * - the label in flow and unwrapped, so its track holds it;
 * - equal tracks, `repeat(var(--rail-points), minmax(0, 1fr))` with no column gap. The
 *   line places month i at (i + 0.5) / N of its width, a column's centre only while every
 *   column is the same width. `minmax(auto, 1fr)` let a wider label keep a wider column
 *   once the cell had room to spare, which put the points beside their labels;
 * - the table sized at max-content, where equal `fr` tracks resolve to the widest label,
 *   so no label is wider than its track.
 *
 * ## What this cannot do
 *
 * It reads declarations. It does not resolve the cascade, so specificity, `!important`
 * and conditional rules can all beat what it reads, and it does not see the rendered
 * boxes. The brace matching is flat, so CSS nesting would break the selector attribution.
 * The DOM half is asserted in src/App.test.tsx, and the rendered offsets between each
 * point and its label at 390/1024/1440px are in the PR.
 */

const read = () => readFile(path.join(root, "src", "styles.css"), "utf8");
const withoutComments = (css) => css.replace(/\/\*[\s\S]*?\*\//gu, "");

/** Every rule whose selector matches, media and container blocks included. */
function allRules(css, selector) {
  return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/gu)]
    .filter(([, sel]) => new RegExp(selector, "u").test(sel))
    .map(([, sel, body]) => ({ selector: sel.trim().replace(/\s+/gu, " "), body }));
}

/**
 * Every declaration of `prop`, `!important` stripped. All of them, not the last:
 * which one wins depends on specificity and `!important` across the whole
 * sheet, which this file does not model, so it holds every declaration to the
 * contract rather than guessing at a winner.
 */
function declarations(body, prop) {
  return [...body.matchAll(new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+)`, "gu"))]
    .map((m) => m[1].replace(/!\s*important/iu, "").trim());
}

/**
 * Rules that style the rail element itself rather than a descendant.
 * `.member-week-rail i` carries its own height and its own background, so a
 * plain substring match would be a false positive on every check here.
 *
 * A selector part targets the rail when its *last* compound mentions the class:
 * that keeps `td .member-week-rail` and `.member-week-rail.narrow`, and drops
 * `.member-week-rail i` and `.member-week-rail > small`.
 */
function railRules(css) {
  return allRules(css, "\\.member-week-rail(?![\\w-])").filter(({ selector }) =>
    selector.split(",").some((part) => {
      const last = part.trim().split(/\s*[ >+~]\s*/u).filter(Boolean).pop() ?? "";
      return /\.member-week-rail(?![\w-])/u.test(last);
    }));
}

test("no rule takes the month label out of its track", async () => {
  const css = withoutComments(await read()).replaceAll("\r\n", "\n");
  const rules = allRules(css, "\\.member-week-rail\\s+small");
  assert.ok(rules.length >= 1, "no .member-week-rail small rule found");
  const offenders = [];
  for (const { selector, body } of rules) {
    for (const value of declarations(body, "position")) {
      // Absolute and fixed remove the label from its track, which was the bug.
      if (/^(?:absolute|fixed)$/u.test(value)) offenders.push(`${selector.slice(0, 50)} => position: ${value}`);
    }
    // Without nowrap a label's min-content is its longest word, and the track that is
    // sized from it no longer holds the whole label.
    for (const value of declarations(body, "white-space")) {
      if (/^(?:normal|pre-line|pre-wrap|break-spaces)$/u.test(value)) offenders.push(`${selector.slice(0, 50)} => white-space: ${value}`);
    }
  }
  assert.deepEqual(
    offenders,
    [],
    "an out-of-flow or wrapping label defeats the track that is supposed to hold it:\n  " + offenders.join("\n  "),
  );
  const rows = rules.flatMap(({ body }) => declarations(body, "grid-row"));
  assert.ok(rows.includes("2"), "the labels must sit in the second row, under the line");
});

test("the rail's columns are equal, so each point sits over its own label", async () => {
  const css = withoutComments(await read()).replaceAll("\r\n", "\n");
  const rules = railRules(css);
  const columns = rules.flatMap(({ selector, body }) =>
    declarations(body, "grid-template-columns").map((value) => ({ selector, value })));
  assert.ok(columns.length >= 1, "nothing sets the rail's columns");
  const equal = /^repeat\(\s*var\(--rail-points(?:\s*,\s*\d+)?\)\s*,\s*minmax\(\s*0\s*,\s*1fr\s*\)\s*\)$/u;
  const rogue = columns.filter((d) => !equal.test(d.value)).map((d) => `${d.selector.slice(0, 50)} => grid-template-columns: ${d.value}`);
  assert.deepEqual(rogue, [], "columns that can differ in width put the line's points beside their labels:\n  " + rogue.join("\n  "));
  // A count written into the stylesheet goes stale the day the period changes.
  const pinned = rules.flatMap(({ selector, body }) =>
    ["grid-template-columns", "grid-template", "grid", "grid-auto-columns"].flatMap((prop) =>
      declarations(body, prop).map((value) => ({ selector, prop, value }))))
    .filter((d) => /repeat\(\s*\d/u.test(d.value) || d.prop === "grid-auto-columns")
    .map((d) => `${d.selector.slice(0, 50)} => ${d.prop}: ${d.value}`);
  assert.deepEqual(pinned, [], "the bucket count comes from the markup, as --rail-points:\n  " + pinned.join("\n  "));
  // A gap between columns shifts every centre but the middle one's off (i + 0.5) / N.
  const gaps = rules.flatMap(({ selector, body }) =>
    ["column-gap", "gap", "grid-column-gap"].flatMap((prop) => declarations(body, prop).map((value) => ({ selector, prop, value }))))
    .filter((d) => !/^0(?:px)?(?:\s+0(?:px)?)?$/u.test(d.value) && !(d.prop === "gap" && /^\S+\s+0(?:px)?$/u.test(d.value)))
    .map((d) => `${d.selector.slice(0, 50)} => ${d.prop}: ${d.value}`);
  assert.deepEqual(gaps, [], "a column gap moves the labels off the line's points:\n  " + gaps.join("\n  "));
});

test("the table gives the rail the width of its widest label, and the line spans the row", async () => {
  const css = withoutComments(await read()).replaceAll("\r\n", "\n");
  // Equal `fr` tracks resolve to the widest label only when the cell is sized at
  // max-content; a narrower cell would leave minmax(0, 1fr) tracks under their labels.
  const table = allRules(css, "^\\s*\\.member-table\\s*$").flatMap(({ body }) => declarations(body, "min-width"));
  assert.ok(table.includes("max-content"), "`.member-table` must keep `min-width: max-content`");
  const line = allRules(css, "\\.member-week-rail\\s*>\\s*\\.trend-line");
  assert.ok(line.length >= 1, "no rule places the line in the rail");
  const body = line.map((rule) => rule.body).join(";");
  assert.deepEqual(declarations(body, "grid-column"), ["1 / -1"], "the line must span every month's column");
  assert.deepEqual(declarations(body, "grid-row"), ["1"], "the line belongs in the first row");
  // The box has to contain both rows; a fixed height is how a label once sat outside it.
  const heights = railRules(css).flatMap(({ selector, body: railBody }) =>
    declarations(railBody, "height").filter((v) => !/^auto$/u.test(v)).map((v) => `${selector.slice(0, 40)} => height: ${v}`));
  assert.deepEqual(heights, [], "a fixed rail height stops the box growing with its label row:\n  " + heights.join("\n  "));
});
