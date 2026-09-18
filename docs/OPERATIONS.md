# MOSAIC 運用手順

この文書は、MOSAICのフロントエンドとSupabaseを安全に運用するための手順です。フロントエンドの本番公開先は Cloudflare Workers です。GitHub Pages の成果物は切替期間中だけ残し、新しいビルドは載せません。Supabase設定がないビルドはデモデータとブラウザ内保存へフォールバックします。

## 運用対象

| 対象 | 現在の状態 | 正典 |
| --- | --- | --- |
| フロントエンド | Cloudflare Workers（`mosaic`）で公開 | `main`ブランチ |
| CI | lint、テスト、build、npm audit、CodeQL | `.github/workflows/ci.yml` |
| 本番デプロイ | `main`へのpush、または`main`からの手動実行 | `.github/workflows/deploy-cloudflare.yml` |
| データベース | 未接続 | 接続後は`supabase/migrations/` |
| バックアップ | 方針確定。実施は DB 接続後 | 本書と `scripts/backup-roundtrip.sh` |

公開URL: <https://mosaic.taps-desk.workers.dev/>。旧 URL <https://syuto33004b1-collab.github.io/MOSAIC/> は凍結。

## 環境

| 環境 | 用途 | データ |
| --- | --- | --- |
| local | 開発・単体確認 | デモまたは開発専用Supabase。実データ禁止 |
| pull request | CIのみ | Supabase変数を渡さず、デモフォールバックで検証 |
| production | Cloudflare Workers | 本番Supabase。認証済み利用者だけが業務データを参照 |

GitHub Repository Variablesには次を設定します。

| 名前 | 内容 | 秘密情報か |
| --- | --- | --- |
| `VITE_SUPABASE_URL` | 本番プロジェクトのAPI URL | いいえ |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | 有効なpublishable key | いいえ。ただしローテーション対象 |
| `VITE_REQUIRE_SHARED_MODE` | 本番切替後は`true`。接続値欠落時のデモ公開を禁止 | いいえ |
| `VITE_ENABLE_GOOGLE_AUTH` | `true`のときだけログイン画面に Google ボタンを出す。未設定と`false`は非表示 | いいえ |

`VITE_*`は生成されたJavaScriptへ含まれ、誰でも閲覧できます。`service_role`、secret key、DBパスワード、Supabase access tokenをRepository Variablesやフロントエンドのビルドへ渡してはいけません。

2つのSupabase変数が両方空で`VITE_REQUIRE_SHARED_MODE`が`false`または未設定なら、デモフォールバックを公開できます。本番切替後は`VITE_REQUIRE_SHARED_MODE=true`に固定します。片方だけ設定されている、URLがHTTPSではない、keyが`sb_publishable_`形式ではない、または必須共有モードで接続値が空の場合、デプロイworkflowは公開前に失敗します。

## 通常のリリース

1. featureブランチで変更し、次を実行します。

   ```powershell
   npm ci
   npm run lint
   npm test
   npm audit --audit-level=high
   ```

2. pull requestを作成し、`Quality gate`と`Database policy tests`を必須チェックとして通します。依存変更がある場合は`Dependency review`も確認します。
3. DB変更がある場合は、後方互換なmigrationを先に適用します。破壊的変更はexpand/contract方式で複数リリースに分けます。
4. 承認後に`main`へmergeします。直接pushは禁止します。
5. `Deploy MOSAIC to Cloudflare`と自動HTTP到達確認が成功したこと、デプロイ対象SHAを確認します。deploy job は `main` だけで走ります。Environment `cloudflare` に `CLOUDFLARE_API_TOKEN` と `CLOUDFLARE_ACCOUNT_ID` が無いと失敗します。デプロイの前に、Environment の account ID が意図した社用アカウントであることをダッシュボードで照合してください。account ID はリポジトリの文書に書きません。公開 URL は <https://mosaic.taps-desk.workers.dev/> です。招待 allowlist と Hosted Auth の Redirect URLs は公開ホストを exact で許可する（#355）。OG / twitter:image はまだ旧 Pages（別 Issue）。Hosted Auth の Site URL は Pages を捨てる最後に付け替える。Cloudflare のデプロイはフロントだけを更新するので、`invite` の allowlist を変えたあとは Function を別にデプロイします。
6. 次のスモークテストを実行し、結果と実行者をリリース記録へ残します。

## デプロイ後スモークテスト

