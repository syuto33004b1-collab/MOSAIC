# Supabase セットアップ

この文書はMOSAICを共有データ運用へ切り替える際の手順です。Supabaseが未設定の場合、アプリはデモフォールバックで起動します。デモ表示を本番データの読込成功と誤認しないでください。

## 前提

- 本番・開発で別のSupabaseプロジェクト、またはデータを共有しないSupabase Branchを使う。
- 本番projectの作成、費用、region、organizationは業務責任者の承認後に決める。
- CLIはrepositoryに固定されたversionを使い、実行前にhelpを確認する。
- 公開repositoryへ本物の顧客・従業員データをseedしない。

```powershell
npm ci
npm exec supabase -- --version
npm exec supabase -- link --help
npm exec supabase -- db push --help
```

## フロントエンド環境変数

ローカルではGit管理対象外の`.env.local`を使います。

```dotenv
VITE_SUPABASE_URL=https://PROJECT_REF.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_REPLACE_ME
VITE_APP_ENV=development
VITE_REQUIRE_SHARED_MODE=false
```

GitHub Pagesでは同じ2つの接続値をRepository Variablesとして設定します。publishable keyはブラウザへ公開される前提のkeyです。安全性はkeyの秘匿ではなく、Auth、RLS、明示的な権限で担保します。

接続確認とrole別試験が完了した本番切替時に、Repository Variable `VITE_REQUIRE_SHARED_MODE=true`を追加します。以後はURL/keyが欠けたbuildをデモへフォールバックさせず、デプロイを失敗させます。切替前の公開デモでは空または`false`のままにします。

次はフロントエンドへ設定してはいけません。

- `service_role` key、secret key
- DB password、connection string
- `SUPABASE_ACCESS_TOKEN`
- SMTP、外部API、webhookのsecret

## Auth URL

Supabase AuthのSite URLと許可redirect URLを、実際に利用するURLへ限定します。

- Production Site URL: `https://syuto33004b1-collab.github.io/MOSAIC/`
- Production redirect: `https://syuto33004b1-collab.github.io/MOSAIC/`
- Local redirect: `http://127.0.0.1:5173/MOSAIC/`

パスワード再設定メールと招待メールの戻り先も、この許可リストのURLだけを使います。MOSAICは現在のoriginと`base`（`/MOSAIC/`）からredirect URLを組み立て、独自のpathは使いません。GitHub PagesのSPAでも同じトップURLへ戻します。

接続後に次を確認します。

1. Authentication > URL Configuration のSite URLとRedirect URLsが上表と一致する。
2. Email providerが有効で、本番はSMTPが設定されている。
3. ログイン画面の「パスワードを忘れた場合」から再設定メールが届く。
4. 有効なリンクから新しいパスワードを設定してログインできる。
5. 運用パネルの「招待メールを送る」から招待メールが届く。
6. 招待リンクから表示名と初回パスワードを設定すると、対象組織へ入れる。
7. 期限切れの招待・再設定リンクは「有効期限が切れています」と案内し、providerの英語エラー文を出さない。
8. 既存Authアカウントへの招待は組織招待だけを更新し、ログイン後に承認できる。

不要なwildcardや第三者domainを追加しません。独自domainへ移行した場合は、切替期間を決めて旧URLを削除します。

Authentication設定では、Email providerの`Allow new users to sign up`を無効にします。画面から登録導線を隠すだけでは招待制にならないため、publishable keyを使った`signUp`もserver側で拒否されることを接続後テストで確認します。`supabase/config.toml`もローカル環境で`auth.enable_signup = false`、`auth.email.enable_signup = false`に固定しています。

初期ownerは、Supabase DashboardのAuthentication > Usersから招待するか、secretを保持できる信頼済みbackendからAdmin APIで作成します。2人目以降はMOSAICの運用パネルから招待します。招待Edge Function `invite` が組織RPC `invite_member` を実行したあと、サーバー側のAdmin APIでAuth招待メールを送ります。Admin APIや`service_role`をMOSAICのブラウザへ追加してはいけません。公開の自己サインアップは無効のままです。

