import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * `.read-only-label` stands in for a control that is not available — 「閲覧のみ」
 * in the member table, and the reason a department cannot be deleted in the org
 * table (#86). It lives in a table cell in both places, and an auto table layout
 * gives a column only what its content demands: with wrapping allowed,
 * 「所属メンバーあり」 came out 10px wide at 390px with the row 191px tall, one
 * character a line. Same starvation as the rail labels in #96 and the heading
 * badge in #99.
 *
 * ## What this cannot do
 *
 * It reads one declaration. It says nothing about whether the column is wide
 * enough, only that the label will not volunteer to shrink. Rendered widths at
 * 390 and 1440px are in the PR.
 */

const read = () => readFile(path.join(root, "src", "styles.css"), "utf8");
const withoutComments = (css) => css.replace(/\/\*[\s\S]*?\*\//gu, "");

const labelRules = (css) => [...css.matchAll(/([^{}]+)\{([^{}]*)\}/gu)]
  .map(([, sel, body]) => ({ selector: sel.trim().replace(/\s+/gu, " "), body }))
  .filter(({ selector }) => /\.read-only-label(?![\w-])/u.test(selector));

const declarations = (body, prop) => [...body.matchAll(new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+)`, "gu"))]
  .map((m) => m[1].replace(/!\s*important/iu, "").trim());

test("the stand-in label does not wrap", async () => {
  const css = withoutComments(await read()).replaceAll("\r\n", "\n");
  const rules = labelRules(css);
  assert.ok(rules.length >= 1, "no .read-only-label rule found");

  const values = rules.flatMap(({ selector, body }) => declarations(body, "white-space").map((value) => ({ selector, value })));
  assert.ok(values.length >= 1, "the label needs white-space: nowrap, or a table column starves it");
  const wrapping = values
    .filter((d) => !/^(?:nowrap|pre)$/u.test(d.value))
    .map((d) => `${d.selector.slice(0, 40)} => white-space: ${d.value}`);
  assert.deepEqual(wrapping, [], "a wrapping stand-in label lets the column collapse:\n  " + wrapping.join("\n  "));
});

/**
 * The label had `color: #8e97a8`, which measured 2.79-2.94:1 against the rows it
 * sits on — below AA. It went unnoticed because it only ever rendered for a
 * signed-in viewer, a state the DEMO-mode contrast sweep cannot reach, and #86
 * gave it a second job where it carries the only explanation on screen.
 *
 * A literal colour cannot be checked for contrast here, so this requires the
 * token the rest of the app's quiet text already uses. Rendered ratios are in
 * the PR: 5.56 and 5.86:1.
 */
test("the stand-in label takes its colour from the readable token", async () => {
  const css = withoutComments(await read()).replaceAll("\r\n", "\n");
  const colours = labelRules(css).flatMap(({ selector, body }) => declarations(body, "color").map((value) => ({ selector, value })));
  assert.ok(colours.length >= 1, "the label declares no colour");
  const literal = colours
    .filter((d) => !/^var\(--muted-readable\)$/u.test(d.value))
    .map((d) => `${d.selector.slice(0, 40)} => color: ${d.value}`);
  assert.deepEqual(
    literal,
    [],
    "this text is the only explanation of an unavailable action, so it needs the readable token:\n  " + literal.join("\n  "),
  );
});
