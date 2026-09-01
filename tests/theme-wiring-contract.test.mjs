import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { test } from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * A class the stylesheet dresses and no component wears.
 *
 * #170 was one: the theme layer said `.drawer-close { border-radius: 50%; color: var(--ink) }`
 * and the drawer's button has always been `.close-button`, so for as long as that line
 * existed the button kept the base layer's 10px corners and #687285 while the drawer icons
 * beside it were circles. Nothing failed. The stylesheet simply described a decision that
 * never reached the screen.
 *
 * #169 found three more of the same shape by hand — `.report-hero`, `.report-bars` and
 * `.toolbar-status`, eleven rules between them — and deliberately left the sweep out of
 * the suite, because eight of its twelve candidates were names built at runtime and there
 * was no reason yet to maintain a list of them. #170 is the reason: a rename that silently
 * detaches a rule is not something a person notices.
 *
 * ## Where it looks, and why not everywhere
 *
 * Components only — `*.test.ts` and `*.test.tsx` are excluded. A rendering test that still
 * queries `.close-button` after the component stopped writing it would otherwise keep the
 * rule looking worn, which is exactly the state this is meant to catch. The evaluation on
 * #170 pointed that out.
 *
 * Names are matched as whole tokens, so `level-1` is not satisfied by `level-10` and
 * `close-button` is not satisfied by `my-close-buttons`.
 *
 * ## What it cannot do
 *
 * A name here is only a name. This does not say whether a rule that *is* attached ever
 * wins — `.undo-button { display: none }` was attached and lost on specificity, which is
 * #172 — nor whether an attached rule is on the element the author meant. And a name that
 * appears in a component's comment counts as worn; the sweep reads text, not JSX.
 */

/**
 * Names the components compose rather than write, each with the expression that builds it.
 * Both halves are checked: the class has to still be styled, and its expression has to
 * still be in the source. An entry whose expression is gone is covering for a class that
 * is genuinely unused now.
 */
const BUILT_AT_RUNTIME = {
  "level-1": '"level-" +',
  "level-2": '"level-" +',
  "level-3": '"level-" +',
  "level-4": '"level-" +',
  "level-5": '"level-" +',
  "is-cancelled": "`is-${",
  "is-error": "`is-${",
  "is-superseded": "`is-${",
};

/** Everything a component could write a class name in. Tests are not components. */
async function componentText() {
  const files = [];
  const walk = async (dir) => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (/\.tsx?$/u.test(entry.name) && !/\.test\.tsx?$/u.test(entry.name)) files.push(full);
    }
  };
  await walk(path.join(root, "src"));
  files.push(path.join(root, "index.html"));
  const parts = await Promise.all(files.map((file) => readFile(file, "utf8")));
  return parts.join("\n");
}

/** `name` as a whole token rather than a substring of a longer one. */
const wears = (source, name) => new RegExp(`(?<![\\w-])${name}(?![\\w-])`, "u").test(source);

test("every class the stylesheet dresses is worn by a component", async () => {
  const css = (await readFile(path.join(root, "src", "styles.css"), "utf8")).replace(/\/\*[\s\S]*?\*\//gu, "");
  const source = await componentText();

  // Three characters or more: shorter ones are too easy to hit by accident inside other
  // words, and this stylesheet has none.
  const declared = new Set([...css.matchAll(/\.([a-z][a-z0-9-]{2,})/gu)].map((match) => match[1]));
  const unworn = [...declared].filter((name) => !wears(source, name)).sort();

  const unexplained = unworn.filter((name) => !(name in BUILT_AT_RUNTIME));
  assert.deepEqual(unexplained, [],
    `the stylesheet dresses ${unexplained.map((name) => `.${name}`).join(", ")} and no component writes `
    + "them. A rule attached to nothing is a decision that never reaches the screen — #170 was "
    + "`.drawer-close` against a button classed `.close-button`. Rename the rule, delete it, or add "
    + "it to BUILT_AT_RUNTIME with the expression that composes it");

  for (const [name, composedBy] of Object.entries(BUILT_AT_RUNTIME)) {
    assert.ok(declared.has(name), `.${name} is allowlisted but the stylesheet no longer styles it`);
    assert.ok(source.includes(composedBy),
      `.${name} is allowlisted as composed by \`${composedBy}\`, and no component composes a class that `
      + "way any more — the entry is stale and the class is unused");
  }
});
