import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ACTION_TOKEN_DOMAIN, createActionToken, MCP_CONFIRM_DOMAIN, verifyActionToken } from "../supabase/functions/chat/action-token.mjs";
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
import { consumeChatRateLimit, rateLimitedMessage } from "../supabase/functions/chat/chat-rate-limit.mjs";
import { INTEGRATION_LIMITS } from "../supabase/functions/chat/integration-core.mjs";

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

// The chat function counts in the database now (#502); the invite function still uses this.
test("keeps the invite function's per-isolate request window", () => {
  let timestamp = 1_000;
  const limiter = createBestEffortRateLimiter({ limit: 2, now: () => timestamp, windowMs: 10_000 });
  assert.deepEqual(limiter.consume("user-1"), { allowed: true, remaining: 1, retryAfterSeconds: 0 });
  assert.deepEqual(limiter.consume("user-1"), { allowed: true, remaining: 0, retryAfterSeconds: 0 });
  assert.deepEqual(limiter.consume("user-1"), { allowed: false, remaining: 0, retryAfterSeconds: 10 });
  assert.equal(limiter.consume("user-2").allowed, true);
  timestamp += 10_000;
  assert.equal(limiter.consume("user-1").allowed, true);
});

/** A client whose `rpc` answers with `reply` and remembers what it was asked. */
function rateClient(reply) {
  const calls = [];
  return {
    calls,
    rpc: async (name, args) => {
      calls.push([name, args]);
      if (reply instanceof Error) throw reply;
      return reply;
    },
  };
}

test("asks the database for the chat limit, per user and organization (#502)", async () => {
  const client = rateClient({ data: { allowed: true, remaining: 7 }, error: null });
  assert.deepEqual(await consumeChatRateLimit(client, "org-1"), { allowed: true, remaining: 7 });
  assert.deepEqual(client.calls, [["consume_chat_rate_limit", { p_organization_id: "org-1" }]]);

  const refused = await consumeChatRateLimit(rateClient({
    data: { allowed: false, remaining: 0, retryAfterSeconds: 23, retryAt: "2026-09-29T00:05:00+00:00" },
    error: null,
  }), "org-1");
  assert.deepEqual(refused, { allowed: false, retryAfterSeconds: 23, retryAt: "2026-09-29T00:05:00+00:00" });
  for (const seconds of [0, 61, 2.5, "5"]) {
    const { retryAfterSeconds } = await consumeChatRateLimit(rateClient({ data: { allowed: false, retryAfterSeconds: seconds }, error: null }), "org-1");
    assert.equal(retryAfterSeconds, undefined, `Retry-After from ${JSON.stringify(seconds)}`);
  }
});

test("lets a chat request through only on an explicit allowed: true (#502)", async () => {
  const replies = [
    { data: null, error: null },
    { data: {}, error: null },
    { data: { allowed: "true", remaining: 3 }, error: null },
    { data: [], error: null },
    { data: { allowed: true }, error: { code: "PGRST202", message: "Could not find the function public.consume_chat_rate_limit" } },
    { data: null, error: { code: "42883", message: "function public.consume_chat_rate_limit(uuid) does not exist" } },
    { data: null, error: { code: "08006", message: "connection failure" } },
    new Error("fetch failed"),
  ];
  for (const reply of replies) {
    await assert.rejects(consumeChatRateLimit(rateClient(reply), "org-1"), (error) => {
      assert.ok(error instanceof ChatContractError);
      assert.equal(error.code, "RATE_LIMIT_UNAVAILABLE");
      assert.equal(error.status, 503);
      assert.equal(error.retryable, true);
      // The database's own words never reach the browser.
      assert.doesNotMatch(error.message, /consume_chat_rate_limit|function|connection/u);
      return true;
    }, JSON.stringify(reply instanceof Error ? reply.message : reply));
  }
  await assert.rejects(consumeChatRateLimit(rateClient({ data: null, error: { code: "42501" } }), "org-1"),
    (error) => error.code === "FORBIDDEN" && error.status === 403);
  await assert.rejects(consumeChatRateLimit(rateClient({ data: null, error: { code: "PGRST301" } }), "org-1"),
    (error) => error.code === "UNAUTHORIZED" && error.status === 401);
});

test("tells a limited user when to try again, in Japan time (#502)", () => {
  assert.equal(rateLimitedMessage("2026-09-29T15:00:00+00:00"), "短時間に多くの操作が送信されました。00:00（日本時間）以降にもう一度お試しください。");
  assert.equal(rateLimitedMessage("2026-09-29T14:59:00Z"), "短時間に多くの操作が送信されました。23:59（日本時間）以降にもう一度お試しください。");
  assert.equal(rateLimitedMessage("2026-09-29T01:05:00.000Z"), "短時間に多くの操作が送信されました。10:05（日本時間）以降にもう一度お試しください。");
  for (const retryAt of [undefined, "", "not a time", 42]) {
    assert.equal(rateLimitedMessage(retryAt), "短時間に多くの操作が送信されました。少し待ってからお試しください。");
  }
});

test("the chat function counts in the database, with the limit the tests know (#502)", async () => {
  const index = await readFile(path.join(root, "supabase", "functions", "chat", "index.ts"), "utf8");
  assert.doesNotMatch(index, /createBestEffortRateLimiter|rate-limit\.mjs/u, "the per-isolate window is back in the chat function");
  assert.match(index, /await consumeChatRateLimit\(client, parsed\.organizationId\)/u);
  const migration = await readFile(path.join(root, "supabase", "migrations", "20260929120000_chat_rate_windows.sql"), "utf8");
  assert.equal(Number(/v_limit constant integer := (\d+);/u.exec(migration)?.[1]), INTEGRATION_LIMITS.chat.limit);
  assert.match(migration, /check \(request_count between 0 and (\d+)\)/u);
  assert.equal(Number(/check \(request_count between 0 and (\d+)\)/u.exec(migration)?.[1]), INTEGRATION_LIMITS.chat.limit);
  assert.match(migration, /date_trunc\('minute', v_now\)/u);
  assert.equal(INTEGRATION_LIMITS.chat.windowMs, 60_000);
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

test("keeps chat action tokens out of the MCP confirmation domain", async () => {
  const created = await createActionToken({ requestId: "request-2", body: "気づき" }, {
    domain: MCP_CONFIRM_DOMAIN,
    now: 1_000,
    organizationId: "org-1",
    secret: "server-secret",
    ttlMs: 60_000,
    userId: "client-1",
  });
  assert.equal(await verifyActionToken(created.token, {
    domain: ACTION_TOKEN_DOMAIN,
    now: 2_000,
    organizationId: "org-1",
    secret: "server-secret",
    userId: "client-1",
  }), null);
  assert.equal((await verifyActionToken(created.token, {
    domain: MCP_CONFIRM_DOMAIN,
    now: 2_000,
    organizationId: "org-1",
    secret: "server-secret",
    userId: "client-1",
  })).action.body, "気づき");
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
