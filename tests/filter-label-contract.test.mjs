import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * #84 measured the filters: eight `.view-filter` controls, and only the CSV one
 * carried a visible word for what it filters. The rest showed an icon and the
 * selected value, so three adjacent selects on the member screen all read
 * 「すべて」/「すべての部門」/「シーンなし」 with nothing saying which was which.
 *
 * The visible word has to be inside the select's accessible name as well
 * (WCAG 2.5.3 Label in Name): a voice-control user says what they can see, and
 * 「部門」 did not appear in 「組織で絞り込み」.
 *
 * ## What this cannot do
 *
 * It reads the markup, not the render. Whether the labels fit, and at what width
 * the toolbar wraps, are measurements in the PR.
 */

const source = () => readFile(path.join(root, "src", "expanded-views.tsx"), "utf8");

/** Each `<label className="view-filter">…</label>`, with its inner markup. */
async function filters() {
  const tsx = await source();
  return [...tsx.matchAll(/<label className="view-filter"([\s\S]*?)<\/label>/gu)].map(([, body]) => body);
}

test("every filter says what it filters, in the control", async () => {
  const bodies = await filters();
  assert.ok(bodies.length >= 8, `expected at least eight .view-filter controls, found ${bodies.length}`);
  for (const body of bodies) {
    const visible = body.match(/className="filter-label">([^<]+)</u)?.[1];
    assert.ok(visible, `a .view-filter with no visible label: ${body.slice(0, 90)}`);

    const name = body.match(/aria-label="([^"]+)"/u)?.[1];
    assert.ok(name, `a .view-filter select with no accessible name: ${body.slice(0, 90)}`);
    // Label in Name: what is on screen has to be in the name, or saying the
    // visible word does not reach the control.
    assert.ok(name.includes(visible.trim()),
      `the visible label 「${visible.trim()}」 is not inside the accessible name 「${name}」`);
  }
});

/**
 * The same visible label must not appear on two filters. The 項目定義 screen shows
 * the field list's own filter and the CSV panel's entity picker together, and
 * both read 「対象」 at one point — which is #88's defect, on a new screen.
 *
 * Uniqueness is checked across the whole file rather than per screen: which
 * components render together is not something this file says, and a first
 * attempt that split on `export function` missed exactly this pair because
 * `CsvTransferPanel` is its own export. Every label is distinct today, so the
 * stricter rule costs nothing; if two unrelated screens ever want the same word,
 * that is a decision to make rather than a check to weaken quietly.
 */
test("no two filters show the same visible label", async () => {
  const tsx = await source();
  const labels = [...tsx.matchAll(/className="filter-label">([^<]+)</gu)].map(([, text]) => text.trim());
  assert.ok(labels.length >= 9, `expected every filter to carry a label, found ${labels.length}`);
  const repeated = [...new Set(labels.filter((label, index) => labels.indexOf(label) !== index))];
  assert.deepEqual(repeated, [], `two filters share a visible label: ${repeated.join(", ")}`);
});

/**
 * The sort order and the result count shared `.toolbar-result`. They answer
 * different questions — how the list is ordered, and what is in it — and the
 * sort text also sat unlabelled next to bordered controls, which is what made it
 * look pressable.
 */
test("the sort order and the result count are not the same container", async () => {
  const tsx = await source();
  const status = [...tsx.matchAll(/<span className="toolbar-status">([\s\S]*?)<\/span>/gu)].map(([, body]) => body);
  assert.equal(status.length, 1, "expected one .toolbar-status, the member list's ordering");
  assert.match(status[0], /並び順:/u, "the ordering is labelled, so it reads as a state rather than a control");

  const results = [...tsx.matchAll(/<span className="toolbar-result">([\s\S]*?)<\/span>/gu)].map(([, body]) => body);
  assert.ok(results.length > 0, "expected .toolbar-result to still carry the counts");
  for (const body of results) {
    assert.doesNotMatch(body, /の順|並び順/u, `a sort order left in the count's container: ${body}`);
  }
});

/**
 * The scene form only ever creates a scene — `submitScene` calls `onAddScene`
 * and nothing else — so the disclosure says 「新しい」. Without it, a form holding
 * placeholder text while the picker says 「なし」 reads as an unsaved edit of
 * something.
 */
test("the scene form says it makes a new scene", async () => {
  const tsx = await source();
  const summary = tsx.match(/<summary>([^<]+)<\/summary>/u)?.[1];
  assert.ok(summary, "expected the scene disclosure summary");
  assert.match(summary, /新しい/u, "the form creates rather than edits, and the summary has to say so");
});

/**
 * The scene form's inputs are enabled, and looked otherwise: `#f7f9fc` is a cool
 * grey on a warm page, and the theme gives the drawer's inputs
 * `var(--paper-pure)`. Same layer, same kind of control, two treatments. The grey
 * also put the placeholder at 4.37:1, under AA — the PR has the after figure.
 */
test("the form inputs are styled like the app's other enabled inputs", async () => {
  const css = (await readFile(path.join(root, "src", "styles.css"), "utf8")).replace(/\/\*[\s\S]*?\*\//gu, "");
  /**
   * The last declaration, not "a rule somewhere says this": several layers of this
   * file redeclare the same selectors, so concatenating every match would pass
   * while a later layer put the grey back. A static check on the stylesheet text —
   * it does not weigh specificity, `!important`, or media conditions, so it is not
   * the computed cascade.
   */
  const winning = (selector, property) => {
    const bodies = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/gu)]
      .filter(([, sel]) => sel.includes(selector))
      .map(([, , body]) => body).join(";");
    const matches = [...bodies.matchAll(new RegExp(`(?:^|;)[\\s]*${property}[\\s]*:[\\s]*([^;]+)`, "gu"))];
    return matches.length > 0 ? matches.at(-1)[1].trim() : null;
  };
  assert.equal(winning(".field-catalog-form input", "background"), "var(--paper-pure)",
    "an enabled input takes the paper background — the cool grey read as disabled");
  // A token, not a literal, and on this form specifically: the placeholder
  // carries the examples, so it has to clear AA rather than inherit the browser
  // default grey. Matching any `::placeholder` rule passed while this form's own
  // had been deleted.
  assert.match(winning(".field-catalog-form input::placeholder", "color") ?? "", /^var\(--[a-z-]+\)$/u,
    "this form's placeholder colour must be a token");
});
