import { createElement } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { User } from "@supabase/supabase-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { initialWorkspace } from "../domain";
import { ProductionRepository } from "./repository";
import RootApp, { createSharedWorkspaceController, ProductionGate } from "./RootApp";
import type { MyContext } from "./types";
import { markOAuthPending } from "./oauthPending";

const supabaseClient = vi.hoisted(() => ({
  auth: {
    getUser: vi.fn(),
    onAuthStateChange: vi.fn(),
  },
}));

const supabaseRuntime = vi.hoisted(() => ({
  mode: "configured" as "demo" | "configured" | "invalid",
}));

vi.mock("../lib/supabase", () => ({
  getSupabaseClient: () => supabaseClient,
  getSupabaseRuntimeConfiguration: () => ({ mode: supabaseRuntime.mode }),
}));

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  supabaseRuntime.mode = "configured";
  window.history.replaceState({}, "", "/");
  window.localStorage.clear();
  sessionStorage.clear();
});

describe("shared workspace controller", () => {
  it("uses the latest role without replacing the saved baseline", async () => {
    const saveWorkspace = vi.fn().mockResolvedValue({ revision: 8, savedAt: "2026-08-17T10:00:00Z" });
    const repository = {
      getWorkspace: vi.fn().mockResolvedValue({ state: initialWorkspace, revision: 7 }),
      saveWorkspace,
      submitProfileRequest: vi.fn(),
      subscribeToWorkspace: vi.fn().mockReturnValue(() => undefined),
    };
    const controller = createSharedWorkspaceController(repository, "00000000-0000-4000-8000-000000000002", "planner");
    const changed = {
      ...initialWorkspace,
      members: initialWorkspace.members.map((member, index) => index === 0 ? { ...member, name: "更新した氏名" } : member),
    };
    controller.setBaseline(initialWorkspace);

    controller.setRole("admin");
    await controller.save(changed, 7, "00000000-0000-4000-8000-000000000003");

    expect(saveWorkspace).toHaveBeenCalledWith(
      "00000000-0000-4000-8000-000000000002",
      changed,
      7,
      "00000000-0000-4000-8000-000000000003",
      initialWorkspace,
      "admin",
    );
  });
});

describe("invitation deep links", () => {
  it("clears an invalid invitation and keeps existing organizations usable", async () => {
    const user = userEvent.setup();
    const authUser = { id: "00000000-0000-4000-8000-000000000001", email: "member@example.com" } as User;
    const context: MyContext = {
      userId: authUser.id,
      name: "既存 利用者",
      email: authUser.email!,
      organizations: [
        { id: "00000000-0000-4000-8000-000000000010", name: "第一組織", role: "viewer" },
        { id: "00000000-0000-4000-8000-000000000011", name: "第二組織", role: "planner" },
      ],
      invitations: [],
    };
    supabaseClient.auth.getUser.mockResolvedValue({ data: { user: authUser }, error: null });
    supabaseClient.auth.onAuthStateChange.mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } });
    vi.spyOn(ProductionRepository.prototype, "getMyContext").mockResolvedValue(context);
    vi.spyOn(ProductionRepository.prototype, "acceptInvitation").mockRejectedValue(new Error("招待の有効期限が切れています。"));
    window.history.replaceState({}, "", "/?invitation=00000000-0000-4000-8000-000000000099");

    render(createElement(ProductionGate));

    expect(await screen.findByRole("heading", { name: "利用する組織を選択" })).toBeInTheDocument();
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("招待の有効期限が切れています");
    expect(screen.getAllByRole("button", { name: "開く" })).toHaveLength(2);
    await waitFor(() => expect(window.location.search).toBe(""));

    await user.click(screen.getByRole("button", { name: "閉じる" }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "利用する組織を選択" })).toBeInTheDocument();
  });
});