招待メールを使う場合は本番SMTP、送信元domain、リンク期限、password resetを先に検証します。GitHub Pagesのデプロイはフロントエンドだけを更新するため、Function本体は別にデプロイします。`--no-verify-jwt`は付けません。

```powershell
npm exec supabase -- functions deploy invite --project-ref PROJECT_REF
```

hosted Functionには`SUPABASE_URL`と`SUPABASE_SERVICE_ROLE_KEY`が自動で入ります。値をlogやartifactへ出しません。

## Migration適用

本番操作はGitHubのprotected environment `production-db`から行い、少なくとも次をsecretとして管理します。

| 名前 | 用途 |
| --- | --- |
| `SUPABASE_ACCESS_TOKEN` | CLIのManagement API認証 |
| `SUPABASE_PROJECT_REF` | 対象projectの識別 |
| `SUPABASE_DB_PASSWORD` | link/db pushで必要な場合のみ |

適用前に対象project refを読み上げ確認し、dry runとmigration一覧を保存します。

```powershell
npm exec supabase -- link --project-ref PROJECT_REF
npm exec supabase -- db push --dry-run
npm exec supabase -- db push
npm exec supabase -- migration list
```

対話入力や環境変数からsecretを渡し、コマンドライン、workflowの`echo`、artifactへsecretを出力しません。Supabase未接続の現在は、上記の本番コマンドを実行してはいけません。

## API境界とRLS

MOSAICの業務tableはData APIへ直接公開せず、`app` schemaへ置きます。browserから呼べる正式な契約は、`public` schemaに置いた限定的なRPCだけです。`private` schemaは認可helper専用です。`app`と`private`をData APIのexposed schemasへ追加せず、tableへの直接DML権限を付与しません。

RealtimeのRLS評価に必要な例外として、`authenticated`には`app.organizations`のSELECTと、呼出者自身のmembershipだけを検査する`private.has_org_role`、`private.is_org_member`、`private.current_email`のEXECUTEを付与します。これらを一般的なquery APIとして利用しません。その他の業務table DMLはREVOKEした状態を維持します。

公開RPCは次の契約です。

- `get_my_context`
- `create_organization(p_name, p_request_id)`
- `get_workspace`
- `save_workspace`
- `invite_member`
- `update_my_profile`
- `accept_invitation`
- `list_organization_members`
- `manage_organization_member`
- `list_organization_invitations`
- `revoke_organization_invitation`
- `list_audit_events`

組織作成とワークスペース保存はclient生成のrequest IDを受け取り、応答だけが失われた再送でも同じ結果を返します。request IDを変えて機械的に再送しません。招待取消と同じアクセス状態への変更は、すでに目的状態ならrevisionを増やさないno-opとして返します。

新しいSupabase projectでは、tableがData APIへ自動公開されない場合があります。MOSAICではこれを緩和するためにtableをGRANTせず、必要なRPCだけを明示GRANTします。RLSとRPC内の認可checkは防御を重ねるために併用します。

全ての業務tableとRPCで次を確認します。

- `organization_id`を保持し、ログイン利用者の所属組織と一致するrowだけを許可する。
- `TO authenticated`だけで許可せず、必ず組織membershipとroleを条件にする。
- 将来、直接table UPDATEを追加する場合は`USING`と`WITH CHECK`の両方を設定する。現行は直接DMLを許可しない。
- 権限判定に利用者が変更できる`user_metadata`を使わない。roleはDBまたは`app_metadata`で管理する。
- viewは`security_invoker = true`を使うか、公開schemaへ置かない。
- `SECURITY DEFINER`関数は原則避ける。必要な場合は非公開schema、`auth.uid()`検証、限定的なEXECUTE権限を組み合わせる。
- audit logは通常利用者からUPDATE/DELETEできないようにする。

