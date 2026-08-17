import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { OrganizationSetup } from "./OrganizationSetup";
import type { MyContext } from "./types";

const emptyContext: MyContext = {
  userId: "00000000-0000-4000-8000-000000000001",
  name: "管理 花子",
  email: "owner@example.com",
  organizations: [],
  invitations: [],
};

function renderSetup(context = emptyContext, onCreate = vi.fn().mockResolvedValue(undefined)) {
  const props = {
    context,
    onAcceptInvitation: vi.fn().mockResolvedValue(undefined),
    onCreate,
    onSelect: vi.fn(),
    onSignOut: vi.fn().mockResolvedValue(undefined),
  };
  render(<OrganizationSetup {...props} />);
  return props;
}

describe("organization creation", () => {
  it("reuses the request id when the same trimmed name is retried after an uncertain failure", async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn()
      .mockRejectedValueOnce(Object.assign(new Error("network timeout"), { retryable: true }))
      .mockResolvedValueOnce(undefined);
    renderSetup(emptyContext, onCreate);

    await user.type(screen.getByLabelText("組織名"), "  プロダクト開発本部  ");
    await user.click(screen.getByRole("button", { name: "組織を作成" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("network timeout");
    await user.click(screen.getByRole("button", { name: "同じ内容で再試行" }));
    await waitFor(() => expect(onCreate).toHaveBeenCalledTimes(2));

    expect(onCreate.mock.calls[0][0]).toBe("プロダクト開発本部");
    expect(onCreate.mock.calls[1][0]).toBe("プロダクト開発本部");
    expect(onCreate.mock.calls[1][1]).toBe(onCreate.mock.calls[0][1]);
  });

  it("uses a new request id after the normalized name changes or a clear validation failure", async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn()
      .mockRejectedValueOnce(Object.assign(new Error("network timeout"), { retryable: true }))
      .mockRejectedValueOnce(Object.assign(new Error("validation failed"), { retryable: false }))
      .mockResolvedValueOnce(undefined);
    renderSetup(emptyContext, onCreate);

    const input = screen.getByLabelText("組織名");
    await user.type(input, "第一組織");
    await user.click(screen.getByRole("button", { name: "組織を作成" }));
    await screen.findByRole("alert");
    await user.clear(input);
    await user.type(input, "第二組織");
    await user.click(screen.getByRole("button", { name: "組織を作成" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("validation failed");
    await user.click(screen.getByRole("button", { name: "組織を作成" }));
    await waitFor(() => expect(onCreate).toHaveBeenCalledTimes(3));

    expect(onCreate.mock.calls[1][1]).not.toBe(onCreate.mock.calls[0][1]);
    expect(onCreate.mock.calls[2][1]).not.toBe(onCreate.mock.calls[1][1]);
  });

  it("blocks organization selection, invitation acceptance, and sign-out while creation is pending", async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn(() => new Promise<void>(() => undefined));
    const context: MyContext = {
      ...emptyContext,
      organizations: [{ id: "00000000-0000-4000-8000-000000000002", name: "既存組織", role: "owner" }],
      invitations: [{ id: "00000000-0000-4000-8000-000000000003", organizationId: "00000000-0000-4000-8000-000000000004", organizationName: "招待組織", role: "viewer" }],
    };
    renderSetup(context, onCreate);

    await user.type(screen.getByLabelText("組織名"), "新しい組織");
    await user.click(screen.getByRole("button", { name: "組織を作成" }));
    await waitFor(() => expect(onCreate).toHaveBeenCalledOnce());

    expect(screen.getByLabelText("組織名")).toBeDisabled();
    expect(screen.getByRole("button", { name: "開く" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "参加" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "別のアカウントでログイン" })).toBeDisabled();
  });
});
