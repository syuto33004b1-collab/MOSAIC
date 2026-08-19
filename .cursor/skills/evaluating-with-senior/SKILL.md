---
name: evaluating-with-senior
description: Use when about to open a pull request after implementation work, when spec drift or missing tests are suspected, or the user asks Opus or Sol to review. Do not use for design brainstorming, routine one-line edits, or a second review of the same change after applying the first evaluation.
---

# 評価者（senior evaluator）

完了主張を、readonly の評価者 Subagent に独立検証させる。実装は主エージェントのまま。

## When to Use

- **PRを出す直前（必須）**。実装作業のあと、pull request を create する前に必ず1回呼ぶ
- 仕様ずれ、テスト不足、危険な変更が疑われる
- ユーザーが「評価して」「Solで見て」「Opusにレビューさせて」と言った

## When NOT to Use

- 設計の壁打ち → `consulting-with-senior`
- 表記ゆれ、lint、1行修正（PRにしない作業）
- **2回目の評価**。初回の指摘を直したあと、同じ変更セットを再評価しない

## Required gate

PRを出す前に行った作業へ、評価を必ずもらう。

1. 評価者を1回起動する（既定は Sol）
2. Critical / High は直す。Medium / Note は必要なら直す
3. 直したあと、2回目の評価はしない。PRを出す

| Excuse | Reality |
| --- | --- |
| 「あとで評価する」 | 評価の場は PR を出す前。出したあとでは遅い |
| 「自分で見直した」 | 自己レビューは独立評価の代替にならない |
| 「直したので再評価」 | 2回目は不要。初回を直して終わり |

## Model

ユーザー指定が最優先。未指定なら GPT-5.6 Sol。

| 指定 | Subagent | model |
| --- | --- | --- |
| なし / sol / gpt-5.6 / gpt-5.6-sol | `senior-evaluator` | `gpt-5.6-sol` |
| opus / opus5 / claude opus 5 | `opus-evaluator` | `claude-opus-5[effort=high]` |

役割は相談者に切り替えない。

## Fallback

モデルが使えない・別モデルに落ちたとき:

- 旧リクエスト制で Max Mode がオフ、プラン外、管理者が禁止 → Cursor が別モデルへ落とす
- そのときはユーザーに「指定モデルで起動できなかった」と伝え、自分で評価者を演じない
- Opus 5 / GPT-5.6 Sol は Other Models。起動はトークンを独立計上する
- Cloud Agent ではチーム側でそのモデルが使えること

## Brief

親の会話履歴は渡らない。次を必ず含める。

1. 完了したと主張していること
2. 仕様または意図
3. 対象差分 / ファイル
4. 確認してほしい点

## 取り込み

指摘ごとに採用 / 保留 / 反論を明示する。続きの質問だけ同じ agent ID で resume する。修正後の再評価には使わない。
