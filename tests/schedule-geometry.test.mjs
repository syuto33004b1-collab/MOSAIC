import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * The schedule header and each row's week cell draw the same five days, and
 * they used to compute the boundaries from different boxes: the header split
 * (width − label), the cell split (width − label − 16px of its own padding).
 * Measured at 1585px, the six boundaries of the week drifted
 * +8.00 / +4.80 / +1.59 / −1.61 / −4.81 / −8.02px, so Thursday's bar sat under
 * Wednesday's label.
 *
 * `.day-grid` draws the boundary lines and agreed with the header even on main,
 * because `inset: 0` resolves against the cell's padding box and so absorbed
 * the same 8px the cell was subtracting. That coincidence is why the lines
 * looked right while the bars did not. All three now read one pair of tokens.
 *
 * ## What this file is
 *
 * A static heuristic over a flat stylesheet, not a cascade. It checks that the
 * three grids declare the tokens and nothing later takes them away, that
 * nothing gives the cell horizontal padding, and that the media override of the
 * tokens comes after the `:root` that defines them.
 *
 * That last one is new debt, not an old bug: the previous override set
 * `.schedule-head`'s own `grid-template-columns` after the base rule and did
 * apply — verified on main at 1585px, where the header measured `260px` plus
 * `128.594px` ×5. Only in token form does the order decide it, two `:root`
 * declarations both weighing (0,1,0) with the media query adding nothing.
 *
 * ## What it does not prove
 *
 * Not the post-cascade value, not the rendered boundaries, and not any of it
 * once this file adopts CSS nesting — the brace matching below is flat, so a
 * nested `.week-cell` block would be attributed to its parent's selector. The
 * rendered boundaries are the real evidence: measured at 390, 485, 805, 1085,
 * 1425, 1499, 1500 and 1585 plus the width where the table stops being pinned
 * to its 740px min-width, and recorded in the PR.
 */

const read = () => readFile(path.join(root, "src", "styles.css"), "utf8");
const withoutComments = (css) => css.replace(/\/\*[\s\S]*?\*\//gu, "");

/** Every rule whose selector mentions the class, media blocks included. */
function allRules(css, className) {
  return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/gu)]
    .filter(([, sel]) => new RegExp(`\\.${className}(?![\\w-])`, "u").test(sel))
    .map(([, sel, body]) => ({ selector: sel.trim().replace(/\s+/gu, " "), body }));
}

/**
 * Every declaration of `prop` in a body, in source order. Taking only the first
 * would pass `padding-inline: 0; padding-inline: 8px`, where the second wins.
 */
