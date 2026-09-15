import { createActionToken, MCP_CONFIRM_DOMAIN, verifyActionToken } from "../chat/action-token.mjs";
import { readWorkspaceTool, WorkspaceToolError } from "../chat/workspace-tools.mjs";
import { ApiContractError, errorBody, jsonResponse, mapRpcError, readBearerSecret, readJsonBody } from "../api/contract.mjs";
import {
  isWriteTool,
  jsonRpcError,
  jsonRpcResult,
  MCP_PROTOCOL_VERSION,
  MCP_RESOURCES,
  MCP_SERVER_INFO,
  resourceForUri,
  toolDeclarations,
  toolError,
} from "./protocol.mjs";

function unwrapRpcValue(value) {
  return Array.isArray(value) && value.length === 1 ? value[0] : value;
}

function asRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value : undefined;
}

async function rpcNamed(rpc, name, args, operation) {
  try {
    return unwrapRpcValue(await rpc(name, args));
  } catch (error) {
    if (error instanceof ApiContractError) throw error;
    throw mapRpcError(error, operation);
  }
}

async function authorize(request, rpc) {
  const secret = readBearerSecret(request);
  let authorized;
  try {
    authorized = asRecord(await rpcNamed(rpc, "authorize_integration_request", { p_secret: secret }, "read"));
  } catch (error) {
    if (error instanceof ApiContractError && error.code === "FORBIDDEN") {
      throw new ApiContractError("UNAUTHORIZED", "連携資格が必要です。", 401);
    }
    throw error;
  }
  if (authorized?.allowed === false || authorized?.code === "RATE_LIMITED") {
    throw new ApiContractError("RATE_LIMITED", "短時間に多くの要求が送られました。少し待ってからお試しください。", 429, true);
  }
  const client = asRecord(authorized?.client);
  if (!client?.id || !Array.isArray(client.scopes)) {
    throw new ApiContractError("UNAUTHORIZED", "連携資格が必要です。", 401);
  }
  return {
    caller: { kind: "integration", scopes: client.scopes, clientId: client.id },
    client,
    remaining: authorized.remaining,
  };
}

const ALLOWED_PROTOCOL_VERSIONS = new Set(["2025-11-25", "2025-03-26"]);

function assertMcpHeaders(request) {
  const origin = request.headers.get("origin");
  if (origin) {
    throw new ApiContractError("FORBIDDEN", "このMCPサーバーはブラウザからの直接呼び出しを受け付けません。", 403);
  }
  const protocol = request.headers.get("mcp-protocol-version");
  if (protocol && !ALLOWED_PROTOCOL_VERSIONS.has(protocol)) {
    throw new ApiContractError("INVALID_PROTOCOL", "対応していないMCPプロトコルです。", 400);
  }
}

function parseJsonRpc(message) {
  if (message.jsonrpc !== "2.0" || typeof message.method !== "string") {
    throw new ApiContractError("INVALID_JSONRPC", "JSON-RPC 2.0で送信してください。", 400);
  }
  return message;
}

function emptyAccepted() {
  return new Response(null, { status: 202, headers: { "Cache-Control": "no-store" } });
}

export async function handleMcpRequest(request, options = {}) {
  const rpc = options.rpc;
  let rpcId = null;
  try {
    if (request.method !== "POST") {
      return jsonResponse(errorBody("METHOD_NOT_ALLOWED", "POSTで送信してください。", false), 405, { Allow: "POST" });
    }
    assertMcpHeaders(request);
    const session = await authorize(request, rpc);
    const message = parseJsonRpc(await readJsonBody(request));
    rpcId = message.id ?? null;
    const method = message.method;
    const params = asRecord(message.params) ?? {};
    const headers = session.remaining === undefined ? {} : { "X-RateLimit-Remaining": String(session.remaining) };

    if (method.startsWith("notifications/")) {
      return emptyAccepted();
    }
    if (method === "initialize") {
      return jsonResponse(jsonRpcResult(rpcId, {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false }, resources: { listChanged: false } },
        serverInfo: MCP_SERVER_INFO,
        instructions: "MOSAICの参照と、確認付きの気づき送信ができます。確認前には保存しません。アサインなど業務データの書込みは提供しません。",
      }), 200, headers);
    }
    if (method === "ping") {
      return jsonResponse(jsonRpcResult(rpcId, {}), 200, headers);
    }
    if (method === "tools/list") {
      return jsonResponse(jsonRpcResult(rpcId, { tools: toolDeclarations() }), 200, headers);
    }
    if (method === "resources/list") {
      return jsonResponse(jsonRpcResult(rpcId, {
        resources: MCP_RESOURCES.map(({ uri, name, mimeType }) => ({ uri, name, mimeType })),
      }), 200, headers);
    }
    if (method === "tools/call") {
      const name = typeof params.name === "string" ? params.name : "";
      if (isWriteTool(name)) {
        return jsonResponse(toolError(rpcId, "このMCPサーバーは業務データの書込みを提供しません。"), 200, headers);
      }
      if (name === "submit_feedback") {
        return jsonResponse(await submitFeedbackTool(rpcId, asRecord(params.arguments) ?? {}, session, options), 200, headers);
      }
      if (name !== "read_workspace") {
        return jsonResponse(toolError(rpcId, "許可されていないtoolです。"), 200, headers);
      }
      const snapshot = await rpcNamed(rpc, "integration_get_workspace", { p_client_id: session.client.id }, "read");
      const result = readWorkspaceTool(snapshot, name, asRecord(params.arguments) ?? {}, session.caller);
      return jsonResponse(jsonRpcResult(rpcId, {
        content: [{ type: "text", text: JSON.stringify(result) }],
        structuredContent: result,
      }), 200, headers);
    }
    if (method === "resources/read") {
      const resource = resourceForUri(params.uri);
      if (!resource) return jsonResponse(jsonRpcError(rpcId, -32002, "Resource not found"), 200, headers);
      const snapshot = await rpcNamed(rpc, "integration_get_workspace", { p_client_id: session.client.id }, "read");
      const result = readWorkspaceTool(snapshot, "read_workspace", { resource: resource.resource }, session.caller);
      return jsonResponse(jsonRpcResult(rpcId, {
        contents: [{ uri: resource.uri, mimeType: resource.mimeType, text: JSON.stringify(result) }],
      }), 200, headers);
    }
    return jsonResponse(jsonRpcError(rpcId, -32601, "Method not found"), 200, headers);
  } catch (error) {
    if (error instanceof WorkspaceToolError) {
      return jsonResponse(toolError(rpcId, error.message), 200);
    }
    if (error instanceof ApiContractError) {
      return jsonResponse(errorBody(error.code, error.message, error.retryable), error.status);
    }
    return jsonResponse(errorBody("INTERNAL_ERROR", "操作を完了できませんでした。しばらくしてからもう一度お試しください。", false), 500);
  }
}

