import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * #163: #123 gave a member who shares a name a tag that tells them apart — 「（大阪）」 or
 * 「（#4f2a）」 — and put it at the end of the label. The member list's name cell ellipsises
 * (`white-space: nowrap`, `text-overflow: ellipsis`, by #87's decision that the name may
 * be cut because the row opens a panel showing it whole), and an ellipsis eats the end.
 * So the one part of the label that exists only to distinguish is the first part to go.
 *
 * Measured at 375px, where the cell is 122px, with canvas at the cell's own font:
 *
 * | label                       | width   | fits |
 * | --------------------------- | ------- | ---- |
 * | 佐伯 優斗（#4f2a）           | 104.7px | yes  |
 * | 中村 美咲（#nakamura）       | 134.3px | no   |
 * | 高橋 直樹（#takahashi）      | 133.7px | no   |
 *
 * A long slug id is a demo-seed shape, but a long *name* is not: nothing bounds a
 * member's name, and 「東海林 真理子さくら（#f8c6）」 measured 165px against the same
 * 122px cell. Two namesakes read alike again at that point.
 *
 * ## What the fix is
 *
 * Two boxes instead of one. The name shrinks and ellipsises; the tag does not shrink.
 * Measured after, at 375 and 1425 with two 「東海林 真理子さくら」:
 *
 * | | name box | name ellipsised | tag box | tag inside the cell | row |
 * | -------- | -------- | --------------- | ------- | ------------------- | ------ |
 * | 375px    | 68.5px   | yes             | 53.5px  | yes                 | 67.2px |
 * | 1425px   | 68.5px   | yes             | 53.5px  | yes                 | 67.2px |
 *
 * The two rows read 「東海林 真…（#f8c6）」 and 「東海林 真…（#6444）」 — different, which is
 * the whole point. Rows did not grow (67.2px before and after), and members nobody shares
 * a name with render one box and are untouched.
 *
 * ## Only this cell
 *
 * Every other place a label appears was measured at 375 with the same two members and
 * clips nothing: the board's person cell wraps (`white-space: normal`, `overflow:
 * visible`, 2 lines, `scrollWidth === clientWidth`), and the proposal picker's heading is
 * 245px wide and wraps. The stylesheet's other `text-overflow: ellipsis` rules belong to
 * the assignment bars (project names), the custom-value cells, the filter selects and the
 * workspace-mode line — none of them a member label.
 *
 * ## What this cannot do
 *
 * It reads declarations. The widths above are browser measurements, in the PR. jsdom has
 * no layout, so it cannot see an ellipsis.
 */

const readCss = async () => (await readFile(path.join(root, "src", "styles.css"), "utf8")).replaceAll("\r\n", "\n");
const readTsx = () => readFile(path.join(root, "src", "expanded-views.tsx"), "utf8");
const readAppTsx = () => readFile(path.join(root, "src", "App.tsx"), "utf8");
const withoutComments = (source) => source.replace(/\/\*[\s\S]*?\*\//gu, "");

/** The last declaration of `property` in the rule for exactly `selector`. */
function declaration(css, selector, property) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const rules = [...css.matchAll(new RegExp(`(?:^|\\})\\s*${escaped}\\s*\\{([^}]*)\\}`, "gu"))];
  for (const rule of rules.reverse()) {
    const found = [...rule[1].matchAll(new RegExp(`(?:^|;)\\s*${property}\\s*:\\s*([^;]+)`, "gu"))];
    if (found.length > 0) return found.at(-1)[1].trim();
  }
  return null;
}

test("the name shrinks and the tag does not", async () => {
  const css = withoutComments(await readCss());

  // The cell became a flex line so the two parts can be sized separately.
  assert.equal(declaration(css, ".member-name-cell strong", "display"), "flex",
    "the name cell holds two boxes now, and only a flex line lets one of them shrink alone (#163)");

  // The ellipsis moved onto the name. Left on the strong it would apply to a flex
  // container, which does not ellipsise its items, and nothing would be cut at all.
  for (const [property, value] of [["overflow", "hidden"], ["text-overflow", "ellipsis"], ["white-space", "nowrap"]]) {
    assert.equal(declaration(css, ".member-name-cell strong .row-name-main", property), value,
      `.row-name-main needs ${property}: ${value} — the truncation lives on the name now (#163)`);
  }
  assert.equal(declaration(css, ".member-name-cell strong .row-name-main", "min-width"), "0",
    "a flex item defaults to min-width: auto and refuses to shrink below its text, so it would "
    + "push the tag out of the cell instead of ellipsising (#163)");

  // And the tag holds its ground.
  assert.equal(declaration(css, ".member-name-cell strong .row-name-tag", "flex"), "none",
    "the tag must not shrink: it is the only part of the label that distinguishes, and shrinking "
    + "it is the defect #163 is about");
  assert.equal(declaration(css, ".member-name-cell strong .row-name-tag", "white-space"), "nowrap",
    "「（#4f2a）」 broken across lines would grow the row for no gain (#163)");

  // The project name cell keeps the plain single-box truncation: a project has no tag.
  assert.equal(declaration(css, ".project-name-cell strong", "text-overflow"), "ellipsis",
    "the project name still truncates as one box; splitting the rule must not have dropped it");
  assert.equal(declaration(css, ".project-name-cell strong", "display"), null,
    "the project name is not a flex line — it has one part");
});

