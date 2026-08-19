import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { OperationsPanel } from "./OperationsPanel";
import type { ProductionRepository } from "./repository";
import type { AuditEvent, OrganizationInvitation, OrganizationSummary } from "./types";

const organization: OrganizationSummary = {
  id: "00000000-0000-4000-8000-000000000002",
  name: "プロダクト開発本部",
  role: "admin",
};

function repositoryWithInvitation(invitation: OrganizationInvitation) {
  return {
    listOrganizationMembers: vi.fn().mockResolvedValue([]),
    listAuditEvents: vi.fn().mockResolvedValue({ events: [], nextBefore: undefined }),
    listOrganizationInvitations: vi.fn()
      .mockResolvedValueOnce([invitation])
      .mockResolvedValue([]),
    listIntegrationClients: vi.fn().mockResolvedValue([]),
    revokeOrganizationInvitation: vi.fn().mockResolvedValue({ changed: true }),
  } as unknown as ProductionRepository;
}

function repositoryWithAuditEvent(event: AuditEvent) {
  return {
    listOrganizationMembers: vi.fn().mockResolvedValue([]),
    listAuditEvents: vi.fn().mockResolvedValue({ events: [event], nextBefore: undefined }),
    listOrganizationInvitations: vi.fn().mockResolvedValue([]),
    listIntegrationClients: vi.fn().mockResolvedValue([]),
  } as unknown as ProductionRepository;
}

describe("OperationsPanel invitation administration", () => {
  it("lists and revokes a pending invitation, then refreshes the operational snapshot", async () => {
    const user = userEvent.setup();
    const invitation: OrganizationInvitation = {
      id: "00000000-0000-4000-8000-000000000010",
      organizationId: organization.id,
      email: "new.member@example.jp",
      role: "planner",
      status: "pending",
      expiresAt: "2026-08-24T10:00:00Z",
    };
    const repository = repositoryWithInvitation(invitation);
    vi.spyOn(window, "confirm").mockReturnValue(true);

    render(
      <OperationsPanel
        currentUserId="00000000-0000-4000-8000-000000000001"
        currentOrganization={organization}
        organizations={[organization]}
        repository={repository}
        onClose={vi.fn()}
        onSelectOrganization={vi.fn()}
      />,
    );

    expect(await screen.findByText("new.member@example.jp")).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /admin/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /取消/ }));

    await waitFor(() => expect(repository.revokeOrganizationInvitation).toHaveBeenCalledWith(organization.id, invitation.id));
    expect(await screen.findByText("new.member@example.jpへの招待を取り消しました。")).toBeInTheDocument();
    await waitFor(() => expect(repository.listOrganizationInvitations).toHaveBeenCalledTimes(2));
  });

  it("offers the administrator invitation role to owners", async () => {
    const ownerOrganization: OrganizationSummary = { ...organization, role: "owner" };
    const repository = {
      listOrganizationMembers: vi.fn().mockResolvedValue([]),
      listAuditEvents: vi.fn().mockResolvedValue({ events: [], nextBefore: undefined }),
      listOrganizationInvitations: vi.fn().mockResolvedValue([]),
      listIntegrationClients: vi.fn().mockResolvedValue([]),
    } as unknown as ProductionRepository;

    render(
      <OperationsPanel
        currentUserId="00000000-0000-4000-8000-000000000001"
        currentOrganization={ownerOrganization}
        organizations={[ownerOrganization]}
        repository={repository}
        onClose={vi.fn()}
        onSelectOrganization={vi.fn()}
      />,
    );

    expect(await screen.findByRole("option", { name: /admin/ })).toBeInTheDocument();
  });

  it("sends an invite email from the operations form", async () => {
    const user = userEvent.setup();
    const repository = {
      listOrganizationMembers: vi.fn().mockResolvedValue([]),
      listAuditEvents: vi.fn().mockResolvedValue({ events: [], nextBefore: undefined }),
      listOrganizationInvitations: vi.fn().mockResolvedValue([]),
      listIntegrationClients: vi.fn().mockResolvedValue([]),
      inviteMember: vi.fn().mockResolvedValue({
        email: "new.member@example.jp",
        role: "planner",
        authInvite: "sent",
      }),
    } as unknown as ProductionRepository;

    render(
      <OperationsPanel
        currentUserId="00000000-0000-4000-8000-000000000001"
        currentOrganization={organization}
        organizations={[organization]}
        repository={repository}
        onClose={vi.fn()}
        onSelectOrganization={vi.fn()}
      />,
    );

    await user.type(await screen.findByLabelText("メールアドレス"), "new.member@example.jp");
    await user.click(screen.getByRole("button", { name: "招待メールを送る" }));

    await waitFor(() => expect(repository.inviteMember).toHaveBeenCalledWith(organization.id, "new.member@example.jp", "planner"));
    expect(await screen.findByRole("status")).toHaveTextContent("招待メールを送りました");
  });

  it("resends a pending invitation with the same email and role", async () => {
    const user = userEvent.setup();
    const invitation: OrganizationInvitation = {
      id: "00000000-0000-4000-8000-000000000010",
      organizationId: organization.id,
      email: "new.member@example.jp",
      role: "planner",
      status: "pending",
      expiresAt: "2026-08-24T10:00:00Z",
    };
    const repository = {
      ...repositoryWithInvitation(invitation),
      inviteMember: vi.fn().mockResolvedValue({
        email: invitation.email,
        role: invitation.role,
        authInvite: "existing",
      }),
    } as unknown as ProductionRepository;

    render(
      <OperationsPanel
        currentUserId="00000000-0000-4000-8000-000000000001"
        currentOrganization={organization}
        organizations={[organization]}
        repository={repository}
        onClose={vi.fn()}
        onSelectOrganization={vi.fn()}
      />,
    );

    await user.click(await screen.findByRole("button", { name: /再送/ }));

    await waitFor(() => expect(repository.inviteMember).toHaveBeenCalledWith(organization.id, invitation.email, invitation.role));
    expect(await screen.findByRole("status")).toHaveTextContent("すでにアカウントがあるため");
  });
});

