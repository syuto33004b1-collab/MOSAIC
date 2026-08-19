# Remote MCP Server

外部のAIホストが MOSAIC の業務データを参照するための Remote MCP Server です。チャット Function および外部APIとは URL を共有しません。今段は read-only です。書込み確認は次段です。

`verify_jwt = false` です。認証は `Authorization: Bearer mosaic_sk_...` だけを受け付けます。

## 契約

`POST https://PROJECT_REF.supabase.co/functions/v1/mcp`

JSON-RPC methods: `initialize`, `ping`, `tools/list`, `tools/call`, `resources/list`, `resources/read`.

公開 Tool は `read_workspace` のみです。Resources は `mosaic://members` / `mosaic://projects` / `mosaic://assignments` / `mosaic://staffing-needs` です。

## デプロイ

```powershell
npm exec supabase -- functions deploy mcp --project-ref PROJECT_REF
```
