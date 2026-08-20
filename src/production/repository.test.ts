import type { SupabaseClient, User } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { convertOpportunityToProject, initialWorkspace } from "../domain";
import { normalizeAuditEvent, normalizeMyContext, normalizeOrganizationInvitation, normalizeWorkspace, ProductionRepository, sha256Hex, workspaceChangesPayload } from "./repository";

const user = {
  id: "00000000-0000-4000-8000-000000000001",
  email: "planner@example.jp",
} as User;

const sharedWorkspace = initialWorkspace;

describe("production repository response adapters", () => {
  it("creates an organization with the caller's idempotency request id", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: {
        organization: {
          id: "00000000-0000-4000-8000-000000000010",
          name: "プロダクト開発本部",
          role: "owner",
          slug: "product",
        },
        requestId: "00000000-0000-4000-8000-000000000011",
        replayed: false,
      },
      error: null,
    });
    const repository = new ProductionRepository({ rpc } as unknown as SupabaseClient);

    const organization = await repository.createOrganization("  プロダクト開発本部  ", "00000000-0000-4000-8000-000000000011");

    expect(rpc).toHaveBeenCalledWith("create_organization", {
      p_name: "プロダクト開発本部",
      p_request_id: "00000000-0000-4000-8000-000000000011",
    });
    expect(organization).toMatchObject({ id: "00000000-0000-4000-8000-000000000010", role: "owner" });
  });

  it("normalizes the current get_my_context camelCase contract", () => {
    const context = normalizeMyContext({
      profile: {
        id: user.id,
        displayName: "計画 花子",
        locale: "ja-JP",
        timeZone: "Asia/Tokyo",
      },
      organizations: [{
        id: "00000000-0000-4000-8000-000000000002",
        name: "プロダクト開発本部",
        role: "planner",
        slug: "product",
        workspaceRevision: 4,
      }],
      invitations: [{
        id: "00000000-0000-4000-8000-000000000003",
        organizationId: "00000000-0000-4000-8000-000000000004",
        organizationName: "品質保証部",
        role: "viewer",
      }],
    }, user);

    expect(context.name).toBe("計画 花子");
    expect(context.email).toBe("planner@example.jp");
    expect(context.organizations[0]).toMatchObject({ name: "プロダクト開発本部", role: "planner" });
    expect(context.invitations[0]).toMatchObject({ organizationName: "品質保証部", role: "viewer" });
  });

  it("normalizes get_workspace without treating its organization metadata as workspace state", () => {
    const workspace = normalizeWorkspace({
      organization: {
        id: "00000000-0000-4000-8000-000000000002",
        name: "プロダクト開発本部",
        workspaceRevision: 12,
        workspaceChangedAt: "2026-08-17T09:00:00Z",
      },
      ...sharedWorkspace,
    });

    expect(workspace.state).toEqual(sharedWorkspace);
    expect(workspace.revision).toBe(12);
    expect(workspace.savedAt).toBe("2026-08-17T09:00:00Z");
  });

  it("accepts an unset milestone date but rejects malformed operational rows", () => {
    const withoutMilestoneDate = {
      ...sharedWorkspace,
      projects: sharedWorkspace.projects.map((project, index) => index === 0 ? { ...project, nextMilestoneDate: null } : project),
    };
    expect(normalizeWorkspace({ workspaceRevision: 1, ...withoutMilestoneDate }).state.projects[0].nextMilestoneDate).toBeNull();

    expect(() => normalizeWorkspace({
      workspaceRevision: 1,
      ...sharedWorkspace,
      assignments: sharedWorkspace.assignments.map((assignment, index) => index === 0 ? { ...assignment, allocation: -10 } : assignment),
    })).toThrow("共有ワークスペースのデータ形式が正しくありません");
  });

  it("accepts database boundary values and the completed project status", () => {
    const boundary = {
      ...sharedWorkspace,
      members: sharedWorkspace.members.map((member, index) => index === 0 ? { ...member, capacity: 0 } : member),
      projects: sharedWorkspace.projects.map((project, index) => index === 0 ? { ...project, status: "完了" as const, demand: 0 } : project),
    };

    const workspace = normalizeWorkspace({ workspaceRevision: 2, ...boundary });
    expect(workspace.state.members[0].capacity).toBe(0);
    expect(workspace.state.projects[0]).toMatchObject({ status: "完了", demand: 0 });

    expect(() => normalizeWorkspace({ workspaceRevision: 2, ...boundary, members: boundary.members.map((member, index) => index === 0 ? { ...member, capacity: 101 } : member) })).toThrow("共有ワークスペースのデータ形式が正しくありません");
    expect(() => normalizeWorkspace({ workspaceRevision: 2, ...boundary, projects: boundary.projects.map((project, index) => index === 0 ? { ...project, demand: 10001 } : project) })).toThrow("共有ワークスペースのデータ形式が正しくありません");
  });

  it("does not send an unchanged demo leave row with a member-only update", () => {
    const changed = {
      ...initialWorkspace,
      members: initialWorkspace.members.map((member, index) => index === 0 ? { ...member, capacity: 80 } : member),
    };

    const payload = workspaceChangesPayload(changed, initialWorkspace, "admin");
    expect(payload.members?.upsert).toHaveLength(1);
    expect(payload.assignments).toBeUndefined();
    expect(payload.skillCatalog).toBeUndefined();
  });

  it("sends UUID skill catalog changes and keeps inferred names out of the payload", () => {
    const catalogId = "11111111-0000-4000-8000-000000000001";
    const previous = {
      ...initialWorkspace,
      skillCatalog: [{ id: catalogId, name: "Backend", kind: "category" as const }],
    };
    const changed = {
      ...previous,
      skillCatalog: [
        { id: catalogId, name: "Backend", kind: "category" as const },
        { id: "skill:graphql", name: "GraphQL", kind: "skill" as const, parentId: catalogId },
        { id: "22222222-0000-4000-8000-000000000002", name: "Platform", kind: "category" as const },
      ],
    };

    const payload = workspaceChangesPayload(changed, previous, "planner");
    expect(payload.skillCatalog?.upsert).toEqual([
      { id: "22222222-0000-4000-8000-000000000002", name: "Platform", kind: "category" },
    ]);
    expect(payload.skillCatalog?.archiveIds).toEqual([]);
  });

  it("sends UUID custom field catalog changes and rejects planner catalog edits", () => {
    const fieldId = "11111111-0000-4000-8000-000000000021";
    const previous = {
      ...initialWorkspace,
      customFields: [{ id: fieldId, entityType: "member" as const, key: "english", label: "英語", fieldType: "select" as const, options: ["日常会話"] }],
    };
    const changed = {
      ...previous,
      customFields: [
        { id: fieldId, entityType: "member" as const, key: "english", label: "英語", fieldType: "select" as const, options: ["日常会話"] },
        { id: "field:member:visa", entityType: "member" as const, key: "visa", label: "在留資格", fieldType: "text" as const },
        { id: "22222222-0000-4000-8000-000000000022", entityType: "project" as const, key: "client_name", label: "顧客名", fieldType: "text" as const },
      ],
    };

    const payload = workspaceChangesPayload(changed, previous, "admin");
    expect(payload.customFields?.upsert).toEqual([
      { id: "22222222-0000-4000-8000-000000000022", entityType: "project", key: "client_name", label: "顧客名", fieldType: "text" },
    ]);
    expect(() => workspaceChangesPayload(changed, previous, "planner")).toThrow("項目定義を保存できません");
  });

  it("includes opportunity and staffing-plan changes in the save payload", () => {
    const previous = initialWorkspace;
    const changed = {
      ...previous,
      opportunities: (previous.opportunities ?? []).map((item, index) => index === 0 ? { ...item, stage: "proposal" as const } : item),
      opportunityNeeds: (previous.opportunityNeeds ?? []).slice(1),
    };
    const payload = workspaceChangesPayload(changed, previous, "planner");
    expect(payload.opportunities?.upsert).toEqual([expect.objectContaining({ id: "opp-northwind", stage: "proposal" })]);
    expect(payload.opportunityNeeds?.cancelIds).toEqual(["opp-need-northwind-fe"]);
  });

  it("copies a converted opportunity into a project payload without assignments", () => {
    const converted = convertOpportunityToProject(initialWorkspace, "opp-northwind", {
      projectId: "00000000-0000-4000-8000-000000000101",
      needIdMap: {
        "opp-need-northwind-fe": "00000000-0000-4000-8000-000000000201",
        "opp-need-northwind-be": "00000000-0000-4000-8000-000000000202",
      },
    });
    const payload = workspaceChangesPayload(converted, initialWorkspace, "planner");
    expect(payload.projects?.upsert).toEqual([expect.objectContaining({
      id: "00000000-0000-4000-8000-000000000101",
      name: "北風商事 販売基盤",
      status: "準備中",
    })]);
    expect(payload.needs?.upsert).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "00000000-0000-4000-8000-000000000201", status: "open", draftPersonId: null }),
      expect.objectContaining({ id: "00000000-0000-4000-8000-000000000202", status: "open" }),
    ]));
    expect(payload.opportunities?.upsert).toEqual([expect.objectContaining({
      id: "opp-northwind",
      stage: "won",
      convertedProjectId: "00000000-0000-4000-8000-000000000101",
    })]);
    expect(payload.assignments).toBeUndefined();
  });

  it("sends UUID organization unit and membership changes and rejects planner catalog edits", () => {
    const unitId = "11111111-0000-4000-8000-000000000031";
    const membershipId = "11111111-0000-4000-8000-000000000041";
    const previous = {
      ...initialWorkspace,
      orgUnits: [{ id: unitId, name: "開発本部" }],
      orgMemberships: [],
    };
    const changed = {
      ...previous,
      orgUnits: [
        { id: unitId, name: "開発本部" },
        { id: "org:local", name: "ローカル部門" },
        { id: "22222222-0000-4000-8000-000000000032", name: "プロダクト開発", parentId: unitId },
      ],
      orgMemberships: [
        { id: membershipId, personId: previous.members[0].id, orgUnitId: "22222222-0000-4000-8000-000000000032", isPrimary: true, isManager: true },
      ],
    };

    const payload = workspaceChangesPayload(changed, previous, "admin");
    expect(payload.orgUnits?.upsert).toEqual([
      { id: "22222222-0000-4000-8000-000000000032", name: "プロダクト開発", parentId: unitId },
    ]);
    expect(payload.orgMemberships?.upsert).toEqual([
      { id: membershipId, personId: previous.members[0].id, orgUnitId: "22222222-0000-4000-8000-000000000032", isPrimary: true, isManager: true },
    ]);
    expect(() => workspaceChangesPayload(changed, previous, "planner")).toThrow("組織階層を保存できません");
  });

  it("sends UUID search scene changes and rejects planner catalog edits", () => {
    const sceneId = "11111111-0000-4000-8000-000000000031";
    const previous = {
      ...initialWorkspace,
      searchScenes: [{ id: sceneId, name: "既存シーン", role: "QA Engineer" }],
    };
    const changed = {
      ...previous,
      searchScenes: [
        { id: sceneId, name: "既存シーン", role: "QA Engineer" },
        { id: "scene-demo", name: "デモシーン", role: "Frontend Engineer" },
        { id: "22222222-0000-4000-8000-000000000032", name: "大阪バックエンド", role: "Backend Engineer", location: "大阪" },
      ],
    };

    const payload = workspaceChangesPayload(changed, previous, "admin");
    expect(payload.searchScenes?.upsert).toEqual([
      { id: "22222222-0000-4000-8000-000000000032", name: "大阪バックエンド", role: "Backend Engineer", location: "大阪" },
    ]);
    expect(() => workspaceChangesPayload(changed, previous, "planner")).toThrow("検索シーンを保存できません");
  });

  it("sends UUID saved report changes and rejects planner catalog edits", () => {
    const reportId = "11111111-0000-4000-8000-000000000041";
    const previous = {
      ...initialWorkspace,
      savedReports: [{ id: reportId, name: "既存レポート", source: "members" as const, groupBy: "department" as const, metric: "count" as const }],
    };
    const changed = {
      ...previous,
      savedReports: [
        { id: reportId, name: "既存レポート", source: "members" as const, groupBy: "department" as const, metric: "count" as const },
        { id: "report-demo", name: "デモレポート", source: "members" as const, groupBy: "role" as const, metric: "count" as const },
        { id: "22222222-0000-4000-8000-000000000042", name: "状態別件数", source: "projects" as const, groupBy: "status" as const, metric: "count" as const },
      ],
    };

    const payload = workspaceChangesPayload(changed, previous, "admin");
    expect(payload.savedReports?.upsert).toEqual([
      { id: "22222222-0000-4000-8000-000000000042", name: "状態別件数", source: "projects", groupBy: "status", metric: "count" },
    ]);
    expect(() => workspaceChangesPayload(changed, previous, "planner")).toThrow("レポート定義を保存できません");
  });

  it("creates a deterministic lowercase SHA-256 payload hash", async () => {
    const first = await sha256Hex({ beta: [2, 1], alpha: { y: true, x: "value" } });
    const second = await sha256Hex({ alpha: { x: "value", y: true }, beta: [2, 1] });

    expect(first).toBe(second);
    expect(first).toMatch(/^[0-9a-f]{64}$/);
  });

  it("rejects member mutations after a planner downgrade instead of silently dropping them", () => {
    const changed = {
      ...initialWorkspace,
      assignments: initialWorkspace.assignments.map((assignment, index) => index === 0 ? { ...assignment, allocation: 60 } : assignment),
      members: initialWorkspace.members.map((member, index) => index === 0 ? { ...member, name: "変更された氏名" } : member),
    };

    const adminPayload = workspaceChangesPayload(changed, initialWorkspace, "admin");

    expect(() => workspaceChangesPayload(changed, initialWorkspace, "planner")).toThrow("権限が変更されたため");
    expect(adminPayload.members?.upsert).toHaveLength(1);
    expect(adminPayload.assignments?.upsert).toHaveLength(1);
  });

  it("serializes a removed persisted assignment as a cancellation", () => {
    const removed = initialWorkspace.assignments[0];
    const changed = {
      ...initialWorkspace,
      assignments: initialWorkspace.assignments.filter((assignment) => assignment.id !== removed.id),
    };

    const payload = workspaceChangesPayload(changed, initialWorkspace, "planner");

    expect(payload.assignments?.upsert).toEqual([]);
    expect(payload.assignments?.cancelIds).toEqual([removed.id]);
  });

  it("sends a reopened staffing need with its linked assignment cancellation", () => {
    const originalAssignment = {
      ...initialWorkspace.assignments[0],
      staffingNeedId: initialWorkspace.needs[0].id,
    };
    const originalNeed = {
      ...initialWorkspace.needs[0],
      projectId: originalAssignment.projectId,
      startDate: originalAssignment.startDate,
      endDate: originalAssignment.endDate,
      allocation: originalAssignment.allocation,
      status: "filled" as const,
      draftPersonId: originalAssignment.personId,
    };
    const previous = {
      ...initialWorkspace,
      assignments: [originalAssignment, ...initialWorkspace.assignments.slice(1)],
      needs: [originalNeed, ...initialWorkspace.needs.slice(1)],
    };
    const changed = {
      ...previous,
      assignments: previous.assignments.filter((assignment) => assignment.id !== originalAssignment.id),
      needs: previous.needs.map((need) => need.id === originalNeed.id ? { ...need, status: "open" as const, draftPersonId: null } : need),
    };

    const payload = workspaceChangesPayload(changed, previous, "planner");

    expect(payload.assignments?.cancelIds).toEqual([originalAssignment.id]);
    expect(payload.needs?.upsert).toEqual([expect.objectContaining({ id: originalNeed.id, status: "open", draftPersonId: null })]);
  });

  it("sends a detached assignment update and reopened need in one payload", () => {
    const originalAssignment = {
      ...initialWorkspace.assignments[0],
      staffingNeedId: initialWorkspace.needs[0].id,
      clientRequestId: "00000000-0000-4000-8000-000000000020",
    };
    const originalNeed = {
      ...initialWorkspace.needs[0],
      projectId: originalAssignment.projectId,
      startDate: originalAssignment.startDate,
      endDate: originalAssignment.endDate,
      allocation: originalAssignment.allocation,
      status: "filled" as const,
      draftPersonId: originalAssignment.personId,
    };
    const previous = {
      ...initialWorkspace,
      assignments: [originalAssignment, ...initialWorkspace.assignments.slice(1)],
      needs: [originalNeed, ...initialWorkspace.needs.slice(1)],
    };
    const detached = {
      ...originalAssignment,
      allocation: 20,
      staffingNeedId: null,
      clientRequestId: null,
    };
    const changed = {
      ...previous,
      assignments: [detached, ...previous.assignments.slice(1)],
      needs: previous.needs.map((need) => need.id === originalNeed.id ? { ...need, status: "open" as const, draftPersonId: null } : need),
    };

    const payload = workspaceChangesPayload(changed, previous, "planner");

    expect(payload.assignments?.upsert).toEqual([detached]);
    expect(payload.assignments?.cancelIds).toEqual([]);
    expect(payload.needs?.upsert).toEqual([expect.objectContaining({ id: originalNeed.id, status: "open", draftPersonId: null })]);
  });

  it("preserves audit identity and derives a useful change summary", () => {
    const event = normalizeAuditEvent({
      id: 42,
      occurredAt: "2026-08-17T10:00:00Z",
      actorName: "管理 花子",
      action: "update",
      entityType: "projects",
      entityId: "00000000-0000-4000-8000-000000000002",
      workspaceRevision: 8,
      oldData: { name: "Atlas", status: "準備中" },
      newData: { name: "Atlas", status: "進行中" },
    }, 0);

    expect(event).toMatchObject({
      id: "42",
      action: "update",
      entityType: "projects",
      summary: "Atlasを更新",
      workspaceRevision: 8,
    });
  });

  it("normalizes an administrator-visible pending invitation", () => {
    expect(normalizeOrganizationInvitation({
      id: "00000000-0000-4000-8000-000000000010",
      organizationId: "00000000-0000-4000-8000-000000000002",
      email: "new.member@example.jp",
      role: "planner",
      status: "pending",
      expiresAt: "2026-08-24T10:00:00Z",
      invitedByName: "管理 花子",
    })).toMatchObject({
      email: "new.member@example.jp",
      role: "planner",
      status: "pending",
      invitedByName: "管理 花子",
    });
    expect(normalizeOrganizationInvitation({ id: "id", organizationId: "org", email: "owner@example.jp", role: "owner" })).toBeUndefined();
  });
});

