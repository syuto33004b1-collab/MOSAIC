import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * One bug in three places. Containers that have to reflow were given
 * `flex-wrap: wrap` only inside `@media (max-width: 620px)`, while their content
 * stopped fitting far above that. Measured at 820px: `.view-toolbar` cut 213px
 * off the メンバーを追加 button — all of it — and `.pulse-strip` cut 21px off its
 * last metric. The grids had the same shape in track form:
 * `120px minmax(0,1fr) 160px 120px` held 400px of fixed track plus 30px of gap,
 * so once the container fell below that the flexible track went to 0 and its
 * input overflowed a zero-width cell.
 *
 * ## What this cannot do
 *
 * It reads declarations, so it cannot tell whether anything actually fits, and
 * no syntactic rule distinguishes a track list that will collapse from one that
 * will not. So it does not try: it pins the specific contract these rules now
 * hold — every track shrinkable, plus a container query that sheds columns —
 * and leaves fitting to the measurement sweep, which ran at 390, 485, 545, 625,
 * 700, 820, 945, 1085 and 1425 plus the breakpoint edges, and is in the PR.
 */

const read = () => readFile(path.join(root, "src", "styles.css"), "utf8");
const withoutComments = (css) => css.replace(/\/\*[\s\S]*?\*\//gu, "");
/** Media and container blocks removed, so a breakpoint-only rule cannot satisfy a base check. */
const baseLayer = (css) => css.replace(/@(?:media|container)[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/gu, "");

function rule(css, selector) {
  const m = css.match(new RegExp(`(?:^|\\})\\s*${selector}\\s*\\{([^}]*)\\}`, "u"));
  return m ? m[1] : null;
}

/** Split a track list on top-level whitespace, keeping `minmax(a, b)` intact. */
function tracks(value) {
  const out = [];
  let depth = 0;
  let cur = "";
  for (const ch of value.trim()) {
    if (ch === "(") depth += 1;
    if (ch === ")") depth -= 1;
    if (depth === 0 && /\s/u.test(ch)) { if (cur) out.push(cur); cur = ""; continue; }
    cur += ch;
  }
  if (cur) out.push(cur);
  return out;
}

test("the rows that have to reflow wrap without waiting for a breakpoint", async () => {
  const css = baseLayer(withoutComments(await read()).replaceAll("\r\n", "\n"));
  for (const selector of ["\\.view-toolbar", "\\.pulse-strip"]) {
    const body = rule(css, selector);
    assert.ok(body, `no unconditional rule for ${selector}`);
    assert.match(body, /flex-wrap:\s*wrap/u, `${selector} must wrap outside a media query`);
  }
  // A later nowrap would win, so check none exists anywhere in the base layer.
  for (const selector of ["view-toolbar", "pulse-strip"]) {
    const nowrap = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/gu)]
      .filter(([, sel, body]) => sel.includes(selector) && /flex-wrap:\s*nowrap/u.test(body))
      .map(([, sel]) => sel.trim().slice(0, 50));
    assert.deepEqual(nowrap, [], `.${selector} has a nowrap that would win over the wrap`);
  }
});

/**
 * The original declaration was `120px minmax(0, 1fr) 160px 120px` — a mix, not
 * an all-fixed list — so "no all-fixed list" would have passed it. The contract
 * is stronger: every track shrinkable, so no combination of fixed tracks can
 * squeeze the flexible one to nothing.
 */
