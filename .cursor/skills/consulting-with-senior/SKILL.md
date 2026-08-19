---
name: consulting-with-senior
description: Use when the implementing agent is choosing a non-trivial approach, is stuck on a tradeoff, or the user asks to consult Opus or Sol. Do not use for final review or routine one-line edits.
---

# 相談者（senior consultant）

設計の第二意見を、readonly の相談者 Subagent に聞く。実装は主エージェントのまま。

## When to Use

- 非自明な方針・トレードオフを決める前
- 行き詰まったとき
- ユーザーが「相談して」「Opusに聞いて」「Solで相談して」と言った

## When NOT to Use

- 完了確認・レビュー → `evaluating-with-senior`
- 表記ゆれ、lint、1行修正
- 同じ問いを今ターンで既に相談した

## Model

ユーザー指定が最優先。未指定なら Opus 5。

| 指定 | Subagent | model |
| --- | --- | --- |
| なし / opus / opus5 / claude opus 5 | `senior-consultant` | `claude-opus-5[effort=high]` |
| sol / gpt-5.6 / gpt-5.6-sol | `sol-consultant` | `gpt-5.6-sol` |

役割は評価者に切り替えない。モデルが使えないときはその旨を伝え、自分で相談役を演じない。

## Brief

親の会話履歴は渡らない。次を必ず含める。

1. 目的
2. 検討済みの案
3. 制約
4. 対象ファイルまたは抜粋
5. 問い

## 取り込み

採用 / 保留 / 反論を明示する。続きは同じ agent ID で resume する。
