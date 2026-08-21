import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * #114: the trees drew depth with one CSS rule per level, and there were three of them.
 *
 * ```
 * .skill-tree-name.depth-1 { padding-left: 16px; }
 * .skill-tree-name.depth-2 { padding-left: 32px; }
 * .skill-tree-name.depth-3 { padding-left: 48px; }
 * ```
 *
 * A rule per level is a ceiling, and the two tables that share the class fell off it in
 * opposite directions. Measured at 1425px with a five-level org unit and a four-level
 * skill category injected through the UI:
 *
 * | depth | org (clamped `Math.min(3, depth)`) | skill tree (unclamped) |
 * | ----- | ---------------------------------- | ---------------------- |
 * | 0     | 0px, text at 323.4                 | 0px, text at 323.4     |
 * | 1     | 16px, 339.4                        | 16px, 339.4            |
 * | 2     | 32px, 355.4                        | 32px, 355.4            |
 * | 3     | 48px, 371.4                        | 48px, 371.4            |
 * | 4     | 48px, **371.4**                    | **0px, 323.4**         |
 * | 5     | 48px, **371.4**                    | —                      |
 *
 * The clamp saturates: three depths at one position. No clamp is worse — `depth-4`
 * matches no rule, so the row draws flush left, in the same place as a root row. Neither
 * is a depth. `calc(var(--depth) * 16px)` cannot run out of levels, and the row carries
 * its own depth rather than a class naming a rule that may not exist.
 *
 * ## The floor is the other half
 *
 * An indent is only affordable if the column can pay for it. `.skill-map-table` had
 * `width: 100%` and no `min-width`, so at 390px `table-layout: auto` gave the org
 * table's first column 88.2px of 551 — 親部門 (208px) and 操作 (125.3px) took theirs
 * first — and 48px of indent left 40px for the name. Measured:
 *
 * | depth | row height | name lines | breadcrumb lines |
 * | ----- | ---------- | ---------- | ---------------- |
 * | 3     | 536.0px    | 9          | 23               |
 * | 4     | 681.7px    | 8          | 33               |
 * | 5     | 859.8px    | 10         | 42               |
 *
 * One row taller than the 844px viewport. With `min-width: max-content` — the floor #132
 * gave the member list, for the same reason — the first column takes 625px, those rows
 * become 50.4 / 50.4 / 59px, and the page goes 3952 → 1500. Three tables share the
 * class: the skill map went 5713 → 2707 and the field catalog 3878 → 3412, and none of
 * them added page-level sideways scroll (each scrolls inside `.skill-map-wrap`).
 *
 * So the property and the floor live or die together, and that is what these check.
 *
 * ## What they cannot do
 *
 * They read declarations. The heights, line counts and column widths above are browser
 * measurements, recorded in the PR. jsdom has no layout.
 */

const readCss = async () => (await readFile(path.join(root, "src", "styles.css"), "utf8")).replaceAll("\r\n", "\n");
const readTsx = () => readFile(path.join(root, "src", "expanded-views.tsx"), "utf8");
const withoutComments = (source) => source.replace(/\/\*[\s\S]*?\*\//gu, "");

test("depth is one rule, not one rule per level", async () => {
  const css = withoutComments(await readCss());

  const perLevel = [...css.matchAll(/\.skill-tree-name\.depth-(\d+)/gu)].map((match) => match[1]);
  assert.deepEqual(perLevel, [],
    `depth-${perLevel[0]} still has its own rule. A rule per level is a ceiling: the org table `
    + "clamped to it and put three depths in one place, and the skill tree fell past it and drew "
    + "level 4 flush left (#114)");

  const rule = css.match(/(?:^|\})\s*\.skill-tree-name\s*\{([^}]*)\}/u);
  assert.ok(rule, "expected the .skill-tree-name rule");
  const padding = rule[1].match(/padding-left:\s*([^;}]+)/u);
  assert.ok(padding, "the tree name has to indent by its own depth (#114)");
  // The step, and the fallback that keeps a row with no property at the root.
  assert.match(padding[1].trim(), /^calc\(\s*var\(\s*--depth\s*,\s*0\s*\)\s*\*\s*16px\s*\)$/u,
    `the indent is 「${padding[1].trim()}」; expected calc(var(--depth, 0) * 16px) so it keeps `
    + "stepping and a missing depth reads as the root rather than as no rule at all");
});

test("both trees hand the row its depth, unclamped", async () => {
  const tsx = await readTsx();
  const spans = [...tsx.matchAll(/<span className="skill-tree-name" style=\{\{ "--depth": ([^}]+?) \} as React\.CSSProperties\}>/gu)]
    .map((match) => match[1].trim());
  // The skill tree and the org table. The field catalog uses the class without a depth,
  // which the `var(--depth, 0)` fallback covers.
  assert.equal(spans.length, 2, `expected two depth-carrying trees, found ${spans.length}: ${spans.join(" | ")}`);
  for (const expression of spans) {
    assert.doesNotMatch(expression, /Math\.min/u,
      `「${expression}」 clamps the depth. The clamp existed because the CSS ran out of levels; it `
      + "does not any more, and clamping puts levels 3, 4 and 5 in one place (#114)");
  }
  assert.doesNotMatch(tsx, /"skill-tree-name depth-"/u,
    "a depth class is still being built; the depth belongs in the property (#114)");
});

test("the tables these trees live in have a content-derived floor", async () => {
  const css = withoutComments(await readCss());
  const floor = css.match(/(?:^|\})\s*\.skill-map-table\s*\{[^}]*min-width:\s*([^;}]+)/u);
  assert.ok(floor, "expected a .skill-map-table min-width floor: without one the first column paid "
    + "for the indent and a 5-level row measured 859.8px tall at 390px (#114)");
  assert.equal(floor[1].trim(), "max-content",
    `the floor is 「${floor[1].trim()}」. A number is a guess about the column count and the depth, `
    + "and both change at runtime (#114, same reasoning as #132)");

  // A floor inside a breakpoint wins there over the unconditional one and can only ask
  // for less — the mistake #132 recorded, made once already in this repo.
  const blocks = [...css.matchAll(/@media \([^)]*width: \d+px\) \{/gu)].map((match) => {
    let depth = 1;
    let index = match.index + match[0].length;
    const start = index;
    while (depth > 0 && index < css.length) {
      if (css[index] === "{") depth += 1;
      else if (css[index] === "}") depth -= 1;
      index += 1;
    }
    return css.slice(start, index - 1);
  });
  for (const body of blocks) {
    assert.doesNotMatch(body, /\.skill-map-table\s*\{[^}]*min-width:/u,
      "a media block sets a second .skill-map-table floor, which wins at that width and can only "
      + "lower it (#114)");
  }
});
