import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * #312: `scripts/check-rendering.mjs` runs `color-contrast` in a real browser, but it was
 * reaching 62% of the text. axe stops deciding for any text whose own area is under four
 * times a filled, absolutely positioned pseudo-element found on it or on any ancestor — it
 * compares areas and never asks whether the two overlap. `.workspace::before`, an 88x4px
 * accent bar on the container of every screen, put 636 of 662 undecided nodes out of reach,
 * and five real contrast failures were sitting among them.
 *
 * ## What this file is
 *
 * A text check over the stylesheet and the sweep, pinning the three things that put the
 * coverage back: the bar is an element, the assignment percentage is not faded into its own
 * bar, and the sweep has a floor to fail against. The rendered evidence is the sweep itself
 * (`npm run test:render`), which measures 97.9%; this is what fails in `npm test`, without
 * a browser, when someone puts one of them back.
 *
 * ## What it does not prove
 *
 * Not the post-cascade value and not a ratio: a later rule could restore the opacity under
 * a different selector, and a new decoration drawn as a pseudo-element somewhere else is
 * caught by the sweep's floor rather than by anything here.
 */
const css = await readFile(path.join(root, "src", "styles.css"), "utf8");
const app = await readFile(path.join(root, "src", "App.tsx"), "utf8");
const sweep = await readFile(path.join(root, "scripts", "check-rendering.mjs"), "utf8");

test("the accent bar is an element, so the text around it can be measured", () => {
  assert.ok(!/\.workspace::before\s*\{/u.test(css),
    "`.workspace::before` is back. A filled, absolutely positioned pseudo-element on the "
    + "container of every screen makes every smaller piece of text under it undecidable for "
    + "`color-contrast`, wherever on the page that text actually sits (#312).");
  assert.ok(/\.workspace-accent\s*\{/u.test(css), "the accent bar lost its rule");
  assert.ok(/className="workspace-accent"/u.test(app), "the accent bar is not rendered");
});

test("the percentage on an assignment bar is not dissolved into the bar", () => {
  const rule = /\.assignment small\s*\{([^}]*)\}/u.exec(css);
  assert.ok(rule, "`.assignment small` lost its rule");
  assert.ok(!/opacity/u.test(rule[1]),
    "`.assignment small` is faded again. `opacity` mixes the text into the bar's own "
    + "background: at .72 the plum bar measured 2.88 against the 4.5 that 12px bold owes, "
    + "and the sky bar needs a full 1.0 to clear it, so no value below 1 works (#312).");
});

test("a weekend column reads its colours from the theme", () => {
  const weekend = /\.day-label\.weekend\s*\{([^}]*)\}/u.exec(css);
  const strong = /\.day-label\.weekend strong\s*\{([^}]*)\}/u.exec(css);
  assert.ok(weekend && strong, "the weekend day label lost a rule");
  // The two cool greys that were here predate the warm `:root` and measured 2.18 and 2.62
  // on `--paper-deep`; `.day-label.weekend` outranks the themed `.day-label`, so nothing
  // else was going to correct them.
  for (const [name, rule] of [["the weekday name", weekend[1]], ["the date", strong[1]]]) {
    assert.ok(/color:\s*var\(--muted-readable/u.test(rule),
      `${name} on a weekend column is back to a literal colour (#312)`);
  }
});

test("the sweep fails when it cannot reach most of the text", () => {
  const floor = /const CONTRAST_COVERAGE_FLOOR = (0\.\d+);/u.exec(sweep);
  assert.ok(floor, "the sweep lost its coverage floor (#312)");
  assert.ok(Number(floor[1]) >= 0.95, `the floor dropped to ${floor[1]}`);
  assert.ok(/coverage < CONTRAST_COVERAGE_FLOOR/u.test(sweep),
    "the floor is declared but nothing fails against it");
});
