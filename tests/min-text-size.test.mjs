import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * A bulk rule of 134 selectors sets a 10px floor. Rules written *after* it
 * override it, and that is where every element still rendering below 10px came
 * from: 215 of 1355 text-bearing elements, including every form label, three
 * table headers, and the skill-tree breadcrumbs at 2.78:1.
 *
 * ## What this is
 *
 * A narrow syntactic guard: no `font-size` or `font` shorthand below the token,
 * declared after the floor rule, outside the allowlist. It exists to stop the
 * specific regression that shipped — a small literal written after the floor.
 *
 * ## What this is not
 *
 * **It does not prove nothing renders below the token.** Source order is only
 * one of the things the cascade weighs; `!important`, specificity, cascade
 * layers and inline styles all outrank it, and a declaration *before* the floor
 * still renders small if the floor's selector list happens not to cover it. Nor
 * does the matching see every syntax that can express a size — `calc()`, a size
 * carried through another custom property, or a unit this file does not know.
 *
 * Rendered sizes are swept with getComputedStyle across every screen and state
 * and recorded in the PR. That sweep is the real check; this is the cheap one.
 */

const read = () => readFile(path.join(root, "src", "styles.css"), "utf8");
const FLOOR = ".production-runtime-info {\n  font-size: var(--text-min);";

/**
 * The AI chat panel does not render in DEMO mode — `.ai-chat-root` carries
 * `is-unavailable` and the panel's contents never enter the DOM — so raising
 * these could not be verified on screen. Tracked in #101. Empty this list when
 * they are fixed, and delete it when it is empty.
 */
const UNVERIFIABLE_IN_DEMO = /^\.ai-chat-/u;

/** Sizes in px and rem, from both `font-size:` and the `font:` shorthand. */
function* sizes(css) {
  for (const [, sel, body] of css.matchAll(/([^{}]+)\{([^{}]*)\}/gu)) {
    const selector = sel.trim().replaceAll("\n", " ").replace(/\s+/gu, " ");
    for (const m of body.matchAll(/font-size:\s*([0-9.]+)(px|rem|em)/gu)) {
      yield { selector, px: m[2] === "px" ? Number(m[1]) : Number(m[1]) * 16, raw: m[0] };
    }
    // `font: [style] [variant] [weight] <size>[/<line-height>] <family>`.
    // The weight may be a keyword or a number, so both have to be skippable
    // before the size — `font: normal 700 9px …` slipped through when only
    // keywords were.
    for (const m of body.matchAll(/font:\s*(?:(?:[a-z-]+|\d{3})\s+)*?([0-9.]+)(px|rem|em)\b/gu)) {
      yield { selector, px: m[2] === "px" ? Number(m[1]) : Number(m[1]) * 16, raw: m[0] };
    }
  }
}

/**
 * "One edit moves the floor" is true only for the rules that read the token.
 * #100 raised the token from 10px to 12px and converted the 20 literals that
 * were left behind — measured, that took the elements rendering below 12px from
 * 150 to 0 across nine screens.
 */
test("the floor is a token, and the bulk rule reads it", async () => {
  const css = (await read()).replaceAll("\r\n", "\n");
  const token = css.match(/--text-min:\s*(\d+)px/u);
  assert.ok(token, "--text-min is not defined");
  assert.ok(Number(token[1]) >= 12, `--text-min is ${token[1]}px; #100 raised the floor to 12px`);
  assert.ok(css.includes(FLOOR), "the bulk floor rule no longer reads var(--text-min)");
});

/**
 * Raising the floor costs vertical space, and #100's acceptance test is that the
 * pages get *shorter*. Leading is where most of that came back, and it was
 * declared in two places: the bulk rule said `1.5`, and `body` said nothing at
 * all — so roughly 200 elements per screen inherited `normal`. Both read one
 * token now, so the two cannot drift apart again.
 *
 * ## What this cannot do
 *
 * It reads two declarations. The page heights are browser measurements and are
 * recorded in the PR.
 */
test("leading is one token, read by both the bulk rule and body", async () => {
  const css = (await read()).replaceAll("\r\n", "\n");
  const token = css.match(/--leading:\s*([\d.]+)/u);
  assert.ok(token, "--leading is not defined");
  // A unitless ratio: a px value would stop scaling with the font size, which
  // is the whole point of pairing it with the floor.
  assert.match(css.match(/--leading:\s*([^;]+)/u)[1].trim(), /^[\d.]+$/u,
    "--leading has to be unitless so it scales with the size");

  assert.ok(css.includes(`${FLOOR}\n  line-height: var(--leading);`),
    "the bulk rule must take its leading from the token");

  const body = [...css.matchAll(/(?:^|\n)body\s*\{([^}]*)\}/gu)].map(([, b]) => b);
  assert.ok(body.some((b) => /line-height:\s*var\(--leading\)/u.test(b)),
    "no body rule reads --leading; the elements outside the bulk rule fall back to `normal`");
});

