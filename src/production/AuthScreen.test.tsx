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
