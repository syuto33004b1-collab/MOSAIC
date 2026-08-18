export const CHAT_LIMITS = Object.freeze({
  actionTokenCharacters: 48 * 1024,
  bodyBytes: 64 * 1024,
  historyCharacters: 12_000,
  historyEntries: 20,
  messageCharacters: 4_000,
  previousInteractionIdCharacters: 1_024,
});

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

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

function organizationId(value) {
  const normalized = requiredText(value, "組織ID", 64, "INVALID_ORGANIZATION_ID");
  if (!UUID_PATTERN.test(normalized)) {
    throw new ChatContractError("INVALID_ORGANIZATION_ID", "組織を確認できませんでした。もう一度選択してください。");
  }
  return normalized.toLowerCase();
}

function parseHistory(value) {
  if (!Array.isArray(value)) {
    throw new ChatContractError("INVALID_HISTORY", "会話履歴の形式を確認してください。");
  }
  if (value.length > CHAT_LIMITS.historyEntries) {
    throw new ChatContractError("HISTORY_TOO_LONG", "会話履歴が長すぎます。新しい会話を開始してください。");
  }

  let historyCharacters = 0;
  const history = value.map((entry) => {
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
  return history;
}

function parseMessageRequest(value) {
  const message = requiredText(value.message, "メッセージ", CHAT_LIMITS.messageCharacters, "INVALID_MESSAGE");
  const history = parseHistory(value.history);
  let previousInteractionId;
  if (value.previousInteractionId !== undefined && value.previousInteractionId !== null) {
    if (
      typeof value.previousInteractionId !== "string"
      || value.previousInteractionId.length === 0
      || value.previousInteractionId.length > CHAT_LIMITS.previousInteractionIdCharacters
      || /\s/u.test(value.previousInteractionId)
    ) {
      throw new ChatContractError("INVALID_INTERACTION_ID", "会話を継続できませんでした。新しい会話を開始してください。");
    }
    previousInteractionId = value.previousInteractionId;
  }
  if (value.hasLocalChanges !== undefined && typeof value.hasLocalChanges !== "boolean") {
    throw new ChatContractError("INVALID_LOCAL_CHANGES", "未保存の変更状態を確認できませんでした。");
  }
  return {
    kind: "message",
    organizationId: organizationId(value.organizationId),
    history,
    message,
    previousInteractionId,
    hasLocalChanges: value.hasLocalChanges === true,
  };
}

function parseActionRequest(value) {
  if (value.decision !== "confirm" && value.decision !== "cancel") {
    throw new ChatContractError("INVALID_ACTION_DECISION", "確認操作をやり直してください。");
  }
  return {
    kind: "action",
    organizationId: organizationId(value.organizationId),
    actionToken: requiredText(value.actionToken, "確認情報", CHAT_LIMITS.actionTokenCharacters, "INVALID_ACTION_TOKEN"),
    decision: value.decision,
  };
}

export function parseChatRequest(value) {
  if (!isRecord(value)) {
    throw new ChatContractError("INVALID_REQUEST", "リクエストの形式を確認してください。");
  }
  const kind = value.kind ?? "message";
  if (kind === "message") return parseMessageRequest(value);
  if (kind === "action") return parseActionRequest(value);
  throw new ChatContractError("INVALID_REQUEST_KIND", "リクエストの種類を確認してください。");
}

export function errorBody(code, message, retryable = false) {
  return { error: { code, message, retryable } };
}
