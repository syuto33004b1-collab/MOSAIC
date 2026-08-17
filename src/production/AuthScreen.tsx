import { useState, type FormEvent } from "react";
import { Check, LockKeyhole, ShieldCheck } from "lucide-react";
import { ProductionFrame } from "./ProductionFrame";

type AuthScreenProps = {
  onSignIn: (email: string, password: string) => Promise<void>;
};

function messageFrom(error: unknown) {
  return error instanceof Error ? error.message : "ログインできませんでした。入力内容を確認してください。";
}

export function AuthScreen({ onSignIn }: AuthScreenProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError("");
    try {
      await onSignIn(email.trim(), password);
    } catch (reason) {
      setError(messageFrom(reason));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <ProductionFrame
      eyebrow="SECURE TEAM ACCESS"
      title="チームの計画へログイン"
      description="共有アサインと変更履歴は、認証されたメンバーだけが利用できます。"
      sidebarLabel="SECURE"
      sidebarDescription="認証済みアクセス"
    >
      <form className="assignment-form production-auth-form" onSubmit={handleSubmit}>
        <div className="drawer-heading">
          <span className="drawer-icon cobalt"><LockKeyhole size={19} /></span>
          <div><h2>MOSAICへログイン</h2><p>管理者から案内された業務用アカウントを使用してください。</p></div>
        </div>

        <label>
          メールアドレス
          <input
            required
            autoComplete="email"
            inputMode="email"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="name@company.jp"
          />
        </label>
        <label>
          パスワード
          <input
            required
            autoComplete="current-password"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="パスワード"
          />
        </label>

        {error && <div className="form-note production-error" role="alert"><ShieldCheck size={15} /><span>{error}</span></div>}
        {!error && <div className="form-note"><ShieldCheck size={15} /><span>公開サインアップは無効です。組織の管理者から招待を受けた方だけが利用できます。</span></div>}

        <button className="drawer-primary" type="submit" disabled={submitting}>
          <Check size={16} />{submitting ? "確認しています…" : "ログイン"}
        </button>
      </form>
    </ProductionFrame>
  );
}
