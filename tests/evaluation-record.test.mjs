import assert from "node:assert/strict";
import { test } from "node:test";
import { checkEvaluationRecord } from "../scripts/check-evaluation-record.mjs";

const A = "a".repeat(40);
const B = "b".repeat(40);

function body(overrides = {}) {
  const { model = "codex gpt-5.6-sol", effort = "high", commit = A } = overrides;
  return [
    "Closes #63",
    "",
    "## この PR 自体の評価結果",
    "",
    `評価者: ${model}`,
    `エフォート: ${effort}`,
    `評価対象コミット: ${commit}`,
    "",
    "Critical 0件。",
  ].join("\n");
}

test("accepts a record whose commit belongs to the pull request", () => {
  const result = checkEvaluationRecord(body(), [A, B]);
  assert.equal(result.ok, true);
  assert.equal(result.bypass, false);
  assert.deepEqual(result.problems, []);
  assert.equal(result.record.model, "codex gpt-5.6-sol");
  assert.equal(result.record.effort, "high");
  assert.equal(result.record.commit, A);
});

test("rejects a commit that is not one of this pull request's commits", () => {
  // The whole point: citing a commit already on main, or from another branch,
  // must not pass as "I evaluated it".
  const result = checkEvaluationRecord(body({ commit: "c".repeat(40) }), [A, B]);
  assert.equal(result.ok, false);
  assert.match(result.problems.join(" "), /この PR のコミットではありません/u);
});

test("rejects a missing or malformed record", () => {
  assert.equal(checkEvaluationRecord("Closes #63", [A]).ok, false);
  assert.match(checkEvaluationRecord("Closes #63", [A]).problems.join(" "), /評価者/u);

  const noCommit = checkEvaluationRecord("評価者: codex\nエフォート: high", [A]);
  assert.equal(noCommit.ok, false);
  assert.match(noCommit.problems.join(" "), /評価対象コミット/u);

  const shortSha = checkEvaluationRecord(body({ commit: "abc123" }), [A]);
  assert.equal(shortSha.ok, false);
  assert.match(shortSha.problems.join(" "), /40桁/u);

  const blankModel = checkEvaluationRecord(body({ model: "" }), [A]);
  assert.equal(blankModel.ok, false);
  assert.match(blankModel.problems.join(" "), /評価者/u);
});

test("reports a setup problem instead of blaming the author when no commits are known", () => {
  const result = checkEvaluationRecord(body(), []);
  assert.equal(result.ok, false);
  assert.match(result.problems.join(" "), /fetch-depth/u);
});

test("lets an explicitly approved skip through, and says so", () => {
  const approved = checkEvaluationRecord(
    "Closes #63\n\n評価なし承認: codex の認証が切れており、利用者が評価なしで出すよう指示した",
    [A],
  );
  assert.equal(approved.ok, true);
  assert.equal(approved.bypass, true);
  assert.match(approved.record.bypassReason, /認証が切れて/u);
});

test("reads the record through the markdown people actually write", () => {
  // Bold labels, table rows, blockquotes, backticked shas, full-width colons.
  const decorated = [
    "| **評価者** | codex `gpt-5.6-sol` |",
    "> エフォート：xhigh",
    `- 評価対象コミット: \`${A}\``,
  ].join("\n");
  const result = checkEvaluationRecord(decorated, [A]);
  assert.equal(result.ok, true, result.problems.join(" "));
  assert.equal(result.record.commit, A);
  assert.equal(result.record.effort, "xhigh");
  assert.match(result.record.model, /gpt-5\.6-sol/u);
});

test("accepts an uppercase sha and ignores unrelated shas in the body", () => {
  const upper = checkEvaluationRecord(body({ commit: A.toUpperCase() }), [A]);
  assert.equal(upper.ok, true, upper.problems.join(" "));

  const withNoise = checkEvaluationRecord(
    `${body()}\n\nついでに ${"d".repeat(40)} も見た`,
    [A],
  );
  assert.equal(withNoise.ok, true);
  assert.equal(withNoise.record.commit, A);
});

test("treats a non-string body as missing rather than throwing", () => {
  for (const value of [undefined, null, 42, {}]) {
    const result = checkEvaluationRecord(value, [A]);
    assert.equal(result.ok, false);
    assert.ok(result.problems.length > 0);
  }
});

test("ignores commit values that are not real shas when they come from the workflow", () => {
  const result = checkEvaluationRecord(body(), ["not-a-sha", A]);
  assert.equal(result.ok, true, result.problems.join(" "));
});
