---
name: consulting-with-senior
description: Use when stuck on a judgment call, when a second opinion or multi-sided view would help, or when the user asks to consult Opus or Sol. Timing is the implementing agent's call. Do not use for final review or routine one-line edits.
---

# 相談者（senior consultant）

設計の第二意見を、readonly の相談者 Subagent に聞く。実装は主エージェントのまま。使うタイミングは主エージェントに任せる。

## When to Use

判断に困ったとき、意見が欲しいとき、多面的に見たいときに使う。必須ではない。

- 判断に困る（方針が複数あり、どれでもよさそう）
- 意見が欲しい（自分の案に穴がないか聞きたい）
- 多面的に見たい（コスト、保守、セキュリティ、YAGNI などを並べたい）
- 非自明なトレードオフの前
- ユーザーが「相談して」「Opusに聞いて」「Solで相談して」と言った

迷ったら使う。自明な実装では使わない。

## When NOT to Use

- 完了確認・PR前の評価 → `evaluating-with-senior`
- 表記ゆれ、lint、1行修正
- 同じ問いを今ターンで既に相談した

## Model

ユーザー指定が最優先。未指定なら Opus 5。

| 指定 | Subagent | model |
| --- | --- | --- |
| なし / opus / opus5 / claude opus 5 | `senior-consultant` | `claude-opus-5[effort=high]` |
| sol / gpt-5.6 / gpt-5.6-sol | `sol-consultant` | `gpt-5.6-sol` |

役割は評価者に切り替えない。

## Fallback

モデルが使えない・別モデルに落ちたとき:

- 旧リクエスト制で Max Mode がオフ、プラン外、管理者が禁止 → Cursor が別モデルへ落とす
- そのときはユーザーに「指定モデルで起動できなかった」と伝え、自分で相談役を演じない
- Opus 5 / GPT-5.6 Sol は Other Models。起動はトークンを独立計上する
- Cloud Agent ではチーム側でそのモデルが使えること

## Brief

親の会話履歴は渡らない。次を必ず含める。

1. 目的
2. 検討済みの案
3. 制約
4. 対象ファイルまたは抜粋
5. 問い

## 取り込み

採用 / 保留 / 反論を明示する。続きは同じ agent ID で resume する。
