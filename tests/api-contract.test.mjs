import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ApiContractError,
  assertPublicHttpsWebhookUrl,
  errorBody,
  parseApiRoute,
  signWebhookBody,
  WEBHOOK_EVENTS,
} from "../supabase/functions/api/contract.mjs";
import { handleApiRequest } from "../supabase/functions/api/handler.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const orgId = "20000000-0000-4000-8000-000000000001";
const memberId = "60000000-0000-4000-8000-000000000001";
const projectId = "62000000-0000-4000-8000-000000000001";
const clientId = "52000000-0000-4000-8000-000000000001";
const secret = "mosaic_sk_abc123def45600112233445566778899aabbccddeeff0011";

function snapshot() {
  return {
    organization: { id: orgId, name: "MOSAIC", workspaceRevision: 7 },
    members: [{
      id: memberId,
      initials: "AA",
      name: "Alice A",
      role: "Backend Engineer",
      department: "開発",
      avatarTone: "lavender",
      skills: ["API"],
      location: "東京",
      capacity: 100,
    }],
    projects: [{
      id: projectId,
      code: "ATL",
      name: "Atlas",
      summary: "基幹",
      status: "進行中",
      tone: "blue",
      ownerPersonId: memberId,
      startDate: "2026-08-01",
      endDate: "2026-08-31",
      nextMilestone: "",
      nextMilestoneDate: null,
      progress: 40,
      demand: 2,
    }],
    assignments: [],
    needs: [],
    skillCatalog: [],
    customFields: [],
  };
}

test("parses versioned API paths including the platform function prefix", () => {
  assert.deepEqual(parseApiRoute("GET", "/functions/v1/api/v1/members"), {
    method: "GET",
    resource: "members",
    id: undefined,
    extra: undefined,
  });
  assert.deepEqual(parseApiRoute("POST", "/v1/staffing-needs/63000000-0000-4000-8000-000000000001/assign"), {
    method: "POST",
    resource: "staffing-needs",
    id: "63000000-0000-4000-8000-000000000001",
    extra: "assign",
  });
  assert.throws(
    () => parseApiRoute("GET", "/functions/v1/chat"),
    (error) => error instanceof ApiContractError && error.code === "NOT_FOUND",
  );
  assert.throws(
    () => parseApiRoute("GET", "/v2/members"),
    (error) => error instanceof ApiContractError && error.code === "NOT_FOUND",
  );
});

test("rejects localhost, private, and non-https webhook destinations", () => {
  assert.doesNotThrow(() => assertPublicHttpsWebhookUrl("https://hooks.example.com/mosaic"));
  assert.throws(
    () => assertPublicHttpsWebhookUrl("http://hooks.example.com/mosaic"),
    (error) => error instanceof ApiContractError && error.code === "INVALID_WEBHOOK_URL",
  );
  assert.throws(
    () => assertPublicHttpsWebhookUrl("https://localhost/hook"),
    (error) => error instanceof ApiContractError && error.code === "INVALID_WEBHOOK_URL",
  );
  assert.throws(
    () => assertPublicHttpsWebhookUrl("https://127.0.0.1/hook"),
    (error) => error instanceof ApiContractError && error.code === "INVALID_WEBHOOK_URL",
  );
  assert.throws(
    () => assertPublicHttpsWebhookUrl("https://10.0.0.8/hook"),
    (error) => error instanceof ApiContractError && error.code === "INVALID_WEBHOOK_URL",
  );
  assert.throws(
    () => assertPublicHttpsWebhookUrl("https://192.168.1.4/hook"),
    (error) => error instanceof ApiContractError && error.code === "INVALID_WEBHOOK_URL",
  );
  assert.throws(
    () => assertPublicHttpsWebhookUrl("https://169.254.169.254/latest/meta-data"),
    (error) => error instanceof ApiContractError && error.code === "INVALID_WEBHOOK_URL",
  );
  assert.throws(
    () => assertPublicHttpsWebhookUrl("https://user:pass@hooks.example.com/mosaic"),
    (error) => error instanceof ApiContractError && error.code === "INVALID_WEBHOOK_URL",
  );
  assert.deepEqual(WEBHOOK_EVENTS, [
    "workspace.committed",
    "member.changed",
    "project.changed",
    "assignment.changed",
    "staffing_need.changed",
  ]);
});

