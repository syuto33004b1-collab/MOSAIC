# MOSAIC Remote MCP Server

外部のAIホストが MOSAIC のメンバー・プロジェクト・アサイン・要員要件を参照するための Remote MCP Server です。チャット Function および外部APIとは URL を共有しません。今段は read-only です。

## 認証

外部APIと同じ `mosaic_sk_` 資格を使います。

```
Authorization: Bearer mosaic_sk_...
POST https://PROJECT_REF.supabase.co/functions/v1/mcp
```

OAuth Authorization Server は今段の対象外です。

AI秘書から社外MCPサーバーへ接続する逆方向の出口は別実装です。[外部MCP Client](MCP_CLIENT.md)を参照してください。

## 公開面

- Tool: `read_workspace` のみ
- Resource: `mosaic://members` / `mosaic://projects` / `mosaic://assignments` / `mosaic://staffing-needs`
- 書込 tool はエラーを返します。確認付き書込みは次段です。

業務ルールは `workspace-tools` と `integration_get_workspace` を再利用します。

## ロール別権限

`integration_get_workspace` は `get_workspace` を呼ぶため、資格の発行者のロールに設定されたロール別権限（`app.role_permissions`）が `read_workspace` と Resource の両方へ効きます。非表示の独自項目、利用不可の機能セクション、参照範囲外の人はホストへ渡りません。制限を受けない参照が必要な場合は、制限のないロールの利用者が資格を発行します。
