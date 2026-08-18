# AI chat Edge Function

MOSAICの認証済み利用者からメッセージまたは確認操作を受け取り、サーバー側からGemini Interactions APIと既存workspace RPCを呼び出します。ブラウザへGeminiの認証情報は渡しません。

Supabaseのplatform JWT検証と`withSupabase({ auth: "user" })`の両方を有効にし、ログイン済み利用者だけを受け付けます。

## API contract

`POST /functions/v1/chat`

```json
{
  "kind": "message",
  "organizationId": "11111111-1111-4111-8111-111111111111",
  "message": "このアプリでは何ができますか？",
  "history": [
    { "role": "user", "content": "MOSAICについて教えて" },
    { "role": "assistant", "content": "プロジェクトのアサイン管理ツールです。" }
  ],
  "previousInteractionId": "m2....",
  "hasLocalChanges": false
}
```

参照または通常回答の成功時:

```json
{
  "reply": "アサインボードでメンバーの稼働状況を確認できます。",
  "interactionId": "m2...."
}
```

書込み候補の成功時は`proposal`を追加します。

```json
{
  "reply": "Atlasへ担当者をアサインします。",
  "interactionId": "m2....",
  "proposal": {
    "token": "a1....",
    "type": "create_assignment",
    "title": "アサインを登録",
    "summary": "Atlasへ担当者をアサインします。",
    "details": [{ "label": "変更", "value": "Alice / 50%" }],
    "impacts": [],
    "confirmLabel": "登録して保存",
    "destructive": false,
    "expectedRevision": 7,
    "expiresAt": "2026-08-18T00:05:00.000Z"
  }
}
```

確認またはキャンセル:

```json
{
  "kind": "action",
  "organizationId": "11111111-1111-4111-8111-111111111111",
  "actionToken": "a1....",
  "decision": "confirm"
}
```

保存成功時は`workspaceRevision`を返します。確認tokenは5分で失効し、利用者・組織・権限revision・workspace revisionへ署名で結び付けます。競合時は409を返し、自動rebaseしません。

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

会話継続は`previousInteractionId`を優先します。クライアントへ返すIDは、Geminiの生IDではなく認証利用者と組織に結び付けた署名付きトークンです。Interactions APIではSystem Instruction、tool宣言、生成設定がターン単位のため、Functionは毎回同じ設定を再指定します。InteractionはGemini側に保存されるため、利用するGoogle AIプランの保持期間と社内データ取扱方針を本番導入前に確認してください。

## Workspace tools and save boundary

- `read_workspace`は`ctx.supabase`から取得した最新snapshotだけを検索する。
- 13個の書込toolは変更案を作り、AIの応答中には保存しない。
- 1回の応答につき書込みは1件。画面に未保存変更がある場合は候補を作らない。
- 確認後だけ`ctx.supabase.rpc("save_workspace", ...)`を1回呼ぶ。管理者clientは使わない。
- 保存requestは固定request ID、payload hash、expected revisionを含む。既存RPCが権限、冪等性、整合性、監査logを担保する。
- メンバー/プロジェクトの削除はアーカイブ、アサイン/要員要件の削除は取消として計画する。
- 招待、Authユーザー作成、role変更、組織設定はtool対象外。

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
- Additional Function Calling: `workspace-tools.mjs`へ許可済みtool、検証、preview、保存計画、testを追加する。
- 永続的なrate limit: 現在のメモリ内制限はisolate単位のbest effortです。本番規模ではDBまたは承認済みの共有rate-limit storeへ置き換えます。
