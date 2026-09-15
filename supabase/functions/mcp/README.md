# Remote MCP Server

外部のAIホストが MOSAIC の業務データを参照し、確認のうえ気づきを送るための Remote MCP Server です。チャット Function および外部APIとは URL を共有しません。業務データの書込みは今段の対象外です。

`verify_jwt = false` です。認証は `Authorization: Bearer mosaic_sk_...` だけを受け付けます。

## 契約

`POST https://PROJECT_REF.supabase.co/functions/v1/mcp`

JSON-RPC methods: `initialize`, `ping`, `tools/list`, `tools/call`, `resources/list`, `resources/read`.

公開 Tool は `read_workspace` と確認付きの `submit_feedback` です。Resources は `mosaic://members` / `mosaic://projects` / `mosaic://assignments` / `mosaic://staffing-needs` です。

`submit_feedback` の1回目は保存しません。2回目は `confirmationToken` だけを送ります。確認トークンは発行した連携資格に束縛します。

## デプロイ

```powershell
npm exec supabase -- functions deploy mcp --project-ref PROJECT_REF
```
