import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * #164: the drawer form dresses its fields with child selectors.
 *
 * ```
 * .assignment-form > label { margin-bottom: 17px; display: block; … }
 * .assignment-form > label > input { width: 100%; height: 43px; margin-top: 7px; border: … }
 * ```
 *
 * `CustomFieldInputs` wrapped its labels in a div, which cut that chain. Its labels were
 * form *grandchildren*, so they stayed inline with no spacing, and its inputs matched no
 * width rule at all — measured at 1440px in the project edit form, the 顧客名 input was
 * 177px sitting on the same line as its label, against 683.8px on its own line for every
 * other control in the form.
 *
 * The selects looked correct, which is what made this hard to see: `.assignment-form
 * select` is written without the `>`, so it reached inside the wrapper and took its
 * `width: 100%`. One wrapper, two behaviours, and only the inputs were visibly wrong.
 *
 * The fix removes the wrapper rather than adding CSS. Loosening the selectors to
 * descendants would reach the nested labels in `MemberOrgFields` — the 兼務 checkbox rows —
 * and give each of them `display: block`, `margin-bottom: 17px` and a full-width input.
 *
 * Measured after, at 1440 and 375, in all three forms that use these fields (member add,
 * member edit, project edit), across every custom field type the app has — text, number,
 * date, select: one distinct control width per form (683.8px and 337px), every control
 * 44px tall, none of them beside its label, no spill, and no page-level sideways scroll.
 *
 * ## What this checks
 *
 * That the reason still holds — the rules are still child selectors — so the structural
 * test in `src/App.test.tsx` is guarding something real. It reads declarations; the widths
 * above are browser measurements, recorded in the PR.
 */

const readCss = async () => (await readFile(path.join(root, "src", "styles.css"), "utf8")).replaceAll("\r\n", "\n");
const withoutComments = (source) => source.replace(/\/\*[\s\S]*?\*\//gu, "");

test("the drawer form dresses its own children, so a field cannot be wrapped", async () => {
  const css = withoutComments(await readCss());

  // The rule that gives a field its spacing and its block layout.
  assert.match(css, /\.assignment-form\s*>\s*label\s*\{[^}]*display:\s*block/u,
    "expected `.assignment-form > label` to lay the field out (#164)");
  // The rule that gives its control the form's width.
  assert.match(css, /\.assignment-form\s*>\s*label\s*>\s*input,[\s\S]{0,80}?\{[^}]*width:\s*100%/u,
    "expected `.assignment-form > label > input` to size the control (#164)");

  // Both are child selectors, which is exactly why a wrapping element breaks a field —
  // and why the fix was to remove the wrapper rather than to loosen these. Loosened, they
  // would reach the nested checkbox labels of the 兼務 rows.
  const labelRule = css.match(/(\.assignment-form\s*>?\s*label)\s*\{[^}]*display:\s*block/u);
  assert.ok(labelRule?.[1].includes(">"),
    `「${labelRule?.[1]}」 is no longer a child selector. Loosening it dresses every nested label in `
    + "the form, including the 兼務 checkbox rows (#164)");
});
