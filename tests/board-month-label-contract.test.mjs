import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * The month label is only as wide as its text, so 「2026年 9月」 and
 * 「2026年 10月」 put the arrows in different places (#434). The floor is
 * the border box, padding included, in em so it follows `--text-lg`.
 *
 * ## What this cannot do
 *
 * It reads the declaration. It does not render the font, so it cannot see
 * whether 6.75em still holds 「8888年 10月」. That measurement is in the PR.
 */

const read = () => readFile(path.join(root, "src", "styles.css"), "utf8");
const withoutComments = (css) => css.replace(/\/\*[\s\S]*?\*\//gu, "");

const rules = (css) => [...withoutComments(css).matchAll(/([^{}]+)\{([^{}]*)\}/gu)]
  .map(([, selector, body]) => ({ selector: selector.trim().replace(/\s+/gu, " "), body }))
  .filter(({ selector }) => selector === ".toolbar-actions .board-month-label");

const declarations = (body, prop) => [...body.matchAll(new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+)`, "gu"))]
  .map((match) => match[1].replace(/!\s*important/iu, "").trim());

test("the month label has a fixed floor so one digit and two do not move the arrows", async () => {
  const found = rules(await read());
  assert.equal(found.length, 1, "expected one .toolbar-actions .board-month-label rule");
  const [rule] = found;
  assert.deepEqual(declarations(rule.body, "min-width"), ["6.75em"]);
  assert.deepEqual(declarations(rule.body, "justify-content"), ["center"]);
  assert.ok(declarations(rule.body, "font-variant-numeric").includes("tabular-nums"));
});
