import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * The floor under every target, and the tiers above it.
 *
 * #190 reported three tiers on the desktop — 36px for the toolbars and the assignment bars,
 * 40px for the input row, 44px for the icon and primary buttons — and asked whether they
 * should be one. Measured across all nine screens at 1425px, the tiers are not the problem:
 * they are deliberate, and a fourth thing was.
 *
 * | target | measured | where |
 * | --------------------------- | ---------------- | ------------------- |
 * | `.inline-search`'s field    | 200 x **18.2px** | seven screens |
 * | `.field-flag` tick boxes    | 52.3 x **21.6px** | 項目定義, eleven of them |
 * | `.profile-request-submit` label | 1036.2 x **23px** | 項目定義 |
 * | `.skill-need-link`          | 34.5 x **23.6px** | スキルマップ, four |
 * | `.csv-presets` name field   | 177 x **21px**   | 項目定義 |
 *
 * The search pill was the worst of them and the least visible: a `<div>` 200 x 40px with an
 * 18.2px input inside it, so a click 3px below the top edge landed on the wrapper and did
 * nothing — `document.activeElement` unchanged. It is a `<label>` now, which makes the whole
 * pill the target. The preset name field had no styling at all: a 21px browser default beside
 * a 40px button.
 *
 * The tiers stay. 620px and below already raises the 36px controls to 44px, which is the
 * intent — a finger gets 44px, a mouse gets density — and raising the desktop to 44px would
 * put `.assignment` back to 44px and undo #192's rows. WCAG 2.5.5's 44px is AAA; 2.5.8's 24px
 * is AA. AA everywhere, AAA where a finger is expected.
 *
 * ## What this checks
 *
 * The floors it can see in the stylesheet, and that the seven pills are labels rather than
 * divs. It cannot measure a rendered target — that sweep is in the PR, and it reads zero
 * targets under 24px on all nine screens at 1425px and at 375px.
 */

const readCss = () => readFile(path.join(root, "src", "styles.css"), "utf8");
const withoutComments = (css) => css.replace(/\/\*[\s\S]*?\*\//gu, "");

test("the small tick boxes and the inline link clear WCAG 2.5.8's floor", async () => {
  const css = withoutComments(await readCss()).replaceAll("\r\n", "\n");
  const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/gu)];
  const floorFor = (selector) => rules
    .filter(([, sel]) => sel.split(",").some((part) => part.trim() === selector))
    .flatMap(([, , body]) => [...body.matchAll(/(?:^|;)\s*min-height\s*:\s*([^;]+)/gu)].map((m) => m[1].trim()));

  for (const selector of [".csv-columns .field-flag", ".org-flag-set .field-flag", ".skill-need-link"]) {
    const floors = floorFor(selector);
    assert.ok(floors.length > 0, `${selector} has no min-height; measured 21.6-23.6px, under the 24px floor (#190)`);
    for (const value of floors) {
      assert.ok(/^\d+(?:\.\d+)?px$/u.test(value) && Number.parseFloat(value) >= 24,
        `${selector} declares min-height: ${value}; WCAG 2.5.8 asks for 24px (#190)`);
    }
  }

  // The preset name field had no box of its own at all — a browser default beside a 40px
  // button. It takes the input row's 40px, which is the tier it belongs to.
  const preset = floorFor(".csv-presets > input");
  assert.deepEqual(preset, ["40px"],
    "`.csv-presets > input` should take the input row's 40px like every other field on that screen (#190)");
});

test("the search pill is a label, so the whole pill is the target", async () => {
  const tsx = await readFile(path.join(root, "src", "expanded-views.tsx"), "utf8");
  const divs = [...tsx.matchAll(/<div className="inline-search"/gu)];
  assert.deepEqual(divs.map((m) => m.index), [],
    "a `<div>` wrapper leaves only the input clickable — measured, 18.2px of a 200 x 40px pill, and "
    + "clicking the pill did not focus the field (#190)");
  const labels = [...tsx.matchAll(/<label className="inline-search"/gu)];
  assert.ok(labels.length >= 7, `expected the seven search pills to be labels, found ${labels.length}`);

  // And the cursor says the whole pill is the field.
  const css = withoutComments(await readCss());
  const rule = css.match(/(?:^|\})\s*\.inline-search\s*\{([^}]*)\}/u);
  assert.ok(rule, "expected the .inline-search rule");
  assert.match(rule[1], /cursor:\s*text/u, "the pill takes the clicks now, so it should read as the field (#190)");
});
