import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { afterEach, describe, expect, it, vi } from "vitest";
import App, { type SharedWorkspaceAdapter } from "./App";
import { DEMO_FAVORITES_KEY } from "./collaboration";
import { addDays, getWeekDays, getWeekStart, initialWorkspace, memberDailyLoads, type WorkspaceState } from "./domain";
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
      // `nav` is anchored at both ends because these labels carry a count badge.
      { nav: /^プロジェクト\d*$/u, action: /^プロジェクトを追加$/u },
      { nav: /^受注前\d*$/u, action: /^受注前案件を追加$/u },
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

    await user.click(navigation.getByRole("button", { name: "プロジェクト" }));
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

    await user.click(navigation.getByRole("button", { name: "プロジェクト" }));
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

    expect(screen.getByRole("heading", { name: "今週のチーム編成" })).toBeInTheDocument();
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

    await user.click(navigation.getByRole("button", { name: "プロジェクト" }));
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
    await user.click(navigation.getByRole("button", { name: "プロジェクト" }));
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

    await user.click(navigation.getByRole("button", { name: "プロジェクト" }));
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

    await user.click(navigation.getByRole("button", { name: "プロジェクト" }));
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
    await user.click(navigation.getByRole("button", { name: "プロジェクト" }));
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

    await user.click(navigation.getByRole("button", { name: "プロジェクト" }));
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

    await user.click(navigation.getByRole("button", { name: "プロジェクト" }));
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

    await user.click(navigation.getByRole("button", { name: "プロジェクト" }));
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

    await user.click(navigation.getByRole("button", { name: "受注前" }));
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
    await user.selectOptions(screen.getByLabelText("組織で絞り込み"), "org-engineering");
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
    const sceneSelect = screen.getByLabelText("保存した検索シーン");
    await user.selectOptions(sceneSelect, within(sceneSelect).getByRole("option", { name: "フロントエンド候補" }));
    expect(screen.getAllByRole("button", { name: /中村 美咲/ }).some((button) => button.classList.contains("member-name-cell"))).toBe(true);
    expect(screen.getByText("60点")).toBeInTheDocument();
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
    expect(screen.getByLabelText("保存した検索シーン")).toBeInTheDocument();
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
    const reportSelect = screen.getByLabelText("保存したレポート");
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
    await user.click(within(screen.getByRole("navigation", { name: "メインナビゲーション" })).getByRole("button", { name: "プロジェクト" }));
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
      // The nav labels for projects and opportunities carry a count badge.
      await user.click(navigation.getByRole("button", { name: new RegExp(`^${nav}\\d*$`, "u") }));
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
      await user.click(navigation.getByRole("button", { name: new RegExp(`^${nav}\\d*$`, "u") }));
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
    expect(screen.getByText("検索シーンの条件を入力")).toBeInTheDocument();

    // jsdom does not hide a closed details' contents, so this asserts the state
    // and the toggle, not visibility. What the folding actually buys is measured
    // in a real browser and recorded in the PR.
    await user.click(screen.getByText("検索シーンの条件を入力"));
    expect(disclosure).toHaveAttribute("open");
    expect(screen.getByRole("button", { name: "検索シーンを保存" })).toBeInTheDocument();
    expect(screen.getByPlaceholderText("フロントエンド候補")).toBeInTheDocument();

    // And it shuts again, so the summary is a toggle rather than a one-way door.
    await user.click(screen.getByText("検索シーンの条件を入力"));
    expect(disclosure).not.toHaveAttribute("open");
  });

  it("still saves a scene once opened", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(within(screen.getByRole("navigation", { name: "メインナビゲーション" })).getByRole("button", { name: "メンバー" }));
    await user.click(screen.getByText("検索シーンの条件を入力"));

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

    // The ordering is by 稼働率 too, so it gets the same word as the count.
    expect(document.querySelector(".toolbar-result")!.textContent).toBe("稼働率の低い順");
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

    expect(headers).toContain("今週の稼働");
    expect(headers).toContain("4週間の稼働");
    expect(headers).not.toContain("今週");
    expect(headers).not.toContain("4週間のキャパシティ");

    // And the cell under that header really is the load, not the 空き.
    const cell = table.querySelectorAll("tbody tr")[0].children[headers.indexOf("今週の稼働")];
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
    expect(screen.getAllByRole("button", { name: "プロジェクト" })).toHaveLength(1);

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
