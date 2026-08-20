# MOSAIC 運用手順

この文書は、MOSAICのフロントエンド、GitHub Pages、将来接続するSupabaseを安全に運用するための手順です。2026-08-17時点ではGitHub Pagesのみ稼働しており、Supabaseは未接続です。Supabase設定がないビルドはデモデータとブラウザ内保存へフォールバックします。

## 運用対象

| 対象 | 現在の状態 | 正典 |
| --- | --- | --- |
| フロントエンド | GitHub Pagesで公開 | `main`ブランチ |
| CI | lint、テスト、build、npm audit、CodeQL | `.github/workflows/ci.yml` |
| Pagesデプロイ | `main`へのpushまたは手動実行 | `.github/workflows/deploy-pages.yml` |
| データベース | 未接続 | 接続後は`supabase/migrations/` |
| バックアップ | 未設定 | 接続するSupabaseプランと本書の運用記録 |

公開URL: <https://syuto33004b1-collab.github.io/MOSAIC/>

## 環境

| 環境 | 用途 | データ |
| --- | --- | --- |
| local | 開発・単体確認 | デモまたは開発専用Supabase。実データ禁止 |
| pull request | CIのみ | Supabase変数を渡さず、デモフォールバックで検証 |
| production | GitHub Pages | 本番Supabase。認証済み利用者だけが業務データを参照 |

GitHub Repository Variablesには次を設定します。

| 名前 | 内容 | 秘密情報か |
| --- | --- | --- |
| `VITE_SUPABASE_URL` | 本番プロジェクトのAPI URL | いいえ |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | 有効なpublishable key | いいえ。ただしローテーション対象 |
| `VITE_REQUIRE_SHARED_MODE` | 本番切替後は`true`。接続値欠落時のデモ公開を禁止 | いいえ |

`VITE_*`は生成されたJavaScriptへ含まれ、誰でも閲覧できます。`service_role`、secret key、DBパスワード、Supabase access tokenをRepository VariablesやPagesビルドへ渡してはいけません。

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
5. `Deploy MOSAIC to GitHub Pages`と自動HTTP到達確認が成功したこと、デプロイ対象SHAを確認します。
6. 次のスモークテストを実行し、結果と実行者をリリース記録へ残します。

## デプロイ後スモークテスト

- 公開URLとJavaScript/CSS assetがHTTP 200で返る。
- 未ログイン状態で業務データが表示されない。
- ログイン、ログアウト、セッション復元が成功する。
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
3. CI通過後にmergeし、Pagesを再デプロイします。
4. スモークテストを再実行します。

### データベース

- 通常のアプリ不具合でDB全体をrestoreしません。データ消失を伴わないforward-fix migrationを優先します。
- column/table削除は、旧アプリが参照しなくなったことと保持期間を確認した別リリースで行います。
- restoreはデータ破損・消失時の最終手段です。restore対象時刻、失われる更新、利用者への影響を承認者と確認します。

## バックアップと復旧訓練

Supabase接続前に、業務責任者がRPOとRTOを決定します。初期目安はRPO 24時間、RTO 4時間ですが、要員配置業務の締切に合わせて短縮します。

- 契約プランで利用できるmanaged backupとPITRの範囲・保持期間を確認します。
- 日次の論理バックアップを、Supabaseとは別のprivateかつ暗号化された保管先へ保存します。
- 例として日次30日、月次12か月を保持し、個人情報の保持方針と整合させます。
- バックアップ成功だけでなく、四半期ごとに隔離環境へrestoreし、件数、外部キー、代表的な集計を照合します。
- GitHub Actions artifactやブラウザの`localStorage`をDBバックアップとして扱いません。

## 監視

最低限、次をアラート対象にします。

- Pagesの到達性、主要assetの404、直近デプロイ失敗
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
- `github-pages` environmentのdeployment branchを`main`に限定し、本番運用開始後は承認者を設定する。
- Dependabot alerts/security updates、secret scanning、push protectionを有効にする。
- ActionsはGitHub製または承認済みactionへ限定し、full commit SHA pinを必須にする。
- 管理者bypassは緊急時だけ使い、理由と事後レビューを残す。
