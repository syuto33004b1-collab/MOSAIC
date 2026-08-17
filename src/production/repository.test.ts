import type { SupabaseClient, User } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { initialWorkspace } from "../domain";
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
