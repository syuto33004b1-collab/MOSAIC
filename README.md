# MOSAIC

チームの稼働状況、プロジェクトの要員不足、過負荷を同じ時間軸で確認・調整できる、プロジェクトアサイン管理ツールです。

## 公開サイト

[GitHub PagesでMOSAICを開く](https://syuto33004b1-collab.github.io/MOSAIC/)

## 主な機能

- 日付範囲と配分率を持つアサインボード
- プロジェクト、メンバー、4〜12週間レポートの連動表示
- 部門階層、主所属・兼務・責任者、組織別の検索と需給
- 欠員への候補者仮置きと、過負荷の推奨調整
- メンバー、プロジェクト、不足要員、アサインの登録・編集・取消・アーカイブ
- 保存前の変更確認と、保存済み状態を守る取り消し
- 検索、絞り込み、詳細ドロワー、レスポンシブ表示
- スキル分類ツリー、習熟度、組織のスキルマップ
- メンバー・プロジェクトのカスタム項目、一覧/詳細/検索への配置、業務経歴
- 受注前案件、要員計画、候補検討、受注時のプロジェクト引き継ぎ
- Supabase Authによる招待制ログインと、組織ごとの共有ワークスペース
- Geminiをserver側から呼び出す、認証済み利用者向けAIチャット
- `owner` / `admin` / `planner` / `viewer`の権限分離
- 組織招待の登録・取消、利用者の権限変更・利用停止、変更前後を追える監査ログ
- revision比較による競合防止、冪等保存、Realtime更新通知

Supabase接続値が未設定の環境では、画面上に`DEMO`と表示し、サンプルデータだけをブラウザの`localStorage`へ保存します。接続済み環境でDB読込に失敗した場合はデモへ切り替えず、エラーとして停止します。

## ローカル実行

```bash
npm ci
npm run dev
```

品質確認は次のコマンドで実行できます。

```bash
npm run lint
npm test
npm run typecheck
```

## 共有運用のセットアップ

業務データは非公開の`app` schemaに置き、ブラウザは認証済みRPCだけを利用します。migration、Auth URL、GitHub Repository Variables、role別検証は[Supabaseセットアップ](docs/SUPABASE_SETUP.md)を参照してください。AIチャットのserver-side APIキー、ローカル実行、Functionデプロイは[AIチャット設定](docs/AI_CHAT.md)に記載しています。リリース、バックアップ、障害対応は[運用手順](docs/OPERATIONS.md)、認可とsecretの境界は[セキュリティ方針](docs/SECURITY.md)に記載しています。

`.env.local`には公開可能な接続値だけを設定します。

```dotenv
VITE_SUPABASE_URL=https://PROJECT_REF.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_REPLACE_ME
VITE_REQUIRE_SHARED_MODE=false
```

本番切替後は`VITE_REQUIRE_SHARED_MODE=true`を設定します。これにより接続値が消えたデプロイをデモとして公開せず、設定エラーで停止します。

## 公開方法

Pull Requestではlint、unit/static test、build、dependency review、dependency auditに加え、隔離Postgresへmigrationを適用してrole/RLSを検証します。`main`への反映後、GitHub Actionsが静的ビルドを作成し、GitHub Pagesへ自動公開します。

リリースごとの変更点は[CHANGELOG](CHANGELOG.md)を参照してください。
