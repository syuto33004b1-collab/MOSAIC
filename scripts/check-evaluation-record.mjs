/**
 * Checks that a pull request body carries a usable record of its pre-PR
 * evaluation, and that the recorded commit is really one of this pull request's
 * own commits.
 *
 * The point is not to grade the evaluation. It is to remove "I evaluated it
 * earlier" as something an author can assert without evidence. AGENTS.md states
 * the rule; this makes the record checkable.
 *
 * The body is attacker-controlled text. It is only ever matched against
 * anchored patterns here, never executed or interpolated into a shell.
 */

const SHA_PATTERN = /^[0-9a-f]{40}$/u;

/**
 * Reads `ラベル: 値` from the body. Only the first occurrence counts.
 *
 * Tolerant of the markdown people actually write: list markers and blockquotes
 * before the label, bold or backticks around it, a full-width colon, and table
 * rows where `|` separates label from value.
 */
function field(body, label) {
  // Horizontal whitespace only: \s would match the newline and let an empty
  // value swallow the following line as its own.
  const pattern = new RegExp(
    `^[ \\t>|*\\-]*[*\`_]*${label}[*\`_]*[ \\t]*(?:[:：]|\\|)[ \\t]*(.+)$`,
    "imu",
  );
  const match = pattern.exec(body);
  if (!match) return "";
  // Strip markdown emphasis, backticks and table pipes from the captured value.
  return match[1].replace(/[`*_|]/gu, "").trim();
}

/**
 * @param {string} body pull request body
 * @param {string[]} prCommits full SHAs of the commits this pull request adds
 * @returns {{ ok: boolean, bypass: boolean, problems: string[], record: object }}
 */
export function checkEvaluationRecord(body, prCommits) {
  const text = typeof body === "string" ? body : "";
  const commits = new Set(Array.isArray(prCommits) ? prCommits.filter((sha) => SHA_PATTERN.test(sha)) : []);

  const bypass = field(text, "評価なし承認");
  if (bypass) {
    return {
      ok: true,
      bypass: true,
      problems: [],
      record: { bypassReason: bypass },
    };
  }

  const model = field(text, "評価者");
  const effort = field(text, "エフォート");
  const commit = field(text, "評価対象コミット").toLowerCase();
  const problems = [];

  if (!model) {
    problems.push("PR 本文に `評価者: <モデル名>` がありません。");
  }
  if (!effort) {
    problems.push("PR 本文に `エフォート: <値>` がありません。");
  }
  if (!commit) {
    problems.push("PR 本文に `評価対象コミット: <40桁のコミットSHA>` がありません。");
  } else if (!SHA_PATTERN.test(commit)) {
    problems.push(`評価対象コミットが40桁の小文字16進SHAではありません: ${commit.slice(0, 60)}`);
  } else if (commits.size === 0) {
    problems.push("この PR のコミットを特定できませんでした。fetch-depth: 0 で checkout されているか確認してください。");
  } else if (!commits.has(commit)) {
    problems.push(
      `評価対象コミット ${commit} はこの PR のコミットではありません。`
        + " 評価はこの PR が追加したコミットに対して行ってください。",
    );
  }

  if (problems.length > 0) {
    problems.push(
      "評価を通していない場合は、評価してから PR 本文へ記録してください。"
        + " 評価を起動できない事情があるなら、利用者の承認を得て `評価なし承認: <理由>` を本文へ書いてください（AGENTS.md の 10）。",
    );
  }

  return {
    ok: problems.length === 0,
    bypass: false,
    problems,
    record: { model, effort, commit },
  };
}

/** CLI: body on stdin, PR commit SHAs as arguments. */
async function main() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const body = Buffer.concat(chunks).toString("utf8");
  const result = checkEvaluationRecord(body, process.argv.slice(2));

  if (result.bypass) {
    console.log(`評価なしで承認されています: ${result.record.bypassReason}`);
    console.log("この PR は独立評価を通していません。レビューで必ず確認してください。");
    return;
  }
  if (result.ok) {
    console.log(`評価記録を確認しました: ${result.record.model} / ${result.record.effort}`);
    console.log(`評価対象コミット: ${result.record.commit}`);
    return;
  }
  for (const problem of result.problems) console.error(`- ${problem}`);
  process.exitCode = 1;
}

if (import.meta.url === `file://${process.argv[1]?.replaceAll("\\", "/")}`
  || process.argv[1]?.endsWith("check-evaluation-record.mjs")) {
  await main();
}
