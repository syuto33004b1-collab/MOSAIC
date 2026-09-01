import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * #142: the member table is wider than its wrapper at every width — 56px over at a
 * 1440px window, 130px at 1360, 393px at 620, 623px at 375 — and while it is scrolled the
 * name column and the actions column slid away together, so the buttons on screen
 * belonged to a row you could no longer read. Both ends are sticky now.
 *
 * ## What this file checks, and why these three things
 *
 * Each is something that would silently undo the fix and is not visible from
 * reading the rules in isolation.
 *
 * 1. **The edges.** A sticky cell with no `left`/`right` is `auto` and never sticks.
 *    Both halves of a column — its `<th>` and its `<td>` — have to name the same
 *    edge with the same value, or the header and the body part company when scrolled.
 * 2. **Winning the cascade for the background.** A sticky cell needs an opaque one,
 *    and `.member-table th` takes `background: var(--canvas)` in the theme layer. If
 *    the sticky rule loses to it the cell goes transparent and the scrolling content
 *    shows through. #146 lost #136's floor to the same class of mistake.
 * 3. **The row's hover tint.** Once the cells have their own opaque background, the
 *    `tr:hover` tint no longer reaches them — they stay pale while the rest of the
 *    row lights up. The board's `.schedule-row:hover .person-cell` exists for the
 *    same reason.
 *
 * ## What it cannot do
 *
 * A text scan, not a cascade. It weighs specificity and `!important` for the one
 * property where the contest matters (the background, below) against a named pair of
 * broader selectors, and nothing else: a new selector that also matches these cells
 * would go unnoticed, and it would attribute a nested block to its parent's selector
 * if this file ever adopts CSS nesting. It also cannot tell whether anything is
 * actually readable while scrolled, or which column a `:nth-child` reaches — the
 * markup side of that is pinned in `src/App.test.tsx`. Readability was measured in
 * the browser and is in the PR — at window widths
 * 1440, 1360, 620 and 375 (CSS viewports 1425, 1345, 605, 375; the difference is the
 * scrollbar, and the pixel figures above are against the CSS viewport), scrolled to the
 * far end, with the header and body sticky cells confirmed to share a left edge to
 * within 0.5px.
 */

