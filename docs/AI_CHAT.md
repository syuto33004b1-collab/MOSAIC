# MOSAIC AIチャット

MOSAICのAIチャットは、認証済み利用者が画面の機能や操作方法を自然言語で確認し、現在の共有データを参照・更新できるAI秘書です。ブラウザからGemini APIを直接呼ばず、Supabase Edge Functionを境界にしてAPIキー、権限確認、入力検証、確認付き操作、エラー処理をserver側へ閉じ込めます。

## 構成

```text
GitHub Pages上のMOSAIC
  └─ AIチャットUI
       └─ Supabase client（利用者のsession JWT）
            └─ POST https://PROJECT_REF.supabase.co/functions/v1/chat
                 └─ Supabase Edge Function（認証・検証・利用制限）
                      └─ Gemini Interactions API
```

公開経路は`/api/chat`ではなく、Supabaseが提供する`/functions/v1/chat`です。ローカルでは`http://127.0.0.1:54321/functions/v1/chat`、本番では`https://PROJECT_REF.supabase.co/functions/v1/chat`になります。フロントエンドはURLを組み立てず、既存のSupabase clientから`chat` Functionを呼び出します。

Geminiとの通信には、新規開発向けにGoogleが推奨している[Interactions API](https://ai.google.dev/gemini-api/docs/interactions-overview)を利用します。モデルは既定で安定版の[`gemini-3.7-flash`](https://ai.google.dev/gemini-api/docs/models/gemini-3.7-flash)を使い、応答と会話継続用のInteraction IDだけをブラウザへ返します。

責務は次のfileへ分けています。

| File | 責務 |
| --- | --- |
| `src/components/ai-chat/AiChat.tsx` | 開閉、入力、履歴表示、送信状態、エラー表示 |
| `src/lib/ai/chatClient.ts` | 認証済みSupabase Functionの呼出しとresponse/errorの正規化 |
| `supabase/functions/chat/index.ts` | HTTP・Auth境界と処理の組立て |
| `supabase/functions/chat/contract.mjs` | request/responseの検証と公開契約 |
| `supabase/functions/chat/continuation.mjs` | 会話継続IDを利用者へ結び付ける署名・検証 |
| `supabase/functions/chat/action-token.mjs` | 確認内容、有効期限、利用者、組織を結び付ける署名・検証 |
| `supabase/functions/chat/gemini.mjs` | Gemini Interactions APIとの通信 |
| `supabase/functions/chat/prompt.mjs` | MOSAIC専用System Instruction |
| `supabase/functions/chat/rate-limit.mjs` | 利用者単位の送信制限 |
| `supabase/functions/chat/workspace-tools.mjs` | Geminiの許可済みtool、参照、変更計画、保存payloadの生成 |

通常メッセージは`kind: "message"`（省略可）、`organizationId`、`message`、画面上の最低限の`history`、任意の`previousInteractionId`と`hasLocalChanges`を受け取ります。確認操作は`kind: "action"`、`organizationId`、`actionToken`、`decision: "confirm" | "cancel"`を受け取ります。

成功responseは`reply`と`interactionId`を常に含みます。変更候補では`proposal`、保存成功時は`workspaceRevision`も返します。Gemini固有のsteps、生のInteraction ID、内部の保存payload、上流のエラー本文はブラウザ向け契約へ漏らしません。

## AI秘書が扱える操作

- 最新のメンバー、プロジェクト、アサイン、要員要件、受注前案件、稼働余力、過負荷、組織階層、保存検索シーン、保存レポートを参照する。
- メンバー、プロジェクト、アサイン、要員要件、受注前案件、要員計画を登録・編集する。
- 部門の追加・移動・削除と、メンバーの主所属・兼務・責任者を設定する。
- メンバーとプロジェクトをアーカイブし、アサインと要員要件を取り消す。
- 要員要件へ条件を満たすメンバーを割り当て、確定アサインを作成する。
- 受注前案件と要員計画を、確定プロジェクトと未充足の要員要件へ引き継ぐ。
- 検索シーンを作成・削除し、同じスコアリングで候補を並べる。
- 保存レポートを作成・削除し、同じ集計関数で件数と稼働を確認する。

参照toolはEdge Functionが`get_workspace`で取得した同一時点のsnapshotだけを読みます。書込toolはその場で保存せず、1回につき1件の変更案を作ります。利用者が確認cardで実行を選んだ後だけ、既存の`save_workspace` RPCへ保存します。招待、ログインユーザー作成、権限変更、組織設定はtool対象外です。

### 確認と保存の境界

AIの確認cardは、通常画面の「チームへ保存」に相当する最終保存確認です。確認後は画面上の一時draftへ追加するのではなく、共有workspaceへ直接保存されます。

- 画面に未保存変更がある間は、AIによる書込み候補を作らない。
- 確認情報はHMAC署名し、利用者、組織、権限revision、workspace revision、有効期限（5分）、固定request ID、payload hashへ結び付ける。
- 確認直前にmembership、role、access revision、workspace revisionを再検証する。
- 競合時はHTTP 409を返し、自動rebaseや古い内容の保存は行わない。最新データで依頼をやり直す。
- `save_workspace`は利用者JWTのRLS contextから1回だけ呼ぶ。`service_role`や管理者clientで権限を迂回しない。
- 固定request IDとpayload hashにより同じ操作の再送を冪等に扱い、既存RPCの監査logと整合性検証を利用する。

## 認証境界

`supabase/config.toml`の`functions.chat.verify_jwt`は`true`です。さらにFunction本体もSupabase Authの利用者認証を要求します。

- 共有モードへログイン済みの利用者だけが呼び出せる。
- Supabase clientはpublishable keyを`apikey` header、利用者のJWTを`Authorization: Bearer ...` headerへ設定する。
- JWTがない、期限切れ、または別projectのtokenである場合はGeminiを呼び出さない。
- `--no-verify-jwt`をローカル・本番とも使用しない。
- Gemini APIキー、Supabase secret key、`service_role` keyをブラウザへ渡さない。

headerの役割は[Supabase Authorization headers](https://supabase.com/docs/guides/functions/auth-headers)を参照してください。GitHub Pagesだけで動くデモモードは認証済みbackendを持たないため、AIチャットの運用対象外です。

## 環境変数

| 名前 | 必須 | 保存先 | 用途 |
| --- | --- | --- | --- |
| `GEMINI_API_KEY` | はい | Supabase Edge Function Secret | Gemini APIのserver-side認証 |
| `GEMINI_MODEL` | いいえ | Supabase Edge Function Secret | 既定の`gemini-3.7-flash`を明示的に切り替える場合だけ設定 |

Google AI Studioで新しいAuth keyを発行してください。新規keyはAuth keyが既定で、Standard keyは2026年9月に拒否される予定です。詳細は[Using Gemini API keys](https://ai.google.dev/gemini-api/docs/api-key)を参照してください。

これらはserver専用です。次の場所へ書いてはいけません。

- repository直下の`.env.example`または`.env.local`
- `VITE_`で始まる環境変数
- GitHub Repository Variables、Pages build、source、log、issue、PR本文

`.env.example`はブラウザへ組み込める公開値の例だけを扱うため、`GEMINI_API_KEY`もダミー値も追加しません。本番secretは[Supabase Edge Function Secrets](https://supabase.com/docs/guides/functions/secrets)で管理します。

## ローカル実行

Dockerを起動し、repositoryに固定されたSupabase CLIを使います。最初にversionとhelpを確認します。

```powershell
npm ci
npm exec supabase -- --version
npm exec supabase -- functions serve --help
npm exec supabase -- secrets set --help
```

Git管理対象外の`supabase/functions/.env.local`を作り、開発専用のkeyを設定します。

```dotenv
GEMINI_API_KEY=開発用のAuth key
# 任意。未設定時はgemini-3.7-flash
GEMINI_MODEL=gemini-3.7-flash
```

次を別々のterminalで実行します。

```powershell
# Terminal 1: local Supabaseを起動
npm exec supabase -- start

# Terminal 2: server専用環境変数を読み込んでFunctionsをserve
npm exec supabase -- functions serve --env-file supabase/functions/.env.local

# Terminal 3: フロントエンドを起動
npm run dev
```

ローカルFunctionの実URLは`http://127.0.0.1:54321/functions/v1/chat`です。未認証の直接リクエストが401になることを確認し、その後MOSAICへログインしてUIから送信します。APIキーをcurl引数、PowerShell履歴、console logへ出力しません。

## 本番設定とデプロイ

開発用とは別の本番Auth keyを、Git管理対象外の一時env fileへ用意します。以下では`supabase/functions/.env.production.local`を例にします。

```dotenv
GEMINI_API_KEY=本番用のAuth key
GEMINI_MODEL=gemini-3.7-flash
```

対象project refを確認してから、CLIの`--env-file`経由でsecretを登録し、Functionをデプロイします。

```powershell
npm exec supabase -- secrets set --project-ref PROJECT_REF --env-file supabase/functions/.env.production.local
npm exec supabase -- secrets list --project-ref PROJECT_REF
npm exec supabase -- functions deploy chat --project-ref PROJECT_REF
npm exec supabase -- functions list --project-ref PROJECT_REF
```

`secrets list`は名前の存在確認にだけ使い、値をlogへ出しません。secret更新はFunctionの再デプロイなしで反映されますが、Functionのcode変更には`functions deploy chat`が必要です。`--no-verify-jwt`は付けません。

デプロイ後は次を確認します。

1. 未ログインまたは無効なJWTの呼び出しが拒否される。
2. ログイン後、短い質問へ回答が表示される。
3. 最新データへの質問が、選択中の組織の内容だけで回答される。
4. 書込み依頼では確認cardが表示され、キャンセル時は保存されない。
5. 確認後に共有データが1回だけ更新され、画面が最新revisionへ更新される。
6. 未保存変更、権限不足、有効期限切れ、revision競合が安全に拒否される。
7. Gemini設定不備、429、timeoutで秘密情報を含まないエラー表示になる。
8. PC幅とモバイル幅で開閉、送信、確認、再送ができる。

## 会話履歴とGoogle側の保持

Interactions APIは、完了したInteractionのIDを次の`previous_interaction_id`へ渡すことでserver側の会話状態を継続できます。System Instruction、将来のtools、generation configはInteraction単位のため、Functionは各ターンで再指定します。

Google側の`store`は既定で`true`です。[Interactions APIのデータ保持仕様](https://ai.google.dev/gemini-api/docs/interactions-overview#data-storage-and-retention)では、Free tierは1日、Paid tierは55日保持されます。Paid tierはAI Studioで7、14、28、55日に変更でき、InteractionはAPIまたはAI Studioから削除できます。

- ブラウザは表示に必要な最低限の履歴とInteraction IDだけを保持する。
- APIキー、JWT、業務データ全体を会話履歴へ保存しない。
- Interaction IDをDBへ永続化する将来変更では、必ず`user_id`と`organization_id`へ紐付け、他利用者のIDを再利用できないようにする。
- Google側へ保存しない方針へ変更する場合は`store=false`にし、思考、署名、Function Callを含む全stepsを欠落なくserver側で管理する。単純な`role`と本文だけへ縮退させない。

利用開始前に、送信できる社内情報の範囲と保持期間を会社のデータ取扱方針へ合わせてください。

## 入力、利用量、実行時間の制限

- clientとFunctionの両方で空文字、型、本文長、履歴件数を検証する。client側の検証だけを認可・利用制限として扱わない。
- Geminiのrate limitはproject単位でRPM、TPM、RPD、利用額に適用される。実値は[Google AI StudioのRate limits](https://ai.google.dev/gemini-api/docs/rate-limits)で確認する。
- 429と一時的な5xxだけを、上限付きの指数バックオフとjitterで再試行する。400、401、403を自動再送しない。
- 利用者または送信元単位のrate limitをGemini呼出し前に適用する。複数Edge workerで正確な制限が必要な場合は、[SupabaseのRedis rate limiting例](https://supabase.com/docs/guides/functions/examples/rate-limiting)のような共有storeを使う。
- Supabase hosted Edge Functionsはmemory 256MB、request idle timeout 150秒です。Free planのworker最大時間は150秒、Paid planは400秒です。最新値は[Edge Function limits](https://supabase.com/docs/guides/functions/limits)で確認する。
- timeout、認証失敗、Googleのエラー本文、stack traceをそのままブラウザへ返さない。

## Phase 2: RAG / File Search

UIとHTTP契約を変えず、`supabase/functions/chat/`配下のGemini呼出し層へ検索contextを追加します。実装候補は次の責務で分離します。

```text
supabase/functions/chat/
  rag/                 # File Search store、検索条件、citation整形
  prompt.mjs           # RAG利用時の追加instructionも既存promptへ集約
```

Gemini File Searchは`tools`へ`type: "file_search"`とstore名を追加できます。FAQ、Markdown、PDF、操作マニュアルを取り込む処理は、利用者のチャットリクエストとは別の管理経路にします。store名やmetadata filterをブラウザから自由入力させず、組織・環境ごとのserver設定から選びます。参照元をUIへ表示する場合は、Geminiが返すcitationだけを許可済み文書情報へ変換します。

公式仕様は[Gemini File Search](https://ai.google.dev/gemini-api/docs/file-search)を参照してください。

## Function Calling / アプリ内操作

現在の実装は、固定の許可listとJSON schemaを`workspace-tools.mjs`へ集約しています。Geminiの`function_call`はserverでtool名と引数を検証し、参照toolだけを自動実行します。書込toolは変更計画を作るだけで、確認済みaction requestだけが既存RPCを呼びます。Geminiが返したSQL、RPC名、URL、保存payloadをそのまま実行する経路はありません。

Interactions APIの状態保持を使い、結果は公式の`function_result`形式で同じ`call_id`へ返します。tool loopは4 round、各round 4 callを上限とし、確認後の完了文生成では`generation_config.tool_choice: "none"`を指定します。公式仕様は[Gemini Function Calling](https://ai.google.dev/gemini-api/docs/function-calling)を参照してください。

将来toolを増やす場合は、宣言、引数正規化、role制約、snapshot上の検証、影響preview、保存payload、単体testを同じ変更で追加します。組織招待、権限変更、利用停止は現在の許可list外です。これらを追加する場合は、workspace保存とは別の強い確認と監査設計を先にレビューします。

## 障害時

- `GEMINI_API_KEY`漏えい時はGoogle側で新keyを発行し、Supabase Secretを更新して旧keyを失効する。
- 429が続く場合は再送を増やさず、AI StudioでRPM、TPM、RPD、利用額を確認する。
- 401はGemini障害と扱わず、Supabase sessionと`verify_jwt`設定を確認する。
- 5xxまたはtimeoutはGeminiとSupabaseのstatus、Function log、request IDを確認する。logへ質問本文やsecretを追加しない。
- AIチャットの障害を理由に、アサイン管理本体をデモデータへ自動切替しない。
