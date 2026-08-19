import {
  WorkspaceToolError,
  buildWorkspaceSaveRequest,
  planWorkspaceAction,
  readWorkspaceTool,
} from "../chat/workspace-tools.mjs";
import {
  API_RESOURCES,
  ApiContractError,
  compactArgs,
  createDeterministicUuidSource,
  errorBody,
  isPrivateIpAddress,
  jsonResponse,
  mapRpcError,
  parseApiRoute,
  parseExpectedRevision,
  parseIdempotencyKey,
  readBearerSecret,
  readJsonBody,
  readListFilters,
  signWebhookBody,
} from "./contract.mjs";

function unwrapRpcValue(value) {
  return Array.isArray(value) && value.length === 1 ? value[0] : value;
}

function asRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value : undefined;
}

function findItem(result, id) {
  const items = Array.isArray(result?.items) ? result.items : [];
  return items.find((item) => item?.id === id);
}

function writeToolArgs(spec, method, extra, id, body) {
  if (extra === "assign") {
    return compactArgs({ staffingNeedId: id, personId: body.personId, label: body.label });
  }
  if (method === "POST") return body;
  if (method === "PATCH") return { [spec.idField]: id, patch: body };
  return { [spec.idField]: id };
}

async function rpcNamed(rpc, name, args, operation) {
  try {
    return unwrapRpcValue(await rpc(name, args));
  } catch (error) {
    if (error instanceof ApiContractError) throw error;
    throw mapRpcError(error, operation);
  }
}

export async function deliverWebhookBatch(items, { fetchImpl, resolveHost, complete }) {
  const deliveries = Array.isArray(items) ? items : [];
  for (const item of deliveries) {
    const payload = asRecord(item?.payload) ?? {};
    const body = JSON.stringify({
      id: String(item.id),
      type: item.eventType ?? payload.type,
      organizationId: item.organizationId ?? payload.organizationId,
      ...payload,
    });
    const endpoints = Array.isArray(item.endpoints) ? item.endpoints : [];
    let ok = true;
    let lastError;
    if (endpoints.length === 0) {
      await complete(item.id, true);
      continue;
    }
    for (const endpoint of endpoints) {
      try {
        const url = new URL(endpoint.url);
        if (url.protocol !== "https:" || url.username || url.password) {
          throw new Error("blocked url");
        }
        if (typeof resolveHost === "function") {
          const addresses = await resolveHost(url.hostname);
          if (!Array.isArray(addresses) || addresses.length === 0 || addresses.some(isPrivateIpAddress)) {
            throw new Error("blocked host");
          }
        } else if (isPrivateIpAddress(url.hostname)) {
          throw new Error("blocked host");
        }
        const signature = await signWebhookBody(endpoint.secret, body);
        const response = await fetchImpl(endpoint.url, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "X-MOSAIC-Signature": signature,
            "X-MOSAIC-Event": String(item.eventType ?? payload.type ?? ""),
            "X-MOSAIC-Delivery": String(item.id),
          },
          body,
          redirect: "manual",
          signal: AbortSignal.timeout(4_000),
        });
        if (response.status >= 300 && response.status < 400) throw new Error("redirect blocked");
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
      } catch (error) {
        ok = false;
        lastError = error instanceof Error ? error.message : "delivery failed";
      }
    }
    await complete(item.id, ok, lastError);
  }
}

async function drainWebhooks(rpc, organizationId, options) {
  const claimed = asRecord(await rpcNamed(rpc, "claim_webhook_outbox", {
    p_organization_id: organizationId,
    p_limit: 5,
  }, "save")) ?? { items: [] };
  await deliverWebhookBatch(claimed.items ?? [], {
    fetchImpl: options.fetchImpl ?? fetch,
    resolveHost: options.resolveHost,
    complete: (id, ok, error) => rpcNamed(rpc, "complete_webhook_outbox", {
      p_outbox_id: id,
      p_ok: ok,
      p_error: error ?? null,
    }, "save"),
  });
}

function scheduleDrain(rpc, organizationId, options) {
  const task = drainWebhooks(rpc, organizationId, options).catch(() => undefined);
  if (typeof options.waitUntil === "function") {
    options.waitUntil(task);
    return undefined;
  }
  return task;
}