const read = async () => (await readFile(path.join(root, "src", "styles.css"), "utf8")).replaceAll("\r\n", "\n");
const withoutComments = (css) => css.replace(/\/\*[\s\S]*?\*\//gu, "");

/**
 * Every rule in the file as `{ selectors, body, index, at }`, in source order, `at`
 * being the at-rule conditions it sits under. The 620px release below depends on
 * telling a rule inside a media block from one outside it.
 *
 * The text between one rule and the next holds the `}` of every block that closed in
 * between, and those have to be consumed: a first attempt did not, so the head of the
 * first rule after an `@media` block read as 「} .selector」 and the rule was silently
 * skipped. A rule unsticking a column immediately after the 620px block would have
 * broken the screen while every test here passed. The evaluator on this change caught
 * it; `parseKnownShapes` below is the regression.
 *
 * Not a CSS parser. postcss is present in `node_modules` as a Vite dependency, but it
 * is not a dependency of this repo, and the other contract tests here are deliberately
 * hand-rolled scans with stated limits. This one's limits: it assumes a rule body
 * holds no `}` (true — no CSS strings in this file contain one), and it would need
 * revisiting for CSS nesting.
 */
function rules(css) {
  const out = [];
  const atStack = [];
  let index = 0;
  while (index < css.length) {
    const brace = css.indexOf("{", index);
    if (brace < 0) break;
    const between = css.slice(index, brace);
    // One pop per block that closed since the last rule. Rule-closing braces never
    // appear here — those are consumed below — so every `}` is a block's.
    for (const character of between) if (character === "}") atStack.pop();
    const head = between.replaceAll("}", "").trim();
    if (head.startsWith("@")) {
      atStack.push(head);
      index = brace + 1;
      continue;
    }
    const close = css.indexOf("}", brace);
    if (close < 0) break;
    out.push({
      selectors: head.split(",").map((one) => one.trim().replace(/\s+/gu, " ")).filter(Boolean),
      body: css.slice(brace + 1, close),
      index: brace,
      at: [...atStack],
    });
    index = close + 1;
  }
  return out;
}

/** The last declaration of `property` in a body, which is the one that wins there. */
function declaration(body, property) {
  const found = [...body.matchAll(new RegExp(`(?:^|;)\\s*${property}\\s*:\\s*([^;]+)`, "gu"))];
  return found.length > 0 ? found.at(-1)[1].trim() : null;
}

/** Rules whose selector list contains exactly this selector. */
const matching = (all, selector) => all.filter((rule) => rule.selectors.includes(selector));

const NAME_CELLS = [".member-table th.col-name", ".member-table tbody td:nth-child(2)"];
const ACTION_CELLS = [".member-table th.col-actions", ".member-table td.member-row-actions"];

test("both ends of the table stick, and each half of a column names the same edge", async () => {
  const all = rules(withoutComments(await read()));
  for (const [edge, cells] of [["left", NAME_CELLS], ["right", ACTION_CELLS]]) {
    const offsets = new Set();
    for (const selector of cells) {
      const own = matching(all, selector).filter((rule) => rule.at.length === 0);
      assert.ok(own.length > 0, `no top-level rule for ${selector} — did the markup change?`);
      const position = own.map((rule) => declaration(rule.body, "position")).filter(Boolean).at(-1);
      assert.equal(position, "sticky", `${selector} must be position: sticky, found ${position}`);
      const offset = own.map((rule) => declaration(rule.body, edge)).filter(Boolean).at(-1);
      assert.ok(offset, `${selector} is sticky with no ${edge} offset, so it never sticks`);
      offsets.add(offset);
    }
    // One value across the header and the body: different offsets would let the
    // header column and its cells come to rest in different places.
    assert.equal(offsets.size, 1, `the ${edge} column's halves rest at different offsets: ${[...offsets].join(" vs ")}`);
    assert.equal([...offsets][0], "0", `the ${edge} column should pin to the wrapper's own edge, found ${[...offsets][0]}`);
  }
});

/**
 * The name column sticks at every width; the actions column lets go below 620px.
 * Measured windows between the two sticky edges: 638px at a CSS viewport of 1345,
 * 355px at 605, and 125px at 375 — at which point the columns in between cannot be
 * read at all.
 * 「which row is this」 is needed at every width, so that half stays.
 */
test("the actions column lets go on narrow screens and the name column does not", async () => {
  const all = rules(withoutComments(await read()));
  const narrow = (rule) => rule.at.some((condition) => /max-width:\s*620px/u.test(condition));

  for (const selector of ACTION_CELLS) {
    const released = matching(all, selector).filter((rule) => narrow(rule) && declaration(rule.body, "position") === "static");
    assert.equal(released.length, 1,
      `${selector} should be released in exactly one max-width: 620px block, found ${released.length}`);
    // The shadow is the sticky edge's only cue; left behind it draws a rule down
    // the middle of an ordinary column.
    assert.equal(declaration(released[0].body, "box-shadow"), "none",
      `${selector} keeps its edge shadow while no longer sticky`);
  }

  for (const selector of NAME_CELLS) {
    const released = matching(all, selector).filter((rule) => /static|relative/u.test(declaration(rule.body, "position") ?? ""));
    assert.deepEqual(released.map((rule) => rule.at.join(" ")), [],
      `${selector} is unstuck somewhere — the row's identity is needed at every width (#142)`);
  }
});

/**
 * The one that is invisible from the rules themselves. `.member-table th` takes its
 * background in the theme layer near the end of the file; a sticky cell's own
 * background has to be declared after that or it loses on source order and the
 * scrolling content shows through the header.
 */
/**
 * Specificity as (ids, classes-and-friends, elements), which is all this file needs:
 * no selector here uses an id or `:where()`, and `!important` is checked separately.
 */
function specificity(selector) {
  const classes = (selector.match(/\.[\w-]+|\[[^\]]+\]|:(?!:)[\w-]+(?:\([^)]*\))?/gu) ?? []).length;
  const elements = (selector.match(/(?:^|[\s>+~])(?:[a-z][\w-]*)/giu) ?? []).length;
  return [(selector.match(/#[\w-]+/gu) ?? []).length, classes, elements];
}

const beats = (a, b) => {
  for (let i = 0; i < 3; i += 1) if (a[i] !== b[i]) return a[i] > b[i];
  return false;
};

/**
 * The broader table rules a sticky cell has to out-rank. `.member-table th` takes
 * `background: var(--canvas)` in the theme layer; nothing sets `.member-table td`
 * today, but it is the obvious place for someone to put one.
 *
 * A first version of this test asserted source position instead — sticky background
 * after the theme layer's — and the evaluator pointed out the premise was wrong:
 * `.member-table th.col-name` is (0,2,1) against (0,1,1), so it wins wherever it
 * sits. Pinning the position would have failed a harmless tidy-up. Specificity first,
 * order only as the tie-break, which is the cascade's own rule.
 *
 * The limit: only these two competitors are considered. A new selector that also
 * matches these cells would not be noticed here.
 */
const BROADER = [".member-table th", ".member-table td"];

test("the sticky cells paint an opaque background that out-ranks the table's own", async () => {
  const all = rules(withoutComments(await read()));

  for (const selector of [...NAME_CELLS, ...ACTION_CELLS]) {
    const painted = matching(all, selector).filter((rule) => declaration(rule.body, "background"));
    assert.ok(painted.length > 0,
      `${selector} is sticky with no background of its own — the scrolling content shows through it (#142)`);
    const last = painted.at(-1);

    // A token or a literal is fine; transparent is not, whatever the spelling.
    const value = declaration(last.body, "background");
    assert.doesNotMatch(value, /transparent|rgba\([^)]*,\s*0\s*\)|none/u,
      `${selector} declares 「${value}」, which is not opaque`);

    const own = specificity(selector);
    for (const broad of BROADER) {
      // Only cells the broader selector actually reaches: `.member-table th` cannot
      // affect a `td`, and vice versa.
      const kind = broad.endsWith(" th") ? "th" : "td";
      if (!selector.includes(kind)) continue;
      for (const rival of matching(all, broad).filter((rule) => declaration(rule.body, "background"))) {
        const wins = beats(own, specificity(broad)) || last.index > rival.index;
        assert.ok(wins,
          `${selector} (${own.join(",")}) loses its background to ${broad} (${specificity(broad).join(",")}) `
          + `declared later at ${rival.index} — the sticky cell goes transparent and the scrolling content `
          + "shows through it (#142; #146 lost #136's floor to this same trap)");
        assert.doesNotMatch(declaration(rival.body, "background"), /!important/u,
          `${broad} paints its background with !important, which no specificity can beat`);
      }
    }
  }
});

/**
 * The one that only a hit test found. `.load-ring strong` carries `z-index: 1`, and
 * z-index applies to grid items even when they are `position: static` — so without a
 * stacking context on the ring it climbed into the table's, tied with the sticky
 * column at 1, and won on tree order. Measured at a 605px CSS viewport, scrolled to the far end: the
 * percentage was painted across the member's name, while `elementFromPoint` on the
 * ring's centre returned the ring's `<strong>` rather than the sticky cell.
 *
 * Raising the column's z-index would have been whack-a-mole. Containing the ring's
 * own layering is the root cause, and the ring only ever needs its text above its own
 * `::before`.
 */
test("the load ring keeps its internal z-index to itself", async () => {
  const css = withoutComments(await read());
  const all = rules(css);

  const ring = matching(all, ".load-ring").filter((rule) => declaration(rule.body, "isolation")).at(-1);
  assert.ok(ring, ".load-ring must isolate: its `strong` is a grid item with z-index: 1 (#142)");
  assert.equal(declaration(ring.body, "isolation"), "isolate");

  // And the reason has to still be there — an isolation with nothing to contain is
  // a leftover, and a `strong` that stops being a grid item needs a fresh look.
  const text = matching(all, ".load-ring strong").filter((rule) => declaration(rule.body, "z-index")).at(-1);
  assert.ok(text, ".load-ring strong no longer sets a z-index — drop the isolation or re-measure");
  const display = matching(all, ".load-ring").map((rule) => declaration(rule.body, "display")).filter(Boolean).at(-1);
  assert.equal(display, "grid",
    "the z-index above only escapes because `strong` is a grid item; if the ring stops being a grid, re-measure");
});

test("the row's hover tint reaches the sticky cells", async () => {
  const css = withoutComments(await read());
  const all = rules(css);
  const rowHover = matching(all, ".member-table tbody tr:hover").filter((rule) => declaration(rule.body, "background")).at(-1);
  assert.ok(rowHover, "expected a .member-table tbody tr:hover background");
  const tint = declaration(rowHover.body, "background");

  // The sticky cells are opaque, so the row's own tint cannot show through them.
  for (const selector of [".member-table tbody tr:hover td:nth-child(2)", ".member-table tbody tr:hover td.member-row-actions"]) {
    const rule = matching(all, selector).at(-1);
    assert.ok(rule, `nothing tints ${selector} on hover — it stays pale while the row lights up (#142)`);
    assert.equal(declaration(rule.body, "background"), tint,
      `${selector} hovers to a different colour than its row`);
    assert.ok(rule.index > (matching(all, selector.replace(" tbody tr:hover", " tbody").replace(":hover", "")).at(-1)?.index ?? -1),
      `${selector} is declared before the cell's resting background, so the tint loses on source order`);
  }
});

/**
 * The parser's own regression. Every shape below is one this stylesheet actually
 * contains — a one-line media block holding several rules, nested at-rules,
 * `@keyframes` with percentage selectors — plus the one that broke: an ordinary rule
 * immediately after a block closes.
 *
 * Written as literals rather than read from the stylesheet, so this keeps failing if
 * the file stops containing a shape but the parser still mishandles it.
 */
test("parseKnownShapes: the scan reads what this stylesheet actually contains", () => {
  const seen = (css) => rules(css).map((rule) => `${rule.at.join(" ")}|${rule.selectors.join(",")}`);

  // The bug the evaluator found: `.after` came out as 「} .after」 and vanished.
  assert.deepEqual(
    seen("@media (max-width: 620px) {\n  .inside { color: red; }\n}\n.after { color: blue; }\n"),
    ["@media (max-width: 620px)|.inside", "|.after"],
  );

  // Two blocks in a row, so two pops between the last inner rule and the next one.
  assert.deepEqual(
    seen("@media (a) {\n .one { x: 1 }\n}\n@media (b) {\n .two { x: 2 }\n}\n.three { x: 3 }\n"),
    ["@media (a)|.one", "@media (b)|.two", "|.three"],
  );

  // Nested, which pops twice at once.
  assert.deepEqual(
    seen("@supports (a: b) {\n @media (c) {\n  .deep { x: 1 }\n }\n}\n.flat { x: 2 }\n"),
    ["@supports (a: b) @media (c)|.deep", "|.flat"],
  );

  // The one-line form this file uses at the top, several rules to a block.
  assert.deepEqual(
    seen("@media (max-width: 820px) { .a { x: 1 }.b { x: 2 } }\n.c { x: 3 }\n"),
    ["@media (max-width: 820px)|.a", "@media (max-width: 820px)|.b", "|.c"],
  );

  // Keyframe stops read as rules under the at-rule. Harmless — no selector here
  // matches one — but the pops still have to line up for what follows.
  assert.deepEqual(
    seen("@keyframes rise-in { from { opacity: 0 } to { opacity: 1 } }\n.next { x: 1 }\n"),
    ["@keyframes rise-in|from", "@keyframes rise-in|to", "|.next"],
  );

  // A grouped selector list survives as separate entries, which `matching()` needs.
  assert.deepEqual(seen(".x,\n.y { color: red }\n"), ["|.x,.y"]);
});

/**
 * And the same check against the real file: the rules this suite looks for have to be
 * found at all. A parser that silently skips them would make every assertion above
 * vacuous, since `matching()` returning nothing is only caught where a test asserts
 * a non-empty result.
 */
test("the scan finds every rule this suite asserts on, in the real stylesheet", async () => {
  const all = rules(withoutComments(await read()));
  for (const selector of [...NAME_CELLS, ...ACTION_CELLS, ".member-table th", ".member-table tbody tr:hover", ".load-ring"]) {
    assert.ok(matching(all, selector).length > 0, `the scan found no rule for ${selector}`);
  }
  // The first rule after the 620px release block, whichever it is, has to be seen as
  // top-level — that is the position the parser used to drop.
  const release = all.findIndex((rule) => rule.selectors.includes(".member-table td.member-row-actions")
    && rule.at.some((condition) => /max-width:\s*620px/u.test(condition)));
  assert.ok(release >= 0, "expected the 620px release rule");
  const next = all.slice(release + 1).find((rule) => rule.at.length === 0);
  assert.ok(next, "no top-level rule found after the 620px block — the scan is dropping them again");
  assert.ok(next.selectors.every((selector) => !selector.includes("}")),
    `a closing brace leaked into a selector: ${next.selectors.join(", ")}`);
});
