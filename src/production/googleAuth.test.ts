import { afterEach, describe, expect, it, vi } from "vitest";
import { isGoogleAuthEnabled } from "./googleAuth";

describe("isGoogleAuthEnabled", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("is on only for the exact true flag", () => {
    expect(isGoogleAuthEnabled("true")).toBe(true);
    expect(isGoogleAuthEnabled("TRUE")).toBe(true);
    expect(isGoogleAuthEnabled(" true ")).toBe(true);
  });

  it("is off for missing, empty, and other values", () => {
    vi.stubEnv("VITE_ENABLE_GOOGLE_AUTH", "");
    expect(isGoogleAuthEnabled()).toBe(false);
    expect(isGoogleAuthEnabled(undefined)).toBe(false);
    expect(isGoogleAuthEnabled("")).toBe(false);
    expect(isGoogleAuthEnabled("false")).toBe(false);
    expect(isGoogleAuthEnabled("1")).toBe(false);
  });

  it("reads the Vite env when called without an argument", () => {
    vi.stubEnv("VITE_ENABLE_GOOGLE_AUTH", "true");
    expect(isGoogleAuthEnabled()).toBe(true);
    vi.stubEnv("VITE_ENABLE_GOOGLE_AUTH", "false");
    expect(isGoogleAuthEnabled()).toBe(false);
  });
});