describe("password recovery deep links", () => {
  it("keeps a recovery session on the password update screen", async () => {
    const authUser = { id: "00000000-0000-4000-8000-000000000001", email: "member@example.com" } as User;
    supabaseClient.auth.getUser.mockResolvedValue({ data: { user: authUser }, error: null });
    supabaseClient.auth.onAuthStateChange.mockImplementation((listener: (event: string, session: { user: User } | null) => void) => {
      listener("PASSWORD_RECOVERY", { user: authUser });
      return { data: { subscription: { unsubscribe: vi.fn() } } };
    });
    const getMyContext = vi.spyOn(ProductionRepository.prototype, "getMyContext").mockResolvedValue({
      userId: authUser.id,
      name: "既存 利用者",
      email: authUser.email!,
      organizations: [{ id: "00000000-0000-4000-8000-000000000010", name: "第一組織", role: "viewer" }],
      invitations: [],
    });

    render(createElement(ProductionGate));

    expect(await screen.findByRole("heading", { level: 2, name: "新しいパスワードを設定" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "利用する組織を選択" })).not.toBeInTheDocument();
    expect(getMyContext).not.toHaveBeenCalled();
  });

  it("opens the organization picker after a successful password update", async () => {
    const user = userEvent.setup();
    const authUser = { id: "00000000-0000-4000-8000-000000000001", email: "member@example.com" } as User;
    supabaseClient.auth.getUser.mockResolvedValue({ data: { user: authUser }, error: null });
    supabaseClient.auth.onAuthStateChange.mockImplementation((listener: (event: string, session: { user: User } | null) => void) => {
      listener("PASSWORD_RECOVERY", { user: authUser });
      return { data: { subscription: { unsubscribe: vi.fn() } } };
    });
    vi.spyOn(ProductionRepository.prototype, "updatePassword").mockResolvedValue(undefined);
    vi.spyOn(ProductionRepository.prototype, "getMyContext").mockResolvedValue({
      userId: authUser.id,
      name: "既存 利用者",
      email: authUser.email!,
      organizations: [
        { id: "00000000-0000-4000-8000-000000000010", name: "第一組織", role: "viewer" },
        { id: "00000000-0000-4000-8000-000000000011", name: "第二組織", role: "planner" },
      ],
      invitations: [],
    });

    render(createElement(ProductionGate));

    await screen.findByRole("heading", { level: 2, name: "新しいパスワードを設定" });
    await user.type(screen.getByLabelText("新しいパスワード"), "NewPassword12");
    await user.type(screen.getByLabelText("新しいパスワード（確認）"), "NewPassword12");
    await user.click(screen.getByRole("button", { name: "パスワードを更新" }));

    expect(await screen.findByRole("heading", { name: "利用する組織を選択" })).toBeInTheDocument();
  });

  it("shows a safe expired-link message instead of the provider description", async () => {
    supabaseClient.auth.getUser.mockResolvedValue({ data: { user: null }, error: { name: "AuthSessionMissingError" } });
    supabaseClient.auth.onAuthStateChange.mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } });
    window.history.replaceState({}, "", "/#error=access_denied&error_code=otp_expired&error_description=Email%20link%20is%20invalid%20or%20has%20expired");

    render(createElement(ProductionGate));

    expect(await screen.findByRole("alert")).toHaveTextContent("有効期限が切れています");
    expect(screen.queryByText(/Email link/i)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "再設定メールを送る" })).toBeInTheDocument();
  });

  it("opens the password update screen for a bare callback code without an OAuth marker", async () => {
    const authUser = { id: "00000000-0000-4000-8000-000000000001", email: "member@example.com" } as User;
    supabaseClient.auth.getUser.mockResolvedValue({ data: { user: authUser }, error: null });
    supabaseClient.auth.onAuthStateChange.mockImplementation((listener: (event: string, session: { user: User } | null) => void) => {
      listener("INITIAL_SESSION", { user: authUser });
      return { data: { subscription: { unsubscribe: vi.fn() } } };
    });
    const getMyContext = vi.spyOn(ProductionRepository.prototype, "getMyContext").mockResolvedValue({
      userId: authUser.id,
      name: "既存 利用者",
      email: authUser.email!,
      organizations: [{ id: "00000000-0000-4000-8000-000000000010", name: "第一組織", role: "viewer" }],
      invitations: [],
    });
    window.history.replaceState({}, "", "/?code=auth-code");

    render(createElement(ProductionGate));

    expect(await screen.findByRole("heading", { level: 2, name: "新しいパスワードを設定" })).toBeInTheDocument();
    expect(getMyContext).not.toHaveBeenCalled();
  });

  it("opens the password update screen for an implicit recovery fragment without an OAuth marker", async () => {
    const authUser = { id: "00000000-0000-4000-8000-000000000001", email: "member@example.com" } as User;
    supabaseClient.auth.getUser.mockResolvedValue({ data: { user: authUser }, error: null });
    supabaseClient.auth.onAuthStateChange.mockImplementation((listener: (event: string, session: { user: User } | null) => void) => {
      listener("INITIAL_SESSION", { user: authUser });
      return { data: { subscription: { unsubscribe: vi.fn() } } };
    });
    const getMyContext = vi.spyOn(ProductionRepository.prototype, "getMyContext").mockResolvedValue({
      userId: authUser.id,
      name: "既存 利用者",
      email: authUser.email!,
      organizations: [{ id: "00000000-0000-4000-8000-000000000010", name: "第一組織", role: "viewer" }],
      invitations: [],
    });
    window.history.replaceState({}, "", "/#access_token=token&token_type=bearer&type=recovery");

    render(createElement(ProductionGate));

    expect(await screen.findByRole("heading", { level: 2, name: "新しいパスワードを設定" })).toBeInTheDocument();
    expect(getMyContext).not.toHaveBeenCalled();
  });
});

