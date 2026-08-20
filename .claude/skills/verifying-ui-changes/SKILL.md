---
name: verifying-ui-changes
description: Use before creating a pull request whose diff changes anything that renders — components and hooks under src/ (.tsx or .ts), src/styles.css or any CSS, index.html, images, fonts or other assets, and any addition, move, relabelling, or removal of a control, label, form field, or screen. Also use when the user asks to check the screen, look at the UI, confirm a layout, or verify that a change actually shows up. Run this before the evaluating-before-pr gate. Do not use when nothing renders differently, such as SQL, Edge Functions, tests, or documentation only.
---

# UI 変更の描画確認

Testing Library のテストが通っていることは、**この確認を省く理由にならない**。文字列の存在は確認できるが、レイアウト崩れ、はみ出し、重なり、切詰めは検出できない。

このスキルが無い状態で、UI を4回変更して main へマージした（#19 ロール別権限パネル、#27 外部MCP登録フォーム、#54 資格の停止バッジ、#56 書込tool入力欄）。うち #19 は CSS を新規に書いており、一度も描画を見ていなかった。

順序・原則・**発火条件**は [AGENTS.md](../../../AGENTS.md) が唯一の出典。ここには**手段**だけを書く。発火条件をここで広げたり狭めたりしない。

`evaluating-before-pr` の**前**に通す。UI の問題を直してから評価にかける。

## 1. 確認対象の一覧を先に作る

**「対象画面」は単数ではない。** 差分から、画面 × 状態の組み合わせを列挙する。列挙してから見る。あとで「見た気がする」で埋めない。

状態の例。フォームを変更したなら、要素の存在確認だけで合格にしない。

- 初期表示 / 入力後 / 検証エラー / 送信中（disabled・loading）
- 開閉するもの（ドロワー、モーダル、アコーディオン）は開いた状態と閉じた状態
- 一覧は 0件 / 1件 / 複数件
- 権限で表示が変わるなら、その分岐ごと

列挙した各行が、最後の報告テンプレートの行になる。

## 2. 開発サーバーを起動し、実際の URL を確認する

```
preview_start { name: "mosaic-dev" }
```

`.claude/launch.json` を使う。**ポートが埋まっていると別ポートで起動する。** 返ってきた URL をそのまま使い、`5173` を決め打ちしない。決め打ちすると、別プロセスの画面を自分の変更だと誤認する。

起動後、画面上の表示でモードを確認する。`.env` の有無は環境依存なので前提にしない。

- `DEMO` バッジ → デモモード。認証不要、サンプルデータ
- `SHARED` バッジ → 共有モード。後述の制約がある

## 3. ブラウザを選ぶ

Claude in Chrome を使う。

```
list_connected_browsers   → 利用者へ選択を確認（必須）
select_browser { deviceId }
```

**localhost を開くので、このマシン上のブラウザでなければ到達できない。** 一覧には別マシンのものも並ぶので `isLocal: true` から選んでもらう。

使えない場合は in-app ブラウザ（`Claude_Browser`）を代替とする。**どちらを使ったか報告に書く。**

## 4. コンソール追跡を先に開始する

コンソール追跡は**ツールの初回呼び出し時に始まる**。画面操作のあとに呼ぶと初期ロードのエラーを取り逃す。

```
read_console_messages { onlyErrors: true }   ← 追跡を開始するために先に呼ぶ
navigate { url: <起動時に返された URL> }       ← リロードして初期ロードを捕まえる
read_console_messages { onlyErrors: true }   ← ここで初期ロードのエラーが見える
```

## 5. 各対象を見る

対象ごとにスクリーンショットを撮る。CDP がタイムアウトすることがあるので、失敗したら1回リトライする。

狭い幅も見る。**変更箇所は desktop と narrow の2幅で確認する。** フォームや権限パネルは `flex-wrap` と grid を使っており、折返し・重なり・切れは狭幅で出る。

