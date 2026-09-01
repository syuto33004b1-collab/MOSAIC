/**
 * Checks that a pull request body carries a usable record of its pre-PR
 * evaluation, and that the recorded commit is really one of this pull request's
 * own commits.
 *
 * ## What this cannot do
 *
 * **It does not prove an evaluation happened.** The body is written by the
 * author, so any SHA from the pull request can be transcribed without running
 * anything. Nothing here is an attestation.
 *
 * What it does buy: a missing record fails, a stale record pointing at main or
 * another branch fails, and what was added after the recorded commit is reported
 * in files and lines so review can see how much went unevaluated. It removes
 * accidental omission and silent reuse. It does not remove deliberate
 * fabrication.
 *
 * Proving the evaluation would mean CI running the evaluator itself. #74 settled
 * that: not worth its cost here, because it would prove the evaluator was called
 * and not that it read anything, and the failure this repository actually has is
 * not forgery by an outsider — it is the agent quietly normalising the bypass.
 * So the controls are the ones that make that visible instead: every bypass is
 * labelled, and the size of what was added after the evaluation is reported in
 * files and lines rather than in commits, because one commit can change
 * everything.
 *
 * The body is attacker-controlled text. It is only ever matched against anchored
 * patterns here, never executed or interpolated into a shell.
 */

const SHA_PATTERN = /^[0-9a-f]{40}$/u;
const MIN_BYPASS_REASON = 20;

/**
 * Authors whose pull requests carry no evaluation record, because there was no
 * pre-PR evaluation to record: the diff is not written by an agent that could
 * have run one. Requiring the record of them made every dependency bump
 * permanently unmergeable, since `Evaluation record` is a required check (#237).
 *
 * The mechanical gates still apply. Only the record is waived.
 *
 * The login comes from the pull request event, not from the body, so it cannot be
 * claimed by writing a line — but it is the login of whoever *opened* the pull
 * request and does not change when someone pushes to the branch afterwards. So
 * the commit authors are checked too; see `evaluationRecordWaived`.
 */
const EXEMPT_AUTHORS = new Set(["dependabot[bot]"]);

/**
 * The commit identities a waived pull request may carry. Measured on all six open
 * bumps (2026-09-01): every commit reads
 * `dependabot[bot] <49699333+…> / committer GitHub <noreply@github.com>`, the
 * author number being Dependabot's GitHub App user id and the committer being
 * GitHub itself, because the bot writes through the API.
 *
 * **The committer matters as much as the author.** `git commit --amend` keeps the
 * author and replaces the committer, so an amended bump would otherwise still
 * look like the bot's own work while carrying anyone's changes.
 *
 * Exact sets rather than patterns. An identity that is not in them leaves the
 * record required and gets named in the log: a line to read, not a hole to walk
 * through.
 */
const EXEMPT_COMMIT_AUTHORS = new Set(["49699333+dependabot[bot]@users.noreply.github.com"]);
const EXEMPT_COMMITTERS = new Set(["noreply@github.com"]);

/**
 * Removes fenced code blocks so a template or a quoted example inside one is not
 * mistaken for the real record. Without this, the `評価なし承認:` example in
 * AGENTS.md would grant a bypass to anyone who pasted it into a body.
 */
