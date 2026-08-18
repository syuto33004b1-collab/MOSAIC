import { MOSAIC_SYSTEM_INSTRUCTION } from "./prompt.mjs";

export const GEMINI_INTERACTIONS_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/interactions";
export const DEFAULT_GEMINI_MODEL = "gemini-3.7-flash";
export const MAX_OUTPUT_TOKENS = 1_024;

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

export function buildInteractionRequest(chat, model = DEFAULT_GEMINI_MODEL) {
  const request = {
    model: normalizeModel(model),
    input: interactionInput(chat),
    system_instruction: MOSAIC_SYSTEM_INSTRUCTION,
    store: true,
    generation_config: { max_output_tokens: MAX_OUTPUT_TOKENS, thinking_level: "low" },
  };
  if (chat.previousInteractionId) request.previous_interaction_id = chat.previousInteractionId;
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

export function extractInteractionResult(value) {
  if (!isRecord(value) || typeof value.id !== "string" || value.id.length === 0) {
    throw new GeminiServiceError("INVALID_RESPONSE", "Gemini response did not include an interaction ID.", { retryable: true });
  }
  const reply = (typeof value.output_text === "string" ? value.output_text.trim() : "")
    || textFromLastModelOutput(value.steps);
  if (!reply) {
    throw new GeminiServiceError("INVALID_RESPONSE", "Gemini response did not include text output.", { retryable: true });
  }
  return { interactionId: value.id, reply };
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
  return new GeminiServiceError(upstreamCode, "Gemini request failed.", {
    retryable: isRetryableGeminiStatus(response.status),
    status: response.status,
  });
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
    throw new GeminiServiceError(
      timedOut ? "TIMEOUT" : "NETWORK_ERROR",
      timedOut ? "Gemini request timed out." : "Gemini request could not be completed.",
      { cause, retryable: true, status: timedOut ? 504 : 503 },
    );
  } finally {
    clearTimeout(timeout);
  }
}

export async function createGeminiInteraction(options) {
  const {
    apiKey,
    chat,
    fetchImpl = fetch,
    maxAttempts = 2,
    model = DEFAULT_GEMINI_MODEL,
    random = Math.random,
    sleep = wait,
    timeoutMs = 20_000,
  } = options;

  if (typeof apiKey !== "string" || apiKey.trim().length === 0) {
    throw new GeminiServiceError("NOT_CONFIGURED", "GEMINI_API_KEY is not configured.", { status: 503 });
  }

  const request = buildInteractionRequest(chat, model);
  const attempts = Math.max(1, Math.min(2, maxAttempts));
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetchInteraction(fetchImpl, apiKey.trim(), request, timeoutMs);
      const body = await responseBody(response);
      if (!response.ok) throw upstreamError(response, body);
      return extractInteractionResult(body);
    } catch (error) {
      const normalized = error instanceof GeminiServiceError
        ? error
        : new GeminiServiceError("UNKNOWN", "Gemini request failed.", { cause: error });
      lastError = normalized;
      if (!normalized.retryable || attempt + 1 >= attempts) throw normalized;
      await sleep(250 * (2 ** attempt) + Math.floor(random() * 150));
    }
  }
  throw lastError ?? new GeminiServiceError("UNKNOWN", "Gemini request failed.");
}
