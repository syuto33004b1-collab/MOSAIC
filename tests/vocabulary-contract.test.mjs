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
 * It reads text, not syntax. `stripComments` is a regex, so two holes stay — both
 * pinned by the last test in this file rather than assumed away:
 *
 * - a display string that itself opens a block comment is treated as a comment,
 *   so a retired word inside such a string would slip through
 * - a comment trailing code on the same line is not stripped, so a retired word
 *   mentioned only there would fail this test
 *
 * Neither shape exists in the sources today, and removing them would take a
 * TypeScript parse. The rendered tests in App.test.tsx are the primary guard;
 * this is the backstop for the strings they cannot reach. It also says nothing
 * about a *new* word being coined for a quantity that already has one — only
 * that these eight are gone.
 *
 * The AI chat's tool file is in scope now. Its impact preview said 「上限100%を超えます」
 * while every screen said 稼働上限, and #120 settled it — so the file joins the sweep and
 * a retired word cannot arrive there either. What renders it is still out of reach for
 * this repo's UI verification (a signed-in shared-mode session), which is why the word
 * itself is pinned by `tests/workspace-tools.test.mjs` rather than by a screenshot.
 */

/**
 * Allowances are per file and exact. The reports screen keeps 「キャパシティ予測」:
 * it names the screen's subject, not a figure, so it cannot make a number
 * ambiguous. Every other occurrence was a label sitting on a 稼働 value — the
 * member table's 「4週間のキャパシティ」 column and the drawer section of the same
 * name both showed `memberLoad()`.
 */
const ALLOWED = {
  "src/App.tsx": ['title: "キャパシティ予測"'],
  "src/expanded-views.tsx": [],
  // The chat's tools speak the same vocabulary to the same people (#120).
  "supabase/functions/chat/workspace-tools.mjs": [],
};

const SOURCES = Object.keys(ALLOWED);

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

const drop = (source, phrases) => phrases.reduce((text, phrase) => text.split(phrase).join(""), source);

test("the retired words for 稼働 and 空き are gone from the screens", async () => {
  for (const file of SOURCES) {
    const source = drop(stripComments(await readFile(path.join(root, file), "utf8")), ALLOWED[file]);
    for (const [word, replacement] of RETIRED) {
      assert.ok(
        !source.includes(word),
        `${file} still says 「${word}」 — use ${replacement} (#82). Comments are stripped before this check, so this is a string that reaches the screen.`,
      );
    }
  }
});

/**
 * Each allowance is an exact phrase, checked in the one file that may carry it,
 * and counted: a second 「キャパシティ」 cannot hide behind the allowance, and a
 * file with no allowance is held to the full list. Removing the phrase from the
 * source makes this test say so rather than leaving a dead allowance behind.
 */
test("each allowance is present exactly once, in the file that declares it", async () => {
  for (const file of SOURCES) {
    const source = stripComments(await readFile(path.join(root, file), "utf8"));
    for (const phrase of ALLOWED[file]) {
      assert.equal(source.split(phrase).length - 1, 1, `${file} should carry ${phrase} exactly once — drop or update the allowance`);
    }
    const excused = new Set(ALLOWED[file].flatMap((phrase) => RETIRED.map(([word]) => word).filter((word) => phrase.includes(word))));
    for (const [word] of RETIRED) {
      if (excused.has(word)) continue;
      assert.ok(!source.includes(word), `${file} declares no allowance for 「${word}」`);
    }
  }
});

/**
 * The two holes named in the doc comment above, pinned so that "we know about
 * this" cannot quietly become "we assumed it worked". The markers are assembled
 * at runtime so this file does not contain the shapes it describes.
 */
test("stripComments trades two known holes for being a regex", () => {
  const open = "/" + "*";
  const close = "*" + "/";
  const slashes = "/" + "/";

  assert.equal(stripComments(`const label = "${open} 余白 ${close}";`).includes("余白"), false,
    "a block-comment marker inside a display string hides the word — the false negative");

  assert.equal(stripComments(`const label = "稼働"; ${slashes} 余白 was the old word`).includes("余白"), true,
    "a comment trailing code on the same line is not stripped — the false positive");

  assert.equal(stripComments(`  ${slashes} 余白 was the old word\nconst label = "稼働";`).includes("余白"), false,
    "a comment on its own line is stripped, which is the shape the sources actually use");
});

