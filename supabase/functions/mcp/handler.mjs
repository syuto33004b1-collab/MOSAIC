import { readWorkspaceTool, WorkspaceToolError } from "../chat/workspace-tools.mjs";
import { ApiContractError, errorBody, jsonResponse, mapRpcError, readBearerSecret, readJsonBody } from "../api/contract.mjs";
import {
  isWriteTool,
  jsonRpcError,
  jsonRpcResult,
  MCP_PROTOCOL_VERSION,
  MCP_RESOURCES,
  MCP_SERVER_INFO,
  readOnlyToolDeclarations,
  resourceForUri,
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
  const authorized = asRecord(await rpcNamed(rpc, "authorize_integration_request", { p_secret: secret }, "read"));
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

export async function handleMcpRequest(request, options = {}) {
  const rpc = options.rpc;
  try {
    if (request.method !== "POST") {
      return jsonResponse(errorBody("METHOD_NOT_ALLOWED", "POSTで送信してください。", false), 405, { Allow: "POST" });
    }
    const session = await authorize(request, rpc);
    const message = await readJsonBody(request);
    const id = message.id ?? null;
    const method = message.method;
    const params = asRecord(message.params) ?? {};
    const headers = session.remaining === undefined ? {} : { "X-RateLimit-Remaining": String(session.remaining) };

    if (method === "initialize") {
      return jsonResponse(jsonRpcResult(id, {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false }, resources: { listChanged: false } },
        serverInfo: MCP_SERVER_INFO,
        instructions: "MOSAICの参照専用MCPです。書込みはまだ提供しません。",
      }), 200, headers);
    }
    if (method === "notifications/initialized" || method === "notifications/cancelled") {
      return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
    }
    if (method === "ping") {
      return jsonResponse(jsonRpcResult(id, {}), 200, headers);
    }
    if (method === "tools/list") {
      return jsonResponse(jsonRpcResult(id, { tools: readOnlyToolDeclarations() }), 200, headers);
    }
    if (method === "resources/list") {
      return jsonResponse(jsonRpcResult(id, {
        resources: MCP_RESOURCES.map(({ uri, name, mimeType }) => ({ uri, name, mimeType })),
      }), 200, headers);
    }
    if (method === "tools/call") {
      const name = typeof params.name === "string" ? params.name : "";
      if (isWriteTool(name)) {
        return jsonResponse(toolError(id, "このMCPサーバーは現在参照のみです。書込みは確認付きの次段で提供します。"), 200, headers);
      }
      if (name !== "read_workspace") {
        return jsonResponse(toolError(id, "許可されていないtoolです。"), 200, headers);
      }
      const snapshot = await rpcNamed(rpc, "integration_get_workspace", { p_client_id: session.client.id }, "read");
      const result = readWorkspaceTool(snapshot, name, asRecord(params.arguments) ?? {}, session.caller);
      return jsonResponse(jsonRpcResult(id, {
        content: [{ type: "text", text: JSON.stringify(result) }],
        structuredContent: result,
      }), 200, headers);
    }
    if (method === "resources/read") {
      const resource = resourceForUri(params.uri);
      if (!resource) return jsonResponse(jsonRpcError(id, -32002, "Resource not found"), 200, headers);
      const snapshot = await rpcNamed(rpc, "integration_get_workspace", { p_client_id: session.client.id }, "read");
      const result = readWorkspaceTool(snapshot, "read_workspace", { resource: resource.resource }, session.caller);
      return jsonResponse(jsonRpcResult(id, {
        contents: [{ uri: resource.uri, mimeType: resource.mimeType, text: JSON.stringify(result) }],
      }), 200, headers);
    }
    return jsonResponse(jsonRpcError(id, -32601, "Method not found"), 200, headers);
  } catch (error) {
    if (error instanceof WorkspaceToolError) {
      const id = null;
      return jsonResponse(toolError(id, error.message), 200);
    }
    if (error instanceof ApiContractError) {
      return jsonResponse(errorBody(error.code, error.message, error.retryable), error.status);
    }
    return jsonResponse(errorBody("INTERNAL_ERROR", "操作を完了できませんでした。しばらくしてからもう一度お試しください。", false), 500);
  }
}
