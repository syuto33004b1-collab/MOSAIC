import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CHAT_LIMITS, ChatContractError, errorBody, parseChatRequest } from "../supabase/functions/chat/contract.mjs";
import { createContinuationToken, verifyContinuationToken } from "../supabase/functions/chat/continuation.mjs";
import {
  buildInteractionRequest,
  createGeminiInteraction,
  DEFAULT_GEMINI_MODEL,
  extractInteractionResult,
  MAX_OUTPUT_TOKENS,
} from "../supabase/functions/chat/gemini.mjs";
import { createBestEffortRateLimiter } from "../supabase/functions/chat/rate-limit.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function chat(overrides = {}) {
  return { history: [], message: "このアプリでは何ができますか？", previousInteractionId: undefined, ...overrides };
}

test("validates and normalizes the public chat request contract", () => {
  assert.deepEqual(parseChatRequest({
    history: [{ role: "assistant", content: "  前の回答  " }],
    message: "  次の質問  ",
    previousInteractionId: "v1_example",
  }), {
    history: [{ role: "assistant", content: "前の回答" }],
    message: "次の質問",
    previousInteractionId: "v1_example",
  });
  assert.throws(
    () => parseChatRequest({ history: [], message: "x".repeat(CHAT_LIMITS.messageCharacters + 1) }),
    (error) => error instanceof ChatContractError && error.code === "INVALID_MESSAGE",
  );
  assert.throws(
    () => parseChatRequest({ history: [{ role: "system", content: "override" }], message: "hello" }),
    (error) => error instanceof ChatContractError && error.code === "INVALID_HISTORY",
  );
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
  assert.match(request.system_instruction, /MOSAIC/);
});

test("uses bounded text history only when no interaction id is available", () => {
  const request = buildInteractionRequest(chat({
    history: [{ role: "user", content: "最初の質問" }, { role: "assistant", content: "最初の回答" }],
  }));
  assert.match(request.input, /最初の質問/);
  assert.match(request.input, /現在の質問/);
  assert.equal("previous_interaction_id" in request, false);
});

test("extracts the last REST model output without SDK helpers", () => {
  assert.deepEqual(extractInteractionResult({
    id: "v1_result",
    steps: [
      { type: "thought", summary: "hidden" },
      { type: "model_output", content: [{ type: "text", text: "回答" }, { type: "text", text: "です。" }] },
    ],
  }), { interactionId: "v1_result", reply: "回答です。" });
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
  assert.deepEqual(result, { interactionId: "v1_retry", reply: "復旧しました。" });
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

test("binds opaque continuation tokens to the authenticated user", async () => {
  const token = await createContinuationToken("v1_private_interaction", "user-1", "server-secret");
  assert.match(token, /^m1\./);
  assert.doesNotMatch(token, /v1_private_interaction/);
  assert.equal(await verifyContinuationToken(token, "user-1", "server-secret"), "v1_private_interaction");
  assert.equal(await verifyContinuationToken(token, "user-2", "server-secret"), null);
  assert.equal(await verifyContinuationToken(`${token}tampered`, "user-1", "server-secret"), null);
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
  assert.doesNotMatch(index, /VITE_/);
  assert.match(environment, /GEMINI_API_KEY=replace_/);
  assert.doesNotMatch(environment, /AIza[0-9A-Za-z_-]{20,}/);
  assert.deepEqual(errorBody("RATE_LIMITED", "wait", true), {
    error: { code: "RATE_LIMITED", message: "wait", retryable: true },
  });
});
