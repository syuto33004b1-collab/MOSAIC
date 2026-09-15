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

export const MCP_FEEDBACK_TOOL = Object.freeze({
  name: "submit_feedback",
  description: "組織へ気づきを送ります。1回目は確認トークンだけを返し、確認前には保存しません。2回目は confirmationToken だけを送って保存します。業務データは変更しません。",
  inputSchema: Object.freeze({
    type: "object",
    properties: Object.freeze({
      body: Object.freeze({
        type: "string",
        minLength: 1,
        maxLength: 2000,
        description: "1回目だけ送る本文。2回目に付けると拒否します。",
      }),
      confirmationToken: Object.freeze({
        type: "string",
        description: "1回目で返ったトークン。2回目はこれだけを送る。",
      }),
    }),
    additionalProperties: false,
  }),
});

export function readOnlyToolDeclarations() {
  return WORKSPACE_TOOL_DECLARATIONS.filter((tool) => tool.name === "read_workspace").map((tool) => ({
    name: tool.name,
    description: tool.description,
    inputSchema: tool.parameters,
  }));
}

export function toolDeclarations() {
  return [
    ...readOnlyToolDeclarations(),
    {
      name: MCP_FEEDBACK_TOOL.name,
      description: MCP_FEEDBACK_TOOL.description,
      inputSchema: MCP_FEEDBACK_TOOL.inputSchema,
    },
  ];
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
