import { createElement } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { User } from "@supabase/supabase-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { initialWorkspace } from "../domain";
import { ProductionRepository } from "./repository";
import { createSharedWorkspaceController, ProductionGate } from "./RootApp";
import type { MyContext } from "./types";

const supabaseClient = vi.hoisted(() => ({
  auth: {
    getUser: vi.fn(),
    onAuthStateChange: vi.fn(),
  },
}));

vi.mock("../lib/supabase", () => ({
  getSupabaseClient: () => supabaseClient,
  getSupabaseRuntimeConfiguration: () => ({ mode: "configured" }),
}));

afterEach(() => {
  vi.restoreAllMocks();
  window.history.replaceState({}, "", "/");
});

describe("shared workspace controller", () => {
  it("uses the latest role without replacing the saved baseline", async () => {
    const saveWorkspace = vi.fn().mockResolvedValue({ revision: 8, savedAt: "2026-08-17T10:00:00Z" });
    const repository = {
      getWorkspace: vi.fn().mockResolvedValue({ state: initialWorkspace, revision: 7 }),
      saveWorkspace,
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
