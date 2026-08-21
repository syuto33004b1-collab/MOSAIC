import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * #82 settled one word per quantity: 稼働 for the allocation in use, 稼働上限 for
 * the registered ceiling, 稼働率 for their ratio, 空き for 稼働上限 − 稼働. The
 * words it retired had each been used for a quantity that already had a name, and
 * two of them named a condition the code does not apply — 「40%以上の空き」 for
 * `load <= capacity * .6`, and 「満員」 for a 稼働率 that fires at 61%.
 *
 * ## Why a source-text test and not only a rendered one
 *
 * App.test.tsx asserts the retired words are absent from the board, the member
 * list and the member drawer. That cannot reach every string: `pageMeta.board`'s
 * description is never rendered (the board shows its week range in that slot
 * instead), and the 稼働上限 0% and 解消予定 branches need states the DOM tests do
 * not set up. Reverting 「週全体の稼働」 to 「週全体の余白」 passed every rendered
 * test. This covers the strings, so a retired word cannot come back through a
 * branch nobody renders.
 *
 * ## What this cannot do
 *
 * It reads text, not meaning. It cannot tell whether a *new* word has been
 * introduced for a quantity that already has one — only that these eight are gone.
 * And it strips comments, so the prose above is exempt by construction.
 */

/**
 * Screens only. The AI chat's impact preview is built in
 * supabase/functions/chat/workspace-tools.mjs and still says 「上限100%を超えます」;
 * it renders only for a signed-in shared-mode session, which this repo's UI
 * verification cannot reach, so it is a separate issue rather than an
 * unverifiable line in this diff.
 */
const SOURCES = ["src/App.tsx", "src/expanded-views.tsx"];

/**
 * The reports screen keeps 「キャパシティ予測」: it names the screen's subject, not
 * a figure, so it cannot make a number ambiguous. Every other occurrence was a
 * label sitting on a 稼働 value — the member table's 「4週間のキャパシティ」 column
 * and the drawer section of the same name both showed `memberLoad()`.
 */
const ALLOWED = ['title: "キャパシティ予測"'];

const RETIRED = [
  ["余白", "稼働 or 空き, depending on which one the figure is"],
  ["余力", "the complement of 稼働率 is stated against 稼働上限, not renamed"],
  ["空き率", "稼働率 — the ordering and the count both use load/capacity"],
  ["満員", "「なし」 — the condition fires at 61%, not 100%"],
  ["キャパシティ", "稼働 for a load, 稼働上限 for a ceiling"],
  ["チーム稼働", "平均稼働率 — the pulse strip already calls this variable that"],
  ["稼働超過", "上限超過 — one name for load > 稼働上限"],
  ["登録上限", "稼働上限"],
];

const stripComments = (source) => source
  .replace(/\/\*[\s\S]*?\*\//gu, "")
  .replace(/^[ \t]*\/\/.*$/gmu, "");

const allowedFree = (source) => ALLOWED.reduce((text, phrase) => text.split(phrase).join(""), source);

test("the retired words for 稼働 and 空き are gone from the screens", async () => {
  for (const file of SOURCES) {
    const source = allowedFree(stripComments(await readFile(path.join(root, file), "utf8")));
    for (const [word, replacement] of RETIRED) {
      assert.ok(
        !source.includes(word),
        `${file} still says 「${word}」 — use ${replacement} (#82). Comments are stripped before this check, so this is a string that reaches the screen.`,
      );
    }
  }
});

/**
 * The allowance is spelled out as an exact phrase so that a second
 * 「キャパシティ」 cannot slip in under it, and so that removing the phrase from
 * the source makes this test say so rather than silently widening.
 */
test("the one allowed キャパシティ is the reports screen's own title", async () => {
  const source = await readFile(path.join(root, "src", "App.tsx"), "utf8");
  for (const phrase of ALLOWED) {
    assert.ok(source.includes(phrase), `${phrase} is no longer in src/App.tsx — drop it from ALLOWED`);
  }
  const occurrences = stripComments(source).split("キャパシティ").length - 1;
  assert.equal(occurrences, 1, "src/App.tsx should carry キャパシティ exactly once, in the reports title");
});
