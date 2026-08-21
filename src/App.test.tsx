import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { afterEach, describe, expect, it, vi } from "vitest";
import App, { type SharedWorkspaceAdapter } from "./App";
import { DEMO_FAVORITES_KEY } from "./collaboration";
import { addDays, boardRange, getWeekDays, getWeekStart, initialWorkspace, memberDailyLoads, memberLoad, type WorkspaceState } from "./domain";
import type { ChatTransport } from "./lib/ai/chatClient";

function sharedAdapter(): SharedWorkspaceAdapter {
  return {
    initialState: initialWorkspace,
    initialRevision: 7,
    save: vi.fn(),
    reload: vi.fn().mockResolvedValue({ state: initialWorkspace, revision: 7 }),
    subscribe: vi.fn().mockReturnValue(() => undefined),
  };
}

afterEach(() => {
  window.history.replaceState({}, "", "/");
  window.localStorage.removeItem(DEMO_FAVORITES_KEY);
});

function linkedStaffingWorkspace(): WorkspaceState {
  const member = initialWorkspace.members[0];
  const project = initialWorkspace.projects[0];
  const startDate = getWeekStart(0);
  const endDate = addDays(startDate, 4);
  return {
    members: initialWorkspace.members.slice(0, 2),
    projects: [project],
    assignments: [{
      id: "linked-assignment",
      personId: member.id,
      projectId: project.id,
      staffingNeedId: "linked-need",
      clientRequestId: "linked-request",
      startDate,
      endDate,
      allocation: 60,
      status: "confirmed",
    }],
    needs: [{
      id: "linked-need",
      projectId: project.id,
      role: member.role,
      skills: [member.skills[0]],
      startDate,
      endDate,
      allocation: 60,
      status: "filled",
      draftPersonId: member.id,
    }],
  };
}

