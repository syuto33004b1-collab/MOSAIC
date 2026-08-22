import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * The proposal on paper (#179).
 *
 * #148 settled the question of sending a proposal outside the organisation with a file, and
 * wrote a CSV. #179 is the other half: a spreadsheet puts the candidate cards back into
 * columns, and a proposal is read as cards. The browser's print dialogue is also its PDF
 * writer, so the whole of the feature is `@media print` over the screen's own markup — which
 * is why these assertions are about a stylesheet.
 *
 * They exist because a print stylesheet cannot be measured the way the rest of this suite
 * measures things. There is no print rendering to interrogate here: no page boxes, no page
 * breaks, no `@page` margin. What was measured instead, in Chrome, was these rules put on
 * screen — every `@media print` condition rewritten to `all` over the real cascade, viewport
 * 688px, which is A4's 210mm less two 14mm margins:
 *
 * | | measured |
 * | ------------------------------- | ---------------------------------------------- |
 * | sidebar, topbar, toolbar, picker, per-card controls | all `checkVisibility` false |
 * | ribbon, cards, and the five fields | visible |
 * | card box | 688 x 267, three candidates and the header in 991px, page 1017 |
 * | document overflow at 688px | none |
 * | ticking off 勤務地 and 4週間の稼働率 | card 267 → 148px |
 * | ticking everything off | card 68px, the candidate's name alone |
 * | with background colours suppressed | nothing left the same colour as the paper |
 *
 * The last row is the one that changed the design. Chrome prints with 「Background graphics」
 * off unless the reader turns it on, and the ribbon that carries the subject, the dates and
 * whether names are shown is a dark block with near-white text: on paper, the header of the
 * handout was disappearing. It is redrawn as ink on white here rather than made to print its
 * background.
 *
 * Left to a person, and said out loud in #179: where the pages actually break, the `@page`
 * margin, and the browser's own header and footer.
 */

const readCss = () => readFile(path.join(root, "src", "styles.css"), "utf8");
const withoutComments = (css) => css.replace(/\/\*[\s\S]*?\*\//gu, "");

/** The one print block's body, with its own nested blocks left in place. */
async function printBlock() {
  const css = withoutComments(await readCss());
  const marker = /@media print \{/gu;
  const found = [];
  let match;
  while ((match = marker.exec(css)) !== null) {
    let depth = 1;
    let index = match.index + match[0].length;
    const start = index;
    while (depth > 0 && index < css.length) {
      if (css[index] === "{") depth += 1;
      else if (css[index] === "}") depth -= 1;
      index += 1;
    }
    found.push(css.slice(start, index - 1));
  }
  return found;
}

/** The rules in a block whose selector mentions `selector`, as declaration text. */
const rulesFor = (body, selector) => [...body.matchAll(/([^{}]+)\{([^{}]*)\}/gu)]
  .filter(([, selectors]) => selectors.split(",").some((part) => part.trim().includes(selector)))
  .map(([, , declarations]) => declarations)
  .join(";");

test("there is one print block, and it sets a margin without choosing the paper", async () => {
  const blocks = await printBlock();
  // It was two, 64 rules apart, with the same two declarations in each.
  assert.equal(blocks.length, 1, "@media print should be one block; two of them drift (#179)");
  assert.match(blocks[0], /@page\s*\{[^}]*margin:\s*\d+mm/u, "the page needs a margin, in a paper unit (#179)");
  // `@page` cannot be scoped to a screen, so whatever it says is said to every print in the
  // app. A size would put A4 pages in a Letter tray for the sake of one screen's handout.
  assert.doesNotMatch(blocks[0], /@page\s*\{[^}]*size:/u,
    "the reader's paper is the reader's; the layout is fluid and takes either (#179)");
});

test("the application does not print, only the document it is showing", async () => {
  const [body] = await printBlock();
  const rules = [...body.matchAll(/([^{}]+)\{([^{}]*)\}/gu)]
    .map(([, selectors, declarations]) => ({ parts: selectors.split(",").map((part) => part.trim()), declarations }));
  const hiddenBy = (selector) => rules.filter(({ parts, declarations }) =>
    /display:\s*none/u.test(declarations) && parts.some((part) => part.endsWith(selector)));

  // Layers that float over the page rather than belong to it, on any screen: the change bar
  // prints across a candidate, and the launcher's reserved strip prints as blank paper.
  for (const selector of [".change-bar", ".toast", ".overlay", ".ai-chat-root", ".notification-popover"]) {
    const hiding = hiddenBy(selector);
    assert.ok(hiding.length > 0, `${selector} would print over the page (#179)`);
    assert.ok(hiding.some(({ parts }) => parts.includes(selector)),
      `${selector} should be hidden everywhere, not only where a proposal is on screen (#179)`);
  }

  // The application's own furniture, only where the proposal is: printing is not a
  // proposal-only act, and the first version of this took the sidebar off every screen's
  // print and made an open panel unprintable anywhere (the evaluation on #179).
  for (const selector of [".sidebar", ".topbar", ".drawer"]) {
    const hiding = hiddenBy(selector);
    assert.ok(hiding.length > 0, `${selector} would print as part of the handout (#179)`);
    assert.ok(hiding.every(({ parts }) => parts.filter((part) => part.endsWith(selector))
      .every((part) => part.includes(".proposal-view"))),
      `${selector} is hidden for every print, not just the proposal's (#179)`);
  }

  // The sidebar's grid column has to go with the sidebar, or every page carries its indent.
  assert.match(rulesFor(body, ".app-shell:has(.proposal-view)"), /display:\s*block/u,
    "the shell's two columns leave a 258px indent on paper once the sidebar is hidden (#179)");
});

test("nothing on the printed proposal is a control", async () => {
  const [body] = await printBlock();
  for (const selector of [".view-toolbar", ".proposal-picker", ".proposal-remove", ".proposal-open",
    ".favorite-star"]) {
    assert.match(rulesFor(body, selector), /display:\s*none/u,
      `${selector} is something to press, and paper cannot be pressed (#179)`);
  }
  assert.match(rulesFor(body, ".proposal-card"), /break-inside:\s*avoid/u,
    "a candidate split across a page break is two half-candidates (#179)");
});

test("the header still reads when the printer does not print backgrounds", async () => {
  const [body] = await printBlock();
  const ribbon = rulesFor(body, ".member-ribbon");
  // Measured: a dark block with #fff8f4 text on it, and Chrome's default is not to print the
  // block. Both halves have to change, so both are asserted.
  assert.match(ribbon, /background:\s*#fff/u, "the ribbon has to stop being a dark block on paper (#179)");
  assert.match(ribbon, /color:\s*#[0-9a-f]{6}/u, "and its text has to stop being near-white (#179)");
  for (const selector of [".ribbon-lead strong", ".ribbon-lead small", ".ribbon-stat span"]) {
    assert.match(rulesFor(body, selector), /color:\s*#[0-9a-f]{6}/u,
      `${selector} keeps the theme's light-on-dark colour otherwise, which is white on white (#179)`);
  }
});

test("every field the tick boxes offer has a print rule that answers to it", async () => {
  const [body] = await printBlock();
  const csv = await readFile(path.join(root, "src", "csv.ts"), "utf8");
  const declaration = csv.match(/PROPOSAL_CSV_COLUMNS\s*=\s*\[([^\]]*)\]/u);
  assert.ok(declaration, "expected PROPOSAL_CSV_COLUMNS in src/csv.ts");
  const columns = [...declaration[1].matchAll(/"([^"]+)"/gu)].map((match) => match[1]);
  const required = csv.match(/REQUIRED_PROPOSAL_CSV_COLUMN[^=]*=\s*"([^"]+)"/u)?.[1];
  assert.ok(required, "expected REQUIRED_PROPOSAL_CSV_COLUMN in src/csv.ts");
  assert.ok(columns.includes(required), "the required column should be one of the columns");

  // `data-print` is a space-separated list read with `~=`, so a column name with a space in it
  // could never be matched — and the rule mentioning it would still be here, looking right.
  const spaced = columns.filter((column) => /\s/u.test(column));
  assert.deepEqual(spaced, [], `a column name with whitespace cannot be matched by [data-print~=]: `
    + `${spaced.join(", ")}. Either take the space out or give the attribute stable keys (#179)`);

  const quote = (value) => value.replaceAll(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  // `data-print` carries the ticked column names, so the stylesheet holds the same list of
  // labels the checkboxes show. Renaming a column and leaving the print rule behind would
  // otherwise print a field nobody asked for, quietly.
  for (const column of columns.filter((name) => name !== required)) {
    assert.match(body, new RegExp(`data-print~="${quote(column)}"`, "u"),
      `the print rules do not mention 「${column}」, so unticking it does nothing on paper. `
      + "Either the column is new or it was renamed without the stylesheet (#179)");
  }
  // The required one is the card's own heading and has no rule to drop it: a page of
  // proposals with no candidates on it is not a proposal.
  assert.doesNotMatch(body, new RegExp(`data-print~="${quote(required)}"`, "u"),
    `「${required}」 is in every file and on every page; a rule to drop it would be a way to print `
    + "nothing (#148, #179)");
});

/**
 * The tick boxes are the whole of what the sender chose, so a field that rides along with a
 * chosen one is a field nobody chose. Both of these were found by the evaluation on #179: the
 * department was inside the same element as the role, and the requirement's matched skills were
 * inside the same paragraph as its availability percentage.
 */
test("nothing rides along with a field that was chosen", async () => {
  const [body] = await printBlock();
  // Not a column at all — the file has never had one for it.
  assert.match(rulesFor(body, ".proposal-card-department"), /display:\s*none/u,
    "「職種」 would otherwise put 「QA Engineer · 品質保証」 on a page going outside (#179)");
  // Skill data, so it answers to the skills box rather than to the percentage beside it.
  assert.match(body, /:not\(\[data-print~="スキル"\]\)\s*\.proposal-match-skills/u,
    "the requirement's matched skills print with 「要件期間の最小空き」 unticked otherwise (#179)");
});
