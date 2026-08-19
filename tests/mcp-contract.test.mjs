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

test("initializes as a read-only MCP server and lists only read_workspace", async () => {
  const { rpc } = rpcMap();
  const initialized = await handleMcpRequest(mcpRequest({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "test", version: "1" } },
  }), { rpc });
  assert.equal(initialized.status, 200);
  const handshake = await initialized.json();
  assert.equal(handshake.result.serverInfo.name, "mosaic");
  assert.equal(handshake.result.capabilities.tools.listChanged, false);

  const listed = await handleMcpRequest(mcpRequest({ jsonrpc: "2.0", id: 2, method: "tools/list" }), { rpc });
  const tools = (await listed.json()).result.tools;
  assert.deepEqual(tools.map((tool) => tool.name), ["read_workspace"]);
});

test("calls read_workspace through the shared catalog", async () => {
  const { rpc, calls } = rpcMap();
  const response = await handleMcpRequest(mcpRequest({
    jsonrpc: "2.0",
    id: 3,
    method: "tools/call",
    params: { name: "read_workspace", arguments: { resource: "members", limit: 5 } },
  }), { rpc });
  assert.equal(response.status, 200);
  const payload = await response.json();
  const text = JSON.parse(payload.result.content[0].text);
  assert.equal(text.items[0].name, "Alice A");
  assert.equal(calls.some((call) => call.name === "integration_save_workspace"), false);
});

test("rejects write tools until the confirmation stage exists", async () => {
  const { rpc } = rpcMap();
  const response = await handleMcpRequest(mcpRequest({
    jsonrpc: "2.0",
    id: 4,
    method: "tools/call",
    params: { name: "create_member", arguments: { name: "Dana" } },
  }), { rpc });
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
  assert.doesNotMatch(mcpIndex, /withSupabase\(\{ auth: "user" \}/);
  assert.doesNotMatch(chatIndex, /functions\/v1\/mcp/);
  assert.doesNotMatch(apiIndex, /functions\/v1\/mcp/);
});
