import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { describe, expect, it, vi } from "vitest";
import { AuthScreen } from "./AuthScreen";

function renderAuth(overrides: Partial<Parameters<typeof AuthScreen>[0]> = {}) {
  const props = {
    onSignIn: vi.fn().mockResolvedValue(undefined),
    onRequestReset: vi.fn().mockResolvedValue(undefined),
    onUpdatePassword: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
  const view = render(<AuthScreen {...props} />);
  return { ...props, ...view };
}

describe("AuthScreen password recovery", () => {
  it("lets a visitor request a reset email and always shows the same sent message", async () => {
    const user = userEvent.setup();
    const { onRequestReset } = renderAuth();

    await user.click(screen.getByRole("button", { name: "パスワードを忘れた場合" }));
    await user.type(screen.getByLabelText("メールアドレス"), "unknown@example.jp");
    await user.click(screen.getByRole("button", { name: "再設定メールを送る" }));

    expect(onRequestReset).toHaveBeenCalledWith("unknown@example.jp");
    expect(await screen.findByRole("status")).toHaveTextContent("再設定手順を送信しました");
    expect(screen.queryByText(/存在/)).not.toBeInTheDocument();
    expect(screen.queryByText(/登録/)).not.toBeInTheDocument();
  });

  it("updates the password from a recovery session after matching confirmation", async () => {
    const user = userEvent.setup();
    const { onUpdatePassword } = renderAuth({ mode: "update-password" });

    await user.type(screen.getByLabelText("新しいパスワード"), "NewPassword12");
    await user.type(screen.getByLabelText("新しいパスワード（確認）"), "NewPassword12");
    await user.click(screen.getByRole("button", { name: "パスワードを更新" }));

    expect(onUpdatePassword).toHaveBeenCalledWith("NewPassword12");
  });

  it("does not submit mismatched confirmation and keeps the values in the form", async () => {
    const user = userEvent.setup();
    const { onUpdatePassword } = renderAuth({ mode: "update-password" });

    await user.type(screen.getByLabelText("新しいパスワード"), "NewPassword12");
    await user.type(screen.getByLabelText("新しいパスワード（確認）"), "OtherPassword12");
    await user.click(screen.getByRole("button", { name: "パスワードを更新" }));

    expect(onUpdatePassword).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("確認用パスワードが一致しません");
  });

  it("returns to login from the reset request without cancelling a recovery session", async () => {
    const user = userEvent.setup();
    const onCancelRecovery = vi.fn();
    renderAuth({ onCancelRecovery });

    await user.click(screen.getByRole("button", { name: "パスワードを忘れた場合" }));
    await user.click(screen.getByRole("button", { name: "ログインに戻る" }));

    expect(onCancelRecovery).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "ログイン" })).toBeInTheDocument();
  });

  it("explains an invalid recovery link without repeating provider text", () => {
    renderAuth({
      mode: "invalid-link",
      recoveryMessage: "再設定リンクの有効期限が切れています。もう一度メールを送信してください。",
    });

    expect(screen.getByRole("alert")).toHaveTextContent("有効期限が切れています");
    expect(screen.queryByText(/Email link/i)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "再設定メールを送る" })).toBeInTheDocument();
  });

  it("has no serious automatic accessibility violations on login and reset request", async () => {
    const login = renderAuth();
    const loginResults = await axe.run(login.container, { rules: { "color-contrast": { enabled: false } } });
    expect(loginResults.violations.filter((violation) => violation.impact === "serious" || violation.impact === "critical")).toEqual([]);
    login.unmount();

    const reset = renderAuth();
    await userEvent.setup().click(screen.getByRole("button", { name: "パスワードを忘れた場合" }));
    const resetResults = await axe.run(reset.container, { rules: { "color-contrast": { enabled: false } } });
    expect(resetResults.violations.filter((violation) => violation.impact === "serious" || violation.impact === "critical")).toEqual([]);
  });
});

