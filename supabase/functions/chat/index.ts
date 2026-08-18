import "@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "@supabase/server";
import { createActionToken, verifyActionToken } from "./action-token.mjs";
import { CHAT_LIMITS, ChatContractError, errorBody, parseChatRequest } from "./contract.mjs";
import { createContinuationToken, verifyContinuationToken } from "./continuation.mjs";
import {
  buildFunctionResultInput,
  createGeminiInteraction,
  GeminiServiceError,
  normalizeModel,
} from "./gemini.mjs";
import { createBestEffortRateLimiter } from "./rate-limit.mjs";
import {
  buildWorkspaceSaveRequest,
  detectWorkspaceFunctionCalls,
  parseWorkspaceToolCall,
  planWorkspaceAction,
  readWorkspaceTool,
  WORKSPACE_TOOL_DECLARATIONS,
} from "./workspace-tools.mjs";

const rateLimiter = createBestEffortRateLimiter();
const MAX_TOOL_CALLS_PER_ROUND = 4;
const MAX_TOOL_ROUNDS = 4;
const ORGANIZATION_ROLES = new Set(["owner", "admin", "planner", "viewer"]);

type UnknownRecord = Record<string, unknown>;
type ActionState = UnknownRecord & {
  version: 1;
  plan: UnknownRecord;
  interactionId: string;
  callId: string;
  toolName: string;
  role: string;
  accessRevision: number;
  expectedRevision: number;
};
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

function rpcCode(error: unknown) {
  return isRecord(error) && typeof error.code === "string" ? error.code : "";
}

function rpcFailure(error: unknown, operation: "access" | "read" | "save") {
  const code = rpcCode(error);
  if (code === "42501" || code === "PGRST301" || code === "PGRST302") {
    return new ChatContractError("FORBIDDEN", "この組織でAIアシスタントを利用する権限がありません。", 403);
  }
  if (code === "40001") {
    return new ChatContractError("WORKSPACE_CONFLICT", "他のユーザーが先に更新しました。最新データを確認して、変更内容をもう一度ご依頼ください。", 409);
  }
  if (code === "P0002") {
    return new ChatContractError("WORKSPACE_NOT_FOUND", "対象の組織またはデータを確認できませんでした。", 404);
  }
  if (operation === "save" && ["22023", "23503", "23505", "23514", "54000"].includes(code)) {
    return new ChatContractError("ACTION_REJECTED", "現在のデータではこの変更を保存できません。最新状態を確認して内容を見直してください。", 409);
  }
  return new ChatContractError(
    operation === "read" ? "WORKSPACE_UNAVAILABLE" : "ACTION_UNAVAILABLE",
    operation === "read" ? "最新データを読み込めませんでした。しばらくしてからもう一度お試しください。" : "操作を完了できませんでした。しばらくしてからもう一度お試しください。",
    503,
  );
}

async function rpc(client: RpcClient, name: string, args: UnknownRecord | undefined, operation: "access" | "read" | "save") {
  const { data, error } = await client.rpc(name, args);
  if (error) throw rpcFailure(error, operation);
  return unwrapRpcValue(data);
}

function organizationAccess(value: unknown, organizationId: string) {
  const context = isRecord(value) ? value : undefined;
  const organizations = Array.isArray(context?.organizations) ? context.organizations : [];
  const organization = organizations.find((item) => isRecord(item) && item.id === organizationId);
  if (!isRecord(organization) || typeof organization.role !== "string" || !ORGANIZATION_ROLES.has(organization.role)) {
    throw new ChatContractError("FORBIDDEN", "この組織でAIアシスタントを利用する権限がありません。", 403);
  }
  const accessRevision = Number(organization.accessRevision);
  if (!Number.isSafeInteger(accessRevision) || accessRevision < 0) {
    throw new ChatContractError("ACCESS_UNAVAILABLE", "組織の権限情報を確認できませんでした。", 503);
  }
  return { accessRevision, role: organization.role };
}

async function loadAccess(client: RpcClient, organizationId: string) {
  return organizationAccess(await rpc(client, "get_my_context", undefined, "access"), organizationId);
}

async function loadWorkspace(client: RpcClient, organizationId: string) {
  const snapshot = await rpc(client, "get_workspace", { p_organization_id: organizationId }, "read");
  if (!isRecord(snapshot) || !isRecord(snapshot.organization)) {
    throw new ChatContractError("INVALID_WORKSPACE", "最新データを確認できませんでした。", 503);
  }
  const revision = Number(snapshot.organization.workspaceRevision);
  if (snapshot.organization.id !== organizationId || !Number.isSafeInteger(revision) || revision < 0) {
    throw new ChatContractError("INVALID_WORKSPACE", "最新データを確認できませんでした。", 503);
  }
  return { revision, snapshot };
}