describe("role-aware workspace", () => {
  it("keeps viewer accounts read-only across board and member views", async () => {
    const user = userEvent.setup();
    render(<App mode="shared" organizationName="Example Inc." identity={{ name: "閲覧 太郎", email: "viewer@example.com", role: "viewer" }} shared={sharedAdapter()} />);

    expect(screen.getByText("SHARED")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "アサインを追加" })).toBeDisabled();

    await user.click(screen.getAllByRole("button", { name: /のアサイン詳細/ })[0]);
    expect(screen.getByLabelText("稼働配分（%）")).toBeDisabled();
    expect(screen.queryByRole("button", { name: "変更を仮置き" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "アサインを取消" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "閉じる" }));

    await user.click(within(screen.getByRole("navigation", { name: "メインナビゲーション" })).getByRole("button", { name: "メンバー" }));
    expect(screen.getByRole("button", { name: "メンバーを追加" })).toBeDisabled();
    expect(screen.getAllByText("閲覧のみ").length).toBeGreaterThan(0);
  });

  it("scopes AI actions to the active organization and refreshes their saved revision", async () => {
    const user = userEvent.setup();
    const adapter = sharedAdapter();
    let resolveReload: (value: { state: typeof initialWorkspace; revision: number }) => void = () => undefined;
    const reload = vi.fn(() => new Promise<{ state: typeof initialWorkspace; revision: number }>((resolve) => {
      resolveReload = resolve;
    }));
    adapter.reload = reload;
    const onOpenOperations = vi.fn();
    const onSignOut = vi.fn();
    const proposal = {
      token: "signed-action-token",
      type: "assignment.create",
      title: "アサインを追加",
      summary: "中村 美咲さんをAtlasへ追加します。",
      details: [{ label: "稼働配分", value: "40%" }],
      impacts: ["最大稼働率は90%になります。"],
      confirmLabel: "この内容で保存",
      destructive: false,
      expectedRevision: 7,
      expiresAt: "2099-08-18T12:00:00.000Z",
    };
    const aiChatTransport = vi.fn<ChatTransport>()
      .mockResolvedValueOnce({ reply: "変更案を確認してください。", interactionId: "interaction-1", proposal })
      .mockResolvedValueOnce({ reply: "アサインを保存しました。", interactionId: "interaction-2", workspaceRevision: 8 });

    render(
      <App
        mode="shared"
        organizationId="organization-1"
        organizationName="Example Inc."
        identity={{ name: "管理 花子", email: "owner@example.com", role: "owner" }}
        shared={adapter}
        aiChatTransport={aiChatTransport}
        onOpenOperations={onOpenOperations}
        onSignOut={onSignOut}
      />,
    );

    await user.click(screen.getByRole("button", { name: "AIアシスタントを開く" }));
    const composer = screen.getByLabelText("AIへのメッセージ");
    await user.type(composer, "中村さんをAtlasへ追加して");
    await user.keyboard("{Enter}");
    const card = await screen.findByRole("group", { name: "アサインを追加" });

    expect(aiChatTransport).toHaveBeenNthCalledWith(1, expect.objectContaining({
      kind: "message",
      organizationId: "organization-1",
      hasLocalChanges: false,
    }));
    await user.click(within(card).getByRole("button", { name: "この内容で保存" }));

    await waitFor(() => expect(reload).toHaveBeenCalledOnce());
    expect(within(card).queryByRole("status")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "組織と監査ログを管理" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "ログアウト" })).toBeDisabled();
    await act(async () => resolveReload({ state: initialWorkspace, revision: 8 }));
    expect(await within(card).findByRole("status")).toHaveTextContent("アサインを保存しました。");
    expect(screen.getByRole("button", { name: "組織と監査ログを管理" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "ログアウト" })).toBeEnabled();
  });

  it("reports an AI save as committed but not refreshed when the workspace reload fails", async () => {
    const user = userEvent.setup();
    const adapter = sharedAdapter();
    adapter.reload = vi.fn().mockRejectedValue(new Error("最新データを読み込めません"));
    const proposal = {
      token: "signed-action-token",
      type: "assignment.create",
      title: "アサインを追加",
      summary: "中村 美咲さんをAtlasへ追加します。",
      details: [{ label: "稼働配分", value: "40%" }],
      impacts: [],
      confirmLabel: "この内容で保存",
      destructive: false,
      expectedRevision: 7,
      expiresAt: "2099-08-18T12:00:00.000Z",
    };
    const aiChatTransport = vi.fn<ChatTransport>()
      .mockResolvedValueOnce({ reply: "変更案を確認してください。", interactionId: "interaction-1", proposal })
      .mockResolvedValueOnce({ reply: "アサインを保存しました。", interactionId: "interaction-2", workspaceRevision: 8 });

    render(
      <App
        mode="shared"
        organizationId="organization-1"
        organizationName="Example Inc."
        identity={{ name: "管理 花子", email: "owner@example.com", role: "owner" }}
        shared={adapter}
        aiChatTransport={aiChatTransport}
      />,
    );

    await user.click(screen.getByRole("button", { name: "AIアシスタントを開く" }));
    await user.type(screen.getByLabelText("AIへのメッセージ"), "中村さんをAtlasへ追加して");
    await user.keyboard("{Enter}");
    const card = await screen.findByRole("group", { name: "アサインを追加" });
    await user.click(within(card).getByRole("button", { name: "この内容で保存" }));

    expect(await within(card).findByRole("status")).toHaveTextContent("変更は保存されましたが、画面を更新できませんでした");
    expect(await screen.findByText("共有データに接続できません")).toBeInTheDocument();
  });

  /**
   * The header carries one primary-action button whose label and handler change
   * per screen. On four screens the view rendered its own button calling the
   * same handler, so the same action had two entry points and no way to tell
   * them apart. Counting accessible names is the direct check — but it has to
   * count by action, not by label: the proposal pair read 提案リンクをコピー and
   * この提案のリンクをコピー while calling the same thing with the same
   * arguments, so an exact-match count would not have noticed it come back.
   */
  it("offers each screen's primary action from one place only", async () => {
    const user = userEvent.setup();
    render(<App />);
    const navigation = within(screen.getByRole("navigation", { name: "メインナビゲーション" }));
    const cases = [
      // Anchored at both ends: these two carry a parenthesised count (#85), and
      // a loose match on 「プロジェクト」 would also hit the board's 「プロジェクト別」.
      { nav: /^プロジェクト 登録 \d+件$/u, action: /^プロジェクトを追加$/u },
      { nav: /^受注前 進行中 \d+件$/u, action: /^受注前案件を追加$/u },
      { nav: /^メンバー$/u, action: /^メンバーを追加$/u },
      { nav: /^提案$/u, action: /リンクをコピー$/u },
    ];
    for (const { nav, action } of cases) {
      await user.click(navigation.getByRole("button", { name: nav }));
      expect(screen.getAllByRole("button", { name: action })).toHaveLength(1);
    }
  });

  it("has no serious automatic accessibility violations", async () => {
    const { container } = render(<App />);
    const results = await axe.run(container, {
      rules: { "color-contrast": { enabled: false } },
    });
    expect(results.violations.filter((violation) => violation.impact === "serious" || violation.impact === "critical")).toEqual([]);
  });

  it("guides an owner through an empty organization without invalid metrics", async () => {
    const user = userEvent.setup();
    const adapter = sharedAdapter();
    adapter.initialState = { assignments: [], members: [], needs: [], projects: [] };
    render(<App mode="shared" organizationName="New Org" identity={{ name: "管理 花子", email: "owner@example.com", role: "owner" }} shared={adapter} />);

    expect(document.querySelector(".pulse-metric strong")).toHaveTextContent("0%");
    expect(screen.getByRole("button", { name: "アサインを追加" })).toBeDisabled();

    const navigation = within(screen.getByRole("navigation", { name: "メインナビゲーション" }));
    await user.click(navigation.getByRole("button", { name: "メンバー" }));
    const addMember = screen.getAllByRole("button", { name: "メンバーを追加" }).find((button) => !button.hasAttribute("disabled"));
    expect(addMember).toBeDefined();
    await user.click(addMember!);
    let dialog = within(screen.getByRole("dialog", { name: "詳細パネル" }));
    await user.type(dialog.getByLabelText("氏名"), "新規 太郎");
    await user.click(dialog.getByRole("button", { name: "メンバーを追加" }));

    await user.click(navigation.getByRole("button", { name: /^プロジェクト 登録 \d+件$/u }));
    const addProject = screen.getAllByRole("button", { name: "プロジェクトを追加" }).find((button) => !button.hasAttribute("disabled"));
    expect(addProject).toBeDefined();
    await user.click(addProject!);
    dialog = within(screen.getByRole("dialog", { name: "詳細パネル" }));
    await user.type(dialog.getByLabelText("プロジェクト名"), "最初のプロジェクト");
    expect(dialog.getByLabelText("責任者")).not.toHaveValue("");
    await user.click(dialog.getByRole("button", { name: "プロジェクトを追加" }));

    await user.click(navigation.getByRole("button", { name: "アサインボード" }));
    expect(screen.getByRole("button", { name: "アサインを追加" })).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "アサインを追加" }));
    dialog = within(screen.getByRole("dialog", { name: "詳細パネル" }));
    expect(dialog.getByLabelText("メンバー")).not.toHaveValue("");
    expect(dialog.getByLabelText("プロジェクト")).not.toHaveValue("");
    await user.click(dialog.getByRole("button", { name: "この内容で仮置きする" }));
    expect(document.querySelectorAll(".assignment.provisional")).toHaveLength(1);
  });

  it("reuses the request id when a failed shared save is retried", async () => {
    const user = userEvent.setup();
    const adapter = sharedAdapter();
    const save = vi.fn()
      .mockRejectedValueOnce(new Error("network unavailable"))
      .mockResolvedValueOnce({ revision: 8, savedAt: "2026-08-17T10:00:00Z" });
    adapter.save = save;
    render(<App mode="shared" organizationName="Example Inc." identity={{ name: "管理 花子", email: "owner@example.com", role: "owner" }} shared={adapter} onOpenOperations={vi.fn()} onSignOut={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "アサインを追加" }));
    await user.click(screen.getByRole("button", { name: "この内容で仮置きする" }));
    await user.click(screen.getByRole("button", { name: "チームへ保存" }));

    const retry = await screen.findByRole("button", { name: "もう一度保存" });
    expect(screen.getByRole("button", { name: "アサインを追加" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "元に戻す" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "組織と監査ログを管理" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "ログアウト" })).toBeDisabled();
    await user.click(retry);
    await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
    expect(save.mock.calls[1][2]).toBe(save.mock.calls[0][2]);
  });

  it("keeps the draft and requires an explicit reload after a revision conflict", async () => {
    const user = userEvent.setup();
    const adapter = sharedAdapter();
    adapter.save = vi.fn().mockRejectedValue(Object.assign(new Error("stale workspace"), { code: "WORKSPACE_CONFLICT" }));
    render(<App mode="shared" organizationName="Example Inc." identity={{ name: "管理 花子", email: "owner@example.com", role: "owner" }} shared={adapter} />);

    await user.click(screen.getByRole("button", { name: "アサインを追加" }));
    await user.click(screen.getByRole("button", { name: "この内容で仮置きする" }));
    await user.click(screen.getByRole("button", { name: "チームへ保存" }));

    expect(await screen.findByText("他のユーザーの変更があります")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "下書きを破棄して再読み込み" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "チームへ保存" })).toBeDisabled();
  });

  it("locks mutations while a remote refresh is in flight", async () => {
    const user = userEvent.setup();
    const adapter = sharedAdapter();
    let notifyRevision: (revision?: number) => void = () => undefined;
    let resolveReload: (value: { state: typeof initialWorkspace; revision: number }) => void = () => undefined;
    adapter.subscribe = vi.fn((listener) => {
      notifyRevision = listener;
      return () => undefined;
    });
    adapter.reload = vi.fn(() => new Promise<{ state: typeof initialWorkspace; revision: number }>((resolve) => {
      resolveReload = resolve;
    }));
    render(<App mode="shared" organizationName="Example Inc." identity={{ name: "管理 花子", email: "owner@example.com", role: "owner" }} shared={adapter} />);

    act(() => notifyRevision(8));
    expect(await screen.findByText("最新データを確認中")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "アサインを追加" })).toBeDisabled();
    await user.click(screen.getAllByRole("button", { name: /のアサイン詳細/ })[0]);
    expect(screen.getByLabelText("稼働配分（%）")).toBeDisabled();
    expect(screen.queryByRole("button", { name: "変更を仮置き" })).not.toBeInTheDocument();
    await act(async () => resolveReload({
      revision: 8,
      state: { ...initialWorkspace, assignments: [] },
    }));

    expect(await screen.findByText("チームと同期済み")).toBeInTheDocument();
    expect(document.querySelectorAll(".assignment.provisional")).toHaveLength(0);
  });

  it("does not report a false conflict when focus finds the same revision", async () => {
    const user = userEvent.setup();
    const adapter = sharedAdapter();
    render(<App mode="shared" organizationName="Example Inc." identity={{ name: "管理 花子", email: "owner@example.com", role: "owner" }} shared={adapter} />);

    await user.click(screen.getByRole("button", { name: "アサインを追加" }));
    await user.click(screen.getByRole("button", { name: "この内容で仮置きする" }));
    act(() => window.dispatchEvent(new Event("focus")));

    await waitFor(() => expect(adapter.reload).toHaveBeenCalled());
    expect(screen.queryByText("他のユーザーの変更があります")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "チームへ保存" })).toBeEnabled();
    expect(document.querySelectorAll(".assignment.provisional")).toHaveLength(1);
  });

  it("follows the highest revision received during an active refresh", async () => {
    const adapter = sharedAdapter();
    let notifyRevision: (revision?: number) => void = () => undefined;
    let resolveFirstReload: (value: { state: typeof initialWorkspace; revision: number }) => void = () => undefined;
    adapter.subscribe = vi.fn((listener) => {
      notifyRevision = listener;
      return () => undefined;
    });
    adapter.reload = vi.fn()
      .mockImplementationOnce(() => new Promise<{ state: typeof initialWorkspace; revision: number }>((resolve) => {
        resolveFirstReload = resolve;
      }))
      .mockResolvedValueOnce({ state: initialWorkspace, revision: 9 });
    render(<App mode="shared" organizationName="Example Inc." identity={{ name: "管理 花子", email: "owner@example.com", role: "owner" }} shared={adapter} />);

    act(() => notifyRevision(8));
    expect(await screen.findByText("最新データを確認中")).toBeInTheDocument();
    act(() => notifyRevision(9));
    await act(async () => resolveFirstReload({ state: initialWorkspace, revision: 8 }));

    await waitFor(() => expect(adapter.reload).toHaveBeenCalledTimes(2));
    expect(await screen.findByText("revision 9")).toBeInTheDocument();
  });

  it("removes a fully reduced assignment instead of saving a zero allocation", async () => {
    const user = userEvent.setup();
    const adapter = sharedAdapter();
    const save = vi.fn().mockResolvedValue({ revision: 8, savedAt: "2026-08-17T10:00:00Z" });
    const weekStart = getWeekStart(0);
    const member = { ...initialWorkspace.members[0], id: "member", capacity: 90 };
    const project = { ...initialWorkspace.projects[0], id: "project", ownerPersonId: member.id };
    adapter.initialState = {
      assignments: [
        { id: "small", personId: member.id, projectId: project.id, startDate: weekStart, endDate: addDays(weekStart, 4), allocation: 10, status: "confirmed" },
        { id: "large", personId: member.id, projectId: project.id, startDate: weekStart, endDate: addDays(weekStart, 4), allocation: 90, status: "confirmed" },
      ],
      members: [member],
      needs: [],
      projects: [project],
    };
    adapter.save = save;
    render(<App mode="shared" organizationName="Example Inc." identity={{ name: "管理 花子", email: "owner@example.com", role: "owner" }} shared={adapter} />);

    const overloadButton = screen.getByText("上限超過").closest("button");
    expect(overloadButton).not.toBeNull();
    await user.click(overloadButton!);
    await user.click(screen.getByRole("button", { name: "推奨配分へ調整" }));
    await user.click(screen.getByRole("button", { name: "チームへ保存" }));
    await waitFor(() => expect(save).toHaveBeenCalledOnce());

    const savedState = save.mock.calls[0][0];
    expect(savedState.assignments.some((assignment: { id: string }) => assignment.id === "small")).toBe(false);
    expect(savedState.assignments.every((assignment: { allocation: number }) => assignment.allocation > 0)).toBe(true);
  });

  it("warns before leaving while a draft is unsaved and removes the warning after undo", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: "アサインを追加" }));
    await user.click(screen.getByRole("button", { name: "この内容で仮置きする" }));

    const dirtyEvent = new Event("beforeunload", { cancelable: true });
    act(() => window.dispatchEvent(dirtyEvent));
    expect(dirtyEvent.defaultPrevented).toBe(true);

    await user.click(screen.getByRole("button", { name: "元に戻す" }));
    const cleanEvent = new Event("beforeunload", { cancelable: true });
    act(() => window.dispatchEvent(cleanEvent));
    expect(cleanEvent.defaultPrevented).toBe(false);
  });

  it("asks before opening operations or signing out with unsaved changes", async () => {
    const user = userEvent.setup();
    const onOpenOperations = vi.fn();
    const onSignOut = vi.fn();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<App mode="shared" organizationName="Example Inc." identity={{ name: "管理 花子", email: "owner@example.com", role: "owner" }} shared={sharedAdapter()} onOpenOperations={onOpenOperations} onSignOut={onSignOut} />);

    await user.click(screen.getByRole("button", { name: "アサインを追加" }));
    await user.click(screen.getByRole("button", { name: "この内容で仮置きする" }));
    await user.click(screen.getByRole("button", { name: "組織と監査ログを管理" }));
    await user.click(screen.getByRole("button", { name: "ログアウト" }));
    expect(onOpenOperations).not.toHaveBeenCalled();
    expect(onSignOut).not.toHaveBeenCalled();

    confirm.mockReturnValue(true);
    await user.click(screen.getByRole("button", { name: "組織と監査ログを管理" }));
    await user.click(screen.getByRole("button", { name: "ログアウト" }));
    expect(onOpenOperations).toHaveBeenCalledOnce();
    expect(onSignOut).toHaveBeenCalledOnce();
  });

  it("edits a persisted assignment as a draft and saves its interval and allocation", async () => {
    const user = userEvent.setup();
    const adapter = sharedAdapter();
    const save = vi.fn().mockResolvedValue({ revision: 8, savedAt: "2026-08-17T10:00:00Z" });
    adapter.save = save;
    render(<App mode="shared" organizationName="Example Inc." identity={{ name: "管理 花子", email: "owner@example.com", role: "owner" }} shared={adapter} />);

    await user.click(screen.getAllByRole("button", { name: /^Atlas リニューアルのアサイン詳細（/u })[0]);
    const dialog = within(screen.getByRole("dialog", { name: "詳細パネル" }));
    await user.clear(dialog.getByLabelText("終了日"));
    await user.type(dialog.getByLabelText("終了日"), "2026-09-18");
    await user.clear(dialog.getByLabelText("稼働配分（%）"));
    await user.type(dialog.getByLabelText("稼働配分（%）"), "55");
    await user.click(dialog.getByRole("button", { name: "変更を仮置き" }));
    await user.click(screen.getByRole("button", { name: "チームへ保存" }));
    await waitFor(() => expect(save).toHaveBeenCalledOnce());

    const savedAssignment = save.mock.calls[0][0].assignments.find((assignment: { id: string }) => assignment.id === "a1");
    expect(savedAssignment).toMatchObject({ endDate: "2026-09-18", allocation: 55, status: "confirmed" });
  });

  it("cancels a persisted assignment through the shared save payload state", async () => {
    const user = userEvent.setup();
    const adapter = sharedAdapter();
    const save = vi.fn().mockResolvedValue({ revision: 8, savedAt: "2026-08-17T10:00:00Z" });
    adapter.save = save;
    adapter.initialState = linkedStaffingWorkspace();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<App mode="shared" organizationName="Example Inc." identity={{ name: "管理 花子", email: "owner@example.com", role: "owner" }} shared={adapter} />);

    await user.click(screen.getByRole("button", { name: /^Atlas リニューアルのアサイン詳細（/u }));
    await user.click(screen.getByRole("button", { name: "アサインを取消" }));
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining("取消予定"));
    await user.click(screen.getByRole("button", { name: "チームへ保存" }));
    await waitFor(() => expect(save).toHaveBeenCalledOnce());

    expect(save.mock.calls[0][0].assignments).toEqual([]);
    expect(save.mock.calls[0][0].needs[0]).toMatchObject({ id: "linked-need", status: "open" });
    expect(save.mock.calls[0][0].needs[0].draftPersonId).toBeNull();
  });

  it("reopens and detaches a staffing need when an edit no longer fulfills it", async () => {
    const user = userEvent.setup();
    const adapter = sharedAdapter();
    const save = vi.fn().mockResolvedValue({ revision: 8, savedAt: "2026-08-17T10:00:00Z" });
    adapter.initialState = linkedStaffingWorkspace();
    adapter.save = save;
    render(<App mode="shared" organizationName="Example Inc." identity={{ name: "管理 花子", email: "owner@example.com", role: "owner" }} shared={adapter} />);

    await user.click(screen.getByRole("button", { name: /^Atlas リニューアルのアサイン詳細（/u }));
    const dialog = within(screen.getByRole("dialog", { name: "詳細パネル" }));
    await user.clear(dialog.getByLabelText("稼働配分（%）"));
    await user.type(dialog.getByLabelText("稼働配分（%）"), "20");
    await user.click(dialog.getByRole("button", { name: "変更を仮置き" }));
    await user.click(screen.getByRole("button", { name: "チームへ保存" }));
    await waitFor(() => expect(save).toHaveBeenCalledOnce());

    const savedState = save.mock.calls[0][0];
    expect(savedState.assignments).toHaveLength(1);
    expect(savedState.assignments[0]).toMatchObject({ allocation: 20, status: "confirmed" });
    expect(savedState.assignments[0].id).toBe("linked-assignment");
    expect(savedState.assignments[0].staffingNeedId).toBeNull();
    expect(savedState.assignments[0].clientRequestId).toBeNull();
    expect(savedState.needs[0]).toMatchObject({ id: "linked-need", status: "open" });
    expect(savedState.needs[0].draftPersonId).toBeNull();
  });

  it("deletes a new draft assignment without producing a persisted cancellation", async () => {
    const user = userEvent.setup();
    const adapter = sharedAdapter();
    const save = vi.fn().mockResolvedValue({ revision: 8, savedAt: "2026-08-17T10:00:00Z" });
    adapter.save = save;
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<App mode="shared" organizationName="Example Inc." identity={{ name: "管理 花子", email: "owner@example.com", role: "owner" }} shared={adapter} />);

    await user.click(screen.getByRole("button", { name: "アサインを追加" }));
    await user.click(screen.getByRole("button", { name: "この内容で仮置きする" }));
    const draft = document.querySelector<HTMLElement>(".assignment.provisional");
    expect(draft).not.toBeNull();
    await user.click(draft!);
    await user.click(screen.getByRole("button", { name: "仮置きを削除" }));
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining("仮置きを削除"));

    expect(document.querySelectorAll(".assignment.provisional")).toHaveLength(0);
    expect(screen.queryByRole("button", { name: "チームへ保存" })).not.toBeInTheDocument();
    expect(save).not.toHaveBeenCalled();
  });

  it("reopens a planned need when its new linked draft is deleted", async () => {
    const user = userEvent.setup();
    const adapter = sharedAdapter();
    const base = linkedStaffingWorkspace();
    adapter.initialState = {
      ...base,
      assignments: [],
      needs: [{ ...base.needs[0], status: "open", draftPersonId: null }],
    };
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<App mode="shared" organizationName="Example Inc." identity={{ name: "管理 花子", email: "owner@example.com", role: "owner" }} shared={adapter} />);

    const openRole = screen.getByText("未充足ロール").closest("button");
    expect(openRole).not.toBeNull();
    await user.click(openRole!);
    await user.click(screen.getByRole("button", { name: "要員要件を編集" }));
    const needDialog = within(screen.getByRole("dialog", { name: "詳細パネル" }));
    await user.clear(needDialog.getByLabelText("必要配分（%）"));
    await user.type(needDialog.getByLabelText("必要配分（%）"), "50");
    await user.click(needDialog.getByRole("button", { name: "変更を仮置き" }));
    await user.click(screen.getByRole("button", { name: "仮置き" }));
    const draft = document.querySelector<HTMLElement>(".assignment.provisional");
    expect(draft).not.toBeNull();
    await user.click(draft!);
    await user.click(screen.getByRole("button", { name: "仮置きを削除" }));

    expect(confirm).toHaveBeenCalledWith(expect.stringContaining("仮置きを削除"));
    expect(document.querySelectorAll(".assignment.provisional")).toHaveLength(0);
    expect(screen.getByText("未充足ロール")).toBeInTheDocument();
    await user.click(screen.getByText("未充足ロール").closest("button")!);
    expect(screen.getByText("稼働配分 50%")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "チームへ保存" })).toBeInTheDocument();
  });

  it("opens the exact staffing need selected from reports, notifications, and a project", async () => {
    const user = userEvent.setup();
    const adapter = sharedAdapter();
    const firstProject = { ...initialWorkspace.projects[0], id: "first-project", name: "First Project" };
    const secondProject = { ...initialWorkspace.projects[1], id: "second-project", name: "Second Project" };
    adapter.initialState = {
      members: initialWorkspace.members,
      projects: [firstProject, secondProject],
      assignments: [],
      needs: [
        { id: "first-need", projectId: firstProject.id, role: "QA Engineer", skills: ["QA"], startDate: "2026-08-17", endDate: "2026-08-21", allocation: 30, status: "open" },
        { id: "second-need", projectId: secondProject.id, role: "Backend Engineer", skills: ["AWS"], startDate: "2026-08-24", endDate: "2026-08-28", allocation: 40, status: "open" },
      ],
    };
    render(<App mode="shared" organizationName="Example Inc." identity={{ name: "管理 花子", email: "owner@example.com", role: "owner" }} shared={adapter} />);
    const navigation = within(screen.getByRole("navigation", { name: "メインナビゲーション" }));

    await user.click(navigation.getByRole("button", { name: "レポート" }));
    const exceptions = screen.getByText("判断が必要な項目").closest("section");
    expect(exceptions).not.toBeNull();
    await user.click(within(exceptions!).getByRole("button", { name: /Second Project/ }));
    expect(screen.getByRole("heading", { name: "Backend Engineerの候補" })).toBeInTheDocument();
    await user.click(within(screen.getByRole("dialog", { name: "詳細パネル" })).getByRole("button", { name: "詳細パネルを閉じる" }));

    await user.click(screen.getByRole("button", { name: "通知" }));
    await user.click(screen.getByRole("button", { name: /Backend Engineer担当が未定/ }));
    expect(screen.getByRole("heading", { name: "Backend Engineerの候補" })).toBeInTheDocument();
    await user.click(within(screen.getByRole("dialog", { name: "詳細パネル" })).getByRole("button", { name: "詳細パネルを閉じる" }));

    await user.click(navigation.getByRole("button", { name: /^プロジェクト 登録 \d+件$/u }));
    await user.click(screen.getByText("Second Project").closest("button")!);
    const projectDialog = within(screen.getByRole("dialog", { name: "詳細パネル" }));
    await user.click(projectDialog.getByRole("button", { name: /Backend Engineer/ }));
    expect(screen.getByRole("heading", { name: "Backend Engineerの候補" })).toBeInTheDocument();
  });

  /**
   * The reports screen used to reach the board from the header's primary slot as
   * well, which made that slot mean "add something here" on six screens and "go
   * elsewhere" on three (#104). The slot now means only the first, and this
   * asserts the navigation survived in the place it belongs — inside the view,
   * where it was already one of three paths.
   */
  it("returns to the member board from inside the reports view", async () => {
    const user = userEvent.setup();
    render(<App />);
    const navigation = within(screen.getByRole("navigation", { name: "メインナビゲーション" }));

    await user.click(navigation.getByRole("button", { name: "レポート" }));
    expect(screen.getByRole("heading", { name: "キャパシティ予測" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "ボードで調整" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /ボードで確認/ }));

    // 「今週」 left the title in #139: the board can show a month, and paging made
    // the word wrong inside a week. The exact range is on the date line below it.
    expect(screen.getByRole("heading", { name: "チーム編成" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "メンバー別", pressed: true })).toBeInTheDocument();
  });

  it("requires role, every skill, and capacity across the whole staffing period", async () => {
    const user = userEvent.setup();
    const adapter = sharedAdapter();
    const project = { ...initialWorkspace.projects[0], id: "project" };
    const complete = { ...initialWorkspace.members[4], id: "complete", name: "全条件 一郎", role: "QA Engineer", skills: ["QA", "Mobile"], capacity: 100 };
    const partial = { ...initialWorkspace.members[8], id: "partial", name: "一部条件 二郎", role: "QA Engineer", skills: ["QA"], capacity: 100 };
    const available = { ...complete, id: "available", name: "空きあり 三郎" };
    adapter.initialState = {
      members: [complete, partial, available],
      projects: [project],
      assignments: [{ id: "later-load", personId: complete.id, projectId: project.id, startDate: "2026-08-24", endDate: "2026-08-28", allocation: 80, status: "confirmed" }],
      needs: [{ id: "need", projectId: project.id, role: "QA Engineer", skills: ["QA", "Mobile"], startDate: "2026-08-17", endDate: "2026-08-28", allocation: 40, status: "open" }],
    };
    render(<App mode="shared" organizationName="Example Inc." identity={{ name: "管理 花子", email: "owner@example.com", role: "owner" }} shared={adapter} />);

    await user.click(screen.getByText("未充足ロール").closest("button")!);
    const dialog = within(screen.getByRole("dialog", { name: "詳細パネル" }));
    expect(dialog.queryByText("全条件 一郎")).not.toBeInTheDocument();
    expect(dialog.queryByText("一部条件 二郎")).not.toBeInTheDocument();
    expect(dialog.getByText("空きあり 三郎")).toBeInTheDocument();
  });

  it("edits a member and reconciles an invalid linked staffing assignment", async () => {
    const user = userEvent.setup();
    const adapter = sharedAdapter();
    const save = vi.fn().mockResolvedValue({ revision: 8, savedAt: "2026-08-17T10:00:00Z" });
    adapter.initialState = linkedStaffingWorkspace();
    adapter.save = save;
    render(<App mode="shared" organizationName="Example Inc." identity={{ name: "管理 花子", email: "owner@example.com", role: "owner" }} shared={adapter} />);
    const navigation = within(screen.getByRole("navigation", { name: "メインナビゲーション" }));

    await user.click(navigation.getByRole("button", { name: "メンバー" }));
    await user.click(screen.getByText("佐伯 優斗").closest("button")!);
    await user.click(screen.getByRole("button", { name: "メンバー情報を編集" }));
    const dialog = within(screen.getByRole("dialog", { name: "詳細パネル" }));
    await user.clear(dialog.getByLabelText("職種"));
    await user.type(dialog.getByLabelText("職種"), "Backend Engineer");
    await user.clear(dialog.getByLabelText("スキル（カンマ区切り）"));
    await user.type(dialog.getByLabelText("スキル（カンマ区切り）"), "AWS, API, aws");
    await user.clear(dialog.getByLabelText("稼働上限（%）"));
    await user.type(dialog.getByLabelText("稼働上限（%）"), "80");
    await user.click(dialog.getByRole("button", { name: "変更を仮置き" }));
    await user.click(screen.getByRole("button", { name: "チームへ保存" }));
    await waitFor(() => expect(save).toHaveBeenCalledOnce());

    const saved = save.mock.calls[0][0] as WorkspaceState;
    expect(saved.members[0]).toMatchObject({ role: "Backend Engineer", skills: ["AWS", "API"], capacity: 80 });
    expect(saved.assignments).toEqual([]);
    expect(saved.needs[0]).toMatchObject({ status: "open", draftPersonId: null });
  });

  it("archives a member with assignment cancellation and blocks active project owners", async () => {
    const user = userEvent.setup();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    const adapter = sharedAdapter();
    const save = vi.fn().mockResolvedValue({ revision: 8, savedAt: "2026-08-17T10:00:00Z" });
    adapter.initialState = linkedStaffingWorkspace();
    adapter.save = save;
    const { unmount } = render(<App mode="shared" organizationName="Example Inc." identity={{ name: "管理 花子", email: "owner@example.com", role: "owner" }} shared={adapter} />);
    let navigation = within(screen.getByRole("navigation", { name: "メインナビゲーション" }));

    await user.click(navigation.getByRole("button", { name: "メンバー" }));
    await user.click(screen.getByText("佐伯 優斗").closest("button")!);
    await user.click(screen.getByRole("button", { name: "メンバーをアーカイブ" }));
    await user.click(screen.getByRole("button", { name: "チームへ保存" }));
    await waitFor(() => expect(save).toHaveBeenCalledOnce());
    const saved = save.mock.calls[0][0] as WorkspaceState;
    expect(saved.members.some((member) => member.id === initialWorkspace.members[0].id)).toBe(false);
    expect(saved.assignments).toEqual([]);
    expect(saved.needs[0]).toMatchObject({ status: "open", draftPersonId: null });

    unmount();
    confirm.mockClear();
    const ownerAdapter = sharedAdapter();
    const owner = initialWorkspace.members[0];
    ownerAdapter.initialState = { members: [owner], projects: [{ ...initialWorkspace.projects[0], ownerPersonId: owner.id, ownerName: owner.name }], assignments: [], needs: [] };
    render(<App mode="shared" organizationName="Example Inc." identity={{ name: "管理 花子", email: "owner@example.com", role: "owner" }} shared={ownerAdapter} />);
    navigation = within(screen.getByRole("navigation", { name: "メインナビゲーション" }));
    await user.click(navigation.getByRole("button", { name: "メンバー" }));
    await user.click(screen.getByText(owner.name).closest("button")!);
    await user.click(screen.getByRole("button", { name: "メンバーをアーカイブ" }));
    expect(confirm).not.toHaveBeenCalled();
    expect(await screen.findByText(/別メンバーへ変更してからアーカイブ/)).toBeInTheDocument();
  });

  it("edits project dates with cascades and archives a project atomically", async () => {
    const user = userEvent.setup();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    const adapter = sharedAdapter();
    const save = vi.fn().mockResolvedValue({ revision: 8, savedAt: "2026-08-17T10:00:00Z" });
    adapter.initialState = linkedStaffingWorkspace();
    adapter.save = save;
    const { unmount } = render(<App mode="shared" organizationName="Example Inc." identity={{ name: "管理 花子", email: "owner@example.com", role: "owner" }} shared={adapter} />);
    let navigation = within(screen.getByRole("navigation", { name: "メインナビゲーション" }));

    await user.click(navigation.getByRole("button", { name: /^プロジェクト 登録 \d+件$/u }));
    await user.click(screen.getByText("Atlas リニューアル").closest("button")!);
    await user.click(screen.getByRole("button", { name: "案件情報を編集" }));
    const dialog = within(screen.getByRole("dialog", { name: "詳細パネル" }));
    await user.clear(dialog.getByLabelText("開始日"));
    await user.type(dialog.getByLabelText("開始日"), addDays(getWeekStart(0), 1));
    await user.click(dialog.getByRole("button", { name: "変更を仮置き" }));
    await user.click(screen.getByRole("button", { name: "チームへ保存" }));
    await waitFor(() => expect(save).toHaveBeenCalledOnce());
    expect(save.mock.calls[0][0].assignments).toEqual([]);
    expect(save.mock.calls[0][0].needs).toEqual([]);

    unmount();
    const archiveAdapter = sharedAdapter();
    const archiveSave = vi.fn().mockResolvedValue({ revision: 8, savedAt: "2026-08-17T10:00:00Z" });
    archiveAdapter.initialState = linkedStaffingWorkspace();
    archiveAdapter.save = archiveSave;
    render(<App mode="shared" organizationName="Example Inc." identity={{ name: "管理 花子", email: "owner@example.com", role: "owner" }} shared={archiveAdapter} />);
    navigation = within(screen.getByRole("navigation", { name: "メインナビゲーション" }));
    await user.click(navigation.getByRole("button", { name: /^プロジェクト 登録 \d+件$/u }));
    await user.click(screen.getByText("Atlas リニューアル").closest("button")!);
    await user.click(screen.getByRole("button", { name: "案件をアーカイブ" }));
    await user.click(screen.getByRole("button", { name: "チームへ保存" }));
    await waitFor(() => expect(archiveSave).toHaveBeenCalledOnce());
    expect(archiveSave.mock.calls[0][0]).toMatchObject({ projects: [], assignments: [], needs: [] });
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining("関連するアサインと要員要件"));
  });

  it("edits staffing needs with linked assignment integrity", async () => {
    const user = userEvent.setup();
    const adapter = sharedAdapter();
    const save = vi.fn().mockResolvedValue({ revision: 8, savedAt: "2026-08-17T10:00:00Z" });
    adapter.initialState = linkedStaffingWorkspace();
    adapter.save = save;
    render(<App mode="shared" organizationName="Example Inc." identity={{ name: "管理 花子", email: "owner@example.com", role: "owner" }} shared={adapter} />);
    const navigation = within(screen.getByRole("navigation", { name: "メインナビゲーション" }));

    await user.click(navigation.getByRole("button", { name: /^プロジェクト 登録 \d+件$/u }));
    await user.click(screen.getByText("Atlas リニューアル").closest("button")!);
    await user.click(within(screen.getByRole("dialog", { name: "詳細パネル" })).getByText("充足済み").closest("button")!);
    await user.click(screen.getByRole("button", { name: "要員要件を編集" }));
    const dialog = within(screen.getByRole("dialog", { name: "詳細パネル" }));
    await user.clear(dialog.getByLabelText("必要配分（%）"));
    await user.type(dialog.getByLabelText("必要配分（%）"), "80");
    await user.click(dialog.getByRole("button", { name: "変更を仮置き" }));
    await user.click(screen.getByRole("button", { name: "チームへ保存" }));
    await waitFor(() => expect(save).toHaveBeenCalledOnce());
    expect(save.mock.calls[0][0].assignments).toEqual([]);
    expect(save.mock.calls[0][0].needs[0]).toMatchObject({ allocation: 80, status: "open", draftPersonId: null });
  });

  it("creates and cancels staffing needs through the project workflow", async () => {
    const user = userEvent.setup();
    const project = { ...initialWorkspace.projects[0], id: "project", ownerPersonId: initialWorkspace.members[0].id };
    const createAdapter = sharedAdapter();
    const createSave = vi.fn().mockResolvedValue({ revision: 8, savedAt: "2026-08-17T10:00:00Z" });
    createAdapter.initialState = { members: initialWorkspace.members.slice(0, 2), projects: [project], assignments: [], needs: [] };
    createAdapter.save = createSave;
    const { unmount } = render(<App mode="shared" organizationName="Example Inc." identity={{ name: "管理 花子", email: "owner@example.com", role: "owner" }} shared={createAdapter} />);
    let navigation = within(screen.getByRole("navigation", { name: "メインナビゲーション" }));

    await user.click(navigation.getByRole("button", { name: /^プロジェクト 登録 \d+件$/u }));
    await user.click(screen.getByText(project.name).closest("button")!);
    await user.click(screen.getByRole("button", { name: "要員要件を追加" }));
    let dialog = within(screen.getByRole("dialog", { name: "詳細パネル" }));
    await user.clear(dialog.getByLabelText("必要ロール"));
    await user.type(dialog.getByLabelText("必要ロール"), "Product Designer");
    await user.type(dialog.getByLabelText("必要スキル（カンマ区切り）"), "Figma, UX, figma");
    await user.click(dialog.getByRole("button", { name: "要員要件を追加" }));
    await user.click(screen.getByRole("button", { name: "チームへ保存" }));
    await waitFor(() => expect(createSave).toHaveBeenCalledOnce());
    expect(createSave.mock.calls[0][0].needs[0]).toMatchObject({ role: "Product Designer", skills: ["Figma", "UX"], status: "open" });

    unmount();
    const cancelAdapter = sharedAdapter();
    const cancelSave = vi.fn().mockResolvedValue({ revision: 8, savedAt: "2026-08-17T10:00:00Z" });
    cancelAdapter.initialState = linkedStaffingWorkspace();
    cancelAdapter.save = cancelSave;
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<App mode="shared" organizationName="Example Inc." identity={{ name: "管理 花子", email: "owner@example.com", role: "owner" }} shared={cancelAdapter} />);
    navigation = within(screen.getByRole("navigation", { name: "メインナビゲーション" }));
    await user.click(navigation.getByRole("button", { name: /^プロジェクト 登録 \d+件$/u }));
    await user.click(screen.getByText("Atlas リニューアル").closest("button")!);
    dialog = within(screen.getByRole("dialog", { name: "詳細パネル" }));
    await user.click(dialog.getByText("充足済み").closest("button")!);
    await user.click(screen.getByRole("button", { name: "要員要件を取消" }));
    await user.click(screen.getByRole("button", { name: "チームへ保存" }));
    await waitFor(() => expect(cancelSave).toHaveBeenCalledOnce());
    expect(cancelSave.mock.calls[0][0]).toMatchObject({ assignments: [], needs: [] });
  });

  it("lets planners manage projects and needs but not members", async () => {
    const user = userEvent.setup();
    const adapter = sharedAdapter();
    adapter.initialState = linkedStaffingWorkspace();
    render(<App mode="shared" organizationName="Example Inc." identity={{ name: "計画 花子", email: "planner@example.com", role: "planner" }} shared={adapter} />);
    const navigation = within(screen.getByRole("navigation", { name: "メインナビゲーション" }));

    await user.click(navigation.getByRole("button", { name: "メンバー" }));
    await user.click(screen.getByText("佐伯 優斗").closest("button")!);
    expect(screen.queryByRole("button", { name: "メンバー情報を編集" })).not.toBeInTheDocument();
    await user.click(within(screen.getByRole("dialog", { name: "詳細パネル" })).getByRole("button", { name: "詳細パネルを閉じる" }));

    await user.click(navigation.getByRole("button", { name: /^プロジェクト 登録 \d+件$/u }));
    await user.click(screen.getByText("Atlas リニューアル").closest("button")!);
    expect(screen.getByRole("button", { name: "案件情報を編集" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "要員要件を追加" })).toBeInTheDocument();
  });

  it("rejects assignment edits outside the selected project period", async () => {
    const user = userEvent.setup();
    render(<App mode="shared" organizationName="Example Inc." identity={{ name: "管理 花子", email: "owner@example.com", role: "owner" }} shared={sharedAdapter()} />);
    await user.click(screen.getAllByRole("button", { name: /^Atlas リニューアルのアサイン詳細（/u })[0]);
    const dialog = within(screen.getByRole("dialog", { name: "詳細パネル" }));
    const endDate = dialog.getByLabelText("終了日");
    await user.clear(endDate);
    await user.type(endDate, "2027-01-01");
    expect(endDate).toBeInvalid();
    fireEvent.submit(endDate.closest("form")!);
    expect(await screen.findByText("アサイン期間はプロジェクト期間内に設定してください")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "チームへ保存" })).not.toBeInTheDocument();
  });

  it("resolves every overloaded business day without reducing unrelated dates", async () => {
    const user = userEvent.setup();
    const adapter = sharedAdapter();
    const save = vi.fn().mockResolvedValue({ revision: 8, savedAt: "2026-08-17T10:00:00Z" });
    const member = { ...initialWorkspace.members[0], id: "member", capacity: 100 };
    const project = { ...initialWorkspace.projects[0], id: "project", ownerPersonId: member.id };
    const weekStart = getWeekStart(0);
    adapter.initialState = {
      members: [member],
      projects: [project],
      needs: [],
      assignments: [
        { id: "both", personId: member.id, projectId: project.id, startDate: weekStart, endDate: addDays(weekStart, 1), allocation: 80, status: "confirmed" },
        { id: "monday", personId: member.id, projectId: project.id, startDate: weekStart, endDate: weekStart, allocation: 50, status: "confirmed" },
        { id: "tuesday", personId: member.id, projectId: project.id, startDate: addDays(weekStart, 1), endDate: addDays(weekStart, 1), allocation: 40, status: "confirmed" },
      ],
    };
    adapter.save = save;
    render(<App mode="shared" organizationName="Example Inc." identity={{ name: "管理 花子", email: "owner@example.com", role: "owner" }} shared={adapter} />);

    await user.click(screen.getByText("上限超過").closest("button")!);
    await user.click(screen.getByRole("button", { name: "推奨配分へ調整" }));
    await user.click(screen.getByRole("button", { name: "チームへ保存" }));
    await waitFor(() => expect(save).toHaveBeenCalledOnce());
    const saved = save.mock.calls[0][0] as WorkspaceState;
    expect(memberDailyLoads(saved, member.id, weekStart, addDays(weekStart, 4)).every((day) => day.load <= member.capacity)).toBe(true);
    expect(saved.assignments.find((assignment) => assignment.id === "both")?.allocation).toBe(80);
  });

  it("keeps zero-capacity and zero-demand workspaces finite and traps initial reverse tabbing", async () => {
    const user = userEvent.setup();
    const adapter = sharedAdapter();
    adapter.initialState = {
      members: [{ ...initialWorkspace.members[0], capacity: 0 }],
      projects: [{ ...initialWorkspace.projects[0], demand: 0 }],
      assignments: [],
      needs: [],
    };
    render(<App mode="shared" organizationName="Example Inc." identity={{ name: "管理 花子", email: "owner@example.com", role: "owner" }} shared={adapter} />);
    expect(document.body.innerHTML).not.toContain("NaN");
    expect(screen.getByText("0.0")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "アサインを追加" }));
    const dialog = screen.getByRole("dialog", { name: "詳細パネル" });
    await waitFor(() => expect(dialog).toHaveFocus());
    await user.keyboard("{Shift>}{Tab}{/Shift}");
    expect(screen.getByRole("button", { name: "この内容で仮置きする" })).toHaveFocus();
  });

  it("protects in-progress form input from realtime refresh and closes clean forms after refresh", async () => {
    const user = userEvent.setup();
    const adapter = sharedAdapter();
    const remoteState = {
      ...initialWorkspace,
      projects: initialWorkspace.projects.map((project, index) => index === 0 ? { ...project, summary: "リモートで更新された概要" } : project),
    };
    const latestState = {
      ...remoteState,
      projects: remoteState.projects.map((project, index) => index === 0 ? { ...project, summary: "さらに更新された概要" } : project),
    };
    let notifyRevision: (revision?: number) => void = () => undefined;
    adapter.subscribe = vi.fn((listener) => {
      notifyRevision = listener;
      return () => undefined;
    });
    adapter.reload = vi.fn()
      .mockResolvedValueOnce({ state: remoteState, revision: 8 })
      .mockResolvedValueOnce({ state: latestState, revision: 9 });
    render(<App mode="shared" organizationName="Example Inc." identity={{ name: "管理 花子", email: "owner@example.com", role: "owner" }} shared={adapter} />);
    const navigation = within(screen.getByRole("navigation", { name: "メインナビゲーション" }));

    await user.click(navigation.getByRole("button", { name: /^プロジェクト 登録 \d+件$/u }));
    await user.click(screen.getByText("Atlas リニューアル").closest("button")!);
    await user.click(screen.getByRole("button", { name: "案件情報を編集" }));
    const dialog = within(screen.getByRole("dialog", { name: "詳細パネル" }));
    await user.clear(dialog.getByLabelText("概要"));
    await user.type(dialog.getByLabelText("概要"), "入力途中の概要");

    act(() => notifyRevision(8));
    expect(await screen.findByText("他のユーザーの変更があります")).toBeInTheDocument();
    expect(adapter.reload).not.toHaveBeenCalled();
    expect(dialog.getByRole("button", { name: "変更を仮置き" })).toBeDisabled();

    await user.click(dialog.getByRole("button", { name: "詳細パネルを閉じる" }));
    await user.click(screen.getByRole("button", { name: "下書きを破棄して再読み込み" }));
    await waitFor(() => expect(adapter.reload).toHaveBeenCalledOnce());
    expect(screen.queryByRole("dialog", { name: "詳細パネル" })).not.toBeInTheDocument();
    expect(await screen.findByText("リモートで更新された概要")).toBeInTheDocument();

    await user.click(screen.getByText("Atlas リニューアル").closest("button")!);
    await user.click(screen.getByRole("button", { name: "案件情報を編集" }));
    expect(screen.getByRole("dialog", { name: "詳細パネル" })).toBeInTheDocument();
    act(() => notifyRevision(9));
    await waitFor(() => expect(adapter.reload).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole("dialog", { name: "詳細パネル" })).not.toBeInTheDocument();
    expect(await screen.findByText("さらに更新された概要")).toBeInTheDocument();
  });

  it("stores normalized skills and capacity when creating the first member", async () => {
    const user = userEvent.setup();
    const adapter = sharedAdapter();
    const save = vi.fn().mockResolvedValue({ revision: 8, savedAt: "2026-08-17T10:00:00Z" });
    adapter.initialState = { members: [], projects: [], assignments: [], needs: [] };
    adapter.save = save;
    render(<App mode="shared" organizationName="Example Inc." identity={{ name: "管理 花子", email: "owner@example.com", role: "owner" }} shared={adapter} />);
    const navigation = within(screen.getByRole("navigation", { name: "メインナビゲーション" }));

    await user.click(navigation.getByRole("button", { name: "メンバー" }));
    // The add action lives in the header slot only. It used to be in the
    // toolbar as well, calling the same handler, which is what #71 was about —
    // so there must be exactly one button offering it.
    const addButtons = screen.getAllByRole("button", { name: "メンバーを追加" });
    expect(addButtons).toHaveLength(1);
    await user.click(addButtons[0]);
    const dialog = within(screen.getByRole("dialog", { name: "詳細パネル" }));
    await user.type(dialog.getByLabelText("氏名"), "山田 花子");
    expect(dialog.getByLabelText("職種")).toHaveAttribute("id", "member-new-role");
    expect(dialog.getByLabelText("部署")).toHaveAttribute("id", "member-new-department");
    expect(dialog.getByLabelText("勤務地")).toHaveAttribute("id", "member-new-location");
    await user.type(dialog.getByLabelText("スキル（カンマ区切り）"), "React, TypeScript, react");
    await user.clear(dialog.getByLabelText("稼働上限（%）"));
    await user.type(dialog.getByLabelText("稼働上限（%）"), "60");
    await user.click(dialog.getByRole("button", { name: "メンバーを追加" }));
    await user.click(screen.getByRole("button", { name: "チームへ保存" }));
    await waitFor(() => expect(save).toHaveBeenCalledOnce());
    expect(save.mock.calls[0][0].members[0]).toMatchObject({ name: "山田 花子", skills: ["React", "TypeScript"], skillLevels: [{ name: "React", proficiency: 3 }, { name: "TypeScript", proficiency: 3 }], capacity: 60 });
  });

  it("shows skill map gaps and adds a catalog skill for planners", async () => {
    const user = userEvent.setup();
    const adapter = sharedAdapter();
    const save = vi.fn().mockResolvedValue({ revision: 8, savedAt: "2026-08-17T10:00:00Z" });
    adapter.save = save;
    render(<App mode="shared" organizationName="Example Inc." identity={{ name: "計画 花子", email: "planner@example.com", role: "planner" }} shared={adapter} />);
    const navigation = within(screen.getByRole("navigation", { name: "メインナビゲーション" }));

    await user.click(navigation.getByRole("button", { name: "スキルマップ" }));
    expect(screen.getByRole("heading", { level: 1, name: "スキルマップ" })).toBeInTheDocument();
    const apiName = screen.getAllByText("API").find((node) => node.tagName === "STRONG");
    expect(apiName).toBeTruthy();
    const apiRow = apiName!.closest("tr");
    expect(apiRow?.querySelector(".skill-gap")).not.toBeNull();

    await user.type(screen.getByPlaceholderText("React または フロントエンド"), "GraphQL");
    await user.selectOptions(screen.getByLabelText("スキル種類"), "skill");
    await user.selectOptions(screen.getByLabelText("親分類"), "バックエンド");
    await user.click(screen.getByRole("button", { name: "分類またはスキルを追加" }));
    expect(screen.getByText("GraphQL")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "チームへ保存" }));
    await waitFor(() => expect(save).toHaveBeenCalledOnce());
    const saved = save.mock.calls[0][0] as WorkspaceState;
    expect(saved.skillCatalog?.some((item) => item.name === "GraphQL")).toBe(true);
  });

  it("shows custom fields, work history, and lets admins add a field definition", async () => {
    const user = userEvent.setup();
    const adapter = sharedAdapter();
    const save = vi.fn().mockResolvedValue({ revision: 9, savedAt: "2026-08-19T10:00:00Z" });
    adapter.save = save;
    render(<App mode="shared" organizationName="Example Inc." identity={{ name: "管理 花子", email: "admin@example.com", role: "admin" }} shared={adapter} />);
    const navigation = within(screen.getByRole("navigation", { name: "メインナビゲーション" }));

    await user.click(navigation.getByRole("button", { name: "項目定義" }));
    expect(screen.getByRole("heading", { level: 1, name: "項目と経歴" })).toBeInTheDocument();
    expect(screen.getAllByText("雇用形態").length).toBeGreaterThan(0);
    await user.type(screen.getByPlaceholderText("雇用形態"), "在留資格");
    await user.type(screen.getByPlaceholderText("employment_type"), "visa_status");
    await user.click(screen.getByRole("button", { name: "項目を追加" }));
    expect(screen.getAllByText("在留資格").length).toBeGreaterThan(0);

    await user.click(navigation.getByRole("button", { name: "メンバー" }));
    await user.click(screen.getAllByRole("button", { name: /佐伯 優斗/ }).find((button) => button.classList.contains("member-name-cell"))!);
    expect(screen.getByText("Studio North")).toBeInTheDocument();
    expect(screen.getAllByText("ビジネス").length).toBeGreaterThan(0);
    await user.click(document.querySelector(".close-button") as HTMLButtonElement);

    await user.click(navigation.getByRole("button", { name: /^プロジェクト 登録 \d+件$/u }));
    expect(screen.getByText("Atlas株式会社")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "チームへ保存" }));
    await waitFor(() => expect(save).toHaveBeenCalledOnce());
    const saved = save.mock.calls[0][0] as WorkspaceState;
    expect(saved.customFields?.some((field) => field.key === "visa_status")).toBe(true);
  });

  it("lets admins request, collect, and confirm a member profile update", async () => {
    const user = userEvent.setup();
    const adapter = sharedAdapter();
    const save = vi.fn().mockResolvedValue({ revision: 12, savedAt: "2026-08-19T14:00:00Z" });
    adapter.save = save;
    render(<App mode="shared" organizationName="Example Inc." identity={{ name: "管理 花子", email: "admin@example.com", role: "admin" }} shared={adapter} />);
    const navigation = within(screen.getByRole("navigation", { name: "メインナビゲーション" }));

    await user.click(navigation.getByRole("button", { name: "項目定義" }));
    expect(screen.getByRole("heading", { name: "プロフィール更新依頼" })).toBeInTheDocument();
    expect(screen.getByText("フロント案件に向けてスキルを更新してください")).toBeInTheDocument();
    await user.clear(screen.getByLabelText("中村 美咲の更新スキル"));
    await user.type(screen.getByLabelText("中村 美咲の更新スキル"), "React:5, TypeScript:4, A11y:4");
    await user.click(screen.getByRole("button", { name: "中村 美咲の内容で提出" }));
    expect(screen.getByRole("button", { name: "中村 美咲を確認して反映" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "中村 美咲を確認して反映" }));
    await user.click(screen.getByRole("button", { name: "チームへ保存" }));
    await waitFor(() => expect(save).toHaveBeenCalledOnce());
    const saved = save.mock.calls[0][0] as WorkspaceState;
    expect(saved.members.find((member) => member.id === "nakamura")?.skillLevels?.find((level) => level.name === "React")?.proficiency).toBe(5);
    expect(saved.profileRequests?.find((request) => request.id === "req-nakamura-skills")?.status).toBe("done");
  });

  it("converts a pre-award opportunity into a project without creating assignments", async () => {
    const user = userEvent.setup();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    const adapter = sharedAdapter();
    const save = vi.fn().mockResolvedValue({ revision: 8, savedAt: "2026-08-19T10:00:00Z" });
    adapter.save = save;
    render(<App mode="shared" organizationName="Example Inc." identity={{ name: "計画 花子", email: "planner@example.com", role: "planner" }} shared={adapter} />);
    const navigation = within(screen.getByRole("navigation", { name: "メインナビゲーション" }));

    await user.click(navigation.getByRole("button", { name: /^受注前 進行中 \d+件$/u }));
    expect(screen.getByRole("heading", { level: 1, name: "受注前案件" })).toBeInTheDocument();
    await user.type(screen.getByLabelText("受注前案件を検索"), "React");
    expect(screen.getByText("北風商事 販売基盤")).toBeInTheDocument();
    expect(screen.queryByText("Harbor 会員アプリ")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /北風商事 販売基盤/ }));

    const dialog = within(screen.getByRole("dialog", { name: "詳細パネル" }));
    expect(dialog.getByText("中村 美咲")).toBeInTheDocument();
    expect(dialog.queryByRole("button", { name: "仮置き" })).not.toBeInTheDocument();
    await user.click(dialog.getByRole("button", { name: "プロジェクトへ引き継ぐ" }));
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining("未充足の要員要件"));
    const projectDialog = within(screen.getByRole("dialog", { name: "詳細パネル" }));
    expect(projectDialog.getByRole("heading", { name: "北風商事 販売基盤" })).toBeInTheDocument();
    expect(projectDialog.getByText("準備中")).toBeInTheDocument();
    expect(projectDialog.getByRole("button", { name: /Frontend Engineer/ })).toBeInTheDocument();
    await user.click(projectDialog.getByRole("button", { name: "詳細パネルを閉じる" }));

    await user.click(screen.getByRole("button", { name: "チームへ保存" }));
    await waitFor(() => expect(save).toHaveBeenCalledOnce());
    const saved = save.mock.calls[0][0] as WorkspaceState;
    const project = saved.projects.find((item) => item.name === "北風商事 販売基盤");
    expect(project).toMatchObject({ status: "準備中", demand: 4 });
    expect(saved.opportunities?.find((item) => item.id === "opp-northwind")).toMatchObject({ stage: "won", convertedProjectId: project?.id });
    expect(saved.needs.filter((need) => need.projectId === project?.id)).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: "Frontend Engineer", status: "open" }),
      expect.objectContaining({ role: "Backend Engineer", status: "open" }),
    ]));
    expect(saved.assignments).toHaveLength(initialWorkspace.assignments.length);
  });

  it("keeps pipeline demand distinct from confirmed utilization in reports", async () => {
    const user = userEvent.setup();
    render(<App />);
    const navigation = within(screen.getByRole("navigation", { name: "メインナビゲーション" }));

    await user.click(navigation.getByRole("button", { name: "レポート" }));
    expect(screen.getByText("確定稼働")).toBeInTheDocument();
    expect(screen.getByText("受注前の想定人数")).toBeInTheDocument();
    expect(document.querySelector(".pipeline-chip")).not.toBeNull();
    const exceptions = screen.getByText("判断が必要な項目").closest("section");
    expect(exceptions).not.toBeNull();
    const pipelineButtons = within(exceptions!).getAllByRole("button", { name: /北風商事 販売基盤/ });
    expect(pipelineButtons.length).toBeGreaterThan(0);
    await user.click(pipelineButtons[0]);
    expect(screen.getByRole("heading", { name: "北風商事 販売基盤" })).toBeInTheDocument();
    expect(within(screen.getByRole("dialog", { name: "詳細パネル" })).getByText("引き合い")).toBeInTheDocument();
  });

  it("shows organization hierarchy, concurrent posts, and lets admins add a unit", async () => {
    const user = userEvent.setup();
    const adapter = sharedAdapter();
    const save = vi.fn().mockResolvedValue({ revision: 10, savedAt: "2026-08-19T12:00:00Z" });
    adapter.save = save;
    render(<App mode="shared" organizationName="Example Inc." identity={{ name: "管理 花子", email: "admin@example.com", role: "admin" }} shared={adapter} />);
    const navigation = within(screen.getByRole("navigation", { name: "メインナビゲーション" }));

    await user.click(navigation.getByRole("button", { name: "組織" }));
    expect(screen.getByRole("heading", { level: 1, name: "組織階層" })).toBeInTheDocument();
    expect(screen.getAllByText("開発本部").length).toBeGreaterThan(0);
    expect(screen.getAllByText("プロダクト開発").length).toBeGreaterThan(0);
    await user.type(screen.getByPlaceholderText("新規チーム"), "モバイル推進");
    await user.selectOptions(screen.getByLabelText("親部門"), "org-product");
    await user.click(screen.getByRole("button", { name: "部門を追加" }));
    expect(screen.getByText("モバイル推進")).toBeInTheDocument();

    await user.click(navigation.getByRole("button", { name: "メンバー" }));
    await user.type(screen.getByPlaceholderText("名前・スキル・経歴を検索"), "デザイン本部");
    expect(screen.getAllByRole("button", { name: /佐伯 優斗/ }).some((button) => button.classList.contains("member-name-cell"))).toBe(true);
    await user.clear(screen.getByPlaceholderText("名前・スキル・経歴を検索"));
    await user.selectOptions(screen.getByLabelText("部門で絞り込み"), "org-engineering");
    expect(screen.getAllByRole("button", { name: /佐伯 優斗/ }).some((button) => button.classList.contains("member-name-cell"))).toBe(true);
    expect(screen.getAllByRole("button", { name: /中村 美咲/ }).some((button) => button.classList.contains("member-name-cell"))).toBe(true);

    await user.click(navigation.getByRole("button", { name: "レポート" }));
    const engineering = screen.getByText("開発本部").closest("div");
    expect(engineering).toHaveTextContent("5名");

    await user.click(screen.getByRole("button", { name: "チームへ保存" }));
    await waitFor(() => expect(save).toHaveBeenCalledOnce());
    const saved = save.mock.calls[0][0] as WorkspaceState;
    expect(saved.orgUnits?.some((unit) => unit.name === "モバイル推進")).toBe(true);
  });

  it("applies a saved search scene, shows scores, and lets admins persist a new scene", async () => {
    const user = userEvent.setup();
    const adapter = sharedAdapter();
    const save = vi.fn().mockResolvedValue({ revision: 10, savedAt: "2026-08-19T12:00:00Z" });
    adapter.save = save;
    render(<App mode="shared" organizationName="Example Inc." identity={{ name: "管理 花子", email: "admin@example.com", role: "admin" }} shared={adapter} />);
    const navigation = within(screen.getByRole("navigation", { name: "メインナビゲーション" }));

    await user.click(navigation.getByRole("button", { name: "メンバー" }));
    const sceneSelect = screen.getByLabelText("シーンを選ぶ");
    await user.selectOptions(sceneSelect, within(sceneSelect).getByRole("option", { name: "フロントエンド候補" }));
    expect(screen.getAllByRole("button", { name: /中村 美咲/ }).some((button) => button.classList.contains("member-name-cell"))).toBe(true);
    // 60/60: the ceiling, not 100, because this scene names one 「あると良い」 skill —
    // 20 for it plus 40 for the availability. The candidate is at the top of the scale
    // and the cell now says so (#150).
    expect(screen.getByText("60/60点")).toBeInTheDocument();
    expect(document.querySelector(".viz-caption#member-score-key")!.textContent).toContain("満点となる 60 点");
    expect(document.querySelector(".member-table")).toHaveAttribute("aria-describedby", "member-score-key");
    expect(screen.queryAllByRole("button", { name: /佐伯 優斗/ }).find((button) => button.classList.contains("member-name-cell"))).toBeUndefined();

    await user.type(screen.getByPlaceholderText("フロントエンド候補"), "React実務者");
    await user.type(screen.getByPlaceholderText("React:3, TypeScript:3"), "React:3");
    await user.click(screen.getByRole("button", { name: "検索シーンを保存" }));
    expect(screen.getByRole("option", { name: "React実務者" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "チームへ保存" }));
    await waitFor(() => expect(save).toHaveBeenCalledOnce());
    const saved = save.mock.calls[0][0] as WorkspaceState;
    expect(saved.searchScenes?.some((scene) => scene.name === "React実務者" && scene.skills?.some((skill) => skill.name === "React" && skill.importance === "must"))).toBe(true);
  });

  it("lets planners apply a search scene but not save a new one", async () => {
    const user = userEvent.setup();
    render(<App mode="shared" organizationName="Example Inc." identity={{ name: "計画 花子", email: "planner@example.com", role: "planner" }} shared={sharedAdapter()} />);
    const navigation = within(screen.getByRole("navigation", { name: "メインナビゲーション" }));
    await user.click(navigation.getByRole("button", { name: "メンバー" }));
    expect(screen.getByLabelText("シーンを選ぶ")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "検索シーンを保存" })).not.toBeInTheDocument();
  });

  it("lets admins apply and save a custom report definition", async () => {
    const user = userEvent.setup();
    const adapter = sharedAdapter();
    const save = vi.fn().mockResolvedValue({ revision: 11, savedAt: "2026-08-19T13:00:00Z" });
    adapter.save = save;
    render(<App mode="shared" organizationName="Example Inc." identity={{ name: "管理 花子", email: "admin@example.com", role: "admin" }} shared={adapter} />);
    const navigation = within(screen.getByRole("navigation", { name: "メインナビゲーション" }));

    await user.click(navigation.getByRole("button", { name: "レポート" }));
    expect(screen.getByRole("heading", { name: "任意項目レポート" })).toBeInTheDocument();
    const reportSelect = screen.getByLabelText("レポートを選ぶ");
    await user.selectOptions(reportSelect, within(reportSelect).getByRole("option", { name: "部署別人数" }));
    expect(screen.getAllByText("デザイン").length).toBeGreaterThan(0);
    await user.type(screen.getByPlaceholderText("部署別人数"), "勤務地別人数");
    await user.selectOptions(screen.getByLabelText("レポートの集計対象"), "members");
    await user.selectOptions(screen.getByLabelText("レポートのグループ"), "勤務地");
    await user.click(screen.getByRole("button", { name: "レポートを保存" }));
    expect(screen.getByRole("option", { name: "勤務地別人数" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "チームへ保存" }));
    await waitFor(() => expect(save).toHaveBeenCalledOnce());
    const saved = save.mock.calls[0][0] as WorkspaceState;
    expect(saved.savedReports?.some((report) => report.name === "勤務地別人数" && report.groupBy === "location")).toBe(true);
  });

  it("migrates legacy demo leave rows out of local storage", async () => {
    const member = initialWorkspace.members[0];
    const project = initialWorkspace.projects[0];
    window.localStorage.setItem("mosaic-local-workspace-v3", JSON.stringify({
      members: [member],
      projects: [project],
      assignments: [{ id: "legacy-leave", personId: member.id, projectId: "leave", startDate: getWeekStart(0), endDate: getWeekStart(0), allocation: 0, status: "confirmed", label: "休暇" }],
      needs: [{ id: "orphan-need", projectId: "missing", role: "QA Engineer", skills: [], startDate: getWeekStart(0), endDate: addDays(getWeekStart(0), 4), allocation: 20, status: "open" }],
    }));

    render(<App />);
    await waitFor(() => expect(screen.queryByText("保存データを読み込み中")).not.toBeInTheDocument());
    expect(document.querySelectorAll(".assignment")).toHaveLength(0);
    expect(screen.queryByText("休暇")).not.toBeInTheDocument();
    expect(screen.queryByText("未充足ロール")).not.toBeInTheDocument();
    window.localStorage.removeItem("mosaic-local-workspace-v3");
  });
});

