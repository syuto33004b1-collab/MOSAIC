---
name: verifying-ui-changes
description: Use before creating a pull request whose diff touches rendering — any change under src/**/*.tsx, src/styles.css, or that adds or moves a control, label, or form field. Also use when the user asks to check the screen, look at the UI, confirm a layout, or verify that a change actually shows up. Run this before the evaluating-before-pr gate. Do not use for changes with no rendered output, such as SQL, Edge Functions, or documentation only.
---

# UI 変更の描画確認

Testing Library のテストが通っていることは、**この確認を省く理由にならない**。文字列の存在は確認できるが、レイアウト崩れ、はみ出し、コントラストは検出できない。

このスキルが無い状態で、UI を4回変更して main へマージした（#19 ロール別権限パネル、#27 外部MCP登録フォーム、#54 資格の停止バッジ、#56 書込tool入力欄）。うち #19 は `.role-permission-*` の CSS を新規に書いており、一度も描画を見ていなかった。

## 発火条件

差分が次を含むとき。

- `src/**/*.tsx`、`src/**/*.ts` のうち描画に関わるもの
- `src/styles.css`
- 新しいコントロール、ラベル、フォーム項目の追加や移動

`evaluating-before-pr` の**前**に通す。UI の問題を直してから評価にかける。

## 手順

### 1. 開発サーバーを起動する

```
preview_start { name: "mosaic-dev" }
```

`.claude/launch.json` の設定を使う。`http://127.0.0.1:5173` で DEMO モードとして起動する（`.env` 無しの場合）。認証は不要。

### 2. ブラウザを選ぶ

Claude in Chrome を使う。

```
list_connected_browsers   → 利用者へ選択を確認（必須）
select_browser { deviceId }
```

**localhost を開くので、このマシン上のブラウザでなければ到達できない。** 接続一覧には別マシンのブラウザも並ぶので、`isLocal: true` のものから選んでもらう。

Claude in Chrome が使えない場合は in-app ブラウザ（`Claude_Browser`）を代替として使う。**どちらを使ったか報告に書く。**

### 3. 対象画面を開いて見る

```
navigate { url: "http://127.0.0.1:5173/" }
computer { action: "screenshot" }
```

対象画面へ遷移してからもう一度スクリーンショットを撮る。CDP がタイムアウトすることがあるので、失敗したら1回リトライする。

### 4. 見た目を測る（スクリーンショットだけで判断しない）

**スクリーンショットの幅とビューポートの幅は一致しない。** 実測ではスクリーンショット 1540px に対しビューポート 1540px・`clientWidth` 1525px で、画像上ではカードの右端が切れて「はみ出している」ように見えたが、実際にはオーバーフローしていなかった。

見た目だけで崩れを判断せず、必ず数値で確認する。

```javascript
const de = document.documentElement;
const overflowing = [...document.querySelectorAll('body *')]
  .filter(el => el.getBoundingClientRect().right > de.clientWidth + 1)
  .slice(0, 8)
  .map(el => ({ cls: (el.className || el.tagName).toString().slice(0, 40), right: Math.round(el.getBoundingClientRect().right) }));
({
  horizontalOverflow: de.scrollWidth > de.clientWidth,
  docScrollW: de.scrollWidth,
  docClientW: de.clientWidth,
  overflowingSample: overflowing,
})
```

CSS を新規に書いた場合は、意図した値が実際に効いているかも確認する。

```javascript
getComputedStyle(document.querySelector('.role-permission-form')).gridTemplateColumns
```

### 5. エラーを確認する

```
read_console_messages { onlyErrors: true }
preview_logs { level: "error" }
```

コンソール追跡はツールの初回呼び出し時に始まる。ページ読み込み時のエラーを取るには、呼び出したあとリロードする。

## 確認項目

1. 対象画面が表示される
2. コンソールエラーなし
3. サーバーエラーなし
4. 追加・変更したコントロールが存在し、ラベルから到達できる
5. 横方向のオーバーフローが無い（数値で確認）
6. 新規 CSS が意図した値で効いている

## 確認できなかったことを必ず書く

**「目視確認した」と書けるのは、実際にスクリーンショットを見て判断した範囲だけ。**

スクリーンショットが取得できない場合（in-app ブラウザでペインが非表示のときなど）は、DOM とテキストまでしか読めない。そのときは次を分けて報告する。

- 確認できたこと（要素の存在、テキスト、エラーの有無、数値で測った寸法）
- **確認できなかったこと**（見た目、コントラスト、意図した見え方かどうか）

## 認証が必要な画面は確認しない

共有モードの画面はログインが必要で、**認証操作は代行しない**。該当する画面は未確認として明示し、利用者へ確認を依頼する。

現時点で該当するもの:

- 運用パネルの外部MCPサーバー登録欄（#27 / #56）
- 連携資格の停止バッジ（#54）

DEMO モードで見えるものは自分で確認する。ロール別権限パネル（#19 / #55）は「項目定義」タブに表示されるため確認できる。

## 後片付け

自分が作ったタブは閉じる。利用者がサイトを見る状態で終わりたい場合は、開いたまま残してその旨を伝える。

開発サーバーは残してよい。止めるコマンドを報告に添える。

```bash
npm exec supabase -- stop --no-backup   # ローカル Supabase を止める場合
```

## 対象外

- 画面幅ごとの検証（レスポンシブ）
- アクセシビリティの体系的検査（`eslint-plugin-jsx-a11y` と `axe-core` に任せる）
- 認証操作の代行
- スクリーンショットの自動比較による回帰検出