test("every track of the form grids can shrink", async () => {
  const css = baseLayer(withoutComments(await read()).replaceAll("\r\n", "\n"));
  const forms = ["\\.field-catalog-form", "\\.role-permission-form"];
  for (const selector of forms) {
    const body = rule(css, selector);
    assert.ok(body, `no unconditional rule for ${selector} — did the selector change?`);
    const cols = body.match(/grid-template-columns:\s*([^;]+)/u);
    assert.ok(cols, `${selector} declares no grid-template-columns`);
    const list = tracks(cols[1]);
    assert.ok(list.length >= 2, `${selector}: expected several tracks, got ${list.length}`);
    const rigid = list.filter((t) => !/^minmax\(\s*0/u.test(t));
    assert.deepEqual(
      rigid,
      [],
      `${selector}: these tracks cannot shrink, so they can starve the flexible one: ${rigid.join(" ")}`,
    );
  }
});

test("a container query sheds columns where the tracks stop fitting", async () => {
  const css = withoutComments(await read()).replaceAll("\r\n", "\n");
  assert.match(css, /\.section-view,\s*\n\.balance-card\s*\{[^}]*container-type:\s*inline-size/u,
    "the forms' ancestors must be inline-size containers, or @container cannot resolve");
  // The file has more than one @container block — the detail panel added its own
  // for two-column layout (#137) and it comes first — so this looks for the block
  // that holds these forms rather than for whichever block is nearest the top.
  const blocks = [];
  const marker = /@container[^{]*\{/gu;
  let found;
  while ((found = marker.exec(css)) !== null) {
    let depth = 1;
    let index = found.index + found[0].length;
    const start = index;
    while (depth > 0 && index < css.length) {
      if (css[index] === "{") depth += 1;
      else if (css[index] === "}") depth -= 1;
      index += 1;
    }
    blocks.push(css.slice(start, index - 1));
  }
  const block = blocks.filter((body) => body.includes(".field-catalog-form"));
  assert.equal(block.length, 1, `expected one @container block holding the forms, found ${block.length}`);
  // Keyed off the container rather than the viewport because these forms sit at
  // different depths: a 620px media query left the nested report form at
  // `120px 0px 147px 120px` while the others still fitted.
  assert.match(block[0], /\.field-catalog-form\s*\{[^}]*repeat\(auto-fit/u);
  assert.match(block[0], /\.role-permission-form\s*\{[^}]*repeat\(auto-fit/u);
});

test("the toolbar's search box can give up width", async () => {
  const css = baseLayer(withoutComments(await read()).replaceAll("\r\n", "\n"));
  const body = rule(css, "\\.inline-search");
  assert.ok(body, "no unconditional .inline-search rule");
  // flex wraps before it shrinks, so a fixed width here does not merely make the
  // box wide — it pushes the last control onto a second line. 235px did that at
  // 1440px, for the sake of 3px.
  assert.doesNotMatch(body, /(?:^|;)\s*width:\s*\d/u, ".inline-search should size from flex-basis, not a fixed width");
  const flex = body.match(/flex:\s*(\d+)\s+(\d+)\s+(\d+)px/u);
  assert.ok(flex, ".inline-search needs an explicit `flex: <grow> <shrink> <basis>`");
  assert.ok(Number(flex[2]) >= 1, `.inline-search has flex-shrink ${flex[2]}; it must be able to shrink`);
});

/**
 * The pulse metrics keep their labels at narrow widths.
 *
 * They used to be `display: none` below 620px, which left 「69%」 「14.5人日」 「3件」 with
 * nothing saying what any of them was. Measured at 375px in a 347px strip: side by side with
 * their labels the three metrics want 380px and wrap onto rows of their own; each one laid
 * out as a two-row grid — number and arrow above, label across the bottom — wants 192px and
 * they stay on one row, 18px taller than before. Flex could not do it either way: as a column
 * the 要調整 arrow took a third row of its own, and wrapped it still sized each metric to its
 * items side by side (#189).
 *
 * Static, so it cannot tell whether anything fits. The widths above are the measurement, and
 * they are in the PR; what this holds is that the labels are not hidden and that the grid the
 * arrow is placed into is still there to place it in.
 */
test("the pulse metrics say what their numbers are at narrow widths", async () => {
  const css = withoutComments(await read()).replaceAll("\r\n", "\n");
  // Every 620px block, brace-counted. There are two of them, and a non-greedy match finds
  // the one-line one first and then runs past its end into the rules that follow it.
  const bodies = [];
  const marker = /@media \(max-width: 620px\)\s*\{/gu;
  for (let found; (found = marker.exec(css)) !== null;) {
    let depth = 1;
    let index = found.index + found[0].length;
    const start = index;
    while (depth > 0 && index < css.length) {
      if (css[index] === "{") depth += 1;
      else if (css[index] === "}") depth -= 1;
      index += 1;
    }
    bodies.push(css.slice(start, index - 1));
  }
  assert.ok(bodies.length > 0, "expected a 620px block");
  const narrow = bodies.join("\n");

  assert.doesNotMatch(narrow, /\.pulse-metric > span\s*\{[^}]*display:\s*none/u,
    "a number with no label is not a metric; stack them instead (#189)");
  const metric = narrow.match(/(?:^|\})\s*\.pulse-metric\s*\{([^}]*)\}/u);
  assert.ok(metric, "expected .pulse-metric to be re-laid-out at 620px");
  assert.match(metric[1], /display:\s*grid/u, "the two rows are a grid: flex sized them side by side");
  assert.match(narrow, /\.pulse-metric > span\s*\{[^}]*grid-column:\s*1 \/ -1/u,
    "the label takes the second row on its own");
  // The 要調整 metric's arrow, which auto-placement pushed onto a third row below the label.
  assert.match(narrow, /\.pulse-metric > svg\s*\{[^}]*grid-area:\s*1 \/ 2/u,
    "the arrow belongs beside the number, not under the label (#189)");
});

/**
 * The same shape, two forms further on. `.skill-catalog-form` held 120px for 種類
 * plus 179px of add-button plus 30px of gap, so at a 347px container its two
 * flexible tracks were 0px and the 名前 input drew 159px wide across the cells
 * beside it: `elementFromPoint` on that input returned the 種類 select, and on
 * the 親分類 select it returned the button. Two of the three fields could not be
 * reached at all.
 *
 * Both numbers below are the width where that form's 親分類 / 親部門 track drops
 * under the 124px a closed select needs to show 「なし（最上位）」 — 84px of text at
 * bold 12px measured on a canvas, 22px of padding and border, ~18px of arrow.
 * Measured tracks, skill form: 107px at a 620px container, 123.75 at 660, 140.4
 * at 700. Org form: 109.5 at 380, 129.5 at 420.
 *
 * Static, like the rest of this file. The sweep is in the PR: after the change
 * the skill form reads `151.5 151.5` at 347, `149 149 149` at 500, four 149s at
 * 660 and the untouched `175.6 120 125.4 179` at 664, with scrollWidth equal to
 * clientWidth at every step.
 */
test("the skills and org catalog forms shed columns before their selects clip", async () => {
  const css = withoutComments(await read()).replaceAll("\r\n", "\n");
  const blocks = [];
  const marker = /@container\s*\(max-width:\s*(\d+)px\)\s*\{/gu;
  for (let found; (found = marker.exec(css)) !== null;) {
    let depth = 1;
    let index = found.index + found[0].length;
    const start = index;
    while (depth > 0 && index < css.length) {
      if (css[index] === "{") depth += 1;
      else if (css[index] === "}") depth -= 1;
      index += 1;
    }
    blocks.push({ width: Number(found[1]), body: css.slice(start, index - 1), at: found.index });
  }

  for (const { form, pattern, width, base } of [
    {
      form: ".skills-view .skill-catalog-form",
      pattern: /\.skills-view \.skill-catalog-form\s*\{[^}]*repeat\(auto-fit/u,
      width: 660,
      base: ".skills-view .skill-catalog-form,",
    },
    {
      form: ".org-view .org-catalog-form",
      pattern: /\.org-view \.org-catalog-form\s*\{[^}]*repeat\(auto-fit/u,
      width: 420,
      base: ".org-view .org-catalog-form {",
    },
  ]) {
    const holding = blocks.filter((b) => pattern.test(b.body));
    assert.equal(holding.length, 1,
      `expected exactly one @container block dropping ${form} to auto-fit, found ${holding.length}`);
    // Pinned, not a range: it is the width where the select stops showing its value.
    assert.equal(holding[0].width, width,
      `${form} sheds columns at ${holding[0].width}px; ${width}px is the measured point where its `
      + "親分類 / 親部門 track falls under the 124px a closed select needs (#212)");
    // Equal specificity to the base rule, so source order is the only thing that
    // makes this win — the exact trap that left `.profile-request-form` never
    // reflowing on the 項目定義 screen (#214).
    const baseAt = css.indexOf(base);
    assert.ok(baseAt >= 0, `expected the base declaration ${base}`);
    assert.ok(holding[0].at > baseAt,
      `the @container block for ${form} is declared before its base rule; with equal specificity `
      + "the base rule wins and the query does nothing (#214)");
    assert.match(holding[0].body, /\.view-add-button\s*\{[^}]*grid-column:\s*1 \/ -1/u,
      `${form}: the add button needs its own row once the tracks are 140px, or its label wraps`);
  }

  // A select's intrinsic floor is its widest option. 親部門 lists full org paths,
  // so it measured 200px and hung 32px past the card from a 152px cell — the
  // reflow alone did not bring it back in.
  const control = css.match(/\.skill-catalog-form input,\s*\n\.skill-catalog-form select\s*\{([^}]*)\}/u);
  assert.ok(control, "expected the shared input/select rule for the catalog forms");
  assert.match(control[1], /min-width:\s*0/u,
    "without min-width: 0 the select keeps its widest option as a floor and overflows its cell (#212)");
});

/**
 * The query that sheds `.field-catalog-form`'s columns carries one class per
 * rule, and `@container` adds no specificity. So any variant that declares its
 * own track list *after* that block beats it and never reflows — silently, in
 * the same file, next to two variants that do.
 *
 * `.profile-request-form` did exactly that. On the 項目定義 screen at 375px the
 * other two forms read `151.5 151.5` and `136.5 136.5` while it stayed on
 * `46.8px 160px 56.2px`, and its 依頼内容 select drew 114px out of a 47px cell,
 * across the memo field beside it (#214).
 *
 * The variant list comes from the TSX rather than from a literal here, so a
 * variant added later is covered without anyone remembering to add it.
 */
test("no variant declares its own tracks after the query that sheds them", async () => {
  const css = withoutComments(await read()).replaceAll("\r\n", "\n");
  const tsx = await readFile(path.join(root, "src", "expanded-views.tsx"), "utf8");

  const variants = new Set();
  for (const [, rest] of tsx.matchAll(/className="field-catalog-form([^"]*)"/gu)) {
    for (const cls of rest.trim().split(/\s+/u).filter(Boolean)) variants.add(cls);
  }
  assert.ok(variants.size >= 3,
    `expected the form's variants from the TSX, found ${[...variants].join(", ") || "none"}`);

  const blockAt = css.search(/@container[^{]*\{[^{}]*\.field-catalog-form\s*\{/u);
  assert.ok(blockAt > 0, "expected an @container block shedding .field-catalog-form's columns");

  // Only the variants that override the track list are in scope: a variant that
  // just sets a margin may sit anywhere.
  // Split on the closing brace rather than matching rules: a global regex that
  // both requires and consumes `}` skips every other rule, which read as "no
  // variant overrides anything" while two of them did.
  const rules = baseLayer(css).split("}").map((chunk) => {
    const brace = chunk.indexOf("{");
    return brace < 0 ? null : { selector: chunk.slice(0, brace).trim(), body: chunk.slice(brace + 1) };
  }).filter(Boolean);
  const overriding = [...variants].filter((cls) =>
    rules.some((r) => r.selector === `.${cls}` && /grid-template-columns/u.test(r.body)));
  assert.ok(overriding.length >= 2,
    `expected variants with their own track lists, found ${overriding.join(", ") || "none"}`);

  for (const cls of overriding) {
    const at = css.indexOf(`.${cls} {`);
    assert.ok(at >= 0, `expected a .${cls} rule`);
    assert.ok(at < blockAt,
      `.${cls} declares its own grid-template-columns after the @container block, so it wins on `
      + "source order and the query never reaches it — move the block below it (#214)");
  }

  // Reflowing puts a text field in the last column, where its 20-character
  // default width leaves the card instead of the gap: the memo field measured
  // 159px in a 136.5px cell and crossed the card's border by 6px.
  const control = css.match(/\.field-catalog-form input,\s*\n\.field-catalog-form select\s*\{([^}]*)\}/u);
  assert.ok(control, "expected the shared input/select rule for the field forms");
  assert.match(control[1], /min-width:\s*0/u,
    "without min-width: 0 the input keeps its default size as a floor and leaves the card (#214)");
});
