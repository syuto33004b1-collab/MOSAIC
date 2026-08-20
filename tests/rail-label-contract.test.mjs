import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * The four-week capacity rail already had `grid-template-columns: repeat(4, 1fr)`
 * and still let its week labels collide, because each label was absolutely
 * positioned inside its bar. An out-of-flow box belongs to no track, so the
 * grid could not keep the weeks apart.
 *
 * Measured on main: "100%" is 26.2px at the 10px floor while a segment was
 * 19.56px from 390 to 1024px and 21.25px at 1920px. The label is wider than its
 * segment at every width. Three pairs overlapped up to about 1400px, and 3 to
 * 15 labels left the rail's own box at every width from 390 to 1920.
 *
 * Two properties now carry the fix, and this file pins both:
 * - bar and label in distinct tracks, so no box is placed over another;
 * - `min-content` as the track floor, which with `nowrap` on the label is the
 *   label's whole width, so the text does not overflow its track into the next.
 *
 * Distinct tracks alone would not be enough, and neither would the floor alone.
 *
 * ## What this cannot do
 *
 * It reads declarations. It does not resolve the cascade, so specificity,
 * `!important` and conditional rules can all beat what it reads, and it does
 * not see the rendered boxes at all — nor the other ways a box can end up over
 * its neighbour (`transform`, negative margins, explicit overlapping
 * placement). The brace matching is flat, so CSS nesting would break the
 * selector attribution. The DOM half of the contract is asserted against a
 * rendered tree in src/App.test.tsx, and the rendered geometry at
 * 390/820/1024/1440/1920px, including every label forced to 99999%, is in the PR.
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

/** Longhand plus the shorthands that can also set the track lists. */
const COLUMN_PROPS = ["grid-template-columns", "grid-template", "grid"];

test("no rule takes the week label out of the grid", async () => {
  const css = withoutComments(await read()).replaceAll("\r\n", "\n");
  const rules = allRules(css, "\\.member-week-rail\\s+small");
  assert.ok(rules.length >= 1, "no .member-week-rail small rule found");
  const offenders = [];
  for (const { selector, body } of rules) {
    for (const value of declarations(body, "position")) {
      // Absolute and fixed remove the label from its track, which is the bug.
      // Sticky keeps it in flow, so it is not part of this contract.
      if (/^(?:absolute|fixed)$/u.test(value)) offenders.push(`${selector.slice(0, 50)} => position: ${value}`);
    }
    // nowrap is half of why min-content reserves the label's width: without it
    // the label's min-content is its longest word, and "1件未対応 · 1件確認待ち"
    // would wrap inside a track sized for one segment of it.
    for (const value of declarations(body, "white-space")) {
      if (/^(?:normal|pre-line|pre-wrap|break-spaces)$/u.test(value)) offenders.push(`${selector.slice(0, 50)} => white-space: ${value}`);
    }
  }
  assert.deepEqual(
    offenders,
    [],
    "an out-of-flow or wrapping label defeats the track that is supposed to hold it:\n  " + offenders.join("\n  "),
  );
});

test("the rail's tracks are never narrower than the label they hold", async () => {
  const css = withoutComments(await read()).replaceAll("\r\n", "\n");
  const decls = railRules(css).flatMap(({ selector, body }) =>
    COLUMN_PROPS.flatMap((prop) => declarations(body, prop).map((value) => ({ selector, prop, value }))));
  assert.ok(decls.length >= 1, "nothing sets the rail's columns");
  const rogue = decls
    .filter((d) => !/repeat\(\s*4\s*,\s*minmax\(\s*min-content\s*,\s*1fr\s*\)\s*\)/u.test(d.value))
    .map((d) => `${d.selector.slice(0, 50)} => ${d.prop}: ${d.value}`);
  assert.deepEqual(
    rogue,
    [],
    "a track that can shrink below its label lets the text overflow into the next week:\n  " + rogue.join("\n  "),
  );
});

test("the bar and its label sit in one column, in two rows", async () => {
  const css = withoutComments(await read()).replaceAll("\r\n", "\n");
  const rules = railRules(css);
  // Every rail rule, not just the one that sets the columns: a media query that
  // overrides only grid-auto-flow puts every label one to three weeks away from
  // its own bar, and would pass a check that read the base rule alone.
  // Tracks mean nothing if the box is not a grid, and without column flow the
  // eight children fill row 1 four at a time.
  for (const [prop, expected, needed] of [
    ["display", /^grid$/u, true],
    ["grid-auto-flow", /^column$/u, true],
    ["grid-template-rows", /^[^;]+\s+[^;\s]+$/u, true],
  ]) {
    const found = rules.flatMap(({ selector, body }) => declarations(body, prop).map((value) => ({ selector, value })));
    if (needed) assert.ok(found.length >= 1, `no rail rule declares ${prop}`);
    const wrong = found.filter((d) => !expected.test(d.value)).map((d) => `${d.selector.slice(0, 40)} => ${prop}: ${d.value}`);
    assert.deepEqual(wrong, [], `every rail rule must keep ${prop} intact:\n  ` + wrong.join("\n  "));
  }
  // The rail's box has to contain both rows. `auto` is the only value that does
  // so whatever the label needs; the old `height: 39px` against a 47px need is
  // how the label came to sit outside the rail. This is deliberately strict —
  // a large enough fixed height would also work, and would still fail here.
  const heights = rules.flatMap(({ selector, body }) =>
    declarations(body, "height").filter((v) => !/^auto$/u.test(v)).map((v) => `${selector.slice(0, 40)} => height: ${v}`));
  assert.deepEqual(heights, [], "a fixed rail height stops the box growing with its label row:\n  " + heights.join("\n  "));
});
