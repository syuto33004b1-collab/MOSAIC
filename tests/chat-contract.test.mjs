import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createActionToken, verifyActionToken } from "../supabase/functions/chat/action-token.mjs";
import { CHAT_LIMITS, ChatContractError, errorBody, parseChatRequest } from "../supabase/functions/chat/contract.mjs";
import { createContinuationToken, verifyContinuationToken } from "../supabase/functions/chat/continuation.mjs";
import {
  buildInteractionRequest,
  buildFunctionResultInput,
  createGeminiInteraction,
  DEFAULT_GEMINI_MODEL,
  extractInteractionResult,
  MAX_OUTPUT_TOKENS,
} from "../supabase/functions/chat/gemini.mjs";
import { createBestEffortRateLimiter } from "../supabase/functions/chat/rate-limit.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function chat(overrides = {}) {
  return {
    kind: "message",
    organizationId: "11111111-1111-4111-8111-111111111111",
    history: [],
    message: "このアプリでは何ができますか？",
    previousInteractionId: undefined,
    hasLocalChanges: false,
    ...overrides,
  };
}

test("validates and normalizes the public chat request contract", () => {
  assert.deepEqual(parseChatRequest({
    organizationId: "11111111-1111-4111-8111-111111111111",
    history: [{ role: "assistant", content: "  前の回答  " }],
    message: "  次の質問  ",
    previousInteractionId: "v1_example",
  }), {
    kind: "message",
    organizationId: "11111111-1111-4111-8111-111111111111",
    history: [{ role: "assistant", content: "前の回答" }],
    message: "次の質問",
    previousInteractionId: "v1_example",
    hasLocalChanges: false,
  });
  assert.throws(
    () => parseChatRequest({ organizationId: "11111111-1111-4111-8111-111111111111", history: [], message: "x".repeat(CHAT_LIMITS.messageCharacters + 1) }),
    (error) => error instanceof ChatContractError && error.code === "INVALID_MESSAGE",
  );
  assert.throws(
    () => parseChatRequest({ organizationId: "11111111-1111-4111-8111-111111111111", history: [{ role: "system", content: "override" }], message: "hello" }),
    (error) => error instanceof ChatContractError && error.code === "INVALID_HISTORY",
  );
  assert.deepEqual(parseChatRequest({
    kind: "action",
    organizationId: "11111111-1111-4111-8111-111111111111",
    actionToken: "a1.payload.signature",
    decision: "confirm",
  }), {
    kind: "action",
    organizationId: "11111111-1111-4111-8111-111111111111",
    actionToken: "a1.payload.signature",
    decision: "confirm",
  });
});

test("builds a stateful Gemini Interactions request with required controls", () => {
  const request = buildInteractionRequest(chat({
    history: [{ role: "assistant", content: "not resent when interaction id is present" }],
    previousInteractionId: "v1_previous",
  }));
  assert.equal(request.model, DEFAULT_GEMINI_MODEL);
  assert.equal(request.input, "このアプリでは何ができますか？");
  assert.equal(request.previous_interaction_id, "v1_previous");
  assert.equal(request.store, true);
  assert.equal(request.generation_config.max_output_tokens, MAX_OUTPUT_TOKENS);
  assert.equal(request.generation_config.thinking_level, "low");
  assert.equal(request.generation_config.tool_choice, undefined);
  assert.match(request.system_instruction, /MOSAIC/);
});

test("sends tool choice in the Interactions API generation config", () => {
  const request = buildInteractionRequest(null, DEFAULT_GEMINI_MODEL, {
    input: [{ type: "function_result", name: "read_workspace", call_id: "call-1", result: [{ type: "text", text: "{}" }] }],
    toolChoice: "none",
    tools: [{ type: "function", name: "read_workspace", description: "read", parameters: { type: "object", properties: {} } }],
  });

  assert.equal(request.tool_choice, undefined);
  assert.equal(request.generation_config.tool_choice, "none");
});