## Role

| Role | 許可する操作 |
| --- | --- |
| `owner` | 組織設定、他利用者のrole変更・利用停止を含む全操作 |
| `admin` | planner/viewerの招待と利用停止/再開、業務メンバー、project、assignment、staffing needの管理 |
| `planner` | project、assignment、staffing needの計画・更新 |
| `viewer` | 所属組織の閲覧のみ |

UIでbuttonを隠すだけでは認可になりません。全ての書込みをRLSまたは認証済みRPCで同じ規則により拒否します。

## 初期利用者

最初のownerは認証済み利用者が`create_organization`を実行して作成します。以後はowner/adminが運用パネルから招待し、Edge Functionが`invite_member`とAuth招待メールを同じ操作で実行します。招待先はメールのリンクから表示名と初回パスワードを設定し、保留中の組織招待を承認して対象組織へ入ります。誤った宛先は運用パネルの取消、または`revoke_organization_invitation`で取り消します。再送は同じ招待操作の再実行です。メールアドレスだけを根拠にroleを直接付与しません。既存のAuthアカウントには新しいAuth userを作らず、組織招待の承認へ誘導します。

退職・長期休職時は、最後のownerでないことを確認して`manage_organization_member`でmembershipを`suspended`へ変更し、保留中の同一メール招待が取り消されたことを確認します。その後、Supabase Auth側でsessionを失効します。所属履歴が残るAuth userの物理削除はFKで拒否されるため、membershipを直接DELETEしません。owner本人の変更は別のactive ownerが実施します。

## 接続後の検証

最低限、2組織と各roleのテスト利用者を用意して検証します。

1. 同じ組織内の読取・許可された更新が成功する。
2. viewerのINSERT/UPDATE/DELETEが拒否される。
3. RPC引数のorganization IDを他組織へ変えても取得・更新できない。
4. plannerがowner/admin roleを付与できない。
5. UPDATEで`organization_id`を別組織へ変更できない。
6. 保存RPCのrevision不一致が上書きせず競合を返す。
7. `list_audit_events`でactor、対象、変更前後、時刻、request IDを確認でき、通常利用者からaudit rowを変更できない。
8. logoutまたはsession失効後の古いtokenで機密操作できない。
9. 公開publishable keyから未招待メールで`signUp`してもAuth userを作成できない。
10. adminはowner/他adminのroleを変更できず、ownerだけがroleを変更できる。
11. 最後のactive ownerを降格・停止できず、suspended利用者は既存tokenでも業務RPCを実行できない。
12. 他組織の招待IDを一覧・取消できず、取り消した招待を受諾できない。
13. 同じrequest IDで組織作成・保存を再送しても重複rowやrevision増加が発生しない。

Realtimeは各業務tableをbrowserへ直接公開せず、`app.organizations.workspace_revision`の更新通知だけを利用します。foundation migrationは`app.organizations`だけを`supabase_realtime` publicationへ追加します。適用後にpublicationとRLSを確認してください。通知を受けたclientは`get_workspace`で再読込し、編集中なら自動上書きせず競合として表示します。

Schema変更後はSupabaseのsecurity/performance advisorも確認します。警告を無視する場合は、理由、影響、期限、担当者を記録します。

## 現行仕様に関係する変更情報

- [Supabase: Securing your API](https://supabase.com/docs/guides/api/securing-your-api)
- [Supabase: Tables not exposed to Data API automatically](https://supabase.com/changelog/45329-breaking-change-tables-not-exposed-to-data-and-graphql-api-automatically)
- [Supabase CLI](https://supabase.com/docs/reference/cli/introduction)
- [Supabase Auth general configuration](https://supabase.com/docs/guides/auth/general-configuration)
- [Supabase Auth redirect URLs](https://supabase.com/docs/guides/auth/redirect-urls)
