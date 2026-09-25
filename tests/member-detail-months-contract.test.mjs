import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * #450. The member detail line sits in the month table, so the tall drawer
 * stays one column. Actions stay pinned; the sheet scrolls with the rest.
 */

const read = (name) => readFile(path.join(root, name), "utf8");

test("the tall member drawer scrolls one column and pins the actions", async () => {
  const css = await read("src/styles.css");
  const media = css.slice(css.indexOf("@media (min-width: 1052px) and (min-height: 720px)"));
  const panes = media.match(/\.member-detail-panes \{([^}]+)\}/u);
  const actions = media.match(/\.member-detail-actions \{([^}]+)\}/u);
  assert.ok(panes, "the tall query no longer styles .member-detail-panes");
  assert.ok(actions, "the tall query no longer styles .member-detail-actions");
  assert.match(panes[1], /overflow:\s*auto/u);
  assert.match(panes[1], /flex-direction:\s*column/u);
  assert.doesNotMatch(panes[1], /grid-template-columns/u);
  assert.match(actions[1], /flex:\s*0 0 auto/u);
});

test("the hero sentence wraps at the text floor", async () => {
  const css = await read("src/styles.css");
  const rule = css.match(/\.member-detail \.profile-hero > strong \{([^}]+)\}/u);
  assert.ok(rule, "the member hero sentence has no override");
  assert.match(rule[1], /font-size:\s*var\(--text-min\)/u);
  assert.match(rule[1], /white-space:\s*normal/u);
  assert.doesNotMatch(rule[1], /nowrap/u);
});

test("the plot cell is not inset and the date stays at the text floor", async () => {
  const css = await read("src/styles.css");
  const plot = css.match(/\.member-load-sheet td\.member-load-plot-cell \{([^}]+)\}/u);
  const date = css.match(/\.member-load-sheet th small \{([^}]+)\}/u);
  assert.ok(plot, "the plot cell padding has no selector that beats the table cell");
  assert.match(plot[1], /padding:\s*0/u);
  assert.ok(date, "the assignment date has no size of its own");
  assert.match(date[1], /font-size:\s*var\(--text-min\)/u);
  const names = css.match(/\.member-load-names small \{([^}]+)\}/u);
  assert.ok(names, "the dateless-window date has no size of its own");
  assert.match(names[1], /font-size:\s*var\(--text-min\)/u);
});

test("the month line shares the table and keeps a non-scaling stroke", async () => {
  const app = await read("src/App.tsx");
  assert.match(app, /className="member-load-sheet"/u);
  assert.match(app, /colSpan=\{months\.length\}/u);
  assert.match(app, /vectorEffect="non-scaling-stroke"/u);
  assert.match(app, /preserveAspectRatio="none"/u);
  assert.doesNotMatch(app, /memberMonthScrollLeft/u);
});