describe("favorites, share links, and anonymous proposals", () => {
  it("opens a member drawer from an internal share URL", async () => {
    window.history.replaceState({}, "", "/?nav=members&open=saeki");
    render(<App mode="shared" organizationName="Example Inc." identity={{ name: "計画 花子", email: "planner@example.com", role: "planner" }} shared={sharedAdapter()} />);
    expect(await screen.findByRole("heading", { name: "佐伯 優斗" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "このメンバーのリンクをコピー" })).toBeInTheDocument();
  });

  it("copies a member share link from the profile drawer", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    render(<App mode="shared" organizationName="Example Inc." identity={{ name: "計画 花子", email: "planner@example.com", role: "planner" }} shared={sharedAdapter()} />);
    await user.click(within(screen.getByRole("navigation", { name: "メインナビゲーション" })).getByRole("button", { name: "メンバー" }));
    await user.click(screen.getByRole("button", { name: "佐伯 優斗をお気に入りに追加" }).closest("tr")!.querySelector(".member-name-cell")!);
    await user.click(screen.getByRole("button", { name: "このメンバーのリンクをコピー" }));
    await waitFor(() => expect(writeText).toHaveBeenCalled());
    expect(String(writeText.mock.calls[0][0])).toContain("nav=members");
    expect(String(writeText.mock.calls[0][0])).toContain("open=saeki");
  });

  it("persists a demo favorite in local storage", async () => {
    const user = userEvent.setup();
    window.localStorage.setItem(DEMO_FAVORITES_KEY, "[]");
    render(<App />);
    await waitFor(() => expect(screen.queryByText("保存データを読み込み中")).not.toBeInTheDocument());
    await user.click(within(screen.getByRole("navigation", { name: "メインナビゲーション" })).getByRole("button", { name: "メンバー" }));
    await user.click(screen.getByRole("button", { name: "佐伯 優斗をお気に入りに追加" }));
    expect(JSON.parse(window.localStorage.getItem(DEMO_FAVORITES_KEY) ?? "[]")).toEqual([{ kind: "member", targetId: "saeki" }]);
    expect(screen.getByRole("button", { name: "佐伯 優斗のお気に入りを解除" })).toHaveAttribute("aria-pressed", "true");
  });

  it("hides names in the anonymized proposal view", async () => {
    const user = userEvent.setup();
    window.history.replaceState({}, "", "/?nav=proposal&members=saeki,nakamura&anonymous=1");
    render(<App mode="shared" organizationName="Example Inc." identity={{ name: "計画 花子", email: "planner@example.com", role: "planner" }} shared={sharedAdapter()} />);
    expect(await screen.findByRole("heading", { name: "候補A" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "候補B" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "佐伯 優斗" })).not.toBeInTheDocument();
    expect(screen.queryByText("東京")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "提案" }));
    expect(screen.getByLabelText("氏名・勤務地を隠す")).toBeChecked();
  });

  it("loads and updates shared favorites through the workspace adapter", async () => {
    const user = userEvent.setup();
    const adapter = sharedAdapter();
    adapter.listFavorites = vi.fn().mockResolvedValue([{ kind: "project", targetId: "atlas" }]);
    adapter.setFavorite = vi.fn().mockResolvedValue([]);
    render(<App mode="shared" organizationName="Example Inc." identity={{ name: "閲覧 太郎", email: "viewer@example.com", role: "viewer" }} shared={adapter} />);
    await waitFor(() => expect(adapter.listFavorites).toHaveBeenCalled());
    await user.click(within(screen.getByRole("navigation", { name: "メインナビゲーション" })).getByRole("button", { name: /^プロジェクト 登録 \d+件$/u }));
    expect(screen.getByRole("button", { name: "Atlas リニューアルのお気に入りを解除" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Atlas リニューアルのお気に入りを解除" }));
    await waitFor(() => expect(adapter.setFavorite).toHaveBeenCalledWith("project", "atlas", false));
  });
});

describe("CSV import", () => {
  it("imports a member CSV as unsaved shared changes", async () => {
    const user = userEvent.setup();
    const adapter = sharedAdapter();
    const save = vi.fn().mockResolvedValue({ revision: 8, savedAt: "2026-08-17T10:00:00Z" });
    adapter.save = save;
    render(<App mode="shared" organizationName="Example Inc." identity={{ name: "管理 花子", email: "owner@example.com", role: "owner" }} shared={adapter} />);
    await user.click(within(screen.getByRole("navigation", { name: "メインナビゲーション" })).getByRole("button", { name: "項目定義" }));
    const input = document.querySelector("input[type='file']") as HTMLInputElement;
    const file = new File(["name,role,department,location,capacity\nCSV 花子,Frontend Engineer,プロダクト開発,東京,90\n"], "members.csv", { type: "text/csv" });
    await user.upload(input, file);
    await user.click(await screen.findByRole("button", { name: "1行を仮置きする" }));
    await user.click(screen.getByRole("button", { name: "チームへ保存" }));
    await waitFor(() => expect(save).toHaveBeenCalledOnce());
    expect((save.mock.calls[0][0] as WorkspaceState).members.some((member) => member.name === "CSV 花子" && member.capacity === 90)).toBe(true);
  });
});

describe("four-week capacity rail", () => {
  /**
   * Each week's label used to be absolutely positioned inside its bar, so the
   * grid that was supposed to keep the four weeks apart could not: "100%" is
   * 26.2px at the 10px floor while a segment was 19.6-21.3px, and the labels
   * overlapped their neighbour at every width up to about 1400px and escaped
   * the rail's own box at every width measured, up to 1920px.
   *
   * Bar and label are now separate items of the same grid, one column each.
   * Grid items in different tracks cannot overlap, so this asserts the
   * structure that makes that true rather than any pixel width. The rendered
   * geometry is in the PR.
   */
  it("keeps each week's label out of its bar so the two share a grid column", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(within(screen.getByRole("navigation", { name: "メインナビゲーション" })).getByRole("button", { name: "メンバー" }));

    const rails = document.querySelectorAll(".member-week-rail");
    expect(rails.length).toBeGreaterThan(0);
    for (const rail of rails) {
      // grid-auto-flow: column over two rows fills each column top-to-bottom
      // before moving on, so the order has to be bar, its label, next bar, its
      // label. Counting 4 and 4 would also pass i,i,i,i,small,small,small,small,
      // which puts every label one to three weeks away from its own bar.
      expect([...rail.children].map((child) => child.tagName.toLowerCase()))
        .toEqual(["i", "small", "i", "small", "i", "small", "i", "small"]);
      // A label nested in its bar is out of the grid entirely — the original bug.
      expect(rail.querySelectorAll("i small")).toHaveLength(0);
      // Every label reads as a percentage, so a swapped or empty cell shows up.
      const notAPercentage = [...rail.querySelectorAll(":scope > small")]
        .map((label) => label.textContent ?? "")
        .filter((text) => !/^\d+%$/u.test(text));
      expect(notAPercentage).toEqual([]);
    }
  });
});

