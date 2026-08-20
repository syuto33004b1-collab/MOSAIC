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
 * So the invariant is positional: a sub-10px font-size declared after the floor
 * wins over it. Declarations *before* the floor are harmless — the floor still
 * raises them — which is why this only checks what follows.
 *
 * ## What this cannot do
 *
 * It does not measure rendered sizes. A rule before the floor that the floor's
 * selector list happens not to cover would still render small and pass here.
 * Rendered sizes are swept with getComputedStyle and recorded in the PR.
 */

const read = () => readFile(path.join(root, "src", "styles.css"), "utf8");
const FLOOR = ".production-runtime-info {\n  font-size: var(--text-min);";

/** Every `font-size: Npx` and `font: <weight> Npx` in a chunk of CSS. */
function* sizes(css) {
  for (const [, sel, body] of css.matchAll(/([^{}]+)\{([^{}]*)\}/gu)) {
    for (const m of body.matchAll(/font-size:\s*([0-9.]+)px/gu)) yield { sel: sel.trim(), px: Number(m[1]) };
    for (const m of body.matchAll(/font:\s*\d+\s+([0-9.]+)px/gu)) yield { sel: sel.trim(), px: Number(m[1]) };
  }
}

test("the floor is a token, so one edit moves every rule that honours it", async () => {
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
    .map((d) => `${d.sel.replaceAll("\n", " ").slice(0, 60)} => ${d.px}px`);

  assert.deepEqual(
    offenders,
    [],
    `these override the ${token}px floor because they come after it, so they render smaller:\n  ` + offenders.join("\n  "),
  );
});

test("the rules that were raised still reference the token", async () => {
  const css = (await read()).replaceAll("\r\n", "\n");
  // A sample across the families that were below the floor, so reverting any one
  // of them to a literal fails here rather than silently rendering at 8px.
  const mustUseToken = [
    "\\.skill-tree-name small",
    "\\.skill-map-table th",
    "\\.field-catalog-form label",
    "\\.skill-catalog-form label",
    "\\.profile-request-members legend",
    "\\.proposal-picker-item small",
    "\\.proposal-picker-group > small",
  ];
  for (const pattern of mustUseToken) {
    const rule = css.match(new RegExp(`${pattern}\\s*\\{([^}]*)\\}`, "u"));
    assert.ok(rule, `rule not found: ${pattern}`);
    assert.match(rule[1], /font-size:\s*var\(--text-min\)/u, `${pattern} should size from the token`);
  }
});
