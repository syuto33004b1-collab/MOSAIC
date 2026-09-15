import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const readCss = () => readFile(path.join(root, "src", "styles.css"), "utf8");
const withoutComments = (css) => css.replace(/\/\*[\s\S]*?\*\//gu, "");

async function printBlock() {
  const css = withoutComments(await readCss());
  const marker = /@media print \{/gu;
  const found = [];
  let match;
  while ((match = marker.exec(css)) !== null) {
    let depth = 1;
    let index = match.index + match[0].length;
    const start = index;
    while (depth > 0 && index < css.length) {
      if (css[index] === "{") depth += 1;
      else if (css[index] === "}") depth -= 1;
      index += 1;
    }
    found.push(css.slice(start, index - 1));
  }
  return found;
}

const rulesFor = (body, selector) => [...body.matchAll(/([^{}]+)\{([^{}]*)\}/gu)]
  .filter(([, selectors]) => selectors.split(",").some((part) => part.trim().includes(selector)))
  .map(([, , declarations]) => declarations)
  .join(";");

test("the skill sheet stays in the one print block and does not choose paper", async () => {
  const blocks = await printBlock();
  assert.equal(blocks.length, 1, "@media print should stay one block (#179, #325)");
  assert.doesNotMatch(blocks[0], /@page\s*\{[^}]*size:/u, "the reader's paper is the reader's (#179)");
  assert.match(blocks[0], /data-print-document="skill-sheet"/u);
});

test("the skill sheet is screen-hidden and print-shown only under its mark", async () => {
  const css = withoutComments(await readCss());
  const [body] = await printBlock();
  const base = css.replace(/@media[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/gu, "");
  assert.match(rulesFor(base, ".skill-sheet"), /display:\s*none/u,
    "a second profile on screen is noise (#325)");
  assert.match(rulesFor(body, "data-print-document=\"skill-sheet\"") + rulesFor(body, ".skill-sheet"),
    /display:\s*block/u,
    "the print block has to turn the sheet back on (#325)");
  assert.match(rulesFor(body, "html[data-print-document=\"skill-sheet\"] .app-shell"), /display:\s*block/u,
    "the shell's two columns leave a 258px indent once the sidebar is hidden (#325)");
  assert.match(rulesFor(body, ".skill-sheet-history article") || rulesFor(body, "skill-sheet-history"),
    /break-inside:\s*avoid/u,
    "a history entry split across a page break is two half-jobs (#325)");
});

test("the skill sheet source is an allow-list and does not re-implement permissions", async () => {
  const source = await readFile(path.join(root, "src", "skill-sheet.tsx"), "utf8");
  for (const forbidden of ["hiddenFieldKeys", "personScope", "rolePermissions", "monthlyCost", "monthly_cost"]) {
    assert.doesNotMatch(source, new RegExp(forbidden, "u"),
      `${forbidden} on the sheet is either a leak or a second copy of the DB rule (#325)`);
  }
  assert.match(source, /visibleCustomFields/u, "detail-surface fields come from the same helper as the drawer (#325)");
  assert.match(source, /sheetSkillLevels/u, "skill order is the catalog-tree helper, not discovery order (#325)");
  for (const section of ["skill-sheet-identity", "skill-sheet-org", "skill-sheet-skills", "skill-sheet-history", "skill-sheet-fields"]) {
    assert.match(source, new RegExp(section, "u"), `missing ${section} on the allow-list (#325)`);
  }
});