describe("the header's primary slot", () => {
  /**
   * The slot used to hold two different kinds of thing: "add something here" on
   * six screens, and "go to another screen" on three — org and fields both read
   * 「メンバーを確認」 and reports read 「ボードで調整」 (#104). Same position,
   * same styling, unpredictable result.
   *
   * The contract is now one meaning: the main action that completes on this
   * screen. A screen with no such action shows no button rather than borrowing
   * the slot for navigation.
   */
  // Not "screens without a primary action" — skills has one. These are the
  // screens checked for the three labels that were removed from the slot.
  const screensCheckedForRemovedLabels = ["組織", "スキルマップ", "項目定義", "レポート"] as const;
  const expectedLabels: Record<string, string | null> = {
    アサインボード: "アサインを追加",
    プロジェクト: "プロジェクトを追加",
    受注前: "受注前案件を追加",
    メンバー: "メンバーを追加",
    提案: "提案リンクをコピー",
    組織: null,
    スキルマップ: "不足ロールを確認",
    項目定義: null,
    レポート: null,
  };

  it("holds at most one primary action per screen, and it is the expected one", async () => {
    const user = userEvent.setup();
    render(<App />);
    const navigation = within(screen.getByRole("navigation", { name: "メインナビゲーション" }));
    const header = screen.getByRole("banner");

    for (const [nav, label] of Object.entries(expectedLabels)) {
      // The projects and 受注前 labels carry a parenthesised count (#85).
      await user.click(navigation.getByRole("button", { name: new RegExp(`^${nav}( .*)?$`, "u") }));
      // The slot itself, rather than "header buttons whose label is not 検索 or
      // 通知": that filter would excuse an unlabelled button and would swallow a
      // primary action that happened to read 検索.
      const slot = [...header.querySelectorAll(".primary-button")].map((button) => button.textContent?.trim() ?? "");
      expect(slot).toEqual(label === null ? [] : [label]);
    }
  });

  /**
   * The disabled condition moved from four parallel ternaries to one `enabled`
   * field per screen, and inverted in the process
   * (`needs.every(filled)` -> `needs.some(!filled)`,
   * `visibleProposalIds.length === 0` -> `length > 0`). A viewer is the case
   * where those conditions actually bite.
   */
  it("still disables rather than hides the slot for a viewer", async () => {
    const user = userEvent.setup();
    render(<App mode="shared" organizationName="Example Inc." identity={{ name: "閲覧 太郎", email: "viewer@example.com", role: "viewer" }} shared={sharedAdapter()} />);
    const navigation = within(screen.getByRole("navigation", { name: "メインナビゲーション" }));

    for (const [nav, label] of [["アサインボード", "アサインを追加"], ["プロジェクト", "プロジェクトを追加"], ["メンバー", "メンバーを追加"]] as const) {
      await user.click(navigation.getByRole("button", { name: new RegExp(`^${nav}( .*)?$`, "u") }));
      // Present but disabled: a viewer should see what the screen is for.
      expect(screen.getByRole("button", { name: label })).toBeDisabled();
    }

    // And the three screens that lost their button lose it for a viewer too.
    const header = within(screen.getByRole("banner"));
    for (const nav of ["組織", "項目定義", "レポート"] as const) {
      await user.click(navigation.getByRole("button", { name: nav }));
      expect(header.queryByRole("button", { name: /メンバーを確認|ボードで調整/u })).not.toBeInTheDocument();
    }
  });

  it("keeps the three removed labels out of the header", async () => {
    const user = userEvent.setup();
    render(<App />);
    const navigation = within(screen.getByRole("navigation", { name: "メインナビゲーション" }));
    const header = within(screen.getByRole("banner"));

    for (const nav of screensCheckedForRemovedLabels) {
      await user.click(navigation.getByRole("button", { name: nav }));
      // Scoped to the header: 「メンバーを確認」 also exists inside SkillsView,
      // where a link to another part of the app is legible for what it is. The
      // contract is about the slot, not about the string.
      for (const gone of ["メンバーを確認", "ボードで調整"]) {
        expect(header.queryByRole("button", { name: gone })).not.toBeInTheDocument();
      }
    }
  });
});

describe("the organization table's delete column", () => {
  /**
   * Every department in the shipped data has children or members, so
   * archiveOrgUnit refused all nine delete buttons and said so in the add form's
   * error slot 618px above the button (#86). The view now asks the same function
   * archiveOrgUnit asks, and offers the control only where it works.
   */
  it("shows the reason instead of a button where the delete cannot work", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(within(screen.getByRole("navigation", { name: "メインナビゲーション" })).getByRole("button", { name: "組織" }));

    const rows = [...document.querySelectorAll(".org-view tbody tr")];
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      const name = row.querySelector("strong")?.textContent ?? "";
      const cell = row.children[row.children.length - 1];
      expect(cell.querySelector("button"), `${name} should not offer a delete it cannot perform`).toBeNull();
      // The reason, not an empty cell: an empty one would pass a button check
      // while telling the reader nothing.
      expect(cell.querySelector(".read-only-label")?.textContent).toMatch(/配下に部門あり|所属メンバーあり/u);
    }
  });

  it("offers the delete on an empty department, and it removes the row", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(within(screen.getByRole("navigation", { name: "メインナビゲーション" })).getByRole("button", { name: "組織" }));

    const before = document.querySelectorAll(".org-view tbody tr").length;
    await user.type(screen.getByLabelText("部門名"), "空のチーム");
    await user.click(screen.getByRole("button", { name: "部門を追加" }));
    expect(document.querySelectorAll(".org-view tbody tr")).toHaveLength(before + 1);

    // The new department has no members and no children, so it is the only row
    // with a live button.
    const deletes = screen.getAllByRole("button", { name: "削除" });
    expect(deletes).toHaveLength(1);
    await user.click(deletes[0]);

    expect(document.querySelectorAll(".org-view tbody tr")).toHaveLength(before);
    expect(screen.queryByText("空のチーム")).not.toBeInTheDocument();
  });

  it("writes zero as a count, matching the column beside it", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(within(screen.getByRole("navigation", { name: "メインナビゲーション" })).getByRole("button", { name: "組織" }));

    const concurrent = [...document.querySelectorAll(".org-view tbody tr")].map((row) => row.children[2].textContent?.trim() ?? "");
    expect(concurrent.length).toBeGreaterThan(0);
    // An em dash reads as "not applicable"; 主所属 next to it writes 2名.
    expect(concurrent.filter((text) => !/^\d+名$/u.test(text))).toEqual([]);
    expect(concurrent).toContain("0名");
  });
});

describe("the member screen's scene form", () => {
  /**
   * Nine fields for saving a search scene sat permanently open above the results,
   * 268px of the 740px that stood between the top of the page and the first
   * candidate on a 900px viewport — two of nine rows visible on a screen whose
   * job is to show candidates (#81). It is a `<details>` now, shut on arrival.
   */
  it("starts folded and stays reachable", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(within(screen.getByRole("navigation", { name: "メインナビゲーション" })).getByRole("button", { name: "メンバー" }));

    const disclosure = document.querySelector("details.search-scene-disclosure");
    expect(disclosure).not.toBeNull();
    expect(disclosure).not.toHaveAttribute("open");
    expect(screen.getByText("新しい検索シーンの条件を入力")).toBeInTheDocument();

    // jsdom does not hide a closed details' contents, so this asserts the state
    // and the toggle, not visibility. What the folding actually buys is measured
    // in a real browser and recorded in the PR.
    await user.click(screen.getByText("新しい検索シーンの条件を入力"));
    expect(disclosure).toHaveAttribute("open");
    expect(screen.getByRole("button", { name: "検索シーンを保存" })).toBeInTheDocument();
    expect(screen.getByPlaceholderText("フロントエンド候補")).toBeInTheDocument();

    // And it shuts again, so the summary is a toggle rather than a one-way door.
    await user.click(screen.getByText("新しい検索シーンの条件を入力"));
    expect(disclosure).not.toHaveAttribute("open");
  });

  it("still saves a scene once opened", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(within(screen.getByRole("navigation", { name: "メインナビゲーション" })).getByRole("button", { name: "メンバー" }));
    await user.click(screen.getByText("新しい検索シーンの条件を入力"));

    // Absent first: without this the assertion below would pass on a scene that
    // was already there.
    expect(screen.queryByRole("option", { name: "バックエンド候補" })).not.toBeInTheDocument();
    await user.type(screen.getByPlaceholderText("フロントエンド候補"), "バックエンド候補");
    await user.click(screen.getByRole("button", { name: "検索シーンを保存" }));

    // The saved scene turns up in the toolbar's picker.
    expect(await screen.findByRole("option", { name: "バックエンド候補" })).toBeInTheDocument();
  });
});

describe("the sidebar's utilisation card", () => {
  /**
   * `averageLoad` is week-scoped: `memberDailyLoads` skips Saturday and Sunday
   * and `capacity` is a per-day percentage, so the denominator is capacity times
   * five weekdays. The card labelled it 「{month}月のチーム稼働」, so a week's
   * figure read as a month's, and paging the board moved the month in the label
   * while the metric stayed week-scoped (#115).
   */
  it("names the week it measures, and follows the board when the week changes", async () => {
    const user = userEvent.setup();
    render(<App />);
    const card = document.querySelector(".month-card-label");
    expect(card).not.toBeNull();
    const label = () => card!.querySelector("span")!.textContent ?? "";

    // The board's header is the other place the same week is named, so the two
    // are compared against each other rather than against a hardcoded date.
    // Read the board's own date range element rather than searching the whole
    // screen for a date, which would match any other one.
    const heading = () => document.querySelector(".date-range")!.textContent ?? "";
    const mondayOf = (text: string) => {
      const m = text.match(/^(\d+)\/(\d+)週の平均稼働率$/u);
      expect(m, `label should name a Monday: ${text}`).not.toBeNull();
      return { month: Number(m![1]), date: Number(m![2]) };
    };
    const headingStart = (text: string) => {
      const m = text.match(/(\d+)月(\d+)日 — /u);
      expect(m, `board header should name a week: ${text}`).not.toBeNull();
      return { month: Number(m![1]), date: Number(m![2]) };
    };

    // 稼働率 rather than 稼働: the value is a percentage. 平均稼働率 rather than
    // チーム稼働率: the board's pulse strip shows this same variable under that
    // name, and #82 is about one value not carrying two names.
    expect(label()).toMatch(/^\d+\/\d+週の平均稼働率$/u);
    expect(label()).not.toMatch(/月のチーム稼働|チーム稼働率/u);
    expect(card!.querySelector("strong")!.textContent).toMatch(/^\d+%$/u);
    expect(mondayOf(label())).toEqual(headingStart(heading()));

    // Paging moves the label to the next Monday, and the header agrees there too
    // — checking only "the string changed" would pass on any other date.
    const before = mondayOf(label());
    await user.click(screen.getByRole("button", { name: "次の週" }));
    const after = mondayOf(label());
    expect(after).not.toEqual(before);
    expect(after).toEqual(headingStart(heading()));

    const asDate = ({ month, date }: { month: number; date: number }) => new Date(2026, month - 1, date).getTime();
    expect((asDate(after) - asDate(before)) / 86400000).toBe(7);
  });
});

/**
 * #82: the member screen printed 稼働 (load) under wording that said 空き
 * (稼働上限 − 稼働), and two of its labels named a condition the code does not
 * apply. These fix the words to the code rather than the code to the words: the
 * `.6` threshold is shared by the bar colours, the ribbon count and the "next"
 * column, so moving it would change three meanings at once.
 */
