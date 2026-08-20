import assert from "node:assert/strict";
import { test } from "node:test";
import {
  describeOperationDenial,
  INTEGRATION_LIMITS,
  INTEGRATION_SCOPES,
  OPERATION_CATALOG,
  roleMeetsMinimum,
  scopesForRole,
} from "../supabase/functions/chat/integration-core.mjs";
import { WORKSPACE_TOOL_DECLARATIONS } from "../supabase/functions/chat/workspace-tools.mjs";

test("the shared catalog covers every workspace tool and no arbitrary SQL/RPC names", () => {
  assert.deepEqual(Object.keys(OPERATION_CATALOG).sort(), WORKSPACE_TOOL_DECLARATIONS.map((tool) => tool.name).sort());
  assert.equal(WORKSPACE_TOOL_DECLARATIONS.some((tool) => /sql|rpc|http|url/i.test(tool.name)), false);
  assert.deepEqual(INTEGRATION_SCOPES, [
    "workspace:read",
    "members:write",
    "projects:write",
    "assignments:write",
    "staffing:write",
  ]);
});

test("human roles and integration scopes share the same operation ceiling", () => {
  assert.equal(describeOperationDenial({ kind: "ai", role: "viewer" }, "read_workspace"), null);
  assert.equal(describeOperationDenial({ kind: "ai", role: "planner" }, "create_assignment"), null);
  assert.equal(describeOperationDenial({ kind: "ai", role: "planner" }, "create_member")?.code, "FORBIDDEN");
  assert.equal(describeOperationDenial({ kind: "user", role: "admin" }, "create_member"), null);
  assert.equal(describeOperationDenial({ kind: "integration", scopes: ["workspace:read"] }, "read_workspace"), null);
  assert.equal(describeOperationDenial({ kind: "integration", scopes: ["workspace:read"] }, "create_project")?.code, "FORBIDDEN");
  assert.equal(describeOperationDenial({ kind: "integration", scopes: ["workspace:read", "staffing:write"] }, "assign_person_to_need"), null);
  assert.equal(describeOperationDenial({ kind: "integration", scopes: ["workspace:read"] }, "run_sql")?.code, "UNKNOWN_WORKSPACE_TOOL");
});

test("shared limits stay aligned with the existing chat and save_workspace ceilings", () => {
  assert.equal(INTEGRATION_LIMITS.maxReadResults, 25);
  assert.equal(INTEGRATION_LIMITS.chat.limit, 12);
  assert.equal(INTEGRATION_LIMITS.integration.limit, 60);
  assert.equal(INTEGRATION_LIMITS.maxActiveClientsPerOrg, 20);
  assert.equal(INTEGRATION_LIMITS.requestTimeoutMs, 30_000);
  assert.deepEqual(scopesForRole("planner"), ["workspace:read", "projects:write", "assignments:write", "staffing:write"]);
  assert.equal(roleMeetsMinimum("admin", "admin"), true);
  assert.equal(roleMeetsMinimum("planner", "admin"), false);
});

test("outbound mcp limits sit beside the existing ones without changing them", () => {
  assert.equal(INTEGRATION_LIMITS.mcpClient.limit, 20);
  assert.equal(INTEGRATION_LIMITS.mcpClient.maxServersPerOrg, 5);
  assert.equal(INTEGRATION_LIMITS.mcpClient.maxToolsPerServer, 8);
  assert.equal(INTEGRATION_LIMITS.mcpClient.maxArgumentBytes, 2_048);
  assert.equal(INTEGRATION_LIMITS.mcpClient.maxResponseBytes, 32_768);
  assert.equal(INTEGRATION_LIMITS.mcpClient.timeoutMs, 10_000);
  // The outbound client must not add or rename a workspace tool or a scope.
  assert.equal(Object.keys(OPERATION_CATALOG).length, WORKSPACE_TOOL_DECLARATIONS.length);
  assert.equal(INTEGRATION_SCOPES.length, 5);
});