test("uses bounded text history only when no interaction id is available", () => {
  const request = buildInteractionRequest(chat({
    history: [{ role: "user", content: "最初の質問" }, { role: "assistant", content: "最初の回答" }],
  }));
  assert.match(request.input, /最初の質問/);
  assert.match(request.input, /現在の質問/);
  assert.equal("previous_interaction_id" in request, false);
});

test("extracts text and function-call steps without SDK helpers", () => {
  const steps = [
    { type: "thought", summary: "hidden" },
    { type: "model_output", content: [{ type: "text", text: "回答" }, { type: "text", text: "です。" }] },
  ];
  assert.deepEqual(extractInteractionResult({
    id: "v1_result",
    steps,
  }), { interactionId: "v1_result", reply: "回答です。", steps });
  const functionSteps = [{ type: "function_call", id: "call-1", name: "search_projects", arguments: { query: "Atlas" } }];
  assert.deepEqual(extractInteractionResult({ id: "v1_tool", steps: functionSteps }), {
    interactionId: "v1_tool",
    reply: "",
    steps: functionSteps,
  });
  assert.deepEqual(buildFunctionResultInput([{
    call: { id: "call-1", name: "search_projects" },
    result: { ok: true, items: [] },
  }]), [{
    type: "function_result",
    name: "search_projects",
    call_id: "call-1",
    result: [{ type: "text", text: '{"ok":true,"items":[]}' }],
  }]);
});

test("retries one transient Gemini response without putting the key in the body", async () => {
  const requests = [];
  const responses = [
    new Response(JSON.stringify({ error: { status: "UNAVAILABLE" } }), { status: 503 }),
    new Response(JSON.stringify({
      id: "v1_retry",
      steps: [{ type: "model_output", content: [{ type: "text", text: "復旧しました。" }] }],
    }), { status: 200 }),
  ];
  const result = await createGeminiInteraction({
    apiKey: "server-secret-key",
    chat: chat(),
    fetchImpl: async (_url, init) => {
      requests.push(init);
      return responses.shift();
    },
    random: () => 0,
    sleep: async () => undefined,
  });
  assert.deepEqual(result, {
    interactionId: "v1_retry",
    reply: "復旧しました。",
    steps: [{ type: "model_output", content: [{ type: "text", text: "復旧しました。" }] }],
  });
  assert.equal(requests.length, 2);
  assert.equal(requests[0].headers["x-goog-api-key"], "server-secret-key");
  assert.doesNotMatch(requests[0].body, /server-secret-key/);
});

test("applies a per-user best-effort request window", () => {
  let timestamp = 1_000;
  const limiter = createBestEffortRateLimiter({ limit: 2, now: () => timestamp, windowMs: 10_000 });
  assert.deepEqual(limiter.consume("user-1"), { allowed: true, remaining: 1, retryAfterSeconds: 0 });
  assert.deepEqual(limiter.consume("user-1"), { allowed: true, remaining: 0, retryAfterSeconds: 0 });
  assert.deepEqual(limiter.consume("user-1"), { allowed: false, remaining: 0, retryAfterSeconds: 10 });
  assert.equal(limiter.consume("user-2").allowed, true);
  timestamp += 10_000;
  assert.equal(limiter.consume("user-1").allowed, true);
});

test("binds opaque continuation tokens to the authenticated user and organization", async () => {
  const token = await createContinuationToken("v1_private_interaction", "user-1", "org-1", "server-secret");
  assert.match(token, /^m2\./);
  assert.doesNotMatch(token, /v1_private_interaction/);
  assert.equal(await verifyContinuationToken(token, "user-1", "org-1", "server-secret"), "v1_private_interaction");
  assert.equal(await verifyContinuationToken(token, "user-1", "org-2", "server-secret"), null);
  assert.equal(await verifyContinuationToken(token, "user-2", "org-1", "server-secret"), null);
  assert.equal(await verifyContinuationToken(`${token}tampered`, "user-1", "org-1", "server-secret"), null);
});