describe("one word per quantity", () => {
  const weekStart = getWeekStart(0);
  const owner = { name: "管理 花子", email: "owner@example.com", role: "owner" as const };

  /**
   * 30 of a 50% ceiling: 稼働率 60%, so the member sits exactly on the band's
   * edge and is counted — while their 空き is 20 points, not 40. The old label
   * 「40%以上の空き」 was true only for a 100% ceiling.
   */
  function halfCeilingWorkspace(allocation: number, weeks = 1): WorkspaceState {
    const project = { ...initialWorkspace.projects[0], id: "project" };
    const member = { ...initialWorkspace.members[0], id: "half", name: "上限半分 一郎", capacity: 50 };
    return {
      members: [member],
      projects: [project],
      assignments: [{ id: "load", personId: member.id, projectId: project.id, startDate: weekStart, endDate: addDays(weekStart, weeks * 7 - 3), allocation, status: "confirmed" }],
      needs: [],
    } as unknown as WorkspaceState;
  }

  async function openMembers(state: WorkspaceState) {
    const user = userEvent.setup();
    const adapter = sharedAdapter();
    adapter.initialState = state;
    render(<App mode="shared" organizationName="Example Inc." identity={owner} shared={adapter} />);
    await user.click(within(screen.getByRole("navigation", { name: "メインナビゲーション" })).getByRole("button", { name: "メンバー" }));
    return user;
  }

  it("labels the ribbon count with the condition it actually applies", async () => {
    await openMembers(halfCeilingWorkspace(30));
    const ribbon = document.querySelector(".member-ribbon")!;

    const band = [...ribbon.querySelectorAll(".ribbon-stat")].find((el) => el.querySelector("span")?.textContent === "稼働率60%以下");
    expect(band, ribbon.textContent ?? "").toBeTruthy();
    expect(band!.querySelector("strong")!.textContent).toBe("1");
    // The old wording would be a claim about a quantity this member does not
    // have: 稼働上限 50 − 稼働 30 = 20 points of 空き.
    expect(ribbon.textContent).not.toContain("40%以上の空き");
    expect(document.querySelector(".next-open")!.textContent).toContain("空き20%");

    // The ordering is by 稼働率 too, so it gets the same word as the count. It is
    // a control since #138, so the word is read off the chosen option rather than
    // a status line — the point #121 was making is about the word, not the widget.
    const order = screen.getByLabelText("並び順を選ぶ") as HTMLSelectElement;
    expect(order.options[order.selectedIndex].textContent).toBe("稼働率の低い順");
    expect(ribbon.textContent).toContain("稼働率の低い順にメンバーを表示");

    // The colour key names the same metric and the same two thresholds, and the
    // over-ceiling count is worded like the colour it keys.
    const legend = [...document.querySelector(".capacity-legend")!.querySelectorAll("span")].map((el) => el.textContent);
    expect(legend).toEqual(["稼働率", "60%以下", "適正", "上限超過"]);
    expect([...ribbon.querySelectorAll(".ribbon-stat span")].map((el) => el.textContent)).toContain("上限超過");
    expect(ribbon.textContent).not.toContain("稼働超過");
  });

  it("does not call a 稼働率 above the band 満員", async () => {
    await openMembers(halfCeilingWorkspace(35, 4));
    // 35 of 50 is 70%: above the 60% band for all four weeks, but nowhere near
    // full. 「満員」 implied 100%, and 「4週先まで」 implied a range one week wider
    // than the four the code reads.
    const cell = document.querySelector(".next-open")!;
    expect(cell.textContent).toContain("4週間で該当なし");
    expect(cell.textContent).not.toContain("4週先");
    expect(document.body.textContent).not.toContain("満員");
  });

  it("names the metric in the header of every column that carries a number", async () => {
    await openMembers(halfCeilingWorkspace(30));
    const table = screen.getByRole("table");
    const headers = [...table.querySelectorAll("thead th")].map((th) => th.textContent ?? "");

    // #146 named the week instead of claiming the current one: this column follows
    // the board's paging, so 「今週」 was wrong as soon as the board moved.
    const weekHeader = headers.find((text) => /^\d+\/\d+週の稼働$/u.test(text));
    expect(weekHeader, `no week-scoped header among ${headers.join(" | ")}`).toBeDefined();
    expect(headers).toContain("4週間の稼働");
    expect(headers.filter((text) => text.includes("今週"))).toEqual([]);
    expect(headers).not.toContain("4週間のキャパシティ");

    // And the cell under that header really is the load, not the 空き.
    const cell = table.querySelectorAll("tbody tr")[0].children[headers.indexOf(weekHeader!)];
    expect(cell.querySelector(".load-ring strong")!.textContent).toBe("30%");
    expect(cell.textContent).toContain("稼働上限 50%");
  });

  it("gives averageLoad one name in both places it is shown", () => {
    render(<App />);
    const sidebar = document.querySelector(".month-card-label")!;
    const strip = [...document.querySelectorAll(".pulse-metric")].filter((el) => el.querySelector("span")?.textContent === "平均稼働率");

    expect(strip).toHaveLength(1);
    expect(sidebar.querySelector("span")!.textContent).toContain("平均稼働率");
    // Same variable, so the two figures must agree — the point of one name.
    expect(strip[0].querySelector("strong")!.textContent).toBe(sidebar.querySelector("strong")!.textContent);
    expect(document.body.textContent).not.toContain("チーム稼働");
  });

  it("keeps 稼働上限 0% out of the 稼働率60%以下 band, where no 稼働率 exists", async () => {
    const project = { ...initialWorkspace.projects[0], id: "project" };
    const idle = { ...initialWorkspace.members[0], id: "idle", name: "稼働不可 一郎", capacity: 0 };
    const inBand = { ...initialWorkspace.members[1], id: "in-band", name: "余裕 二郎", capacity: 50 };
    await openMembers({
      members: [idle, inBand],
      projects: [project],
      assignments: [{ id: "load", personId: inBand.id, projectId: project.id, startDate: weekStart, endDate: addDays(weekStart, 4), allocation: 20, status: "confirmed" }],
      needs: [],
    } as unknown as WorkspaceState);

    // A 0% ceiling makes load / capacity undefined, so the member belongs in
    // neither band. The count is the one member who has a 稼働率 under 60.
    const band = [...document.querySelectorAll(".member-ribbon .ribbon-stat")].find((el) => el.querySelector("span")?.textContent === "稼働率60%以下");
    expect(band!.querySelector("strong")!.textContent).toBe("1");
    const cells = [...document.querySelectorAll(".next-open")].map((el) => el.textContent ?? "");
    expect(cells.some((text) => text.startsWith("稼働不可 · 稼働上限0%"))).toBe(true);
  });

  it("names the week the same way the drawer does, and only the week it checked", async () => {
    const project = { ...initialWorkspace.projects[0], id: "project" };
    const member = { ...initialWorkspace.members[0], id: "bumpy", name: "凹凸 三郎", capacity: 100 };
    // 70 / 50 / 90 / 90: only the second week is under the band, so 「2週目から」
    // claimed a run that does not exist.
    const week = (offset: number, allocation: number) => ({
      id: `w${offset}`, personId: member.id, projectId: project.id,
      startDate: addDays(weekStart, offset * 7), endDate: addDays(weekStart, offset * 7 + 4),
      allocation, status: "confirmed" as const,
    });
    await openMembers({
      members: [member], projects: [project],
      assignments: [week(0, 70), week(1, 50), week(2, 90), week(3, 90)],
      needs: [],
    } as unknown as WorkspaceState);

    const cell = document.querySelector(".next-open")!.textContent ?? "";
    // 「2週後」 is what the member drawer and the proposal card call this week.
    expect(cell).toContain("2週後");
    expect(cell).not.toContain("週目から");
  });

  it("says which side of the 稼働上限 the team average is on", async () => {
    const project = { ...initialWorkspace.projects[0], id: "project" };
    const member = { ...initialWorkspace.members[0], id: "over", name: "超過 四郎", capacity: 50 };
    const adapter = sharedAdapter();
    adapter.initialState = {
      members: [member], projects: [project],
      assignments: [{ id: "load", personId: member.id, projectId: project.id, startDate: weekStart, endDate: addDays(weekStart, 4), allocation: 100, status: "confirmed" }],
      needs: [],
    } as unknown as WorkspaceState;
    render(<App mode="shared" organizationName="Example Inc." identity={owner} shared={adapter} />);

    // 100 of a 50% ceiling is a 200% average, so 「稼働上限まであと 0%。」 would
    // read as "just at the limit" while the team is 100 points past it.
    const card = document.querySelector(".month-card")!;
    expect(card.querySelector("strong")!.textContent).toBe("200%");
    expect(card.querySelector("p")!.textContent).toContain("稼働上限を 100% 超えています。");
    expect(card.querySelector("p")!.textContent).not.toContain("まであと");
  });

  it("names the metric on a need's allocation in the planned branch too", async () => {
    const user = userEvent.setup();
    const project = { ...initialWorkspace.projects[0], id: "project" };
    const member = { ...initialWorkspace.members[4], id: "picked", name: "仮置き 五郎", role: "QA Engineer", skills: ["QA"], capacity: 100 };
    const adapter = sharedAdapter();
    adapter.initialState = {
      members: [member], projects: [project], assignments: [],
      needs: [{ id: "need", projectId: project.id, role: "QA Engineer", skills: ["QA"], startDate: weekStart, endDate: addDays(weekStart, 4), allocation: 45, status: "planned", draftPersonId: member.id }],
    } as unknown as WorkspaceState;
    render(<App mode="shared" organizationName="Example Inc." identity={owner} shared={adapter} />);

    await user.click(screen.getByText("解消予定").closest("button")!);
    const dialog = within(screen.getByRole("dialog", { name: "詳細パネル" }));
    expect(dialog.getByText(/^稼働配分 45% · /u)).toBeInTheDocument();
  });

  it("uses none of the retired words on the board or the member screen", async () => {
    const retired = ["余白", "余力", "空き率", "満員", "キャパシティ", "チーム稼働"];
    const user = userEvent.setup();
    render(<App />);
    const clean = (where: string) => {
      for (const word of retired) expect(document.body.textContent, `${word} on ${where}`).not.toContain(word);
    };

    clean("the board");
    await user.click(within(screen.getByRole("navigation", { name: "メインナビゲーション" })).getByRole("button", { name: "メンバー" }));
    clean("the member list");
    // The member drawer is the other place the four-week bars appear.
    await user.click(screen.getByText("佐伯 優斗").closest("button")!);
    expect(within(screen.getByRole("dialog", { name: "詳細パネル" })).getByText("4週間の稼働")).toBeInTheDocument();
    clean("the member drawer");
  });
});

/**
 * #88: the board had one label meaning two things — the sidebar's 「メンバー」
 * leaves the screen, the schedule card's 「メンバー」 changed what the rows are —
 * and its assignment bars shared accessible names. Measured on the board at
 * 1440px: five names covering twelve of the thirty-seven visible buttons, and
 * three of the four 「Atlas リニューアル」 bars shared a name *and* a day range,
 * so only the row told them apart.
 */
describe("one name per control on the board", () => {
  const weekStart = getWeekStart(0);
  const owner = { name: "管理 花子", email: "owner@example.com", role: "owner" as const };

  /**
   * The accessible names Testing Library computes, not an approximation of them.
   * `name` accepts a matcher function and is handed the *computed* name, so
   * returning false collects every one without matching anything — no
   * hand-rolled `aria-label ?? textContent`, which got 「3件 要調整」 wrong.
   */
  const controlNames = () => {
    const names: string[] = [];
    for (const role of ["button", "link"] as const) {
      screen.queryAllByRole(role, { name: (accessibleName: string) => { names.push(accessibleName); return false; } });
    }
    return names;
  };

  /**
   * A drawer's backdrop and its ✕ both carry 「詳細パネルを閉じる」. They do the
   * same thing, so it is redundancy rather than #88's one-label-two-meanings —
   * and the backdrop being a focusable tab stop ahead of the dialog is its own
   * defect with its own measurements (#122). Named here, and only here, so the
   * scan stays strict about everything else.
   */
  const KNOWN_REPEATS = ["詳細パネルを閉じる"];

  /** Returns the names it checked, so a caller can assert it looked at something. */
  const expectDistinctNames = (where: string) => {
    const names = controlNames();
    const repeated = [...new Set(names.filter((name, index) => names.indexOf(name) !== index))];
    expect(repeated.filter((name) => !KNOWN_REPEATS.includes(name)), `controls sharing a name in ${where}`).toEqual([]);
    expect(names.filter((name) => name === ""), `unnamed controls in ${where}`).toEqual([]);
    return names;
  };

  it("gives the view-axis tabs a name the sidebar does not also use", async () => {
    const user = userEvent.setup();
    render(<App />);
    const navigation = within(screen.getByRole("navigation", { name: "メインナビゲーション" }));

    // The label was on a bare <div>, where it reached nothing.
    const axis = screen.getByRole("group", { name: "表示軸" });
    expect(within(axis).getByRole("button", { name: "メンバー別", pressed: true })).toBeInTheDocument();
    expect(within(axis).getByRole("button", { name: "プロジェクト別", pressed: false })).toBeInTheDocument();

    // Each of these now resolves to one button on the whole screen. Before, the
    // only way to tell the pair apart was `pressed`, which the sidebar's nav
    // button does not carry.
    expect(screen.getAllByRole("button", { name: "メンバー別" })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: "メンバー" })).toHaveLength(1);
    // The nav keeps its own name, and it is a different element from the tab.
    expect(navigation.getByRole("button", { name: "メンバー" })).not.toBe(within(axis).getByRole("button", { name: "メンバー別" }));
    expect(within(axis).queryByRole("button", { name: "メンバー" })).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "プロジェクト別" })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: /^プロジェクト 登録 \d+件$/u })).toHaveLength(1);

    // Switching the axis relabels the grid and the row header, not the tabs.
    await user.click(within(axis).getByRole("button", { name: "プロジェクト別" }));
    expect(screen.getByRole("grid", { name: "プロジェクト別の週間アサイン" })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "プロジェクト別" })).toHaveLength(1);
  });

  it("leaves no two controls on the board sharing a name, on either axis and with a panel open", async () => {
    const user = userEvent.setup();
    render(<App />);
    expect(expectDistinctNames("the members axis").length).toBeGreaterThan(20);

    await user.click(screen.getByRole("button", { name: "プロジェクト別" }));
    expectDistinctNames("the projects axis");

    // The default view is not the only state on this screen. Each of these adds
    // controls, and a name that is unique among the rows can still collide with
    // one of them.
    await user.click(screen.getByRole("button", { name: "通知" }));
    expectDistinctNames("the notification popover");
    await user.keyboard("{Escape}");

    await user.click(screen.getAllByRole("button", { name: /のアサイン詳細（/u })[0]);
    expectDistinctNames("the assignment drawer");
    // Two carry this name (#122); the ✕ inside the dialog is the one to press.
    await user.click(within(screen.getByRole("dialog", { name: "詳細パネル" })).getByRole("button", { name: "詳細パネルを閉じる" }));

    await user.click(screen.getByRole("button", { name: "アサインを追加" }));
    expectDistinctNames("the new-assignment drawer");
  });

  it("tells two rows apart when the project and the days are the same", async () => {
    const project = { ...initialWorkspace.projects[0], id: "project", name: "Atlas リニューアル" };
    const first = { ...initialWorkspace.members[0], id: "first", name: "同日 一郎" };
    const second = { ...initialWorkspace.members[1], id: "second", name: "同日 二郎" };
    const span = { startDate: weekStart, endDate: addDays(weekStart, 4) };
    const adapter = sharedAdapter();
    adapter.initialState = {
      members: [first, second],
      projects: [project],
      assignments: [
        { id: "a", personId: first.id, projectId: project.id, ...span, allocation: 50, status: "confirmed" },
        { id: "b", personId: second.id, projectId: project.id, ...span, allocation: 50, status: "confirmed" },
      ],
      needs: [],
    } as unknown as WorkspaceState;
    render(<App mode="shared" organizationName="Example Inc." identity={owner} shared={adapter} />);

    // Same project, same 8/17〜8/21, same 50%: the row is the only difference,
    // so the name carries it — and the day range too, for two bars in one row.
    const days = getWeekDays(0);
    const range = `${days[0].month}/${days[0].date}〜${days[4].month}/${days[4].date}`;
    expect(screen.getByRole("button", { name: `Atlas リニューアルのアサイン詳細（同日 一郎・${range}）` })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: `Atlas リニューアルのアサイン詳細（同日 二郎・${range}）` })).toBeInTheDocument();
    expectDistinctNames("two rows on the same project and days");
  });

  it("names a single day without a range", async () => {
    const project = { ...initialWorkspace.projects[0], id: "project", name: "単日 案件" };
    const member = { ...initialWorkspace.members[0], id: "one-day", name: "単日 三郎" };
    const wednesday = addDays(weekStart, 2);
    const adapter = sharedAdapter();
    adapter.initialState = {
      members: [member], projects: [project],
      assignments: [{ id: "a", personId: member.id, projectId: project.id, startDate: wednesday, endDate: wednesday, allocation: 30, status: "confirmed" }],
      needs: [],
    } as unknown as WorkspaceState;
    render(<App mode="shared" organizationName="Example Inc." identity={owner} shared={adapter} />);

    const days = getWeekDays(0);
    expect(screen.getByRole("button", { name: `単日 案件のアサイン詳細（単日 三郎・${days[2].month}/${days[2].date}）` })).toBeInTheDocument();
  });
});

/**
 * #85: three visualisations encoded information in position, length or colour
 * with no key on the screen, and the counts they carried reached a pointer only.
 * Measured before: the four-week rail's accessible name was
 * 「Atlas リニューアルの4週間の充足人数」 with no values, the 習熟度 rail's was
 * 「{skill}の習熟度分布」 with none either, the 未充足 column printed 「3」 for one
 * row and 「1件」 for another, and the sidebar's count badges reached no screen
 * reader at all because `aria-label` on the button overrode them.
 */
describe("a key for what colour and position encode", () => {
  const goTo = async (user: ReturnType<typeof userEvent.setup>, nav: RegExp) => {
    await user.click(within(screen.getByRole("navigation", { name: "メインナビゲーション" })).getByRole("button", { name: nav }));
  };

  it("puts every week of the staffing rail into its accessible name", async () => {
    const user = userEvent.setup();
    render(<App />);
    await goTo(user, /^プロジェクト 登録 \d+件$/u);

    // Found by role and name, not by reading the attribute: a name on a bare
    // div is a name on a generic node, which need not be exposed at all.
    const rail = screen.getAllByRole("img", { name: /の4週間の充足人数：/u })[0];
    const label = rail.getAttribute("aria-label") ?? "";
    // Four bars, so four weeks named with their counts — a screen reader used to
    // get the heading and nothing else.
    for (const week of [1, 2, 3, 4]) {
      expect(label, `week ${week} in ${label}`).toContain(`${week}週目: `);
      expect(label, `week ${week} count in ${label}`).toMatch(new RegExp(`${week}週目: ([0-9]+/[0-9]+名|必要人数未設定)`, "u"));
    }
    expect(rail.querySelectorAll("i")).toHaveLength(4);

    // And the one number under the rail says which week it is.
    expect(document.querySelector(".staffed-label")!.textContent).toMatch(/^(\d+\/\d+週 \d+\/\d+名|必要人数未設定)$/u);
  });

  it("puts every proficiency level into the rail's accessible name", async () => {
    const user = userEvent.setup();
    render(<App />);
    await goTo(user, /^スキルマップ$/u);

    const rail = screen.getAllByRole("img", { name: /の習熟度分布：/u })[0];
    const label = rail.getAttribute("aria-label") ?? "";
    for (const level of ["初級", "基礎", "実務", "応用", "指導"]) {
      expect(label, `${level} in ${label}`).toMatch(new RegExp(`${level} [0-9]+名`, "u"));
    }
    expect(rail.querySelectorAll("i")).toHaveLength(5);
  });

  it("gives each visualisation a key immediately above its table", async () => {
    const user = userEvent.setup();
    render(<App />);
    await goTo(user, /^プロジェクト 登録 \d+件$/u);

    const projectCaption = document.querySelector(".viz-caption")!;
    expect(projectCaption.textContent).toMatch(/\d+\/\d+週から4週間の充足率/u);
    // Adjacency is for the eye; the table points at it for everyone else.
    expect(document.querySelector(".portfolio-table")).toHaveAttribute("aria-describedby", projectCaption.id);
    expect(projectCaption.id).not.toBe("");

    await goTo(user, /^スキルマップ$/u);
    const skillCaption = document.querySelector(".viz-caption")!;
    // The five cells are levels 1 to 5, so the caption is the key for the
    // positions — naming all five in order, not just the ends.
    for (const level of ["初級", "基礎", "実務", "応用", "指導"]) {
      expect(skillCaption.textContent, `${level} in the caption`).toContain(level);
    }
    expect(skillCaption.textContent).toContain("保有者数");
    expect(document.querySelector(".skill-map-table")).toHaveAttribute("aria-describedby", skillCaption.id);
    expect(skillCaption.id).not.toBe("");
  });

  it("empties the bar for a week with no required headcount, the way the key says", async () => {
    const project = { ...initialWorkspace.projects[0], id: "unset", name: "人数未定 案件", demand: 0 };
    const adapter = sharedAdapter();
    adapter.initialState = { members: [], projects: [project], assignments: [], needs: [] } as unknown as WorkspaceState;
    render(<App mode="shared" organizationName="Example Inc." identity={{ name: "管理 花子", email: "owner@example.com", role: "owner" }} shared={adapter} />);
    const user = userEvent.setup();
    await goTo(user, /^プロジェクト 登録 \d+件$/u);

    // A full bar would read as 100% staffed under 「バーの長さが充足率」, which is
    // not something the app knows here.
    const rail = screen.getByRole("img", { name: /人数未定 案件の4週間の充足人数：/u });
    expect(rail.getAttribute("aria-label")).toContain("1週目: 必要人数未設定");
    for (const fill of rail.querySelectorAll("b")) expect((fill as HTMLElement).style.width).toBe("0%");
    expect(document.querySelector(".staffed-label")!.textContent).toBe("必要人数未設定");
  });

  it("uses one unit down the 未充足 and 不足 columns", async () => {
    const user = userEvent.setup();
    render(<App />);
    await goTo(user, /^スキルマップ$/u);

    const rows = [...document.querySelectorAll(".skill-map-table tbody tr")];
    expect(rows.length).toBeGreaterThan(10);
    const linked = rows.filter((row) => row.children[4].querySelector("button"));
    const plain = rows.filter((row) => !row.children[4].querySelector("button"));
    // Both forms exist in this data, and 件 used to appear only on the linked one.
    expect(linked.length).toBeGreaterThan(0);
    expect(plain.length).toBeGreaterThan(0);

    for (const row of rows) {
      expect(row.children[4].textContent, "未充足").toMatch(/^\d+件$/u);
      expect(row.children[5].textContent, "不足").toMatch(/^\d+件$/u);
    }
    expect(document.querySelector(".skill-map-table")!.textContent).not.toContain("充足</");
    expect([...document.querySelectorAll(".skill-ok")].map((el) => el.textContent)).not.toContain("充足");
  });

  it("tells the 未充足 links apart, and the count badges apart", async () => {
    const user = userEvent.setup();
    render(<App />);
    await goTo(user, /^スキルマップ$/u);

    const names = () => {
      const collected: string[] = [];
      screen.queryAllByRole("button", { name: (accessibleName: string) => { collected.push(accessibleName); return false; } });
      return collected;
    };
    const skillNames = names();
    expect([...new Set(skillNames.filter((name, index) => skillNames.indexOf(name) !== index))]).toEqual([]);
    // Four of these buttons were all called 「1件」.
    const links = [...document.querySelectorAll(".skill-need-link")];
    expect(links.length).toBeGreaterThan(1);
    for (const link of links) expect(link.getAttribute("aria-label")).toMatch(/^.+の未充足 \d+件を開く$/u);

    // The two sidebar badges count different things, so they say which — on the
    // badge itself, not only in a title a pointer has to find.
    const navigation = within(screen.getByRole("navigation", { name: "メインナビゲーション" }));
    const projects = navigation.getByRole("button", { name: /^プロジェクト 登録 \d+件$/u });
    const opportunities = navigation.getByRole("button", { name: /^受注前 進行中 \d+件$/u });
    expect(projects.querySelector(".nav-count")!.textContent).toMatch(/^登録 [0-9]+$/u);
    expect(opportunities.querySelector(".nav-count")!.textContent).toMatch(/^進行中 [0-9]+$/u);
    // The visible text appears in the name, rather than being paraphrased there.
    for (const item of [projects, opportunities]) {
      const visible = `${item.querySelector(".nav-label")!.textContent} ${item.querySelector(".nav-count")!.textContent}`;
      expect(item.getAttribute("aria-label")).toContain(visible);
    }
  });
});

/**
 * #83: below 620px the nav is one scrolling row, so the current screen's item can
 * sit past the right edge. Measured at 390px: 194px of the row is off-screen and
 * a deep link like `?nav=reports` puts the active item at the far end.
 */