function declarations(body, prop) {
  return [...body.matchAll(new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+)`, "gu"))].map((m) => m[1].trim());
}

const DAY_GRIDS = {
  // The header carries the label column first; the other two are days only.
  "schedule-head": /^var\(--schedule-label-col\)\s+var\(--schedule-day-tracks\)$/u,
  "week-cell": /^var\(--schedule-day-tracks\)$/u,
  "day-grid": /^var\(--schedule-day-tracks\)$/u,
};

test("every grid that draws the days takes its columns from the same token", async () => {
  const css = withoutComments(await read()).replaceAll("\r\n", "\n");
  for (const [className, expected] of Object.entries(DAY_GRIDS)) {
    const decls = allRules(css, className)
      .flatMap(({ selector, body }) => declarations(body, "grid-template-columns").map((value) => ({ selector, value })));
    assert.ok(decls.length >= 1, `nothing sets grid-template-columns for .${className}`);
    // Every declaration, not just the last: a media-query one that wins only at
    // some widths is as much a divergence as a later unconditional one.
    const rogue = decls
      .filter((d) => !expected.test(d.value))
      .map((d) => `${d.selector.slice(0, 60)} => ${d.value}`);
    assert.deepEqual(
      rogue,
      [],
      `.${className} must declare exactly ${expected.source}, or the grids can disagree again:\n  ` + rogue.join("\n  "),
    );
  }
  assert.match(
    allRules(css, "schedule-row").map((r) => r.body).join(";"),
    /grid-template-columns:\s*var\(--schedule-label-col\)/u,
    ".schedule-row must take its label column from the same token as the header",
  );
});

test("no rule gives the week cell horizontal padding", async () => {
  const css = withoutComments(await read()).replaceAll("\r\n", "\n");
  const rules = allRules(css, "week-cell");
  assert.ok(rules.length >= 1, "no .week-cell rule found");
  const zero = (value) => /^0(?:px|rem|em|%)?$/u.test(value.trim());
  const offenders = [];
  for (const { selector, body } of rules) {
    // Shorthand: `a`, `a b`, `a b c`, `a b c d` — the inline values are the
    // second (and fourth, when four are given), or the only one when there is one.
    for (const value of declarations(body, "padding")) {
      const parts = value.split(/\s+/u);
      const inline = parts.length === 1 ? [parts[0]] : [parts[1], parts[3] ?? parts[1]];
      if (!inline.every(zero)) offenders.push(`${selector.slice(0, 50)} => padding: ${value}`);
    }
    // And the longhands, which a shorthand check alone would miss.
    for (const prop of ["padding-inline", "padding-inline-start", "padding-inline-end", "padding-left", "padding-right"]) {
      for (const value of declarations(body, prop)) {
        if (!value.split(/\s+/u).every(zero)) offenders.push(`${selector.slice(0, 50)} => ${prop}: ${value}`);
      }
    }
  }
  assert.deepEqual(
    offenders,
    [],
    "horizontal padding here makes the cell divide a narrower box than the header, and the day boundaries drift:\n  " + offenders.join("\n  "),
  );
});

test("only :root sets the schedule tokens", async () => {
  const css = withoutComments(await read()).replaceAll("\r\n", "\n");
  // Reading the same custom property is no guarantee if a descendant redefines
  // it: `.week-cell { --schedule-day-tracks: repeat(5, 1fr) }` would reinstate
  // the whole bug while every check above still passed.
  const setters = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/gu)]
    .filter(([, , body]) => /--schedule-(?:label-col|day-tracks)\s*:/u.test(body))
    .map(([, sel]) => sel.trim().replace(/\s+/gu, " "))
    .filter((sel) => sel !== ":root");
  assert.deepEqual(setters, [], `these redefine the schedule tokens outside :root: ${setters.join(", ")}`);
});

/**
 * The one exception, and why it is not one. The board can show a month, so the
 * number of day columns is data — five, or the 20 to 23 weekdays of a month — and
 * a stylesheet cannot know it. App.tsx sets `--schedule-day-tracks` inline.
 *
 * What the rule above is really protecting is that the header row and every row's
 * cell divide the same box the same way (#106). An inline value on their common
 * ancestor does not break that; one on either of them would. So it goes on
 * `.schedule-card`, and this checks that it does.
 */
test("the board's own track count is set on the ancestor both halves read", async () => {
  const tsx = (await readFile(path.join(root, "src", "App.tsx"), "utf8")).replaceAll("\r\n", "\n");
  const setters = [...tsx.matchAll(/--schedule-day-tracks/gu)];
  assert.equal(setters.length, 1, `expected exactly one inline setter in App.tsx, found ${setters.length}`);

  // The element carrying it has to be the card: `.schedule-head` and `.week-cell`
  // are both inside it, and nothing else that reads the token is.
  const at = tsx.indexOf("--schedule-day-tracks");
  const tag = tsx.slice(tsx.lastIndexOf("<", at), at);
  assert.match(tag, /className="schedule-card"/u,
    "the track count belongs on .schedule-card, the common ancestor of the header row and the week cells "
    + "— on either of those it would reinstate the drift #106 fixed");
});

test("the wide-screen override comes after the tokens it overrides", async () => {
  const css = withoutComments(await read()).replaceAll("\r\n", "\n");
  // A plain :root later in the file beats a media query earlier in it, both
  // being (0,1,0). Column 0 distinguishes the base :root from the ones nested
  // in media blocks, which this file indents; without that, an override moved
  // above the base would be measured against its own inner :root.
  for (const token of ["--schedule-label-col", "--schedule-day-tracks"]) {
    const defined = css.search(new RegExp(`\\n:root\\s*\\{[^}]*${token}:`, "u"));
    assert.ok(defined > 0, `${token} is not defined on a top-level :root`);
    const overrides = [...css.matchAll(new RegExp(`@media[^{]*\\{\\s*:root\\s*\\{[^}]*${token}:[^}]*\\}`, "gu"))];
    assert.ok(overrides.length >= 1, `no media override for ${token}`);
    for (const m of overrides) {
      assert.ok(
        m.index > defined,
        `a media override of ${token} at ${m.index} precedes the :root definition at ${defined}, so it never applies`,
      );
    }
  }
});

/**
 * A bar too narrow to hold both its name and its percentage keeps the name.
 *
 * Measured at 1440px in month mode, where a day column is 34px: a two-day bar is 58px
 * wide, 38px of that inside its padding, and the percentage badge with its gap is 31.8px —
 * the project name got 3.3px of the 102px it wanted, ellipsis and all. The name is the only
 * thing on the bar that says which project it is; the percentage is also in the bar's
 * `title`, in the drawer behind it, and the row's total is in the `.load` chip beside it.
 *
 * 100px is measured, not chosen: with the badge, a three-day bar (92px) still leaves the
 * name 40px. Without it the name gets 4px at one day, 38px at two, 72px at three, and from
 * four days up both fit. Week mode's columns are 72px, where the shortest bar is around
 * 200px, so it never reaches this rule (#188).
 *
 * Static, like the rest of this file: it reads the declarations, not the rendered bar. The
 * rendered evidence is in the PR — 3.3px → 35px on the two-day bar, badge gone, every
 * wider bar keeping both.
 */
test("a narrow bar drops the percentage rather than the project name", async () => {
  const css = withoutComments(await read()).replaceAll("\r\n", "\n");

  // The bar has to be its own container: what is too narrow is the bar, not the viewport,
  // and the same viewport holds bars of every width.
  const bar = allRules(css, "assignment").filter(({ selector }) => selector === ".assignment");
  const containerTypes = bar.flatMap(({ body }) => [
    ...declarations(body, "container-type"),
    ...declarations(body, "container"),
  ]);
  assert.ok(
    containerTypes.some((value) => /inline-size/u.test(value)),
    "`.assignment` must be an inline-size container, or the query below has nothing to measure",
  );

  const query = css.match(/@container\s*\(max-width:\s*(\d+)px\)\s*\{([\s\S]*?)\n\}/u);
  assert.ok(query, "expected a @container block for the narrow bar");
  assert.equal(query[1], "100", "the threshold is measured: 92px still leaves the name 40px with the badge");
  assert.match(query[2], /\.assignment small\s*\{[^}]*display:\s*none/u,
    "the badge is what goes; the name is the only thing that identifies the bar");
  // And not the name — the failure this replaces was the name being the one that vanished.
  assert.doesNotMatch(query[2], /\.assignment span\s*\{[^}]*display:\s*none/u,
    "dropping the name would be the bug this rule exists to fix");
});

/**
 * A row is as tall as what is in it.
 *
 * `.schedule-row` had `min-height: 104px` — 36px of bar twice, a 4px gap and 14px of padding
 * top and bottom, which is a row with two assignments. Measured at 1425px, every row was
 * 104-105px whether it held one bar or two, and a single bar *stretched* to fill the space:
 * 36px of assignment drawn 75px tall, one day's work looking like three days'.
 *
 * With the floor gone, `align-content: start` to stop the stretch, and 10px of padding
 * instead of 14: rows 78 / 97px at 1425px against 104 / 105, page 1430 → 1286, seven of nine
 * rows on screen instead of six. At 375px, 78 / 113 against 120 / 121, page 2426 → 2199. Bars
 * hold their tap size at both widths — 36px and 44px — which is what stops the two-bar rows
 * shrinking further, and is #190's question rather than this one's.
 *
 * 8px of padding was measured too: 4px a row against a legible gutter, and the gutter won.
 * Shortening the person cell's wrapped subtitle would have been the biggest single win
 * (72.6 → 56.4px) and is not taken here: it drops the department from the row (#192).
 */
test("a schedule row takes its height from its content", async () => {
  const css = withoutComments(await read()).replaceAll("\r\n", "\n");

  // 78px is one row of content — the person cell's avatar beside two lines of name, plus the
  // row's 10px of padding — so it is a floor for a row with nothing in its week, not padding
  // for one with something. 104px and 120px were two assignments' worth, desktop and narrow.
  const floors = allRules(css, "schedule-row")
    .flatMap(({ selector, body }) => declarations(body, "min-height").map((value) => ({ selector, value })))
    .filter(({ value }) => !/^\d+(?:\.\d+)?px$/u.test(value) || Number.parseFloat(value) > 78);
  assert.deepEqual(floors.map(({ selector, value }) => `${selector} → ${value}`), [],
    "a floor above one row of content pads every row that holds less than two assignments (#192)");

  // The stretch is the other half. Without this the single bar in a row fills the cell.
  const cells = allRules(css, "week-cell");
  const alignments = cells.flatMap(({ body }) => declarations(body, "align-content"));
  assert.ok(alignments.includes("start"),
    "`.week-cell` needs `align-content: start`, or one assignment is drawn as tall as the row (#192)");
});
