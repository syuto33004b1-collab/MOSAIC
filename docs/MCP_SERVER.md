# MOSAIC Remote MCP Server

外部のAIホストが MOSAIC のメンバー・プロジェクト・アサイン・要員要件を参照するための Remote MCP Server です。チャット Function および外部APIとは URL を共有しません。今段は read-only です。

## 認証

外部APIと同じ `mosaic_sk_` 資格を使います。

```
Authorization: Bearer mosaic_sk_...
POST https://PROJECT_REF.supabase.co/functions/v1/mcp
```

OAuth Authorization Server は今段の対象外です。

## 公開面

- Tool: `read_workspace` のみ
- Resource: `mosaic://members` / `mosaic://projects` / `mosaic://assignments` / `mosaic://staffing-needs`
- 書込 tool はエラーを返します。確認付き書込みは次段です。

業務ルールは `workspace-tools` と `integration_get_workspace` を再利用します。