describe("Google OAuth callbacks", () => {
  it("does not open password recovery after Google returns with an OAuth marker", async () => {
    const authUser = { id: "00000000-0000-4000-8000-000000000001", email: "member@example.com" } as User;
    markOAuthPending("google");
    supabaseClient.auth.getUser.mockResolvedValue({ data: { user: authUser }, error: null });
    supabaseClient.auth.onAuthStateChange.mockImplementation((listener: (event: string, session: { user: User } | null) => void) => {
      listener("INITIAL_SESSION", { user: authUser });
      return { data: { subscription: { unsubscribe: vi.fn() } } };
    });
    vi.spyOn(ProductionRepository.prototype, "getMyContext").mockResolvedValue({
      userId: authUser.id,
      name: "既存 利用者",
      email: authUser.email!,
      organizations: [
        { id: "00000000-0000-4000-8000-000000000010", name: "第一組織", role: "viewer" },
        { id: "00000000-0000-4000-8000-000000000011", name: "第二組織", role: "planner" },
      ],
      invitations: [],
    });
    window.history.replaceState({}, "", "/?code=auth-code");

    render(createElement(ProductionGate));

    expect(await screen.findByRole("heading", { name: "利用する組織を選択" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { level: 2, name: "新しいパスワードを設定" })).not.toBeInTheDocument();
  });

  it("does not open password recovery after Google returns an implicit token fragment", async () => {
    const authUser = { id: "00000000-0000-4000-8000-000000000001", email: "member@example.com" } as User;
    markOAuthPending("google");
    supabaseClient.auth.getUser.mockResolvedValue({ data: { user: authUser }, error: null });
    supabaseClient.auth.onAuthStateChange.mockImplementation((listener: (event: string, session: { user: User } | null) => void) => {
      listener("INITIAL_SESSION", { user: authUser });
      return { data: { subscription: { unsubscribe: vi.fn() } } };
    });
    vi.spyOn(ProductionRepository.prototype, "getMyContext").mockResolvedValue({
      userId: authUser.id,
      name: "既存 利用者",
      email: authUser.email!,
      organizations: [
        { id: "00000000-0000-4000-8000-000000000010", name: "第一組織", role: "viewer" },
        { id: "00000000-0000-4000-8000-000000000011", name: "第二組織", role: "planner" },
      ],
      invitations: [],
    });
    window.history.replaceState({}, "", "/#access_token=token&token_type=bearer");

    render(createElement(ProductionGate));

    expect(await screen.findByRole("heading", { name: "利用する組織を選択" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { level: 2, name: "新しいパスワードを設定" })).not.toBeInTheDocument();
  });

  it("keeps invite onboarding when mosaic_invite is set after Google returns", async () => {
    const authUser = {
      id: "00000000-0000-4000-8000-000000000001",
      email: "invitee@example.jp",
      user_metadata: { mosaic_invite: true },
    } as unknown as User;
    markOAuthPending("google");
    supabaseClient.auth.getUser.mockResolvedValue({ data: { user: authUser }, error: null });
    supabaseClient.auth.onAuthStateChange.mockImplementation((listener: (event: string, session: { user: User } | null) => void) => {
      listener("INITIAL_SESSION", { user: authUser });
      return { data: { subscription: { unsubscribe: vi.fn() } } };
    });
    const getMyContext = vi.spyOn(ProductionRepository.prototype, "getMyContext").mockResolvedValue({
      userId: authUser.id,
      name: "未設定",
      email: authUser.email!,
      organizations: [],
      invitations: [],
    });
    window.history.replaceState({}, "", "/?code=auth-code");

    render(createElement(ProductionGate));

    expect(await screen.findByRole("heading", { level: 2, name: "表示名とパスワードを設定" })).toBeInTheDocument();
    expect(getMyContext).not.toHaveBeenCalled();
  });

  it("shows a Google cancel message on the login screen instead of the recovery form", async () => {
    markOAuthPending("google");
    supabaseClient.auth.getUser.mockResolvedValue({ data: { user: null }, error: { name: "AuthSessionMissingError" } });
    supabaseClient.auth.onAuthStateChange.mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } });
    window.history.replaceState({}, "", "/?error=access_denied&error_description=The%20user%20denied%20access");

    render(createElement(ProductionGate));

    expect(await screen.findByRole("alert")).toHaveTextContent("キャンセル");
    expect(screen.queryByText(/user denied/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "再設定メールを送る" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "ログイン" })).toBeInTheDocument();
  });

  it("explains an uninvited Google account without the recovery copy", async () => {
    markOAuthPending("google");
    supabaseClient.auth.getUser.mockResolvedValue({ data: { user: null }, error: { name: "AuthSessionMissingError" } });
    supabaseClient.auth.onAuthStateChange.mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } });
    window.history.replaceState({}, "", "/?error=access_denied&error_code=signup_disabled");

    render(createElement(ProductionGate));

    expect(await screen.findByRole("alert")).toHaveTextContent("招待");
    expect(screen.queryByRole("button", { name: "再設定メールを送る" })).not.toBeInTheDocument();
  });

  it("hides the Google button when the flag is off", async () => {
    vi.stubEnv("VITE_ENABLE_GOOGLE_AUTH", "false");
    supabaseClient.auth.getUser.mockResolvedValue({ data: { user: null }, error: { name: "AuthSessionMissingError" } });
    supabaseClient.auth.onAuthStateChange.mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } });

    render(createElement(ProductionGate));

    expect(await screen.findByRole("button", { name: "ログイン" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Google でログイン" })).not.toBeInTheDocument();
  });

  it("shows the Google button when the flag is on", async () => {
    vi.stubEnv("VITE_ENABLE_GOOGLE_AUTH", "true");
    supabaseClient.auth.getUser.mockResolvedValue({ data: { user: null }, error: { name: "AuthSessionMissingError" } });
    supabaseClient.auth.onAuthStateChange.mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } });

    render(createElement(ProductionGate));

    expect(await screen.findByRole("button", { name: "Google でログイン" })).toBeInTheDocument();
  });

  it("does not render the Google button in the demo fallback even when the flag is on", () => {
    supabaseRuntime.mode = "demo";
    vi.stubEnv("VITE_ENABLE_GOOGLE_AUTH", "true");

    render(createElement(RootApp));

    expect(screen.queryByRole("button", { name: "Google でログイン" })).not.toBeInTheDocument();
  });
});

