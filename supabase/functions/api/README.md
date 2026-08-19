# External API Edge Function

人事、勤怠、BIなど外部システムが、MOSAICの業務カタログをバージョン付きHTTPS契約で呼び出すための境界です。チャット Function とは URL を共有しません。アカウント発行や MCP はこの Function に含めません。

`verify_jwt = false` です。認証は `Authorization: Bearer mosaic_sk_...` だけを受け付け、service_role から `authorize_integration_request` で検証します。利用者 JWT では呼べません。

## 契約

`https://PROJECT_REF.supabase.co/functions/v1/api/v1/<resource>`

| 操作 | パス |
| --- | --- |
| 一覧 / 一件参照 | `GET /v1/members` `GET /v1/members/:id`（projects / assignments / staffing-needs も同じ） |
| 登録 | `POST /v1/members` など |
| 更新 | `PATCH /v1/:resource/:id` |
| アーカイブ / 取消 | `DELETE /v1/:resource/:id` |
| 要員充足 | `POST /v1/staffing-needs/:id/assign` |

書込みは確認ダイアログなしで、既存の `planWorkspaceAction` → `integration_save_workspace` を使います。任意の SQL / RPC 名 / URL は受け付けません。`Idempotency-Key`（UUID）を付けると再送を冪等に扱います。任意で `X-MOSAIC-Expected-Revision` を送れます。

エラー:

```json
{ "error": { "code": "FORBIDDEN", "message": "この連携資格では許可されていない操作です。", "retryable": false } }
```

## Webhook

owner / admin が運用パネルから HTTPS URL を登録します。秘密は発行時のみ表示します。配信は outbox 経由で、`X-MOSAIC-Signature: sha256=<hex>` を付けます。localhost とプライベートIPは登録・配信とも拒否します。

## デプロイ

```powershell
npm exec supabase -- functions deploy api --project-ref PROJECT_REF
```

`--no-verify-jwt` はチャットへ付けません。API Function は config の `verify_jwt = false` に従います。hosted Function には `SUPABASE_URL` と `SUPABASE_SERVICE_ROLE_KEY` が入ります。値を log へ出さないでください。
