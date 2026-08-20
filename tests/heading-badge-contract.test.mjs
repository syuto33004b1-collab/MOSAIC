import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * `.card-heading > span` was a fixed 24x24 circle with `place-items: center`,
 * written for a one-digit count. Two of its three callers pass prose instead,
 * and `place-items: center` centres overflow rather than clipping it, so both
 * spilled below their heading at every width from 390 to 1440: 「制限なし」 to
 * 2 lines and 5px, 「N件未対応 · N件確認待ち」 to 6 lines and 65px. The count
 * caller fitted up to 4 digits and spilled 6px at 5.
 *
 * One selector, two jobs. Rather than split the callers it is now one job — a
 * chip that hugs its content — so a single digit keeps the same 24x24 circle
 * and anything longer grows sideways rather than downwards.
 *
 * ## What this file pins
 *
 * The declarations that make that true, against every rule targeting the badge,
 * and their *presence* as well as their values: deleting `white-space` is as
 * much a regression as setting it to `normal`.
 *
 * ## What it cannot do
 *
 * It reads declarations, so it resolves no cascade and knows nothing about
 * whether anything fits — a narrow enough font could keep two glyphs inside
 * 24px, and a wide enough one could push a single glyph past it. The rendered
 * geometry across all nine screens, at 320/390/1440px, with the count driven
 * from 1 to 6 digits and with unbroken titles, is in the PR.
 */

const read = () => readFile(path.join(root, "src", "styles.css"), "utf8");
const withoutComments = (css) => css.replace(/\/\*[\s\S]*?\*\//gu, "");

/**
 * Every rule whose selector targets the badge. `:has()` and similar are
 * excluded so that a rule *matching on* the badge is not mistaken for one
 * styling it; a differently written equivalent selector would be missed.
 */
function badgeRules(css) {
  return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/gu)]
    .map(([, sel, body]) => ({ selector: sel.trim().replace(/\s+/gu, " "), body }))
    .filter(({ selector }) => /\.card-heading\s*>\s*span(?![\w-])/u.test(selector) && !/:has\(/u.test(selector));
}

