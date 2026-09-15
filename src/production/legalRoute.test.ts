import { describe, expect, it } from "vitest";
import { shouldShowLegalNotice } from "./legalRoute";

describe("shouldShowLegalNotice", () => {
  it("opens on legal=1 and ignores other spellings", () => {
    expect(shouldShowLegalNotice("?legal=1")).toBe(true);
    expect(shouldShowLegalNotice("?legal=privacy")).toBe(false);
  });

  it("lets an auth callback consume the URL first", () => {
    expect(shouldShowLegalNotice("?legal=1&code=abc")).toBe(false);
    expect(shouldShowLegalNotice("?legal=1", "#access_token=tok")).toBe(false);
    expect(shouldShowLegalNotice("?legal=1&type=recovery")).toBe(false);
    expect(shouldShowLegalNotice("?legal=1&error=access_denied")).toBe(false);
  });
});