- 公開URLとJavaScript/CSS assetがHTTP 200で返る。
- 未ログイン状態で業務データが表示されない。
- ログイン、ログアウト、セッション復元が成功する。Google ログインを有効にしている環境では、招待済みアカウントの Google ログインと、未招待 Google の拒否も確認する。
- viewerは閲覧のみ、plannerはアサイン変更、admin/ownerは許可された管理操作ができる。
- owner/adminが運用パネルから招待メールを送信・再送・取消でき、停止済み利用者は再招待・再受諾で復帰できない。
- owner/adminが連携資格とWebhook URLを発行・失効でき、秘密鍵は再表示されない。
- 既存Authアカウントへの招待はログイン後の「届いている招待」から承認できる。
- 異なる組織のIDをRPC引数へ渡しても取得・更新できない。
- アサインを仮置き、保存、再読込し、同じ結果が表示される。
- 同じrevisionを別ブラウザで更新した場合、後勝ち上書きではなく競合として扱われる。
- 主要画面をPC幅とモバイル幅で操作できる。
- ブラウザコンソール、監視、Supabaseログに新規エラーがない。

## ロールバック

### フロントエンド

1. 書込み障害がある場合は、可能ならUIを読取り専用へ切り替えます。
2. 不具合commitを`git revert`するpull requestを作成します。履歴のforce pushや`reset --hard`は使いません。
3. CI通過後にmergeし、Cloudflare Workersを再デプロイします。凍結した GitHub Pages は新しい修正を受けません。
4. スモークテストを再実行します。

### データベース

- 通常のアプリ不具合でDB全体をrestoreしません。データ消失を伴わないforward-fix migrationを優先します。
- column/table削除は、旧アプリが参照しなくなったことと保持期間を確認した別リリースで行います。
- restoreはデータ破損・消失時の最終手段です。restore対象時刻、失われる更新、利用者への影響を承認者と確認します。

## バックアップと復旧訓練

方針は #416 で固定。本番 DB への実施は、上表のデータベースが「未接続」のあいだ行わない。運用対象表は「設定済み」にしない。

### 決定