test("signs webhook bodies as hex HMAC-SHA256", async () => {
  const body = '{"type":"workspace.committed"}';
  const header = await signWebhookBody("a".repeat(64), body);
  const expected = `sha256=${createHmac("sha256", "a".repeat(64)).update(body).digest("hex")}`;
  assert.equal(header, expected);
});

function authorizeOk(scopes = ["workspace:read"]) {
  return {
    allowed: true,
    remaining: 59,
    client: { id: clientId, organizationId: orgId, name: "CI", scopes },
  };
}

function rpcMap(overrides = {}) {
  const calls = [];
  const map = {
    authorize_integration_request: async () => authorizeOk(["workspace:read", "members:write"]),
    integration_get_workspace: async () => snapshot(),
    integration_save_workspace: async () => ({
      organizationId: orgId,
      revision: 8,
      requestId: "40000000-0000-4000-8000-000000000099",
      replayed: false,
      savedAt: "2026-08-19T00:00:00Z",
    }),
    claim_webhook_outbox: async () => ({ items: [] }),
    complete_webhook_outbox: async () => ({ delivered: true, failed: false }),
    ...overrides,
  };
  return {
    calls,
    rpc: async (name, args) => {
      calls.push({ name, args });
      const handler = map[name];
      if (!handler) throw new Error(`unexpected rpc ${name}`);
      return handler(args);
    },
  };
}

