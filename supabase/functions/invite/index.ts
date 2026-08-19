import "@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "@supabase/server";
import { createClient } from "@supabase/supabase-js";
import { createBestEffortRateLimiter } from "../chat/rate-limit.mjs";
import {
  errorBody,
  InviteContractError,
  parseInviteRequest,
  publicInviteResponse,
  sendAuthInvite,
} from "./contract.mjs";

const rateLimiter = createBestEffortRateLimiter({ limit: 8, windowMs: 60_000 });

type UnknownRecord = Record<string, unknown>;
type RpcClient = {
  rpc: (name: string, args?: UnknownRecord) => Promise<{ data: unknown; error: unknown }>;
};

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function unwrapRpcValue(value: unknown) {
  return Array.isArray(value) && value.length === 1 ? value[0] : value;
}

function jsonResponse(body: unknown, status = 200, extraHeaders: HeadersInit = {}) {
  return Response.json(body, { headers: { "Cache-Control": "no-store", ...extraHeaders }, status });
}

function userIdentifier(claims: unknown) {
  if (!isRecord(claims)) return "";
  const value = claims.id ?? claims.sub;
  return typeof value === "string" ? value : "";
}

async function readJson(request: Request) {
  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.includes("application/json")) {
    throw new InviteContractError("UNSUPPORTED_MEDIA_TYPE", "JSON形式で送信してください。", 415);
  }
  try {
    return JSON.parse(await request.text());
  } catch {
    throw new InviteContractError("INVALID_JSON", "JSONの形式を確認してください。");
  }
}

function rpcCode(error: unknown) {
  return isRecord(error) && typeof error.code === "string" ? error.code : "";
}

function invitationFromRpc(value: unknown, email: string, role: string) {
  const result = isRecord(value) ? value : undefined;
  const record = isRecord(result?.invitation) ? result.invitation : result;
  const id = typeof record?.id === "string" ? record.id : undefined;
  const organizationId = typeof record?.organizationId === "string" ? record.organizationId : undefined;
  const expiresAt = typeof record?.expiresAt === "string" ? record.expiresAt : undefined;
  return {
    id,
    organizationId,
    email: typeof record?.email === "string" ? record.email : email,
    role: typeof record?.role === "string" ? record.role : role,
    expiresAt,
  };
}

function mapInviteMemberError(error: unknown) {
  const code = rpcCode(error);
  if (code === "42501" || code === "PGRST301" || code === "PGRST302") {
    return new InviteContractError("FORBIDDEN", "この組織で招待する権限がありません。", 403);
  }
  if (code === "23505") {
    return new InviteContractError("ALREADY_MEMBER", "このメールアドレスはすでに所属しています。", 409);
  }
  if (code === "23514") {
    return new InviteContractError("MEMBER_SUSPENDED", "停止中のメンバーは招待ではなく再開操作を使ってください。", 409);
  }
  if (code === "22023") {
    return new InviteContractError("INVALID_INVITATION", "メールアドレスまたは権限を確認してください。");
  }
  if (code === "P0002") {
    return new InviteContractError("ORGANIZATION_NOT_FOUND", "対象の組織を確認できませんでした。", 404);
  }
  return new InviteContractError("INVITE_UNAVAILABLE", "招待を登録できませんでした。通信状況を確認してください。", 503, true);
}

function adminClient() {
  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!url || !serviceRoleKey) {
    throw new InviteContractError("NOT_CONFIGURED", "招待メールを送る準備ができていません。管理者にお問い合わせください。", 503);
  }
  return createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });
}

export default {
  fetch: withSupabase({ auth: "user" }, async (request, context) => {
    if (request.method !== "POST") return jsonResponse(errorBody("METHOD_NOT_ALLOWED", "POSTで送信してください。", false), 405, { Allow: "POST" });
    const userId = userIdentifier(context.userClaims);
    if (!userId) return jsonResponse(errorBody("UNAUTHORIZED", "ログインが必要です。", false), 401);

    try {
      const parsed = parseInviteRequest(await readJson(request));
      const rateLimit = rateLimiter.consume(`${userId}:${parsed.organizationId}`);
      if (!rateLimit.allowed) {
        return jsonResponse(errorBody("RATE_LIMITED", "短時間に多くの招待が送信されました。少し待ってからお試しください。", true), 429, {
          "Retry-After": String(rateLimit.retryAfterSeconds),
        });
      }

      const client = context.supabase as unknown as RpcClient;
      const { data, error } = await client.rpc("invite_member", {
        p_email: parsed.email,
        p_organization_id: parsed.organizationId,
        p_role: parsed.role,
      });
      if (error) throw mapInviteMemberError(error);

      const invitation = invitationFromRpc(unwrapRpcValue(data), parsed.email, parsed.role);
      const authInvite = await sendAuthInvite(adminClient(), {
        email: parsed.email,
        redirectTo: parsed.redirectTo,
      });
      return jsonResponse(publicInviteResponse(invitation, authInvite), 200, {
        "X-RateLimit-Remaining": String(rateLimit.remaining),
      });
    } catch (error) {
      if (error instanceof InviteContractError) {
        return jsonResponse(errorBody(error.code, error.message, error.retryable), error.status);
      }
      return jsonResponse(errorBody("INTERNAL_ERROR", "招待を完了できませんでした。しばらくしてからもう一度お試しください。", false), 500);
    }
  }),
};