/** Every declaration of `prop`, `!important` stripped. */
function declarations(body, prop) {
  return [...body.matchAll(new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+)`, "gu"))]
    .map((m) => m[1].replace(/!\s*important/iu, "").trim());
}

const all = (rules, prop) => rules.flatMap(({ selector, body }) => declarations(body, prop).map((value) => ({ selector, value })));
const show = (d, prop) => `${d.selector.slice(0, 40)} => ${prop}: ${d.value}`;

test("the badge has no width or height to outgrow", async () => {
  const css = withoutComments(await read()).replaceAll("\r\n", "\n");
  const rules = badgeRules(css);
  assert.ok(rules.length >= 1, "no .card-heading > span rule found");
  // `* { box-sizing: border-box }` is what makes min-width: 24px an outer 24px
  // rather than 24 + padding.
  assert.match(css, /\*\s*\{[^}]*box-sizing:\s*border-box/u, "the 24px contract assumes border-box on everything");
  const offenders = [
    // A length here is the original bug: 24px held a digit and cut prose to two
    // characters a line.
    ...all(rules, "width").filter((d) => !/^(?:auto|max-content|fit-content|min-content)$/u.test(d.value)).map((d) => show(d, "width")),
    // A fixed height spills again as soon as the line box exceeds it; min-height
    // grows. `inline-size` and `block-size` are the same properties by another
    // name, so they are held to the same rule.
    ...all(rules, "height").filter((d) => d.value !== "auto").map((d) => show(d, "height")),
    ...all(rules, "inline-size").filter((d) => !/^(?:auto|max-content|fit-content|min-content)$/u.test(d.value)).map((d) => show(d, "inline-size")),
    ...all(rules, "block-size").filter((d) => d.value !== "auto").map((d) => show(d, "block-size")),
    ...all(rules, "max-width").filter((d) => d.value !== "none").map((d) => show(d, "max-width")),
  ];
  assert.deepEqual(offenders, [], "the badge must size to its content:\n  " + offenders.join("\n  "));
  const minHeights = all(rules, "min-height").concat(all(rules, "min-block-size"));
  assert.ok(minHeights.length >= 1, "the badge needs min-height: 24px, or a single digit is only as tall as its line box");
  const wrongHeight = minHeights.filter((d) => d.value !== "24px").map((d) => show(d, "min-height"));
  assert.deepEqual(wrongHeight, [], "min-height must stay 24px to match min-width:\n  " + wrongHeight.join("\n  "));
});

test("the badge keeps a single digit circular", async () => {
  const css = withoutComments(await read()).replaceAll("\r\n", "\n");
  const rules = badgeRules(css);
  const minWidths = all(rules, "min-width").concat(all(rules, "min-inline-size"));
  assert.ok(minWidths.length >= 1, "the badge needs a min-width, or `7` collapses to the width of one glyph");
  // Exactly 24px: smaller and a digit is not circular, larger and short prose
  // gets a lozenge of empty space.
  const wrong = minWidths.filter((d) => d.value !== "24px").map((d) => show(d, "min-width"));
  assert.deepEqual(wrong, [], "min-width must be exactly 24px, matching the height:\n  " + wrong.join("\n  "));

  const radii = all(rules, "border-radius");
  assert.ok(radii.length >= 1, "the badge needs a border-radius; without one a wide chip is a rectangle");
  // A percentage follows the box, so a wide chip becomes an ellipse. A length of
  // at least half the 24px height gives a circle when square and a stadium when
  // wide — 12px is enough, and this repo writes 999px.
  const notPill = radii.filter((d) => {
    if (/%/u.test(d.value)) return true;
    const lengths = [...d.value.matchAll(/(\d+(?:\.\d+)?)px/gu)].map((m) => Number(m[1]));
    return lengths.length === 0 || lengths.some((n) => n < 12);
  }).map((d) => show(d, "border-radius"));
  assert.deepEqual(
    notPill,
    [],
    "a percentage radius makes a wide chip an ellipse, and under 12px it stops being a pill at 24px tall:\n  " + notPill.join("\n  "),
  );
});

test("the badge neither wraps nor gets squeezed", async () => {
  const css = withoutComments(await read()).replaceAll("\r\n", "\n");
  const rules = badgeRules(css);
  const wraps = all(rules, "white-space");
  assert.ok(wraps.length >= 1, "the badge needs white-space: nowrap; without it the prose wraps and spills again");
  const wrapping = wraps.filter((d) => !/^(?:nowrap|pre)$/u.test(d.value)).map((d) => show(d, "white-space"));
  assert.deepEqual(wrapping, [], "a wrapping badge spills below its heading again:\n  " + wrapping.join("\n  "));

  const flexes = all(rules, "flex");
  const shrinks = all(rules, "flex-shrink");
  assert.ok(flexes.length + shrinks.length >= 1, "the badge needs flex-shrink: 0, or a long heading squeezes it to min-content");
  const shrinkable = [
    ...flexes.filter((d) => {
      const parts = d.value.split(/\s+/u);
      // `flex: none` is 0 0 auto. A single number is <grow>, so `flex: 0` means
      // `0 1 0%` — shrink 1, which is exactly the regression.
      if (d.value === "none") return false;
      return parts.length >= 2 ? Number(parts[1]) !== 0 : true;
    }).map((d) => show(d, "flex")),
    ...shrinks.filter((d) => Number(d.value) !== 0).map((d) => show(d, "flex-shrink")),
  ];
  assert.deepEqual(shrinkable, [], "a shrinkable badge is squeezed back to the width that caused the bug:\n  " + shrinkable.join("\n  "));

  // The other half of not shrinking: a flex item will not go below its
  // min-content width unless told to, so a title with nothing to break on
  // pushed the badge out of the heading entirely.
  const titleRules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/gu)]
    .map(([, sel, body]) => ({ selector: sel.trim().replace(/\s+/gu, " "), body }))
    .filter(({ selector }) => /\.card-heading\s*>\s*div(?![\w-])/u.test(selector));
  const zeroed = titleRules.flatMap(({ body }) => declarations(body, "min-width").concat(declarations(body, "min-inline-size")))
    .filter((v) => /^0(?:px)?$/u.test(v));
  assert.ok(zeroed.length >= 1, ".card-heading > div needs min-width: 0, or an unbreakable title pushes the badge out of the heading");

  // `justify-content: space-between` distributes free space and guarantees
  // nothing when there is none: at 320px the widest badge left a 0px gap.
  const headingRules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/gu)]
    .map(([, sel, body]) => ({ selector: sel.trim().replace(/\s+/gu, " "), body }))
    .filter(({ selector }) => selector.split(",").some((part) => part.trim() === ".card-heading"));
  const gaps = headingRules.flatMap(({ body }) => declarations(body, "gap").concat(declarations(body, "column-gap")));
  const positive = gaps.filter((v) => /^(\d+(?:\.\d+)?)px/u.test(v) && Number(v.match(/^(\d+(?:\.\d+)?)/u)[1]) > 0);
  assert.ok(positive.length >= 1, ".card-heading needs a column gap; space-between collapses to 0 when the row is full");
});
