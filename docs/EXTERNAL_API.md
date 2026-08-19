# MOSAIC 外部API

人事、勤怠、BIなど外部システムが、MOSAICのメンバー・プロジェクト・アサイン・要員要件を参照・更新するためのバージョン付きHTTPS契約です。チャット Function とは URL を共有しません。アカウント発行と MCP はこの文書の対象外です。

## 認証

運用パネルの owner / admin が発行する `mosaic_sk_` 資格だけを使います。

```
Authorization: Bearer mosaic_sk_...
```

利用者 JWT では呼べません。検証は service_role から `authorize_integration_request` を呼び、組織あたり毎分60回です。スコープは `workspace:read` 必須で、書込みは `members:write` / `projects:write` / `assignments:write` / `staffing:write` です。

## エンドポイント

`https://PROJECT_REF.supabase.co/functions/v1/api/v1/<resource>`

| メソッド | パス |
| --- | --- |
| GET | `/v1/members` `/v1/projects` `/v1/assignments` `/v1/staffing-needs` |
| GET | `/v1/members/:id` ほか一件参照 |
| POST | 同上のコレクション |
| PATCH / DELETE | `/v1/:resource/:id` |
| POST | `/v1/staffing-needs/:id/assign` |

一覧の `limit` は最大25です。書込みは確認ダイアログなしで、既存カタログの検証・revision 競合・冪等を使います。`Idempotency-Key`（UUID）を推奨します。任意の SQL / RPC 名 / URL は実行しません。

エラー:

```json
{ "error": { "code": "FORBIDDEN", "message": "この連携資格では許可されていない操作です。", "retryable": false } }
```

## Webhook

owner / admin が HTTPS URL を登録します（最大10）。イベントは `workspace.committed`、`member.changed`、`project.changed`、`assignment.changed`、`staffing_need.changed` です。配信は outbox 経由で、`X-MOSAIC-Signature: sha256=<hex>` と `X-MOSAIC-Event` を付けます。localhost とプライベートIPは拒否します。署名シークレットは発行時のみ表示します。

## デプロイ

```powershell
npm exec supabase -- functions deploy api --project-ref PROJECT_REF
```

`verify_jwt = false` は API Function だけです。チャットには `--no-verify-jwt` を付けません。
