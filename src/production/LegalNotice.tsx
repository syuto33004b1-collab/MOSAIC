import { useEffect, useRef } from "react";
import { withoutLegalSearch } from "../legal";
import { ProductionFrame } from "./ProductionFrame";

const PATHS = [
  {
    name: "AI秘書",
    detail: "会話と、tool が読んだ業務データが、接続しているモデル提供者へ渡ります。氏名・職種・所属・スキル・稼働など、従業員の個人データを含み得ます。",
  },
  {
    name: "外部MCP Client",
    detail: "管理者が登録した社外 MCP サーバーへ、承認した tool の範囲で渡ります。書込みは、利用者が確認したあとだけ送ります。",
  },
  {
    name: "Webhook",
    detail: "登録した HTTPS の宛先へ、ワークスペースの保存と業務データの変更が通知されます。",
  },
  {
    name: "外部API",
    detail: "発行した連携資格の範囲で、社外の呼び出し元が参照・更新できます。",
  },
  {
    name: "Remote MCP",
    detail: "発行した連携資格を持つ外部の AI ホストが、ワークスペースを参照できます。確認のあと、気づきを組織へ残せます。",
  },
  {
    name: "Google ログイン",
    detail: "Google を身元提供者として認証します。ブラウザが Google の同意画面へ渡り、メール・氏名など Google アカウントの識別情報が Supabase Auth へ戻ります。配員・稼働などの業務データは Google へ送りません。ボタンは、この配信で Google ログインが有効なときにだけ出ます。公開サインアップは無効です。",
  },
] as const;

function DraftNote() {
  return (
    <p className="production-legal-draft" role="note">
      【差し替え箇所】法務レビュー前の草案です。この節は契約でも、確定したプライバシーポリシーでもありません。確定文面が用意でき次第、ここを差し替えます。
    </p>
  );
}

export function LegalNotice() {
  const firstLinkRef = useRef<HTMLAnchorElement>(null);

  useEffect(() => {
    firstLinkRef.current?.focus();
  }, []);

  return (
    <ProductionFrame
      eyebrow="POLICIES"
      title="プライバシーと利用規約"
      description="ログインの前後どちらからでも読めます。社外へ出る経路は、下の事実の一覧を正とします。"
      sidebarLabel="LEGAL"
      sidebarDescription="公開文書"
    >
      <div className="production-legal">
        <nav className="production-legal-toc" aria-label="この文書の節">
          <a ref={firstLinkRef} href="#legal-outbound">社外へ出る経路</a>
          <a href="#legal-privacy">プライバシーポリシー</a>
          <a href="#legal-terms">利用規約</a>
        </nav>

        <section className="production-legal-facts" aria-labelledby="legal-outbound">
          <h2 id="legal-outbound">社外へ出る経路</h2>
          <p>今日時点でコードから確定できる経路です。保持期間、学習利用、暗号化、接続先の製品名は、この画面では約束しません。経路が増えたときは、この一覧を更新します。</p>
          <div className="production-legal-table-wrap">
            <table className="production-legal-paths">
              <caption className="sr-only">社外へデータが出る経路</caption>
              <thead>
                <tr><th scope="col">経路</th><th scope="col">何が出ていくか</th></tr>
              </thead>
              <tbody>
                {PATHS.map((path) => (
                  <tr key={path.name}>
                    <th scope="row">{path.name}</th>
                    <td>{path.detail}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="production-legal-draft-block" aria-labelledby="legal-privacy">
          <h2 id="legal-privacy">プライバシーポリシー</h2>
          <DraftNote />
          <ul>
            <li>取得する情報 — 未記載</li>
            <li>利用目的 — 未記載</li>
            <li>保管と委託 — 未記載</li>
            <li>開示・提供 — 未記載</li>
            <li>開示請求などの窓口 — 未記載</li>
          </ul>
        </section>

        <section className="production-legal-draft-block" aria-labelledby="legal-terms">
          <h2 id="legal-terms">利用規約</h2>
          <DraftNote />
          <ul>
            <li>利用条件 — 未記載</li>
            <li>禁止事項 — 未記載</li>
            <li>免責 — 未記載</li>
            <li>準拠法 — 未記載</li>
          </ul>
        </section>

        <a className="drawer-secondary production-legal-back" href={withoutLegalSearch(window.location)}>MOSAIC に戻る</a>
      </div>
    </ProductionFrame>
  );
}
