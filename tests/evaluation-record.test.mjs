import assert from "node:assert/strict";
import { test } from "node:test";
import { checkEvaluationRecord, touchesOwnCheck } from "../scripts/check-evaluation-record.mjs";

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

test("ignores a record that only appears inside a code fence", () => {
  // AGENTS.md documents the bypass line inside a fence. Pasting the doc must not
  // grant a bypass, and a fenced template must not satisfy the record either.
  const fenced = [
    "Closes #63",
    "",
    "```",
    "評価なし承認: <利用者の指示内容と理由をここに書く>",
    "評価者: codex gpt-5.6-sol",
    "エフォート: high",
    `評価対象コミット: ${A}`,
    "```",
  ].join("\n");
  const result = checkEvaluationRecord(fenced, [A]);
  assert.equal(result.bypass, false);
  assert.equal(result.ok, false);
});

test("rejects a bypass whose reason is too short to mean anything", () => {
  const terse = checkEvaluationRecord("評価なし承認: なし", [A]);
  assert.equal(terse.ok, false);
  assert.equal(terse.bypass, false);
  assert.match(terse.problems.join(" "), /短すぎます/u);
});

test("warns loudly when a bypass is used, since nobody authenticated it", () => {
  const long = checkEvaluationRecord(
    `評価なし承認: codex の認証が切れており、利用者が評価なしで出すよう明示的に指示した`,
    [A],
  );
  assert.equal(long.ok, true);
  assert.equal(long.bypass, true);
  assert.match(long.warnings.join(" "), /承認者の認証はありません/u);
});

test("counts the commits pushed after the evaluated one", () => {
  // rev-list order is newest first.
  const newest = "e".repeat(40);
  const middle = "f".repeat(40);
  const result = checkEvaluationRecord(body({ commit: A }), [newest, middle, A]);
  assert.equal(result.ok, true, result.problems.join(" "));
  assert.equal(result.record.commitsAfterEvaluation, 2);
  assert.match(result.warnings.join(" "), /評価後に 2 件のコミットが追加/u);

  const evaluatedHead = checkEvaluationRecord(body({ commit: newest }), [newest, middle, A]);
  assert.equal(evaluatedHead.record.commitsAfterEvaluation, 0);
  assert.deepEqual(evaluatedHead.warnings, []);
});

test("flags a diff that edits the check itself", () => {
  assert.deepEqual(touchesOwnCheck(["src/App.tsx", "README.md"]), []);
  assert.deepEqual(
    touchesOwnCheck([".github/workflows/ci.yml", "scripts/check-evaluation-record.mjs"]),
    [".github/workflows/ci.yml", "scripts/check-evaluation-record.mjs"],
  );
  assert.deepEqual(touchesOwnCheck(["scripts\\check-evaluation-record.mjs"]), ["scripts/check-evaluation-record.mjs"]);
  assert.deepEqual(touchesOwnCheck(undefined), []);
});

test("does not backtrack catastrophically on a long run of asterisks", () => {
  const hostile = `${"*".repeat(20000)}評価者 codex`;
  const started = process.hrtime.bigint();
  checkEvaluationRecord(hostile, [A]);
  const ms = Number(process.hrtime.bigint() - started) / 1e6;
  assert.ok(ms < 500, `field() took ${Math.round(ms)}ms on a hostile body`);
});

/**
 * #74 decided not to run the evaluator in CI: it would prove the evaluator was
 * called and not that it read anything, and the failure this repository actually
 * has is not forgery by an outsider — it is the agent quietly normalising the
 * bypass. Twenty consecutive bypassed pull requests happened here in one week.
 *
 * So the controls are the ones that make that visible: every claimed bypass is
 * labelled, and what was added after the evaluated commit is reported in files
 * and lines. Neither proves anything. Both make a pattern findable later.
 */
test("the label follows the bypass claim, not the grant", () => {
  const granted = checkEvaluationRecord(
    "評価なし承認: モデルが使用上限で起動できず、利用者から評価なしで進める指示を受けている",
    [A],
  );
  assert.equal(granted.ok, true);
  assert.equal(granted.bypass, true);
  assert.equal(granted.bypassClaimed, true);

  // Too short to mean anything: refused, and still labelled. A body that tried
  // to skip the evaluation is the one most worth finding again later.
  const refused = checkEvaluationRecord("評価なし承認: 急ぎ", [A]);
  assert.equal(refused.ok, false);
  assert.equal(refused.bypass, false);
  assert.equal(refused.bypassClaimed, true);

  // A real record claims nothing.
  const proper = checkEvaluationRecord(body(), [A]);
  assert.equal(proper.bypassClaimed, false);
});

test("says how much was added after the evaluation, in files and lines", () => {
  // rev-list order: newest first, so [C, B, A] means A was evaluated and two
  // commits landed on top of it.
  const C = "c".repeat(40);
  const growth = new Map([[A, { files: 7, insertions: 210, deletions: 34 }]]);
  const result = checkEvaluationRecord(body({ commit: A }), [C, B, A], growth);
  assert.equal(result.ok, true);
  const warning = result.warnings.join(" ");
  assert.match(warning, /2 件のコミットが追加されています/u);
  // The part that matters: a commit count alone said 「1 件」 for a whole-diff
  // rewrite and 「3 件」 for three typo fixes.
  assert.match(warning, /7 ファイル \/ \+210 -34 行/u);
  assert.equal(result.record.addedAfterEvaluation, "7 ファイル / +210 -34 行");
});

test("leaves the growth note out when there is nothing to say", () => {
  // Evaluated at the head: nothing was added, so no warning at all.
  const atHead = checkEvaluationRecord(body({ commit: A }), [A, B], new Map());
  assert.deepEqual(atHead.warnings, []);
  assert.equal(atHead.record.addedAfterEvaluation, "");

  // Commits were added but the workflow could not measure them: the count still
  // reports, without inventing a size.
  const unmeasured = checkEvaluationRecord(body({ commit: B }), [A, B]);
  assert.match(unmeasured.warnings.join(" "), /1 件のコミットが追加されています。/u);
  assert.doesNotMatch(unmeasured.warnings.join(" "), /ファイル/u);

  // A row of zeroes is not a size either.
  const zeroed = checkEvaluationRecord(body({ commit: B }), [A, B], new Map([[B, { files: 0, insertions: 0, deletions: 0 }]]));
  assert.doesNotMatch(zeroed.warnings.join(" "), /ファイル/u);
});
