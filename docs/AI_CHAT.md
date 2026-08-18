# MOSAIC AIチャット

MOSAICのAIチャットは、認証済み利用者が画面の機能や操作方法を自然言語で確認するための機能です。ブラウザからGemini APIを直接呼ばず、Supabase Edge Functionを境界にしてAPIキー、入力検証、エラー処理をserver側へ閉じ込めます。

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

Phase 1の責務は次のfileへ分けています。

| File | 責務 |
| --- | --- |
| `src/components/ai-chat/AiChat.tsx` | 開閉、入力、履歴表示、送信状態、エラー表示 |
| `src/lib/ai/chatClient.ts` | 認証済みSupabase Functionの呼出しとresponse/errorの正規化 |
| `supabase/functions/chat/index.ts` | HTTP・Auth境界と処理の組立て |
| `supabase/functions/chat/contract.mjs` | request/responseの検証と公開契約 |
| `supabase/functions/chat/continuation.mjs` | 会話継続IDを利用者へ結び付ける署名・検証 |
| `supabase/functions/chat/gemini.mjs` | Gemini Interactions APIとの通信 |
| `supabase/functions/chat/prompt.mjs` | MOSAIC専用System Instruction |
| `supabase/functions/chat/rate-limit.mjs` | 利用者単位の送信制限 |

現在のrequestは`message`、画面上の最低限の`history`、任意の`previousInteractionId`を受け取ります。成功responseは`{ "reply": "...", "interactionId": "..." }`です。Gemini固有のstepsやエラー本文をブラウザ向け契約へ漏らしません。

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
3. 同じチャット内の直前の文脈を引き継ぐ。
4. Gemini設定不備、429、timeoutで秘密情報を含まないエラー表示になる。
5. PC幅とモバイル幅で開閉、送信、再送ができる。

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

## Phase 3: Function Calling / アプリ内操作

Function宣言と実行器は次の場所へ追加し、UIからGeminiのFunction名や引数を直接実行しません。

```text
supabase/functions/chat/
  tools/
    registry.ts        # Geminiへ公開するtoolの許可listとschema
    execute.ts         # 認証済み利用者としてのserver-side実行
```

追加時は次を必須にします。

- GeminiはFunctionの候補と引数を返すだけで、実行可否はserverが決める。
- tool名を固定の許可listで照合し、引数をschema検証する。
- 現在のJWT、organization membership、roleを、既存RPCと同じ規則で再検証する。
- 書込み操作は確認画面、冪等request ID、revision競合検出、監査logを維持する。
- Geminiの文章をSQL、RPC名、URLとして直接実行しない。
- Function結果は必要最小限へ整形してGeminiへ返す。

既存機能の候補は、まず読取専用のプロジェクト検索、メンバー稼働確認、欠員・過負荷の取得です。アサイン保存、組織招待、権限変更、利用停止は影響が大きいため、Phase 3でも自動実行を既定にせず、明示確認と権限検証を伴う別レビュー対象にします。公式仕様は[Gemini Function Calling](https://ai.google.dev/gemini-api/docs/function-calling)を参照してください。

## 障害時

- `GEMINI_API_KEY`漏えい時はGoogle側で新keyを発行し、Supabase Secretを更新して旧keyを失効する。
- 429が続く場合は再送を増やさず、AI StudioでRPM、TPM、RPD、利用額を確認する。
- 401はGemini障害と扱わず、Supabase sessionと`verify_jwt`設定を確認する。
- 5xxまたはtimeoutはGeminiとSupabaseのstatus、Function log、request IDを確認する。logへ質問本文やsecretを追加しない。
- AIチャットの障害を理由に、アサイン管理本体をデモデータへ自動切替しない。