describe("password recovery repository", () => {
  it("requests a reset email with the current app URL as redirectTo", async () => {
    const resetPasswordForEmail = vi.fn().mockResolvedValue({ data: {}, error: null });
    const repository = new ProductionRepository({
      auth: { resetPasswordForEmail },
    } as unknown as SupabaseClient);

    await repository.requestPasswordReset("  member@example.jp  ");

    expect(resetPasswordForEmail).toHaveBeenCalledWith("member@example.jp", {
      redirectTo: expect.stringMatching(/\/$/),
    });
  });

  it("does not reveal missing accounts when reset email lookup fails", async () => {
    const resetPasswordForEmail = vi.fn().mockResolvedValue({
      data: {},
      error: { code: "user_not_found", message: "User not found", status: 400 },
    });
    const repository = new ProductionRepository({
      auth: { resetPasswordForEmail },
    } as unknown as SupabaseClient);

    await expect(repository.requestPasswordReset("missing@example.jp")).resolves.toBeUndefined();
  });

  it("returns a generic retryable error when reset email sending is rate limited", async () => {
    const resetPasswordForEmail = vi.fn().mockResolvedValue({
      data: {},
      error: { code: "over_email_send_rate_limit", message: "email rate limit exceeded", status: 429 },
    });
    const repository = new ProductionRepository({
      auth: { resetPasswordForEmail },
    } as unknown as SupabaseClient);

    await expect(repository.requestPasswordReset("member@example.jp")).rejects.toMatchObject({
      retryable: true,
      message: expect.stringContaining("しばらくしてから"),
    });
  });

  it("updates the password without exposing the provider error text", async () => {
    const updateUser = vi.fn().mockResolvedValue({
      data: { user: {} },
      error: { code: "weak_password", message: "Password should contain at least one character of each: abcABC123.", status: 422 },
    });
    const repository = new ProductionRepository({
      auth: { updateUser },
    } as unknown as SupabaseClient);

    await expect(repository.updatePassword("short")).rejects.toMatchObject({
      code: "WEAK_PASSWORD",
    });
    await expect(repository.updatePassword("short")).rejects.toSatisfy((error: unknown) => error instanceof Error && !error.message.includes("abcABC123"));
  });
});

