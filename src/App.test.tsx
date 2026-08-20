import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { describe, expect, it, vi } from "vitest";
import App, { type SharedWorkspaceAdapter } from "./App";
import { addDays, getWeekStart, initialWorkspace, memberDailyLoads, type WorkspaceState } from "./domain";
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

    const overloadButton = screen.getByText("OVER CAPACITY").closest("button");
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

    await user.click(screen.getAllByRole("button", { name: "Atlas リニューアルのアサイン詳細" })[0]);
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

    await user.click(screen.getByRole("button", { name: "Atlas リニューアルのアサイン詳細" }));
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

    await user.click(screen.getByRole("button", { name: "Atlas リニューアルのアサイン詳細" }));
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

    const openRole = screen.getByText("OPEN ROLE").closest("button");
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
    expect(screen.getByText("OPEN ROLE")).toBeInTheDocument();
    await user.click(screen.getByText("OPEN ROLE").closest("button")!);
    expect(screen.getByText("50%の空き")).toBeInTheDocument();
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

  it("returns to the member board from the reports primary action", async () => {
    const user = userEvent.setup();
    render(<App />);
    const navigation = within(screen.getByRole("navigation", { name: "メインナビゲーション" }));

    await user.click(navigation.getByRole("button", { name: "レポート" }));
    expect(screen.getByRole("heading", { name: "キャパシティ予測" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "ボードで調整" }));

    expect(screen.getByRole("heading", { name: "今週のチーム編成" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "メンバー", pressed: true })).toBeInTheDocument();
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

    await user.click(screen.getByText("OPEN ROLE").closest("button")!);
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
    await user.click(screen.getAllByRole("button", { name: "Atlas リニューアルのアサイン詳細" })[0]);
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

    await user.click(screen.getByText("OVER CAPACITY").closest("button")!);
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
    const memberToolbar = screen.getByText("空き率の高い順").closest<HTMLElement>(".view-toolbar");
    expect(memberToolbar).not.toBeNull();
    await user.click(within(memberToolbar!).getByRole("button", { name: "メンバーを追加" }));
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
    expect(screen.getByText("在留資格")).toBeInTheDocument();

    await user.click(navigation.getByRole("button", { name: "メンバー" }));
    await user.click(screen.getByRole("button", { name: /佐伯 優斗/ }));
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
    expect(screen.getByRole("button", { name: /佐伯 優斗/ })).toBeInTheDocument();
    await user.clear(screen.getByPlaceholderText("名前・スキル・経歴を検索"));
    await user.selectOptions(screen.getByLabelText("組織で絞り込み"), "org-engineering");
    expect(screen.getByRole("button", { name: /佐伯 優斗/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /中村 美咲/ })).toBeInTheDocument();

    await user.click(navigation.getByRole("button", { name: "レポート" }));
    const engineering = screen.getByText("開発本部").closest("div");
    expect(engineering).toHaveTextContent("5名");

    await user.click(screen.getByRole("button", { name: "チームへ保存" }));
    await waitFor(() => expect(save).toHaveBeenCalledOnce());
    const saved = save.mock.calls[0][0] as WorkspaceState;
    expect(saved.orgUnits?.some((unit) => unit.name === "モバイル推進")).toBe(true);
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
    expect(screen.queryByText("OPEN ROLE")).not.toBeInTheDocument();
    window.localStorage.removeItem("mosaic-local-workspace-v3");
  });
});
