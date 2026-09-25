import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const css = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
const app = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");

test("the assignment detail form alone is capped at 36rem and stays left", () => {
  const rule = css.match(/(^|\n)\.assignment-edit-form\s*\{([^}]+)\}/);
  assert.ok(rule, "expected a rule whose selector is only .assignment-edit-form");
  assert.match(rule[2], /max-width:\s*36rem/);
  assert.match(rule[2], /margin-left:\s*0/);
  assert.match(rule[2], /margin-right:\s*auto/);
  for (const block of css.split("}")) {
    if (!/max-width:\s*36rem/.test(block)) continue;
    const selector = block.slice(0, block.lastIndexOf("{"));
    assert.equal(selector.includes("assignment-form"), false, selector);
  }
  const worn = [...app.matchAll(/className="([^"]*assignment-edit-form[^"]*)"/g)].map((match) => match[1]);
  assert.deepEqual(worn, ["assignment-form assignment-edit-form"]);
  assert.match(app, /assignment:\s*"dialog-lg"/);
});
