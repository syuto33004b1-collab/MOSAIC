import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * The project and member tables build their header row from a variable number of
 * `<th>`: one per custom field the user puts in the list view, plus a score
 * column when a search scene is picked. Positional widths cannot survive that.
 *
 * What shipped: `.member-table th:nth-child(1..6)` summed to 100% while the
 * table rendered nine columns, so `table-layout: fixed` gave the last three 0px.
 * Adding one more custom field starved a fourth and misassigned every width past
 * the insertion point. Measured: three 0px columns on the member table, two on
 * the project table, 120 and 16 text-on-text overlaps.
 *
 * These checks are static because the failure is a CSS/markup contract, not a
 * value a type can hold.
 */

const read = (rel) => readFile(path.join(root, rel), "utf8");
/** Comments hold `{...}` from the TSX they quote, which breaks `[^}]*` matching. */
const withoutComments = (css) => css.replace(/\/\*[\s\S]*?\*\//gu, "");

test("neither table sizes its columns by position", async () => {
  const css = withoutComments(await read("src/styles.css"));
  for (const table of [".member-table", ".portfolio-table"]) {
    const positional = [...css.matchAll(new RegExp(`\\${table}\\s+(?:th|td)?:?nth-child\\(\\d+\\)[^}]*\\}`, "gu"))];
    assert.deepEqual(
      positional.map((m) => m[0].replace(/\s+/gu, " ")),
      [],
      `${table} must not size columns by nth-child — the column count varies at runtime`,
    );
  }
});

test("neither table uses fixed layout, which is what starves the unnamed columns", async () => {
  const css = withoutComments(await read("src/styles.css"));
  const rule = css.match(/\.portfolio-table,\s*\n\.member-table\s*\{([^}]*)\}/u);
  assert.ok(rule, "expected the shared .portfolio-table/.member-table rule");
  assert.doesNotMatch(rule[1], /table-layout:\s*fixed/u);
  assert.match(rule[1], /table-layout:\s*auto/u);
  // The wrapper must be able to scroll, or content that does not fit is lost.
  assert.match(css, /\.portfolio-table-wrap,\s*\n\.member-table-wrap\s*\{[^}]*overflow-x:\s*auto/u);
});

test("every header cell carries an identity class the CSS can key off", async () => {
  const tsx = await read("src/expanded-views.tsx");
  // Only the tables whose column count varies at runtime. Other screens have
  // fixed headers and are out of scope for this contract.
  const blocks = [...tsx.matchAll(/<table className="(?:portfolio|member)-table">([\s\S]*?)<tbody>/gu)];
  assert.equal(blocks.length, 3, `expected three variable-column tables, found ${blocks.length}`);
  for (const [, row] of blocks) {
    const cells = [...row.matchAll(/<th(\s[^>]*)?>/gu)];
    assert.ok(cells.length > 0, "header row with no <th>");
    for (const [tag, attrs] of cells) {
      assert.match(attrs ?? "", /className="col-[a-z]+"/u, `<th> without a col-* class: ${tag}`);
    }
  }
});

test("the CSS only names columns that the markup actually renders", async () => {
  const css = withoutComments(await read("src/styles.css"));
  const tsx = await read("src/expanded-views.tsx");
  const styled = new Set([...css.matchAll(/\.(?:portfolio|member)-table\s+\.(col-[a-z]+)/gu)].map((m) => m[1]));
  const rendered = new Set([...tsx.matchAll(/className="(col-[a-z]+)"/gu)].map((m) => m[1]));
  const orphans = [...styled].filter((c) => !rendered.has(c));
  assert.deepEqual(orphans, [], `CSS sizes columns that no <th> uses: ${orphans.join(", ")}`);
});

test("row name text can shrink instead of spilling into the next column", async () => {
  const css = withoutComments(await read("src/styles.css"));
  const tsx = await read("src/expanded-views.tsx");
  // A flex item defaults to min-width: auto and will not shrink below its text.
  assert.match(css, /\.row-name-copy\s*\{[^}]*min-width:\s*0/u);
  assert.match(css, /\.(?:project|member)-name-cell strong[^{]*\{[^}]*text-overflow:\s*ellipsis/u);
  const uses = tsx.match(/row-name-copy/gu) ?? [];
  assert.equal(uses.length, 3, `expected project, opportunity and member rows to use it, found ${uses.length}`);
});

test("a custom-field value clips rather than wrapping to two lines", async () => {
  const css = withoutComments(await read("src/styles.css"));
  assert.match(css, /\.custom-field-cell\s*\{[^}]*white-space:\s*nowrap/u);
  assert.match(css, /\.custom-field-cell\s*\{[^}]*text-overflow:\s*ellipsis/u);
  // A floor, so a short value like 未設定 is not squeezed onto two lines.
  assert.match(css, /\.member-table \.col-custom\s*\{[^}]*min-width:/u);
});

test("the actions cell can grow when its buttons wrap", async () => {
  // It is display: flex, so the shared `td { height: 68px }` becomes a definite
  // height and squeezed the two wrapped buttons into a 4px overlap.
  const css = withoutComments(await read("src/styles.css"));
  assert.match(css, /\.member-table td\.member-row-actions\s*\{[^}]*height:\s*auto/u);
});
