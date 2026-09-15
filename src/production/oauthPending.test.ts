import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { consumeOAuthPending, markOAuthPending, OAUTH_PENDING_TTL_MS, peekOAuthPending } from "./oauthPending";

afterEach(() => {
  vi.useRealTimers();
  sessionStorage.clear();
});

describe("OAuth pending marker", () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it("round-trips a fresh marker", () => {
    expect(peekOAuthPending()).toBeNull();
    markOAuthPending("google");
    expect(peekOAuthPending()).toEqual({ provider: "google" });
    expect(consumeOAuthPending()).toEqual({ provider: "google" });
    expect(peekOAuthPending()).toBeNull();
  });

  it("expires after the TTL", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-15T08:00:00Z"));
    markOAuthPending("google");
    vi.setSystemTime(new Date("2026-09-15T08:00:00Z").getTime() + OAUTH_PENDING_TTL_MS + 1);
    expect(peekOAuthPending()).toBeNull();
    expect(sessionStorage.getItem("mosaic.oauth-pending")).toBeNull();
  });

  it("ignores malformed storage and future timestamps", () => {
    sessionStorage.setItem("mosaic.oauth-pending", "not-json");
    expect(peekOAuthPending()).toBeNull();

    sessionStorage.setItem("mosaic.oauth-pending", JSON.stringify({ provider: "google" }));
    expect(peekOAuthPending()).toBeNull();

    sessionStorage.setItem("mosaic.oauth-pending", JSON.stringify({
      provider: "google",
      at: Date.now() + 10 * 60 * 1000,
    }));
    expect(peekOAuthPending()).toBeNull();
  });
});
