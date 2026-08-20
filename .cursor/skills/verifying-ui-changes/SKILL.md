---
name: verifying-ui-changes
description: Use before opening a pull request whose diff changes anything that renders — components and hooks under src/ (.tsx or .ts), any CSS, index.html, images, fonts or other assets, and any addition, move, relabelling, or removal of a control, label, form field, or screen. Also use when the user asks to check the screen, look at the UI, or confirm a layout. Run this before evaluating-with-senior. Do not use when nothing renders differently, such as SQL, Edge Functions, tests, or documentation only.
---

# UI 変更の描画確認

順序・原則・**発火条件**は [AGENTS.md](../../../AGENTS.md) が唯一の出典。ここには**手段**だけを書く。発火条件をここで広げたり狭めたりしない。

Testing Library のテストが通っていることは、**この確認を省く理由にならない**。文字列の存在は確認できるが、レイアウト崩れ、はみ出し、重なり、切詰めは検出できない。

`evaluating-with-senior` の**前**に通す。UI の問題を直してから評価にかける。

## 1. 確認対象を列挙する

**「対象画面」は単数ではない。** 差分から画面 × 状態の組み合わせを列挙してから見る。あとで「見た気がする」で埋めない。

- 初期表示 / 入力後 / 検証エラー / 送信中（disabled・loading）
- 開閉するもの（ドロワー、モーダル、アコーディオン）は開いた状態と閉じた状態
- 一覧は 0件 / 1件 / 複数件
- 権限で表示が変わるならその分岐ごと

列挙した各行が、最後の報告テンプレートの行になる。

## 2. 開発サーバーを起動し、実際の URL を確認する

```bash
npm run dev    # vite --host 127.0.0.1
```

**ポートが埋まっていると別ポートで起動する。** 出力された URL を使い、`5173` を決め打ちしない。決め打ちすると別プロセスの画面を自分の変更だと誤認する。

起動後、画面の表示でモードを確認する。`.env` の有無は環境依存なので前提にしない。

- `DEMO` バッジ → デモモード。認証不要、サンプルデータ
- `SHARED` バッジ → 共有モード。後述の制約がある

## 3. 画面を見る

**手段は Cursor 側で使えるブラウザ機能に委ねる。** スクリーンショットが撮れる手段を使う。撮れないなら、そのことを報告に書く（後述）。

狭い幅も見る。**変更箇所は desktop と narrow の2幅で確認する。** フォームや権限パネルは `flex-wrap` と grid を使っており、折返し・重なり・切れは狭幅で出る。

幅を変えたら**元に戻す**。

### 撮った画像が空でないことを確認する

**白画像を証拠にしない。** ブラウザが再接続したりページ選択が失われると、真っ白なスクリーンショットが撮れる。Claude Code 側では実際にそれを評価へ添付して Critical を受けた。

- 保存した画像を**自分で開いて中身を見る**
- 機械的にも判定できる。伸張後のユニークバイト数が極端に少なければ単色である（実測: 白画像 3、実画像 253）。ファイルサイズも目安になる（実測: 15 KB 対 99 KB）
- **ファイル名は毎回変える。** 同名を使い回すと古い画像や前回の白画像を誤って使う

## 4. 見た目を測る（スクリーンショットだけで判断しない）

**スクリーンショットの幅とビューポートの幅は一致しない。** 実測ではスクリーンショット 1540px に対し `clientWidth` 1525px で、画像上はカード右端が切れて「はみ出している」ように見えたが、実際にはオーバーフローしていなかった。

ページ上で次を評価する。

```javascript
const de = document.documentElement;
const target = document.querySelector('<変更したコンテナのセレクタ>');
const out = [...document.querySelectorAll('body *')]
  .map(el => ({ el, r: el.getBoundingClientRect() }))
  .filter(({ r }) => r.width > 0 && (r.right > de.clientWidth + 1 || r.left < -1))
  .slice(0, 8)
  .map(({ el, r }) => ({ cls: (el.className || el.tagName).toString().slice(0, 40), left: Math.round(r.left), right: Math.round(r.right) }));
({
  horizontalOverflow: de.scrollWidth > de.clientWidth,
  docScrollW: de.scrollWidth, docClientW: de.clientWidth,
  outOfBounds: out,
  targetClipped: target ? { scrollW: target.scrollWidth, clientW: target.clientWidth, scrollH: target.scrollHeight, clientH: target.clientHeight } : null,
})
```

CSS を新規に書いたなら、意図した値が効いているかも確認する。

```javascript
getComputedStyle(document.querySelector('.role-permission-form')).gridTemplateColumns
```

### 読み方

`outOfBounds` は**意図的に横スクロールするコンテナで誤検出する**。実測では 375px 幅でアサインボードの `schedule-table` / `schedule-head` / `day-label` が8件並んだが、`horizontalOverflow` は `false` で、週表が自前コンテナ内でスクロールする設計どおりだった。

