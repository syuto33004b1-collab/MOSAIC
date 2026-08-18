import { MOSAIC_SYSTEM_INSTRUCTION } from "./prompt.mjs";

export const GEMINI_INTERACTIONS_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/interactions";
export const DEFAULT_GEMINI_MODEL = "gemini-3.7-flash";
export const MAX_OUTPUT_TOKENS = 1_024;
export const MAX_TOOL_RESULT_CHARACTERS = 20_000;

const RETRYABLE_STATUSES = new Set([408, 429, 500, 502, 503, 504]);

export class GeminiServiceError extends Error {
  constructor(code, message, options = {}) {
    super(message, options.cause ? { cause: options.cause } : undefined);
    this.name = "GeminiServiceError";
    this.code = code;
    this.retryable = options.retryable ?? false;
    this.status = options.status ?? 502;
  }
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function normalizeModel(value) {
  if (typeof value !== "string") return DEFAULT_GEMINI_MODEL;
  const normalized = value.trim();
  return /^[A-Za-z0-9._-]{1,128}$/.test(normalized) ? normalized : DEFAULT_GEMINI_MODEL;
}

function interactionInput(chat) {
  if (chat.previousInteractionId || chat.history.length === 0) return chat.message;
  return [
    "以下は、このチャット画面に残っている過去の会話です。参考情報として扱ってください。",
    JSON.stringify({ history: chat.history }),
    "現在の質問:",
    chat.message,
  ].join("\n");
}

export function buildInteractionRequest(chat, model = DEFAULT_GEMINI_MODEL, options = {}) {
  if (!chat && options.input === undefined) {
    throw new GeminiServiceError("INVALID_REQUEST", "Gemini interaction input is required.", { status: 500 });
  }
  const generationConfig = { max_output_tokens: MAX_OUTPUT_TOKENS, thinking_level: "low" };
  if (options.toolChoice) generationConfig.tool_choice = options.toolChoice;
  const request = {
    model: normalizeModel(model),
    input: options.input ?? interactionInput(chat),
    system_instruction: MOSAIC_SYSTEM_INSTRUCTION,
    store: true,
    generation_config: generationConfig,
  };
  if (Array.isArray(options.tools) && options.tools.length > 0) request.tools = options.tools;
  const previousInteractionId = options.previousInteractionId ?? chat?.previousInteractionId;
  if (previousInteractionId) request.previous_interaction_id = previousInteractionId;
  return request;
}

function textFromLastModelOutput(steps) {
  if (!Array.isArray(steps)) return "";
  for (let index = steps.length - 1; index >= 0; index -= 1) {
    const step = steps[index];
    if (!isRecord(step) || step.type !== "model_output" || !Array.isArray(step.content)) continue;
    const text = step.content
      .filter((item) => isRecord(item) && item.type === "text" && typeof item.text === "string")
      .map((item) => item.text)
      .join("")
      .trim();
    if (text) return text;
  }
  return "";
}

function hasFunctionCall(steps) {
  return Array.isArray(steps) && steps.some((step) => isRecord(step) && step.type === "function_call");
}

export function extractInteractionResult(value) {
  if (!isRecord(value) || typeof value.id !== "string" || value.id.length === 0) {
    throw new GeminiServiceError("INVALID_RESPONSE", "Gemini response did not include an interaction ID.", { retryable: true });
  }
  const steps = Array.isArray(value.steps) ? value.steps : [];
  const reply = (typeof value.output_text === "string" ? value.output_text.trim() : "") || textFromLastModelOutput(steps);
  if (!reply && !hasFunctionCall(steps)) {
    throw new GeminiServiceError("INVALID_RESPONSE", "Gemini response did not include output.", { retryable: true });
  }
  return { interactionId: value.id, reply, steps };
}

function safeToolResult(value) {
  let serialized;
  try {
    serialized = JSON.stringify(value);
  } catch {
    serialized = "";
  }
  if (!serialized || serialized.length > MAX_TOOL_RESULT_CHARACTERS) {
    return JSON.stringify({ ok: false, code: "TOOL_RESULT_TOO_LARGE", message: "結果が大きすぎるため、条件を絞ってください。" });
  }
  return serialized;
}

export function buildFunctionResultInput(results) {
  if (!Array.isArray(results) || results.length === 0) {
    throw new GeminiServiceError("INVALID_TOOL_RESULT", "At least one function result is required.", { status: 500 });
  }
  return results.map(({ call, result }) => ({
    type: "function_result",
    name: call.name,
    call_id: call.id,
    result: [{ type: "text", text: safeToolResult(result) }],
  }));
}

export function isRetryableGeminiStatus(status) {
  return RETRYABLE_STATUSES.has(status);
}

async function responseBody(response) {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

function upstreamError(response, body) {
  const details = isRecord(body) && isRecord(body.error) ? body.error : undefined;
  const upstreamCode = typeof details?.status === "string" ? details.status : `HTTP_${response.status}`;
  return new GeminiServiceError(upstreamCode, "Gemini request failed.", { retryable: isRetryableGeminiStatus(response.status), status: response.status });
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function fetchInteraction(fetchImpl, apiKey, body, timeoutMs) {
  const controller = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  try {
    return await fetchImpl(GEMINI_INTERACTIONS_ENDPOINT, {
      body: JSON.stringify(body),
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      method: "POST",
      signal: controller.signal,
    });
  } catch (cause) {
    throw new GeminiServiceError(timedOut ? "TIMEOUT" : "NETWORK_ERROR", timedOut ? "Gemini request timed out." : "Gemini request could not be completed.", { cause, retryable: true, status: timedOut ? 504 : 503 });
  } finally {
    clearTimeout(timeout);
  }
}

export async function createGeminiInteraction(options) {
  const {
    apiKey,
    chat,
    fetchImpl = fetch,
    input,
    maxAttempts = 2,
    model = DEFAULT_GEMINI_MODEL,
    previousInteractionId,
    random = Math.random,
    sleep = wait,
    timeoutMs = 20_000,
    toolChoice,
    tools,
  } = options;
  if (typeof apiKey !== "string" || apiKey.trim().length === 0) {
    throw new GeminiServiceError("NOT_CONFIGURED", "GEMINI_API_KEY is not configured.", { status: 503 });
  }

  const request = buildInteractionRequest(chat, model, { input, previousInteractionId, toolChoice, tools });
  const attempts = Math.max(1, Math.min(2, maxAttempts));
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetchInteraction(fetchImpl, apiKey.trim(), request, timeoutMs);
      const body = await responseBody(response);
      if (!response.ok) throw upstreamError(response, body);
      return extractInteractionResult(body);
    } catch (error) {
      const normalized = error instanceof GeminiServiceError ? error : new GeminiServiceError("UNKNOWN", "Gemini request failed.", { cause: error });
      lastError = normalized;
      if (!normalized.retryable || attempt + 1 >= attempts) throw normalized;
      await sleep(250 * (2 ** attempt) + Math.floor(random() * 150));
    }
  }
  throw lastError ?? new GeminiServiceError("UNKNOWN", "Gemini request failed.");
}
