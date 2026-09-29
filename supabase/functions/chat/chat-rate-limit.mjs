import { ChatContractError } from "./contract.mjs";

/**
 * The AI assistant's request limit, counted by `public.consume_chat_rate_limit` so
 * every isolate shares one window per user and organization (#502). The number
 * lives in the database; `INTEGRATION_LIMITS.chat` is only a copy for tests.
 *
 * It fails closed. Anything but an explicit `allowed: true` stops the request:
 * falling back to a per-isolate count when the RPC is missing would reopen the
 * hole this exists to close, for as long as a deploy ran ahead of its migration.
 */

const JAPAN_OFFSET_MS = 9 * 60 * 60 * 1000;

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function unavailable() {
  const error = new ChatContractError(
    "RATE_LIMIT_UNAVAILABLE",
    "AIアシスタントの利用状況を確認できませんでした。しばらくしてからもう一度お試しください。",
    503,
  );
  error.retryable = true;
  return error;
}

function secondsUntilRetry(value) {
  return Number.isInteger(value) && value >= 1 && value <= 60 ? value : undefined;
}

/**
 * @param {{ rpc: (name: string, args?: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }> }} client
 * @param {string} organizationId
 * @returns {Promise<{ allowed: true; remaining: number } | { allowed: false; retryAfterSeconds?: number; retryAt?: string }>}
 */
export async function consumeChatRateLimit(client, organizationId) {
  let result;
  try {
    result = await client.rpc("consume_chat_rate_limit", { p_organization_id: organizationId });
  } catch {
    throw unavailable();
  }
  const code = isRecord(result?.error) && typeof result.error.code === "string" ? result.error.code : "";
  if (result?.error) {
    if (code === "42501") throw new ChatContractError("FORBIDDEN", "この組織でAIアシスタントを利用する権限がありません。", 403);
    if (code === "PGRST301" || code === "PGRST302") throw new ChatContractError("UNAUTHORIZED", "ログインが必要です。", 401);
    throw unavailable();
  }
  const value = Array.isArray(result?.data) && result.data.length === 1 ? result.data[0] : result?.data;
  if (!isRecord(value)) throw unavailable();
  if (value.allowed === true) {
    return { allowed: true, remaining: Number.isInteger(value.remaining) && value.remaining >= 0 ? value.remaining : 0 };
  }
  if (value.allowed === false) {
    return {
      allowed: false,
      retryAfterSeconds: secondsUntilRetry(value.retryAfterSeconds),
      retryAt: typeof value.retryAt === "string" ? value.retryAt : undefined,
    };
  }
  throw unavailable();
}

/** HH:MM in Japan time. Japan has no daylight saving, so a fixed offset is exact. */
function japanClock(iso) {
  if (typeof iso !== "string") return "";
  const time = Date.parse(iso);
  if (!Number.isFinite(time)) return "";
  const japan = new Date(time + JAPAN_OFFSET_MS);
  return `${String(japan.getUTCHours()).padStart(2, "0")}:${String(japan.getUTCMinutes()).padStart(2, "0")}`;
}

export function rateLimitedMessage(retryAt) {
  const clock = japanClock(retryAt);
  return clock
    ? `短時間に多くの操作が送信されました。${clock}（日本時間）以降にもう一度お試しください。`
    : "短時間に多くの操作が送信されました。少し待ってからお試しください。";
}