- `horizontalOverflow` が `true` → **ページ全体が横スクロールしている。不具合**
- `horizontalOverflow` が `false` で `outOfBounds` に要素がある → **自前スクロールのコンテナかもしれない。** 親が `overflow-x: auto` かを確認してから判断する

### 要素同士の重なりは測れる

矩形の交差で検出できる。目視より確実で、この方法で #75 / #96 が見つかった。

```javascript
const vis = el => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el);
  return r.width >= 1 && r.height >= 1 && cs.visibility !== 'hidden' && cs.display !== 'none'; };
const own = el => [...el.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent.trim()).join(' ').trim();
const nodes = [...document.querySelector('<対象コンテナ>').querySelectorAll('*')].filter(el => vis(el) && own(el));
const hits = [];
for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
  const a = nodes[i], b = nodes[j];
  if (a.contains(b) || b.contains(a)) continue;
  const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
  const ox = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left);
  const oy = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top);
  if (ox > 3 && oy > 3) hits.push({ a: own(a).slice(0, 16), b: own(b).slice(0, 16), overlap: `${Math.round(ox)}x${Math.round(oy)}` });
}
({ total: hits.length, sample: hits.slice(0, 5) })
```

**`nodes` を `.slice(0, N)` で切らない。** 切ると範囲外の重なりを「0件」と報告することになる（#96 でそれをやった）。重いなら件数ではなく対象を絞る。

検出できるのは左右のはみ出し、対象コンテナの clip、要素同士の重なりまで。**文字の切詰めが許容できるかの判断と、視覚的な階層・整列の良し悪しは測れない。** それらはスクリーンショットの目視で見る。

### ラベルから到達できるか

「存在する」ではなく、**`label` が関連付いていること**を確認する。

```javascript
[...document.querySelectorAll('input,select,textarea')]
  .filter(el => !el.labels?.length && !el.getAttribute('aria-label') && !el.getAttribute('aria-labelledby'))
  .map(el => el.outerHTML.slice(0, 80))
```

出力が空でなければラベルの無いコントロールが残っている。

### 色を変えたなら

配色やコントラストを変更した場合のみ、読めるかを目視で見る。**体系的なコントラスト検査は行わない**（`eslint-plugin-jsx-a11y` と `axe-core` に任せる）。

## 5. エラーを確認する

- ブラウザのコンソールエラー
- 開発サーバーの出力

コンソール追跡が「呼び出し時に開始」する仕組みなら、**先に追跡を始めてからリロード**する。あとで呼ぶと初期ロードのエラーを取り逃す。

## 6. 報告テンプレート（必須）

**1で列挙した全対象について埋める。** 埋まっていない行を残したまま完了にしない。

| 対象（画面 × 状態） | 幅 | 判定 | 根拠 |
| --- | --- | --- | --- |
| 例: 項目定義 / ロール別権限パネル 初期表示 | desktop | 確認済み | スクリーンショット、`horizontalOverflow: false`（1525/1525）、`gridTemplateColumns: 180px 200px` |
| 例: 同上 | mobile 375px | 未確認 | スクリーンショット取得失敗 |

判定は **`確認済み` / `未確認` / `不合格`** の3つだけ。

- `確認済み` と書けるのは、**実際に画像を見て判断した**対象だけ
- 画像が取れていないなら `未確認`。DOM とテキストだけで `確認済み` にしない
- `不合格` があれば直してからやり直す
- **差分が影響する対象に `未確認` が残るなら、評価と PR へ進まず利用者へ判断を仰ぐ**（AGENTS.md の 9）。認証画面に限らない。撮影に失敗した場合も同じ

使ったブラウザ手段と、実際の URL も報告に書く。

## 認証が必要な画面

共有モードの画面はログインが必要で、**認証操作は代行しない**。

該当する画面を変更したら、`未確認` で放置せず**利用者へ確認を依頼し、その結果を報告に記録する**。依頼せずに通すと、その UI は永久に検証されない。

未確認のまま merge するかは**利用者の判断**であり、既定ではない。

現時点で未確認のまま残っているもの。

- 運用パネルの外部MCPサーバー登録欄
- 連携資格の停止バッジ

## 評価者へ渡す証拠

`evaluating-with-senior` の評価者が画像を受け取れる場合は、**`確認済み` と記録した対象の画像を渡す**。画面名・URL・viewport・ファイル名を対応付けて明示する。どの画像が何なのか評価者が判別できない渡し方をしない。

実測値（`horizontalOverflow`、`docScrollW`/`docClientW`、computed style、コンソールエラーの有無）も**テキストとして渡す**。画像だけに頼らない。

画像はリポジトリへコミットしない。

## 対象外

- 体系的なレスポンシブ検証（2幅の smoke check までとする）
- 体系的なアクセシビリティ検査（`eslint-plugin-jsx-a11y` と `axe-core` に任せる）
- 要素の重なり・文字の切詰めの機械検出（目視に頼る）
- 認証操作の代行
- スクリーンショットの自動比較による回帰検出