/**
 * #146: 「今週」 sat on eleven figures and none of them measured this week. They
 * all measure whatever week the board is paged to — `viewWeekOffset` exists so the
 * member, project and proposal screens follow the board — and #139 widened the gap
 * by letting the board show a month, where these figures cover the month's *first*
 * week. Paging moved the number and left the word.
 *
 * The word is now reserved for a figure computed from `getWeekStart(0)`. That is
 * the reports screen, which takes no week from the board. Everywhere else names its
 * week through `weekLabel()`: 「8/17週の空き」.
 *
 * ## What this checks, and what it cannot
 *
 * Scoped by `export function` chunks — the same approximation
 * `filter-label-contract.test.mjs` uses, and it has the same limit: it cannot see
 * which `weekStart` a given line reads. What it can see is that the word is absent
 * from every component that takes the board's week, and present in the one that
 * does not. The rendered counterpart is in `src/App.test.tsx`, which walks the
 * screens and asserts the text; this covers the branches those tests do not enter.
 *
 * The reason for the exception is asserted too, rather than trusted: the excused
 * chunk has to read `getWeekStart(0)` and must not read the board's offset. An
 * exception that stops being true should fail here instead of quietly widening.
 */
const CURRENT_WEEK = "今週";
const MAY_SAY_CURRENT_WEEK = { "src/App.tsx": [], "src/expanded-views.tsx": ["ReportsView"] };

/** `export function Name(` → its body, up to the next top-level export. */
function exportedFunctions(source) {
  return source.split(/\nexport function /u).slice(1).map((chunk) => ({
    name: chunk.slice(0, chunk.search(/[(<\s]/u)),
    body: chunk,
  }));
}

test("「今週」 is only on a figure that measures this week", async () => {
  for (const file of SOURCES) {
    const source = stripComments(await readFile(path.join(root, file), "utf8"));
    // No entry means no exceptions, which is the stricter default and the right one for a
    // file joining the sweep — reading `undefined` here threw when the chat's tools did.
    const excused = MAY_SAY_CURRENT_WEEK[file] ?? [];

    // Anything outside an exported function — module constants, `pageMeta` — is
    // held to the rule unconditionally, since no chunk can excuse it.
    const chunks = exportedFunctions(source);
    const outside = chunks.length > 0 ? source.slice(0, source.indexOf("\nexport function ")) : source;
    assert.ok(!outside.includes(CURRENT_WEEK),
      `${file} says 「${CURRENT_WEEK}」 outside any component — name the week with weekLabel() (#146)`);

    for (const { name, body } of chunks) {
      if (excused.includes(name)) continue;
      assert.ok(!body.includes(CURRENT_WEEK),
        `${file} → ${name} says 「${CURRENT_WEEK}」. These screens follow the board's paging, so the `
        + "figure is not this week's; name the week with weekLabel() (#146)");
    }

    for (const name of excused) {
      const chunk = chunks.find((item) => item.name === name);
      assert.ok(chunk, `${file} no longer exports ${name} — drop the exception`);
      assert.ok(chunk.body.includes(CURRENT_WEEK),
        `${name} is excused but no longer says 「${CURRENT_WEEK}」 — drop the exception rather than leaving it`);
      // The reason for the exception, not just the exception. `getWeekStart(0)` is
      // what makes 「今週」 true; not being handed the board's week is what keeps it
      // true. Its own `getWeekStart(offset)` in the horizon chart counts weeks from
      // this one, so the offset alone says nothing — the call site does.
      assert.ok(chunk.body.includes("getWeekStart(0)"),
        `${name} may say 「${CURRENT_WEEK}」 only because it measures from getWeekStart(0)`);
      const mounted = (await readFile(path.join(root, "src", "App.tsx"), "utf8")).match(new RegExp(`<${name}[^>]*>`, "u"));
      assert.ok(mounted, `${name} is not mounted in App.tsx — drop the exception`);
      assert.ok(!/\bweekOffset=/u.test(mounted[0]),
        `${name} is now handed the board's week, so 「${CURRENT_WEEK}」 can be wrong there too (#146)`);
    }
  }
});