**幅の変更は in-app ブラウザ（`Claude_Browser`）で行う。** Claude in Chrome の `resize_window` は実測でウィンドウだけを変え、**ページのビューポートは変わらなかった**（420x860 を指定しても `clientWidth` は 1525 のまま）。Chrome 側で幅を指定しても狭幅検証にならない。

```
Claude_Browser.resize_window { preset: "mobile" }    → 375x812、デバイスエミュレーション込み
Claude_Browser.resize_window { preset: "desktop" }   → 戻す
```

役割分担はこうなる。

| 目的 | 使うもの |
| --- | --- |
| 実ブラウザでの見た目、スクリーンショット | Claude in Chrome |
| ビューポート幅を変えた確認 | in-app ブラウザ |

体系的なレスポンシブ検証は対象外だが、2幅の smoke check は行う。幅を変えたら**元に戻す**。

## 6. 見た目を測る（スクリーンショットだけで判断しない）

**スクリーンショットの幅とビューポートの幅は一致しない。** 実測ではスクリーンショット 1540px に対し `clientWidth` 1525px で、画像上はカード右端が切れて「はみ出している」ように見えたが、実際にはオーバーフローしていなかった。見た目だけで崩れを判断しない。

```javascript
const de = document.documentElement;
const target = document.querySelector('<変更したコンテナのセレクタ>');
const out = [...document.querySelectorAll('body *')]
  .map(el => ({ el, r: el.getBoundingClientRect() }))
  .filter(({ r }) => r.right > de.clientWidth + 1 || r.left < -1)
  .slice(0, 8)
  .map(({ el, r }) => ({ cls: (el.className || el.tagName).toString().slice(0, 40), left: Math.round(r.left), right: Math.round(r.right) }));
({
  horizontalOverflow: de.scrollWidth > de.clientWidth,
  docScrollW: de.scrollWidth, docClientW: de.clientWidth,
  outOfBounds: out,
  targetClipped: target ? { scrollW: target.scrollWidth, clientW: target.clientWidth, scrollH: target.scrollHeight, clientH: target.clientHeight } : null,
})
```

CSS を新規に書いたなら、意図した値が実際に効いているかも確認する。

```javascript
getComputedStyle(document.querySelector('.role-permission-form')).gridTemplateColumns
```

### テキスト同士の矩形の交差を洗い出す

これで #75 と #96 が見つかった。ただし**これは不具合の検出ではなく、目視すべき候補の抽出**である。

```javascript
const vis = el => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el);
  return r.width >= 1 && r.height >= 1 && cs.visibility !== 'hidden' && cs.display !== 'none' && +cs.opacity > 0; };
const own = el => [...el.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent.trim()).join(' ').trim();
const where = el => { const b = []; for (let n = el; n && b.length < 3; n = n.parentElement)
  b.unshift(n.tagName.toLowerCase() + (typeof n.className === 'string' && n.className ? '.' + n.className.trim().split(/\s+/)[0] : '')); return b.join('>'); };
const root = document.querySelector('<対象コンテナ>');
const nodes = [...root.querySelectorAll('*')].filter(el => vis(el) && own(el));   // 件数で切らない
const hits = [];
for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
  const a = nodes[i], b = nodes[j];
  if (a.contains(b) || b.contains(a)) continue;   // 親子は重なって当然
  const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
  const ox = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left);
  const oy = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top);
  if (ox > 3 && oy > 3) hits.push({ a: own(a).slice(0, 16), aw: where(a), b: own(b).slice(0, 16), bw: where(b), overlap: `${Math.round(ox)}x${Math.round(oy)}` });
}
({ candidates: hits.length, hits })   // 出力も切らない。切ると分類できない
```

**候補は全件、意図的／不具合に分類してから件数を報告する。** 「重なり0件」と書くなら候補が0件だったということ。「N件」と書くならN件すべてを見て不具合だと判断したということ。

分類が必要な理由 — これは**軸平行な外接矩形の比較にすぎない**ので、次を拾う。