function publicGeminiError(error: GeminiServiceError) {
  if (error.code === "NOT_CONFIGURED") return { body: errorBody("AI_NOT_CONFIGURED", "AIチャットは現在利用できません。管理者にお問い合わせください。", false), status: 503 };
  if (error.code === "TIMEOUT") return { body: errorBody("AI_TIMEOUT", "AIの応答に時間がかかっています。しばらくしてからもう一度お試しください。", true), status: 504 };
  if (error.retryable) return { body: errorBody("AI_UNAVAILABLE", "AIチャットに一時的に接続できません。しばらくしてからもう一度お試しください。", true), status: 503 };
  return { body: errorBody("AI_REQUEST_FAILED", "AIの回答を取得できませんでした。内容を確認してもう一度お試しください。", false), status: 502 };
}

function safeToolFailure(error: unknown) {
  const code = isRecord(error) && typeof error.code === "string" ? error.code : "TOOL_REQUEST_INVALID";
  const allowedCodes = new Set([
    "AMBIGUOUS_TARGET",
    "DUPLICATE_PROJECT_CODE",
    "FORBIDDEN",
    "INVALID_ARGUMENTS",
    "INVALID_TOOL_ARGUMENTS",
    "LOCAL_CHANGES_PRESENT",
    "MEMBER_CAPACITY_EXCEEDED",
    "MEMBER_DOES_NOT_MATCH_NEED",
    "MEMBER_OWNS_PROJECT",
    "NO_WORKSPACE_CHANGES",
    "NOT_FOUND",
    "STAFFING_NEED_NOT_OPEN",
    "UNSUPPORTED_TOOL",
    "WORKSPACE_ENTITY_NOT_FOUND",
    "WORKSPACE_VALIDATION_FAILED",
  ]);
  const allowed = allowedCodes.has(code);
  const message = allowed && error instanceof Error && error.message.length <= 300
    ? error.message
    : "依頼内容を操作へ変換できませんでした。対象と変更内容を確認してください。";
  return { ok: false, code: allowed ? code : "TOOL_REQUEST_INVALID", message };
}

async function continueWithToolResults(options: {
  apiKey: string;
  interactionId: string;
  model: string;
  results: Array<{ call: UnknownRecord; result: unknown }>;
  toolChoice: "auto" | "none";
}) {
  return createGeminiInteraction({
    apiKey: options.apiKey,
    input: buildFunctionResultInput(options.results),
    model: options.model,
    previousInteractionId: options.interactionId,
    toolChoice: options.toolChoice,
    tools: WORKSPACE_TOOL_DECLARATIONS,
  });
}

async function responseForInteraction(interaction: UnknownRecord, userId: string, organizationId: string, apiKey: string, fallback: string) {
  const interactionId = typeof interaction.interactionId === "string" ? interaction.interactionId : "";
  if (!interactionId) throw new GeminiServiceError("INVALID_RESPONSE", "Gemini response did not include an interaction ID.");
  return {
    reply: typeof interaction.reply === "string" && interaction.reply.trim() ? interaction.reply.trim() : fallback,
    interactionId: await createContinuationToken(interactionId, userId, organizationId, apiKey),
  };
}

function previewFromPlan(plan: UnknownRecord, toolName: string) {
  const preview = isRecord(plan.preview) ? plan.preview : plan;
  const strings = (value: unknown) => Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).slice(0, 20)
    : [];
  const details = Array.isArray(preview.details) ? preview.details.flatMap((item) => {
    if (isRecord(item) && typeof item.label === "string" && typeof item.value === "string" && item.label.trim() && item.value.trim()) {
      return [{ label: item.label.trim(), value: item.value.trim() }];
    }
    if (typeof item === "string" && item.trim()) return [{ label: "変更", value: item.trim() }];
    return [];
  }).slice(0, 20) : [];
  return {
    type: typeof preview.type === "string" ? preview.type : toolName,
    title: typeof preview.title === "string" ? preview.title : "変更内容を確認してください",
    summary: typeof preview.summary === "string" ? preview.summary : "MOSAICの共有データを更新します。",
    details,
    impacts: strings(preview.impacts),
    confirmLabel: typeof preview.confirmLabel === "string" ? preview.confirmLabel : "実行する",
    destructive: preview.destructive === true,
  };
}

