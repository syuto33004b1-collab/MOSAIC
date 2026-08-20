# MOSAIC セキュリティ方針

## 対象と基本方針

MOSAICのsourceと静的フロントエンドはpublicです。source、schema、publishable keyが見えることを前提に、業務データはSupabase Auth、非公開schema、限定RPC、RLSで保護します。sourceが非公開であることに依存した認可は行いません。

人員、所属、稼働率、project計画は社内限定情報として扱います。public repository、issue、Actions log、テストfixture、スクリーンショットへ実データを置いてはいけません。

## 現在の境界

- GitHub Pagesは静的フロントエンドです。server-side secretを保持できません。
- Supabase未接続時はデモデータとブラウザ内保存だけを使います。実運用データを`localStorage`へ保存しません。
- GitHub Pagesでは任意のHTTP security headerを設定できません。現行buildはmeta CSPを生成し、`connect-src`を設定済みSupabase originへ限定します。`frame-ancestors`などHTTP headerでしか強制できない要件がある場合は、headerを制御できるCDN/hostingへ移行します。

## 認証と認可

- 全ての業務画面とData API accessで有効なsessionを要求する。
- organization membershipと`owner`、`admin`、`planner`、`viewer` roleをDB側で検証する。
- 業務tableは`app` schemaへ置き、browserには`public`の限定RPCだけを公開する。
- RLSを全ての業務tableへ有効化し、組織を跨ぐ読取・更新を拒否する。
- `user_metadata`を認可に使わない。
- UPDATE policyには`USING`と`WITH CHECK`を設定する。
- 機密操作は短いJWT有効期間、session失効、必要に応じたsession ID確認を検討する。
- 利用者削除だけで既発行tokenが即時無効になると仮定しない。退職・権限剥奪時はsessionを失効する。
- 最後のownerを停止・降格しない。退職者はmembershipを物理削除せず`suspended`にし、同じメールの保留招待も取り消す。

## Secret管理

- ブラウザへ渡せるのはSupabase URL、publishable key、公開monitoring IDだけです。
- 本番URLでは`sb_publishable_` keyだけを受理し、secret keyとlegacy service-role JWTは起動前に拒否する。
- `service_role`、secret key、DB password、access tokenはGitHub Environment Secretsまたは提供元のsecret storeで管理する。
- secretをsource、`.env.example`、PR本文、issue、log、artifactへ書かない。
- 漏えい時はGit履歴から消すことだけで済ませず、必ず提供元で失効・rotationする。
- production secretへのアクセスは最小人数とし、四半期ごとに棚卸しする。

## GitHubとsupply chain

- `main`はpull requestと必須CIを通して更新する。
- workflow permissionはjob単位の最小権限にする。
- Actionsはfull commit SHAへpinし、Dependabotで更新する。
- npm packageはlockfileへ固定し、`npm ci`、`npm audit --audit-level=high`をCIで実行する。
- Dependabot alerts/security updates、CodeQL、secret scanning、push protectionを有効にする。
- 外部forkのworkflowへproduction secretを渡さない。

## アプリケーション安全性

- ID、allocation、date、role、organization IDをserver側で再検証する。
- 同時編集はrevisionまたはversionで検出し、後勝ち上書きを避ける。
- 管理操作とassignment変更をappend-only audit logへ記録する。
- API roleには業務tableの直接DMLを付与せず、`service_role`も公開RPCのrevision・監査境界を迂回する通常運用に使わない。
- HTMLへ利用者入力を直接挿入しない。Reactのescapeを迂回するAPIはsecurity review対象とする。
- 外部URL、CSV export、将来のfile uploadには許可list、content type、size制限を設ける。
- 外部APIは`mosaic_sk_`資格とカタログ操作だけを受け付ける。利用者JWTと任意RPCは拒否する。
- Webhook先はhttpsの公開アドレスに限り、localhostとプライベートIPを拒否する。署名シークレットは発行時以外表示しない。
- error表示へtoken、SQL、個人情報、内部ID一覧を含めない。

## ログとデータ保持

- security logにはactor、organization、action、対象、結果、時刻、request IDを記録する。
- password、token、session cookie、DB connection stringを記録しない。
- audit logと業務データの保持期間、削除要求、法的保全を会社方針に合わせる。
- 監視providerへ送信する個人情報を最小化し、契約地域と保持期間を確認する。

## 脆弱性報告

脆弱性、token、個人情報をpublic issueへ投稿しないでください。repositoryでPrivate Vulnerability Reportingを有効にし、次の非公開窓口を使います。

<https://github.com/syuto33004b1-collab/MOSAIC/security/advisories/new>

報告には、影響するcommitまたはURL、再現手順、想定影響を含めます。実データ、利用者token、破壊的なPoCは添付しません。

## インシデント対応

1. 影響範囲を限定し、必要なら書込みまたは公開を停止する。
2. Actions、Auth、API、Postgres、audit logを改変せず保全する。
3. 漏えいしたkeyを失効し、関連sessionを無効化する。
4. 他組織access、誤更新、持出しの件数を根拠とともに確認する。
5. 復旧後に再発防止、利用者通知、法務・社内規程上の対応を判断する。

詳細なデプロイ、復旧、backup手順は[`OPERATIONS.md`](./OPERATIONS.md)、Supabase接続とRLS検証は[`SUPABASE_SETUP.md`](./SUPABASE_SETUP.md)を参照してください。
