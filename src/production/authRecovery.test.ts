import { afterEach, describe, expect, it } from "vitest";
import { appAuthRedirectUrl, authCallbackNotice, hasAuthCallbackParams, oauthCallbackError, passwordRecoveryLinkError } from "./authRecovery";
import { markOAuthPending } from "./oauthPending";

afterEach(() => {
  sessionStorage.clear();
});

describe("password recovery callback helpers", () => {
  it("builds the current origin and app base as the reset redirect", () => {
    expect(appAuthRedirectUrl("https://mosaic.example.workers.dev", "/")).toBe("https://mosaic.example.workers.dev/");
    expect(appAuthRedirectUrl("http://127.0.0.1:5173", "/")).toBe("http://127.0.0.1:5173/");
    expect(appAuthRedirectUrl("https://pages.example.test", "/app/")).toBe("https://pages.example.test/app/");
  });

  it("maps expired recovery links without exposing the provider description", () => {
    const message = passwordRecoveryLinkError(
      "",
      "#error=access_denied&error_code=otp_expired&error_description=Email%20link%20is%20invalid%20or%20has%20expired",
    );
    expect(message).toContain("有効期限");
    expect(message).not.toContain("Email link");
    expect(message).not.toContain("invalid or has expired");
  });

  it("maps other recovery callback errors to a generic retry message", () => {
    const message = passwordRecoveryLinkError("?error=access_denied&error_code=flow_state_not_found", "");
    expect(message).toContain("利用できません");
    expect(message).not.toContain("flow_state_not_found");
  });

  it("returns no error when the location is a normal login URL", () => {
    expect(passwordRecoveryLinkError("", "")).toBe("");
    expect(passwordRecoveryLinkError("?invitation=abc", "")).toBe("");
  });

  it("detects recovery callback parameters before the session is ready", () => {
    expect(hasAuthCallbackParams("?code=pkce-code", "")).toBe(true);
    expect(hasAuthCallbackParams("", "#type=recovery&access_token=token")).toBe(true);
    expect(hasAuthCallbackParams("?type=invite&code=pkce-code", "")).toBe(true);
    expect(hasAuthCallbackParams("?error=access_denied", "")).toBe(true);
    expect(hasAuthCallbackParams("?invitation=abc", "")).toBe(false);
  });
});

describe("OAuth callback errors", () => {
  it("maps cancel and signup-disabled without exposing provider text", () => {
    const cancelled = oauthCallbackError("?error=access_denied&error_description=The+user+denied", "");
    expect(cancelled).toContain("キャンセル");
    expect(cancelled).not.toContain("denied");

    const blocked = oauthCallbackError("?error=access_denied&error_code=signup_disabled&error_description=Signups+not+allowed", "");
    expect(blocked).toContain("招待");
    expect(blocked).not.toContain("Signups");
    expect(blocked).not.toContain("signup_disabled");

    const other = oauthCallbackError("?error=server_error&error_code=unexpected_failure", "");
    expect(other).toContain("Google でログインできませんでした");
    expect(other).not.toContain("unexpected_failure");

    const deniedUnknown = oauthCallbackError("?error=access_denied&error_code=unexpected_failure", "");
    expect(deniedUnknown).toContain("Google でログインできませんでした");
    expect(deniedUnknown).not.toContain("キャンセル");
    expect(deniedUnknown).not.toContain("unexpected_failure");
  });

  it("classifies a pending OAuth error separately from a recovery link error", () => {
    expect(authCallbackNotice("?error=access_denied", "").recoveryError).toContain("利用できません");
    expect(authCallbackNotice("?error=access_denied", "").oauthError).toBe("");

    markOAuthPending("google");
    const pending = authCallbackNotice("?error=access_denied", "");
    expect(pending.oauthError).toContain("キャンセル");
    expect(pending.recoveryError).toBe("");
  });
});
