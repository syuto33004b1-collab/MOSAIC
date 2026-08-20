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
  const block = css.match(/@container[^{]*\{([\s\S]*?)\n\}/u);
  assert.ok(block, "no @container block");
  // Keyed off the container rather than the viewport because these forms sit at
  // different depths: a 620px media query left the nested report form at
  // `120px 0px 147px 120px` while the others still fitted.
  assert.match(block[1], /\.field-catalog-form\s*\{[^}]*repeat\(auto-fit/u);
  assert.match(block[1], /\.role-permission-form\s*\{[^}]*repeat\(auto-fit/u);
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