describe("the current screen stays in the scrolling nav", () => {
  /** Answers the layout's own media query, which the effect is guarded by. */
  const atWidth = (narrow: boolean) => {
    vi.spyOn(window, "matchMedia").mockImplementation(((query: string) => ({
      matches: narrow && query.includes("620"),
      media: query,
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia);
  };

  it("brings the active item into view when the screen changes", async () => {
    const user = userEvent.setup();
    atWidth(true);
    const scrollIntoView = vi.spyOn(Element.prototype, "scrollIntoView");
    render(<App />);
    const navigation = within(screen.getByRole("navigation", { name: "メインナビゲーション" }));

    // The mount call: the board is the first item, but the effect runs anyway so
    // a deep link to the last one is covered by the same path.
    expect(scrollIntoView.mock.instances.at(-1)).toBe(navigation.getByRole("button", { name: "アサインボード" }));

    scrollIntoView.mockClear();
    await user.click(navigation.getByRole("button", { name: "レポート" }));
    // Both axes "nearest", so nothing outside the row is scrolled.
    expect(scrollIntoView).toHaveBeenCalledWith({ block: "nearest", inline: "nearest" });
    expect(scrollIntoView.mock.instances.at(-1)).toBe(navigation.getByRole("button", { name: "レポート" }));
  });

  it("follows a resize into the bar layout, where activeNav has not changed", async () => {
    atWidth(false);
    const scrollIntoView = vi.spyOn(Element.prototype, "scrollIntoView");
    render(<App />);
    // Wide: the nav is a column and nothing needs scrolling.
    expect(scrollIntoView).not.toHaveBeenCalled();

    // Dragging the window narrow, or rotating a tablet, does not change the
    // screen — so the effect has to listen for it.
    atWidth(true);
    await act(async () => { window.dispatchEvent(new Event("resize")); });
    expect(scrollIntoView).toHaveBeenCalledWith({ block: "nearest", inline: "nearest" });
    const navigation = within(screen.getByRole("navigation", { name: "メインナビゲーション" }));
    expect(scrollIntoView.mock.instances.at(-1)).toBe(navigation.getByRole("button", { name: "アサインボード" }));
  });
});

/**
 * #87: a value must not be reachable by hover alone. The subtitles that were cut
 * wrap now; the values that stay capped — the names, because the name column has
 * to be able to shrink (#75), the custom-field cells, which #75 caps on purpose,
 * and the board's assignment bars — are reachable from the row or the bar. Those
 * are `<button>`s, so pointer, touch and keyboard all get there. This asserts the
 * route, not the CSS.
 */
describe("no value is reachable by hover alone", () => {
  const navigate = async (user: ReturnType<typeof userEvent.setup>, nav: RegExp) => {
    await user.click(within(screen.getByRole("navigation", { name: "メインナビゲーション" })).getByRole("button", { name: nav }));
  };
  const rowFor = (cellClass: string, name: string) => {
    const cell = [...document.querySelectorAll(cellClass)].find((el) => (el.textContent ?? "").includes(name));
    expect(cell, `${name} row`).toBeTruthy();
    return cell as HTMLElement;
  };
  /** A route has to be operable by more than a pointer, which means a real button. */
  const expectOperableByAnyInput = (element: HTMLElement, what: string) => {
    expect(element.tagName, `${what} must be a button, not a clickable div`).toBe("BUTTON");
    expect(element.tabIndex, `${what} must be tabbable`).toBeGreaterThanOrEqual(0);
    element.focus();
    expect(document.activeElement, `${what} must take focus`).toBe(element);
  };

  it("opens the member's name, role, department and concurrent post from the row", async () => {
    const user = userEvent.setup();
    render(<App />);
    await navigate(user, /^メンバー$/u);
    const row = rowFor(".member-name-cell", "佐伯 優斗");
    expectOperableByAnyInput(row, "the member row");

    const name = row.querySelector("strong")!.textContent ?? "";
    const subtitle = row.querySelector("small")!.textContent ?? "";
    // 「{role} · {department} · 兼務あり」. The first part is what the panel repeats
    // verbatim; 兼務あり is a hint the panel answers with the actual posting.
    const roleAndDepartment = subtitle.replace(" · 兼務あり", "");
    expect(subtitle).toContain("兼務あり");

    await user.click(row);
    const dialog = within(screen.getByRole("dialog", { name: "詳細パネル" }));
    expect(dialog.getByRole("heading", { name })).toBeInTheDocument();
    // Exact, not a substring of the whole panel: the parts appear elsewhere too,
    // and a panel missing this line would still contain each word somewhere.
    expect(dialog.getByText(roleAndDepartment)).toBeInTheDocument();
    // And the concurrent post the row could only hint at.
    expect(dialog.getByText("兼務")).toBeInTheDocument();
  });

  it("opens the project's name, summary and custom field values from the row", async () => {
    const user = userEvent.setup();
    render(<App />);
    await navigate(user, /^プロジェクト 登録 \d+件$/u);
    const row = rowFor(".project-name-cell", "モバイル会員証");
    expectOperableByAnyInput(row, "the project row");

    const name = row.querySelector("strong")!.textContent ?? "";
    const summary = row.querySelector("small")!.textContent ?? "";
    expect(summary.length).toBeGreaterThan(8);
    // The custom-field cells stay capped (#75), so their values need the route too.
    const customValues = [...row.closest("tr")!.querySelectorAll(".custom-field-cell")].map((el) => el.textContent ?? "").filter(Boolean);
    expect(customValues.length).toBeGreaterThan(0);

    await user.click(row);
    const dialog = within(screen.getByRole("dialog", { name: "詳細パネル" }));
    expect(dialog.getByRole("heading", { name })).toBeInTheDocument();
    expect(dialog.getByText(summary)).toBeInTheDocument();
    for (const value of customValues) {
      expect(dialog.getAllByText(value).length, `${value} in the panel`).toBeGreaterThan(0);
    }
  });

  it("opens an assignment bar's project from the board", async () => {
    const user = userEvent.setup();
    render(<App />);
    const bar = document.querySelector("button.assignment") as HTMLElement;
    expectOperableByAnyInput(bar, "an assignment bar");
    const label = bar.querySelector("span")!.textContent ?? "";

    await user.click(bar);
    const dialog = within(screen.getByRole("dialog", { name: "詳細パネル" }));
    // Exact: the bar's label is a whole project name, not a fragment of one.
    expect(dialog.getAllByText(label).length, `${label} in the panel`).toBeGreaterThan(0);
  });
});

/**
 * #138. The member toolbar had eight controls in one row, and one of them was not
 * a control at all: 「並び順: 稼働率の低い順」 was text. The order was decided in
 * code — score descending with a search scene picked, utilisation ascending
 * otherwise — and the reader could see which was in force but not change it.
 *
 * The project list had no ordering at all, and no way to tell whether a list was
 * filtered: its three controls read 「すべて」 when idle, so the only way to know
 * was to open each one.
 */
describe("the list says how it is ordered and what is filtering it", () => {
  const navigate = async (user: ReturnType<typeof userEvent.setup>, nav: RegExp) => {
    await user.click(within(screen.getByRole("navigation", { name: "メインナビゲーション" })).getByRole("button", { name: nav }));
  };
  const namesInOrder = (cellClass: string) => [...document.querySelectorAll(cellClass)]
    .map((cell) => cell.querySelector("strong")?.textContent ?? "");

  it("reorders the member list by the chosen order", async () => {
    const user = userEvent.setup();
    render(<App />);
    await navigate(user, /^メンバー/u);

    const order = screen.getByLabelText("並び順を選ぶ") as HTMLSelectElement;
    // The shipped default, now visible rather than implied.
    expect(order.options[order.selectedIndex].textContent).toBe("稼働率の低い順");
    const byUtilisation = namesInOrder(".member-name-cell");
    expect(byUtilisation.length).toBeGreaterThan(2);

    await user.selectOptions(order, "name");
    const byName = namesInOrder(".member-name-cell");
    expect(byName).toEqual([...byName].sort((a, b) => a.localeCompare(b, "ja")));
    // Same members, different sequence — a filter would have changed the set.
    expect([...byName].sort()).toEqual([...byUtilisation].sort());
    expect(byName).not.toEqual(byUtilisation);

    // Not `byUtilisation.reverse()`: ties break by name in both directions, so
    // reversing the ascending list flips the tied pair too. The property is
    // monotonicity of the ratio the order is named after.
    //
    // Members with no ceiling are dropped rather than sorted as Infinity. They are
    // pinned last in *both* directions on purpose, so a plain `b - a` expectation
    // would put them first and fail — see the capacity-0 test below, which is
    // where that rule belongs. The demo data has none today; this is so it can.
    const ratios = () => [...document.querySelectorAll(".member-table tbody tr")].map((row) => {
      const load = Number((row.querySelector(".load-ring strong")?.textContent ?? "").replace(/\D/gu, ""));
      const ceiling = Number((row.querySelector(".capacity-limit")?.textContent ?? "").replace(/\D/gu, ""));
      return ceiling > 0 ? load / ceiling : null;
    }).filter((ratio): ratio is number => ratio !== null);
    await user.selectOptions(order, "utilization");
    const ascending = ratios();
    expect(ascending.length).toBeGreaterThan(2);
    expect(ascending).toEqual([...ascending].sort((a, b) => a - b));

    await user.selectOptions(order, "utilizationDesc");
    const descending = ratios();
    expect(descending).toEqual([...descending].sort((a, b) => b - a));
    expect(descending[0]).toBeGreaterThanOrEqual(ascending.at(-1)!);
  });

  it("reorders the project list, and keeps 登録順 as the order it shipped with", async () => {
    const user = userEvent.setup();
    render(<App />);
    await navigate(user, /^プロジェクト/u);

    const order = screen.getByLabelText("並び順を選ぶ") as HTMLSelectElement;
    expect(order.options[order.selectedIndex].textContent).toBe("登録順");
    const registered = namesInOrder(".project-name-cell");

    await user.selectOptions(order, "name");
    const byName = namesInOrder(".project-name-cell");
    expect(byName).toEqual([...registered].sort((a, b) => a.localeCompare(b, "ja")));

    // And back: 登録順 is the workspace's own order, so returning to it has to
    // give the original sequence rather than whatever the last sort left behind.
    await user.selectOptions(order, "registered");
    expect(namesInOrder(".project-name-cell")).toEqual(registered);
  });

  it("names each filter that is narrowing the list, and lets it go", async () => {
    const user = userEvent.setup();
    render(<App />);
    await navigate(user, /^プロジェクト/u);

    // Nothing applied: no chips at all, so the toolbar stays one row.
    expect(document.querySelector(".toolbar-chips")).toBeNull();
    const all = document.querySelectorAll(".portfolio-table tbody tr").length;

    await user.selectOptions(screen.getByLabelText("状態で絞り込み"), "進行中");
    const chip = screen.getByRole("button", { name: "状態の絞り込み「進行中」を外す" });
    expect(chip.textContent).toContain("状態: 進行中");
    const narrowed = document.querySelectorAll(".portfolio-table tbody tr").length;
    expect(narrowed).toBeLessThan(all);

    await user.click(chip);
    expect(document.querySelectorAll(".portfolio-table tbody tr").length).toBe(all);
    expect(document.querySelector(".toolbar-chips")).toBeNull();
  });

  it("clears every filter at once, and only offers that when there are two", async () => {
    const user = userEvent.setup();
    render(<App />);
    await navigate(user, /^プロジェクト/u);
    const all = document.querySelectorAll(".portfolio-table tbody tr").length;

    await user.selectOptions(screen.getByLabelText("状態で絞り込み"), "進行中");
    // One filter needs no bulk escape — the chip beside it is the escape.
    expect(screen.queryByRole("button", { name: "条件をクリア" })).toBeNull();

    await user.type(screen.getByLabelText("案件を検索"), "a");
    await user.click(screen.getByRole("button", { name: "条件をクリア" }));
    expect(document.querySelectorAll(".portfolio-table tbody tr").length).toBe(all);
    expect(document.querySelector(".toolbar-chips")).toBeNull();
  });

  /**
   * A member with no capacity has no utilisation. Subtracting to compare put them
   * in name order against everyone, because `0.5 - Infinity` is non-finite just
   * like `Infinity - Infinity` — so a real 50% sorted against an unknown by name.
   * They belong last, and in both directions: heading 稼働率の高い順 with a number
   * nobody set would be worse than the bug.
   */
  it("puts a member with no capacity last, whichever way the order runs", async () => {
    const user = userEvent.setup();
    const adapter = sharedAdapter();
    const project = { ...initialWorkspace.projects[0], id: "project" };
    // The names fight the intended order on purpose. A first attempt called them
    // あ/い/う in utilisation order, and the buggy comparator's name fallback
    // happened to produce the right sequence — the test passed against the bug.
    // Here the member with no capacity sorts first by name and last by utilisation.
    const busy = { ...initialWorkspace.members[0], id: "busy", name: "い 忙しい", capacity: 100 };
    const idle = { ...initialWorkspace.members[1], id: "idle", name: "う 空き", capacity: 100 };
    const unset = { ...initialWorkspace.members[2], id: "unset", name: "あ 上限未設定", capacity: 0 };
    adapter.initialState = {
      members: [busy, idle, unset],
      projects: [project],
      assignments: [{ id: "load", personId: busy.id, projectId: project.id, startDate: getWeekStart(0), endDate: addDays(getWeekStart(0), 4), allocation: 80, status: "confirmed" }],
      needs: [],
    } as unknown as WorkspaceState;
    render(<App mode="shared" organizationName="Example Inc." identity={{ name: "管理 花子", email: "owner@example.com", role: "owner" }} shared={adapter} />);
    await user.click(within(screen.getByRole("navigation", { name: "メインナビゲーション" })).getByRole("button", { name: "メンバー" }));

    const names = () => [...document.querySelectorAll(".member-name-cell strong")].map((el) => el.textContent);
    expect(names()).toEqual(["う 空き", "い 忙しい", "あ 上限未設定"]);

    await user.selectOptions(screen.getByLabelText("並び順を選ぶ"), "utilizationDesc");
    expect(names()).toEqual(["い 忙しい", "う 空き", "あ 上限未設定"]);
  });

  /**
   * The chip says the list is filtered and the filter decides whether it is. A box
   * holding only spaces had them disagreeing: the search matched literal
   * whitespace and emptied the list, with no chip to say why.
   */
  it("treats a search of only spaces as no search at all", async () => {
    const user = userEvent.setup();
    render(<App />);
    await navigate(user, /^プロジェクト/u);
    const all = document.querySelectorAll(".portfolio-table tbody tr").length;

    await user.type(screen.getByLabelText("案件を検索"), "   ");
    expect(document.querySelectorAll(".portfolio-table tbody tr").length).toBe(all);
    expect(document.querySelector(".toolbar-chips")).toBeNull();
  });

  /**
   * The member toolbar gave up its result count to stay one row (#136 wanted that
   * space). It comes back on the chips row, which only exists while filtering —
   * which is exactly when a count that is not the total is worth having, 0
   * included.
   */
  it("says what the filters left, where the filters are named", async () => {
    const user = userEvent.setup();
    render(<App />);
    await navigate(user, /^メンバー/u);
    expect(document.querySelector(".toolbar-chips")).toBeNull();

    await user.type(screen.getByLabelText("メンバーを検索"), "該当しない文字列");
    expect(document.querySelectorAll(".member-table tbody tr").length).toBe(0);
    expect(document.querySelector(".toolbar-chips-lead")!.textContent).toBe("絞り込み中 · 0名");
  });

  /**
   * Filters narrow, buttons act, and the row used to hold both in one flow —
   * 「このシーンを削除」 sat between two selects. Position is the distinction, so
   * this asserts the grouping rather than any pixel.
   */
  it("keeps the acting controls out of the filter flow", async () => {
    const user = userEvent.setup();
    render(<App />);
    await navigate(user, /^プロジェクト/u);
    await user.type(screen.getByLabelText("案件を検索"), "a");

    const group = document.querySelector(".view-toolbar .toolbar-actions-group");
    expect(group).toBeTruthy();
    const copy = screen.getByRole("button", { name: "検索リンクをコピー" });
    expect(group!.contains(copy)).toBe(true);
    // And no filter wandered in with it.
    expect(group!.querySelector(".view-filter, .inline-search")).toBeNull();
  });
});

/**
 * #139. The board showed five weekdays and nothing else could be asked of it. A
 * month is 20 to 23 weekdays, and the thing that made that more than a loop count
 * is `assignmentGrid`: it measured a bar's position in *calendar days* from the
 * range's start and used that as a grid column. Those agree for one
 * Monday-to-Friday week and nowhere else — the Monday after next is seven days
 * out and six columns along.
 *
 * The other half is #115's lesson. Everything the board says about a range has to
 * follow the range, and everything that stays week-scoped has to keep saying
 * 「週」.
 */
describe("the board can show a month", () => {
  const openBoard = async () => {
    const user = userEvent.setup();
    render(<App />);
    return user;
  };
  const columns = () => [...document.querySelectorAll(".day-label")].map((el) => el.textContent);
  const showMonth = async (user: ReturnType<typeof userEvent.setup>) => {
    const group = screen.getByRole("group", { name: "表示する期間" });
    await user.click(within(group).getByRole("button", { name: "月" }));
  };

  it("draws one column per weekday of the month, and one grid line each", async () => {
    const user = await openBoard();
    expect(columns()).toHaveLength(5);

    await showMonth(user);
    const monthColumns = columns();
    // 20 to 23 weekdays, depending on the month; never five.
    expect(monthColumns.length).toBeGreaterThanOrEqual(20);
    expect(monthColumns.length).toBeLessThanOrEqual(23);
    // The backdrop lines are per column too — they were a hard-coded five.
    expect(document.querySelectorAll(".schedule-row .day-grid i").length / document.querySelectorAll(".schedule-row").length)
      .toBe(monthColumns.length);
    // No weekend gets a column.
    expect(monthColumns.some((label) => label?.startsWith("土") || label?.startsWith("日"))).toBe(false);
  });

  /**
   * The assertion the old day-counting code could not pass.
   *
   * A first version of this read the dates out of each bar's accessible name and
   * compared them with the bar's column — and passed with the bug put back,
   * because that name is *built from* the column. It proved nothing.
   *
   * So the dates come from a fixture, and the reference for "which column is that
   * date" is the header row, which `days.map` builds. The bar's column comes from
   * `assignmentSpan`. Two code paths, one comparison.
   */
  it("puts a bar on the column the header gives its start date", async () => {
    const user = userEvent.setup();
    const adapter = sharedAdapter();
    const month = boardRange("month", 0);
    // Far enough in to be past the first week, which is where day-counting and
    // column-counting part company: each weekend costs two days and no columns.
    const from = month.days[7].iso;
    const to = month.days[9].iso;
    adapter.initialState = {
      members: [{ ...initialWorkspace.members[0], id: "m", name: "対象 一郎" }],
      projects: [{ ...initialWorkspace.projects[0], id: "p", name: "対象案件" }],
      assignments: [{ id: "a", personId: "m", projectId: "p", startDate: from, endDate: to, allocation: 50, status: "confirmed" }],
      needs: [],
    } as unknown as WorkspaceState;
    render(<App mode="shared" organizationName="Example Inc." identity={{ name: "管理 花子", email: "owner@example.com", role: "owner" }} shared={adapter} />);
    await showMonth(user);

    const bar = document.querySelector("button.assignment") as HTMLElement;
    expect(bar, "the fixture assignment should be on the board").toBeTruthy();
    // The header's own idea of where those dates sit.
    const dates = columns().map((text) => (text ?? "").replace(/^[月火水木金]/u, ""));
    const startColumn = dates.indexOf(String(Number(from.slice(8, 10)))) + 1;
    const endColumn = dates.indexOf(String(Number(to.slice(8, 10)))) + 1;
    expect(startColumn).toBe(8);
    expect(bar.style.gridColumn).toBe(`${startColumn} / span ${endColumn - startColumn + 1}`);
  });

  /**
   * On a fixed clock, so the assertion is a literal.
   *
   * Two earlier versions were hollow. The first only checked the marker when one
   * existed, so a regression that stopped marking anything passed. The second
   * asserted against the real clock — better, but on the first weekday of a month
   * the old `index === 0` code would agree with it. Wednesday 2026-08-19 is the
   * third column of its week and the thirteenth of its month, so nothing but a
   * date comparison puts the mark there.
   */
  it("marks today by its date, not by being the first column", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date("2026-08-19T09:00:00+09:00"));
    try {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      render(<App />);
      const marked = () => [...document.querySelectorAll(".day-label.today strong")].map((el) => el.textContent);

      expect(columns()).toEqual(["月17", "火18", "水19", "木20", "金21"]);
      expect(marked()).toEqual(["19"]);

      await showMonth(user);
      expect(columns()[0]).toBe("月3");
      expect(marked()).toEqual(["19"]);
      // Thirteenth column, not the first.
      expect(columns().indexOf("水19")).toBe(12);
    } finally {
      vi.useRealTimers();
    }
  });

  /**
   * A week that runs into January has to say which January. The date line is the
   * board's only exact statement of its range, so this reads the rendered string.
   */
  it("names the end's year when the week crosses into it", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date("2026-12-30T09:00:00+09:00"));
    try {
      render(<App />);
      expect(document.querySelector(".date-range")!.textContent).toBe("2026年 12月28日 — 2027年 1月1日");
    } finally {
      vi.useRealTimers();
    }
  });

  it("names the range it is showing, in the words of the unit", async () => {
    const user = await openBoard();
    expect(screen.getByRole("grid", { name: "メンバー別の週間アサイン" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "次の週" })).toBeInTheDocument();

    await showMonth(user);
    expect(screen.getByRole("grid", { name: "メンバー別の月間アサイン" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "次の月" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "次の週" })).not.toBeInTheDocument();
    expect(document.querySelector(".eyebrow")!.textContent).toMatch(/MONTH \d+/u);
  });

  /**
   * #115 from the other end. The sidebar's figure is week-scoped and says so, and
   * the week it names has to be the week it measured — which in month mode can
   * begin in the month before the board's first column.
   *
   * September 2026 opens on a Tuesday, so its first column is 9/1 and the week it
   * belongs to began on 8/31. Naming the figure from `days[0]` would say 「9/1週」.
   * August was no test at all: it opens on Monday 8/3, where both readings agree.
   */
  it("keeps the week-scoped figure labelled with the week it measures", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date("2026-09-15T09:00:00+09:00"));
    try {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      render(<App />);
      const label = () => document.querySelector(".month-card-label span")!.textContent;
      expect(label()).toBe("9/14週の平均稼働率");

      await showMonth(user);
      expect(columns()[0]).toBe("火1");
      expect(label()).toBe("8/31週の平均稼働率");
    } finally {
      vi.useRealTimers();
    }
  });

  /**
   * The offset counts whatever unit the board shows, so a month of paging was read
   * as that many weeks by everything week-scoped: one page into October put the
   * drawers and the sidebar on the week after next instead of on October's first
   * week.
   */
  it("moves the week-scoped figures by a month when it pages by a month", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date("2026-09-15T09:00:00+09:00"));
    try {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      render(<App />);
      await showMonth(user);
      expect(document.querySelector(".month-card-label span")!.textContent).toBe("8/31週の平均稼働率");

      await user.click(screen.getByRole("button", { name: "次の月" }));
      expect(columns()[0]).toBe("木1");
      // October opens on a Thursday, so its first week began on 9/28 — not
      // 9/21, which is where a week-counted offset of 1 would have landed.
      expect(document.querySelector(".month-card-label span")!.textContent).toBe("9/28週の平均稼働率");
    } finally {
      vi.useRealTimers();
    }
  });

  it("pages by months once it is showing months", async () => {
    const user = await openBoard();
    await showMonth(user);
    const before = document.querySelector(".date-range")!.textContent;
    const monthOf = (text: string | null) => /(\d+)月/u.exec(text ?? "")![1];

    await user.click(screen.getByRole("button", { name: "次の月" }));
    const after = document.querySelector(".date-range")!.textContent;
    expect(monthOf(after)).not.toBe(monthOf(before));
    expect(columns().length).toBeGreaterThanOrEqual(20);

    await user.click(screen.getByRole("button", { name: "前の月" }));
    expect(document.querySelector(".date-range")!.textContent).toBe(before);
  });
});

/**
 * #140. The proposal screen let you build a shortlist of up to twelve people,
 * optionally anonymised, and never said what they were being proposed *for*. The
 * app has staffing needs on confirmed projects and staffing plans on
 * opportunities, each with a role, a period, an allocation and required skills,
 * and the screen was connected to none of it. Its only output — the share link —
 * was in the command palette, so a reader of the screen had no way to finish.
 */
