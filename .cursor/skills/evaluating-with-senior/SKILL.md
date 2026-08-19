---
name: evaluating-with-senior
description: Use when claiming work complete, before merge, when spec drift or missing tests are suspected, or the user asks Opus or Sol to review. Do not use for design brainstorming or routine edits.
---

# 評価者（senior evaluator）

完了主張を、readonly の評価者 Subagent に独立検証させる。実装は主エージェントのまま。

## When to Use

- 実装完了を主張する直前
- merge / PR 前
- 仕様ずれ、テスト不足、危険な変更が疑われる
- ユーザーが「評価して」「Solで見て」「Opusにレビューさせて」と言った

## When NOT to Use

- 設計の壁打ち → `consulting-with-senior`
- 表記ゆれ、lint、1行修正
- 同じ差分を今ターンで既に評価した

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

指摘ごとに採用 / 保留 / 反論を明示する。続きは同じ agent ID で resume する。
