import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * #416 locked the backup policy and the restore-check, not a hosted dump.
 *
 * What this pins
 *   The operations table must not say the backup is already running while the
 *   database row still says 未接続. The means, store, retention, and the
 *   in-repo check have to stay in the text. The default CLI dump must keep
 *   excluding `auth` — that is why the procedure dumps `auth` on purpose.
 *
 * What this does not prove
 *   That a restore was run today, or that an offsite bucket exists. Those are
 *   the measured-scope paragraph and the operator's store, not this file.
 */

const operations = () => readFile(path.join(root, "docs", "OPERATIONS.md"), "utf8");
const security = () => readFile(path.join(root, "docs", "SECURITY.md"), "utf8");
const checkSql = () => readFile(path.join(root, "scripts", "backup-restore-check.sql"), "utf8");
const roundtrip = () => readFile(path.join(root, "scripts", "backup-roundtrip.sh"), "utf8");

test("the operations table does not call an unstarted backup 設定済み", async () => {
  const text = await operations();
  assert.match(text, /\| データベース \| 未接続 \|/u);
  assert.match(text, /\| バックアップ \| 方針確定。実施は DB 接続後 \|/u);
  assert.doesNotMatch(text, /\| バックアップ \| 設定済み \|/u);
  assert.doesNotMatch(text, /\| バックアップ \| 未設定 \|/u);
});

test("the locked means, store, retention, and check stay in OPERATIONS", async () => {
  const text = await operations();
  assert.match(text, /managed daily backup も PITR も無い/u);
  assert.match(text, /オフサイト論理 dump/u);
  assert.match(text, /S3 互換/u);
  assert.match(text, /運用開始前の保持は \*\*0\*\*/u);
  assert.match(text, /暫定目安は RPO 24 時間、RTO 4 時間/u);
  assert.match(text, /scripts\/backup-restore-check\.sql/u);
  assert.match(text, /scripts\/backup-roundtrip\.sh/u);
  assert.match(text, /GitHub Actions artifact/u);
  assert.match(text, /既定の schema dump は `app` と `private` だけ/u);
  assert.match(text, /既定 data dump（`--data-only --use-copy`）は `auth\.users`/u);
  assert.match(text, /コミュニティ Postgres の空クラスタへは戻せない/u);
  assert.match(text, /同じ公式イメージの空インスタンス/u);
  assert.match(text, /source と restored \| 一致/u);
  assert.doesNotMatch(text, /s3:\/\//iu);
  assert.doesNotMatch(text, /r2\.cloudflarestorage/iu);
});

test("SECURITY's account table does not grow a backup row in this issue", async () => {
  const text = await security();
  assert.match(text, /\| Supabase \| project ref `ivsauhjnoiurpsriskqe` \|/u);
  assert.doesNotMatch(text, /\| バックアップ \|/u);
  assert.doesNotMatch(text, /\| オブジェクト保管 \|/u);
});

test("the restore check walks the catalog instead of a frozen table list", async () => {
  const sql = await checkSql();
  assert.match(sql, /pg_class/u);
  assert.match(sql, /pg_constraint/u);
  assert.match(sql, /nspname in \('app', 'private'\)/u);
  assert.match(sql, /to_regclass\('auth\.users'\)/u);
  assert.match(sql, /fk_orphan_total/u);
  assert.match(sql, /assignment_allocation_sum/u);
  assert.match(sql, /memberships_by_role/u);
  assert.doesNotMatch(sql, /create table app\./u);
});

test("the roundtrip script dumps --local and refuses a hosted target", async () => {
  const sh = await roundtrip();
  assert.match(sh, /db dump --local/u);
  assert.match(sh, /--linked\|--project-ref\|--db-url/u);
  assert.match(sh, /dumps --local only/u);
  assert.match(sh, /backup-restore-check\.sql/u);
  assert.doesNotMatch(sh, /db dump --linked/u);
  assert.doesNotMatch(sh, /db dump --project-ref/u);
  assert.doesNotMatch(sh, /actions\/upload-artifact/u);
});

test("the measured dump range stays written as fact, not as app-only paper", async () => {
  const text = await operations();
  assert.match(text, /既定 schema dump \| 成功。作る schema は `app` と `private` だけ/u);
  assert.match(text, /既定 data dump \| 成功。`app` 41 本と `auth` 5 本/u);
  assert.match(text, /コミュニティ `postgres:17` の空クラスタへ schema\.sql \| 失敗/u);
  assert.doesNotMatch(text, /app スキーマだけを dump すれば足りる/u);
});
