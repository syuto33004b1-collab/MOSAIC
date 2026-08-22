import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * #113 put a button inside the toast, and three things about the toast made that harder
 * than it sounds. All three were measured before the change and after it.
 *
 * ## It could not be clicked
 *
 * `.toast` sets `pointer-events: none` so a hidden toast never swallows a click, and
 * `.toast.show` did not turn them back on — there had never been anything in there to
 * press. Without `pointer-events: auto` the undo is inert.
 *
 * ## `.undo-button` was the wrong class to reuse
 *
 * It is described in two places: the colours in `.undo-button`, the box in `.change-bar
 * button` (height, padding, `display: inline-flex`). Only the colours would reach a button
 * outside the bar, so borrowing it would style this one half by the bar's rules and half
 * by nothing.
 *
 * The 620px block reads `.change-bar > span:nth-child(2), .undo-button { display: none; }`,
 * which looks like a second reason — the bar dropping its undo to fit — and is not one:
 * `.change-bar button` is (0,1,1) against `.undo-button`'s (0,1,0), and a media query adds
 * no specificity, so that `display: none` never applies. Measured at 375px: the bar's undo
 * is 92px wide and `display: flex`. Filed as #172; this file does not assert it.
 *
 * ## It sat on top of the change bar
 *
 * Both are fixed to the bottom of the viewport. Measured at 375px with the toast up,
 * `elementFromPoint` on 「デモへ保存」 returned the toast — the save could not be pressed.
 * That was already true of every toast in the app; #113 made it matter, because a toast
 * offering an undo stays up for eight seconds rather than three.
 *
 * | | before | after |
 * | ---------------- | ---------------------- | --------------------- |
 * | 375px toast box  | 187.5 x 86.8, 4 lines  | 347 x 54, 1 line      |
 * | 375px save button| unreachable            | reachable             |
 * | 1425px gap       | overlapping            | 14px clear            |
 *
 * At 375px the toast also had only half the viewport to grow into — `left: 50%` with no
 * `right` — so the message wrapped to four lines once a button sat beside it.
 *
 * These read declarations. The boxes and the hit tests are browser measurements, in the
 * PR; jsdom has no layout.
 */

const readCss = async () => (await readFile(path.join(root, "src", "styles.css"), "utf8")).replaceAll("\r\n", "\n");
const withoutComments = (source) => source.replace(/\/\*[\s\S]*?\*\//gu, "");

/**
 * Everything inside every `@media (max-width: Npx)` block, joined. There are ten blocks
 * at 620px in this stylesheet, so reading only the first one and calling it "the narrow
 * layout" answers about whichever block happens to come first in the file.
 */
function maxWidthCss(css, width) {
  const marker = new RegExp(`@media \\(max-width: ${width}px\\) \\{`, "gu");
  const bodies = [];
  let found;
  while ((found = marker.exec(css)) !== null) {
    let depth = 1;
    let index = found.index + found[0].length;
    const start = index;
    while (depth > 0 && index < css.length) {
      if (css[index] === "{") depth += 1;
      else if (css[index] === "}") depth -= 1;
      index += 1;
    }
    bodies.push(css.slice(start, index - 1));
  }
  return bodies.join("\n");
}

test("a toast that is up accepts a click", async () => {
  const css = withoutComments(await readCss());
  const show = css.match(/\.toast\.show\s*\{([^}]*)\}/u);
  assert.ok(show, "expected the .toast.show rule");
  assert.match(show[1], /pointer-events:\s*auto/u,
    "the base rule turns pointer events off; without turning them back on when the toast is up, "
    + "the undo inside it cannot be clicked (#113)");
});

test("the toast's undo is described in one place, and its own", async () => {
  const css = withoutComments(await readCss());
  const rule = css.match(/(?:^|\})\s*\.toast-undo\s*\{([^}]*)\}/u);
  assert.ok(rule, "expected the toast's own button class (#113)");
  // Everything the button needs, rather than half of it borrowed from the change bar.
  for (const property of ["min-height", "padding", "border", "border-radius", "background", "color"]) {
    assert.match(rule[1], new RegExp(`${property}:`, "u"),
      `.toast-undo does not set ${property}; borrowing it from .undo-button reaches only the colours, `
      + "because the box lives in `.change-bar button` (#113)");
  }

  // And it does not disappear at the narrow width, where it is the only way back.
  const narrow = maxWidthCss(css, 620);
  assert.doesNotMatch(narrow, /\.toast-undo[^{]*\{[^}]*display:\s*none/u,
    "the toast's undo has to survive the narrow layout: a move has no other way back (#113)");
});

test("the toast steps aside for the change bar", async () => {
  const css = withoutComments(await readCss());
  const lifted = /\.app-shell:has\(\.change-bar\)\s+\.toast\s*\{[^}]*bottom:\s*(\d+)px/u;

  const wide = css.match(lifted);
  assert.ok(wide, "expected the toast to be lifted while the change bar is up (#113)");
  const narrow = maxWidthCss(css, 620);
  const close = narrow.match(lifted);
  assert.ok(close, "the lift has to be given again at 620px, where the bar sits lower (#113)");

  // The bar's own offsets and heights, measured: 22px + 56.4 at 1425, 14px + 54 at 375.
  // Anything at or below those and the two overlap again.
  assert.ok(Number(wide[1]) > 79, `lifted to ${wide[1]}px; the bar reaches 78.4px at 1425 (#113)`);
  assert.ok(Number(close[1]) > 68, `lifted to ${close[1]}px at 620; the bar reaches 68px at 375 (#113)`);

  // And the toast keeps its own resting offset for when no bar is up.
  const base = css.match(/(?:^|\})\s*\.toast\s*\{[^}]*bottom:\s*(\d+)px/u);
  assert.ok(base, "expected the toast's own bottom offset");
  assert.ok(Number(base[1]) < Number(wide[1]),
    "the lift has to be above the resting position, or it is not a lift");
});
