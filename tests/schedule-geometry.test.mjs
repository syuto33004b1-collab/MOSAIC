import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * The schedule header and each row's week cell draw the same five days, and
 * they used to compute the boundaries from different boxes: the header split
 * (width − label), the cell split (width − label − 16px of its own padding).
 * Measured at 1425px, the boundaries drifted +8.00 / +4.79 / +1.58 / −1.64 /
 * −4.83px across the week, so Thursday's bar sat under Wednesday's label.
 *
 * Both now read one pair of tokens. What this file pins is that they keep
 * reading them, that the cell adds no horizontal padding of its own, and that
 * the wide-screen override still comes after the definition — the old 1500px
 * override sat earlier in the file than the :root it meant to change, so it had
 * never applied at all.
 *
 * Rendered boundaries were measured at 485, 805, 1425 and 1585 and are in the PR.
 */

const read = () => readFile(path.join(root, "src", "styles.css"), "utf8");
const withoutComments = (css) => css.replace(/\/\*[\s\S]*?\*\//gu, "");

function rule(css, selector) {
  const m = css.match(new RegExp(`(?:^|\\})\\s*${selector}\\s*\\{([^}]*)\\}`, "u"));
  return m ? m[1] : null;
}

test("header and week cell take their day columns from the same token", async () => {
  const css = withoutComments(await read()).replaceAll("\r\n", "\n");
  const head = rule(css, "\\.schedule-head");
  const cell = rule(css, "\\.week-cell");
  assert.ok(head, ".schedule-head rule not found");
  assert.ok(cell, ".week-cell rule not found");
  for (const [name, body] of [[".schedule-head", head], [".week-cell", cell]]) {
    assert.match(
      body,
      /grid-template-columns:[^;]*var\(--schedule-day-tracks\)/u,
      `${name} must read --schedule-day-tracks, or the two grids can disagree again`,
    );
  }
  assert.match(head, /var\(--schedule-label-col\)/u);
  assert.match(rule(css, "\\.schedule-row"), /var\(--schedule-label-col\)/u);
});

test("the week cell adds no horizontal padding of its own", async () => {
  const css = withoutComments(await read()).replaceAll("\r\n", "\n");
  const cell = rule(css, "\\.week-cell");
  const padding = cell.match(/padding:\s*([^;]+)/u);
  assert.ok(padding, ".week-cell declares no padding");
  const parts = padding[1].trim().split(/\s+/u);
  // `a b` or `a b c d` — the inline value is the second, and for four values the
  // fourth as well. Anything non-zero shrinks the box the days are divided in.
  const inline = parts.length === 1 ? [parts[0]] : [parts[1], parts[3] ?? parts[1]];
  for (const value of inline) {
    assert.match(value, /^0(?:px)?$/u,
      `.week-cell has horizontal padding (${padding[1].trim()}); the day boundaries would drift from the header's`);
  }
});

test("the wide-screen override comes after the tokens it overrides", async () => {
  const css = withoutComments(await read()).replaceAll("\r\n", "\n");
  // A plain :root later in the file beats a media query earlier in it, both
  // being (0,1,0). The previous 1500px override lost that way and never applied.
  const defined = css.search(/:root\s*\{[^}]*--schedule-day-tracks:/u);
  assert.ok(defined > 0, "--schedule-day-tracks is not defined on :root");
  const overrides = [...css.matchAll(/@media[^{]*\{\s*:root\s*\{[^}]*--schedule-day-tracks:[^}]*\}/gu)];
  assert.ok(overrides.length >= 1, "no media override for --schedule-day-tracks");
  for (const m of overrides) {
    assert.ok(
      m.index > defined,
      `a media override at ${m.index} precedes the :root definition at ${defined}, so it never applies`,
    );
  }
});