describe("invite onboarding deep links", () => {
  it("keeps an invite session on the onboarding screen", async () => {
    const authUser = {
      id: "00000000-0000-4000-8000-000000000001",
      email: "invitee@example.jp",
      user_metadata: { mosaic_invite: true },
    } as unknown as User;
    supabaseClient.auth.getUser.mockResolvedValue({ data: { user: authUser }, error: null });
    supabaseClient.auth.onAuthStateChange.mockImplementation((listener: (event: string, session: { user: User } | null) => void) => {
      listener("SIGNED_IN", { user: authUser });
      return { data: { subscription: { unsubscribe: vi.fn() } } };
    });
    const getMyContext = vi.spyOn(ProductionRepository.prototype, "getMyContext").mockResolvedValue({
      userId: authUser.id,
      name: "未設定",
      email: authUser.email!,
      organizations: [{ id: "00000000-0000-4000-8000-000000000010", name: "第一組織", role: "viewer" }],
      invitations: [],
    });

    render(createElement(ProductionGate));

    expect(await screen.findByRole("heading", { level: 2, name: "表示名とパスワードを設定" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "利用する組織を選択" })).not.toBeInTheDocument();
    expect(getMyContext).not.toHaveBeenCalled();
  });

  it("accepts pending invitations after onboarding and opens the organization", async () => {
    const user = userEvent.setup();
    const authUser = {
      id: "00000000-0000-4000-8000-000000000001",
      email: "invitee@example.jp",
      user_metadata: { mosaic_invite: true },
    } as unknown as User;
    const organization = { id: "00000000-0000-4000-8000-000000000010", name: "第一組織", role: "planner" as const };
    supabaseClient.auth.getUser.mockResolvedValue({ data: { user: authUser }, error: null });
    supabaseClient.auth.onAuthStateChange.mockImplementation((listener: (event: string, session: { user: User } | null) => void) => {
      listener("SIGNED_IN", { user: authUser });
      return { data: { subscription: { unsubscribe: vi.fn() } } };
    });
    vi.spyOn(ProductionRepository.prototype, "completeOnboarding").mockResolvedValue(undefined);
    vi.spyOn(ProductionRepository.prototype, "acceptInvitation").mockResolvedValue({
      organizationId: organization.id,
      organizationName: organization.name,
      role: organization.role,
    });
    vi.spyOn(ProductionRepository.prototype, "getMyContext")
      .mockResolvedValueOnce({
        userId: authUser.id,
        name: "招待 花子",
        email: authUser.email!,
        organizations: [],
        invitations: [{
          id: "00000000-0000-4000-8000-000000000099",
          organizationId: organization.id,
          organizationName: organization.name,
          role: organization.role,
        }],
      })
      .mockResolvedValue({
        userId: authUser.id,
        name: "招待 花子",
        email: authUser.email!,
        organizations: [organization],
        invitations: [],
      });
    vi.spyOn(ProductionRepository.prototype, "getWorkspace").mockResolvedValue({
      revision: 1,
      state: initialWorkspace,
    });
    vi.spyOn(ProductionRepository.prototype, "subscribeToWorkspace").mockReturnValue(() => undefined);

    render(createElement(ProductionGate));

    await screen.findByRole("heading", { level: 2, name: "表示名とパスワードを設定" });
    await user.type(screen.getByLabelText("表示名"), "招待 花子");
    await user.type(screen.getByLabelText("新しいパスワード"), "NewPassword12");
    await user.type(screen.getByLabelText("新しいパスワード（確認）"), "NewPassword12");
    await user.click(screen.getByRole("button", { name: "登録を完了" }));

    await waitFor(() => expect(ProductionRepository.prototype.acceptInvitation).toHaveBeenCalledWith("00000000-0000-4000-8000-000000000099"));
    expect(await screen.findByText("第一組織")).toBeInTheDocument();
  });

  it("keeps pending invitations visible when the user already belongs to an organization", async () => {
    const authUser = { id: "00000000-0000-4000-8000-000000000001", email: "member@example.jp" } as User;
    supabaseClient.auth.getUser.mockResolvedValue({ data: { user: authUser }, error: null });
    supabaseClient.auth.onAuthStateChange.mockImplementation((listener: (event: string, session: { user: User } | null) => void) => {
      listener("SIGNED_IN", { user: authUser });
      return { data: { subscription: { unsubscribe: vi.fn() } } };
    });
    vi.spyOn(ProductionRepository.prototype, "getMyContext").mockResolvedValue({
      userId: authUser.id,
      name: "既存 利用者",
      email: authUser.email!,
      organizations: [{ id: "00000000-0000-4000-8000-000000000010", name: "第一組織", role: "viewer" }],
      invitations: [{
        id: "00000000-0000-4000-8000-000000000099",
        organizationId: "00000000-0000-4000-8000-000000000011",
        organizationName: "第二組織",
        role: "planner",
      }],
    });
    window.localStorage.setItem("mosaic-active-organization:00000000-0000-4000-8000-000000000001", "00000000-0000-4000-8000-000000000010");

    render(createElement(ProductionGate));

    expect(await screen.findByRole("heading", { name: "利用する組織を選択" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "参加" })).toBeInTheDocument();
    expect(screen.getByText("第二組織")).toBeInTheDocument();
  });
});

describe("legal notice route", () => {
  it("opens from the query before demo or auth", () => {
    window.history.replaceState({}, "", "/?legal=1");
    supabaseRuntime.mode = "demo";
    render(createElement(RootApp));
    expect(screen.getByRole("heading", { level: 1, name: "プライバシーと利用規約" })).toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "メインナビゲーション" })).not.toBeInTheDocument();
  });

  it("does not swallow an auth callback", async () => {
    window.history.replaceState({}, "", "/?legal=1&code=oauth-code");
    supabaseClient.auth.getUser.mockResolvedValue({ data: { user: null }, error: { name: "AuthSessionMissingError" } });
    supabaseClient.auth.onAuthStateChange.mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } });
    render(createElement(RootApp));
    expect(screen.queryByRole("heading", { name: "プライバシーと利用規約" })).not.toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "セッションを確認中" })).toBeInTheDocument();
  });
});
