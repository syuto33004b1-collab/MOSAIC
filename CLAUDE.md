# MOSAIC

## 作業を始める前に

**[AGENTS.md](AGENTS.md) を読む。** このリポジトリの開発順序と各段階の義務が書いてある。唯一の出典であり、ここには再掲しない。

要点だけ。

- **1 Issue = 1 ブランチ = 1 PR。** 些細な修正でも起票する
- **コードを読んでから**、最小設計を Issue コメントに固定する。コードを書く前に固定する
- **PR を作る前に独立評価を必ず1回通す。** 自己レビューは代替にならない
- 差分が描画に影響するなら、**画面を実際に見る。** テストが通っていることは省略の理由にならない
- squash merge のみ

スキルは `.claude/skills/` にある。評価は `evaluating-before-pr`、UI 確認は `verifying-ui-changes`。相談は `ask-codex`。

## このリポジトリについて

プロジェクトアサイン管理ツール。React + Vite のフロントエンド、Supabase（Postgres + Edge Functions）のバックエンド。

- 業務データは非公開の `app` schema に置き、ブラウザは `public` の限定 RPC だけを使う
- 認可の正典は DB。Web UI・AI秘書・外部API・MCP は同じ RPC を通るので、経路ごとに実装しない
- 詳細は [docs/](docs/) 配下。認可と secret の境界は [docs/SECURITY.md](docs/SECURITY.md)