async function proposalResponse(options: {
  accessRevision: number;
  apiKey: string;
  call: UnknownRecord;
  interaction: UnknownRecord;
  organizationId: string;
  plan: UnknownRecord;
  role: string;
  userId: string;
}) {
  const expectedRevision = Number(options.plan.expectedRevision);
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0 || typeof options.call.id !== "string" || typeof options.call.name !== "string" || typeof options.interaction.interactionId !== "string") {
    throw new ChatContractError("INVALID_ACTION_PLAN", "変更内容を確認できませんでした。もう一度ご依頼ください。", 500);
  }
  const action = {
    version: 1,
    accessRevision: options.accessRevision,
    expectedRevision,
    role: options.role,
    interactionId: options.interaction.interactionId,
    callId: options.call.id,
    toolName: options.call.name,
    plan: options.plan,
  };
  const signed = await createActionToken(action, { userId: options.userId, organizationId: options.organizationId, secret: options.apiKey });
  if (signed.token.length > CHAT_LIMITS.actionTokenCharacters) {
    throw new ChatContractError("ACTION_TOO_LARGE", "一度に変更できる範囲を超えました。操作を分けてご依頼ください。", 413);
  }
  const preview = previewFromPlan(options.plan, options.call.name);
  return {
    reply: preview.summary,
    interactionId: await createContinuationToken(options.interaction.interactionId, options.userId, options.organizationId, options.apiKey),
    proposal: { token: signed.token, ...preview, expectedRevision, expiresAt: signed.expiresAt },
  };
}

