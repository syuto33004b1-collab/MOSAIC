/**
 * Shared integration core for UI sessions, the AI secretary adapter, and
 * future API/MCP adapters. This module does not expose HTTP routes.
 *
 * Adapters must:
 * - call only catalogued operations (no arbitrary SQL, RPC names, or URLs)
 * - authorize with a human org role or an integration client's scopes
 * - reuse workspace-tools parse/plan and save_workspace for writes
 * - never share the chat Edge Function URL with API or MCP traffic
 */

export const INTEGRATION_SCOPES = Object.freeze([
  "workspace:read",
  "members:write",
  "projects:write",
  "assignments:write",
  "staffing:write",
]);

export const INTEGRATION_LIMITS = Object.freeze({
  maxReadResults: 25,
  defaultReadResults: 10,
  maxSkills: 20,
  maxToolCallsPerRound: 4,
  maxToolRounds: 4,
  maxPayloadBytes: 1_048_576,
  maxPayloadOperations: 2_000,
  requestTimeoutMs: 30_000,
  maxActiveClientsPerOrg: 20,
  secretPrefix: "mosaic_sk_",
  secretHexLength: 48,
  chat: Object.freeze({ limit: 12, windowMs: 60_000 }),
  integration: Object.freeze({ limit: 60, windowMs: 60_000 }),
  // Outbound calls from the AI secretary to administrator-approved external MCP
  // servers. The execution path is separate from the inbound MCP Server; only
  // the credential and audit foundation is shared.
  mcpClient: Object.freeze({
    limit: 20,
    windowMs: 60_000,
    maxServersPerOrg: 5,
    maxToolsPerServer: 8,
    maxDeclarations: 12,
    maxArgumentBytes: 2_048,
    maxPreviewDetails: 20,
    maxResponseBytes: 32_768,
    timeoutMs: 10_000,
  }),
});

const ROLE_RANK = Object.freeze({
  viewer: 0,
  planner: 1,
  admin: 2,
  owner: 3,
});

function operation(mode, requiredScope, minRole, resources) {
  return Object.freeze({ mode, requiredScope, minRole, resources: Object.freeze(resources) });
}

export const OPERATION_CATALOG = Object.freeze({
  read_workspace: operation("read", "workspace:read", "viewer", [
    "summary",
    "members",
    "projects",
    "assignments",
    "staffing_needs",
    "opportunities",
    "opportunity_needs",
    "org_units",
    "org_memberships",
    "search_scenes",
    "saved_reports",
    "profile_requests",
  ]),
  create_member: operation("write", "members:write", "admin", ["members"]),
  update_member: operation("write", "members:write", "admin", ["members"]),
  delete_member: operation("write", "members:write", "admin", ["members"]),
  create_project: operation("write", "projects:write", "planner", ["projects"]),
  update_project: operation("write", "projects:write", "planner", ["projects"]),
  delete_project: operation("write", "projects:write", "planner", ["projects"]),
  create_assignment: operation("write", "assignments:write", "planner", ["assignments"]),
  update_assignment: operation("write", "assignments:write", "planner", ["assignments"]),
  delete_assignment: operation("write", "assignments:write", "planner", ["assignments"]),
  create_staffing_need: operation("write", "staffing:write", "planner", ["staffing_needs"]),
  update_staffing_need: operation("write", "staffing:write", "planner", ["staffing_needs"]),
  delete_staffing_need: operation("write", "staffing:write", "planner", ["staffing_needs"]),
  assign_person_to_need: operation("write", "staffing:write", "planner", ["staffing_needs", "assignments"]),
  create_opportunity: operation("write", "projects:write", "planner", ["opportunities"]),
  update_opportunity: operation("write", "projects:write", "planner", ["opportunities"]),
  delete_opportunity: operation("write", "projects:write", "planner", ["opportunities"]),
  create_opportunity_need: operation("write", "staffing:write", "planner", ["opportunity_needs"]),
  update_opportunity_need: operation("write", "staffing:write", "planner", ["opportunity_needs"]),
  delete_opportunity_need: operation("write", "staffing:write", "planner", ["opportunity_needs"]),
  convert_opportunity: operation("write", "projects:write", "planner", ["opportunities", "projects", "staffing_needs"]),
  create_org_unit: operation("write", "members:write", "admin", ["org_units"]),
  update_org_unit: operation("write", "members:write", "admin", ["org_units"]),
  delete_org_unit: operation("write", "members:write", "admin", ["org_units"]),
  set_member_org_memberships: operation("write", "members:write", "admin", ["org_memberships"]),
  create_search_scene: operation("write", "members:write", "admin", ["search_scenes"]),
  delete_search_scene: operation("write", "members:write", "admin", ["search_scenes"]),
  create_saved_report: operation("write", "members:write", "admin", ["saved_reports"]),
  delete_saved_report: operation("write", "members:write", "admin", ["saved_reports"]),
  create_profile_request: operation("write", "members:write", "admin", ["profile_requests"]),
  submit_profile_request: operation("write", "staffing:write", "planner", ["profile_requests"]),
  complete_profile_request: operation("write", "members:write", "admin", ["profile_requests", "members"]),
  cancel_profile_request: operation("write", "members:write", "admin", ["profile_requests"]),
});

export function roleMeetsMinimum(role, minRole) {
  return (ROLE_RANK[role] ?? -1) >= (ROLE_RANK[minRole] ?? Number.POSITIVE_INFINITY);
}

export function scopesForRole(role) {
  if (role === "owner" || role === "admin") return [...INTEGRATION_SCOPES];
  if (role === "planner") {
    return INTEGRATION_SCOPES.filter((scope) => scope !== "members:write");
  }
  if (role === "viewer") return ["workspace:read"];
  return [];
}

export function callerHasScope(caller, scope) {
  return Array.isArray(caller?.scopes) && caller.scopes.includes(scope);
}

/**
 * Returns a denial descriptor, or null when the caller may run the operation.
 * Workspace-tools maps the descriptor onto WorkspaceToolError.
 */
export function describeOperationDenial(caller, toolName) {
  const operationSpec = OPERATION_CATALOG[toolName];
  if (!operationSpec) {
    return { code: "UNKNOWN_WORKSPACE_TOOL", message: "許可されていない操作です。", status: 400 };
  }
  if (caller?.kind === "integration") {
    if (!callerHasScope(caller, operationSpec.requiredScope)) {
      return { code: "FORBIDDEN", message: "この連携資格では許可されていない操作です。", status: 403 };
    }
    return null;
  }
  const role = caller?.role;
  if (!Object.hasOwn(ROLE_RANK, role)) {
    return { code: "FORBIDDEN", message: "組織権限を確認できません。", status: 403 };
  }
  if (roleMeetsMinimum(role, operationSpec.minRole)) return null;
  if (operationSpec.minRole === "admin") {
    return { code: "FORBIDDEN", message: "メンバー変更はオーナーまたは管理者だけが実行できます。", status: 403 };
  }
  return { code: "FORBIDDEN", message: "閲覧者はデータを変更できません。", status: 403 };
}

export function normalizeCaller(value, fallbackRole) {
  if (value && typeof value === "object") {
    if (value.kind === "integration") {
      return {
        kind: "integration",
        scopes: Array.isArray(value.scopes) ? value.scopes.filter((scope) => INTEGRATION_SCOPES.includes(scope)) : [],
        clientId: typeof value.clientId === "string" ? value.clientId : undefined,
      };
    }
    if (value.kind === "user" || value.kind === "ai") {
      return { kind: value.kind, role: value.role ?? fallbackRole };
    }
  }
  return { kind: "ai", role: fallbackRole };
}