function apiRequest(path, { method = "GET", body, headers = {} } = {}) {
  return new Request(`https://example.supabase.co/functions/v1/api${path}`, {
    method,
    headers: {
      authorization: `Bearer ${secret}`,
      ...(body ? { "content-type": "application/json" } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}

test("rejects missing credentials and user JWTs", async () => {
  const { rpc } = rpcMap();
  const missing = await handleApiRequest(new Request("https://example.supabase.co/functions/v1/api/v1/members"), { rpc });
  assert.equal(missing.status, 401);
  assert.deepEqual(await missing.json(), errorBody("UNAUTHORIZED", "連携資格が必要です。", false));

  const jwt = await handleApiRequest(new Request("https://example.supabase.co/functions/v1/api/v1/members", {
    headers: { authorization: "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.e30.x" },
  }), { rpc });
  assert.equal(jwt.status, 401);
});

test("lists members through the shared catalog without confirmation", async () => {
  const { rpc, calls } = rpcMap();
  const response = await handleApiRequest(apiRequest("/v1/members?limit=5"), { rpc });
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.resource, "members");
  assert.equal(payload.revision, 7);
  assert.equal(payload.items[0].name, "Alice A");
  assert.equal(calls[0].name, "authorize_integration_request");
  assert.equal(calls[1].name, "integration_get_workspace");
  assert.equal(calls.some((call) => call.name === "integration_save_workspace"), false);
});

test("creates a member through planWorkspaceAction and impersonated save", async () => {
  const { rpc, calls } = rpcMap();
  const response = await handleApiRequest(apiRequest("/v1/members", {
    method: "POST",
    headers: { "Idempotency-Key": "40000000-0000-4000-8000-000000000011" },
    body: {
      name: "Dana D",
      role: "Designer",
      department: "デザイン",
      location: "福岡",
      capacity: 80,
      skills: ["Figma"],
    },
  }), { rpc });
  assert.equal(response.status, 201);
  const payload = await response.json();
  assert.equal(payload.revision, 8);
  const save = calls.find((call) => call.name === "integration_save_workspace");
  assert.ok(save);
  assert.equal(save.args.p_client_id, clientId);
  assert.equal(save.args.p_request_id, "40000000-0000-4000-8000-000000000011");
  assert.ok(save.args.p_payload.members);
});

test("forbids writes that the credential scope does not allow", async () => {
  const { rpc } = rpcMap({
    authorize_integration_request: async () => authorizeOk(["workspace:read"]),
  });
  const response = await handleApiRequest(apiRequest("/v1/projects", {
    method: "POST",
    body: { name: "Nova", startDate: "2026-08-01", endDate: "2026-08-31" },
  }), { rpc });
  assert.equal(response.status, 403);
  const payload = await response.json();
  assert.equal(payload.error.code, "FORBIDDEN");
});

test("delivers claimed webhook outbox items with a signature header", async () => {
  const delivered = [];
  const { rpc } = rpcMap({
    claim_webhook_outbox: async () => ({
      items: [{
        id: 9,
        organizationId: orgId,
        eventType: "workspace.committed",
        payload: { type: "workspace.committed", organizationId: orgId, revision: 8 },
        attempts: 1,
        endpoints: [{
          id: "72000000-0000-4000-8000-000000000001",
          url: "https://hooks.example.com/mosaic",
          secret: "b".repeat(64),
          events: ["workspace.committed"],
        }],
      }],
    }),
  });
  const response = await handleApiRequest(apiRequest("/v1/members?limit=1"), {
    rpc,
    fetchImpl: async (url, init) => {
      delivered.push({ url, init });
      return new Response("ok", { status: 200 });
    },
    waitUntil: async (task) => { await task; },
  });
  assert.equal(response.status, 200);
  assert.equal(delivered.length, 1);
  assert.equal(delivered[0].url, "https://hooks.example.com/mosaic");
  assert.match(delivered[0].init.headers["X-MOSAIC-Signature"], /^sha256=[0-9a-f]{64}$/);
  assert.equal(delivered[0].init.headers["X-MOSAIC-Event"], "workspace.committed");
});

test("keeps the API function unauthenticated at the gateway and separate from chat", async () => {
  const [configuration, apiIndex, chatIndex, apiImports, sql] = await Promise.all([
    readFile(path.join(root, "supabase", "config.toml"), "utf8"),
    readFile(path.join(root, "supabase", "functions", "api", "index.ts"), "utf8"),
    readFile(path.join(root, "supabase", "functions", "chat", "index.ts"), "utf8"),
    readFile(path.join(root, "supabase", "functions", "api", "deno.json"), "utf8"),
    readFile(path.join(root, "supabase", "migrations", "20260819210000_external_api.sql"), "utf8"),
  ]);
  assert.match(configuration, /\[functions\.api\][\s\S]*verify_jwt = false/);
  assert.match(configuration, /\[functions\.chat\][\s\S]*verify_jwt = true/);
  assert.match(apiImports, /jsr:@supabase\/functions-js@2\.112\.3/);
  assert.match(apiImports, /npm:@supabase\/supabase-js@2\.112\.3/);
  assert.doesNotMatch(apiIndex, /withSupabase\(\{ auth: "user" \}/);
  assert.match(apiIndex, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(apiIndex, /authorize_integration_request/);
  assert.match(chatIndex, /withSupabase\(\{ auth: "user" \}/);
  assert.doesNotMatch(chatIndex, /functions\/v1\/api/);
  assert.match(sql, /webhook_url_is_public_https/);
  assert.match(sql, /169\\.254/);
  assert.match(sql, /member\.changed/);
  assert.match(sql, /grant execute on function public\.create_webhook_endpoint/);
  assert.doesNotMatch(sql, /grant execute on function public\.integration_get_workspace\(uuid\) to authenticated/);
  assert.doesNotMatch(sql, /grant execute on function public\.claim_webhook_outbox[\s\S]+to authenticated/);
});
