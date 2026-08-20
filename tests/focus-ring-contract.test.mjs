import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Keyboard focus had two separate faults, both from specificity.
 *
 * `button:focus-visible, a:focus-visible` carried element specificity (0,1,1),
 * which beat every `:where(...)` rule at (0,1,0). So the ring people saw on 175
 * buttons was a pre-theme blue at 1.59-1.60:1 against its backdrop, while
 * --focus-ring sat unused on buttons and links.
 *
 * Separately, eight rules like `.view-filter select { outline: 0 }` removed the
 * UA ring at (0,1,1) and out-ranked the replacement, so 17 controls — every
 * filter select and every search box — had no focus indicator at all. That is
 * SC 2.4.7 Focus Visible, not just low contrast.
 *
 * These are static checks on the cascade. Rendered ring contrast is measured by
 * hand against the running app and recorded in the PR; jsdom has no layout.
 */

const read = () => readFile(path.join(root, "src", "styles.css"), "utf8");
const withoutComments = (css) => css.replace(/\/\*[\s\S]*?\*\//gu, "");

/** The part of a selector that picks the focused element, ignoring ancestors.
 *  Splits on descendant spaces only — `:where(a, b)` has spaces of its own. */
function lastCompound(selector) {
  let depth = 0;
  let start = 0;
  for (let i = 0; i < selector.length; i += 1) {
    const c = selector[i];
    if (c === "(") depth += 1;
    else if (c === ")") depth -= 1;
    else if (depth === 0 && (c === " " || c === ">" || c === "+" || c === "~")) start = i + 1;
  }
  return selector.slice(start).trim();
}

test("styles.css is the only stylesheet, so this file can reason about the cascade", async () => {
  const { readdir } = await import("node:fs/promises");
  const walk = async (dir) => {
    const found = [];
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name === "dist" || entry.name.startsWith(".")) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) found.push(...(await walk(full)));
      else if (entry.name.endsWith(".css")) found.push(path.relative(root, full).replaceAll("\\", "/"));
    }
    return found;
  };
  assert.deepEqual(await walk(root), ["src/styles.css"], "a second stylesheet could out-rank these rules unseen");
});

test("nothing removes or hides the outline", async () => {
  const css = withoutComments(await read());
  // Longhands and `transparent` kill the ring just as dead as `outline: 0`.
  const patterns = [
    /outline:\s*(?:0|none)[;\s}]/u,
    /outline-width:\s*0[;\s}]/u,
    /outline-style:\s*none[;\s}]/u,
    /outline-color:\s*transparent[;\s}]/u,
  ];
  const kills = [];
  for (const [, sel, body] of css.matchAll(/([^{}]*)\{([^{}]*)\}/gu)) {
    if (patterns.some((p) => p.test(body))) kills.push(sel.trim().replace(/\s+/gu, " "));
  }
  assert.deepEqual(
    kills,
    [],
    "these selectors remove the focus ring and out-rank the :where() replacement: " + kills.join(" | "),
  );
});

test("no focus rule carries specificity that beats the shared one", async () => {
  const css = withoutComments(await read());
  // Anything with more specificity than :where(...):focus-visible wins whatever
  // the source order — that is exactly how the blue ring survived the theme.
  // :is() counts (it takes its most specific argument); :where() does not.
  const offenders = [];
  for (const [, sel, body] of css.matchAll(/([^{}]*)\{([^{}]*)\}/gu)) {
    if (!/:focus(-visible)?\b/u.test(sel)) continue;
    if (!/outline(-color|-width|-style)?\s*:/u.test(body)) continue;
    const clean = sel.trim().replace(/\s+/gu, " ");
    // The ancestor part may be anything — scoping a ring to a surface is fine.
    // What matters is the *target*: the last compound must be zero-specificity,
    // i.e. :where(...):focus-visible. A bare tag, a tag+class, or :is() there
    // out-ranks the shared rule and silently wins.
    const target = lastCompound(clean);
    if (!/^:where\([^)]*\):focus-visible$/u.test(target)) offenders.push(clean);
  }
  assert.deepEqual(offenders, [], `focus rules outranking the shared one: ${offenders.join(" | ")}`);
});

/**
 * Surface *coverage* is not checked here — the test cannot know which surfaces
 * are dark. That is what the measurement step catches: sweeping every focusable
 * element on every screen and reading the rendered ring contrast surfaces a new
 * dark surface the moment one appears. What this checks is the shape: one rule
 * decides the ring for everything, and any surface override only recolours it.
 */
test("one rule decides the ring, and the rest only recolour it", async () => {
  const css = withoutComments(await read());
  const rules = [...css.matchAll(/([^{}]*:focus-visible[^{}]*)\{([^}]*)\}/gu)]
    .filter(([, , body]) => /outline(-color|-width|-style)?\s*:/u.test(body))
    .map(([, sel, body]) => ({ sel: sel.trim().replace(/\s+/gu, " "), body: body.trim().replace(/\s+/gu, " ") }));

  assert.ok(rules.length >= 1, "no rule sets a focus ring");

  const [base, ...overrides] = rules;
  assert.match(base.sel, /^:where\(button, input, select, textarea, summary, a\):focus-visible$/u,
    "the first focus rule must be the unscoped one that covers every control");
  assert.match(base.body, /outline:\s*3px solid var\(--focus-ring\)/u);
  assert.match(base.body, /outline-offset:/u);

  for (const rule of overrides) {
    assert.match(rule.sel, /^:where\([^)]*\)\s/u, `a surface override must be scoped by :where(): ${rule.sel}`);
    assert.match(rule.body, /^outline-color:\s*var\(--[a-z-]+\);?$/u,
      `a surface override may only recolour the ring, not redefine it: ${rule.sel} { ${rule.body} }`);
  }
});

test("every block that defines --focus-ring also defines the dark variant", async () => {
  const css = withoutComments(await read());
  const blocks = [...css.matchAll(/(?:^|\})\s*:root\s*\{([^}]*)\}/gmu)].map((m) => m[1]);
  const defining = blocks.filter((b) => /--focus-ring\s*:/u.test(b));
  assert.ok(defining.length >= 1, "no :root block defines --focus-ring");
  for (const [index, block] of defining.entries()) {
    assert.match(
      block,
      /--focus-ring-on-dark\s*:/u,
      `:root block ${index} defines --focus-ring without --focus-ring-on-dark, so the dark-band rule falls back to nothing`,
    );
  }
});