- 複数行に折り返したインライン要素、`transform` が掛かった要素、padding を含む箱（実際には文字が触れていない）
- 意図した重ね合わせ（絶対配置のバッジ、sticky ヘッダー、ダイアログ、装飾）

**取り落とすものもある。** 対象は「自前のテキストノードを持つ要素どうし」なので、`input` の値、画像、SVG、アイコン、疑似要素、子要素の中にだけ文字を持つコンポーネントとの重なりは見ていない。`aria-hidden` は視覚的には見えるので除外していない。**何を対象にしたかを報告に書く。**

**`nodes` も出力も `.slice(0, N)` で切らない。** 切ると範囲外を「0件」と報告することになる（#96 でそれをやった）。O(n²) が重いなら、件数ではなく**全候補ペアを覆えると説明できる単位に分割**し、その範囲を報告に書く。「隣接する要素だけ」のような絞り方は、絶対配置・`transform`・`rowspan`・極端に長い内容で非隣接の重なりを取り落とす。

### 幅0のカラムを洗い出す（可変カラムのテーブルでは必須）

上のスニペットは `r.width >= 1` で絞るので、**幅0の要素は入らない。** 別に測る。

```javascript
const t = document.querySelector('<テーブルのセレクタ>');
const head = t.querySelector('thead tr:last-child');
[...head.children].map((th, i) => {
  const w = Math.round(th.getBoundingClientRect().width);
  const sample = [...t.querySelectorAll('tbody tr')].slice(0, 3)
    .map(r => (r.children[i]?.textContent || '').trim()).find(Boolean) || '';
  return { col: th.textContent.trim() || '(sr-only)', w, starved: w < 24 && sample.length > 0, sample: sample.slice(0, 20) };
}).filter(c => c.starved)
```

**中身があるのに幅が0（または極端に狭い）カラムが1つでもあれば不具合。** `table-layout` と幅指定の組み合わせで起きる（#75）。`<th>` の数が実行時に変わるテーブルでは、**一覧に出す独自項目を0件／1件／複数件にして測り直す。**

**この測定の限界を理解しておく。** 測れるのは、はみ出し、対象コンテナの clip、矩形の交差の候補、幅0のカラム、寸法、コントラストまで。**文字が切れて困るのかどうか、視覚的な階層・整列の良し悪しは測れない。** それらはスクリーンショットの目視で見る。

そして **`outOfBounds` は意図的に横スクロールするコンテナで誤検出する。** 実測では 375px 幅でアサインボードの `schedule-table` / `schedule-head` / `day-label` が8件並んだが、`horizontalOverflow` は `false` で、週表が自前のコンテナ内でスクロールする設計どおりだった。

読み方を分ける。

- `horizontalOverflow`（document レベル）が `true` → **ページ全体が横スクロールしている。不具合**
- `horizontalOverflow` が `false` で `outOfBounds` に要素がある → **自前スクロールのコンテナかもしれない。親が `overflow-x: auto` かを確認してから判断する**

`transform` や意図的な画面外配置も誤検出しうる。

### ラベルから到達できるか

「存在する」ではなく、**`label` が関連付いていること**を DOM で確認する。

```javascript
[...document.querySelectorAll('input,select,textarea')]
  .filter(el => !el.labels?.length && !el.getAttribute('aria-label') && !el.getAttribute('aria-labelledby'))
  .map(el => el.outerHTML.slice(0, 80))
```

出力が空でなければ、ラベルの無いコントロールが残っている。

### 色を変えたなら

配色やコントラストを変更した場合のみ、スクリーンショットで読めるかを目視で見る。**体系的なコントラスト検査は行わない**（`eslint-plugin-jsx-a11y` と `axe-core` に任せる）。色を変えていないなら見る必要はない。

## 7. 報告テンプレート（必須）

**1で列挙した全対象について、この表を埋める。** 埋まっていない行を残したまま完了にしない。

