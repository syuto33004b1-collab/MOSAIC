import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * The four-week capacity rail already had `grid-template-columns: repeat(4, 1fr)`
 * and still let its week labels collide, because each label was absolutely
 * positioned inside its bar. An absolutely positioned box belongs to no track,
 * so the grid could not keep the weeks apart.
 *
 * Measured on main: "100%" is 26.2px at the 10px floor while a segment was
 * 19.56px at 390-1024px and 21.25px at 1920px. The label is wider than its
 * segment at every width. Three pairs overlapped up to about 1400px, and 3 to
 * 15 labels escaped the rail's own box at every width from 390 to 1920.
 *
 * The fix is structural: bar and label are separate items of the same grid, one
 * column each, and the track floor is `min-content` so a track is never
 * narrower than its widest item. Nothing here is a pixel width to keep in sync.
 *
 * ## What this cannot do
 *
 * It reads declarations, not the cascade or the rendered boxes. The DOM half of
 * the contract — that the label is a sibling of the bar and not its child — is
 * asserted against a rendered tree in src/App.test.tsx, and the rendered
 * geometry at 390/820/1024/1440/1920px is in the PR.
 */

const read = () => readFile(path.join(root, "src", "styles.css"), "utf8");
const withoutComments = (css) => css.replace(/\/\*[\s\S]*?\*\//gu, "");

/** Every rule whose selector mentions the class, media blocks included. */
function allRules(css, selector) {
  return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/gu)]
    .filter(([, sel]) => new RegExp(selector, "u").test(sel))
    .map(([, sel, body]) => ({ selector: sel.trim().replace(/\s+/gu, " "), body }));
}

/** Every declaration of `prop`, in source order — the last one is what wins. */
function declarations(body, prop) {
  return [...body.matchAll(new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+)`, "gu"))].map((m) => m[1].trim());
}

/**
 * Rules that style the rail element itself, not a descendant. `.member-week-rail i`
 * legitimately carries its own height, so a descendant match would be a false
 * positive on every check about the rail's own box.
 */
function railRules(css) {
  return allRules(css, "\\.member-week-rail(?![\\w-])")
    .filter(({ selector }) => selector.split(",").some((part) => part.trim() === ".member-week-rail"));
}

test("no rule takes the week label out of the grid", async () => {
  const css = withoutComments(await read()).replaceAll("\r\n", "\n");
  const rules = allRules(css, "\\.member-week-rail\\s+small");
  assert.ok(rules.length >= 1, "no .member-week-rail small rule found");
  const offenders = [];
  for (const { selector, body } of rules) {
    for (const value of declarations(body, "position")) {
      // Absolute or fixed removes the label from its track, which is the whole
      // bug. Sticky keeps it in flow, so it is not part of this contract.
      if (/^(?:absolute|fixed)$/u.test(value)) offenders.push(`${selector.slice(0, 50)} => position: ${value}`);
    }
  }
  assert.deepEqual(
    offenders,
    [],
    "an out-of-flow label belongs to no grid track, so the grid cannot keep the four weeks apart:\n  " + offenders.join("\n  "),
  );
});

test("the rail's tracks are never narrower than what they hold", async () => {
  const css = withoutComments(await read()).replaceAll("\r\n", "\n");
  const decls = railRules(css)
    .flatMap(({ selector, body }) => declarations(body, "grid-template-columns").map((value) => ({ selector, value })));
  assert.ok(decls.length >= 1, ".member-week-rail declares no grid-template-columns");
  const rogue = decls
    .filter((d) => !/^repeat\(\s*4\s*,\s*minmax\(\s*min-content\s*,\s*1fr\s*\)\s*\)$/u.test(d.value))
    .map((d) => `${d.selector.slice(0, 50)} => ${d.value}`);
  assert.deepEqual(
    rogue,
    [],
    "a track that can shrink below its label lets the label spill into the next week:\n  " + rogue.join("\n  "),
  );
});

test("the bar and its label sit in one column, in two rows", async () => {
  const css = withoutComments(await read()).replaceAll("\r\n", "\n");
  const base = railRules(css).find(({ body }) => /grid-template-columns:/u.test(body));
  assert.ok(base, "no .member-week-rail rule sets the columns");
  // Without column flow the eight children fill row 1 four at a time, which
  // puts labels in bar columns and bars in label columns.
  assert.match(base.body, /grid-auto-flow:\s*column/u, "the rail needs grid-auto-flow: column to pair each bar with its label");
  assert.match(base.body, /grid-template-rows:\s*\S+\s+\S+/u, "the rail needs two rows: the bar and its label");
  // A fixed height would clip the label row, which is what the old
  // `height: 39px` plus `bottom: -12px` was working around.
  const heights = railRules(css).flatMap(({ selector, body }) =>
    declarations(body, "height").filter((v) => !/^auto$/u.test(v)).map((v) => `${selector.slice(0, 40)} => height: ${v}`));
  assert.deepEqual(heights, [], "a fixed rail height clips the label row:\n  " + heights.join("\n  "));
});
