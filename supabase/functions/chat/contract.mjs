export const CHAT_LIMITS = Object.freeze({
  bodyBytes: 64 * 1024,
  historyCharacters: 12_000,
  historyEntries: 20,
  messageCharacters: 4_000,
  previousInteractionIdCharacters: 512,
});

export class ChatContractError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = "ChatContractError";
    this.code = code;
    this.status = status;
    this.retryable = false;
  }
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredText(value, fieldName, maxLength, code) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new ChatContractError(code, `${fieldName}を入力してください。`);
  }
  const normalized = value.trim();
  if (normalized.length > maxLength) {
    throw new ChatContractError(code, `${fieldName}が長すぎます。`);
  }
  return normalized;
}

export function parseChatRequest(value) {
  if (!isRecord(value)) {
    throw new ChatContractError("INVALID_REQUEST", "リクエストの形式を確認してください。");
  }
  const message = requiredText(value.message, "メッセージ", CHAT_LIMITS.messageCharacters, "INVALID_MESSAGE");

  if (!Array.isArray(value.history)) {
    throw new ChatContractError("INVALID_HISTORY", "会話履歴の形式を確認してください。");
  }
  if (value.history.length > CHAT_LIMITS.historyEntries) {
    throw new ChatContractError("HISTORY_TOO_LONG", "会話履歴が長すぎます。新しい会話を開始してください。");
  }

  let historyCharacters = 0;
  const history = value.history.map((entry) => {
    if (!isRecord(entry) || (entry.role !== "user" && entry.role !== "assistant")) {
      throw new ChatContractError("INVALID_HISTORY", "会話履歴の形式を確認してください。");
    }
    const content = requiredText(entry.content, "会話履歴", CHAT_LIMITS.messageCharacters, "INVALID_HISTORY");
    historyCharacters += content.length;
    return { role: entry.role, content };
  });
  if (historyCharacters > CHAT_LIMITS.historyCharacters) {
    throw new ChatContractError("HISTORY_TOO_LONG", "会話履歴が長すぎます。新しい会話を開始してください。");
  }

  let previousInteractionId;
  if (value.previousInteractionId !== undefined && value.previousInteractionId !== null) {
    if (
      typeof value.previousInteractionId !== "string"
      || value.previousInteractionId.length === 0
      || value.previousInteractionId.length > CHAT_LIMITS.previousInteractionIdCharacters
      || /\s/.test(value.previousInteractionId)
    ) {
      throw new ChatContractError("INVALID_INTERACTION_ID", "会話を継続できませんでした。新しい会話を開始してください。");
    }
    previousInteractionId = value.previousInteractionId;
  }
  return { history, message, previousInteractionId };
}

export function errorBody(code, message, retryable = false) {
  return { error: { code, message, retryable } };
}
