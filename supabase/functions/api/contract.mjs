const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const WEBHOOK_EVENTS = Object.freeze([
  "workspace.committed",
  "member.changed",
  "project.changed",
  "assignment.changed",
  "staffing_need.changed",
]);

export const API_RESOURCES = Object.freeze({
  members: Object.freeze({
    read: "members",
    create: "create_member",
    update: "update_member",
    remove: "delete_member",
    idField: "memberId",
    collection: "members",
  }),
  projects: Object.freeze({
    read: "projects",
    create: "create_project",
    update: "update_project",
    remove: "delete_project",
    idField: "projectId",
    collection: "projects",
  }),
  assignments: Object.freeze({
    read: "assignments",
    create: "create_assignment",
    update: "update_assignment",
    remove: "delete_assignment",
    idField: "assignmentId",
    collection: "assignments",
  }),
  "staffing-needs": Object.freeze({
    read: "staffing_needs",
    create: "create_staffing_need",
    update: "update_staffing_need",
    remove: "delete_staffing_need",
    idField: "staffingNeedId",
    collection: "needs",
    assign: "assign_person_to_need",
  }),
});

export class ApiContractError extends Error {
  constructor(code, message, status = 400, retryable = false) {
    super(message);
    this.name = "ApiContractError";
    this.code = code;
    this.status = status;
    this.retryable = retryable;
  }
}

export function errorBody(code, message, retryable = false) {
  return { error: { code, message, retryable } };
}

function asRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value : undefined;
}

export function readBearerSecret(request) {
  const header = request.headers.get("authorization") ?? "";
  const match = header.match(/^Bearer\s+(\S+)$/i);
  const secret = match?.[1] ?? "";
  if (!/^mosaic_sk_[0-9a-f]{48}$/.test(secret)) {
    throw new ApiContractError("UNAUTHORIZED", "連携資格が必要です。", 401);
  }
  return secret;
}

function stripApiPrefix(pathname) {
  let path = pathname || "/";
  for (const prefix of ["/functions/v1/api", "/api"]) {
    if (path === prefix) return "/";
    if (path.startsWith(`${prefix}/`)) {
      path = path.slice(prefix.length);
      break;
    }
  }
  return path.startsWith("/") ? path : `/${path}`;
}

export function parseApiRoute(method, pathname) {
  const path = stripApiPrefix(pathname).replace(/\/+$/u, "") || "/";
  const parts = path.split("/").filter(Boolean);
  if (parts[0] !== "v1" || !parts[1] || !Object.hasOwn(API_RESOURCES, parts[1])) {
    throw new ApiContractError("NOT_FOUND", "このAPIパスは提供していません。", 404);
  }
  const resource = parts[1];
  const id = parts[2];
  const extra = parts[3];
  if (id && !UUID_PATTERN.test(id)) {
    throw new ApiContractError("INVALID_ID", "対象IDの形式を確認してください。");
  }
  if (parts.length > 4 || (extra && extra !== "assign") || (extra === "assign" && resource !== "staffing-needs")) {
    throw new ApiContractError("NOT_FOUND", "このAPIパスは提供していません。", 404);
  }
  if (extra === "assign" && method !== "POST") {
    throw new ApiContractError("METHOD_NOT_ALLOWED", "POSTで送信してください。", 405);
  }
  const allowed = extra === "assign"
    ? ["POST"]
    : id
      ? ["GET", "PATCH", "DELETE"]
      : ["GET", "POST"];
  if (!allowed.includes(method)) {
    throw new ApiContractError("METHOD_NOT_ALLOWED", `${allowed.join(" / ")}で送信してください。`, 405);
  }
  return { method, resource, id: id?.toLowerCase(), extra };
}

function isPrivateIPv4(host) {
  const parts = host.split(".").map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  const [a, b] = parts;
  if (a === 10 || a === 127 || a === 0) return true;
  if (a === 169 && b === 254) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  return false;
}

function isPrivateIPv6(host) {
  const value = host.replace(/^\[|\]$/g, "").toLowerCase();
  if (value === "::1" || value === "0:0:0:0:0:0:0:1") return true;
  if (value.startsWith("fc") || value.startsWith("fd") || value.startsWith("fe8") || value.startsWith("fe9") || value.startsWith("fea") || value.startsWith("feb")) {
    return true;
  }
  if (value.startsWith("::ffff:")) {
    const mapped = value.slice("::ffff:".length);
    return isPrivateIPv4(mapped) || isPrivateIPv6(mapped);
  }
  return false;
}

/**
 * Shared https/SSRF guard for every outbound address MOSAIC dials: webhook
 * endpoints and administrator-approved external MCP servers. Callers pass their
 * own error code and wording so the message matches the feature.
 */
export function assertPublicHttpsUrl(value, options) {
  const code = options?.code ?? "INVALID_URL";
  const formatMessage = options?.formatMessage ?? "httpsの公開アドレスを指定してください。";
  const privateMessage = options?.privateMessage ?? "プライベートまたはループバック宛てのアドレスは使用できません。";
  let parsed;
  try {
    parsed = new URL(String(value ?? "").trim());
  } catch {
    throw new ApiContractError(code, formatMessage);
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password) {
    throw new ApiContractError(code, formatMessage);
  }
  const host = parsed.hostname.toLowerCase();
  if (
    host === "localhost"
    || host.endsWith(".localhost")
    || host.endsWith(".local")
    || host.endsWith(".internal")
    || host === "metadata.google.internal"
  ) {
    throw new ApiContractError(code, privateMessage);
  }
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/u.test(host) && isPrivateIPv4(host)) {
    throw new ApiContractError(code, privateMessage);
  }
  if (host.includes(":") && isPrivateIPv6(host)) {
    throw new ApiContractError(code, privateMessage);
  }
  return parsed.toString();
}

