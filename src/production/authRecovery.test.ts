import { describe, expect, it } from "vitest";
import { appAuthRedirectUrl, hasAuthCallbackParams, passwordRecoveryLinkError } from "./authRecovery";

describe("password recovery callback helpers", () => {
  it("builds the current origin and app base as the reset redirect", () => {
    expect(appAuthRedirectUrl("https://syuto33004b1-collab.github.io", "/MOSAIC/")).toBe(
      "https://syuto33004b1-collab.github.io/MOSAIC/",
    );
    expect(appAuthRedirectUrl("http://127.0.0.1:5173", "/MOSAIC/")).toBe("http://127.0.0.1:5173/MOSAIC/");
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
    expect(hasAuthCallbackParams("?invitation=abc", "")).toBe(false);
  });
});
