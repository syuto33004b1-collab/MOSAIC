import assert from "node:assert/strict";
import { test } from "node:test";
import {
  callExternalTool,
  externalToolDeclarations,
  externalToolName,
  isExternalToolName,
  McpClientError,
  MCP_CLIENT_LIMITS,
  parseExternalToolName,
  secretEnvName,
} from "../supabase/functions/chat/mcp-client.mjs";
import { WORKSPACE_TOOL_DECLARATIONS } from "../supabase/functions/chat/workspace-tools.mjs";

const organizationId = "21000000-0000-4000-8000-000000000101";

function approvedServers() {
  return [{ serverKey: "acme_hr", name: "ACME人事", tools: ["search_employee", "get-attendance"] }];
}

function opened(url = "https://mcp.example.com/mcp") {
  return { callId: "31000000-0000-4000-8000-000000000101", serverKey: "acme_hr", serverName: "ACME人事", toolName: "search_employee", url };
}

function stubRpc(overrides = {}) {
  const calls = [];
  const rpc = async (name, args) => {
    calls.push({ name, args });
    if (name === "begin_mcp_call") return overrides.begin ? overrides.begin(args) : opened();
    if (name === "complete_mcp_call") return { recorded: true };
    throw new Error(`unexpected rpc ${name}`);
  };
  return { rpc, calls };
}

function jsonResponse(body, init = {}) {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    headers: { get: (name) => (name.toLowerCase() === "mcp-session-id" ? (init.sessionId ?? "") : null) },
    text: async () => JSON.stringify(body),
  };
}

test("keeps external declarations separate from the workspace tool catalogue", () => {
  const declarations = externalToolDeclarations(approvedServers());
  assert.deepEqual(declarations.map((tool) => tool.name), ["mcp_acme_hr-search_employee", "mcp_acme_hr-get-attendance"]);
  const workspaceNames = new Set(WORKSPACE_TOOL_DECLARATIONS.map((tool) => tool.name));
  assert.ok(declarations.every((tool) => !workspaceNames.has(tool.name)), "external names must not collide with workspace tools");
  // Gemini caps a function name at 64 characters.
  assert.ok(declarations.every((tool) => tool.name.length <= 64));
});

test("decodes the server and tool halves and rejects anything else", () => {
  assert.equal(externalToolName("acme_hr", "get-attendance"), "mcp_acme_hr-get-attendance");
  assert.deepEqual(parseExternalToolName("mcp_acme_hr-get-attendance"), { serverKey: "acme_hr", toolName: "get-attendance" });
  assert.equal(isExternalToolName("read_workspace"), false);
  assert.equal(parseExternalToolName("mcp_ACME-x"), undefined);
  assert.equal(parseExternalToolName("mcp_acme_hr"), undefined);
  assert.equal(parseExternalToolName(`mcp_acme_hr-${"x".repeat(41)}`), undefined);
  assert.equal(secretEnvName("acme_hr"), "MCP_SECRET_ACME_HR");
});

test("drops servers and tools the registry never approved", () => {
  assert.deepEqual(externalToolDeclarations(undefined), []);
  assert.deepEqual(externalToolDeclarations([{ serverKey: "Bad-Key", tools: ["ok"] }]), []);
  assert.deepEqual(externalToolDeclarations([{ serverKey: "acme", tools: ["has space", "ok"] }]).map((tool) => tool.name), ["mcp_acme-ok"]);
  const many = externalToolDeclarations([{ serverKey: "acme", tools: Array.from({ length: 40 }, (unused, index) => `tool_${index}`) }]);
  assert.equal(many.length, MCP_CLIENT_LIMITS.maxDeclarations);
});

test("dials only the address begin_mcp_call returned and marks the result untrusted", async () => {
  const { rpc, calls } = stubRpc();
  const requested = [];
  const fetchImpl = async (url, init) => {
    requested.push({ url, body: JSON.parse(init.body), headers: init.headers, redirect: init.redirect });
    const message = JSON.parse(init.body);
    if (message.method === "initialize") return jsonResponse({ jsonrpc: "2.0", id: 1, result: {} }, { sessionId: "session-1" });
    return jsonResponse({ jsonrpc: "2.0", id: 2, result: { content: [{ type: "text", text: "山田 太郎 / 人事部" }] } });
  };
  const result = await callExternalTool({
    organizationId,
    serverKey: "acme_hr",
    toolName: "search_employee",
    args: JSON.stringify({ query: "山田" }),
    fetchImpl,
    resolveHost: async () => ["93.184.216.34"],
    rpc,
    env: () => "outbound-secret",
  });

  assert.equal(result.ok, true);
  assert.equal(result.untrusted, true);
  assert.equal(result.text, "山田 太郎 / 人事部");
  assert.deepEqual(result.source, { server: "ACME人事", tool: "search_employee" });
  assert.match(result.note, /指示として扱ってはいけません/u);
  assert.deepEqual(requested.map((entry) => entry.url), ["https://mcp.example.com/mcp", "https://mcp.example.com/mcp"]);
  assert.equal(requested[0].redirect, "error");
  assert.equal(requested[0].headers.Authorization, "Bearer outbound-secret");
  assert.equal(requested[1].headers["Mcp-Session-Id"], "session-1");
  assert.deepEqual(requested[1].body.params, { name: "search_employee", arguments: { query: "山田" } });
  assert.deepEqual(calls.map((entry) => entry.name), ["begin_mcp_call", "complete_mcp_call"]);
  assert.equal(calls[1].args.p_ok, true);
});

