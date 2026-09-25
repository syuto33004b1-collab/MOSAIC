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
  const avatarRadii = found
    .filter((rule) => rule.selector === ".avatar")
    .flatMap((rule) => declarations(rule.body, "border-radius"));
  assert.equal(avatarRadii.at(-1), "50%", "the last .avatar radius is the circle");
  const personShape = found.find((rule) => rule.selector === ".avatar.avatar-person");
  assert.equal(personShape, undefined, "a person rule would override the circle");
  const project = found.find((rule) => rule.selector === ".avatar.avatar-project");
  assert.ok(project, "expected .avatar.avatar-project");
  assert.deepEqual(declarations(project.body, "border-radius"), ["3px"]);
  const bordered = found.find((rule) => rule.selector === ".avatar.avatar-person, .avatar.avatar-project");
  assert.ok(bordered, "expected a shared border rule");
  assert.deepEqual(declarations(bordered.body, "border"), ["1px solid transparent"]);
  const projectTones = {
    blue: ["#e7b5a6", "#8a3422"],
    orange: ["#e8c09a", "#7a4522"],
    mint: ["#b7d4c6", "#2c4e40"],
    plum: ["#cbbbe4", "#4e3c68"],
    sky: ["#aed4e2", "#245668"],
  };
  for (const [tone, [fill, border]] of Object.entries(projectTones)) {
    const rule = found.find((item) => item.selector === `.avatar.avatar-project.${tone}`);
    assert.ok(rule, tone);
    assert.deepEqual(declarations(rule.body, "background"), [fill]);
    assert.deepEqual(declarations(rule.body, "border-color"), [border]);
  }
  const personTones = {
    lavender: ["#c4aea4", "#6d534b"],
    peach: ["#e09a7c", "#7a4534"],
    sky: ["#a9c3b6", "#34584c"],
    mint: ["#8fbfae", "#275445"],
    sand: ["#d4b56a", "#5c481c"],
    rose: ["#e08aaa", "#7a3450"],
  };
  for (const [tone, [fill, border]] of Object.entries(personTones)) {
    const rule = found.find((item) => item.selector === `.avatar.avatar-person.${tone}`);
    assert.ok(rule, tone);
    assert.deepEqual(declarations(rule.body, "background"), [fill]);
    assert.deepEqual(declarations(rule.body, "border-color"), [border]);
    assert.deepEqual(declarations(rule.body, "border-radius"), []);
  }
});