| 項目 | 内容 |
| --- | --- |
| 手段 | オフサイト論理 dump（`supabase db dump` / `pg_dump`）。組織プランは Free。Free には managed daily backup も PITR も無い（[Database Backups](https://supabase.com/docs/guides/platform/backups)） |
| 保管先 | 本番 Supabase プロジェクトとは**別アカウント**の、private かつサーバーサイド暗号化されたオブジェクト保管（S3 互換）。サービス種別まで書く。契約したバケット名・アカウント ID・パスはリポジトリに書かない。SECURITY のアカウント境界表への追記は、実体が決まってから別 Issue |
| 保持 | 運用開始前の保持は **0**。起点は運用開始日。開始後の目安は日次 30 日・月次 12 か月。個人情報の保持方針と整合させる |
| RPO / RTO | 暫定目安は RPO 24 時間、RTO 4 時間。決裁は業務責任者。要員配置の締切に合わせて短縮する |
| 照合 | 隔離した DB へ restore したあと `scripts/backup-restore-check.sql` を走らせ、ソースと fingerprint を `diff` する。四半期訓練も同じ |
| 禁止 | GitHub Actions artifact、ブラウザの `localStorage`、アプリ UI からのバックアップ。`cron` / Actions / Function による自動化は今段の対象外 |

dump は `--local`、または照合済みの `--project-ref ivsauhjnoiurpsriskqe` だけを使う。link された project に任せない。接続先の照合は[セキュリティ方針のアカウント境界](SECURITY.md#アカウント境界)。

### 手順（接続後）

1. 保管先は上の条件を満たすオブジェクト保管へ、dump ファイルと同時に fingerprint（`scripts/backup-restore-check.sql` の出力）を置く。
2. 取得は次の2ファイル。CLI 2.117.0 の実測では、既定の schema dump は `app` と `private` だけで `auth` の DDL を含まない。同じ CLI の既定 data dump（`--data-only --use-copy`）は `auth.users` ほか auth の data を含む。restore 先は **platform schema（`auth` / `extensions`）が既にある** Supabase 形の空 DB である。コミュニティ Postgres の空クラスタへは戻せない。

   ```bash
   npm exec supabase -- db dump --project-ref ivsauhjnoiurpsriskqe -f schema.sql
   npm exec supabase -- db dump --project-ref ivsauhjnoiurpsriskqe -f data.sql --use-copy --data-only
   ```

3. 隔離した Supabase 形の空 DB へ、schema.sql → `SET session_replication_role = replica` のうえ data.sql の順で戻す。`--schema auth` の DDL dump は、現行イメージの `auth` より古い部分集合であり、成功した経路では使わない。推測で「app だけ」と決めない。
4. 戻した DB で `scripts/backup-restore-check.sql` を走らせ、取得時の fingerprint と一致することを確認する。`fk_orphan_total` が 0 であること、件数と代表集計が一致することが合格。
5. ローカルでの再現は `scripts/backup-roundtrip.sh`。`--linked` / `--project-ref` / `--db-url` は拒否する。本番は踏まない。

### ローカル実測（#416、2026-09-18）

ソース: `public.ecr.aws/supabase/postgres:17.6.1.167`（Postgres 17.6）へ現行 migration を適用し、`scripts/backup-roundtrip-seed.sql` を入れた。CLI はリポジトリ固定の supabase 2.117.0。`supabase start` / `db start` はこの環境で realtime 初期化に失敗したので、同じ公式イメージを直接起動した。

| 操作 | 結果 |
| --- | --- |
| 既定 schema dump | 成功。作る schema は `app` と `private` だけ。`auth.users` の DDL は無い |
| 既定 data dump | 成功。`app` 41 本と `auth` 5 本（`users` を含む） |
| `--schema auth` の schema dump | 成功。`users` / `audit_log_entries` / `instances` / `refresh_tokens` / `schema_migrations` の古い部分集合 |
| コミュニティ `postgres:17` の空クラスタへ schema.sql | 失敗。`schema "extensions" does not exist` |
| 同じ公式イメージの空インスタンス（`auth` あり、`app` なし）へ schema.sql + data.sql | 成功 |
| `scripts/backup-restore-check.sql` の source と restored | 一致。`fk_orphan_total` は 0。`auth.users` 2、`app.organization_memberships` 2、`app.assignments` 1、allocation 合計 40 |

GRANT / publication / `supabase_realtime` は CLI が schema dump から削る。fingerprint は件数・FK・代表集計であり、権限や publication の復帰は見ていない。

## 監視

最低限、次をアラート対象にします。

- Workersの到達性、主要assetの404、直近デプロイ失敗
- JavaScript例外、画面の読込失敗、保存失敗、競合率
- Supabase Auth/API/Postgresのエラー率とレイテンシ
- DB容量、接続数、長時間query、backup失敗
- 短時間の大量ログイン失敗、権限拒否の急増

通知先、一次対応者、業務責任者、連絡可能時間を別の社内連絡網に記録します。個人のメールアドレスや電話番号はpublic repositoryへ置きません。

## 障害対応

1. 発見時刻、影響範囲、直近SHA、migration versionを記録します。
2. 情報漏えいまたは誤更新の疑いがあれば、関連操作を停止し、ログを保全します。
3. service側のkey漏えいはkey rotation、該当sessionの失効、CIログとGit履歴の確認を行います。
4. フロントエンドとDBのどちらが原因かを分離します。
5. 復旧後にスモークテストを行い、原因、影響、恒久対策を記録します。

## 定期作業

| 頻度 | 作業 |
| --- | --- |
| リリースごと | CI、migration確認、スモークテスト、deployment SHA記録 |
| 週次 | Dependabot PR、失敗workflow、監視alertの確認 |
| 月次 | dependency更新、Supabase advisor、利用量、backup結果の確認 |
| 四半期 | restore訓練、権限棚卸し、不要session/keyの失効 |
| 年次 | RPO/RTO、データ保持、インシデント手順の見直し |

## オンボーディングとオフボーディング

- 2人目以降はowner/adminが運用パネルから招待する。MOSAICのEdge Functionが組織招待とAuth招待メールを送る。`service_role`はブラウザへ置かない。
- 誤招待は運用パネルの「保留中の招待」から即時取消し、期限切れを放置しない。取消は組織招待だけを無効にする。未確認のAuth userが残った場合はDashboardで確認する。
- 招待リンク期限切れは運用パネルの「再送」でAuthメールを再送する。確認済みアカウントは新しいAuth userを作らず、本人がログインして「届いている招待」を承認する。
- 退職時は別のownerによるowner移管、membershipの利用停止、保留招待の取消、Auth session失効の順に実施します。
- Auth userの物理削除やmembership tableの直接DMLをオフボーディング手順として使いません。監査・所属履歴の保持期間を決めたcleanupは、将来の専用migration/RPCとして別途レビューします。

## GitHub設定の必須項目

- `main`にrulesetを作り、pull request、`Quality gate`、force-push禁止、削除禁止を必須にする。CodeQLはpushと週次scheduleで実行する。
- `cloudflare` environmentのdeployment branchを`main`に限定し、本番運用開始後は承認者を設定する。凍結した `github-pages` は新しい成果物を載せない。
- Dependabot alerts/security updates、secret scanning、push protectionを有効にする。
- ActionsはGitHub製または承認済みactionへ限定し、full commit SHA pinを必須にする。
- 管理者bypassは緊急時だけ使い、理由と事後レビューを残す。
