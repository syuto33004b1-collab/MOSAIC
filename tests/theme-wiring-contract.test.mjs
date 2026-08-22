import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { test } from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * A class the stylesheet dresses and nothing wears.
 *
 * #170 was one: the theme layer said `.drawer-close { border-radius: 50%; color: var(--ink) }`
 * and the drawer's button has always been `.close-button`, so for as long as that line
 * existed the button kept the base layer's 10px corners and #687285 while the drawer icons
 * beside it were circles. Nothing failed. The stylesheet simply described a decision that
 * never reached the screen.
 *
 * #169 found three more of the same shape by hand — `.report-hero`, `.report-bars` and
 * `.toolbar-status`, eleven rules between them — and deliberately did not turn the sweep
 * into a test, because eight of its twelve candidates were names built at runtime and
 * there was no reason yet to maintain a list of them. #170 is the reason: a rename that
 * silently detaches a rule is not something a person notices.
 *
 * ## What it cannot do
 *
 * A name here is only a name. This does not say whether a rule that *is* attached ever
 * wins — `.undo-button { display: none }` was attached and lost on specificity, which is
 * #172 — nor whether an attached rule is on the element the author meant.
 *
 * It also cannot see a class built from a variable. Those are the allowlist below, and it
 * fails if one stops being built that way, because then the entry is stale and the class
 * really is unused.
 */

/**
 * Names the source composes rather than writes, with where each one comes from. Each has
 * to be reachable from the prefix that builds it, or the entry is the thing that is out
 * of date.
 */
const BUILT_AT_RUNTIME = {
  "level-1": '"level-" + level in the skill rail',
  "level-2": '"level-" + level in the skill rail',
  "level-3": '"level-" + level in the skill rail',
  "level-4": '"level-" + level in the skill rail',
  "level-5": '"level-" + level in the skill rail',
  "is-cancelled": "`is-${status}` in the AI chat's proposal result",
  "is-error": "`is-${status}` in the AI chat's proposal result",
  "is-superseded": "`is-${status}` in the AI chat's proposal result",
};

/** The prefixes those names are composed from, so a stale entry can be told from a live one. */
const RUNTIME_PREFIXES = ['"level-" +', "`is-${"];

async function sourceText() {
  const files = [];
  const walk = async (dir) => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (/\.tsx?$/u.test(entry.name)) files.push(full);
    }
  };
  await walk(path.join(root, "src"));
  files.push(path.join(root, "index.html"));
  const parts = await Promise.all(files.map((file) => readFile(file, "utf8")));
  return parts.join("\n");
}

test("every class the stylesheet dresses is worn by something", async () => {
  const css = await readFile(path.join(root, "src", "styles.css"), "utf8");
  const source = await sourceText();

  // Three characters or more: the shorter ones are too easy to hit by accident inside
  // other words, and this stylesheet has none.
  const declared = new Set([...css.matchAll(/\.([a-z][a-z0-9-]{2,})/gu)].map((match) => match[1]));
  const unworn = [...declared].filter((name) => !source.includes(name)).sort();

  const unexplained = unworn.filter((name) => !(name in BUILT_AT_RUNTIME));
  assert.deepEqual(unexplained, [],
    `the stylesheet dresses ${unexplained.map((name) => `.${name}`).join(", ")} and no source writes `
    + "them. A rule attached to nothing is a decision that never reaches the screen — #170 was "
    + "`.drawer-close` against a button classed `.close-button`. Rename the rule, delete it, or add "
    + "it to BUILT_AT_RUNTIME with where it is composed");

  // And the other direction: an allowlisted name has to still be composed somewhere, or
  // the entry is covering for a class that is genuinely unused now.
  for (const [name, why] of Object.entries(BUILT_AT_RUNTIME)) {
    assert.ok(declared.has(name), `.${name} is allowlisted (${why}) but the stylesheet no longer styles it`);
    assert.ok(RUNTIME_PREFIXES.some((prefix) => source.includes(prefix)),
      `.${name} is allowlisted as built at runtime (${why}) and no source composes a class that way any more`);
  }
});
