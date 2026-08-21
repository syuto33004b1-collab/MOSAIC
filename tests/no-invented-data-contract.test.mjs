import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * #125: two places drew a bar chart out of numbers written into the source.
 *
 * ```
 * .portfolio-weave   [64, 82, 71, 92, 76, 55, 88, 69]   8 bars, width from the value
 * .pulse-mini-bars   [72, 84, 91, 78, 64]               5 bars, height from the value
 * ```
 *
 * Both were `aria-hidden`, so assistive technology skipped them — but a sighted
 * reader had nothing to tell them from the real figures sitting in the same band
 * (登録案件・要注意・未充足ロール, 平均稼働率・n/n週の空き・要調整). They were removed
 * rather than filled with real data or restyled: the band already carries the three
 * numbers that matter, and the decoration it needs is already there in
 * `.pulse-strip::after` / `.portfolio-ribbon::after`, which draw an arc — a shape
 * nobody reads as a measurement.
 *
 * ## The rule this pins
 *
 * A numeric array literal in the render path has to be an **arithmetic sequence**.
 * That covers every one this codebase actually has a use for:
 *
 * - `[0, 1, 2, 3]` — the four-week rails, mapping an index to a real week
 * - `[1, 2, 3, 4, 5]` — proficiency levels, a real domain scale
 * - `[4, 8, 12]` — the reports range picker's options
 *
 * and excludes the shape that went wrong twice: an arbitrary series standing in for
 * measurements. A dataset invented on purpose is not arithmetic, because arithmetic
 * ones look like the ruler they are.
 *
 * ## What it cannot do
 *
 * It reads array literals. The same invented series assigned to a `const` first, or
 * pushed into a fixture, would pass — as would an arithmetic one used as if it were
 * data. This is the specific shape that appeared, not a proof that no screen invents
 * a number. The judgement about whether something is data belongs to review; this
 * stops the exact pattern from reappearing unnoticed.
 */

const SOURCES = ["src/App.tsx", "src/expanded-views.tsx"];
const stripComments = (source) => source
  .replace(/\/\*[\s\S]*?\*\//gu, "")
  .replace(/^[ \t]*\/\/.*$/gmu, "");

const isArithmetic = (values) => {
  if (values.length < 2) return true;
  const step = values[1] - values[0];
  return values.every((value, index) => index === 0 || value - values[index - 1] === step);
};

test("a numeric array in the render path is a ruler, not a dataset", async () => {
  for (const file of SOURCES) {
    const source = stripComments(await readFile(path.join(root, file), "utf8"));
    const invented = [...source.matchAll(/\[\s*\d+(?:\s*,\s*\d+){2,}\s*\]/gu)]
      .map(([literal]) => ({ literal, values: literal.slice(1, -1).split(",").map((part) => Number(part.trim())) }))
      .filter(({ values }) => !isArithmetic(values))
      .map(({ literal }) => literal);
    assert.deepEqual(invented, [],
      `${file} holds a numeric array that is not an arithmetic sequence: ${invented.join(" ")}. `
      + "If those are dimensions for bars, they are invented data drawn as a measurement (#125). "
      + "If they are something else, this heuristic needs the exception written down.");
  }
});

/**
 * The classes themselves, in the markup and in every layer of the stylesheet. Removing
 * one and leaving the other is how a `display: none` for a class nobody renders ends
 * up outliving everyone who knew why.
 */
test("nothing is left of the two invented charts", async () => {
  const gone = ["portfolio-weave", "pulse-mini-bars"];
  for (const file of [...SOURCES, "src/styles.css"]) {
    const source = await readFile(path.join(root, file), "utf8");
    for (const name of gone) {
      // Comments are stripped first, so a class that survives only in prose does not
      // count. In the sources what matters is that nothing renders it, so the check is
      // on `className`; in the stylesheet, that no layer still declares it.
      const text = stripComments(source);
      const rendered = [...text.matchAll(new RegExp(`className="[^"]*\\b${name}\\b`, "gu"))].length;
      const styled = file.endsWith(".css") ? text.split(name).length - 1 : 0;
      assert.equal(rendered, 0,
        `${file} still renders 「${name}」 — the invented chart is back (#125)`);
      assert.equal(styled, 0,
        `${file} still declares 「${name}」 ${styled} time(s) — the markup and every layer of `
        + "the stylesheet go together, or a rule outlives the element it styled (#125)");
    }
  }
});

/**
 * And what replaces them: nothing, because the arc was always the decoration. Asserted
 * so that "we removed the bars" cannot quietly become "we removed the bars and the
 * band's own decoration with them".
 */
test("the bands keep the decoration they already had", async () => {
  const css = stripComments(await readFile(path.join(root, "src", "styles.css"), "utf8"));
  for (const selector of [".pulse-strip::after", ".portfolio-ribbon::after", ".member-ribbon::after"]) {
    assert.ok(css.includes(selector),
      `${selector} is gone. That arc is the band's decoration, and removing the invented bars (#125) `
      + "relies on it being what occupies the space they used to.");
  }
});