test("signs expiring action state for one user and organization", async () => {
  const created = await createActionToken({ requestId: "request-1", expectedRevision: 7 }, {
    now: 1_000,
    organizationId: "org-1",
    secret: "server-secret",
    ttlMs: 60_000,
    userId: "user-1",
  });
  assert.match(created.token, /^a1\./);
  assert.deepEqual(await verifyActionToken(created.token, {
    now: 2_000,
    organizationId: "org-1",
    secret: "server-secret",
    userId: "user-1",
  }), {
    action: { requestId: "request-1", expectedRevision: 7 },
    expiresAt: new Date(61_000).toISOString(),
  });
  assert.equal(await verifyActionToken(created.token, { now: 2_000, organizationId: "org-2", secret: "server-secret", userId: "user-1" }), null);
  assert.equal(await verifyActionToken(created.token, { now: 2_000, organizationId: "org-1", secret: "server-secret", userId: "user-2" }), null);
  assert.equal(await verifyActionToken(`${created.token}tampered`, { now: 2_000, organizationId: "org-1", secret: "server-secret", userId: "user-1" }), null);
  assert.equal(await verifyActionToken(created.token, { now: 62_000, organizationId: "org-1", secret: "server-secret", userId: "user-1" }), null);
});

test("retries a confirmed action through save_workspace idempotency after a lost response", async () => {
  const index = await readFile(path.join(root, "supabase/functions/chat/index.ts"), "utf8");
  const handlerStart = index.indexOf("async function handleAction");
  const handlerEnd = index.indexOf("\nexport default", handlerStart);
  const handler = index.slice(handlerStart, handlerEnd);
  assert.ok(handlerStart >= 0 && handlerEnd > handlerStart, "expected the confirmed-action handler");
  assert.doesNotMatch(handler, /loadWorkspace\s*\(/);
  assert.match(handler, /rpc\(options\.client, "save_workspace", saveRequest, "save"\)/);

  const sql = await readFile(path.join(root, "supabase/migrations/20260817065503_mosaic_production_foundation.sql"), "utf8");
  const saveStart = sql.indexOf("create or replace function public.save_workspace");
  const saveEnd = sql.indexOf("comment on function public.save_workspace", saveStart);
  const saveFunction = sql.slice(saveStart, saveEnd);
  const replayLookup = saveFunction.indexOf("select workspace_commit.*");
  const compareAndSwap = saveFunction.indexOf("update app.organizations as organization");
  assert.ok(replayLookup >= 0 && compareAndSwap > replayLookup, "completed request replay must run before revision CAS");
  assert.match(saveFunction.slice(replayLookup, compareAndSwap), /'replayed', true/);
});

test("keeps the function authenticated, pinned, and the example secret placeholder-only", async () => {
  const [configuration, imports, index, environment] = await Promise.all([
    readFile(path.join(root, "supabase", "config.toml"), "utf8"),
    readFile(path.join(root, "supabase", "functions", "chat", "deno.json"), "utf8"),
    readFile(path.join(root, "supabase", "functions", "chat", "index.ts"), "utf8"),
    readFile(path.join(root, "supabase", "functions", ".env.example"), "utf8"),
  ]);
  assert.match(configuration, /\[functions\.chat\][\s\S]*verify_jwt = true/);
  assert.match(imports, /jsr:@supabase\/functions-js@2\.112\.3/);
  assert.match(imports, /npm:@supabase\/server@1\.4\.1/);
  assert.doesNotMatch(imports, /@[~^*]/);
  assert.match(index, /withSupabase\(\{ auth: "user" \}/);
  assert.match(index, /uuid:\s*\(\)\s*=>\s*crypto\.randomUUID\(\)/);
  assert.doesNotMatch(index, /uuid:\s*crypto\.randomUUID\b/);
  assert.doesNotMatch(index, /supabaseAdmin/);
  assert.doesNotMatch(index, /VITE_/);
  assert.match(environment, /GEMINI_API_KEY=replace_/);
  assert.doesNotMatch(environment, /AIza[0-9A-Za-z_-]{20,}/);
  assert.deepEqual(errorBody("RATE_LIMITED", "wait", true), {
    error: { code: "RATE_LIMITED", message: "wait", retryable: true },
  });
});