function withoutCodeFences(text) {
  return text.replace(/^[ \t]*(```|~~~)[\s\S]*?^[ \t]*\1[ \t]*$/gmu, "");
}

/**
 * Reads `ラベル: 値` from the body and returns the first non-empty value.
 *
 * Tolerant of the markdown people actually write: list markers and blockquotes
 * before the label, bold or backticks around it, a full-width colon, and table
 * rows where `|` separates label from value.
 *
 * The character classes are kept disjoint on purpose. Overlapping quantifiers
 * (both accepting `*`) backtrack catastrophically on a long run of asterisks.
 */
function field(body, label) {
  const pattern = new RegExp(
    `^[ \\t>|-]*[*\`_]*${label}[*\`_]*[ \\t]*(?:[:：]|\\|)[ \\t]*(.+)$`,
    "imu",
  );
  const match = pattern.exec(body);
  if (!match) return "";
  // Strip markdown emphasis, backticks and table pipes from the captured value.
  return match[1].replace(/[`*_|]/gu, "").trim();
}

/**
 * How much was added after the evaluated commit, in the units that mean
 * something: files and lines. The commit count alone said 「1 件」 for a rewrite
 * of the whole diff and 「3 件」 for three typo fixes (#74).
 *
 * @param {Map<string, {files: number, insertions: number, deletions: number}>} stats
 *   keyed by commit sha: what changed between that commit and the head
 */
function growthSince(stats, commit) {
  const row = stats instanceof Map ? stats.get(commit) : undefined;
  if (!row) return "";
  const files = Number(row.files) || 0;
  const insertions = Number(row.insertions) || 0;
  const deletions = Number(row.deletions) || 0;
  if (files === 0 && insertions === 0 && deletions === 0) return "";
  return `${files} ファイル / +${insertions} -${deletions} 行`;
}

/**
 * @param {string} body pull request body
 * @param {string[]} prCommits full SHAs of the commits this pull request adds,
 *   newest first (the order `git rev-list base..head` produces)
 * @returns {{ ok: boolean, bypass: boolean, bypassClaimed: boolean, problems: string[], warnings: string[], record: object }}
 */
export function checkEvaluationRecord(body, prCommits, growth) {
  const raw = typeof body === "string" ? body : "";
  const text = withoutCodeFences(raw);
  const ordered = (Array.isArray(prCommits) ? prCommits : []).filter((sha) => SHA_PATTERN.test(sha));
  const commits = new Set(ordered);
  const problems = [];
  const warnings = [];

  const bypass = field(text, "評価なし承認");
  if (bypass) {
    if (bypass.length < MIN_BYPASS_REASON) {
      return {
        ok: false,
        bypass: false,
        // Claimed, though not granted. The label follows the claim: a body that
        // tried to skip the evaluation is worth finding either way (#74).
        bypassClaimed: true,
        problems: [
          `評価なし承認の理由が短すぎます（${bypass.length}文字）。`
            + `利用者の指示内容と理由を ${MIN_BYPASS_REASON} 文字以上で書いてください。`,
        ],
        warnings,
        record: {},
      };
    }
    return {
      ok: true,
      bypass: true,
      bypassClaimed: true,
      problems: [],
      warnings: [
        "この PR は独立評価を通していません。",
        "バイパスは作者自身が書けるもので、承認者の認証はありません。レビューで必ず理由を確認してください。",
      ],
      record: { bypassReason: bypass },
    };
  }

  const model = field(text, "評価者");
  const effort = field(text, "エフォート");
  const commit = field(text, "評価対象コミット").toLowerCase();

  if (!model) problems.push("PR 本文に `評価者: <モデル名>` がありません。");
  if (!effort) problems.push("PR 本文に `エフォート: <値>` がありません。");

  let evaluatedIndex = -1;
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
  } else {
    evaluatedIndex = ordered.indexOf(commit);
  }

  // rev-list is newest first, so anything before the recorded commit was pushed
  // after the evaluation and was therefore not evaluated.
  const added = evaluatedIndex > 0 ? growthSince(growth, commit) : "";
  if (evaluatedIndex > 0) {
    warnings.push(
      `評価後に ${evaluatedIndex} 件のコミットが追加されています`
        + (added ? `（${added}）` : "")
        + "。 指摘対応だけなら再評価は不要ですが、それ以外の変更を含むなら再評価が必要です（AGENTS.md の 11）。",
    );
  }

  if (problems.length > 0) {
    problems.push(
      "評価を通していない場合は、評価してから PR 本文へ記録してください（書式は AGENTS.md の 12）。"
        + " 評価を起動できない事情があるなら、利用者の承認を得て `評価なし承認: <理由>` を本文へ書いてください。",
    );
  }

  return {
    ok: problems.length === 0,
    bypass: false,
    bypassClaimed: false,
    problems,
    warnings,
    record: { model, effort, commit, commitsAfterEvaluation: Math.max(evaluatedIndex, 0), addedAfterEvaluation: added },
  };
}

/** True when this login is the dependency bot's (#237). */
export function isExemptAuthor(login) {
  return EXEMPT_AUTHORS.has(String(login ?? "").trim().toLowerCase());
}

/**
 * Whether this pull request owes no evaluation record.
 *
 * Two conditions: the bot opened it, **and** every commit in it carries the bot's
 * author and committer. The pull request author alone is not enough — it stays
 * `dependabot[bot]` after anyone with write access pushes to the branch, and
 * waiving the record for those commits is exactly the quiet normalisation the
 * gate exists to prevent (#74). Pushing a lint fix onto a bump branch is a normal
 * thing to do here, so this is not a hypothetical.
 *
 * This reads commit metadata, which says who a commit *claims* to be from. It is
 * not an authentication, and does not try to be: the same pull request can edit
 * the workflow that feeds this check. What it stops is the record being dropped
 * by accident or by habit.
 *
 * Fail closed. Every commit needs an identity, so an unreadable or short list
 * waives nothing — including a merge commit from catching the branch up on main,
 * which is authored by whoever pressed the button (手順14).
 *
 * @param {string} author login of whoever opened the pull request
 * @param {string[]} commits full SHAs of the commits this pull request adds
 * @param {string[]} identities one `sha author committer` row per commit
 * @returns {{ waived: boolean, reason?: string }} `reason` explains a refusal
 *   worth logging, and is absent when the bot is simply not involved
 */
export function evaluationRecordWaived(author, commits, identities) {
  if (!isExemptAuthor(author)) return { waived: false };

  const wanted = new Set((Array.isArray(commits) ? commits : [])
    .map((sha) => String(sha ?? "").trim().toLowerCase())
    .filter((sha) => SHA_PATTERN.test(sha)));
  if (wanted.size === 0) {
    return { waived: false, reason: "この PR のコミットを特定できませんでした。" };
  }

  const seen = new Map();
  const foreign = new Set();
  for (const row of Array.isArray(identities) ? identities : []) {
    const [sha, commitAuthor, committer] = String(row ?? "").trim().toLowerCase().split(/\s+/u);
    if (!SHA_PATTERN.test(sha ?? "")) continue;
    if (!commitAuthor || !committer) continue;
    seen.set(sha, true);
    if (!EXEMPT_COMMIT_AUTHORS.has(commitAuthor)) foreign.add(commitAuthor);
    if (!EXEMPT_COMMITTERS.has(committer)) foreign.add(committer);
  }

  // One identity per commit, for the commits this pull request actually adds.
  const missing = [...wanted].filter((sha) => !seen.has(sha));
  if (missing.length > 0 || seen.size !== wanted.size) {
    return {
      waived: false,
      reason: `${wanted.size} 件のコミットのうち ${seen.size} 件しか作者を読めませんでした。`,
    };
  }

  if (foreign.size > 0) {
    return {
      waived: false,
      reason: `bot 以外の作者・コミッターが含まれています（${[...foreign].join(", ")}）。`
        + " その差分には評価記録が必要です。",
    };
  }

  return { waived: true };
}

/** True when the diff touches the check itself, which review should notice. */
export function touchesOwnCheck(changedPaths) {
  const watched = [
    "scripts/check-evaluation-record.mjs",
    ".github/workflows/ci.yml",
    "tests/evaluation-record.test.mjs",
  ];
  return (Array.isArray(changedPaths) ? changedPaths : [])
    .map((p) => String(p).replaceAll("\\", "/").trim())
    .filter((p) => watched.includes(p));
}

/**
 * CLI: body on stdin. Arguments:
 *   argv[2] path to a file with one commit SHA per line (newest first)
 *   argv[3] optional path to a file with one changed path per line
 *   argv[4] optional path to a file of `sha files insertions deletions` rows,
 *           each counting what the head added on top of that commit
 *   argv[5] optional path to a file of `sha author committer` rows, one per commit
 *
 * The lists come through files rather than argv because a long-lived branch can
 * exceed the OS argument limit.
 *
 * `PR_AUTHOR` is the login of whoever opened the pull request. Together with
 * argv[5] it decides the waiver (#237), and the check says which way it went in
 * the log rather than passing silently.
 *
 * Writes `bypass=true|false` to `$GITHUB_OUTPUT` when that is set, which is what
 * the workflow labels on. It follows the *claim*, not the grant: a body that
 * tried to skip with a two-word reason fails the check and still gets labelled,
 * and it is written before the exit code is decided so that stays true. The label
 * is the whole of the control — a bypassed pull request has to be findable later
 * without reading every body (#74).
 */
async function main() {
  const { readFile } = await import("node:fs/promises");
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const body = Buffer.concat(chunks).toString("utf8");

  const lines = async (path) => {
    if (!path) return [];
    const content = await readFile(path, "utf8");
    return content.split(/\r?\n/u).map((l) => l.trim()).filter(Boolean);
  };

  const commits = await lines(process.argv[2]);
  const changed = await lines(process.argv[3]);
  const identities = await lines(process.argv[5]);
  const growth = new Map();
  for (const row of await lines(process.argv[4])) {
    const [sha, files, insertions, deletions] = row.split(/\s+/u);
    if (SHA_PATTERN.test((sha ?? "").toLowerCase())) {
      growth.set(sha.toLowerCase(), { files, insertions, deletions });
    }
  }
  const result = checkEvaluationRecord(body, commits, growth);

  // For the labelling step. Written before the exit code is decided, so a failing
  // record still gets labelled if it claimed a bypass.
  if (process.env.GITHUB_OUTPUT) {
    const { appendFile } = await import("node:fs/promises");
    await appendFile(process.env.GITHUB_OUTPUT, `bypass=${result.bypassClaimed ? "true" : "false"}
`);
  }

  const selfEdits = touchesOwnCheck(changed);
  if (selfEdits.length > 0) {
    result.warnings.push(
      `この PR は評価チェック自体を変更しています（${selfEdits.join(", ")}）。`
        + " チェックを緩めていないか、レビューで必ず確認してください。",
    );
  }

  for (const warning of result.warnings) console.log(`::warning::${warning}`);

  // After the warnings, so a bot bumping an action in ci.yml still says so, and
  // before the exit code, so the record itself is not required (#237).
  const author = process.env.PR_AUTHOR ?? "";
  const waiver = evaluationRecordWaived(author, commits, identities);
  if (waiver.waived) {
    console.log(`::notice::${author} の PR なので評価記録は要求しません（#237）。機械的な検証は通す必要があります。`);
    return;
  }
  if (waiver.reason) {
    console.log(`::warning::${author} の PR ですが、評価記録の免除は適用しません。${waiver.reason}`);
  }

  if (result.bypass) {
    console.log(`評価なしで承認されています: ${result.record.bypassReason}`);
    return;
  }
  if (result.ok) {
    console.log(`評価記録を確認しました: ${result.record.model} / ${result.record.effort}`);
    console.log(`評価対象コミット: ${result.record.commit}`);
    console.log(
      `評価後に追加されたコミット: ${result.record.commitsAfterEvaluation} 件`
        + (result.record.addedAfterEvaluation ? ` (${result.record.addedAfterEvaluation})` : ""),
    );
    return;
  }
  for (const problem of result.problems) console.error(`- ${problem}`);
  process.exitCode = 1;
}

if (process.argv[1]?.endsWith("check-evaluation-record.mjs")) {
  await main();
}
