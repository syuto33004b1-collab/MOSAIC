import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChatClientError, type ChatTransport, type ChatResponse } from "../../lib/ai/chatClient";
import { AiChat } from "./AiChat";

const scrollIntoView = vi.fn();
const organizationId = "organization-1";

const proposal = {
  token: "signed-action-token",
  type: "assignment.create",
  title: "アサインを追加",
  summary: "中村 美咲さんをAtlas リニューアルへ追加します。",
  details: [
    { label: "期間", value: "8月24日 — 8月28日" },
    { label: "稼働配分", value: "40%" },
  ],
  impacts: ["最大稼働率は90%になります。"],
  confirmLabel: "この内容で保存",
  destructive: false,
  expectedRevision: 12,
  expiresAt: "2099-08-18T12:00:00.000Z",
};

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
    render(<AiChat transport={transport} organizationId={organizationId} organizationRole="owner" />);

    const launcher = screen.getByRole("button", { name: "AIアシスタントを開く" });
    expect(launcher).toHaveAttribute("aria-expanded", "false");

    await user.click(launcher);
    const dialog = screen.getByRole("dialog", { name: "AI秘書" });
    expect(dialog).toHaveAttribute("aria-modal", "false");
    expect(within(dialog).getByLabelText("AIへのメッセージ")).toHaveFocus();
    expect(launcher).toHaveAttribute("aria-expanded", "true");
    expect(scrollIntoView).toHaveBeenCalled();

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "AI秘書" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "AIアシスタントを開く" })).toHaveFocus();
  });

  it("sends successful history and the previous interaction id on the next turn", async () => {
    const user = userEvent.setup();
    const transport = vi.fn<ChatTransport>()
      .mockResolvedValueOnce({ reply: "アサイン状況を確認できます。", interactionId: "interaction-1" })
      .mockResolvedValueOnce({ reply: "右上の追加ボタンから操作できます。", interactionId: "interaction-2" })
      .mockResolvedValueOnce({ reply: "新しい会話です。", interactionId: "interaction-3" });
    render(<AiChat transport={transport} organizationId={organizationId} organizationRole="owner" />);

    await user.click(screen.getByRole("button", { name: "AIアシスタントを開く" }));
    const composer = screen.getByLabelText("AIへのメッセージ");
    await user.type(composer, "このアプリでは何ができますか？");
    await user.keyboard("{Enter}");

    expect(await screen.findByText("アサイン状況を確認できます。")).toBeInTheDocument();
    expect(transport).toHaveBeenNthCalledWith(1, {
      kind: "message",
      organizationId,
      message: "このアプリでは何ができますか？",
      history: [],
      hasLocalChanges: false,
    });

    await user.click(composer);
    await user.type(composer, "アサインはどう追加しますか？");
    await user.keyboard("{Enter}");

    expect(await screen.findByText("右上の追加ボタンから操作できます。")).toBeInTheDocument();
    expect(transport).toHaveBeenNthCalledWith(2, {
      kind: "message",
      organizationId,
      message: "アサインはどう追加しますか？",
      history: [],
      hasLocalChanges: false,
      previousInteractionId: "interaction-1",
    });

    await user.click(screen.getByRole("button", { name: "会話をクリア" }));
    expect(screen.getByText("相談も操作も、ここから")).toBeInTheDocument();
    expect(screen.queryByText("右上の追加ボタンから操作できます。")).not.toBeInTheDocument();

    await user.type(composer, "新しい質問");
    await user.keyboard("{Enter}");
    expect(await screen.findByText("新しい会話です。")).toBeInTheDocument();
    expect(transport).toHaveBeenNthCalledWith(3, {
      kind: "message",
      organizationId,
      message: "新しい質問",
      history: [],
      hasLocalChanges: false,
    });
  });

  it("keeps Shift + Enter as a newline and ignores Enter while an IME is composing", async () => {
    const user = userEvent.setup();
    const transport = vi.fn<ChatTransport>().mockResolvedValue({ reply: "回答", interactionId: "interaction-1" });
    render(<AiChat transport={transport} organizationId={organizationId} organizationRole="owner" />);

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
    render(<AiChat transport={transport} organizationId={organizationId} organizationRole="owner" />);

    await user.click(screen.getByRole("button", { name: "AIアシスタントを開く" }));
    const composer = screen.getByLabelText("AIへのメッセージ");
    await user.type(composer, "現在の稼働状況は？");
    await user.keyboard("{Enter}");

    expect(screen.getByRole("status")).toHaveTextContent("回答を考えています…");
    expect(composer).toBeDisabled();
    expect(screen.getByRole("button", { name: "処理が終わるのを待っています" })).toBeDisabled();
    expect(transport).toHaveBeenCalledOnce();

    await act(async () => deferred.resolve({ reply: "平均稼働率は画面上部で確認できます。", interactionId: "interaction-1" }));
    expect(await screen.findByText("平均稼働率は画面上部で確認できます。")).toBeInTheDocument();
    expect(composer).toBeEnabled();
  });

  it("shows a safe error and restores the draft without exposing exception details", async () => {
    const user = userEvent.setup();
    const transport = vi.fn<ChatTransport>().mockRejectedValue(new Error("GEMINI_API_KEY=secret-value"));
    render(<AiChat transport={transport} organizationId={organizationId} organizationRole="owner" />);

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

  it("shows a decision memo and confirms only through its explicit action button", async () => {
    const user = userEvent.setup();
    const onWorkspaceRevision = vi.fn().mockResolvedValue(undefined);
    const transport = vi.fn<ChatTransport>()
      .mockResolvedValueOnce({ reply: "変更案を確認してください。", interactionId: "interaction-1", proposal })
      .mockResolvedValueOnce({ reply: "アサインを保存しました。", interactionId: "interaction-2", workspaceRevision: 13 });
    render(
      <AiChat
        transport={transport}
        organizationId={organizationId}
        organizationRole="owner"
        onWorkspaceRevision={onWorkspaceRevision}
      />,
    );

    await user.click(screen.getByRole("button", { name: "AIアシスタントを開く" }));
    const composer = screen.getByLabelText("AIへのメッセージ");
    await user.type(composer, "中村さんをAtlasへ40%で追加して");
    await user.keyboard("{Enter}");

    const card = await screen.findByRole("group", { name: "アサインを追加" });
    expect(within(card).getByText("8月24日 — 8月28日")).toBeInTheDocument();
    expect(within(card).getByText("最大稼働率は90%になります。")).toBeInTheDocument();
    expect(within(card).getByText(/確認するとチームへ即時保存されます/)).toHaveTextContent("未保存の手作業は含まれません");
    expect(within(card).getByText("まだ変更されていません")).toBeInTheDocument();

    await user.click(within(card).getByRole("button", { name: "この内容で保存" }));

    expect(transport).toHaveBeenNthCalledWith(2, {
      kind: "action",
      organizationId,
      actionToken: "signed-action-token",
      decision: "confirm",
    });
    const result = await within(card).findByRole("status");
    expect(result).toHaveTextContent("アサインを保存しました。");
    expect(result).toHaveFocus();
    expect(onWorkspaceRevision).toHaveBeenCalledWith(13);
    expect(within(card).queryByRole("button", { name: "この内容で保存" })).not.toBeInTheDocument();
  });

  it("reports action busy state and clears it when the chat unmounts mid-request", async () => {
    const user = userEvent.setup();
    const action = deferredResponse();
    const onActionBusyChange = vi.fn();
    const transport = vi.fn<ChatTransport>()
      .mockResolvedValueOnce({ reply: "変更案です。", interactionId: "interaction-1", proposal })
      .mockImplementationOnce(() => action.promise);
    const { unmount } = render(
      <AiChat
        transport={transport}
        organizationId={organizationId}
        organizationRole="owner"
        onActionBusyChange={onActionBusyChange}
      />,
    );

    await user.click(screen.getByRole("button", { name: "AIアシスタントを開く" }));
    await user.type(screen.getByLabelText("AIへのメッセージ"), "アサインを追加して");
    await user.keyboard("{Enter}");
    const card = await screen.findByRole("group", { name: "アサインを追加" });
    await user.click(within(card).getByRole("button", { name: "この内容で保存" }));

    expect(onActionBusyChange).toHaveBeenLastCalledWith(true);
    unmount();
    expect(onActionBusyChange).toHaveBeenLastCalledWith(false);
  });

  it("does not treat a natural-language yes as confirmation", async () => {
    const user = userEvent.setup();
    const transport = vi.fn<ChatTransport>()
      .mockResolvedValueOnce({ reply: "変更案を確認してください。", interactionId: "interaction-1", proposal })
      .mockResolvedValueOnce({ reply: "確認ボタンから操作してください。", interactionId: "interaction-2" });
    render(<AiChat transport={transport} organizationId={organizationId} organizationRole="owner" />);

    await user.click(screen.getByRole("button", { name: "AIアシスタントを開く" }));
    const composer = screen.getByLabelText("AIへのメッセージ");
    await user.type(composer, "アサインを追加して");
    await user.keyboard("{Enter}");
    const card = await screen.findByRole("group", { name: "アサインを追加" });

    await user.type(composer, "はい");
    await user.keyboard("{Enter}");

    expect(transport).toHaveBeenNthCalledWith(2, {
      kind: "message",
      organizationId,
      message: "はい",
      history: [],
      hasLocalChanges: false,
      previousInteractionId: "interaction-1",
    });
    expect(await screen.findByText("確認ボタンから操作してください。")).toBeInTheDocument();
    expect(within(card).getByRole("button", { name: "この内容で保存" })).toBeEnabled();
    expect(transport).toHaveBeenCalledTimes(2);
  });

  it("supersedes older pending actions when a new proposal is returned", async () => {
    const user = userEvent.setup();
    const newerProposal = {
      ...proposal,
      token: "newer-action-token",
      title: "アサインを50%で追加",
      details: [{ label: "稼働配分", value: "50%" }],
    };
    const transport = vi.fn<ChatTransport>()
      .mockResolvedValueOnce({ reply: "最初の変更案です。", interactionId: "interaction-1", proposal })
      .mockResolvedValueOnce({ reply: "変更内容を更新しました。", interactionId: "interaction-2", proposal: newerProposal });
    render(<AiChat transport={transport} organizationId={organizationId} organizationRole="owner" />);

    await user.click(screen.getByRole("button", { name: "AIアシスタントを開く" }));
    const composer = screen.getByLabelText("AIへのメッセージ");
    await user.type(composer, "40%で追加して");
    await user.keyboard("{Enter}");
    const oldCard = await screen.findByRole("group", { name: "アサインを追加" });

    await user.type(composer, "50%に変更して");
    await user.keyboard("{Enter}");

    expect(await within(oldCard).findByText("新しい変更案が作成されたため、この変更案は確認できません。")).toBeInTheDocument();
    expect(within(oldCard).queryByRole("button", { name: "この内容で保存" })).not.toBeInTheDocument();
    const newCard = await screen.findByRole("group", { name: "アサインを50%で追加" });
    expect(within(newCard).getByRole("button", { name: "この内容で保存" })).toBeEnabled();
  });

  it("discards an unconfirmed proposal when the conversation is cleared", async () => {
    const user = userEvent.setup();
    const transport = vi.fn<ChatTransport>().mockResolvedValue({ reply: "変更案です。", interactionId: "interaction-1", proposal });
    render(<AiChat transport={transport} organizationId={organizationId} organizationRole="owner" />);

    await user.click(screen.getByRole("button", { name: "AIアシスタントを開く" }));
    const composer = screen.getByLabelText("AIへのメッセージ");
    await user.type(composer, "アサインを追加して");
    await user.keyboard("{Enter}");
    expect(await screen.findByRole("group", { name: "アサインを追加" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "会話をクリア" }));
    expect(screen.queryByRole("group", { name: "アサインを追加" })).not.toBeInTheDocument();
    expect(screen.getByText("相談も操作も、ここから")).toBeInTheDocument();
    expect(transport).toHaveBeenCalledOnce();
  });

  it("keeps cancellation available while local changes block confirmation", async () => {
    const user = userEvent.setup();
    const transport = vi.fn<ChatTransport>()
      .mockResolvedValueOnce({ reply: "変更案を確認してください。", interactionId: "interaction-1", proposal })
      .mockResolvedValueOnce({ reply: "変更案を取り下げました。", interactionId: "interaction-2" });
    render(
      <AiChat
        transport={transport}
        organizationId={organizationId}
        organizationRole="owner"
        hasLocalChanges
      />,
    );

    await user.click(screen.getByRole("button", { name: "AIアシスタントを開く" }));
    const composer = screen.getByLabelText("AIへのメッセージ");
    await user.type(composer, "アサインを追加して");
    await user.keyboard("{Enter}");
    const card = await screen.findByRole("group", { name: "アサインを追加" });

    expect(within(card).getByRole("button", { name: "この内容で保存" })).toBeDisabled();
    expect(within(card).getByText(/未保存の変更があります/)).toBeInTheDocument();
    await user.click(within(card).getByRole("button", { name: "やめる" }));
    expect(transport).toHaveBeenNthCalledWith(2, {
      kind: "action",
      organizationId,
      actionToken: "signed-action-token",
      decision: "cancel",
    });
    expect(await within(card).findByRole("status")).toHaveTextContent("変更案を取り下げました。");
  });

  it("blocks viewer, syncing, and planner member changes without sending an action", async () => {
    const user = userEvent.setup();
    const memberProposal = { ...proposal, type: "member.archive", title: "メンバーをアーカイブ", confirmLabel: "メンバーを削除", destructive: true };
    const transport = vi.fn<ChatTransport>().mockResolvedValue({ reply: "変更案です。", interactionId: "interaction-1", proposal: memberProposal });
    const { rerender } = render(<AiChat transport={transport} organizationId={organizationId} organizationRole="viewer" />);

    await user.click(screen.getByRole("button", { name: "AIアシスタントを開く" }));
    const composer = screen.getByLabelText("AIへのメッセージ");
    await user.type(composer, "メンバーを削除して");
    await user.keyboard("{Enter}");
    let card = await screen.findByRole("group", { name: "メンバーをアーカイブ" });
    expect(within(card).getByRole("button", { name: "メンバーをアーカイブ" })).toBeDisabled();
    expect(within(card).queryByRole("button", { name: /削除/ })).not.toBeInTheDocument();
    expect(within(card).getByText(/閲覧権限では変更できません/)).toBeInTheDocument();

    rerender(<AiChat transport={transport} organizationId={organizationId} organizationRole="planner" />);
    card = screen.getByRole("group", { name: "メンバーをアーカイブ" });
    expect(within(card).getByRole("button", { name: "メンバーをアーカイブ" })).toBeDisabled();
    expect(within(card).getByText(/オーナーまたは管理者/)).toBeInTheDocument();

    rerender(<AiChat transport={transport} organizationId={organizationId} organizationRole="owner" syncBusy />);
    card = screen.getByRole("group", { name: "メンバーをアーカイブ" });
    expect(within(card).getByRole("button", { name: "メンバーをアーカイブ" })).toBeDisabled();
    expect(within(card).getByText(/同期しています/)).toBeInTheDocument();
    expect(transport).toHaveBeenCalledOnce();
  });

  it("keeps a failed action safe and retryable without exposing exception details", async () => {
    const user = userEvent.setup();
    const transport = vi.fn<ChatTransport>()
      .mockResolvedValueOnce({ reply: "変更案です。", interactionId: "interaction-1", proposal })
      .mockRejectedValueOnce(new Error("service_role=secret-value"));
    render(<AiChat transport={transport} organizationId={organizationId} organizationRole="owner" />);

    await user.click(screen.getByRole("button", { name: "AIアシスタントを開く" }));
    const composer = screen.getByLabelText("AIへのメッセージ");
    await user.type(composer, "アサインを追加して");
    await user.keyboard("{Enter}");
    const card = await screen.findByRole("group", { name: "アサインを追加" });
    await user.click(within(card).getByRole("button", { name: "この内容で保存" }));

    const alert = await within(card).findByRole("alert");
    expect(alert).toHaveTextContent("変更案を処理できませんでした");
    expect(alert).not.toHaveTextContent("service_role");
    expect(within(card).getByRole("button", { name: "この内容で保存" })).toBeEnabled();
  });

  it("expires a proposal after a workspace conflict instead of offering an endless retry", async () => {
    const user = userEvent.setup();
    const transport = vi.fn<ChatTransport>()
      .mockResolvedValueOnce({ reply: "変更案です。", interactionId: "interaction-1", proposal })
      .mockRejectedValueOnce(new ChatClientError("最新データで変更案を作り直してください。", {
        code: "WORKSPACE_CONFLICT",
        retryable: false,
      }));
    render(<AiChat transport={transport} organizationId={organizationId} organizationRole="owner" />);

    await user.click(screen.getByRole("button", { name: "AIアシスタントを開く" }));
    const composer = screen.getByLabelText("AIへのメッセージ");
    await user.type(composer, "アサインを追加して");
    await user.keyboard("{Enter}");
    const card = await screen.findByRole("group", { name: "アサインを追加" });
    await user.click(within(card).getByRole("button", { name: "この内容で保存" }));

    expect(await within(card).findByRole("status")).toHaveTextContent("最新データで変更案を作り直してください");
    expect(within(card).queryByRole("button", { name: "この内容で保存" })).not.toBeInTheDocument();
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

    await waitFor(() => expect(screen.queryByRole("dialog", { name: "AI秘書" })).not.toBeInTheDocument());
    expect(container.querySelector(".ai-chat-root")).toHaveClass("is-suspended");
    expect(container.querySelector(".ai-chat-root")).toHaveAttribute("inert");
  });
});