describe("OperationsPanel keyboard navigation", () => {
  it("keeps the current field focused when the parent supplies a new close callback", async () => {
    const user = userEvent.setup();
    const firstClose = vi.fn();
    const latestClose = vi.fn();
    const repository = {
      listOrganizationMembers: vi.fn().mockResolvedValue([]),
      listAuditEvents: vi.fn().mockResolvedValue({ events: [], nextBefore: undefined }),
      listOrganizationInvitations: vi.fn().mockResolvedValue([]),
      listIntegrationClients: vi.fn().mockResolvedValue([]),
    } as unknown as ProductionRepository;
    const commonProps = {
      currentUserId: "00000000-0000-4000-8000-000000000001",
      currentOrganization: organization,
      organizations: [organization],
      repository,
      onSelectOrganization: vi.fn(),
    };
    const { rerender } = render(<OperationsPanel {...commonProps} onClose={firstClose} />);
    const email = await screen.findByLabelText("メールアドレス");
    await user.click(email);
    await user.type(email, "draft@example.com");

    rerender(<OperationsPanel {...commonProps} onClose={latestClose} />);

    expect(email).toHaveFocus();
    expect(email).toHaveValue("draft@example.com");
    await user.keyboard("{Escape}");
    expect(latestClose).toHaveBeenCalledOnce();
    expect(firstClose).not.toHaveBeenCalled();
  });

  it("keeps audit detail summaries in the modal focus loop", async () => {
    const user = userEvent.setup();
    const auditEvent: AuditEvent = {
      id: "00000000-0000-4000-8000-000000000011",
      actorName: "管理 花子",
      action: "update",
      entityType: "projects",
      entityId: "00000000-0000-4000-8000-000000000012",
      summary: "プロジェクトを更新",
      createdAt: "2026-08-17T10:00:00Z",
    };

    render(
      <OperationsPanel
        currentUserId="00000000-0000-4000-8000-000000000001"
        currentOrganization={organization}
        organizations={[organization]}
        repository={repositoryWithAuditEvent(auditEvent)}
        onClose={vi.fn()}
        onSelectOrganization={vi.fn()}
      />,
    );

    const auditSummary = await screen.findByText("対象・変更前後・request ID");
    const refreshButton = screen.getByRole("button", { name: "監査ログを再読み込み" });
    refreshButton.focus();

    await user.tab();

    expect(auditSummary).toHaveFocus();
  });

  it("wraps backward focus from the initially focused dialog into its last control", async () => {
    const user = userEvent.setup();
    const auditEvent: AuditEvent = {
      id: "00000000-0000-4000-8000-000000000013",
      actorName: "管理 花子",
      action: "update",
      entityType: "projects",
      summary: "プロジェクトを更新",
      createdAt: "2026-08-17T10:00:00Z",
    };

    render(
      <OperationsPanel
        currentUserId="00000000-0000-4000-8000-000000000001"
        currentOrganization={organization}
        organizations={[organization]}
        repository={repositoryWithAuditEvent(auditEvent)}
        onClose={vi.fn()}
        onSelectOrganization={vi.fn()}
      />,
    );

    const dialog = screen.getByRole("dialog", { name: "組織と運用履歴" });
    const auditSummary = await screen.findByText("対象・変更前後・request ID");
    await waitFor(() => expect(dialog).toHaveFocus());

    await user.tab({ shift: true });

    expect(auditSummary).toHaveFocus();
  });
});

