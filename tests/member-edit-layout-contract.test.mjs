import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const css = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
const app = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
const views = readFileSync(new URL("../src/expanded-views.tsx", import.meta.url), "utf8");

test("the member edit form alone is capped at 36rem and stays left", () => {
  assert.match(css, /\.member-edit-form\s*\{[^}]*max-width:\s*36rem/);
  assert.match(css, /\.member-edit-form\s*\{[^}]*margin-left:\s*0/);
  const worn = [...app.matchAll(/className="([^"]*member-edit-form[^"]*)"/g)].map((match) => match[1]);
  assert.deepEqual(worn, ["assignment-form member-edit-form"]);
});

test("history and period delete buttons sit at the end of their card", () => {
  assert.match(css, /\.work-history-form\s*>\s*\.drawer-danger\.compact\s*\{[^}]*justify-self:\s*end/);
  assert.match(views, /aria-label=\{`経歴\$\{index \+ 1\}を削除`\}/);
  assert.match(views, /aria-label=\{`期間\$\{index \+ 1\}を削除`\}/);
  assert.equal(views.includes("この経歴を削除"), false);
  assert.equal(views.includes("この期間を削除"), false);
});
