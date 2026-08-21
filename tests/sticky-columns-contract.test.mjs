import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * #142: the member table is wider than its wrapper at every width — 56px over at
 * 1440, 130px at 1360, 393px at 620, 623px at 375 — and while it is scrolled the
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
 * 2. **Source order against the theme layer.** A sticky cell needs an opaque
 *    background, and `.member-table th` takes `background: var(--canvas)` in the
 *    theme layer near the end of the file. A background declared before that point
 *    loses on source order and the scrolling content shows through. #146 hit this
 *    exact trap with `min-width` and undid #136's floor until it was measured.
 * 3. **The row's hover tint.** Once the cells have their own opaque background, the
 *    `tr:hover` tint no longer reaches them — they stay pale while the rest of the
 *    row lights up. The board's `.schedule-row:hover .person-cell` exists for the
 *    same reason.
 *
 * ## What it cannot do
 *
 * A flat text scan, not a cascade: it does not weigh specificity or `!important`,
 * and it would attribute a nested block to its parent's selector if this file ever
 * adopts CSS nesting. It also cannot tell whether anything is actually readable
 * while scrolled. That was measured in the browser and is in the PR — at 1440,
 * 1360, 620 and 375, scrolled to the far end, with the header and body sticky cells
 * confirmed to share a left edge to within 0.5px.
 */

const read = async () => (await readFile(path.join(root, "src", "styles.css"), "utf8")).replaceAll("\r\n", "\n");
const withoutComments = (css) => css.replace(/\/\*[\s\S]*?\*\//gu, "");

/**
 * Every rule in the file as `{ selectors, body, index }`, in source order, with the
 * `@media` condition it sits under. Media blocks are opened and closed by tracking
 * brace depth rather than by a regex, so a rule inside one is not mistaken for a
 * top-level rule (the 620px override below depends on telling those apart).
 */
function rules(css) {
  const out = [];
  let index = 0;
  const atStack = [];
  while (index < css.length) {
    const brace = css.indexOf("{", index);
    if (brace < 0) break;
    const head = css.slice(index, brace).trim();
    if (head.startsWith("@")) {
      atStack.push({ condition: head, close: matchingClose(css, brace) });
      index = brace + 1;
      continue;
    }
    const close = css.indexOf("}", brace);
    if (close < 0) break;
    out.push({
      selectors: head.split(",").map((one) => one.trim().replace(/\s+/gu, " ")).filter(Boolean),
      body: css.slice(brace + 1, close),
      index: brace,
      at: atStack.filter((entry) => entry.close > brace).map((entry) => entry.condition),
    });
    index = close + 1;
  }
  return out;
}

function matchingClose(css, brace) {
  let depth = 1;
  let index = brace + 1;
  while (depth > 0 && index < css.length) {
    if (css[index] === "{") depth += 1;
    else if (css[index] === "}") depth -= 1;
    index += 1;
  }
  return index - 1;
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
 * Measured windows between the two sticky edges: 638px at 1360, 355px at 620, and
 * 125px at 375 — at which point the columns in between cannot be read at all.
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
test("the sticky cells' backgrounds are declared after the theme layer takes the same property", async () => {
  const css = withoutComments(await read());
  const all = rules(css);

  const themeHeader = matching(all, ".member-table th").filter((rule) => declaration(rule.body, "background")).at(-1);
  assert.ok(themeHeader, "expected a .member-table th rule that sets a background");

  for (const selector of [...NAME_CELLS, ...ACTION_CELLS]) {
    const painted = matching(all, selector).filter((rule) => declaration(rule.body, "background"));
    assert.ok(painted.length > 0,
      `${selector} is sticky with no background of its own — the scrolling content shows through it`);
    const last = painted.at(-1);
    assert.ok(last.index > themeHeader.index,
      `${selector} paints its background at ${last.index}, before the .member-table th rule at `
      + `${themeHeader.index} — it loses on source order and the cell goes transparent (#142, and #146 `
      + "for the time this same trap ate #136's floor)");
    // A token or a literal is fine; transparent is not, whatever spelling.
    const value = declaration(last.body, "background");
    assert.doesNotMatch(value, /transparent|rgba\([^)]*,\s*0\s*\)|none/u,
      `${selector} declares 「${value}」, which is not opaque`);
  }
});

/**
 * The one that only a hit test found. `.load-ring strong` carries `z-index: 1`, and
 * z-index applies to grid items even when they are `position: static` — so without a
 * stacking context on the ring it climbed into the table's, tied with the sticky
 * column at 1, and won on tree order. Measured at 620px scrolled to the far end: the
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