async function handleMessage(options: {
  apiKey: string;
  chat: UnknownRecord;
  client: RpcClient;
  model: string;
  userId: string;
}) {
  const organizationId = String(options.chat.organizationId);
  const access = await loadAccess(options.client, organizationId);
  if (typeof options.chat.previousInteractionId === "string") {
    const verified = await verifyContinuationToken(options.chat.previousInteractionId, options.userId, organizationId, options.apiKey);
    if (!verified) throw new ChatContractError("INVALID_INTERACTION_ID", "会話を継続できませんでした。新しい会話を開始してください。");
    options.chat.previousInteractionId = verified;
  }

  let interaction = await createGeminiInteraction({ apiKey: options.apiKey, chat: options.chat, model: options.model, tools: WORKSPACE_TOOL_DECLARATIONS });
  let workspace: Awaited<ReturnType<typeof loadWorkspace>> | undefined;

  for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
    const calls = detectWorkspaceFunctionCalls(interaction);
    if (!Array.isArray(calls) || calls.length === 0) {
      return responseForInteraction(interaction, options.userId, organizationId, options.apiKey, "ご質問の内容を確認できませんでした。もう一度お試しください。");
    }
    if (calls.length > MAX_TOOL_CALLS_PER_ROUND) {
      const results = calls.slice(0, MAX_TOOL_CALLS_PER_ROUND).map((call: UnknownRecord) => ({ call, result: { ok: false, code: "TOO_MANY_TOOL_CALLS", message: "一度に確認できる操作数を超えました。条件を絞ってください。" } }));
      interaction = await continueWithToolResults({ apiKey: options.apiKey, interactionId: interaction.interactionId, model: options.model, results, toolChoice: "none" });
      return responseForInteraction(interaction, options.userId, organizationId, options.apiKey, "一度に確認できる範囲を超えました。依頼を分けてください。");
    }

    const parsed = calls.map((call: UnknownRecord) => {
      try {
        return { call, tool: parseWorkspaceToolCall(call.name, call.arguments) };
      } catch (error) {
        return { call, error };
      }
    });
    if (parsed.some((entry: UnknownRecord) => entry.error)) {
      const results = parsed.map((entry: UnknownRecord) => ({ call: entry.call as UnknownRecord, result: entry.error ? safeToolFailure(entry.error) : { ok: false, code: "TOOL_REQUEST_INVALID", message: "同じ依頼内の操作を確認できませんでした。" } }));
      interaction = await continueWithToolResults({ apiKey: options.apiKey, interactionId: interaction.interactionId, model: options.model, results, toolChoice: "none" });
      return responseForInteraction(interaction, options.userId, organizationId, options.apiKey, "対象と変更内容を確認してください。");
    }

    const writeEntries = parsed.filter((entry: UnknownRecord) => isRecord(entry.tool) && entry.tool.mode === "write");
    if (writeEntries.length > 0) {
      if (parsed.length !== 1 || writeEntries.length !== 1 || options.chat.hasLocalChanges === true) {
        const result = options.chat.hasLocalChanges === true
          ? { ok: false, code: "LOCAL_CHANGES_PRESENT", message: "画面に未保存の変更があります。先に保存または取り消してから、もう一度ご依頼ください。" }
          : { ok: false, code: "MULTIPLE_WRITES_NOT_ALLOWED", message: "書込みは1回につき1件ずつ依頼してください。" };
        interaction = await continueWithToolResults({ apiKey: options.apiKey, interactionId: interaction.interactionId, model: options.model, results: parsed.map((entry: UnknownRecord) => ({ call: entry.call as UnknownRecord, result })), toolChoice: "none" });
        return responseForInteraction(interaction, options.userId, organizationId, options.apiKey, result.message);
      }

      workspace ??= await loadWorkspace(options.client, organizationId);
      const entry = writeEntries[0] as UnknownRecord;
      const tool = entry.tool as UnknownRecord;
      let plan;
      try {
        plan = await planWorkspaceAction({
          snapshot: workspace.snapshot,
          role: access.role,
          toolName: tool.toolName,
          args: tool.args,
          uuid: () => crypto.randomUUID(),
          requestId: crypto.randomUUID(),
        });
      } catch (error) {
        interaction = await continueWithToolResults({ apiKey: options.apiKey, interactionId: interaction.interactionId, model: options.model, results: [{ call: entry.call as UnknownRecord, result: safeToolFailure(error) }], toolChoice: "none" });
        return responseForInteraction(interaction, options.userId, organizationId, options.apiKey, "対象と変更内容を確認してください。");
      }
      return proposalResponse({ accessRevision: access.accessRevision, apiKey: options.apiKey, call: entry.call as UnknownRecord, interaction, organizationId, plan, role: access.role, userId: options.userId });
    }

    workspace ??= await loadWorkspace(options.client, organizationId);
    const results = parsed.map((entry: UnknownRecord) => {
      const tool = entry.tool as UnknownRecord;
      try {
        return { call: entry.call as UnknownRecord, result: readWorkspaceTool(workspace!.snapshot, tool.toolName, tool.args) };
      } catch (error) {
        return { call: entry.call as UnknownRecord, result: safeToolFailure(error) };
      }
    });
    const limitReached = round + 1 >= MAX_TOOL_ROUNDS;
    interaction = await continueWithToolResults({ apiKey: options.apiKey, interactionId: interaction.interactionId, model: options.model, results, toolChoice: limitReached ? "none" : "auto" });
    if (limitReached) {
      return responseForInteraction(interaction, options.userId, organizationId, options.apiKey, "確認できる範囲を超えました。依頼を分けてください。");
    }
  }
  throw new GeminiServiceError("TOOL_LOOP_LIMIT", "Gemini exceeded the tool loop limit.", { status: 502 });
}

function actionState(value: unknown): ActionState | null {
  if (!isRecord(value) || value.version !== 1 || !isRecord(value.plan)) return null;
  if (
    typeof value.interactionId !== "string"
    || typeof value.callId !== "string"
    || typeof value.toolName !== "string"
    || typeof value.role !== "string"
    || !Number.isSafeInteger(value.accessRevision)
    || !Number.isSafeInteger(value.expectedRevision)
  ) return null;
  return value as ActionState;
}

function validSaveRequest(value: unknown, organizationId: string, expectedRevision: number) {
  if (!isRecord(value)) return null;
  if (
    value.p_organization_id !== organizationId
    || value.p_expected_revision !== expectedRevision
    || typeof value.p_request_id !== "string"
    || !isRecord(value.p_payload)
    || typeof value.p_payload_hash !== "string"
    || !/^[0-9a-f]{64}$/u.test(value.p_payload_hash)
  ) return null;
  return value;
}

function saveRevision(value: unknown) {
  const result = isRecord(value) ? value : undefined;
  const revision = Number(result?.revision);
  return Number.isSafeInteger(revision) && revision >= 0 ? revision : undefined;
}

