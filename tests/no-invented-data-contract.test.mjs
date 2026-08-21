import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { test } from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * #125: two bands drew a bar chart out of numbers written into the source.
 *
 * ```
 * .portfolio-weave   [64, 82, 71, 92, 76, 55, 88, 69]   8 bars, width from the value
 * .pulse-mini-bars   [72, 84, 91, 78, 64]               5 bars, height from the value
 * ```
 *
 * Both were `aria-hidden`, so assistive technology skipped them — but a sighted reader
 * had nothing to tell them from the real figures sitting in the same band
 * (登録案件・要注意・未充足ロール, 平均稼働率・n/n週の空き・要調整). They were removed
 * rather than filled with real data or restyled: the band already carries the three
 * numbers that matter, and the decoration it needs is already there in
 * `.pulse-strip::after` / `.portfolio-ribbon::after`, which draw an arc — a shape
 * nobody reads as a measurement.
 *
 * ## What this checks, and what it deliberately does not
 *
 * Only that these two are gone and stay gone, from every source file and every layer
 * of the stylesheet. Removing the markup and leaving a `display: none` behind is how a
 * rule outlives the element it styled, and moving the component elsewhere is how a
 * fix gets undone by a refactor rather than by a decision.
 *
 * A first version also required every numeric array literal in these two files to be
 * an arithmetic sequence, on the theory that a ruler looks like a ruler and an
 * invented dataset does not. The evaluator on this change talked me out of it, and was
 * right: it would fail on the next legitimate list of breakpoints, coordinates or
 * column widths, while passing negatives, decimals, hex, digit separators, a `const`
 * indirection or an array of objects. Whether a number is data is a judgement, and a
 * heuristic that gets it wrong in both directions buys a repo-wide convention broader
 * than the issue it came from.
 *
 * So the judgement stays with review. This stops the two specific shapes from coming
 * back unnoticed, which is what the issue asked for.
 */

const GONE = ["portfolio-weave", "pulse-mini-bars"];
const stripComments = (source) => source
  .replace(/\/\*[\s\S]*?\*\//gu, "")
  .replace(/^[ \t]*\/\/.*$/gmu, "");

/** Every file under src/, whatever the extension, so a move cannot hide one. */
async function sourceFiles(dir = path.join(root, "src")) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...await sourceFiles(full));
    else files.push(full);
  }
  return files;
}

test("neither invented chart is anywhere under src/", async () => {
  const files = await sourceFiles();
  assert.ok(files.length > 10, `expected to walk the source tree, found ${files.length} files`);
  const offenders = [];
  for (const file of files) {
    // Comments are stripped, so a class that survives only in prose — including this
    // repo's habit of explaining a past defect in a comment — does not count.
    const text = stripComments(await readFile(file, "utf8"));
    for (const name of GONE) {
      const count = text.split(name).length - 1;
      if (count > 0) offenders.push(`${path.relative(root, file)}: ${name} ×${count}`);
    }
  }
  assert.deepEqual(offenders, [],
    "these draw invented data as a measurement, or style something that does (#125):\n  " + offenders.join("\n  "));
});
