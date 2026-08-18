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
      kind: "message" as const,
      organizationId: "organization-1",
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
    const promise = transport({ kind: "message", organizationId: "organization-1", message: "質問", history: [] });
    await expect(promise).rejects.toMatchObject({ code: "RATE_LIMITED", retryable: true });
    await expect(promise).rejects.toThrow("少し待ってから、もう一度お試しください。");
  });

  it("rejects malformed success responses instead of rendering unknown data", async () => {
    const client = clientReturning({ data: { reply: "" }, error: null });
    const transport = createSupabaseChatTransport(client);
    await expect(transport({ kind: "message", organizationId: "organization-1", message: "質問", history: [] })).rejects.toMatchObject({ code: "INVALID_CHAT_RESPONSE" });
  });

  it("normalizes a structured action proposal and workspace revision", async () => {
    const proposal = {
      token: "signed-action-token",
      type: "assignment.create",
      title: "アサインを追加",
      summary: "中村 美咲さんをAtlasへ追加します。",
      details: [{ label: "稼働配分", value: "40%" }],
      impacts: ["最大稼働率は90%になります。"],
      confirmLabel: "この内容で保存",
      destructive: false,
      expectedRevision: 12,
      expiresAt: "2099-08-18T12:00:00.000Z",
    };
    const client = clientReturning({
      data: { reply: "変更案を確認してください。", interactionId: "interaction-2", proposal, workspaceRevision: 12 },
      error: null,
    });
    const transport = createSupabaseChatTransport(client);

    await expect(transport({
      kind: "message",
      organizationId: "organization-1",
      message: "アサインを追加して",
      history: [],
    })).resolves.toEqual({
      reply: "変更案を確認してください。",
      interactionId: "interaction-2",
      proposal,
      workspaceRevision: 12,
    });
  });

  it("rejects malformed proposals instead of exposing an unsafe confirmation", async () => {
    const client = clientReturning({
      data: {
        reply: "変更します。",
        interactionId: "interaction-2",
        proposal: {
          token: "signed-action-token",
          type: "assignment.create",
          title: "アサインを追加",
          summary: "変更案",
          details: [{ label: "稼働配分" }],
          impacts: [],
          confirmLabel: "実行",
          destructive: false,
          expectedRevision: 12,
          expiresAt: "not-a-date",
        },
      },
      error: null,
    });
    const transport = createSupabaseChatTransport(client);

    await expect(transport({
      kind: "message",
      organizationId: "organization-1",
      message: "アサインを追加して",
      history: [],
    })).rejects.toMatchObject({ code: "INVALID_CHAT_RESPONSE" });
  });
});