test("no rule after the floor declares a size below it", async () => {
  const css = (await read()).replaceAll("\r\n", "\n");
  const token = Number(css.match(/--text-min:\s*(\d+)px/u)[1]);
  const anchor = css.indexOf(FLOOR);
  assert.ok(anchor > 0, "floor rule not found");

  const offenders = [...sizes(css.slice(anchor))]
    .filter((d) => d.px < token)
    .filter((d) => !UNVERIFIABLE_IN_DEMO.test(d.selector))
    .map((d) => `${d.selector.slice(0, 60)} => ${d.raw}`);

  assert.deepEqual(
    offenders,
    [],
    `these come after the ${token}px floor, so they override it and render smaller:\n  ` + offenders.join("\n  "),
  );
});

/**
 * The mirror of the test above, for the other side of the floor rule.
 *
 * A literal *before* the floor is harmless only while the floor's selector list
 * covers it — same selector text, so identical specificity, and the later rule
 * wins. #100 found 44 that were not covered: `.person-copy strong` at 10px,
 * `.profile-actions button` at 8px, every `.production-*` list. Six of them were
 * visible in DEMO and rendered at 10–11px with a 12px token; the rest live in
 * drawers, popovers and shared-mode screens the browser sweep never reaches,
 * which is exactly why a static check is worth having here.
 *
 * ## What this cannot do
 *
 * It compares selector *text*. A rule the floor covers by a different but
 * equivalent selector reads as a hole, and a rule that loses to `!important` or
 * an inline style reads as covered. Both would be a change to how this file is
 * layered, and would want a look rather than a quiet pass.
 */
test("every small literal before the floor is one the floor covers", async () => {
  const css = (await read()).replaceAll("\r\n", "\n");
  const token = Number(css.match(/--text-min:\s*(\d+)px/u)[1]);
  const anchor = css.indexOf(FLOOR);
  // The bulk rule's own selector list, read from the file rather than restated.
  const listStart = css.lastIndexOf("}", anchor) + 1;
  const bulk = new Set(css.slice(listStart, anchor + ".production-runtime-info".length)
    .split(",").map((part) => part.trim()));
  assert.ok(bulk.size > 100, `expected the bulk floor's selector list, got ${bulk.size} entries`);

  const holes = [];
  for (const [, selector, body] of css.slice(0, anchor).matchAll(/([^{}]+)\{([^{}]*)\}/gu)) {
    const clean = selector.replace(/\/\*[\s\S]*?\*\//gu, "").trim().replace(/\s+/gu, " ");
    const parts = clean.split(",").map((part) => part.trim()).filter(Boolean);
    if (parts.length === 0 || parts.every((part) => bulk.has(part))) continue;
    for (const [raw, size] of body.matchAll(/font-size:\s*([\d.]+)px/gu)) {
      if (Number(size) < token) holes.push(`${clean.slice(0, 58)} => ${raw}`);
    }
  }
  assert.deepEqual(holes, [], `the floor's selector list does not reach these, so they render below ${token}px:\n  `
    + holes.join("\n  "));
});

test("the allowlist stays honest about what it excuses", async () => {
  const css = (await read()).replaceAll("\r\n", "\n");
  const token = Number(css.match(/--text-min:\s*(\d+)px/u)[1]);
  const anchor = css.indexOf(FLOOR);
  const excused = [...sizes(css.slice(anchor))]
    .filter((d) => d.px < token && UNVERIFIABLE_IN_DEMO.test(d.selector));
  // If the allowlist stops excusing anything, the exception has outlived its
  // reason — delete it rather than leaving a rule nobody needs.
  assert.ok(
    excused.length > 0,
    "nothing is below the floor in the AI chat panel any more; remove UNVERIFIABLE_IN_DEMO and close #101",
  );
});

test("the rules that were raised still reference the token", async () => {
  const css = (await read()).replaceAll("\r\n", "\n");
  // One per family that was below the floor, so reverting any of them to a
  // literal fails here rather than quietly rendering at 8px again. This is a
  // sample, not the whole set — the check above is what covers the rest.
  const mustUseToken = [
    "\\.skill-tree-name small",
    "\\.skill-map-table th",
    "\\.field-catalog-form label",
    "\\.skill-catalog-form label",
    "\\.profile-request-members legend",
    "\\.proposal-picker-item small",
    "\\.proposal-picker-group > small",
    "\\.proficiency-rail i",
    "\\.view-toggle",
  ];
  for (const pattern of mustUseToken) {
    const rule = css.match(new RegExp(`${pattern}\\s*\\{([^}]*)\\}`, "u"));
    assert.ok(rule, `rule not found: ${pattern}`);
    assert.match(rule[1], /font-size:\s*var\(--text-min\)/u, `${pattern} should size from the token`);
  }
});
