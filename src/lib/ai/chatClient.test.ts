import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseChatTransport } from "./chatClient";

function clientReturning(result: { data: unknown; error: unknown }) {
  return {
    functions: {
      invoke: vi.fn().mockResolvedValue(result),
    },
  } as unknown as SupabaseClient;
}

describe("Gemini chat transport", () => {
  it("invokes the authenticated Supabase chat function with the conversation contract", async () => {
    const client = clientReturning({ data: { reply: "アサインボードで確認できます。", interactionId: "interaction-1" }, error: null });
    const transport = createSupabaseChatTransport(client);
    const request = {
      message: "稼働状況はどこで見られますか？",
      history: [{ role: "user" as const, content: "こんにちは" }],
      previousInteractionId: "interaction-0",
    };

    await expect(transport(request)).resolves.toEqual({ reply: "アサインボードで確認できます。", interactionId: "interaction-1" });
    expect(client.functions.invoke).toHaveBeenCalledWith("chat", { body: request });
  });

  it("keeps server error details safe and actionable", async () => {
    const client = clientReturning({
      data: null,
      error: {
        context: {
          status: 429,
          json: vi.fn().mockResolvedValue({ error: { code: "RATE_LIMITED", message: "少し待ってから、もう一度お試しください。", retryable: true } }),
        },
      },
    });

    const transport = createSupabaseChatTransport(client);
    const promise = transport({ message: "質問", history: [] });
    await expect(promise).rejects.toMatchObject({ code: "RATE_LIMITED", retryable: true });
    await expect(promise).rejects.toThrow("少し待ってから、もう一度お試しください。");
  });

  it("rejects malformed success responses instead of rendering unknown data", async () => {
    const client = clientReturning({ data: { reply: "" }, error: null });
    const transport = createSupabaseChatTransport(client);
    await expect(transport({ message: "質問", history: [] })).rejects.toMatchObject({ code: "INVALID_CHAT_RESPONSE" });
  });
});