async function handleAction(options: {
  apiKey: string;
  client: RpcClient;
  model: string;
  request: UnknownRecord;
  userId: string;
}) {
  const organizationId = String(options.request.organizationId);
  const verified = await verifyActionToken(options.request.actionToken, { userId: options.userId, organizationId, secret: options.apiKey });
  const state = actionState(verified?.action);
  if (!state) throw new ChatContractError("INVALID_ACTION_TOKEN", "確認の有効期限が切れたか、内容を確認できません。もう一度ご依頼ください。", 409);

  const access = await loadAccess(options.client, organizationId);
  const call = { id: state.callId, name: state.toolName };
  if (options.request.decision === "cancel") {
    const interaction = await continueWithToolResults({
      apiKey: options.apiKey,
      interactionId: state.interactionId,
      model: options.model,
      results: [{ call, result: { ok: false, cancelled: true, code: "USER_CANCELLED", message: "利用者が変更をキャンセルしました。" } }],
      toolChoice: "none",
    });
    return responseForInteraction(interaction, options.userId, organizationId, options.apiKey, "変更はキャンセルしました。");
  }
  if (access.accessRevision !== state.accessRevision || access.role !== state.role) {
    throw new ChatContractError("ACCESS_CHANGED", "操作権限が変更されました。最新状態で内容をもう一度ご依頼ください。", 409);
  }
  const saveRequest = validSaveRequest(await buildWorkspaceSaveRequest(state.plan), organizationId, state.expectedRevision);
  if (!saveRequest) throw new ChatContractError("INVALID_ACTION_PLAN", "確認内容を保存形式へ変換できませんでした。もう一度ご依頼ください。", 500);
  const saved = await rpc(options.client, "save_workspace", saveRequest, "save");
  const revision = saveRevision(saved);
  if (revision === undefined) throw new ChatContractError("INVALID_SAVE_RESULT", "変更は送信されましたが、更新結果を確認できませんでした。画面を再読み込みしてください。", 503);

  const preview = previewFromPlan(state.plan, state.toolName);
  try {
    const interaction = await continueWithToolResults({
      apiKey: options.apiKey,
      interactionId: state.interactionId,
      model: options.model,
      results: [{ call, result: { ok: true, committed: true, summary: preview.summary, workspaceRevision: revision } }],
      toolChoice: "none",
    });
    return { ...(await responseForInteraction(interaction, options.userId, organizationId, options.apiKey, `${preview.summary} 完了しました。`)), workspaceRevision: revision };
  } catch {
    return {
      reply: `${preview.summary} 変更はチームへ保存されました。`,
      interactionId: await createContinuationToken(state.interactionId, options.userId, organizationId, options.apiKey),
      workspaceRevision: revision,
    };
  }
}

export default {
  fetch: withSupabase({ auth: "user" }, async (request, context) => {
    if (request.method !== "POST") return jsonResponse(errorBody("METHOD_NOT_ALLOWED", "POSTで送信してください。", false), 405, { Allow: "POST" });
    const userId = userIdentifier(context.userClaims);
    if (!userId) return jsonResponse(errorBody("UNAUTHORIZED", "ログインが必要です。", false), 401);

    try {
      const parsed = parseChatRequest(await readJson(request));
      const rateLimit = rateLimiter.consume(`${userId}:${parsed.organizationId}`);
      if (!rateLimit.allowed) {
        return jsonResponse(errorBody("RATE_LIMITED", "短時間に多くの操作が送信されました。少し待ってからお試しください。", true), 429, { "Retry-After": String(rateLimit.retryAfterSeconds) });
      }
      const apiKey = globalThis.Deno.env.get("GEMINI_API_KEY") ?? "";
      if (!apiKey.trim()) throw new GeminiServiceError("NOT_CONFIGURED", "GEMINI_API_KEY is not configured.", { status: 503 });
      const model = normalizeModel(globalThis.Deno.env.get("GEMINI_MODEL"));
      const client = context.supabase as unknown as RpcClient;
      const body = parsed.kind === "action"
        ? await handleAction({ apiKey, client, model, request: parsed, userId })
        : await handleMessage({ apiKey, chat: parsed, client, model, userId });
      return jsonResponse(body, 200, { "X-RateLimit-Remaining": String(rateLimit.remaining) });
    } catch (error) {
      if (error instanceof ChatContractError) return jsonResponse(errorBody(error.code, error.message, error.retryable), error.status);
      if (error instanceof GeminiServiceError) {
        const response = publicGeminiError(error);
        return jsonResponse(response.body, response.status);
      }
      return jsonResponse(errorBody("INTERNAL_ERROR", "AIアシスタントでエラーが発生しました。しばらくしてからもう一度お試しください。", false), 500);
    }
  }),
};
