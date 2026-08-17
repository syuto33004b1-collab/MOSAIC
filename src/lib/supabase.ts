import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export type SupabaseRuntimeMode = "demo" | "configured" | "invalid";

type SupabaseRuntimeConfiguration = {
  mode: SupabaseRuntimeMode;
  url?: string;
  publishableKey?: string;
  message?: string;
};

let singleton: SupabaseClient | undefined;

function normalizeEnvironmentValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function legacyJwtRole(value: string) {
  if (!value.startsWith("eyJ")) return undefined;
  try {
    const payload = value.split(".")[1];
    if (!payload) return undefined;
    const normalized = payload.replaceAll("-", "+").replaceAll("_", "/");
    const decoded = JSON.parse(atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "="))) as { role?: unknown };
    return typeof decoded.role === "string" ? decoded.role : undefined;
  } catch {
    return undefined;
  }
}

export function getSupabaseRuntimeConfiguration(): SupabaseRuntimeConfiguration {
  const url = normalizeEnvironmentValue(import.meta.env.VITE_SUPABASE_URL);
  const publishableKey = normalizeEnvironmentValue(import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY);
  const sharedModeRequired = normalizeEnvironmentValue(import.meta.env.VITE_REQUIRE_SHARED_MODE).toLowerCase() === "true";

  if (!url && !publishableKey) {
    if (sharedModeRequired) {
      return {
        mode: "invalid",
        message: "共有モードが必須ですが、Supabaseの接続設定がありません。",
      };
    }
    return { mode: "demo" };
  }

  if (!url || !publishableKey) {
    return {
      mode: "invalid",
      message: "SupabaseのURLと公開キーを両方設定してください。",
    };
  }

  if (publishableKey.startsWith("sb_secret_") || legacyJwtRole(publishableKey) === "service_role") {
    return {
      mode: "invalid",
      message: "ブラウザではSupabaseのsecret keyを使用できません。publishable keyを設定してください。",
    };
  }

  try {
    const parsedUrl = new URL(url);
    const local = parsedUrl.hostname === "localhost" || parsedUrl.hostname === "127.0.0.1";
    if ((!local && parsedUrl.protocol !== "https:") || (local && !["http:", "https:"].includes(parsedUrl.protocol))) {
      throw new Error("Supabase URL must use HTTPS outside local development.");
    }
    const localAnonKey = local && legacyJwtRole(publishableKey) === "anon";
    if (!publishableKey.startsWith("sb_publishable_") && !localAnonKey) {
      return {
        mode: "invalid",
        message: "本番ではsb_publishable_で始まるSupabase publishable keyを設定してください。",
      };
    }
  } catch {
    return {
      mode: "invalid",
      message: "VITE_SUPABASE_URLに有効なURLを設定してください。",
    };
  }

  return { mode: "configured", url, publishableKey };
}

export function getSupabaseClient() {
  const configuration = getSupabaseRuntimeConfiguration();
  if (configuration.mode !== "configured" || !configuration.url || !configuration.publishableKey) {
    throw new Error(configuration.message ?? "Supabase is not configured.");
  }

  singleton ??= createClient(configuration.url, configuration.publishableKey, {
    auth: {
      autoRefreshToken: true,
      detectSessionInUrl: true,
      persistSession: true,
    },
    realtime: {
      params: { eventsPerSecond: 10 },
    },
  });

  return singleton;
}
