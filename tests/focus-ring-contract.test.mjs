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

test("nothing removes the outline outright", async () => {
  const css = withoutComments(await read());
  const kills = [...css.matchAll(/[^\n{}]*\{[^}]*outline:\s*(?:0|none)[;\s}]/gu)].map((m) =>
    m[0].split("{")[0].trim().replace(/\s+/gu, " "),
  );
  assert.deepEqual(
    kills,
    [],
    "these selectors remove the focus ring and out-rank the :where() replacement: " + kills.join(" | "),
  );
});

test("no focus rule carries element specificity", async () => {
  const css = withoutComments(await read());
  // A bare tag name before :focus-visible beats every :where() rule, whatever
  // the source order. That is exactly how the blue ring survived the theme.
  const offenders = [...css.matchAll(/(^|[\s,])(?:button|a|input|select|textarea|summary)\s*:focus-visible/gmu)]
    .map((m) => m[0].trim())
    .filter((sel) => !sel.includes(":where"));
  assert.deepEqual(offenders, [], `element-level :focus-visible selectors: ${offenders.join(", ")}`);
});

test("one rule decides the ring, and one more handles the dark bands", async () => {
  const css = withoutComments(await read());
  const setsOutline = [...css.matchAll(/([^{}]*:focus-visible[^{}]*)\{([^}]*)\}/gu)]
    .filter(([, , body]) => /outline(-color)?\s*:/u.test(body))
    .map(([, sel, body]) => ({ sel: sel.trim().replace(/\s+/gu, " "), body: body.trim().replace(/\s+/gu, " ") }));

  assert.equal(setsOutline.length, 2, `expected exactly two focus rules, found ${setsOutline.length}: ` +
    setsOutline.map((r) => r.sel).join(" | "));

  const [base, dark] = setsOutline;
  assert.match(base.sel, /^:where\(button, input, select, textarea, summary, a\):focus-visible$/u);
  assert.match(base.body, /outline:\s*3px solid var\(--focus-ring\)/u);
  assert.match(dark.sel, /pulse-strip|ribbon/u, "the second rule should be the dark-surface override");
  assert.match(dark.body, /outline-color:\s*var\(--focus-ring-on-dark\)/u);
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
