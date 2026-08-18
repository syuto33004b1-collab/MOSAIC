import "@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "@supabase/server";
import { CHAT_LIMITS, ChatContractError, errorBody, parseChatRequest } from "./contract.mjs";
import { createContinuationToken, verifyContinuationToken } from "./continuation.mjs";
import { createGeminiInteraction, GeminiServiceError, normalizeModel } from "./gemini.mjs";
import { createBestEffortRateLimiter } from "./rate-limit.mjs";

const rateLimiter = createBestEffortRateLimiter();

function jsonResponse(body: unknown, status = 200, extraHeaders: HeadersInit = {}) {
  return Response.json(body, {
    headers: { "Cache-Control": "no-store", ...extraHeaders },
    status,
  });
}

function userIdentifier(claims: unknown) {
  if (typeof claims !== "object" || claims === null) return "";
  const record = claims as Record<string, unknown>;
  const value = record.id ?? record.sub;
  return typeof value === "string" ? value : "";
}

async function readJson(request: Request) {
  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.includes("application/json")) {
    throw new ChatContractError("UNSUPPORTED_MEDIA_TYPE", "JSON形式で送信してください。", 415);
  }
  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > CHAT_LIMITS.bodyBytes) {
    throw new ChatContractError("REQUEST_TOO_LARGE", "リクエストが大きすぎます。", 413);
  }
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > CHAT_LIMITS.bodyBytes) {
    throw new ChatContractError("REQUEST_TOO_LARGE", "リクエストが大きすぎます。", 413);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new ChatContractError("INVALID_JSON", "JSONの形式を確認してください。");
  }
}

function publicGeminiError(error: GeminiServiceError) {
  if (error.code === "NOT_CONFIGURED") {
    return { body: errorBody("AI_NOT_CONFIGURED", "AIチャットは現在利用できません。管理者にお問い合わせください。", false), status: 503 };
  }
  if (error.code === "TIMEOUT") {
    return { body: errorBody("AI_TIMEOUT", "AIの応答に時間がかかっています。しばらくしてからもう一度お試しください。", true), status: 504 };
  }
  if (error.retryable) {
    return { body: errorBody("AI_UNAVAILABLE", "AIチャットに一時的に接続できません。しばらくしてからもう一度お試しください。", true), status: 503 };
  }
  return { body: errorBody("AI_REQUEST_FAILED", "AIの回答を取得できませんでした。内容を確認してもう一度お試しください。", false), status: 502 };
}

export default {
  fetch: withSupabase({ auth: "user" }, async (request, context) => {
    if (request.method !== "POST") {
      return jsonResponse(errorBody("METHOD_NOT_ALLOWED", "POSTで送信してください。", false), 405, { Allow: "POST" });
    }
    const userId = userIdentifier(context.userClaims);
    if (!userId) return jsonResponse(errorBody("UNAUTHORIZED", "ログインが必要です。", false), 401);

    try {
      const rateLimit = rateLimiter.consume(userId);
      if (!rateLimit.allowed) {
        return jsonResponse(
          errorBody("RATE_LIMITED", "短時間に多くのメッセージが送信されました。少し待ってからお試しください。", true),
          429,
          { "Retry-After": String(rateLimit.retryAfterSeconds) },
        );
      }
      const chat = parseChatRequest(await readJson(request));
      const apiKey = globalThis.Deno.env.get("GEMINI_API_KEY") ?? "";
      if (!apiKey.trim()) {
        throw new GeminiServiceError("NOT_CONFIGURED", "GEMINI_API_KEY is not configured.", { status: 503 });
      }
      if (chat.previousInteractionId) {
        const verifiedInteractionId = await verifyContinuationToken(chat.previousInteractionId, userId, apiKey);
        if (!verifiedInteractionId) {
          throw new ChatContractError("INVALID_INTERACTION_ID", "会話を継続できませんでした。新しい会話を開始してください。");
        }
        chat.previousInteractionId = verifiedInteractionId;
      }

      const result = await createGeminiInteraction({
        apiKey,
        chat,
        model: normalizeModel(globalThis.Deno.env.get("GEMINI_MODEL")),
      });
      return jsonResponse({
        reply: result.reply,
        interactionId: await createContinuationToken(result.interactionId, userId, apiKey),
      }, 200, { "X-RateLimit-Remaining": String(rateLimit.remaining) });
    } catch (error) {
      if (error instanceof ChatContractError) return jsonResponse(errorBody(error.code, error.message, false), error.status);
      if (error instanceof GeminiServiceError) {
        const response = publicGeminiError(error);
        return jsonResponse(response.body, response.status);
      }
      return jsonResponse(errorBody("INTERNAL_ERROR", "AIチャットでエラーが発生しました。しばらくしてからもう一度お試しください。", false), 500);
    }
  }),
};