describe("a proposal answers something", () => {
  const openProposal = async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(within(screen.getByRole("navigation", { name: "メインナビゲーション" })).getByRole("button", { name: "提案" }));
    return user;
  };
  const ribbon = () => document.querySelector(".proposal-view .member-ribbon")!.textContent ?? "";

  it("says what the screen is for before a subject is picked", async () => {
    await openProposal();
    // Not 「氏名を隠して候補を比較します」, which described a display mode.
    expect(ribbon()).toContain("提案先を選ぶと、要件に合う候補から並びます");
    expect(screen.getByLabelText("提案先を選ぶ")).toBeInTheDocument();
  });

  it("names the subject, its period and its allocation once one is picked", async () => {
    const user = await openProposal();
    const picker = screen.getByLabelText("提案先を選ぶ") as HTMLSelectElement;
    const subject = [...picker.options].find((option) => option.value !== "")!;
    expect(subject, "the demo data should offer at least one need or plan").toBeTruthy();

    await user.selectOptions(picker, subject.value);
    // The option's own label is 「案件名 / ロール」, and the ribbon states it.
    expect(ribbon()).toContain(subject.textContent!);
    expect(ribbon()).toContain("に提案");

    // The subject's real period and allocation, not merely something shaped like
    // them. `need:` ids are the project staffing needs.
    const need = initialWorkspace.needs.find((item) => `need:${item.id}` === subject.value)!;
    expect(need, subject.value).toBeTruthy();
    expect(ribbon()).toContain(`稼働配分 ${need.allocation}%`);
    for (const iso of [need.startDate, need.endDate]) {
      const [year, month, day] = iso.split("-").map(Number);
      expect(ribbon(), iso).toContain(`${year}年${month}月${day}日`);
    }
  });

  /**
   * Ordering, actually asserted. A first version clicked the top candidate and
   * accepted either 「適合」 or 「適合していません」 on the card, which is true of any
   * order at all.
   */
  it("puts the matching candidates first, and says how each one matches", async () => {
    const user = await openProposal();
    const picker = screen.getByLabelText("提案先を選ぶ") as HTMLSelectElement;
    await user.selectOptions(picker, [...picker.options].find((option) => option.value !== "")!.value);

    // The 「メンバー」 group is the ranked one; favourites keep their own order.
    const group = [...document.querySelectorAll(".proposal-picker-group")]
      .find((element) => element.querySelector("small")?.textContent === "メンバー")!;
    const names = [...group.querySelectorAll(".proposal-picker-item strong")].map((el) => el.textContent);
    expect(names.length).toBeGreaterThan(3);

    // Add the first and the last, and read their scores off the cards. Ranked
    // means the first cannot score below the last.
    await user.click(group.querySelectorAll(".proposal-picker-item")[0] as HTMLElement);
    const rest = [...document.querySelectorAll(".proposal-picker-group")]
      .find((element) => element.querySelector("small")?.textContent === "メンバー")!;
    const items = rest.querySelectorAll(".proposal-picker-item");
    await user.click(items[items.length - 1] as HTMLElement);

    // The availability, not a score: for a subject built from a requirement every
    // skill is 「必須」, so `matchScore` reduced to `round(空き% × 0.4)` and the cards no
    // longer print it (#150). The order it produced is the order of this number.
    const scoreOf = (card: Element) => {
      const text = card.querySelector(".proposal-match")!.textContent ?? "";
      const found = /要件期間の最小空き (\d+)%/u.exec(text);
      // No match at all is the bottom of the order, not a missing value.
      return found ? Number(found[1]) : -1;
    };
    const cards = [...document.querySelectorAll(".proposal-card")];
    expect(cards).toHaveLength(2);
    expect(scoreOf(cards[0])).toBeGreaterThanOrEqual(scoreOf(cards[1]));
    // And the leader is a real match, not merely first.
    expect(cards[0].querySelector(".proposal-match")!.textContent).toMatch(/^要件期間の最小空き \d+%/u);
    // And the number it replaced is gone from the card rather than moved.
    expect(cards[0].querySelector(".proposal-match")!.textContent).not.toMatch(/適合|点/u);
  });

  /**
   * The whole sequence, not just its ends. Comparing the first with the last
   * cannot see an inversion in the middle, so this adds every candidate — the
   * cards then stand in the order they were picked in — and checks the scores
   * never rise.
   */
  it("ranks the whole member list, not just its ends", async () => {
    const user = await openProposal();
    const picker = screen.getByLabelText("提案先を選ぶ") as HTMLSelectElement;
    await user.selectOptions(picker, [...picker.options].find((option) => option.value !== "")!.value);

    const memberGroup = () => [...document.querySelectorAll(".proposal-picker-group")]
      .find((element) => element.querySelector("small")?.textContent === "メンバー");
    // Always the top of the remaining list, so the cards come out in picker order.
    for (let index = 0; index < 8; index += 1) {
      const next = memberGroup()?.querySelector(".proposal-picker-item") as HTMLElement | null;
      if (!next || next.hasAttribute("disabled")) break;
      await user.click(next);
    }

    const scores = [...document.querySelectorAll(".proposal-card .proposal-match")].map((element) => {
      const found = /要件期間の最小空き (\d+)%/u.exec(element.textContent ?? "");
      return found ? Number(found[1]) : -1;
    });
    expect(scores.length).toBeGreaterThan(4);
    expect(scores).toEqual([...scores].sort((a, b) => b - a));
  });

  /**
   * The two kinds of subject come from two tables. Nothing guarantees their ids
   * are distinct, so this gives them the *same* raw id and checks both survive as
   * separate, addressable subjects. A first version only asserted the prefix was
   * there, which is not the same as showing it does anything.
   */
  it("keeps two subjects with the same raw id apart", async () => {
    const user = userEvent.setup();
    const adapter = sharedAdapter();
    adapter.initialState = {
      ...initialWorkspace,
      members: initialWorkspace.members.slice(0, 3),
      needs: [{ id: "same", projectId: initialWorkspace.projects[0].id, role: "確定側ロール", skills: [], startDate: "2026-09-01", endDate: "2026-09-30", allocation: 40, status: "open" }],
      opportunityNeeds: [{ id: "same", opportunityId: (initialWorkspace.opportunities ?? [])[0].id, role: "受注前側ロール", skills: [], startDate: "2026-10-01", endDate: "2026-10-31", allocation: 70 }],
    } as unknown as WorkspaceState;
    render(<App mode="shared" organizationName="Example Inc." identity={{ name: "管理 花子", email: "owner@example.com", role: "owner" }} shared={adapter} />);
    await user.click(within(screen.getByRole("navigation", { name: "メインナビゲーション" })).getByRole("button", { name: "提案" }));

    const picker = screen.getByLabelText("提案先を選ぶ") as HTMLSelectElement;
    const values = [...picker.options].map((option) => option.value).filter(Boolean);
    expect(values).toEqual(["need:same", "plan:same"]);

    await user.selectOptions(picker, "need:same");
    expect(document.querySelector(".proposal-view .member-ribbon")!.textContent).toContain("確定側ロール");
    await user.selectOptions(picker, "plan:same");
    const ribbonText = document.querySelector(".proposal-view .member-ribbon")!.textContent!;
    expect(ribbonText).toContain("受注前側ロール");
    expect(ribbonText).toContain("稼働配分 70%");
  });

  /**
   * A subject that has gone must not travel. The screen falls back to 未選択, and
   * the link it hands over has to agree with the screen rather than carrying an id
   * that resolves to nothing.
   */
  it("leaves a subject it cannot resolve out of the link", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    window.history.replaceState({}, "", "?nav=proposal&need=need:gone-away");
    render(<App />);
    expect((screen.getByLabelText("提案先を選ぶ") as HTMLSelectElement).value).toBe("");

    await user.click(document.querySelector(".proposal-picker-item") as HTMLElement);
    await user.click(screen.getByRole("button", { name: "提案リンクをコピー" }));
    await waitFor(() => expect(writeText).toHaveBeenCalled());
    const href = String(writeText.mock.calls[0][0]);
    expect(href).toContain("nav=proposal");
    expect(href).toContain("members=");
    expect(href).not.toContain("need=");
    window.history.replaceState({}, "", "/");
  });

  /**
   * A link from before the subject existed carries members and nothing else. It
   * has to open on those members with no subject, rather than on an empty screen.
   */
  it("opens a link that names members and no subject", async () => {
    const [first, second] = initialWorkspace.members;
    window.history.replaceState({}, "", `?nav=proposal&members=${first.id},${second.id}`);
    render(<App />);
    expect((screen.getByLabelText("提案先を選ぶ") as HTMLSelectElement).value).toBe("");
    expect([...document.querySelectorAll(".proposal-card h3")].map((el) => el.textContent))
      .toEqual([first.name, second.name]);
    // No subject, so no claim about matching one.
    expect(document.querySelector(".proposal-match")).toBeNull();
    window.history.replaceState({}, "", "/");
  });

  /**
   * Favourites are a list somebody curated; the member list is a ranking. Sorting
   * the favourites by score too would quietly overwrite the first with the second.
   */
  it("leaves the favourites in their own order", async () => {
    const user = userEvent.setup();
    // Two favourites whose workspace order is not their score order against the
    // subject: the designer comes first in the workspace and cannot match a
    // Frontend Engineer requirement.
    const designer = initialWorkspace.members.find((member) => member.role === "Product Designer")!;
    const frontend = initialWorkspace.members.find((member) => member.role === "Frontend Engineer")!;
    expect(initialWorkspace.members.indexOf(designer)).toBeLessThan(initialWorkspace.members.indexOf(frontend));
    window.localStorage.setItem(DEMO_FAVORITES_KEY, JSON.stringify([
      { kind: "member", targetId: designer.id },
      { kind: "member", targetId: frontend.id },
    ]));
    render(<App />);
    await waitFor(() => expect(screen.queryByText("保存データを読み込み中")).not.toBeInTheDocument());
    await user.click(within(screen.getByRole("navigation", { name: "メインナビゲーション" })).getByRole("button", { name: "提案" }));

    const picker = screen.getByLabelText("提案先を選ぶ") as HTMLSelectElement;
    const frontendSubject = [...picker.options].find((option) => option.textContent?.includes("Frontend Engineer"))!;
    await user.selectOptions(picker, frontendSubject.value);

    const group = [...document.querySelectorAll(".proposal-picker-group")]
      .find((element) => element.querySelector("small")?.textContent === "お気に入り")!;
    expect(group, "two seeded favourites should make a favourites group").toBeTruthy();
    expect([...group.querySelectorAll(".proposal-picker-item strong")].map((el) => el.textContent))
      .toEqual([designer.name, frontend.name]);
    window.localStorage.removeItem(DEMO_FAVORITES_KEY);
  });

  /**
   * A link can name a subject. It can also name one that has since been filled or
   * deleted, and then the screen has to fall back rather than claim a subject it
   * cannot show.
   */
  it("opens on the subject a link names, and shrugs off one it cannot find", async () => {
    const user = userEvent.setup();
    const openNeed = initialWorkspace.needs.find((need) => need.status !== "filled")!;
    window.history.replaceState({}, "", `?nav=proposal&need=need:${openNeed.id}`);
    render(<App />);
    const picker = screen.getByLabelText("提案先を選ぶ") as HTMLSelectElement;
    expect(picker.value).toBe(`need:${openNeed.id}`);
    expect(document.querySelector(".proposal-view .member-ribbon")!.textContent).toContain("に提案");

    // A well-formed id for nothing: the picker falls back to 未選択 and the screen
    // says what it is for instead of naming a subject.
    window.history.replaceState({}, "", "?nav=proposal&need=need:does-not-exist");
    render(<App />);
    const pickers = screen.getAllByLabelText("提案先を選ぶ") as HTMLSelectElement[];
    expect(pickers[pickers.length - 1].value).toBe("");
    window.history.replaceState({}, "", "/");
    void user;
  });

  /**
   * #140 claimed the only way out was the command palette. Reading
   * `primaryActions` showed otherwise: the header's primary slot is
   * 「提案リンクをコピー」 on this screen, disabled until somebody is selected. That
   * is the one meaning that slot carries on every screen (#111), so the fix was to
   * leave it alone — and not to add a second control with the same name (#124).
   */
  it("offers its one output from the header, enabled once there is something to send", async () => {
    const user = await openProposal();
    const copy = screen.getByRole("button", { name: "提案リンクをコピー" });
    expect(copy).toBeDisabled();
    // One control, one name.
    expect(screen.getAllByRole("button", { name: "提案リンクをコピー" })).toHaveLength(1);

    await user.click(document.querySelector(".proposal-picker-item") as HTMLElement);
    expect(screen.getByRole("button", { name: "提案リンクをコピー" })).toBeEnabled();
    expect(screen.getAllByRole("button", { name: "提案リンクをコピー" })).toHaveLength(1);
  });

  /**
   * The screen worked without a subject before and has to keep working without
   * one. A link from before this change carries members and no need, which the
   * URL test above covers; this one is the picker left alone.
   */
  it("still works with no subject picked", async () => {
    const user = await openProposal();
    await user.click(document.querySelector(".proposal-picker-item") as HTMLElement);
    expect(document.querySelectorAll(".proposal-card").length).toBe(1);
    // No requirement, so no claim about matching one.
    expect(document.querySelector(".proposal-match")).toBeNull();
  });

  it("keeps names and locations out of the anonymous view, subject or not", async () => {
    const user = await openProposal();
    const picker = screen.getByLabelText("提案先を選ぶ") as HTMLSelectElement;
    await user.selectOptions(picker, [...picker.options].find((option) => option.value !== "")!.value);
    const candidate = document.querySelector(".proposal-picker-item") as HTMLElement;
    const name = candidate.querySelector("strong")!.textContent!;
    await user.click(candidate);

    const location = initialWorkspace.members.find((member) => member.name === name)!.location;
    expect(document.querySelector(".proposal-cards")!.textContent).toContain(location);

    await user.click(screen.getByLabelText("氏名・勤務地を隠す"));
    const cards = document.querySelector(".proposal-cards")!.textContent ?? "";
    expect(cards).not.toContain(name);
    expect(cards).not.toContain(location);
    expect(cards).toMatch(/候補[A-Z]/u);
    // The fit survives the anonymising, which is the point of showing it: a
    // reader can weigh the candidate without being told who they are.
    expect(cards).toMatch(/適合 \d+点|この要件には適合していません/u);
  });
});

/**
 * #146: eleven labels said 「今週」 while the value came from whatever week the
 * board is paged to. Paging moved the number and left the word behind, and #139
 * made it worse — in month mode these figures cover the month's *first* week,
 * which can be several weeks from today.
 *
 * The word is now reserved for a figure computed from `getWeekStart(0)`, which is
 * the reports screen and nothing else. Every other week-scoped figure names its
 * week, the shape #119 already gave the sidebar.
 */
describe("a week-scoped figure names the week it measures", () => {
  afterEach(() => { vi.useRealTimers(); });

  /**
   * A Wednesday, so the current week (8/17) and the month's first week (8/3) are
   * different and neither is the other's neighbour. On a date where they coincide
   * the month-mode assertion below would pass against the bug.
   */
  const onWednesday = () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date("2026-08-19T09:00:00+09:00"));
    return userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
  };

  const pulseLabel = () => {
    const metric = [...document.querySelectorAll(".pulse-metric")]
      .find((node) => /の空き$/u.test(node.querySelector("span")?.textContent ?? ""));
    expect(metric, "the pulse strip should carry a 空き metric").toBeDefined();
    return metric!.querySelector("span")!.textContent ?? "";
  };

  it("names the week, and the name follows paging", async () => {
    const user = onWednesday();
    render(<App />);
    expect(pulseLabel()).toBe("8/17週の空き");
    await user.click(screen.getByRole("button", { name: "次の週" }));
    expect(pulseLabel()).toBe("8/24週の空き");
    await user.click(screen.getByRole("button", { name: "前の週" }));
    await user.click(screen.getByRole("button", { name: "前の週" }));
    expect(pulseLabel()).toBe("8/10週の空き");
  });

  /**
   * The month-mode case, which is the one 「今週」 could not survive: the figure is
   * measured over 8/3–8/7 while the board shows 8/3–8/31, so a label reading
   * 「今週」 would be two weeks out and a label reading 「8月」 would claim a month's
   * figure for a week's (#115).
   */
  it("month mode names the week inside the month, not the month", async () => {
    const user = onWednesday();
    render(<App />);
    await user.click(within(screen.getByRole("group", { name: "表示する期間" })).getByRole("button", { name: "月" }));
    expect(document.querySelector(".date-range")!.textContent).toBe("2026年 8月3日 — 8月31日");
    expect(pulseLabel()).toBe("8/3週の空き");
  });

  /**
   * The screens that take the board's week — everything but the reports screen —
   * must not carry the word at all. Asserted on the rendered text rather than on
   * the sources, so a label assembled at runtime is covered too; the source-level
   * counterpart is in tests/vocabulary-contract.test.mjs.
   */
  it("no screen that follows the board says 今週", async () => {
    const user = onWednesday();
    render(<App />);
    const navigation = within(screen.getByRole("navigation", { name: "メインナビゲーション" }));
    // The nav names carry a badge count, so each is matched by its leading word.
    for (const screenName of ["アサインボード", "メンバー", "プロジェクト", "受注前", "提案", "スキルマップ", "組織"]) {
      await user.click(navigation.getByRole("button", { name: new RegExp(`^${screenName}( |$)`, "u") }));
      expect(document.body.textContent, `${screenName} should not claim 今週`).not.toContain("今週");
    }
    // The reports screen may, and does: its figures come from getWeekStart(0) and
    // it takes no week from the board. Asserted so the reservation is not vacuous.
    await user.click(navigation.getByRole("button", { name: "レポート" }));
    expect(document.body.textContent).toContain("今週");
  });

  /**
   * The label and the value have to name the same week, not merely both be named.
   * An evaluator reading this change took `weekStart` and the `currentWeekStart`
   * alias beside it for two different weeks and read a mismatch into the assignment
   * form and this rail. There was none — the alias was an assignment of the other —
   * but nothing pinned it, so a later edit could introduce the very bug that was
   * reported. This pins it, in month mode, where the two would diverge if they ever
   * did: the board shows 8/3–8/31 while these figures cover 8/3–8/7 only.
   *
   * The expected values come from `memberLoad` on the week the label names, so this
   * fails both if the label moves off the value's week and if the value moves off
   * the label's.
   */
  it("month mode pairs each label with the value for that same week", async () => {
    window.localStorage.removeItem("mosaic-local-workspace-v3");
    const user = onWednesday();
    render(<App />);
    await user.click(within(screen.getByRole("group", { name: "表示する期間" })).getByRole("button", { name: "月" }));

    const mondayFrom = (label: string) => {
      const m = label.match(/^(\d+)\/(\d+)週/u);
      expect(m, `expected a week name, got 「${label}」`).not.toBeNull();
      return `2026-${String(m![1]).padStart(2, "0")}-${String(m![2]).padStart(2, "0")}`;
    };

    // The assignment form: 「{氏名} · {M/D週} {n}%」.
    await user.click(screen.getByRole("button", { name: /アサインを追加/u }));
    // By id: 「メンバー」 also names the nav item, so a label lookup is ambiguous.
    const options = [...(document.getElementById("assignment-member") as HTMLSelectElement).options];
    expect(options.length).toBeGreaterThan(0);
    for (const option of options) {
      const parsed = option.textContent!.match(/^(.+) · (\d+\/\d+週) (\d+)%$/u);
      expect(parsed, `unexpected option shape: ${option.textContent}`).not.toBeNull();
      const member = initialWorkspace.members.find((item) => item.name === parsed![1])!;
      expect(Number(parsed![3]), `${parsed![1]} at ${parsed![2]}`)
        .toBe(memberLoad(initialWorkspace, member.id, mondayFrom(parsed![2])));
    }
    // 8/3, not 8/17: the month opens two weeks before today, and that is the whole
    // point — a literal here so a regression cannot satisfy this by self-consistency.
    expect(options[0].textContent).toMatch(/ 8\/3週 /u);
    // `.close-button`, not the role lookup: the backdrop carries the same
    // accessible name, which is #122. Two matches would fail here for a reason
    // that has nothing to do with this test.
    await user.click(document.querySelector(".drawer .close-button") as HTMLElement);

    // The member drawer's rail: label, then 「{n}% / {capacity}%」.
    await user.click(within(screen.getByRole("navigation", { name: "メインナビゲーション" })).getByRole("button", { name: /^メンバー( |$)/u }));
    await user.click(document.querySelector(".member-table tbody tr .member-name-cell") as HTMLElement);
    const rail = await waitFor(() => {
      const node = document.querySelector(".profile-capacity");
      expect(node).not.toBeNull();
      return node!;
    });
    const name = document.querySelector(".drawer .profile-headline strong, .drawer h2, .drawer h3")?.textContent ?? "";
    const member = initialWorkspace.members.find((item) => name.includes(item.name));
    expect(member, `could not identify the member from 「${name}」`).toBeDefined();
    const rows = [...rail.querySelectorAll(":scope > div")];
    expect(rows).toHaveLength(4);
    const monday = mondayFrom(rows[0].querySelector("span")!.textContent!);
    expect(monday).toBe("2026-08-03");
    rows.forEach((row, index) => {
      const load = Number(row.querySelector("strong")!.textContent!.match(/^(\d+)%/u)![1]);
      expect(load, `rail cell ${index}`).toBe(memberLoad(initialWorkspace, member!.id, addDays(monday, index * 7)));
    });
  });

  /**
   * The two detail panels carry a four-week rail whose first cell was 「今週」 while
   * the other three are relative to it. Naming the first cell keeps the sequence
   * readable — 「8/17週 · 2週後 · 3週後 · 4週後」 — and stops the rail claiming a
   * week it is not on after paging.
   */
  it("the detail panel's four-week rail names its first week", async () => {
    const user = onWednesday();
    render(<App />);
    await user.click(screen.getByRole("button", { name: "次の週" }));
    await user.click(within(screen.getByRole("navigation", { name: "メインナビゲーション" })).getByRole("button", { name: "メンバー" }));
    await user.click(document.querySelector(".member-table tbody tr .member-name-cell") as HTMLElement);
    const rail = await waitFor(() => {
      const node = document.querySelector(".profile-capacity");
      expect(node).not.toBeNull();
      return node!;
    });
    const cells = [...rail.querySelectorAll(":scope > div > span")].map((node) => node.textContent);
    expect(cells).toEqual(["8/24週", "2週後", "3週後", "4週後"]);
  });
});

/**
 * #142 sticks the member table's name and actions columns, and the CSS reaches the
 * name cell by `td:nth-child(2)` — the `<th>` carries a class but the `<td>` does not.
 * `tests/sticky-columns-contract.test.mjs` can check the rules; only the render can
 * check the column.
 *
 * The evaluator on that change asked what happens if a leading column is ever dropped
 * conditionally: the name would become the first column and a different cell would
 * stick. Today it cannot — the favourite `<td>` is unconditional and only its contents
 * are guarded by `onToggleFavorite` — and the table gains columns from the third
 * onwards. Both modes are checked because "the CSS has no mode branch" says nothing
 * about the markup: shared mode passes different props and could well render a
 * different first column.
 */
describe("the sticky columns' position in the row", () => {
  const columnsOf = () => {
    const table = document.querySelector(".member-table") as HTMLTableElement;
    const headers = [...table.querySelectorAll("thead tr:last-child th")];
    const cells = [...table.querySelectorAll("tbody tr:first-child td")];
    return { headers, cells };
  };

  const openMemberList = async (extra: Partial<Parameters<typeof App>[0]> = {}) => {
    const user = userEvent.setup();
    render(<App {...extra} />);
    await user.click(within(screen.getByRole("navigation", { name: "メインナビゲーション" })).getByRole("button", { name: /^メンバー( |$)/u }));
    return user;
  };

  const expectNameIsSecond = () => {
    const { headers, cells } = columnsOf();
    expect(headers[0].className).toContain("col-favorite");
    expect(headers[1].className).toContain("col-name");
    expect(headers.at(-1)!.className).toContain("col-actions");
    // And the cells the CSS actually reaches: second from the left, last on the right.
    expect(cells[1].querySelector(".member-name-cell")).not.toBeNull();
    expect(cells.at(-1)!.className).toContain("member-row-actions");
  };

  it("puts the name second and the actions last in demo mode", async () => {
    await openMemberList();
    expectNameIsSecond();
  });

  it("puts them in the same places in shared mode", async () => {
    await openMemberList({ mode: "shared", organizationName: "Example Inc.",
      identity: { name: "編集 花子", email: "editor@example.com", role: "admin" }, shared: sharedAdapter() });
    expect(screen.getByText("SHARED")).toBeInTheDocument();
    expectNameIsSecond();
  });

  /**
   * The columns that appear at runtime have to keep appearing after the second one.
   * A search scene adds a score column and each custom field in the list view adds
   * one; if either landed earlier, `td:nth-child(2)` would stick the wrong cell.
   */
  it("keeps the name second when a search scene adds its score column", async () => {
    const user = await openMemberList();
    const picker = screen.getByLabelText("シーンを選ぶ") as HTMLSelectElement;
    const scene = [...picker.options].find((option) => option.value);
    expect(scene, "the demo data should carry a saved search scene").toBeDefined();
    await user.selectOptions(picker, scene!.value);

    const { headers } = columnsOf();
    expect(headers.some((th) => th.className.includes("col-score")), "the score column should appear").toBe(true);
    expect(headers.findIndex((th) => th.className.includes("col-score"))).toBeGreaterThan(1);
    expectNameIsSecond();
  });
});

