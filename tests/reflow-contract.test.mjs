import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * One bug, three places: a container that has to reflow was given
 * `flex-wrap: wrap` only inside `@media (max-width: 620px)`, while its content
 * stopped fitting far above that. Measured before the fix, at 820px:
 * `.view-toolbar` cut 213px off the メンバーを追加 button — the whole button —
 * plus the sort label and the favourites toggle, and `.pulse-strip` cut 21px
 * off its last metric. The form grids had the matching version with fixed
 * track lists: `120px minmax(0,1fr) 160px 120px` gave the flexible track 0px
 * below ~564px, so its input overflowed a zero-width cell and the label landed
 * on its neighbour.
 *
 * ## What this cannot do
 *
 * It reads declarations, so it cannot tell whether anything actually fits. The
 * widths were swept with getComputedStyle at 390, 485, 625, 865, 945, 1085 and
 * 1425 and recorded in the PR; this only stops the shapes that caused it.
 */

const read = () => readFile(path.join(root, "src", "styles.css"), "utf8");
const withoutComments = (css) => css.replace(/\/\*[\s\S]*?\*\//gu, "");

/** The rule body for a selector, taken from outside any media query. */
function baseRule(css, selector) {
  // Strip media blocks so a breakpoint-only declaration cannot satisfy the check.
  const base = css.replace(/@media[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/gu, "");
  const m = base.match(new RegExp(`(?:^|\\})\\s*${selector}\\s*\\{([^}]*)\\}`, "u"));
  return m ? m[1] : null;
}

test("the rows that have to reflow wrap without waiting for a breakpoint", async () => {
  const css = withoutComments(await read()).replaceAll("\r\n", "\n");
  for (const selector of ["\\.view-toolbar", "\\.pulse-strip"]) {
    const body = baseRule(css, selector);
    assert.ok(body, `no unconditional rule for ${selector}`);
    assert.match(
      body,
      /flex-wrap:\s*wrap/u,
      `${selector} must wrap outside a media query — its content stops fitting well above 620px`,
    );
  }
});

/** True when every track in the list is a bare length, so none can shrink. */
function allTracksFixed(value) {
  const tracks = value.split(/\s+(?![^(]*\))/u).filter(Boolean);
  if (tracks.length === 0) return false;
  return tracks.every((t) => /^\d+(?:\.\d+)?(?:px|rem|em)$/u.test(t));
}

test("no form grid is built from fixed tracks alone", async () => {
  const css = withoutComments(await read()).replaceAll("\r\n", "\n");
  // These forms sit inside the workspace, whose width is whatever is left over,
  // so a track list that cannot shrink overflows rather than reflowing.
  const forms = [
    "\\.field-catalog-form",
    "\\.role-permission-form",
    "\\.skills-view \\.skill-catalog-form,\\s*\\n\\.org-view \\.org-catalog-form",
    "\\.org-view \\.org-catalog-form",
  ];
  const offenders = [];
  for (const selector of forms) {
    const m = css.match(new RegExp(`${selector}\\s*\\{([^}]*)\\}`, "u"));
    if (!m) continue;
    const cols = m[1].match(/grid-template-columns:\s*([^;]+)/u);
    if (!cols) continue;
    const value = cols[1].trim();
    if (allTracksFixed(value)) offenders.push(`${selector.replace(/\\/gu, "")} => ${value}`);
  }
  assert.deepEqual(
    offenders,
    [],
    "every track is a fixed length, so the grid overflows instead of reflowing:\n  " + offenders.join("\n  "),
  );
});

test("the toolbar's search box can give up width", async () => {
  const css = withoutComments(await read()).replaceAll("\r\n", "\n");
  const body = baseRule(css, "\\.inline-search");
  assert.ok(body, "no unconditional .inline-search rule");
  // flex wraps before it shrinks, so a fixed width here does not merely make the
  // box wide — it pushes the last control onto a second line. 235px did exactly
  // that at 1440px, for the sake of 3px.
  assert.doesNotMatch(body, /(?:^|;)\s*width:\s*\d/u, ".inline-search should size from flex-basis, not a fixed width");
  assert.match(body, /flex:\s*\d+\s+\d+\s+\d+px/u, ".inline-search needs a shrinkable flex basis");
});
