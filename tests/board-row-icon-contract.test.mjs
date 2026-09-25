import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Board row heads are circles for members and 3px squares for projects (#433).
 * The square has to beat `.avatar { border-radius: 50% }`, so the selector is
 * `.avatar.avatar-project` (two classes), not `.avatar-project` alone.
 */

const read = () => readFile(path.join(root, "src", "styles.css"), "utf8");
const withoutComments = (css) => css.replace(/\/\*[\s\S]*?\*\//gu, "");

const rules = (css) => [...withoutComments(css).matchAll(/([^{}]+)\{([^{}]*)\}/gu)]
  .map(([, selector, body]) => ({ selector: selector.trim().replace(/\s+/gu, " "), body }));

const declarations = (body, prop) => [...body.matchAll(new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+)`, "gu"))]
  .map((match) => match[1].replace(/!\s*important/iu, "").trim());

test("project row heads are 3px squares and member row heads keep a border", async () => {
  const found = rules(await read());
  const project = found.find((rule) => rule.selector === ".avatar.avatar-project");
  assert.ok(project, "expected .avatar.avatar-project");
  assert.deepEqual(declarations(project.body, "border-radius"), ["3px"]);
  const bordered = found.find((rule) => rule.selector === ".avatar.avatar-person, .avatar.avatar-project");
  assert.ok(bordered, "expected a shared border rule");
  assert.deepEqual(declarations(bordered.body, "border"), ["1px solid transparent"]);
  for (const tone of ["blue", "orange", "mint", "plum", "sky"]) {
    assert.ok(found.some((rule) => rule.selector === `.avatar.avatar-project.${tone}`), tone);
  }
  for (const tone of ["lavender", "peach", "sky", "mint", "sand", "rose"]) {
    assert.ok(found.some((rule) => rule.selector === `.avatar.avatar-person.${tone}`), tone);
  }
});
