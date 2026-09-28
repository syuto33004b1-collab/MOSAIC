import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * #454. The member dialog is content height. Only assignment rows scroll, at
 * every viewport, so the month line and the buttons stay on screen.
 */

const read = (name) => readFile(path.join(root, name), "utf8");

test("the member drawer sizes to its content and scrolls only assignment rows", async () => {
  const css = await read("src/styles.css");
  const drawer = css.match(/\.drawer\.member-detail-open \{([^}]+)\}/u);
  assert.ok(drawer, "the member drawer has no size of its own");
  assert.match(drawer[1], /overflow:\s*hidden/u);
  assert.match(drawer[1], /display:\s*flex/u);
  assert.match(drawer[1], /flex-direction:\s*column/u);
  assert.match(drawer[1], /height:\s*auto/u);
  assert.match(drawer[1], /max-height:\s*100%/u);
  const scroll = css.match(/\.member-load-scroll \{([^}]+)\}/u);
  assert.ok(scroll, "the month sheet has no sideways port");
  assert.match(scroll[1], /overflow-x:\s*auto/u);
  assert.match(scroll[1], /overflow-y:\s*hidden/u);
  const assignments = css.match(/\.member-load-assignments \{([^}]+)\}/u);
  assert.ok(assignments, "assignment rows have no scroller");
  assert.match(assignments[1], /overflow-y:\s*auto/u);
  assert.match(css, /min-width:\s*32rem/u);
  assert.doesNotMatch(css, /min-width:\s*44rem/u);
  const panes = css.match(/\.member-detail-panes \{([^}]+)\}/u);
  assert.ok(panes);
  assert.match(panes[1], /overflow:\s*hidden/u);
  assert.match(panes[1], /flex-direction:\s*column/u);
  assert.doesNotMatch(panes[1], /grid-template-columns/u);
  assert.doesNotMatch(panes[1], /overflow:\s*auto/u);
  const actions = css.match(/\.member-detail-actions \{([^}]+)\}/u);
  assert.ok(actions);
  assert.match(actions[1], /flex:\s*0 0 auto/u);
  const who = css.match(/\.member-detail-who \{([^}]+)\}/u);
  assert.ok(who, "history has no block of its own");
  assert.match(who[1], /flex:\s*0 0 auto/u);
  assert.doesNotMatch(who[1], /overflow-y:\s*auto/u);
  assert.doesNotMatch(css, /min-height:\s*24rem/u);
  assert.match(css, /\.member-detail-load:has\(\.member-load-scroll\)\s*\{[^}]*min-height:\s*20rem/u);
  const scrollBox = css.match(/\.member-load-scroll \{([^}]+)\}/u);
  assert.match(scrollBox[1], /min-height:\s*14\.5rem/u);
  const media = css.slice(css.indexOf("@media (min-width: 1052px) and (min-height: 720px)"));
  assert.doesNotMatch(media, /\.member-detail-panes/u);
  assert.doesNotMatch(media, /\.drawer\.member-detail-open/u);
});

test("the hero week caption wraps at the text floor", async () => {
  const css = await read("src/styles.css");
  const rule = css.match(/\.member-week-caption \{([^}]+)\}/u);
  assert.ok(rule, "the week caption has no size of its own");
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
  assert.match(date[1], /word-break:\s*keep-all/u);
  assert.match(date[1], /overflow-wrap:\s*normal/u);
  assert.match(names[1], /word-break:\s*keep-all/u);
  assert.match(names[1], /overflow-wrap:\s*normal/u);
  assert.match(css, /border-inline-start:\s*1px solid var\(--line\)/u);
  assert.match(css, /border-inline-end:\s*1px solid var\(--line\)/u);
  assert.match(css, /\.member-load-assignments \.member-load-sheet th,\s*\.member-load-assignments \.member-load-sheet td \{ padding-block:\s*8px;\s*\}/u);
  assert.match(css, /\.member-detail \.profile-hero \{[^}]*margin-bottom:\s*16px/u);
  assert.match(css, /\.member-detail \.drawer-section-title \{ margin-bottom:\s*12px;\s*\}/u);
  assert.match(css, /\.member-detail-load-summary \{[^}]*margin:\s*0 0 8px/u);
  assert.match(css, /\.member-load-note \{[^}]*margin:\s*0 0 12px/u);
  assert.match(css, /\.member-work-history \{[^}]*margin:\s*12px 0 0/u);
  assert.match(css, /\.member-detail-actions \{[^}]*margin-top:\s*16px/u);
  const short = css.match(/@media \(max-height:\s*700px\) \{([\s\S]*?)\n\}/u);
  assert.ok(short, "a short window has no release for the chart floors");
  assert.match(short[1], /\.member-load-scroll/u);
  assert.match(short[1], /min-height:\s*0/u);
});

test("the month line shares the table and keeps a non-scaling stroke", async () => {
  const app = await read("src/App.tsx");
  const css = await read("src/styles.css");
  assert.match(app, /className="member-load-sheet"/u);
  assert.match(app, /colSpan=\{months\.length\}/u);
  assert.match(app, /vectorEffect="non-scaling-stroke"/u);
  assert.match(app, /preserveAspectRatio="none"/u);
  assert.match(app, /data-mark=\{value\}/u);
  assert.match(app, /className="member-month-column"/u);
  assert.match(app, /monthColumnGuidesMisaligned/u);
  assert.match(app, /className="member-month-points"/u);
  assert.doesNotMatch(app, /memberMonthScrollLeft/u);
  const empty = app.slice(app.indexOf("if (months.length === 0)"), app.indexOf("const yMax"));
  assert.match(empty, /member-load-assignments/u);
  assert.match(empty, /member-load-names/u);
  const sheet = css.match(/\.member-load-sheet \{([^}]+)\}/u);
  assert.ok(sheet);
  assert.doesNotMatch(sheet[1], /min-width:\s*44rem/u);
});