export async function handleApiRequest(request, options = {}) {
  const rpc = options.rpc;
  try {
    if (!rpc) throw new ApiContractError("NOT_CONFIGURED", "APIの準備ができていません。", 503);
    const secret = readBearerSecret(request);
    const url = new URL(request.url);
    const route = parseApiRoute(request.method, url.pathname);
    const spec = API_RESOURCES[route.resource];

    const authorized = asRecord(await rpcNamed(rpc, "authorize_integration_request", { p_secret: secret }, "read"));
    if (authorized?.allowed === false || authorized?.code === "RATE_LIMITED") {
      const retryAfter = Number(authorized.retryAfterSeconds) || 1;
      return jsonResponse(errorBody("RATE_LIMITED", "短時間に多くの要求が送られました。少し待ってからお試しください。", true), 429, {
        "Retry-After": String(retryAfter),
      });
    }
    const client = asRecord(authorized?.client);
    if (!client?.id || !Array.isArray(client.scopes)) {
      throw new ApiContractError("UNAUTHORIZED", "連携資格が必要です。", 401);
    }
    const caller = { kind: "integration", scopes: client.scopes, clientId: client.id };
    const snapshot = await rpcNamed(rpc, "integration_get_workspace", { p_client_id: client.id }, "read");
    const remaining = authorized.remaining;
    const rateHeaders = remaining === undefined ? {} : { "X-RateLimit-Remaining": String(remaining) };

    if (route.method === "GET" && !route.extra) {
      const filters = compactArgs({
        ...readListFilters(url),
        resource: spec.read,
        ...(route.id ? { id: route.id, limit: 1 } : {}),
      });
      const result = readWorkspaceTool(snapshot, "read_workspace", filters, caller);
      if (route.id) {
        const item = findItem(result, route.id);
        if (!item) throw new ApiContractError("NOT_FOUND", "対象のデータが見つかりません。", 404);
        scheduleDrain(rpc, client.organizationId, options);
        return jsonResponse({ resource: spec.read, revision: result.revision, item }, 200, rateHeaders);
      }
      scheduleDrain(rpc, client.organizationId, options);
      return jsonResponse(result, 200, rateHeaders);
    }

    const idempotencyKey = parseIdempotencyKey(request);
    const expectedRevision = parseExpectedRevision(request);
    const requestId = idempotencyKey ?? (typeof options.uuid === "function" ? options.uuid() : crypto.randomUUID());
    const uuid = idempotencyKey ? createDeterministicUuidSource(requestId) : options.uuid;
    const body = route.method === "DELETE" ? {} : await readJsonBody(request);
    const toolName = route.extra === "assign" ? spec.assign : route.method === "POST" ? spec.create : route.method === "PATCH" ? spec.update : spec.remove;
    const args = writeToolArgs(spec, route.method, route.extra, route.id, body);

    if (expectedRevision !== undefined) {
      const currentRevision = Number(asRecord(snapshot)?.organization?.workspaceRevision ?? asRecord(snapshot)?.revision);
      if (currentRevision !== expectedRevision) {
        throw new ApiContractError("WORKSPACE_CONFLICT", "他の更新が先に保存されました。最新データを取得してやり直してください。", 409);
      }
    }

    let plan;
    try {
      plan = await planWorkspaceAction({
        snapshot,
        toolName,
        args,
        caller,
        requestId,
        uuid,
      });
    } catch (error) {
      if (error instanceof WorkspaceToolError) {
        throw new ApiContractError(error.code, error.message, error.status ?? 400);
      }
      throw error;
    }

    const saveRequest = buildWorkspaceSaveRequest(plan);
    const saved = asRecord(await rpcNamed(rpc, "integration_save_workspace", {
      p_client_id: client.id,
      p_expected_revision: saveRequest.p_expected_revision,
      p_request_id: saveRequest.p_request_id,
      p_payload: saveRequest.p_payload,
      p_payload_hash: saveRequest.p_payload_hash,
    }, "save"));

    scheduleDrain(rpc, client.organizationId, options);
    const status = route.method === "POST" ? 201 : 200;
    return jsonResponse({
      revision: saved?.revision,
      requestId: saved?.requestId ?? requestId,
      replayed: saved?.replayed === true,
      savedAt: saved?.savedAt,
      action: toolName,
    }, status, rateHeaders);
  } catch (error) {
    if (error instanceof WorkspaceToolError) {
      return jsonResponse(errorBody(error.code, error.message, false), error.status ?? 400);
    }
    if (error instanceof ApiContractError) {
      return jsonResponse(errorBody(error.code, error.message, error.retryable), error.status);
    }
    return jsonResponse(errorBody("INTERNAL_ERROR", "操作を完了できませんでした。しばらくしてからもう一度お試しください。", false), 500);
  }
}