describe("organization invite function", () => {
  it("invites through the authenticated Edge Function with the app redirect URL", async () => {
    const invoke = vi.fn().mockResolvedValue({
      data: {
        invitation: {
          id: "00000000-0000-4000-8000-000000000010",
          organizationId: "00000000-0000-4000-8000-000000000002",
          email: "new.member@example.jp",
          role: "planner",
          expiresAt: "2026-08-26T10:00:00Z",
        },
        authInvite: "sent",
      },
      error: null,
    });
    const repository = new ProductionRepository({
      functions: { invoke },
    } as unknown as SupabaseClient);

    await expect(repository.inviteMember("00000000-0000-4000-8000-000000000002", "  New.Member@example.jp  ", "planner")).resolves.toMatchObject({
      email: "new.member@example.jp",
      role: "planner",
      authInvite: "sent",
    });
    expect(invoke).toHaveBeenCalledWith("invite", {
      body: {
        organizationId: "00000000-0000-4000-8000-000000000002",
        email: "new.member@example.jp",
        role: "planner",
        redirectTo: expect.stringMatching(/\/$/),
      },
    });
  });

  it("surfaces existing Auth accounts without exposing provider text", async () => {
    const invoke = vi.fn().mockResolvedValue({
      data: {
        invitation: { email: "owner@example.jp", role: "viewer" },
        authInvite: "existing",
      },
      error: null,
    });
    const repository = new ProductionRepository({
      functions: { invoke },
    } as unknown as SupabaseClient);

    await expect(repository.inviteMember("00000000-0000-4000-8000-000000000002", "owner@example.jp", "viewer")).resolves.toMatchObject({
      authInvite: "existing",
    });
  });

  it("maps function errors without repeating provider details", async () => {
    const invoke = vi.fn().mockResolvedValue({
      data: null,
      error: {
        context: {
          status: 403,
          json: vi.fn().mockResolvedValue({
            error: { code: "FORBIDDEN", message: "この組織で招待する権限がありません。", retryable: false },
          }),
        },
      },
    });
    const repository = new ProductionRepository({
      functions: { invoke },
    } as unknown as SupabaseClient);

    await expect(repository.inviteMember("00000000-0000-4000-8000-000000000002", "new@example.jp", "planner")).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(repository.inviteMember("00000000-0000-4000-8000-000000000002", "new@example.jp", "planner")).rejects.toSatisfy(
      (error: unknown) => error instanceof Error && !error.message.includes("service_role"),
    );
  });

  it("saves the display name then sets the first password during onboarding", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { displayName: "招待 花子" }, error: null });
    const updateUser = vi.fn().mockResolvedValue({ data: { user: {} }, error: null });
    const repository = new ProductionRepository({
      rpc,
      auth: { updateUser },
    } as unknown as SupabaseClient);

    await repository.completeOnboarding("  招待 花子  ", "NewPassword12");

    expect(rpc).toHaveBeenCalledWith("update_my_profile", { p_display_name: "招待 花子" });
    expect(updateUser).toHaveBeenCalledWith({
      password: "NewPassword12",
      data: { mosaic_invite: false, full_name: "招待 花子" },
    });
  });
});
