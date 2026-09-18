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
  // else was going to correct them. Each token named to its closing bracket, or
  // `--muted-readable` matches `--muted-readable-dark` and the two could swap, or collapse
  // into one, with this still passing.
  assert.match(weekend[1], /color:\s*var\(--muted-readable\)/u,
    "the weekday name on a weekend column is not `var(--muted-readable)` (4.97 on --paper-deep) (#312)");
  assert.match(strong[1], /color:\s*var\(--muted-readable-dark\)/u,
    "the date on a weekend column is not `var(--muted-readable-dark)` (7.56, and darker than"
    + " the weekday name so the two keep their order) (#312)");
});

test("calendar day colours use dedicated tokens after today's glyph rule (#392)", () => {
  assert.match(css, /--calendar-saturday:\s*#1d4f91/u, "Saturday blue token missing from the effective palette");
  assert.match(css, /--calendar-holiday:\s*#a83e27/u, "holiday/Sunday red token missing from the effective palette");
  const sat = /\.day-label\.saturday strong\s*\{([^}]*)\}/u.exec(css);
  const sun = /\.day-label\.sunday strong\s*,\s*\.day-label\.holiday strong\s*\{([^}]*)\}/u.exec(css)
    || /\.day-label\.sunday strong\s*\{([^}]*)\}/u.exec(css);
  assert.ok(sat, "`.day-label.saturday strong` rule missing");
  assert.ok(sun, "`.day-label.sunday strong` / `.holiday strong` rule missing");
  assert.match(sat[1], /color:\s*var\(--calendar-saturday\)/u);
  assert.match(sun[1], /color:\s*var\(--calendar-holiday\)/u);
  // Source order: calendar rules must follow `.day-label.today strong` so they win.
  const todayAt = css.lastIndexOf(".day-label.today strong");
  const satAt = css.lastIndexOf(".day-label.saturday strong");
  const holidayAt = css.lastIndexOf(".day-label.holiday strong");
  assert.ok(todayAt >= 0 && satAt > todayAt && holidayAt > todayAt,
    "calendar colour rules must come after `.day-label.today strong` so today×Sat stays blue");
});

test("the sweep waits for the board heading pageMeta actually renders (#403)", () => {
  const title = /board:\s*\{[^}]*title:\s*"([^"]+)"/u.exec(app)?.[1];
  assert.equal(title, "アサインボード");
  assert.match(sweep, /\["アサインボード",\s*"アサインボード"\]/u);
  assert.match(sweep, /textContent\?\.trim\(\) === "アサインボード"/u);
});

test("the sweep fails when it cannot reach most of one state's text", () => {
  const floor = /const CONTRAST_COVERAGE_FLOOR = (0\.\d+);/u.exec(sweep);
  assert.ok(floor, "the sweep lost its coverage floor (#312)");
  assert.ok(Number(floor[1]) >= 0.95, `the floor dropped to ${floor[1]}`);
  assert.ok(/reach\.filter\(\(item\) => item\.share < CONTRAST_COVERAGE_FLOOR\)/u.test(sweep),
    "the floor is declared but no state is failed against it. Summing the sweep hides a"
    + " screen going dark: twenty nodes against seventeen hundred still totals 96% (#312).");
  // Nothing to decide means the rule did not run, which is the failure this number is for.
  assert.ok(/total === 0 \? 0 :/u.test(sweep),
    "a state with no color-contrast nodes reads as full coverage again (#312)");
});
