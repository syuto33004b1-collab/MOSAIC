import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * The toast is fixed to the bottom of the viewport and so is the change bar, and they were
 * overlapping. Measured at 375px with a toast up, `elementFromPoint` on 「デモへ保存」
 * returned the toast — the save could not be pressed at all.
 *
 * That was true of every one of the app's forty-odd messages. #113 is what made it worth
 * fixing: it put a button in the toast and held the toast open for eight seconds so the
 * button could be reached, turning a flicker into an eight-second block on saving. #173
 * then moved that button into the row it belongs to, where a keyboard reaches it in one
 * Tab — so the toast is a message again and holds for 3.2s. The overlap is still worth
 * keeping fixed: 3.2 seconds of a covered save button is a defect that predates both.
 *
 * | | before | after |
 * | ---------------- | ---------------------- | --------------------- |
 * | 375px toast box  | 187.5 x 86.8, 4 lines  | 347 x 54, 1 line      |
 * | 375px save button| unreachable            | reachable             |
 * | 1425px gap       | overlapping            | 12px clear            |
 *
 * At 375px the toast also had only half the viewport to grow into — `left: 50%` with no
 * `right` — so a longer message wrapped to four lines.
 *
 * The first version cleared the bar with a number, 92px at wide and 80px at narrow, read
 * off the bar as it measures today. The evaluation on #113 pointed out that the bar's
 * height is its tallest child's and a larger user font grows the text block inside it;
 * forced to 88.8px, the 92px stopped clearing. So `App.tsx` measures how far up the bar
 * reaches and passes it as `--toast-lift`, kept current by a ResizeObserver.
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

test("a toast never takes a click meant for something under it", async () => {
  const css = withoutComments(await readCss());
  // Both halves, because the default is `auto`: asserting only that `.toast.show` does not
  // turn them on would pass with the base rule deleted (the evaluation on #173 asked).
  const base = css.match(/(?:^|\})\s*\.toast\s*\{([^}]*)\}/u);
  assert.ok(base, "expected the .toast rule");
  assert.match(base[1], /pointer-events:\s*none/u,
    "a toast spans the width of a narrow screen and is up 3.2s after every one of the app's "
    + "forty-odd messages; without this it takes the clicks under it");
  const show = css.match(/\.toast\.show\s*\{([^}]*)\}/u);
  assert.ok(show, "expected the .toast.show rule");
  // It carries no controls of its own — #173 moved the one it had into the row that moved.
  // #113 turned pointer events on for the whole toast for a while, which blocked whatever
  // was under every message in the app.
  assert.doesNotMatch(show[1], /pointer-events:\s*auto/u,
    "a toast that takes clicks blocks what is under it, and it has nothing to click (#113, #173)");
});

test("the narrow toast gets the whole width", async () => {
  const narrow = maxWidthCss(withoutComments(await readCss()), 620);
  const rule = narrow.match(/(?:^|\})\s*\.toast\s*\{([^}]*)\}/u);
  assert.ok(rule, "expected the toast to be pinned at 620px (#113)");
  for (const property of ["left", "right"]) {
    assert.match(rule[1], new RegExp(`${property}:\\s*\\d+px`, "u"),
      `.toast needs a ${property} here: with only \`left: 50%\` it can grow into half the viewport, `
      + "which wrapped a message to four lines (#113)");
  }
});

test("the toast steps aside for the change bar, by measurement", async () => {
  const css = withoutComments(await readCss());
  const rule = css.match(/\.app-shell:has\(\.change-bar\)\s+\.toast\s*\{([^}]*)\}/u);
  assert.ok(rule, "expected the toast to be lifted while the change bar is up (#113)");

  // The lift comes from the bar's measured reach, not from a number. The bar's height is
  // its tallest child's, and a larger user font grows the text block inside it — measured
  // at 88.8px, where the 92px this used to hard-code stopped clearing it.
  const lift = rule[1].match(/bottom:\s*([^;}]+)/u);
  assert.ok(lift, "the lift has to set a bottom offset");
  assert.match(lift[1].trim(), /^var\(\s*--toast-lift\s*,\s*(\d+)px\s*\)$/u,
    `the lift is 「${lift[1].trim()}」; a fixed offset stops clearing the bar as soon as the bar `
    + "grows, which a larger user font does (#113)");

  // The fallback covers the frame before the first measurement, so it still has to clear
  // the bar as measured: 22px of offset plus 56.4px of height at 1425px.
  const fallback = Number(/^var\(\s*--toast-lift\s*,\s*(\d+)px\s*\)$/u.exec(lift[1].trim())[1]);
  assert.ok(fallback > 79, `the fallback is ${fallback}px; the bar reaches 78.4px at 1425 (#113)`);

  // And the toast keeps its own resting offset for when no bar is up.
  const base = css.match(/(?:^|\})\s*\.toast\s*\{[^}]*bottom:\s*(\d+)px/u);
  assert.ok(base, "expected the toast's own bottom offset");
  assert.ok(Number(base[1]) < fallback, "the lift has to be above the resting position");

  // One rule, not one per width: the measurement already knows where the bar is.
  const narrow = maxWidthCss(css, 620);
  assert.doesNotMatch(narrow, /\.app-shell:has\(\.change-bar\)\s+\.toast/u,
    "a second lift at 620px is a second guess at the same thing (#113)");
});
