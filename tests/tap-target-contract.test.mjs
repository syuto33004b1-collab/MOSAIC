import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * The panel close button's tap target.
 *
 * 44px is what everything else here asks for — `.icon-button`, `.primary-button`, the
 * drawer's own buttons, `.nav-item` at narrow widths, and every form field. This one was
 * 33x33: past WCAG 2.5.8's 24px, short of 2.5.5's 44px, and #122 left exactly one way to
 * close a panel, so it was the smallest target on the screen it appears on (#182).
 *
 * A stylesheet check rather than a rendered one, for the reason #170 exists: `.close-button`
 * is declared twice — the base rule and the theme layer that follows it — and the theme
 * rule was originally written against a class no component wears, so it did nothing at all
 * for a while. A test that reads one of the two rules can pass while the other undoes it.
 *
 * Measured in Chrome with this in place, at 1440px and 375px: the box is 44x44 and the hit
 * area through the centre is 44px on both axes. The corners are outside it, because the
 * button is a circle (`border-radius: 50%`, from #170) — 3px in from the top left misses,
 * 8px in hits. The shape is not this file's business; the floor is.
 *
 * What this does not model, so that nobody reads it as a guarantee of the computed value:
 * specificity, `!important`, cascade layers, `all`, a rule in another stylesheet or an
 * inline style, and whether a media block's condition actually holds. It reads every rule
 * whose subject is this button and requires each of them to keep the floor — which is
 * stricter than the cascade needs, and is what catches one of the two rules drifting.
 */

const read = () => readFile(path.join(root, "src", "styles.css"), "utf8");
const withoutComments = (css) => css.replace(/\/\*[\s\S]*?\*\//gu, "");

/**
 * Does this selector list style the button itself, rather than something inside it?
 *
 * The subject of a selector is its last compound, so `.close-button svg` is a rule about
 * the icon and `button.close-button`, `.close-button:hover` and `.close-button[disabled]`
 * are rules about the button. A first version matched `.close-button` anywhere in the
 * selector text, which took the icon's rule in and left the qualified ones out — the
 * evaluation on #182 asked.
 */
const stylesTheButton = (selectorList) => selectorList.split(",").some((selector) => {
  const subject = selector.trim().split(/[\s>+~]+/u).at(-1) ?? "";
  return /\.close-button(?![\w-])/u.test(subject);
});

/** Every `.close-button` rule body, in document order, top level and inside media blocks. */
const closeButtonRules = (css) => [...css.matchAll(/([^{}]+)\{([^{}]*)\}/gu)]
  .filter(([, selector]) => stylesTheButton(selector))
  .map(([, , declarations]) => declarations);

const declared = (bodies, property) => [...bodies.join(";")
  .matchAll(new RegExp(`(?:^|;)\\s*${property}\\s*:\\s*([^;]+)`, "gu"))].map((match) => match[1].trim());

test("the panel close button keeps a 44px floor, in whichever rule wins", async () => {
  const bodies = closeButtonRules(withoutComments(await read()));
  assert.ok(bodies.length >= 1, "expected at least one .close-button rule");

  // The logical properties too: `min-inline-size` is the same declaration by another name,
  // and a 24px one of those would be missed by a scan that only knew the physical spelling.
  for (const [physical, logical] of [["min-width", "min-inline-size"], ["min-height", "min-block-size"]]) {
    const values = [...declared(bodies, physical), ...declared(bodies, logical)];
    assert.ok(values.length > 0, `.close-button declares no ${physical}; without it the button is `
      + "as small as the icon inside it plus its border — measured, 20px (#182)");
    // Every one of them, not just the last: a later 24px would be a quiet downgrade.
    const wrong = values.filter((value) => value !== "44px");
    assert.deepEqual(wrong, [], `${physical} must stay 44px to match the other tap targets here, `
      + `found: ${wrong.join(", ")} (#182)`);
  }

  // A fixed box under the floor is not a bug — `min-*` wins — but it is how this got to
  // 33px, so it should not come back looking like the intended size.
  for (const property of ["width", "height", "inline-size", "block-size"]) {
    const wrong = declared(bodies, property)
      .filter((value) => /^\d+(?:\.\d+)?px$/u.test(value) && Number.parseFloat(value) < 44);
    assert.deepEqual(wrong, [], `.close-button sets ${property} below the 44px floor (${wrong.join(", ")}); `
      + "the floor still wins, but the smaller number is what the button used to be (#182)");
  }

  // The floor is a floor, so the box can grow — and the theme made this a circle, which an
  // ellipse is not. From the evaluation on #182.
  assert.deepEqual(declared(bodies, "aspect-ratio"), ["1"],
    "a circular button with only a minimum size needs `aspect-ratio: 1`, or content that grows "
    + "on one axis turns it into an ellipse (#170, #182)");
});