test("the member row renders the name and the tag as separate boxes", async () => {
  const tsx = await readTsx();
  const cell = /<strong><span className="row-name-main">\{label\.name\}<\/span>\{label\.tag && <span className="row-name-tag">\{label\.tag\}<\/span>\}<\/strong>/u;
  assert.match(tsx, cell,
    "the member row has to render the two parts as two elements, or the CSS above has nothing to "
    + "size separately (#163)");
  // One name box and one tag box, in the one cell that truncates. Other places print the
  // joined label on purpose — the proposal picker's heading wraps rather than clipping,
  // measured 245px at 375px — so this counts rather than forbidding the joined form.
  const boxes = (name) => [...tsx.matchAll(new RegExp(`className="${name}"`, "gu"))].length;
  assert.equal(boxes("row-name-main"), 1, "the name box belongs to the member list's cell alone");
  assert.equal(boxes("row-name-tag"), 1, "the tag box belongs to the member list's cell alone");
});

/**
 * #282: the same decision, one screen later. #262 put the label on the assignment bar —
 * on the projects axis the row is the project, so the bar is the only thing that says who
 * — and the bar ellipsises exactly as the member cell did.
 *
 * Measured on a one-day bar at a 1182px viewport, with canvas at the bar's own font
 * (bold 12px):
 *
 * | | width |
 * | -------------------------- | ----- |
 * | bar                        | 75px  |
 * | inside its padding         | 52px  |
 * | 「佐伯 優斗（#e04a）」        | 107px |
 * | 「佐伯 優斗」                | 51px  |
 * | 「（#e04a）」                | 56px  |
 * | 「（東京）」                 | 48px  |
 *
 * So the cut landed inside the name and took the tag with it: both namesakes read
 * 「佐伯 …」, which is the state #262 was supposed to have ended. Splitting the box makes
 * the surviving part the one that distinguishes: a place tag fits whole, and an id tag is
 * clipped rather than dropped.
 *
 * ## What it does not do
 *
 * Guarantee it. The bar clips at its right edge and `idTail` picks the shortest unique
 * *suffix*, so the clip runs opposite to where the uniqueness lives — measured at 375px,
 * 「（#ad3e）」 loses 17px and reads 「（#ad3」. Two ids differing only in their last
 * character would still read alike. 39px does not hold a name and a bounded identifier;
 * the guarantee is in the accessible name, the `title` and the drawer. #282 is where the
 * remaining decision is written down.
 *
 * So this test pins the arrangement, not the outcome: it cannot see an ellipsis, and it
 * would pass for a bar too narrow to distinguish anything. The string is untouched, so
 * the visible text stays a fragment of the accessible name. jsdom has no layout; the
 * widths above are browser measurements, in the PR.
 */
test("the bar's tag survives the ellipsis too", async () => {
  const css = withoutComments(await readCss());

  assert.equal(declaration(css, ".assignment .assignment-label", "display"), "flex",
    "the bar holds two boxes now, and only a flex line lets one of them shrink alone (#282)");
  assert.equal(declaration(css, ".assignment .assignment-label", "overflow"), "hidden",
    "the bar's own box is what clips a tag too wide to fit; without it the tag would spill "
    + "over the next day's column (#282)");

  for (const [property, value] of [["overflow", "hidden"], ["text-overflow", "ellipsis"], ["white-space", "nowrap"]]) {
    assert.equal(declaration(css, ".assignment .assignment-name", property), value,
      `.assignment-name needs ${property}: ${value} — the truncation lives on the name now (#282)`);
  }
  assert.equal(declaration(css, ".assignment .assignment-name", "min-width"), "0",
    "a flex item defaults to min-width: auto and refuses to shrink below its text, so it would "
    + "push the tag out of the bar instead of ellipsising (#282)");

  assert.equal(declaration(css, ".assignment .assignment-tag", "flex"), "none",
    "the tag must not shrink: it is the only part of the label that distinguishes (#282)");
  assert.equal(declaration(css, ".assignment .assignment-tag", "white-space"), "nowrap",
    "a tag broken across lines would grow the bar past its row (#282)");

  // #188 decided a narrow bar drops the percentage and keeps the name. That rule still
  // has to name `small` alone — hiding the label would undo this fix and that one.
  const container = css.match(/@container[^{]*\{([\s\S]*?)\n\}/u);
  assert.ok(container, "the narrow-bar container query should still be there (#188)");
  assert.doesNotMatch(container[1], /\.assignment (?:span|\.assignment-label|\.assignment-tag)\s*\{[^}]*display:\s*none/u,
    "the narrow-bar rule may hide the percentage, never the label or its tag (#188, #282)");
});

test("the bar renders the name and the tag as separate boxes", async () => {
  const app = await readAppTsx();
  assert.match(app, /<span className="assignment-label"><span className="assignment-name">\{assignment\.nameMain\}<\/span>\{assignment\.tag && <span className="assignment-tag">\{assignment\.tag\}<\/span>\}<\/span>/u,
    "the bar has to render the two parts as two elements, or the CSS above has nothing to "
    + "size separately (#282)");
  // The whole label still reaches the accessible name and the title, so the visible text
  // stays a prefix of what a reader is told.
  assert.match(app, /aria-label=\{assignment\.name \+ "のアサイン詳細（"/u,
    "the accessible name reads the joined label, not the split halves (#262, #263)");
  assert.match(app, /title=\{assignment\.name \+ " · " \+ assignment\.allocation \+ "%"\}/u,
    "the title reads the joined label too (#251)");
});
