# MOSAIC 外部MCP Client

MOSAICのAI秘書から、管理者が承認した社外MCPサーバーを利用するための出口です。外部AIがMOSAICを利用する入口（[MCP Server](MCP_SERVER.md)）とは別実装で、URLもコードも共有しません。参照は即時、書込みは利用者の明示確認後に実行します。

## 実装の分離

| | 入口（#26） | 出口（この文書） |
| --- | --- | --- |
| 実装 | `supabase/functions/mcp/` | `supabase/functions/chat/mcp-client.mjs` |
| エンドポイント | `/functions/v1/mcp` | なし（chat Function 内から発信） |
| 認証 | `mosaic_sk_` 資格 | 承認済みレジストリ + Function の secret |
| 方向 | 外部AI → MOSAIC | MOSAIC → 社外MCP |

資格管理の考え方と監査は外部連携共通基盤（`integration-core.mjs`）を使いますが、実行経路と権限は分けています。

## 承認と接続先

owner / admin が運用パネルで登録します。

- 接続先URLは `app.mcp_servers` の登録行からしか取りません。モデルの出力、リクエスト本文、社外応答からURLを組みません
- `https` のみ。localhost、`*.local`、`*.internal`、プライベートIP、資格情報入りURL、リダイレクト追跡は拒否します
- 登録時にDBで検証し、呼び出しごとにEdge Function側で名前解決まで含めて再検証します
- AIが指定できるのは tool 名だけで、URLは `begin_mcp_call` が返します

### 外向きの秘密鍵

**MOSAICのDBには保存しません。** サーバーキー `acme_hr` なら、chat Function の secret に `MCP_SECRET_ACME_HR` を設定します。未設定なら `Authorization` ヘッダーを付けずに接続します。OAuth Authorization Server は今段の対象外です。

```bash
npm exec supabase -- secrets set MCP_SECRET_ACME_HR=...
```

## AI秘書からの利用

承認済み tool は `mcp_<サーバーキー>-<tool名>` として Gemini へ宣言されます。`WORKSPACE_TOOL_DECLARATIONS`（MOSAIC自身の33件）とは別集合で、既存のツールカタログとスコープは変更していません。

- 社外ツールの呼び出しは1回につき1件だけです
- 結果は `{ ok, untrusted: true, source, text, note }` として返り、社外由来の未信頼データであることを明示します
- 応答テキストから次のツール呼び出しへは進みません（`toolChoice: "none"`）。プロンプトインジェクションの連鎖を止めます
- テキストブロック以外（埋め込みリソース、バイナリ）はモデルへ渡しません

## 書込みの確認フロー

`write_tools` に登録された tool は、AI 秘書が呼んでも即時実行されません。

1. AI が書込 tool を呼ぶ → `propose_mcp_call` が `app.mcp_call_logs` に pending 行を作る。**この時点で社外へは1バイトも送りません**（`initialize` も送りません）。接続先も返しません
2. 利用者へ確認画面を出す。内容は**実際に送信する引数の key / value をそのまま列挙**します。社外 tool の意味を MOSAIC は説明できないので、モデルの文章は混ぜません
3. 利用者が確認 → `resume_mcp_call` が接続先を返し、**プレビューと同一の引数**で実行します
4. 利用者がキャンセル → pending 行を `USER_CANCELLED` で閉じます

確認は**一度しか使えません**。`resume_mcp_call` は pending かつ呼出者本人の行だけを受け付けるので、action token を再送しても2回目は `P0002` になります。提案から確認までの間に管理者が承認を取り消した場合も拒否します。

引数は署名付き action token に載るので、確認後に送られる内容は利用者が見たものと一致します。参照経路（`begin_mcp_call`）は書込 tool を拒否するので、確認を迂回できません。

## ロール別権限

`app.role_permissions.disabled_features` に `externalMcp` を設定したロールは、承認済みサーバーへ到達できません。

- `begin_mcp_call` が `42501` で拒否します。**接続先を解決する前**、かつ**監査行を開く前**に止まります
- `list_mcp_tools` が空を返すので、AI 秘書の tool 宣言から消えます。モデルは社外サーバーの存在自体を知りません
- owner は他の機能キーと同様に常に無制限です
- 権限による拒否は `app.mcp_call_logs` へ記録しません。外部呼び出しの失敗ではないためです

サーバー単位・tool 単位の出し分けは今段では作っていません（未起票）。

## 制限

| 項目 | 値 |
| --- | --- |
| 外部呼び出し | 20 / 分 / 組織 |
| 登録サーバー数 | 最大 5 / 組織 |
| 承認tool数 | 最大 8 / サーバー、宣言は最大 12 |
| サーバーキー | 16文字以内 / tool名 40文字以内（Geminiの関数名64文字に収めるため） |
| 引数 | 最大 2 KiB（データ持出しの上限） |
| 応答 | 最大 32 KiB（超過は切り詰めて明示） |
| タイムアウト | 10 秒 |

チャット自体の 12/分 と連携資格の 60/分 は変えていません。

## 監査

`app.mcp_call_logs` に1呼び出し1行を残します。接続先、tool、依頼した利用者、参照か書込みか（`is_write`）、成否、エラーコード、送受信バイト数、所要時間を記録し、**引数の値は保存しません**。同じテーブルが毎分のレート制限窓も兼ねます。レジストリ自体の変更は `app.audit_events` に載ります。

## 今段の対象外

- 社外側の冪等キー送信、失敗時の自動リトライ、補償処理（未起票）
- 引数の人間可読なラベル付け（key をそのまま出します。未起票）
- OAuth / Authorization Server、SSE、セッションの永続化（未起票）
- `resources/list` / `resources/read`（toolのみ。未起票）
