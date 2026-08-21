import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * #87 asked for one rule about truncated values, reachable by pointer, touch and
 * keyboard. Re-measured at 1440px after #75 changed the column widths, the only
 * thing actually cut anywhere was one kind of element: the `<small>` subtitle
 * under a name. Five on the board, eight on the project list, nine on the member
 * list, cut by 34–72px. Nothing else with `text-overflow: ellipsis` was cut —
 * not one of the fourteen assignment bars, the twenty-six names, or the
 * twenty-six custom-field cells.
 *
 * So the rule is: a value is either shown whole, or reachable from the row's
 * detail panel. Never hover only.
 *
 * - the subtitles wrap, so they are never cut
 * - the names keep their ellipsis, because the name column has to shrink (#75),
 *   and the row is a button that opens a panel showing the name in full
 * - the custom-field cells keep theirs for the same reason (#75 caps them on
 *   purpose), with the same route
 *
 * ## What this cannot do
 *
 * It reads declarations. That the route actually works — the row is a button, it
 * is tabbable, and the panel contains the whole subtitle — is asserted in
 * App.test.tsx and measured in the PR.
 */

const read = () => readFile(path.join(root, "src", "styles.css"), "utf8");
const withoutComments = (css) => css.replace(/\/\*[\s\S]*?\*\//gu, "");

/**
 * The value that wins for `property` among rules naming `selectorPart`. Document
 * order decides for the same selector at the same specificity, which is what
 * this file's layers are; `!important` is not modelled.
 */
const winningValue = (css, selectorPart, property) => {
  const bodies = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/gu)]
    .filter(([, selector]) => selector.includes(selectorPart))
    .map(([, , body]) => body).join(";");
  const matches = [...bodies.matchAll(new RegExp(`(?:^|;)[\\s]*${property}[\\s]*:[\\s]*([^;]+)`, "gu"))];
  return matches.length > 0 ? matches.at(-1)[1].trim() : null;
};

/** The four that were cut, and now wrap. */
const WRAPPING = [".person-copy strong", ".person-copy small", ".project-name-cell small", ".member-name-cell small"];

/** Kept short on purpose, with a detail panel behind them. */
const TRUNCATING = [".member-name-cell strong", ".project-name-cell strong", ".custom-field-cell"];

test("the subtitles that were cut are allowed to wrap", async () => {
  const css = withoutComments(await read());
  for (const selector of WRAPPING) {
    assert.notEqual(winningValue(css, selector, "white-space"), "nowrap",
      `${selector} must be able to wrap — truncating it left the value reachable by hover only (#87)`);
    assert.notEqual(winningValue(css, selector, "text-overflow"), "ellipsis",
      `${selector} must not truncate`);
  }
});

test("the values that stay short still declare it, so the route is the point", async () => {
  const css = withoutComments(await read());
  for (const selector of TRUNCATING) {
    assert.equal(winningValue(css, selector, "text-overflow"), "ellipsis",
      `${selector} is capped on purpose (#75) — if that changes, #87's rule needs revisiting`);
  }
});
