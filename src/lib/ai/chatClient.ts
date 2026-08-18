import type { SupabaseClient } from "@supabase/supabase-js";

export type ChatHistoryItem = {
  role: "user" | "assistant";
  content: string;
};

export type ChatMessageRequest = {
  kind?: "message";
  organizationId: string;
  message: string;
  history: ChatHistoryItem[];
  previousInteractionId?: string;
  hasLocalChanges?: boolean;
};

export type ChatActionRequest = {
  kind: "action";
  organizationId: string;
  actionToken: string;
  decision: "confirm" | "cancel";
};

export type ChatRequest = ChatMessageRequest | ChatActionRequest;

export type ChatActionProposal = {
  token: string;
  type: string;
  title: string;
  summary: string;
  details: Array<{ label: string; value: string }>;
  impacts: string[];
  confirmLabel: string;
  destructive: boolean;
  expectedRevision: number;
  expiresAt: string;
};

export type ChatResponse = {
  reply: string;
  interactionId: string;
  proposal?: ChatActionProposal;
  workspaceRevision?: number;
};

export type ChatTransport = (request: ChatRequest) => Promise<ChatResponse>;

export class ChatClientError extends Error {
  readonly code: string;
  readonly retryable: boolean;

  constructor(message: string, options?: { code?: string; retryable?: boolean; cause?: unknown }) {
    super(message, { cause: options?.cause });
    this.name = "ChatClientError";
    this.code = options?.code ?? "CHAT_UNAVAILABLE";
    this.retryable = options?.retryable ?? true;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readRevision(value: unknown) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

function normalizeProposal(value: unknown): ChatActionProposal {
  if (!isRecord(value)) throw new ChatClientError("AIの変更案を確認できませんでした。もう一度お試しください。", { code: "INVALID_CHAT_RESPONSE" });
  const token = readString(value.token);
  const type = readString(value.type);
  const title = readString(value.title);
  const summary = readString(value.summary);
  const confirmLabel = readString(value.confirmLabel);
  const expectedRevision = readRevision(value.expectedRevision);
  const expiresAt = readString(value.expiresAt);
  const details = Array.isArray(value.details) ? value.details.map((detail) => {
    if (!isRecord(detail)) return undefined;
    const label = readString(detail.label);
    const detailValue = readString(detail.value);
    return label && detailValue ? { label, value: detailValue } : undefined;
  }) : [];
  const impacts = Array.isArray(value.impacts) ? value.impacts.map(readString) : [];
  const validExpiry = expiresAt && Number.isFinite(Date.parse(expiresAt));

  if (
    !token
    || !type
    || !title
    || !summary
    || !confirmLabel
    || expectedRevision === undefined
    || !validExpiry
    || typeof value.destructive !== "boolean"
    || !Array.isArray(value.details)
    || details.some((detail) => !detail)
    || !Array.isArray(value.impacts)
    || impacts.some((impact) => !impact)
  ) {
    throw new ChatClientError("AIの変更案を確認できませんでした。もう一度お試しください。", { code: "INVALID_CHAT_RESPONSE" });
  }

  return {
    token,
    type,
    title,
    summary,
    confirmLabel,
    destructive: value.destructive,
    expectedRevision,
    expiresAt,
    details: details as Array<{ label: string; value: string }>,
    impacts: impacts as string[],
  };
}

function normalizeChatResponse(value: unknown): ChatResponse {
  if (!isRecord(value)) throw new ChatClientError("AIの応答を確認できませんでした。もう一度お試しください。", { code: "INVALID_CHAT_RESPONSE" });
  const reply = readString(value.reply);
  const interactionId = readString(value.interactionId);
  if (!reply || !interactionId) throw new ChatClientError("AIの応答を確認できませんでした。もう一度お試しください。", { code: "INVALID_CHAT_RESPONSE" });
  const workspaceRevision = value.workspaceRevision === undefined ? undefined : readRevision(value.workspaceRevision);
  if (value.workspaceRevision !== undefined && workspaceRevision === undefined) {
    throw new ChatClientError("AIの応答を確認できませんでした。もう一度お試しください。", { code: "INVALID_CHAT_RESPONSE" });
  }
  return {
    reply,
    interactionId,
    ...(value.proposal === undefined || value.proposal === null ? {} : { proposal: normalizeProposal(value.proposal) }),
    ...(workspaceRevision === undefined ? {} : { workspaceRevision }),
  };
}

async function normalizeFunctionError(error: unknown): Promise<ChatClientError> {
  let status: number | undefined;
  let payload: unknown;

  if (isRecord(error) && isRecord(error.context)) {
    status = typeof error.context.status === "number" ? error.context.status : undefined;
    if (typeof error.context.json === "function") {
      try {
        payload = await (error.context.json as () => Promise<unknown>)();
      } catch {
        payload = undefined;
      }
    }
  }

  const bodyError = isRecord(payload) && isRecord(payload.error) ? payload.error : undefined;
  const message = readString(bodyError?.message);
  const code = readString(bodyError?.code);
  const retryable = typeof bodyError?.retryable === "boolean" ? bodyError.retryable : status === 429 || (status !== undefined && status >= 500);

  if (message && code) return new ChatClientError(message, { cause: error, code, retryable });
  if (status === 401) return new ChatClientError("ログイン状態を確認できませんでした。再度ログインしてください。", { cause: error, code: "UNAUTHORIZED", retryable: false });
  if (status === 429) return new ChatClientError("質問が続いています。少し待ってから、もう一度お試しください。", { cause: error, code: "RATE_LIMITED", retryable: true });
  return new ChatClientError("AIアシスタントに接続できませんでした。通信状況を確認して、もう一度お試しください。", { cause: error, retryable: true });
}

export function createSupabaseChatTransport(client: SupabaseClient): ChatTransport {
  return async (request) => {
    const { data, error } = await client.functions.invoke<unknown>("chat", { body: request });
    if (error) throw await normalizeFunctionError(error);
    return normalizeChatResponse(data);
  };
}