class FeedbackToolError extends Error {}

function readClientOrganizationId(client) {
  const organizationId = typeof client?.organizationId === "string" ? client.organizationId : "";
  if (!client?.id || !organizationId) {
    throw new ApiContractError("UNAUTHORIZED", "連携資格が必要です。", 401);
  }
  return organizationId;
}

async function submitFeedbackTool(rpcId, args, session, options) {
  try {
    const result = await runSubmitFeedback(args, session, options);
    return jsonRpcResult(rpcId, {
      content: [{ type: "text", text: JSON.stringify(result) }],
      structuredContent: result,
    });
  } catch (error) {
    if (error instanceof FeedbackToolError) return toolError(rpcId, error.message);
    if (error instanceof ApiContractError && error.code !== "NOT_CONFIGURED") return toolError(rpcId, error.message);
    throw error;
  }
}

async function runSubmitFeedback(args, session, options) {
  const confirmSecret = typeof options.confirmSecret === "string" ? options.confirmSecret : "";
  if (!confirmSecret) {
    throw new ApiContractError("NOT_CONFIGURED", "MCPの準備ができていません。", 503);
  }
  const organizationId = readClientOrganizationId(session.client);
  const bodyArg = args.body;
  const tokenArg = args.confirmationToken;
  if (args.sourceScreen !== undefined || args.source_screen !== undefined) {
    throw new FeedbackToolError("送信元画面は指定できません。");
  }
  if (tokenArg !== undefined && bodyArg !== undefined) {
    throw new FeedbackToolError("確認するときは confirmationToken だけを送ってください。");
  }
  if (typeof tokenArg === "string" && tokenArg) {
    return confirmFeedbackSubmission({
      confirmSecret,
      organizationId,
      rpc: options.rpc,
      session,
      token: tokenArg,
    });
  }
  if (typeof bodyArg !== "string") {
    throw new FeedbackToolError("1回目は本文を送り、2回目は confirmationToken だけを送ってください。");
  }
  const body = bodyArg.trim();
  if (body.length < 1 || body.length > 2000) {
    throw new FeedbackToolError("本文は1文字以上2000文字以下です。");
  }
  const requestId = crypto.randomUUID();
  const signed = await createActionToken(
    { requestId, body },
    {
      domain: MCP_CONFIRM_DOMAIN,
      organizationId,
      secret: confirmSecret,
      userId: session.client.id,
    },
  );
  const clientName = typeof session.client.name === "string" && session.client.name.trim()
    ? session.client.name.trim()
    : "連携資格";
  return {
    needsConfirmation: true,
    confirmationToken: signed.token,
    expiresAt: signed.expiresAt,
    preview: {
      title: "気づきを送る",
      summary: "次の本文を組織に残します。業務データは変更しません。",
      details: [
        { label: "本文", value: body },
        { label: "資格", value: clientName },
      ],
      impacts: [
        "確認するまで保存しません。",
        "ホストが自動承認する場合、2回目の呼び出しで保存されます。サーバは人間の承認を検証できません。",
      ],
      confirmLabel: "気づきを送る",
    },
  };
}

async function confirmFeedbackSubmission(options) {
  const verified = await verifyActionToken(options.token, {
    domain: MCP_CONFIRM_DOMAIN,
    organizationId: options.organizationId,
    secret: options.confirmSecret,
    userId: options.session.client.id,
  });
  const action = asRecord(verified?.action);
  const requestId = typeof action?.requestId === "string" ? action.requestId : "";
  const body = typeof action?.body === "string" ? action.body : "";
  if (!verified || !requestId || !body) {
    throw new FeedbackToolError("確認の有効期限が切れたか、内容が一致しません。");
  }
  try {
    const saved = asRecord(unwrapRpcValue(await options.rpc("integration_submit_feedback", {
      p_client_id: options.session.client.id,
      p_request_id: requestId,
      p_body: body,
    })));
    if (!saved?.id) {
      throw new FeedbackToolError("気づきを保存できませんでした。");
    }
    return {
      id: saved.id,
      requestId: saved.requestId ?? requestId,
      replayed: saved.replayed === true,
    };
  } catch (error) {
    if (error instanceof FeedbackToolError || error instanceof ApiContractError) throw error;
    const code = asRecord(error)?.code;
    if (code === "54000") throw new FeedbackToolError("気づきの送信は1時間あたり20件までです。");
    if (code === "22023") throw new FeedbackToolError("本文は1文字以上2000文字以下です。");
    if (code === "42501") throw new FeedbackToolError("この連携資格では許可されていない操作です。");
    throw mapRpcError(error, "save");
  }
}
