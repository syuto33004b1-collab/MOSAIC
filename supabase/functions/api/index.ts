import "@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";
import { ApiContractError, errorBody, jsonResponse } from "./contract.mjs";
import { handleApiRequest } from "./handler.mjs";

type UnknownRecord = Record<string, unknown>;

function adminClient() {
  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!url || !serviceRoleKey) {
    throw new ApiContractError("NOT_CONFIGURED", "APIの準備ができていません。", 503);
  }
  return createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });
}

function unwrapRpcValue(value: unknown) {
  return Array.isArray(value) && value.length === 1 ? value[0] : value;
}

async function serviceRpc(name: string, args?: UnknownRecord) {
  // authorize_integration_request, integration_get_workspace, integration_save_workspace,
  // claim_webhook_outbox, and complete_webhook_outbox are service_role only.
  const { data, error } = await adminClient().rpc(name, args);
  if (error) throw error;
  return unwrapRpcValue(data);
}

export default {
  fetch: async (request: Request) => {
    try {
      return await handleApiRequest(request, {
        rpc: serviceRpc,
        fetchImpl: fetch,
        waitUntil: (task: Promise<unknown>) => {
          const runtime = (globalThis as { EdgeRuntime?: { waitUntil?: (value: Promise<unknown>) => void } }).EdgeRuntime;
          if (runtime?.waitUntil) runtime.waitUntil(task);
        },
        resolveHost: async (hostname: string) => {
          const addresses: string[] = [];
          for (const recordType of ["A", "AAAA"] as const) {
            try {
              addresses.push(...await Deno.resolveDns(hostname, recordType));
            } catch {
              // Missing A or AAAA records are not an error until both fail.
            }
          }
          return addresses;
        },
      });
    } catch (error) {
      if (error instanceof ApiContractError) {
        return jsonResponse(errorBody(error.code, error.message, error.retryable), error.status);
      }
      return jsonResponse(errorBody("INTERNAL_ERROR", "操作を完了できませんでした。しばらくしてからもう一度お試しください。", false), 500);
    }
  },
};