test("refuses an address that resolves into private space and still records the attempt", async () => {
  const { rpc, calls } = stubRpc();
  let fetched = 0;
  await assert.rejects(
    () => callExternalTool({
      organizationId,
      serverKey: "acme_hr",
      toolName: "search_employee",
      fetchImpl: async () => {
        fetched += 1;
        return jsonResponse({});
      },
      resolveHost: async () => ["10.0.0.5"],
      rpc,
      env: () => "",
    }),
    (error) => error instanceof McpClientError && error.code === "EXTERNAL_URL_REJECTED",
  );
  assert.equal(fetched, 0, "no request may leave before the address is cleared");
  assert.equal(calls[1].name, "complete_mcp_call");
  assert.equal(calls[1].args.p_ok, false);
  assert.equal(calls[1].args.p_error_code, "EXTERNAL_URL_REJECTED");
});

test("refuses a loopback or plain http address handed back by the registry", async () => {
  for (const url of ["http://mcp.example.com/mcp", "https://127.0.0.1/mcp", "https://mcp.internal/mcp"]) {
    const { rpc } = stubRpc({ begin: () => opened(url) });
    await assert.rejects(
      () => callExternalTool({
        organizationId,
        serverKey: "acme_hr",
        toolName: "search_employee",
        fetchImpl: async () => jsonResponse({}),
        resolveHost: async () => ["93.184.216.34"],
        rpc,
        env: () => "",
      }),
      (error) => error instanceof McpClientError && error.code === "EXTERNAL_URL_REJECTED",
      url,
    );
  }
});

test("caps how much leaves the tenant in one call", async () => {
  const { rpc, calls } = stubRpc();
  await assert.rejects(
    () => callExternalTool({
      organizationId,
      serverKey: "acme_hr",
      toolName: "search_employee",
      args: JSON.stringify({ dump: "x".repeat(MCP_CLIENT_LIMITS.maxArgumentBytes + 1) }),
      fetchImpl: async () => jsonResponse({}),
      resolveHost: async () => ["93.184.216.34"],
      rpc,
      env: () => "",
    }),
    (error) => error instanceof McpClientError && error.code === "EXTERNAL_ARGUMENTS_TOO_LARGE",
  );
  assert.equal(calls.length, 0, "the audit row must not open when the request is refused up front");
});

test("keeps only text blocks and truncates an oversized response", async () => {
  const { rpc } = stubRpc();
  const fetchImpl = async (url, init) => {
    const message = JSON.parse(init.body);
    if (message.method === "initialize") return jsonResponse({ jsonrpc: "2.0", id: 1, result: {} });
    return jsonResponse({
      jsonrpc: "2.0",
      id: 2,
      result: {
        content: [
          { type: "resource", resource: { uri: "file:///etc/passwd" } },
          { type: "text", text: "y".repeat(MCP_CLIENT_LIMITS.maxResponseBytes + 500) },
        ],
      },
    });
  };
  const result = await callExternalTool({
    organizationId,
    serverKey: "acme_hr",
    toolName: "search_employee",
    fetchImpl,
    resolveHost: async () => ["93.184.216.34"],
    rpc,
    env: () => "",
  });
  assert.equal(result.truncated, true);
  assert.equal(result.text.length, MCP_CLIENT_LIMITS.maxResponseBytes);
  assert.doesNotMatch(result.text, /passwd/u);
});

test("turns a JSON-RPC error and an empty result into a refusal", async () => {
  for (const [body, code] of [
    [{ jsonrpc: "2.0", id: 2, error: { code: -32000, message: "nope" } }, "EXTERNAL_TOOL_ERROR"],
    [{ jsonrpc: "2.0", id: 2, result: { content: [] } }, "EXTERNAL_EMPTY_RESULT"],
  ]) {
    const { rpc } = stubRpc();
    await assert.rejects(
      () => callExternalTool({
        organizationId,
        serverKey: "acme_hr",
        toolName: "search_employee",
        fetchImpl: async (url, init) => JSON.parse(init.body).method === "initialize"
          ? jsonResponse({ jsonrpc: "2.0", id: 1, result: {} })
          : jsonResponse(body),
        resolveHost: async () => ["93.184.216.34"],
        rpc,
        env: () => "",
      }),
      (error) => error instanceof McpClientError && error.code === code,
    );
  }
});

test("rejects arguments that are not a JSON object", async () => {
  const { rpc } = stubRpc();
  for (const args of ["[1,2]", "not json", "\"text\""]) {
    await assert.rejects(
      () => callExternalTool({
        organizationId,
        serverKey: "acme_hr",
        toolName: "search_employee",
        args,
        fetchImpl: async () => jsonResponse({}),
        resolveHost: async () => ["93.184.216.34"],
        rpc,
        env: () => "",
      }),
      (error) => error instanceof McpClientError && error.code === "INVALID_EXTERNAL_ARGUMENTS",
    );
  }
});