describe("AuthScreen invite onboarding", () => {
  it("completes first-time setup after matching confirmation", async () => {
    const user = userEvent.setup();
    const onCompleteOnboarding = vi.fn().mockResolvedValue(undefined);
    renderAuth({ mode: "onboard", onCompleteOnboarding });

    await user.type(screen.getByLabelText("表示名"), "招待 花子");
    await user.type(screen.getByLabelText("新しいパスワード"), "NewPassword12");
    await user.type(screen.getByLabelText("新しいパスワード（確認）"), "NewPassword12");
    await user.click(screen.getByRole("button", { name: "登録を完了" }));

    expect(onCompleteOnboarding).toHaveBeenCalledWith("招待 花子", "NewPassword12");
  });

  it("does not submit mismatched confirmation on the onboarding form", async () => {
    const user = userEvent.setup();
    const onCompleteOnboarding = vi.fn().mockResolvedValue(undefined);
    renderAuth({ mode: "onboard", onCompleteOnboarding });

    await user.type(screen.getByLabelText("表示名"), "招待 花子");
    await user.type(screen.getByLabelText("新しいパスワード"), "NewPassword12");
    await user.type(screen.getByLabelText("新しいパスワード（確認）"), "OtherPassword12");
    await user.click(screen.getByRole("button", { name: "登録を完了" }));

    expect(onCompleteOnboarding).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("確認用パスワードが一致しません");
  });
});

describe("AuthScreen Google sign-in", () => {
  it("hides the Google button unless the flag and handler are both present", () => {
    const missingHandler = renderAuth({ googleAuthEnabled: true });
    expect(screen.queryByRole("button", { name: "Google でログイン" })).not.toBeInTheDocument();
    missingHandler.unmount();

    renderAuth();
    expect(screen.queryByRole("button", { name: "Google でログイン" })).not.toBeInTheDocument();
  });

  it("starts Google sign-in without requiring the password form", async () => {
    const user = userEvent.setup();
    const onGoogleSignIn = vi.fn().mockResolvedValue(undefined);
    renderAuth({ googleAuthEnabled: true, onGoogleSignIn });

    await user.click(screen.getByRole("button", { name: "Google でログイン" }));

    expect(onGoogleSignIn).toHaveBeenCalledTimes(1);
  });

  it("keeps the password submit label while Google is redirecting", async () => {
    const user = userEvent.setup();
    let release: () => void = () => undefined;
    const onGoogleSignIn = vi.fn().mockImplementation(() => new Promise<void>((resolve) => {
      release = resolve;
    }));
    renderAuth({ googleAuthEnabled: true, onGoogleSignIn });

    await user.click(screen.getByRole("button", { name: "Google でログイン" }));

    expect(screen.getByRole("button", { name: "Google へ移動しています…" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "ログイン" })).toBeDisabled();
    release();
    expect(await screen.findByRole("button", { name: "Google でログイン" })).toBeEnabled();
  });

  it("does not show Google on recovery or onboarding", () => {
    const onGoogleSignIn = vi.fn();
    const recovery = renderAuth({ mode: "update-password", googleAuthEnabled: true, onGoogleSignIn });
    expect(screen.queryByRole("button", { name: "Google でログイン" })).not.toBeInTheDocument();
    recovery.unmount();

    renderAuth({ mode: "onboard", googleAuthEnabled: true, onGoogleSignIn, onCompleteOnboarding: vi.fn() });
    expect(screen.queryByRole("button", { name: "Google でログイン" })).not.toBeInTheDocument();
  });

  it("shows a Google callback error on the login form", () => {
    renderAuth({ initialError: "Google でのログインをキャンセルしました。メールとパスワードで続けるか、もう一度お試しください。" });
    expect(screen.getByRole("alert")).toHaveTextContent("キャンセル");
    expect(screen.queryByRole("button", { name: "再設定メールを送る" })).not.toBeInTheDocument();
  });

  it("keeps a legal notice link on the login form", () => {
    renderAuth();
    expect(screen.getByRole("link", { name: "プライバシーポリシーと利用規約" })).toHaveAttribute("href", expect.stringContaining("legal=1"));
  });

  it("places a legal notice link next to the Google button", () => {
    renderAuth({ googleAuthEnabled: true, onGoogleSignIn: vi.fn() });
    const links = screen.getAllByRole("link", { name: "プライバシーポリシーと利用規約" });
    expect(links).toHaveLength(2);
    expect(screen.getByText(/Google でログインする前に/)).toBeInTheDocument();
  });
});
