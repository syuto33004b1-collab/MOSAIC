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
  const rule = (selector) => {
    const match = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/gu)].filter(([, sel]) => sel.includes(selector));
    return match.map(([, , body]) => body).join(";");
  };
  const catalog = rule(".field-catalog-form input");
  assert.match(catalog, /background:\s*var\(--paper-pure\)/u, "an enabled input takes the paper background");
  assert.doesNotMatch(catalog, /background:\s*#f7f9fc/u, "the cool grey is what read as disabled");

  // A token, not a literal, and on this form specifically: the placeholder
  // carries the examples, so it has to clear AA rather than inherit the browser
  // default grey. Matching any `::placeholder` rule passed while this form's own
  // had been deleted.
  assert.match(rule(".field-catalog-form input::placeholder"), /color:\s*var\(--[a-z-]+\)/u,
    "this form's placeholder colour must be a token");
});
