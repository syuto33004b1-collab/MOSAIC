import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getSupabaseRuntimeConfiguration } from "./supabase";

function legacyKey(role: string) {
  const encode = (value: object) => btoa(JSON.stringify(value)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
  return `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ role })}.signature`;
}

beforeEach(() => {
  vi.stubEnv("VITE_SUPABASE_URL", "");
  vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "");
  vi.stubEnv("VITE_REQUIRE_SHARED_MODE", "false");
});

afterEach(() => vi.unstubAllEnvs());

describe("Supabase runtime configuration", () => {
  it("uses the explicit demo mode only when both values are absent", () => {
    vi.stubEnv("VITE_SUPABASE_URL", "");
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "");
    expect(getSupabaseRuntimeConfiguration()).toEqual({ mode: "demo" });
  });

  it("fails closed after the production cutover flag is enabled", () => {
    vi.stubEnv("VITE_SUPABASE_URL", "");
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "");
    vi.stubEnv("VITE_REQUIRE_SHARED_MODE", "true");
    expect(getSupabaseRuntimeConfiguration()).toMatchObject({ mode: "invalid" });
  });

  it("accepts a modern publishable key over HTTPS", () => {
    vi.stubEnv("VITE_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_example");
    expect(getSupabaseRuntimeConfiguration()).toMatchObject({ mode: "configured" });
  });

  it("rejects legacy service-role JWTs before creating a browser client", () => {
    vi.stubEnv("VITE_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", legacyKey("service_role"));
    expect(getSupabaseRuntimeConfiguration()).toMatchObject({ mode: "invalid" });
  });

  it("allows a local legacy anon key without weakening production validation", () => {
    vi.stubEnv("VITE_SUPABASE_URL", "http://127.0.0.1:54321");
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", legacyKey("anon"));
    expect(getSupabaseRuntimeConfiguration()).toMatchObject({ mode: "configured" });
  });
});
