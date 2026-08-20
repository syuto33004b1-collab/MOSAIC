import { OPERATION_CATALOG } from "../chat/integration-core.mjs";
import { WORKSPACE_TOOL_DECLARATIONS } from "../chat/workspace-tools.mjs";

export const MCP_PROTOCOL_VERSION = "2025-11-25";
export const MCP_SERVER_INFO = Object.freeze({ name: "mosaic", version: "1.0.0" });

export const MCP_RESOURCES = Object.freeze([
  Object.freeze({ uri: "mosaic://members", name: "members", mimeType: "application/json", resource: "members" }),
  Object.freeze({ uri: "mosaic://projects", name: "projects", mimeType: "application/json", resource: "projects" }),
  Object.freeze({ uri: "mosaic://assignments", name: "assignments", mimeType: "application/json", resource: "assignments" }),
  Object.freeze({ uri: "mosaic://staffing-needs", name: "staffing-needs", mimeType: "application/json", resource: "staffing_needs" }),
]);

export function readOnlyToolDeclarations() {
  return WORKSPACE_TOOL_DECLARATIONS.filter((tool) => tool.name === "read_workspace").map((tool) => ({
    name: tool.name,
    description: tool.description,
    inputSchema: tool.parameters,
  }));
}

export function isWriteTool(name) {
  return OPERATION_CATALOG[name]?.mode === "write";
}

export function jsonRpcResult(id, result) {
  return { jsonrpc: "2.0", id, result };
}

export function jsonRpcError(id, code, message) {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

export function toolError(id, message) {
  return jsonRpcResult(id, {
    content: [{ type: "text", text: message }],
    isError: true,
  });
}

export function resourceForUri(uri) {
  return MCP_RESOURCES.find((resource) => resource.uri === uri);
}
