import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const app = await readFile(path.join(root, "src", "App.tsx"), "utf8");

/**
 * #501: every drawer was read out as 「詳細パネル」, whichever of the sixteen had opened.
 * Each is now named by its own `<h2>` through one shared id.
 *
 * A text check over App.tsx, because the unit tests open only a few drawers: a new kind of
 * drawer, or a heading that loses the id, would still render and pass them while being
 * read out with no name at all. The kinds are taken from `DRAWER_KICKER`, which is typed
 * to cover every drawer, so adding one without a named heading fails here.
 */
const kinds = [...(/const DRAWER_KICKER = \{([\s\S]*?)\} as const/u.exec(app)?.[1] ?? "").matchAll(/^\s*(\w+):/gmu)]
  .map((match) => match[1]);

test("the drawer is named by its heading and by nothing else", () => {
  assert.match(app, /const DRAWER_TITLE_ID = "drawer-title";/u);
  const section = /<section className=\{"drawer "[^>]*>/u.exec(app)?.[0];
  assert.ok(section, "the drawer's <section> was not found");
  assert.match(section, /role="dialog"/u);
  assert.match(section, /aria-labelledby=\{DRAWER_TITLE_ID\}/u);
  assert.doesNotMatch(section, /aria-label=/u,
    "an aria-label beside the labelledby would name a drawer whose heading lost the id");
});

test("every kind of drawer has a heading with the shared id", () => {
  assert.equal(kinds.length, 16, `DRAWER_KICKER lists ${kinds.length} kinds`);
  for (const kind of kinds) {
    // The branch that renders the drawer, `{drawer === "x" && selected && (`, not the kicker's
    // `{drawer === "needForm" && editingNeedId ? …`, and only up to the next branch: from the
    // kicker, the first <h2> after it was the chooser's, so needForm and opportunityNeedForm
    // passed without looking at their own.
    const branch = new RegExp(`\\{drawer === "${kind}" && (?:[\\w.]+ && )*\\(`, "u").exec(app);
    assert.ok(branch, `no branch renders the ${kind} drawer`);
    const rest = app.slice(branch.index + branch[0].length);
    const next = rest.indexOf("{drawer === ");
    const heading = /<h2[^>]*>/u.exec(next >= 0 ? rest.slice(0, next) : rest)?.[0];
    assert.equal(heading, "<h2 id={DRAWER_TITLE_ID}>", `the ${kind} drawer's heading is ${heading ?? "missing"}`);
  }
});

test("a disclosure summary keeps its own role", () => {
  assert.doesNotMatch(app, /<summary[^>]*\srole=/u,
    "`summary` already opens and closes its <details>; a role on it overrides that (#501)");
});
