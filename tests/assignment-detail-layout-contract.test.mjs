import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const css = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
const app = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");

/** The rules of the at-rule block that opens at `header`, without its nested braces lost. */
function block(source, header) {
  const start = source.indexOf(header);
  assert.ok(start >= 0, `expected ${header}`);
  let depth = 0;
  for (let index = source.indexOf("{", start); index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    else if (source[index] === "}" && --depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`unclosed ${header}`);
}

test("the assignment detail uses the dialog's width instead of #440's 36rem cap (#587)", () => {
  const rule = css.match(/(^|\n)\.assignment-edit-form \{([^}]+)\}/);
  assert.ok(rule, "expected a rule whose selector is only .assignment-edit-form");
  assert.doesNotMatch(rule[2], /max-width/);
  assert.match(rule[2], /display:\s*flex/);
  assert.match(rule[2], /min-height:\s*0/);
  for (const declarations of css.replace(/\/\*[\s\S]*?\*\//g, "").split("}")) {
    if (!/max-width:\s*36rem/.test(declarations)) continue;
    const selector = declarations.slice(0, declarations.lastIndexOf("{"));
    assert.equal(selector.includes("assignment"), false, selector);
  }
  const worn = [...app.matchAll(/className="([^"]*assignment-edit-form[^"]*)"/g)].map((match) => match[1]);
  assert.deepEqual(worn, ["assignment-form assignment-edit-form"]);
  assert.match(app, /assignment:\s*"dialog-lg"/);
});

test("the panel stops scrolling and only releases its height from 621px, on its own class", () => {
  const shell = css.match(/(^|\n)\.drawer\.assignment-detail-open \{([^}]+)\}/);
  assert.ok(shell);
  assert.match(shell[2], /overflow:\s*hidden/);
  assert.match(shell[2], /flex-direction:\s*column/);
  // Below 621px the sheet keeps `min(88vh, 760px)`; a two-class height here would outrank it.
  assert.doesNotMatch(shell[2], /height/);
  const wide = css.match(/@media \(min-width: 621px\) \{\s*\.drawer\.assignment-detail-open \{([^}]+)\}\s*\}/);
  assert.ok(wide, "expected the height to be released inside a 621px query");
  assert.match(wide[1], /height:\s*auto/);
  assert.match(wide[1], /max-height:\s*100%/);
  // `.dialog-lg` is shared with four other dialogs and keeps the panel's full height.
  for (const match of css.matchAll(/\.dialog-lg \{([^}]+)\}/g)) assert.doesNotMatch(match[1], /height:\s*auto/);
  assert.match(app, /drawer === "assignment" \? " assignment-detail-open" : ""/);
});

test("two panes only once the panel's content box is 700px, with the list taking the height", () => {
  const container = block(css, "@container detail-panel (min-width: 700px)");
  assert.match(container, /\.assignment-detail-panes \{[^}]*grid-template-columns:\s*minmax\(0, 1fr\) minmax\(0, 1fr\)/);
  assert.match(container, /\.assignment-detail-terms \{[^}]*overflow-y:\s*auto/);
  // Rows at their content: with a height from the flex box, auto rows shrank to the 44px floor.
  assert.match(container, /\.assignment-detail-panes \.member-picker-list \{[^}]*max-height:\s*none[^}]*grid-auto-rows:\s*max-content/);
  const outside = css.replace(container, "");
  assert.doesNotMatch(outside, /\.assignment-detail-panes \{[^}]*minmax\(0, 1fr\) minmax\(0, 1fr\)/);
});

test("the terms come before the candidates, and the actions are inside the form but outside its scroll", () => {
  const start = app.indexOf('{drawer === "assignment" && selectedAssignment && (');
  const form = app.slice(start, app.indexOf("</form>", start));
  const body = form.indexOf('className="assignment-detail-body"');
  const terms = form.indexOf('className="assignment-detail-terms"');
  const picker = form.indexOf("<MemberPicker");
  const actions = form.indexOf('className="assignment-detail-actions"');
  assert.ok(body > 0 && terms > body && picker > terms && actions > picker, "body → terms → picker → actions");
  // Outside the scroll: every div opened from the body's own tag is closed before the actions.
  const between = form.slice(form.lastIndexOf("<div", body), actions);
  assert.equal((between.match(/<div\b/g) ?? []).length, (between.match(/<\/div>/g) ?? []).length + 1, "the actions sit after the body closes");
  assert.match(css, /\.assignment-detail-body \{[^}]*overflow-y:\s*auto/);
  assert.match(css, /\.assignment-detail-actions \{[^}]*flex:\s*0 0 auto/);
});
