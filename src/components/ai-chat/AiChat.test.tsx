import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type ChatTransport, type ChatResponse } from "../../lib/ai/chatClient";
import { AiChat } from "./AiChat";

const scrollIntoView = vi.fn();

function deferredResponse() {
  let resolve!: (value: ChatResponse) => void;
  const promise = new Promise<ChatResponse>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

describe("AiChat", () => {
  beforeEach(() => {
    scrollIntoView.mockClear();
    Object.defineProperty(Element.prototype, "scrollIntoView", {
      configurable: true,
      value: scrollIntoView,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("opens as a non-modal dialog, focuses the composer, and restores focus on Escape", async () => {
    const user = userEvent.setup();
    const transport = vi.fn<ChatTransport>();
    render(<AiChat transport={transport} />);

    const launcher = screen.getByRole("button", { name: "AIアシスタントを開く" });
    expect(launcher).toHaveAttribute("aria-expanded", "false");

    await user.click(launcher);
    const dialog = screen.getByRole("dialog", { name: "AIに聞く" });
    expect(dialog).toHaveAttribute("aria-modal", "false");
    expect(within(dialog).getByLabelText("AIへのメッセージ")).toHaveFocus();
    expect(launcher).toHaveAttribute("aria-expanded", "true");
    expect(scrollIntoView).toHaveBeenCalled();

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "AIに聞く" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "AIアシスタントを開く" })).toHaveFocus();
  });

  it("sends successful history and the previous interaction id on the next turn", async () => {
    const user = userEvent.setup();
    const transport = vi.fn<ChatTransport>()
      .mockResolvedValueOnce({ reply: "アサイン状況を確認できます。", interactionId: "interaction-1" })
      .mockResolvedValueOnce({ reply: "右上の追加ボタンから操作できます。", interactionId: "interaction-2" })
      .mockResolvedValueOnce({ reply: "新しい会話です。", interactionId: "interaction-3" });
    render(<AiChat transport={transport} />);

    await user.click(screen.getByRole("button", { name: "AIアシスタントを開く" }));
    const composer = screen.getByLabelText("AIへのメッセージ");
    await user.type(composer, "このアプリでは何ができますか？");
    await user.keyboard("{Enter}");

    expect(await screen.findByText("アサイン状況を確認できます。")).toBeInTheDocument();
    expect(transport).toHaveBeenNthCalledWith(1, {
      message: "このアプリでは何ができますか？",
      history: [],
    });

    await user.click(composer);
    await user.type(composer, "アサインはどう追加しますか？");
    await user.keyboard("{Enter}");

    expect(await screen.findByText("右上の追加ボタンから操作できます。")).toBeInTheDocument();
    expect(transport).toHaveBeenNthCalledWith(2, {
      message: "アサインはどう追加しますか？",
      history: [],
      previousInteractionId: "interaction-1",
    });

    await user.click(screen.getByRole("button", { name: "会話をクリア" }));
    expect(screen.getByText("MOSAICについて聞いてみてください")).toBeInTheDocument();
    expect(screen.queryByText("右上の追加ボタンから操作できます。")).not.toBeInTheDocument();

    await user.type(composer, "新しい質問");
    await user.keyboard("{Enter}");
    expect(await screen.findByText("新しい会話です。")).toBeInTheDocument();
    expect(transport).toHaveBeenNthCalledWith(3, {
      message: "新しい質問",
      history: [],
    });
  });

  it("keeps Shift + Enter as a newline and ignores Enter while an IME is composing", async () => {
    const user = userEvent.setup();
    const transport = vi.fn<ChatTransport>().mockResolvedValue({ reply: "回答", interactionId: "interaction-1" });
    render(<AiChat transport={transport} />);

    await user.click(screen.getByRole("button", { name: "AIアシスタントを開く" }));
    const composer = screen.getByLabelText("AIへのメッセージ");
    await user.type(composer, "1行目");
    await user.keyboard("{Shift>}{Enter}{/Shift}");
    await user.type(composer, "2行目");

    expect(composer).toHaveValue("1行目\n2行目");
    expect(transport).not.toHaveBeenCalled();

    fireEvent.keyDown(composer, { key: "Enter", code: "Enter", isComposing: true });
    expect(transport).not.toHaveBeenCalled();

    fireEvent.keyDown(composer, { key: "Enter", code: "Enter" });
    await waitFor(() => expect(transport).toHaveBeenCalledOnce());
  });

  it("announces loading and prevents parallel sends", async () => {
    const user = userEvent.setup();
    const deferred = deferredResponse();
    const transport = vi.fn<ChatTransport>(() => deferred.promise);
    render(<AiChat transport={transport} />);

    await user.click(screen.getByRole("button", { name: "AIアシスタントを開く" }));
    const composer = screen.getByLabelText("AIへのメッセージ");
    await user.type(composer, "現在の稼働状況は？");
    await user.keyboard("{Enter}");

    expect(screen.getByRole("status")).toHaveTextContent("回答を考えています…");
    expect(composer).toBeDisabled();
    expect(screen.getByRole("button", { name: "回答を待っています" })).toBeDisabled();
    expect(transport).toHaveBeenCalledOnce();

    await act(async () => deferred.resolve({ reply: "平均稼働率は画面上部で確認できます。", interactionId: "interaction-1" }));
    expect(await screen.findByText("平均稼働率は画面上部で確認できます。")).toBeInTheDocument();
    expect(composer).toBeEnabled();
  });

  it("shows a safe error and restores the draft without exposing exception details", async () => {
    const user = userEvent.setup();
    const transport = vi.fn<ChatTransport>().mockRejectedValue(new Error("GEMINI_API_KEY=secret-value"));
    render(<AiChat transport={transport} />);

    await user.click(screen.getByRole("button", { name: "AIアシスタントを開く" }));
    const composer = screen.getByLabelText("AIへのメッセージ");
    await user.type(composer, "使い方を教えて");
    await user.keyboard("{Enter}");

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("回答を取得できませんでした");
    expect(alert).not.toHaveTextContent("GEMINI_API_KEY");
    expect(composer).toHaveValue("使い方を教えて");
    expect(document.querySelectorAll(".ai-chat-message.is-user")).toHaveLength(0);
  });

  it("explains unavailable state and suspends cleanly behind another surface", async () => {
    const user = userEvent.setup();
    const { container, rerender } = render(
      <AiChat
        unavailableReason="共有モードへ接続すると利用できます。"
        elevated
      />,
    );

    expect(container.querySelector(".ai-chat-root")).toHaveClass("is-elevated");
    await user.click(screen.getByRole("button", { name: "AIアシスタントの利用状況を確認" }));
    expect(screen.getByText("共有モードへ接続すると利用できます。")).toBeInTheDocument();
    expect(screen.getByLabelText("AIへのメッセージ")).toBeDisabled();

    rerender(
      <AiChat
        unavailableReason="共有モードへ接続すると利用できます。"
        suspended
      />,
    );

    await waitFor(() => expect(screen.queryByRole("dialog", { name: "AIに聞く" })).not.toBeInTheDocument());
    expect(container.querySelector(".ai-chat-root")).toHaveClass("is-suspended");
    expect(container.querySelector(".ai-chat-root")).toHaveAttribute("inert");
  });
});
