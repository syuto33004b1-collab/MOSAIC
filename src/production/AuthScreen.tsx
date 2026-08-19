import { useState, type FormEvent } from "react";
import { Check, KeyRound, LockKeyhole, ShieldCheck } from "lucide-react";
import { ProductionFrame } from "./ProductionFrame";

export type AuthScreenMode = "sign-in" | "update-password" | "onboard" | "invalid-link";

type AuthScreenProps = {
  mode?: AuthScreenMode;
  recoveryMessage?: string;
  onSignIn: (email: string, password: string) => Promise<void>;
  onRequestReset: (email: string) => Promise<void>;
  onUpdatePassword: (password: string) => Promise<void>;
  onCompleteOnboarding?: (displayName: string, password: string) => Promise<void>;
  onCancelRecovery?: () => void;
};

type AuthView = "login" | "request" | "sent" | "update" | "onboard";

function messageFrom(error: unknown) {
  return error instanceof Error ? error.message : "処理を完了できませんでした。もう一度お試しください。";
}

function initialView(mode: AuthScreenMode): AuthView {
  if (mode === "update-password") return "update";
  if (mode === "onboard") return "onboard";
  if (mode === "invalid-link") return "request";
  return "login";
}

export function AuthScreen({
  mode = "sign-in",
  recoveryMessage = "",
  onSignIn,
  onRequestReset,
  onUpdatePassword,
  onCompleteOnboarding,
  onCancelRecovery,
}: AuthScreenProps) {
  const [view, setView] = useState<AuthView>(() => initialView(mode));
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(mode === "invalid-link" ? recoveryMessage : "");

  const heading = view === "onboard"
    ? "表示名とパスワードを設定"
    : view === "update"
      ? "新しいパスワードを設定"
      : view === "login"
        ? "MOSAICへログイン"
        : "パスワードを再設定";
  const title = view === "onboard"
    ? "アカウントを有効にする"
    : view === "update"
      ? "パスワードを再設定"
      : view === "login"
        ? "チームの計画へログイン"
        : "パスワードを再設定";
  const description = view === "onboard"
    ? "招待を確認しました。表示名とパスワードを設定すると、対象の組織へ参加できます。"
    : view === "update"
      ? "再設定リンクを確認しました。新しいパスワードを入力してください。"
      : view === "login"
        ? "共有アサインと変更履歴は、認証されたメンバーだけが利用できます。"
        : "メールアドレスへ、再設定手順を送ります。";

  const handleSignIn = async (event: FormEvent<HTMLFormElement>) => {
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

  const handleRequestReset = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError("");
    try {
      await onRequestReset(email.trim());
      setView("sent");
    } catch (reason) {
      setError(messageFrom(reason));
    } finally {
      setSubmitting(false);
    }
  };

  const handleUpdatePassword = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting) return;
    if (password !== confirmPassword) {
      setError("確認用パスワードが一致しません");
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      await onUpdatePassword(password);
    } catch (reason) {
      setError(messageFrom(reason));
    } finally {
      setSubmitting(false);
    }
  };

  const handleOnboard = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting) return;
    if (!displayName.trim()) {
      setError("表示名を入力してください。");
      return;
    }
    if (password !== confirmPassword) {
      setError("確認用パスワードが一致しません");
      return;
    }
    if (!onCompleteOnboarding) {
      setError("初回設定を完了できませんでした。もう一度お試しください。");
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      await onCompleteOnboarding(displayName.trim(), password);
    } catch (reason) {
      setError(messageFrom(reason));
    } finally {
      setSubmitting(false);
    }
  };

  const backToLogin = () => {
    setView("login");
    setError("");
    setPassword("");
    setConfirmPassword("");
    setDisplayName("");
    if (mode !== "sign-in") onCancelRecovery?.();
  };

  const submitHandler = view === "login"
    ? handleSignIn
    : view === "update"
      ? handleUpdatePassword
      : view === "onboard"
        ? handleOnboard
        : handleRequestReset;

  return (
    <ProductionFrame
      eyebrow="SECURE TEAM ACCESS"
      title={title}
      description={description}
      sidebarLabel="SECURE"
      sidebarDescription="認証済みアクセス"
    >
      <form className="assignment-form production-auth-form" onSubmit={submitHandler}>
        <div className="drawer-heading">
          <span className="drawer-icon cobalt">{view === "update" || view === "onboard" ? <KeyRound size={19} /> : <LockKeyhole size={19} />}</span>
          <div>
            <h2>{heading}</h2>
            <p>
              {view === "login" && "管理者から案内された業務用アカウントを使用してください。"}
              {view === "request" && "届かない場合は、迷惑メールフォルダを確認するか、管理者に連絡してください。"}
              {view === "sent" && "届かない場合は、迷惑メールフォルダを確認するか、管理者に連絡してください。"}
              {view === "update" && "この画面を閉じると、再設定リンクは無効になります。"}
              {view === "onboard" && "この画面を閉じると、招待リンクは無効になります。"}
            </p>
          </div>
        </div>

        {view !== "update" && view !== "sent" && view !== "onboard" && (
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
        )}

        {view === "login" && (
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
        )}

        {view === "onboard" && (
          <label>
            表示名
            <input
              required
              autoComplete="name"
              type="text"
              maxLength={120}
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              placeholder="山田 太郎"
            />
          </label>
        )}

        {(view === "update" || view === "onboard") && (
          <>
            <label>
              新しいパスワード
              <input
                required
                autoComplete="new-password"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="12文字以上"
              />
            </label>
            <label>
              新しいパスワード（確認）
              <input
                required
                autoComplete="new-password"
                type="password"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                placeholder="もう一度入力"
              />
            </label>
          </>
        )}

        {error && <div className="form-note production-error" role="alert"><ShieldCheck size={15} /><span>{error}</span></div>}
        {!error && view === "login" && (
          <div className="form-note"><ShieldCheck size={15} /><span>公開サインアップは無効です。組織の管理者から招待を受けた方だけが利用できます。</span></div>
        )}
        {!error && view === "sent" && (
          <div className="form-note" role="status">
            <Check size={15} />
            <span>入力されたメールアドレスに、再設定手順を送信しました。届かない場合は、迷惑メールフォルダを確認するか、管理者に連絡してください。</span>
          </div>
        )}

        {view === "login" && (
          <>
            <button className="drawer-primary" type="submit" disabled={submitting} aria-busy={submitting}>
              <Check size={16} />{submitting ? "確認しています…" : "ログイン"}
            </button>
            <button className="production-auth-link" type="button" onClick={() => { setView("request"); setError(""); }}>
              パスワードを忘れた場合
            </button>
          </>
        )}

        {view === "request" && (
          <>
            <button className="drawer-primary" type="submit" disabled={submitting} aria-busy={submitting}>
              <Check size={16} />{submitting ? "送信しています…" : "再設定メールを送る"}
            </button>
            <button className="drawer-secondary" type="button" onClick={backToLogin}>ログインに戻る</button>
          </>
        )}

        {view === "sent" && (
          <button className="drawer-secondary" type="button" onClick={backToLogin}>ログインに戻る</button>
        )}

        {view === "update" && (
          <>
            <button className="drawer-primary" type="submit" disabled={submitting} aria-busy={submitting}>
              <Check size={16} />{submitting ? "更新しています…" : "パスワードを更新"}
            </button>
            <button className="drawer-secondary" type="button" onClick={backToLogin}>ログインに戻る</button>
          </>
        )}

        {view === "onboard" && (
          <>
            <button className="drawer-primary" type="submit" disabled={submitting} aria-busy={submitting}>
              <Check size={16} />{submitting ? "登録しています…" : "登録を完了"}
            </button>
            <button className="drawer-secondary" type="button" onClick={backToLogin}>ログインに戻る</button>
          </>
        )}
      </form>
    </ProductionFrame>
  );
}