describe("OperationsPanel integration credentials", () => {
  it("issues a credential once and shows the secret", async () => {
    const user = userEvent.setup();
    const repository = {
      listOrganizationMembers: vi.fn().mockResolvedValue([]),
      listAuditEvents: vi.fn().mockResolvedValue({ events: [], nextBefore: undefined }),
      listOrganizationInvitations: vi.fn().mockResolvedValue([]),
      listIntegrationClients: vi.fn()
        .mockResolvedValueOnce([])
        .mockResolvedValue([{
          id: "00000000-0000-4000-8000-000000000020",
          organizationId: organization.id,
          name: "社内 MCP",
          keyPrefix: "abc123def456",
          scopes: ["workspace:read", "assignments:write"],
          status: "active",
        }]),
      createIntegrationClient: vi.fn().mockResolvedValue({
        client: {
          id: "00000000-0000-4000-8000-000000000020",
          organizationId: organization.id,
          name: "社内 MCP",
          keyPrefix: "abc123def456",
          scopes: ["workspace:read", "assignments:write"],
          status: "active",
        },
        secret: "mosaic_sk_abc123def45600112233445566778899aabbccddeeff",
        replayed: false,
      }),
    } as unknown as ProductionRepository;

    render(
      <OperationsPanel
        currentUserId="00000000-0000-4000-8000-000000000001"
        currentOrganization={organization}
        organizations={[organization]}
        repository={repository}
        onClose={vi.fn()}
        onSelectOrganization={vi.fn()}
      />,
    );

    await user.type(await screen.findByLabelText("名前"), "社内 MCP");
    await user.click(screen.getByRole("checkbox", { name: "アサインの登録・更新・取消" }));
    await user.click(screen.getByRole("button", { name: "連携資格を発行する" }));

    await waitFor(() => expect(repository.createIntegrationClient).toHaveBeenCalledWith(
      organization.id,
      "社内 MCP",
      ["workspace:read", "assignments:write"],
    ));
    expect(await screen.findByText("mosaic_sk_abc123def45600112233445566778899aabbccddeeff")).toBeInTheDocument();
    expect(screen.getByText("秘密鍵（再表示できません）")).toBeInTheDocument();
  });

  it("revokes an active integration client after confirmation", async () => {
    const user = userEvent.setup();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const client = {
      id: "00000000-0000-4000-8000-000000000021",
      organizationId: organization.id,
      name: "レポート連携",
      keyPrefix: "fedcba987654",
      scopes: ["workspace:read"],
      status: "active" as const,
    };
    const repository = {
      listOrganizationMembers: vi.fn().mockResolvedValue([]),
      listAuditEvents: vi.fn().mockResolvedValue({ events: [], nextBefore: undefined }),
      listOrganizationInvitations: vi.fn().mockResolvedValue([]),
      listIntegrationClients: vi.fn()
        .mockResolvedValueOnce([client])
        .mockResolvedValue([{ ...client, status: "revoked" }]),
      revokeIntegrationClient: vi.fn().mockResolvedValue({ changed: true, client: { ...client, status: "revoked" } }),
    } as unknown as ProductionRepository;

    render(
      <OperationsPanel
        currentUserId="00000000-0000-4000-8000-000000000001"
        currentOrganization={organization}
        organizations={[organization]}
        repository={repository}
        onClose={vi.fn()}
        onSelectOrganization={vi.fn()}
      />,
    );

    expect(await screen.findByText("レポート連携")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "失効" }));
    await waitFor(() => expect(repository.revokeIntegrationClient).toHaveBeenCalledWith(organization.id, client.id));
    expect(await screen.findByText("レポート連携の連携資格を失効しました。")).toBeInTheDocument();
  });
});
