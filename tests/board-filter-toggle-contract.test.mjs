import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * 「詳細な条件」 sits at the end of the filter row (#436). `margin-left: auto`
 * is the push, the same idea as `.primary-button` (#138). The open state is a
 * pale fill, not `--ink`, so it does not look like the primary button's hover.
 */

const read = () => readFile(path.join(root, "src", "styles.css"), "utf8");
const withoutComments = (css) => css.replace(/\/\*[\s\S]*?\*\//gu, "");
const rules = (css) => [...withoutComments(css).matchAll(/([^{}]+)\{([^{}]*)\}/gu)]
  .map(([, selector, body]) => ({ selector: selector.trim().replace(/\s+/gu, " "), body }));
const declarations = (body, prop) => [...body.matchAll(new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+)`, "gu"))]
  .map((match) => match[1].replace(/!\s*important/iu, "").trim());

test("the details toggle is pushed to the row end and its open fill is not ink", async () => {
  const found = rules(await read());
  const toggle = found.filter((rule) => rule.selector === ".board-filter-details-toggle");
  assert.ok(toggle.some((rule) => declarations(rule.body, "margin-left").includes("auto")));
  const open = found.find((rule) => rule.selector === ".board-filter-details-toggle.is-open");
  assert.ok(open, "expected an open state");
  const background = declarations(open.body, "background").join(" ");
  assert.ok(!background.includes("var(--ink)") && !background.includes("#232323"), background);
});
