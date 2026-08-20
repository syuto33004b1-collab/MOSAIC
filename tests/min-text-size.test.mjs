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
 * 44 rules still carry a bare `10px`, so raising the token to 12px would leave
 * those behind — that is part of what #100 has to sort out. This checks the
 * token exists and that the bulk floor reads it, nothing wider.
 */
test("the floor is a token, and the bulk rule reads it", async () => {
  const css = (await read()).replaceAll("\r\n", "\n");
  const token = css.match(/--text-min:\s*(\d+)px/u);
  assert.ok(token, "--text-min is not defined");
  assert.ok(Number(token[1]) >= 10, `--text-min is ${token[1]}px; 10px is the floor this repo settled on`);
  assert.ok(css.includes(FLOOR), "the bulk floor rule no longer reads var(--text-min)");
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
