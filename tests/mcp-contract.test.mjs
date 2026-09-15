import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { handleMcpRequest } from "../supabase/functions/mcp/handler.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const orgId = "20000000-0000-4000-8000-000000000001";
const clientId = "52000000-0000-4000-8000-000000000001";
const secret = "mosaic_sk_abc123def45600112233445566778899aabbccddeeff0011";
const confirmSecret = "mcp-confirm-test-secret";
const otherClientId = "52000000-0000-4000-8000-000000000002";

function snapshot() {
  return {
    organization: { id: orgId, name: "MOSAIC", workspaceRevision: 4 },
    members: [{
      id: "60000000-0000-4000-8000-000000000001",
      initials: "AA",
      name: "Alice A",
      role: "Backend Engineer",
      department: "開発",
      avatarTone: "lavender",
      skills: ["API"],
      location: "東京",
      capacity: 100,
    }],
    projects: [],
    assignments: [],
    needs: [],
    skillCatalog: [],
    customFields: [],
  };
}

function rpcMap(overrides = {}) {
  const calls = [];
  const map = {
    authorize_integration_request: async () => ({
      allowed: true,
      remaining: 58,
      client: { id: clientId, organizationId: orgId, name: "MCP Host", scopes: ["workspace:read"] },
    }),
    integration_get_workspace: async () => snapshot(),
    integration_submit_feedback: async () => {
      throw new Error("must not save before confirmation");
    },
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

function mcpRequest(body, headers = {}) {
  return new Request("https://example.supabase.co/functions/v1/mcp", {
    method: "POST",
    headers: {
      authorization: `Bearer ${secret}`,
      "content-type": "application/json",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

test("initializes as an MCP server and lists read_workspace plus submit_feedback", async () => {
  const { rpc } = rpcMap();
  const initialized = await handleMcpRequest(mcpRequest({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "test", version: "1" } },
  }), { rpc, confirmSecret });
  assert.equal(initialized.status, 200);
  const handshake = await initialized.json();
  assert.equal(handshake.result.serverInfo.name, "mosaic");
  assert.equal(handshake.result.capabilities.tools.listChanged, false);
  assert.match(handshake.result.instructions, /確認/);
  assert.match(handshake.result.instructions, /業務データ/);

  const listed = await handleMcpRequest(mcpRequest({ jsonrpc: "2.0", id: 2, method: "tools/list" }), { rpc, confirmSecret });
  const tools = (await listed.json()).result.tools;
  assert.deepEqual(tools.map((tool) => tool.name), ["read_workspace", "submit_feedback"]);
});

test("calls read_workspace through the shared catalog", async () => {
  const { rpc, calls } = rpcMap();
  const response = await handleMcpRequest(mcpRequest({
    jsonrpc: "2.0",
    id: 3,
    method: "tools/call",
    params: { name: "read_workspace", arguments: { resource: "members", limit: 5 } },
  }), { rpc, confirmSecret });
  assert.equal(response.status, 200);
  const payload = await response.json();
  const text = JSON.parse(payload.result.content[0].text);
  assert.equal(text.items[0].name, "Alice A");
  assert.equal(calls.some((call) => call.name === "integration_save_workspace"), false);
  assert.equal(calls.some((call) => call.name === "integration_submit_feedback"), false);
});

test("rejects write tools until the confirmation stage exists", async () => {
  const { rpc } = rpcMap();
  const response = await handleMcpRequest(mcpRequest({
    jsonrpc: "2.0",
    id: 4,
    method: "tools/call",
    params: { name: "create_member", arguments: { name: "Dana" } },
  }), { rpc, confirmSecret });
  const payload = await response.json();
  assert.equal(payload.id, 4);
  assert.equal(payload.result.isError, true);
  assert.match(payload.result.content[0].text, /read-only|参照のみ|書込/);
});

test("keeps JSON-RPC ids on tool validation errors and lists resources", async () => {
  const { rpc } = rpcMap();
  const invalid = await handleMcpRequest(mcpRequest({
    jsonrpc: "2.0",
    id: 9,
    method: "tools/call",
    params: { name: "read_workspace", arguments: { resource: "not-a-resource" } },
  }), { rpc });
  const invalidPayload = await invalid.json();
  assert.equal(invalidPayload.id, 9);
  assert.equal(invalidPayload.result.isError, true);

  const resources = await handleMcpRequest(mcpRequest({ jsonrpc: "2.0", id: 10, method: "resources/list" }), { rpc });
  assert.deepEqual((await resources.json()).result.resources.map((item) => item.uri), [
    "mosaic://members",
    "mosaic://projects",
    "mosaic://assignments",
    "mosaic://staffing-needs",
  ]);

  const notification = await handleMcpRequest(mcpRequest({ jsonrpc: "2.0", method: "notifications/initialized" }), { rpc });
  assert.equal(notification.status, 202);

  const browser = await handleMcpRequest(mcpRequest({ jsonrpc: "2.0", id: 11, method: "ping" }, { origin: "https://evil.example" }), { rpc });
  assert.equal(browser.status, 403);
});

test("rejects missing credentials and stays off the chat and api URLs", async () => {
  const { rpc } = rpcMap();
  const missing = await handleMcpRequest(new Request("https://example.supabase.co/functions/v1/mcp", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize" }),
  }), { rpc });
  assert.equal(missing.status, 401);

  const [configuration, mcpIndex, chatIndex, apiIndex] = await Promise.all([
    readFile(path.join(root, "supabase", "config.toml"), "utf8"),
    readFile(path.join(root, "supabase", "functions", "mcp", "index.ts"), "utf8"),
    readFile(path.join(root, "supabase", "functions", "chat", "index.ts"), "utf8"),
    readFile(path.join(root, "supabase", "functions", "api", "index.ts"), "utf8"),
  ]);
  assert.match(configuration, /\[functions\.mcp\][\s\S]*verify_jwt = false/);
  assert.match(configuration, /\[functions\.chat\][\s\S]*verify_jwt = true/);
  assert.match(mcpIndex, /authorize_integration_request/);
  assert.match(mcpIndex, /integration_submit_feedback/);
  assert.doesNotMatch(mcpIndex, /withSupabase\(\{ auth: "user" \}/);
  assert.doesNotMatch(chatIndex, /functions\/v1\/mcp/);
  assert.doesNotMatch(apiIndex, /functions\/v1\/mcp/);
});

test("previews submit_feedback without saving, then saves on the token alone", async () => {
  const saved = [];
  const { rpc, calls } = rpcMap({
    integration_submit_feedback: async (args) => {
      saved.push(args);
      return { id: "81000000-0000-4000-8000-000000000001", requestId: args.p_request_id, replayed: saved.length > 1 };
    },
  });
  const previewResponse = await handleMcpRequest(mcpRequest({
    jsonrpc: "2.0",
    id: 20,
    method: "tools/call",
    params: { name: "submit_feedback", arguments: { body: "  ボードの空き列が狭い  " } },
  }), { rpc, confirmSecret });
  const preview = await previewResponse.json();
  assert.equal(preview.result.isError, undefined);
  const previewBody = preview.result.structuredContent;
  assert.equal(previewBody.needsConfirmation, true);
  assert.equal(typeof previewBody.confirmationToken, "string");
  assert.equal(previewBody.preview.details[0].value, "ボードの空き列が狭い");
  assert.equal(calls.some((call) => call.name === "integration_submit_feedback"), false);

  const both = await handleMcpRequest(mcpRequest({
    jsonrpc: "2.0",
    id: 21,
    method: "tools/call",
    params: {
      name: "submit_feedback",
      arguments: { body: "ボードの空き列が狭い", confirmationToken: previewBody.confirmationToken },
    },
  }), { rpc, confirmSecret });
  assert.equal((await both.json()).result.isError, true);
  assert.equal(calls.some((call) => call.name === "integration_submit_feedback"), false);

  const confirmed = await handleMcpRequest(mcpRequest({
    jsonrpc: "2.0",
    id: 22,
    method: "tools/call",
    params: { name: "submit_feedback", arguments: { confirmationToken: previewBody.confirmationToken } },
  }), { rpc, confirmSecret });
  const savedPayload = await confirmed.json();
  assert.equal(savedPayload.result.structuredContent.replayed, false);
  assert.equal(saved[0].p_client_id, clientId);
  assert.equal(saved[0].p_body, "ボードの空き列が狭い");
  assert.match(saved[0].p_request_id, /^[0-9a-f-]{36}$/u);
  assert.equal(saved[0].p_source_screen, undefined);

  const replayed = await handleMcpRequest(mcpRequest({
    jsonrpc: "2.0",
    id: 23,
    method: "tools/call",
    params: { name: "submit_feedback", arguments: { confirmationToken: previewBody.confirmationToken } },
  }), { rpc, confirmSecret });
  assert.equal((await replayed.json()).result.structuredContent.replayed, true);
});

test("binds the confirmation token to the issuing client and maps rate limits", async () => {
  const { rpc: firstRpc } = rpcMap();
  const previewResponse = await handleMcpRequest(mcpRequest({
    jsonrpc: "2.0",
    id: 30,
    method: "tools/call",
    params: { name: "submit_feedback", arguments: { body: "他の資格では確定できない" } },
  }), { rpc: firstRpc, confirmSecret });
  const token = (await previewResponse.json()).result.structuredContent.confirmationToken;

  const { rpc: otherRpc, calls } = rpcMap({
    authorize_integration_request: async () => ({
      allowed: true,
      remaining: 58,
      client: { id: otherClientId, organizationId: orgId, name: "Other Host", scopes: ["workspace:read"] },
    }),
    integration_submit_feedback: async () => {
      throw new Error("must not save with another client token");
    },
  });
  const stolen = await handleMcpRequest(mcpRequest({
    jsonrpc: "2.0",
    id: 31,
    method: "tools/call",
    params: { name: "submit_feedback", arguments: { confirmationToken: token } },
  }), { rpc: otherRpc, confirmSecret });
  const stolenPayload = await stolen.json();
  assert.equal(stolenPayload.result.isError, true);
  assert.match(stolenPayload.result.content[0].text, /確認/);
  assert.equal(calls.some((call) => call.name === "integration_submit_feedback"), false);

  const screen = await handleMcpRequest(mcpRequest({
    jsonrpc: "2.0",
    id: 32,
    method: "tools/call",
    params: { name: "submit_feedback", arguments: { body: "ボード", sourceScreen: "board" } },
  }), { rpc: firstRpc, confirmSecret });
  assert.equal((await screen.json()).result.isError, true);

  const { rpc: limitedRpc } = rpcMap({
    integration_submit_feedback: async () => {
      const error = new Error("capped");
      error.code = "54000";
      throw error;
    },
  });
  const limitedPreview = await handleMcpRequest(mcpRequest({
    jsonrpc: "2.0",
    id: 33,
    method: "tools/call",
    params: { name: "submit_feedback", arguments: { body: "21件目" } },
  }), { rpc: limitedRpc, confirmSecret });
  const limitedToken = (await limitedPreview.json()).result.structuredContent.confirmationToken;
  const limited = await handleMcpRequest(mcpRequest({
    jsonrpc: "2.0",
    id: 34,
    method: "tools/call",
    params: { name: "submit_feedback", arguments: { confirmationToken: limitedToken } },
  }), { rpc: limitedRpc, confirmSecret });
  const limitedPayload = await limited.json();
  assert.equal(limitedPayload.result.isError, true);
  assert.match(limitedPayload.result.content[0].text, /20件/);
});