export function assertPublicHttpsWebhookUrl(value) {
  return assertPublicHttpsUrl(value, {
    code: "INVALID_WEBHOOK_URL",
    formatMessage: "Webhook URLはhttpsの公開アドレスを指定してください。",
    privateMessage: "プライベートまたはループバック宛てのWebhookは登録できません。",
  });
}

export function isPrivateIpAddress(address) {
  const host = String(address ?? "").toLowerCase().replace(/^\[|\]$/g, "");
  if (!host) return true;
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/u.test(host)) return isPrivateIPv4(host);
  return isPrivateIPv6(host);
}

function bytesToHex(bytes) {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function signWebhookBody(secret, body) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  return `sha256=${bytesToHex(new Uint8Array(signature))}`;
}

export function parseIdempotencyKey(request) {
  const value = (request.headers.get("idempotency-key") ?? "").trim();
  if (!value) return undefined;
  if (!UUID_PATTERN.test(value)) {
    throw new ApiContractError("INVALID_IDEMPOTENCY_KEY", "Idempotency-KeyはUUIDを指定してください。");
  }
  return value.toLowerCase();
}

export function parseExpectedRevision(request) {
  const value = (request.headers.get("x-mosaic-expected-revision") ?? "").trim();
  if (!value) return undefined;
  const revision = Number(value);
  if (!Number.isSafeInteger(revision) || revision < 0) {
    throw new ApiContractError("INVALID_REVISION", "期待する更新番号を確認してください。");
  }
  return revision;
}

function csv(value) {
  return value ? value.split(",").map((item) => item.trim()).filter(Boolean) : undefined;
}

export function readListFilters(url) {
  const params = url.searchParams;
  const limitRaw = params.get("limit");
  const minAvailable = params.get("minAvailablePercent");
  return {
    resource: undefined,
    query: params.get("query") ?? undefined,
    personId: params.get("personId") ?? undefined,
    projectId: params.get("projectId") ?? undefined,
    ownerPersonId: params.get("ownerPersonId") ?? undefined,
    role: params.get("role") ?? undefined,
    location: params.get("location") ?? undefined,
    skills: csv(params.get("skills")),
    statuses: csv(params.get("statuses")),
    startDate: params.get("startDate") ?? undefined,
    endDate: params.get("endDate") ?? undefined,
    minAvailablePercent: minAvailable === null ? undefined : Number(minAvailable),
    limit: limitRaw === null ? undefined : Number(limitRaw),
  };
}

export function createDeterministicUuidSource(seed) {
  const base = String(seed ?? "").toLowerCase().replace(/[^0-9a-f]/g, "").padEnd(32, "0").slice(0, 32);
  let serial = 0;
  return () => {
    serial += 1;
    const serialHex = serial.toString(16).padStart(12, "0");
    return `${base.slice(0, 8)}-${base.slice(8, 12)}-4${base.slice(13, 16)}-8${base.slice(17, 20)}-${serialHex}`;
  };
}

export function compactArgs(value) {
  const result = {};
  for (const [key, entry] of Object.entries(value)) {
    if (entry !== undefined && entry !== null && entry !== "") result[key] = entry;
  }
  return result;
}

export async function readJsonBody(request, limitBytes = 1_048_576) {
  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.includes("application/json")) {
    throw new ApiContractError("UNSUPPORTED_MEDIA_TYPE", "JSON形式で送信してください。", 415);
  }
  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > limitBytes) {
    throw new ApiContractError("REQUEST_TOO_LARGE", "リクエストが大きすぎます。", 413);
  }
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > limitBytes) {
    throw new ApiContractError("REQUEST_TOO_LARGE", "リクエストが大きすぎます。", 413);
  }
  try {
    const parsed = JSON.parse(text);
    if (!asRecord(parsed)) throw new ApiContractError("INVALID_JSON", "JSONの形式を確認してください。");
    return parsed;
  } catch (error) {
    if (error instanceof ApiContractError) throw error;
    throw new ApiContractError("INVALID_JSON", "JSONの形式を確認してください。");
  }
}

export function jsonResponse(body, status = 200, extraHeaders = {}) {
  return Response.json(body, { headers: { "Cache-Control": "no-store", ...extraHeaders }, status });
}

export function mapRpcError(error, operation) {
  const record = asRecord(error);
  const code = typeof record?.code === "string" ? record.code : "";
  if (code === "42501" || code === "PGRST301" || code === "PGRST302") {
    return new ApiContractError("FORBIDDEN", "この連携資格では許可されていない操作です。", 403);
  }
  if (code === "40001") {
    return new ApiContractError("WORKSPACE_CONFLICT", "他の更新が先に保存されました。最新データを取得してやり直してください。", 409);
  }
  if (code === "P0002") {
    return new ApiContractError("NOT_FOUND", "対象のデータが見つかりません。", 404);
  }
  if (operation === "save" && ["22023", "23503", "23505", "23514", "54000"].includes(code)) {
    return new ApiContractError("ACTION_REJECTED", "現在のデータではこの変更を保存できません。", 409);
  }
  return new ApiContractError(
    operation === "read" ? "WORKSPACE_UNAVAILABLE" : "ACTION_UNAVAILABLE",
    "操作を完了できませんでした。しばらくしてからもう一度お試しください。",
    503,
    true,
  );
}
