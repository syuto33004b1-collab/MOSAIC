# MOSAIC Remote MCP Server

外部のAIホストが MOSAIC のメンバー・プロジェクト・アサイン・要員要件を参照し、確認のうえ気づきを送るための Remote MCP Server です。チャット Function および外部APIとは URL を共有しません。

## 認証

外部APIと同じ `mosaic_sk_` 資格を使います。

```
Authorization: Bearer mosaic_sk_...
POST https://PROJECT_REF.supabase.co/functions/v1/mcp
```

OAuth Authorization Server は今段の対象外です。

AI秘書から社外MCPサーバーへ接続する逆方向の出口は別実装です。[外部MCP Client](MCP_CLIENT.md)を参照してください。

## 公開面

- Tool: `read_workspace` と確認付きの `submit_feedback`
- Resource: `mosaic://members` / `mosaic://projects` / `mosaic://assignments` / `mosaic://staffing-needs`
- アサイン・メンバー・要員要件など業務データの書込 tool はエラーを返します

`submit_feedback` は2往復です。1回目は本文だけを送り、確認トークンとプレビューを返します。この時点では `app.feedback` に保存しません。2回目は `confirmationToken` だけを送ります。本文を同時に付けると拒否します。

確認の強度はチャットの確認カードと同等ではありません。ホストが自動承認する場合、モデルが2回目を連続で呼べます。サーバは人間の承認を検証できません。ホスト側の tool 承認が2回出ること、本文がトランスクリプトへ露出すること、単発の幻覚呼び出しだけでは書けないこと、がこの2往復の意味です。最初の書込面をフィードバックにした理由でもあります。

## ロール別権限

`integration_get_workspace` は `get_workspace` を呼ぶため、資格の発行者のロールに設定されたロール別権限（`app.role_permissions`）が `read_workspace` と Resource の両方へ効きます。非表示の独自項目、利用不可の機能セクション、参照範囲外の人はホストへ渡りません。制限を受けない参照が必要な場合は、制限のないロールの利用者が資格を発行します。

`submit_feedback` の組織は資格から導出します。発行者が active な owner/admin/planner でなくなれば、資格は昇格せず停止します。1時間20件の上限は発行者に課金されます。`workspace:read` は全資格が必ず持つため、今段は新しい書込スコープを足していません。