| 対象（画面 × 状態） | 幅 | 判定 | 根拠 |
| --- | --- | --- | --- |
| 例: 項目定義 / ロール別権限パネル 初期表示 | desktop | 確認済み | Chrome でスクリーンショット、`horizontalOverflow: false`（1525/1525）、`gridTemplateColumns: 180px 200px` |
| 例: 同上 | mobile 375px | 未確認 | スクリーンショット取得失敗 |

判定は **`確認済み` / `未確認` / `不合格`** の3つだけ。

- `確認済み` と書けるのは、**実際にスクリーンショットを見て判断した**対象だけ
- スクリーンショットが取れていないなら `未確認`。DOM とテキストだけで `確認済み` にしない
- `不合格` があれば直してからやり直す
- **差分が影響する対象に `未確認` が残るなら、評価と PR へ進まず利用者へ判断を仰ぐ**（AGENTS.md の 9）。認証画面に限らない。撮影に失敗した場合も同じ

使ったブラウザ（Claude in Chrome / in-app）と、実際の URL も報告に書く。

## 評価者へ渡す画像を残す

`evaluating-before-pr` は UI 差分のときスクリーンショットを `-i` で添付する。そのためのファイルをここで作る。

**現行環境でファイル保存を確認できたのは chrome-devtools の `take_screenshot { filePath }` だけ**（`claude-in-chrome` の `save_to_disk` は保存先を特定できず、`Claude_Browser` にはパラメータが無い）。

```
chrome-devtools.list_pages                     ← 選択中のページを確認する
chrome-devtools.new_page { url: <起動時の URL> } ← about:blank なら開き直す
chrome-devtools.take_screenshot { filePath: "<scratchpad>/ui-<画面>-<幅>-<連番>.png", format: "png" }
```

**白画像を残さない。** ブラウザが再接続すると選択ページが `about:blank` に戻り、そのまま撮ると真っ白になる。実際にそれを評価へ添付して Critical を受けた。

1. `list_pages` で選択中のページが対象 URL であることを確認する
2. 保存後、**画像を自分で `Read` して中身を見る**
3. 機械的にも確認できる。伸張後のユニークバイト数が極端に少なければ単色である（実測: 白画像 3、実画像 253）。ファイルサイズも目安（実測: 15 KB 対 99 KB）

**ファイル名は毎回変える。** 同名を使い回すと古い画像や前回の白画像を誤って添付する。

`確認済み` と判定した対象から残す。desktop と narrow を各1枚が基本で、状態で見た目が変わるものはその状態も残す。scratchpad に置き、リポジトリへはコミットしない。

残した画像について、**画面名・URL・viewport・ファイル名**を対応表に併記する。評価ゲートがそのままブリーフへ写せるようにする。

## 認証が必要な画面

共有モードの画面はログインが必要で、**認証操作は代行しない**。

該当する画面を変更した場合、`未確認` のままにせず**利用者へ確認を依頼し、その結果を報告に記録する**。依頼せずに `未確認` で通すと、その UI は永久に検証されない。直近4件のうち2件（#27 外部MCP登録欄、#54 資格の停止バッジ）が既にこの状態にある。

未確認のまま merge するかは**利用者の判断**であり、既定ではない。依頼した事実と、利用者の回答（確認した / 未確認で進める）を PR 本文へ書く。

## 後片付け

自分が作ったタブは閉じる。利用者がサイトを見る状態で終わりたい場合は開いたまま残し、その旨を伝える。

停止コマンドを報告に添える。

```
preview_stop { serverId }                  # 開発サーバー
npm exec supabase -- stop --no-backup      # ローカル Supabase を起動していた場合
```

## 対象外

- 体系的なレスポンシブ検証（2幅の smoke check までとする）
- 体系的なアクセシビリティ検査（`eslint-plugin-jsx-a11y` と `axe-core` に任せる）
- 文字の切詰めが許容できるかの判断、視覚的な階層・整列の評価（目視に頼る）
- 認証操作の代行
- スクリーンショットの自動比較による回帰検出
