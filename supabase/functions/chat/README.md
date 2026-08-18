# AI chat Edge Function

MOSAICの認証済み利用者からメッセージを受け取り、サーバー側からGemini Interactions APIを呼び出します。ブラウザへGeminiの認証情報は渡しません。

Supabaseのplatform JWT検証と`withSupabase({ auth: "user" })`の両方を有効にし、ログイン済み利用者だけを受け付けます。

## API contract

`POST /functions/v1/chat`

```json
{
  "message": "このアプリでは何ができますか？",
  "history": [
    { "role": "user", "content": "MOSAICについて教えて" },
    { "role": "assistant", "content": "プロジェクトのアサイン管理ツールです。" }
  ],
  "previousInteractionId": "m1...."
}
```

成功時:

```json
{
  "reply": "アサインボードでメンバーの稼働状況を確認できます。",
  "interactionId": "m1...."
}
```

エラー時:

```json
{
  "error": {
    "code": "AI_UNAVAILABLE",
    "message": "AIチャットに一時的に接続できません。しばらくしてからもう一度お試しください。",
    "retryable": true
  }
}
```

会話継続は`previousInteractionId`を優先します。クライアントへ返すIDは、Geminiの生IDではなく認証利用者に結び付けた署名付きトークンです。Interactions APIではSystem Instructionと生成設定がターン単位のため、Functionは毎回同じ設定を再指定します。InteractionはGemini側に保存されるため、利用するGoogle AIプランの保持期間と社内データ取扱方針を本番導入前に確認してください。

## Secrets and deployment

ローカルでは`supabase/functions/.env.example`をコピーしたGit管理対象外の環境ファイルに値を設定します。本番ではSupabaseのsecret storeへ登録します。

Git管理対象外の`supabase/functions/.env.production.local`へ値を設定し、shell履歴へkeyを残さず登録します。

```dotenv
GEMINI_API_KEY=REPLACE_WITH_REAL_KEY
GEMINI_MODEL=gemini-3.7-flash
```

```powershell
npm exec supabase -- secrets set --project-ref PROJECT_REF --env-file supabase/functions/.env.production.local
npm exec supabase -- functions deploy chat --project-ref PROJECT_REF
```

- `GEMINI_API_KEY`: 必須。Google AI Studioで発行したキー。
- `GEMINI_MODEL`: 任意。未設定時は`gemini-3.7-flash`。

`GEMINI_API_KEY`を`VITE_`変数、GitHub Pagesのビルド変数、source、logへ置かないでください。

## Later phases

- RAG / File Search: `gemini.mjs`のInteraction requestへ`tools`を追加する。
- Function Calling: `gemini.mjs`でtool宣言とstepを扱い、別モジュールで許可済みtoolだけを実行する。
- 永続的なrate limit: 現在のメモリ内制限はisolate単位のbest effortです。本番規模ではDBまたは承認済みの共有rate-limit storeへ置き換えます。