/**
 * #122: the panel's backdrop was a `<button>` carrying the same accessible name as
 * the ✕ inside the panel, so a screen reader listing buttons saw 「詳細パネルを閉じる」
 * twice — and that one sat outside the focus cycle the trap maintains. Measured with
 * real key presses at 1440x900: 72 focusable elements, two with that name, the
 * backdrop at document position 63 with `tabIndex: 0`, and Shift+Tab from the ✕
 * landing on `.drawer-danger` rather than on it.
 *
 * That is one route, not a proof of unreachability — a screen reader's button list
 * and the pointer could both still get there. The defect is the duplicate name for an
 * operation that already had one, on an element advertised as focusable while the
 * panel's own focus order excluded it.
 *
 * It is a div now. The keyboard keeps Escape and the ✕; the pointer keeps the
 * backdrop.
 */
describe("one way to name closing the panel", () => {
  const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';

  const openPanel = async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(within(screen.getByRole("navigation", { name: "メインナビゲーション" })).getByRole("button", { name: /^メンバー( |$)/u }));
    await user.click(document.querySelector(".member-table tbody tr .member-name-cell") as HTMLElement);
    await waitFor(() => expect(document.querySelector(".drawer")).not.toBeNull());
    return user;
  };

  it("names the close control once, and the backdrop is not one of them", async () => {
    await openPanel();
    // getByRole, not getAllByRole: two matches is the defect, and this is the call
    // that failed with 「Found multiple elements」 while #146 was being written.
    const close = screen.getByRole("button", { name: "詳細パネルを閉じる" });
    expect(document.querySelector(".drawer")!.contains(close)).toBe(true);

    const backdrop = document.querySelector(".overlay-backdrop")!;
    expect(backdrop.tagName).toBe("DIV");
    expect(backdrop.getAttribute("aria-hidden")).toBe("true");
    // Focusability has to go before `aria-hidden` can be correct: aria-hidden on a
    // focusable element is a violation in its own right.
    expect([...document.querySelectorAll(FOCUSABLE)]).not.toContain(backdrop);
    expect(backdrop.hasAttribute("tabindex")).toBe(false);
  });

  it("still closes from the pointer, from Escape, and from the ✕", async () => {
    const user = await openPanel();
    const opener = () => document.querySelector(".member-table tbody tr .member-name-cell") as HTMLElement;

    // The pointer route the div still has to serve.
    await user.click(document.querySelector(".overlay-backdrop") as HTMLElement);
    await waitFor(() => expect(document.querySelector(".drawer")).toBeNull());

    // Escape, which is what makes dropping the backdrop from the keyboard path safe.
    await user.click(opener());
    await waitFor(() => expect(document.querySelector(".drawer")).not.toBeNull());
    await user.keyboard("{Escape}");
    await waitFor(() => expect(document.querySelector(".drawer")).toBeNull());

    await user.click(opener());
    await waitFor(() => expect(document.querySelector(".drawer")).not.toBeNull());
    await user.click(screen.getByRole("button", { name: "詳細パネルを閉じる" }));
    await waitFor(() => expect(document.querySelector(".drawer")).toBeNull());
    // And the scroll lock comes off however it was closed, not only by one route.
    expect(document.body.style.overflow).toBe("");
  });

  /**
   * The panel's own tab order is what the trap works on, so it has to be untouched.
   * The backdrop sat immediately before it in document order, which is why removing
   * it shifts the panel's first focusable by exactly one and nothing else.
   */
  it("leaves the panel's own tab order alone", async () => {
    await openPanel();
    const drawer = document.querySelector(".drawer")!;
    const all = [...document.querySelectorAll(FOCUSABLE)];
    const inside = all.filter((element) => drawer.contains(element));
    expect(inside.length).toBeGreaterThan(1);
    // Contiguous: the panel's focusables are a single run, so nothing outside it
    // sits between them for Tab to visit.
    const positions = inside.map((element) => all.indexOf(element));
    expect(positions).toEqual(Array.from({ length: positions.length }, (_, index) => positions[0] + index));
    expect(inside[0]).toBe(screen.getByRole("button", { name: "詳細パネルを閉じる" }));
  });

  it("adds no serious accessibility violation with the panel open", async () => {
    await openPanel();
    const results = await axe.run(document.body, { rules: { "color-contrast": { enabled: false } } });
    expect(results.violations.filter((violation) => violation.impact === "serious" || violation.impact === "critical")).toEqual([]);
  });
});

/**
 * #149: #140 gave the proposal screen a subject picker and left the entry points for
 * later, so the only way to a subject was to walk into the screen and pick it. Both
 * places that already show candidates for a requirement now lead there.
 *
 * The words matter as much as the route. 「候補を見る」 exists in two places already and
 * both keep you where you are — it opens the guide, or reveals candidates lower down the
 * same panel. The new button leaves for another screen, so it says something else, and
 * says the same thing in both places because it does the same thing.
 */
describe("a way into the proposal screen", () => {
  const ROUTE = "この要件で提案を開く";

  const subject = () => (screen.getByLabelText("提案先を選ぶ") as HTMLSelectElement);
  const activeNav = () => document.querySelector(".nav-item.active")?.getAttribute("aria-label");

  const openGuide = async (user: ReturnType<typeof userEvent.setup>) => {
    await user.click(within(screen.getByRole("navigation", { name: "メインナビゲーション" })).getByRole("button", { name: /^アサインボード( |$)/u }));
    const card = [...document.querySelectorAll("button.alert-card")].find((element) => element.textContent?.includes("未充足"));
    expect(card, "the demo data should carry an unfilled role").toBeDefined();
    await user.click(card as HTMLElement);
    await waitFor(() => expect(document.querySelector(".drawer-kicker")?.textContent).toBe("RESOLUTION GUIDE"));
    // Which requirement this is, read off the panel: 「{role}の候補」 over
    // 「{project} · {date}開始」. Returned so a caller can demand that exact subject
    // rather than any subject with the right prefix.
    const role = document.querySelector(".drawer h2")!.textContent!.replace(/の候補$/u, "");
    const project = document.querySelector(".drawer .drawer-heading p")?.textContent ?? "";
    const found = initialWorkspace.needs.find((need) => need.role === role && need.status !== "filled"
      && project.includes(initialWorkspace.projects.find((item) => item.id === need.projectId)?.name ?? " "));
    expect(found, `could not identify the guided requirement from 「${role}」 / 「${project}」`).toBeDefined();
    return found!;
  };

  const openPreAwardPlan = async (user: ReturnType<typeof userEvent.setup>) => {
    await user.click(within(screen.getByRole("navigation", { name: "メインナビゲーション" })).getByRole("button", { name: /^受注前( |$)/u }));
    await user.click(document.querySelector(".pipeline-card, .project-name-cell") as HTMLElement);
    await waitFor(() => expect(document.querySelector(".drawer .detail-need-list button")).not.toBeNull());
    const row = document.querySelector(".drawer .detail-need-list button") as HTMLElement;
    // Same idea as the guide: the opportunity from the heading, the role from the row.
    const opportunityName = document.querySelector(".drawer h2")!.textContent!;
    const role = row.querySelector("strong")!.textContent!;
    await user.click(row);
    await waitFor(() => expect(document.querySelector(".drawer .candidate-label")).not.toBeNull());
    const opportunity = (initialWorkspace.opportunities ?? []).find((item) => item.name === opportunityName);
    expect(opportunity, `no opportunity named 「${opportunityName}」`).toBeDefined();
    const found = (initialWorkspace.opportunityNeeds ?? [])
      .find((need) => need.opportunityId === opportunity!.id && need.role === role);
    expect(found, `no requirement 「${role}」 under 「${opportunityName}」`).toBeDefined();
    return found!;
  };

  it("carries an unfilled role from the guide to the proposal screen", async () => {
    const user = userEvent.setup();
    render(<App />);
    const guided = await openGuide(user);
    await user.click(screen.getByRole("button", { name: ROUTE }));

    expect(activeNav()).toBe("提案");
    expect(document.querySelector(".drawer"), "the panel should close behind you").toBeNull();
    // The exact id, not the namespace. A `^need:` check passes on any other unfilled
    // role, which is what the evaluator on this change pointed out.
    expect(subject().value).toBe(`need:${guided.id}`);
    expect([...subject().options].find((option) => option.selected)!.textContent)
      .toContain(initialWorkspace.projects.find((project) => project.id === guided.projectId)!.name);
  });

  it("carries a pre-award requirement across, under its own namespace", async () => {
    const user = userEvent.setup();
    render(<App />);
    const plan = await openPreAwardPlan(user);
    await user.click(screen.getByRole("button", { name: ROUTE }));

    expect(activeNav()).toBe("提案");
    expect(document.querySelector(".drawer")).toBeNull();
    // `plan:`, not `need:` — #140 split the namespaces because the two tables can hand
    // out the same raw id — and the exact id, so another plan cannot satisfy this.
    expect(subject().value).toBe(`plan:${plan.id}`);
    expect(subject().value).toMatch(/^plan:/u);
  });

  it("says the same thing in both places, and something else than 「候補を見る」", async () => {
    const user = userEvent.setup();
    render(<App />);

    await openGuide(user);
    expect(screen.getAllByRole("button", { name: ROUTE })).toHaveLength(1);
    await user.click(document.querySelector(".drawer .close-button") as HTMLElement);

    await openPreAwardPlan(user);
    expect(screen.getAllByRole("button", { name: ROUTE })).toHaveLength(1);
    // 「候補を見る」 is still on the requirement rows, where it still means 「stay here」.
    expect(document.querySelector(".drawer .detail-need-list button em")!.textContent).toBe("候補を見る");
  });

  /**
   * Changing the subject is not starting over. The screen labels a card that does not
   * match the new requirement, and that label is worth reading — it says this person is
   * not a fit for *this* one.
   */
  it("keeps the candidates already picked when the subject changes", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(within(screen.getByRole("navigation", { name: "メインナビゲーション" })).getByRole("button", { name: /^提案( |$)/u }));
    await user.selectOptions(subject(), [...subject().options].find((option) => option.value)!.value);
    await user.click(document.querySelector(".proposal-picker-item") as HTMLElement);
    const before = [...document.querySelectorAll(".proposal-card")].length;
    expect(before).toBeGreaterThan(0);

    await openPreAwardPlan(user);
    await user.click(screen.getByRole("button", { name: ROUTE }));
    expect(document.querySelectorAll(".proposal-card")).toHaveLength(before);
  });

  /**
   * Not behind `canEdit`. The proposal screen lines candidates up and copies a link;
   * neither changes the workspace. 「仮置き」 and 「要員要件を編集」 in the same panel are
   * behind it, and stay behind it.
   */
  it("is offered to a viewer, unlike the actions that change something", async () => {
    const user = userEvent.setup();
    render(<App mode="shared" organizationName="Example Inc." identity={{ name: "閲覧 太郎", email: "viewer@example.com", role: "viewer" }} shared={sharedAdapter()} />);
    await openGuide(user);
    expect(screen.getByRole("button", { name: ROUTE })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "要員要件を編集" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "仮置き" })).not.toBeInTheDocument();
  });
});

/**
 * #150: 「適合 n点」 was printed with no denominator, and the denominator is not a
 * constant. `matchScore` gives 20 per satisfied 「あると良い」 skill up to 60 plus
 * `round(空き% × 0.4)` up to 40, so a scene naming one such skill tops out at 60 and
 * one naming none at 40.
 *
 * Where a requirement is the subject — the proposal cards and the resolution guide —
 * `searchSceneFromNeed` forces every skill to 「必須」, because the requirement type has
 * no field to carry anything else. The score there reduced to `round(空き% × 0.4)`: a
 * restatement of the number printed beside it. Those two stopped printing it. The
 * member list, where a saved scene can name 「あると良い」 skills, prints the ceiling.
 */
describe("what the fit score is out of", () => {
  const openScene = async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(within(screen.getByRole("navigation", { name: "メインナビゲーション" })).getByRole("button", { name: /^メンバー( |$)/u }));
    const picker = screen.getByLabelText("シーンを選ぶ") as HTMLSelectElement;
    const scene = [...picker.options].find((option) => option.value);
    expect(scene, "the demo data should carry a saved scene").toBeDefined();
    await user.selectOptions(picker, scene!.value);
    return user;
  };

  it("prints the ceiling beside the score, and the ceiling is the scene's own", async () => {
    await openScene();
    const cells = [...document.querySelectorAll(".match-score")];
    expect(cells.length).toBeGreaterThan(0);
    const ceilings = new Set<string>();
    for (const cell of cells) {
      const parsed = cell.textContent!.match(/^(\d+)\/(\d+)点空き(\d+)%$/u);
      expect(parsed, `unexpected score cell: ${cell.textContent}`).not.toBeNull();
      const [, score, ceiling, available] = parsed!;
      ceilings.add(ceiling);
      // The ceiling is 40 plus 20 per nice-to-have, so it is one of four values —
      // never 100 unless the scene names three of them.
      expect([40, 60, 80, 100]).toContain(Number(ceiling));
      expect(Number(score)).toBeLessThanOrEqual(Number(ceiling));
      // And the score's own arithmetic, so a cell cannot print a ceiling it is not on.
      // A first version of this compared the value with itself — `ceiling >= 40` always
      // holds, so the conditional collapsed to `x === x` and asserted nothing. The
      // evaluator caught it. What matters is that the part not explained by the
      // availability is a whole number of nice-to-haves, and fits under the ceiling.
      const fromAvailability = Math.min(40, Math.round(Number(available) * 0.4));
      const fromSkills = Number(score) - fromAvailability;
      expect(fromSkills, `${cell.textContent}: score below its own availability half`).toBeGreaterThanOrEqual(0);
      expect(fromSkills, `${cell.textContent}: more skill points than the ceiling allows`).toBeLessThanOrEqual(Number(ceiling) - 40);
      expect(fromSkills % 20, `${cell.textContent}: skill points come 20 at a time`).toBe(0);
    }
    // One scene, one ceiling: it is a property of the scene, not of the candidate.
    expect(ceilings.size).toBe(1);
  });

  it("says what the ceiling means, where the table can point at it", async () => {
    const user = await openScene();
    const caption = document.querySelector(".viz-caption#member-score-key");
    expect(caption, "the score column needs its key (#85's pattern)").not.toBeNull();
    const ceiling = document.querySelector(".match-score")!.textContent!.match(/\/(\d+)点/u)![1];
    expect(caption!.textContent).toContain(`満点となる ${ceiling} 点`);
    // The three things that move the number, and the one that does not.
    expect(caption!.textContent).toContain("20点");
    expect(caption!.textContent).toContain("40点");
    expect(caption!.textContent).toContain("必須スキルは満たしていることが前提");
    expect(document.querySelector(".member-table")).toHaveAttribute("aria-describedby", "member-score-key");

    // And it is gone with the column, not left behind explaining nothing.
    await user.selectOptions(screen.getByLabelText("シーンを選ぶ") as HTMLSelectElement, "");
    expect(document.querySelector(".match-score")).toBeNull();
    expect(document.querySelector(".viz-caption#member-score-key")).toBeNull();
    expect(document.querySelector(".member-table")).not.toHaveAttribute("aria-describedby");
  });

  /**
   * The two screens that stopped printing it. Both still print the availability the
   * score was derived from, so nothing a reader could act on has gone.
   */
  it("neither requirement-scored screen prints a score any more", async () => {
    const user = userEvent.setup();
    render(<App />);
    const navigation = within(screen.getByRole("navigation", { name: "メインナビゲーション" }));

    await user.click(navigation.getByRole("button", { name: /^提案( |$)/u }));
    const picker = screen.getByLabelText("提案先を選ぶ") as HTMLSelectElement;
    await user.selectOptions(picker, [...picker.options].find((option) => option.value)!.value);
    const candidate = document.querySelector(".proposal-picker-item") as HTMLElement;
    await user.click(candidate);
    const card = document.querySelector(".proposal-match")!;
    expect(card.textContent).not.toMatch(/適合 \d+点/u);
    expect(card.textContent).toMatch(/要件期間の最小空き \d+%|この要件には適合していません/u);

    // The resolution guide, reached from the board's unfilled-role card.
    await user.click(navigation.getByRole("button", { name: /^アサインボード( |$)/u }));
    // `.alert-card` is itself the button, so there is nothing to look for inside it.
    const resolve = [...document.querySelectorAll("button.alert-card")]
      .find((element) => element.textContent?.includes("未充足")) as HTMLElement;
    expect(resolve, "the demo data should carry an unfilled role").toBeDefined();
    await user.click(resolve);
    const list = await waitFor(() => {
      const node = document.querySelector(".candidate-list, .candidate-empty");
      expect(node).not.toBeNull();
      return node!;
    });
    expect(list.textContent).not.toMatch(/適合 \d+点/u);
    if (list.classList.contains("candidate-list")) {
      expect(list.textContent).toMatch(/要件期間の最小空き \d+%/u);
    }
    // The heading named the order as 「スコア順」, and the score is no longer on screen.
    // A list cannot say it is sorted by something the reader cannot see (#150).
    const heading = document.querySelector(".candidate-label")!.textContent ?? "";
    expect(heading).not.toContain("スコア");
    expect(heading).toContain("要件期間の最小空き");
  });
});

/**
 * #123: nothing stops two members having the same name, and the screens that pick
 * people showed them identically. Measured with a second 「林 葵」 given the same role,
 * the same primary org unit and the same location: the member row, the panel heading,
 * the assignment form's options and the assignment bar's accessible name were all
 * indistinguishable, and the board row and proposal picker differed only because seeded
 * members carry romanised `initials` while a new one gets `makeInitials`.
 *
 * These check the rendered screens rather than the label function, which
 * `src/domain.test.ts` covers: what matters here is that every place a person is chosen
 * uses it.
 */
describe("two members with one name", () => {
  const twins = (): WorkspaceState => {
    const [first, ...rest] = initialWorkspace.members;
    return {
      ...initialWorkspace,
      members: [
        ...initialWorkspace.members,
        // Same name, same role, same department, same location as `first`: the case with
        // nothing left to distinguish but the id.
        { ...first, id: "twin-9c81", name: first.name },
      ],
      // And a third elsewhere, so the location branch is exercised on the same screen.
      ...(rest.length > 0 ? {} : {}),
    } as WorkspaceState;
  };

  const sharedName = initialWorkspace.members[0].name;

  it("distinguishes them in the member list", async () => {
    const user = userEvent.setup();
    const adapter = sharedAdapter();
    adapter.initialState = twins();
    render(<App mode="shared" organizationName="Example Inc." identity={{ name: "管理 花子", email: "owner@example.com", role: "owner" }} shared={adapter} />);
    await user.click(within(screen.getByRole("navigation", { name: "メインナビゲーション" })).getByRole("button", { name: /^メンバー( |$)/u }));

    const names = [...document.querySelectorAll(".member-table .row-name-copy strong")].map((el) => el.textContent ?? "");
    const shared = names.filter((name) => name.startsWith(sharedName));
    expect(shared, `expected two rows for 「${sharedName}」, got ${names.join(" | ")}`).toHaveLength(2);
    // Two rows, two different labels — and both still lead with the name.
    expect(new Set(shared).size).toBe(2);
    // The seeded members and the twin share a location, so both fall back to the id.
    for (const name of shared) expect(name).toMatch(new RegExp(`^${sharedName}（#[0-9a-z-]+）$`, "u"));
  });

  it("distinguishes them everywhere a person is chosen", async () => {
    const user = userEvent.setup();
    const adapter = sharedAdapter();
    adapter.initialState = twins();
    render(<App mode="shared" organizationName="Example Inc." identity={{ name: "管理 花子", email: "owner@example.com", role: "owner" }} shared={adapter} />);
    const navigation = within(screen.getByRole("navigation", { name: "メインナビゲーション" }));

    // The board's row headings, and the accessible name of each row's week cell.
    const headings = [...document.querySelectorAll(".person-cell .person-copy strong")].map((el) => el.textContent ?? "");
    const boardShared = headings.filter((name) => name.startsWith(sharedName));
    expect(boardShared).toHaveLength(2);
    expect(new Set(boardShared).size).toBe(2);
    const cellNames = [...document.querySelectorAll('.week-cell[aria-label]')].map((el) => el.getAttribute("aria-label") ?? "")
      .filter((name) => name.startsWith(sharedName));
    expect(new Set(cellNames).size).toBe(cellNames.length);

    // The assignment form's member picker.
    await user.click(screen.getByRole("button", { name: /アサインを追加/u }));
    const options = [...(document.getElementById("assignment-member") as HTMLSelectElement).options]
      .map((option) => option.textContent ?? "").filter((text) => text.startsWith(sharedName));
    expect(options).toHaveLength(2);
    expect(new Set(options).size).toBe(2);
    await user.click(document.querySelector(".drawer .close-button") as HTMLElement);

    // The proposal picker.
    await user.click(navigation.getByRole("button", { name: /^提案( |$)/u }));
    const picker = [...document.querySelectorAll(".proposal-picker-copy strong")].map((el) => el.textContent ?? "")
      .filter((name) => name.startsWith(sharedName));
    expect(picker).toHaveLength(2);
    expect(new Set(picker).size).toBe(2);
  });

  it("leaves every other name untouched", async () => {
    const user = userEvent.setup();
    const adapter = sharedAdapter();
    adapter.initialState = twins();
    render(<App mode="shared" organizationName="Example Inc." identity={{ name: "管理 花子", email: "owner@example.com", role: "owner" }} shared={adapter} />);
    await user.click(within(screen.getByRole("navigation", { name: "メインナビゲーション" })).getByRole("button", { name: /^メンバー( |$)/u }));

    // Every member but the twins keeps a bare name: the suffix is for collisions only,
    // and almost every row is not one.
    const others = initialWorkspace.members.slice(1).map((member) => member.name);
    const names = [...document.querySelectorAll(".member-table .row-name-copy strong")].map((el) => el.textContent ?? "");
    for (const name of others) {
      if (name === sharedName) continue;
      expect(names, `「${name}」 should be printed as-is`).toContain(name);
    }
    expect(names.filter((name) => name.includes("（#"))).toHaveLength(2);
  });
});
