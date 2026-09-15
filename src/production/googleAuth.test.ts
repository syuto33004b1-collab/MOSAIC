import { describe, expect, it } from "vitest";
import { isGoogleAuthEnabled } from "./googleAuth";

describe("isGoogleAuthEnabled", () => {
  it("is on only for the exact true flag", () => {
    expect(isGoogleAuthEnabled("true")).toBe(true);
    expect(isGoogleAuthEnabled("TRUE")).toBe(true);
    expect(isGoogleAuthEnabled(" true ")).toBe(true);
  });

  it("is off for missing, empty, and other values", () => {
    expect(isGoogleAuthEnabled(undefined)).toBe(false);
    expect(isGoogleAuthEnabled("")).toBe(false);
    expect(isGoogleAuthEnabled("false")).toBe(false);
    expect(isGoogleAuthEnabled("1")).toBe(false);
  });
});
