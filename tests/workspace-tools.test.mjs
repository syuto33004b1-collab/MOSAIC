import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildWorkspaceSaveRequest,
  detectWorkspaceFunctionCalls,
  parseWorkspaceToolCall,
  planWorkspaceAction,
  readWorkspaceTool,
  stableSha256,
  WorkspaceToolError,
  WORKSPACE_TOOL_DECLARATIONS,
} from "../supabase/functions/chat/workspace-tools.mjs";

const ids = {
  organization: "20000000-0000-4000-8000-000000000001",
  alice: "60000000-0000-4000-8000-000000000001",
  bob: "60000000-0000-4000-8000-000000000002",
  carol: "60000000-0000-4000-8000-000000000003",
  project: "62000000-0000-4000-8000-000000000001",
  secondProject: "62000000-0000-4000-8000-000000000002",
  need: "63000000-0000-4000-8000-000000000001",
  openNeed: "63000000-0000-4000-8000-000000000002",
  assignment: "64000000-0000-4000-8000-000000000001",
  secondAssignment: "64000000-0000-4000-8000-000000000002",
  generated: "65000000-0000-4000-8000-000000000001",
  request: "40000000-0000-4000-8000-000000000001",
};

function snapshot() {
  return {
    organization: { id: ids.organization, name: "MOSAIC", workspaceRevision: 7 },
    members: [
      {
        id: ids.alice,
        authUserId: "10000000-0000-4000-8000-000000000001",
        employeeCode: "E-001",
        initials: "AA",
        name: "Alice A",
        role: "Backend Engineer",
        department: "開発",
        avatarTone: "lavender",
        skills: ["API", "AWS"],
        location: "東京",
        capacity: 100,
      },
      {
        id: ids.bob,
        initials: "BB",
        name: "Bob B",
        role: "QA Engineer",
        department: "品質保証",
        avatarTone: "sky",
        skills: ["QA", "Mobile"],
        location: "大阪",
        capacity: 80,
      },
      {
        id: ids.carol,
        initials: "CC",
        name: "Carol C",
        role: "Project Manager",
        department: "事業推進",
        avatarTone: "mint",
        skills: ["PM"],
        location: "東京",
        capacity: 100,
      },
    ],
    projects: [
      {
        id: ids.project,
        code: "ATL",
        name: "Atlas",
        summary: "基幹システム刷新",
        status: "進行中",
        tone: "blue",
        ownerPersonId: ids.carol,
        ownerName: "Carol C",
        ownerInitials: "CC",
        startDate: "2026-08-01",
        endDate: "2026-08-31",
        nextMilestone: "レビュー",
        nextMilestoneDate: "2026-08-28",
        progress: 40,
        demand: 3,
      },
      {
        id: ids.secondProject,
        code: "NIM",
        name: "Nimbus",
        summary: "運用改善",
        status: "準備中",
        tone: "sky",
        ownerPersonId: null,
        ownerName: null,
        ownerInitials: null,
        startDate: "2026-08-01",
        endDate: "2026-09-30",
        nextMilestone: "キックオフ",
        nextMilestoneDate: "2026-08-20",
        progress: 10,
        demand: 2,
      },
    ],
    assignments: [
      {
        id: ids.assignment,
        personId: ids.alice,
        projectId: ids.project,
        staffingNeedId: ids.need,
        startDate: "2026-08-08",
        endDate: "2026-08-25",
        allocation: 50,
        status: "confirmed",
        label: "Backend",
        clientRequestId: "41000000-0000-4000-8000-000000000001",
      },
      {
        id: ids.secondAssignment,
        personId: ids.alice,
        projectId: ids.secondProject,
        staffingNeedId: null,
        startDate: "2026-08-01",
        endDate: "2026-08-31",
        allocation: 40,
        status: "confirmed",
        label: null,
      },
    ],
    needs: [
      {
        id: ids.need,
        projectId: ids.project,
        role: "Backend Engineer",
        skills: ["API"],
        startDate: "2026-08-10",
        endDate: "2026-08-20",
        allocation: 40,
        status: "filled",
        draftPersonId: ids.alice,
      },
      {
        id: ids.openNeed,
        projectId: ids.project,
        role: "QA Engineer",
        skills: ["QA", "Mobile"],
        startDate: "2026-08-15",
        endDate: "2026-08-25",
        allocation: 50,
        status: "open",
        draftPersonId: null,
      },
    ],
  };
}

function plannerOptions(toolName, args, overrides = {}) {
  return {
    snapshot: snapshot(),
    role: "planner",
    toolName,
    args,
    uuid: () => ids.generated,
    requestId: () => ids.request,
    ...overrides,
  };
}

test("declares the allowlisted Gemini Interactions workspace tools and detects current function_call steps", () => {
  assert.equal(WORKSPACE_TOOL_DECLARATIONS.length, 14);
  assert.equal(new Set(WORKSPACE_TOOL_DECLARATIONS.map((tool) => tool.name)).size, 14);
  assert.ok(WORKSPACE_TOOL_DECLARATIONS.every((tool) => tool.type === "function" && tool.parameters.additionalProperties === false));
  assert.deepEqual(detectWorkspaceFunctionCalls({
    steps: [
      { type: "thought", summary: [] },
      { type: "function_call", id: "fc_1", name: "read_workspace", arguments: { resource: "projects" } },
    ],
  }), [{ id: "fc_1", name: "read_workspace", arguments: { resource: "projects" } }]);
});

test("strictly validates tool names, unknown fields, IDs, dates, and read/write modes", () => {
  assert.deepEqual(parseWorkspaceToolCall("read_workspace", { resource: "members", limit: 5 }), {
    mode: "read",
    toolName: "read_workspace",
    args: { resource: "members", limit: 5 },
  });
  assert.equal(parseWorkspaceToolCall("create_project", { name: "New", startDate: "2026-09-01", endDate: "2026-09-30" }).mode, "write");
  assert.throws(() => parseWorkspaceToolCall("run_sql", {}), (error) => error instanceof WorkspaceToolError && error.code === "UNKNOWN_WORKSPACE_TOOL");
  assert.throws(() => parseWorkspaceToolCall("delete_member", { memberId: ids.bob, organizationId: ids.organization }), /未対応の項目/);
  assert.throws(() => parseWorkspaceToolCall("update_assignment", { assignmentId: "not-an-id", patch: { allocation: 20 } }), /ID形式/);
  assert.throws(() => parseWorkspaceToolCall("create_assignment", { personId: ids.bob, projectId: ids.project, startDate: "2026-08-30", endDate: "2026-08-01", allocation: 10 }), /終了日は開始日以降/);
  assert.throws(() => parseWorkspaceToolCall("create_assignment", { personId: ids.bob, projectId: ids.project, startDate: "2026-08-01", endDate: "2026-08-02", allocation: 101 }), /範囲/);
});

test("matches persisted percentage precision and clearly rejects unsupported owner clearing", () => {
  assert.equal(parseWorkspaceToolCall("create_assignment", {
    personId: ids.bob,
    projectId: ids.project,
    startDate: "2026-08-01",
    endDate: "2026-08-02",
    allocation: 33.33,
  }).args.allocation, 33.33);
  assert.throws(
    () => parseWorkspaceToolCall("create_member", { name: "D", role: "QA", department: "品質", location: "東京", capacity: 0.001, skills: [] }),
    /小数点以下2桁以内/,
  );
  assert.throws(
    () => parseWorkspaceToolCall("update_project", { projectId: ids.project, patch: { progress: 12.345 } }),
    /小数点以下2桁以内/,
  );
  assert.throws(
    () => parseWorkspaceToolCall("create_assignment", { personId: ids.bob, projectId: ids.project, startDate: "2026-08-01", endDate: "2026-08-02", allocation: 0.001 }),
    /小数点以下2桁以内/,
  );
  assert.throws(
    () => parseWorkspaceToolCall("create_staffing_need", { projectId: ids.project, role: "QA", skills: [], startDate: "2026-08-01", endDate: "2026-08-02", allocation: 0.001 }),
    /小数点以下2桁以内/,
  );
  assert.throws(
    () => parseWorkspaceToolCall("update_project", { projectId: ids.project, patch: { ownerPersonId: null } }),
    /未設定にする変更は現在非対応/,
  );
});

test("returns bounded, filtered, data-minimized workspace reads with availability", () => {
  const result = readWorkspaceTool(snapshot(), "read_workspace", {
    resource: "members",
    skills: ["API"],
    startDate: "2026-08-10",
    endDate: "2026-08-20",
    minAvailablePercent: 10,
    limit: 5,
  });
  assert.equal(result.revision, 7);
  assert.equal(result.total, 1);
  assert.deepEqual(result.items[0], {
    id: ids.alice,
    name: "Alice A",
    role: "Backend Engineer",
    department: "開発",
    location: "東京",
    skills: ["API", "AWS"],
    capacity: 100,
    peakAllocation: 90,
    availablePercent: 10,
  });
  assert.equal("authUserId" in result.items[0], false);
  assert.equal("employeeCode" in result.items[0], false);
});

test("enforces the organization role matrix before planning writes", async () => {
  const assignmentArgs = { personId: ids.bob, projectId: ids.secondProject, startDate: "2026-08-10", endDate: "2026-08-20", allocation: 30 };
  await assert.rejects(() => planWorkspaceAction(plannerOptions("create_assignment", assignmentArgs, { role: "viewer" })), (error) => error.code === "FORBIDDEN");
  await assert.rejects(() => planWorkspaceAction(plannerOptions("create_member", { name: "D", role: "QA", department: "品質", location: "東京", capacity: 100, skills: [] })), (error) => error.code === "FORBIDDEN");
  const adminPlan = await planWorkspaceAction(plannerOptions("create_member", { name: "D", role: "QA", department: "品質", location: "東京", capacity: 100, skills: [] }, { role: "admin" }));
  assert.equal(adminPlan.payload.members.upsert[0].name, "D");
});

test("plans a confirmed assignment with server IDs, deterministic hash, overload warning, and RPC arguments", async () => {
  const plan = await planWorkspaceAction(plannerOptions("create_assignment", {
    personId: ids.alice,
    projectId: ids.secondProject,
    startDate: "2026-08-10",
    endDate: "2026-08-20",
    allocation: 20,
    label: "支援",
  }));
  assert.equal(plan.kind, "workspace_action");
  assert.equal(plan.expectedRevision, 7);
  assert.equal(plan.payload.assignments.upsert[0].status, "confirmed");
  assert.equal(plan.payload.assignments.upsert[0].id, ids.generated);
  assert.equal(plan.payload.assignments.upsert[0].clientRequestId, ids.request);
  assert.match(plan.payloadHash, /^[0-9a-f]{64}$/);
  assert.match(plan.preview.impacts.join(" "), /上限100%を超え/);
  assert.deepEqual(buildWorkspaceSaveRequest(plan), {
    p_organization_id: ids.organization,
    p_expected_revision: 7,
    p_request_id: ids.request,
    p_payload: plan.payload,
    p_payload_hash: plan.payloadHash,
  });
});

test("fills an open staffing need and creates its confirmed assignment atomically", async () => {
  const plan = await planWorkspaceAction(plannerOptions("assign_person_to_need", {
    staffingNeedId: ids.openNeed,
    personId: ids.bob,
  }));
  assert.equal(plan.payload.needs.upsert.length, 1);
  const need = plan.payload.needs.upsert.find((item) => item.id === ids.openNeed);
  const assignment = plan.payload.assignments.upsert.find((item) => item.staffingNeedId === ids.openNeed);
  assert.equal(need.status, "filled");
  assert.equal(need.draftPersonId, ids.bob);
  assert.equal(assignment.status, "confirmed");
  assert.equal(assignment.personId, ids.bob);
  assert.equal(assignment.clientRequestId, ids.request);
});

test("plans the remaining create, update, and cancel routes with server-owned defaults", async () => {
  const projectPlan = await planWorkspaceAction(plannerOptions("create_project", {
    name: "新基盤",
    startDate: "2026-09-01",
    endDate: "2026-09-30",
  }));
  assert.equal(projectPlan.payload.projects.upsert[0].id, ids.generated);
  assert.equal(projectPlan.payload.projects.upsert[0].status, "準備中");
  assert.match(projectPlan.payload.projects.upsert[0].code, /^PJ-/);

  const needPlan = await planWorkspaceAction(plannerOptions("create_staffing_need", {
    projectId: ids.secondProject,
    role: "QA Engineer",
    skills: ["QA"],
    startDate: "2026-09-01",
    endDate: "2026-09-15",
    allocation: 30,
  }));
  assert.equal(needPlan.payload.needs.upsert[0].status, "open");
  assert.equal(needPlan.payload.needs.upsert[0].draftPersonId, null);

  const renamePlan = await planWorkspaceAction(plannerOptions("update_member", {
    memberId: ids.carol,
    patch: { name: "Carol Changed" },
  }, { role: "admin" }));
  assert.equal(renamePlan.payload.members.upsert[0].name, "Carol Changed");
  assert.equal(renamePlan.payload.projects.upsert[0].ownerName, "Carol Changed");

  const assignmentCancelPlan = await planWorkspaceAction(plannerOptions("delete_assignment", { assignmentId: ids.assignment }));
  assert.deepEqual(assignmentCancelPlan.payload.assignments.cancelIds, [ids.assignment]);
  assert.equal(assignmentCancelPlan.payload.needs.upsert[0].status, "open");

  const needCancelPlan = await planWorkspaceAction(plannerOptions("delete_staffing_need", { staffingNeedId: ids.need }));
  assert.deepEqual(needCancelPlan.payload.needs.cancelIds, [ids.need]);
  assert.deepEqual(needCancelPlan.payload.assignments.cancelIds, [ids.assignment]);
});

test("rejects invalid staffing candidates and periods before creating a proposal", async () => {
  await assert.rejects(
    () => planWorkspaceAction(plannerOptions("assign_person_to_need", { staffingNeedId: ids.openNeed, personId: ids.alice })),
    (error) => error.code === "MEMBER_DOES_NOT_MATCH_NEED",
  );
  await assert.rejects(
    () => planWorkspaceAction(plannerOptions("create_staffing_need", {
      projectId: ids.project,
      role: "QA Engineer",
      skills: [],
      startDate: "2026-08-20",
      endDate: "2026-09-05",
      allocation: 30,
    })),
    (error) => error.code === "WORKSPACE_VALIDATION_FAILED",
  );
});

test("archives a non-owner member with assignment cancellation and need reopening", async () => {
  const plan = await planWorkspaceAction(plannerOptions("delete_member", { memberId: ids.alice }, { role: "owner" }));
  assert.deepEqual(plan.payload.members.archiveIds, [ids.alice]);
  assert.deepEqual(new Set(plan.payload.assignments.cancelIds), new Set([ids.assignment, ids.secondAssignment]));
  assert.equal(plan.payload.needs.upsert.length, 1);
  const reopened = plan.payload.needs.upsert.find((need) => need.id === ids.need);
  assert.equal(reopened.status, "open");
  assert.equal(reopened.draftPersonId, null);
  assert.equal(plan.preview.destructive, true);
  await assert.rejects(
    () => planWorkspaceAction(plannerOptions("delete_member", { memberId: ids.carol }, { role: "owner" })),
    (error) => error.code === "MEMBER_OWNS_PROJECT",
  );
});

test("archives a project with all related assignments and staffing needs", async () => {
  const plan = await planWorkspaceAction(plannerOptions("delete_project", { projectId: ids.project }));
  assert.deepEqual(plan.payload.projects.archiveIds, [ids.project]);
  assert.deepEqual(plan.payload.assignments.cancelIds, [ids.assignment]);
  assert.deepEqual(new Set(plan.payload.needs.cancelIds), new Set([ids.need, ids.openNeed]));
  assert.match(plan.preview.impacts.join(" "), /関連アサイン/);
});

test("keeps update cascades consistent for project periods, linked assignments, and staffing needs", async () => {
  const projectPlan = await planWorkspaceAction(plannerOptions("update_project", {
    projectId: ids.project,
    patch: { endDate: "2026-08-12", nextMilestoneDate: null },
  }));
  assert.deepEqual(projectPlan.payload.assignments.cancelIds, [ids.assignment]);
  assert.deepEqual(new Set(projectPlan.payload.needs.cancelIds), new Set([ids.need, ids.openNeed]));

  const assignmentPlan = await planWorkspaceAction(plannerOptions("update_assignment", {
    assignmentId: ids.assignment,
    patch: { allocation: 20 },
  }));
  const detached = assignmentPlan.payload.assignments.upsert[0];
  const reopenedFromAssignment = assignmentPlan.payload.needs.upsert.find((need) => need.id === ids.need);
  assert.equal(detached.staffingNeedId, null);
  assert.equal(detached.clientRequestId, null);
  assert.equal(reopenedFromAssignment.status, "open");

  const needPlan = await planWorkspaceAction(plannerOptions("update_staffing_need", {
    staffingNeedId: ids.need,
    patch: { role: "QA Engineer" },
  }));
  assert.deepEqual(needPlan.payload.assignments.cancelIds, [ids.assignment]);
  const reopenedFromNeed = needPlan.payload.needs.upsert.find((need) => need.id === ids.need);
  assert.equal(reopenedFromNeed.status, "open");
  assert.equal(reopenedFromNeed.draftPersonId, null);

  const reassignmentSnapshot = snapshot();
  reassignmentSnapshot.members = reassignmentSnapshot.members.map((member) => member.id === ids.bob ? {
    ...member,
    role: "Backend Engineer",
    skills: ["API", "AWS"],
    capacity: 100,
  } : member);
  const reassignmentPlan = await planWorkspaceAction(plannerOptions("update_assignment", {
    assignmentId: ids.assignment,
    patch: { personId: ids.bob },
  }, { snapshot: reassignmentSnapshot }));
  const reassignedNeed = reassignmentPlan.payload.needs.upsert.find((need) => need.id === ids.need);
  assert.equal(reassignedNeed.status, "filled");
  assert.equal(reassignedNeed.draftPersonId, ids.bob);
});

test("reopens a linked need when an assignment edit exceeds the replacement member capacity", async () => {
  const constrained = snapshot();
  constrained.members = constrained.members.map((member) => member.id === ids.bob ? {
    ...member,
    role: "Backend Engineer",
    skills: ["API", "AWS"],
    capacity: 40,
  } : member);
  const plan = await planWorkspaceAction(plannerOptions("update_assignment", {
    assignmentId: ids.assignment,
    patch: { personId: ids.bob },
  }, { snapshot: constrained }));
  const detached = plan.payload.assignments.upsert.find((assignment) => assignment.id === ids.assignment);
  const reopened = plan.payload.needs.upsert.find((need) => need.id === ids.need);
  assert.equal(detached.staffingNeedId, null);
  assert.equal(detached.clientRequestId, null);
  assert.equal(reopened.status, "open");
  assert.equal(reopened.draftPersonId, null);
});

test("treats skill order and casing as a set and preserves custom initials on a same-name patch", async () => {
  await assert.rejects(
    () => planWorkspaceAction(plannerOptions("update_member", {
      memberId: ids.alice,
      patch: { skills: ["aws", "api"] },
    }, { role: "admin" })),
    (error) => error.code === "NO_WORKSPACE_CHANGES",
  );
  await assert.rejects(
    () => planWorkspaceAction(plannerOptions("update_staffing_need", {
      staffingNeedId: ids.openNeed,
      patch: { skills: ["mobile", "qa"] },
    })),
    (error) => error.code === "NO_WORKSPACE_CHANGES",
  );

  const customized = snapshot();
  customized.members = customized.members.map((member) => member.id === ids.alice ? { ...member, initials: "AX" } : member);
  const plan = await planWorkspaceAction(plannerOptions("update_member", {
    memberId: ids.alice,
    patch: { name: "Alice A", department: "基盤開発" },
  }, { role: "admin", snapshot: customized }));
  const updated = plan.payload.members.upsert.find((member) => member.id === ids.alice);
  assert.equal(updated.initials, "AX");
  assert.equal(updated.department, "基盤開発");
});

test("lists every update field as a Japanese-labelled before and after value", async () => {
  const asMap = (plan) => new Map(plan.preview.details.map((detail) => [detail.label, detail.value]));

  const memberPlan = await planWorkspaceAction(plannerOptions("update_member", {
    memberId: ids.alice,
    patch: {
      name: "Alicia A",
      role: "Platform Engineer",
      department: "基盤開発",
      location: "リモート",
      skills: ["Go", "Kubernetes"],
      capacity: 90.5,
      initials: "AL",
      avatarTone: "peach",
    },
  }, { role: "admin" }));
  const memberDetails = asMap(memberPlan);
  assert.equal(memberDetails.size, 8);
  assert.equal(memberDetails.get("氏名"), "Alice A → Alicia A");
  assert.equal(memberDetails.get("スキル"), "API, AWS → Go, Kubernetes");
  assert.equal(memberDetails.get("稼働上限"), "100% → 90.5%");

  const projectPlan = await planWorkspaceAction(plannerOptions("update_project", {
    projectId: ids.project,
    patch: {
      code: "ATX",
      name: "Atlas Next",
      summary: "",
      status: "要注意",
      tone: "mint",
      ownerPersonId: ids.alice,
      startDate: "2026-08-02",
      endDate: "2026-09-30",
      nextMilestone: "",
      nextMilestoneDate: null,
      progress: 55.5,
      demand: 4,
    },
  }));
  const projectDetails = asMap(projectPlan);
  assert.equal(projectDetails.size, 12);
  assert.equal(projectDetails.get("責任者"), "Carol C → Alice A");
  assert.equal(projectDetails.get("概要"), "基幹システム刷新 → 未設定");
  assert.equal(projectDetails.get("マイルストーン日"), "2026-08-28 → 未設定");
  assert.equal(projectDetails.get("必要人数"), "3名 → 4名");

  const reassignmentSnapshot = snapshot();
  reassignmentSnapshot.members = reassignmentSnapshot.members.map((member) => member.id === ids.bob ? {
    ...member,
    role: "Backend Engineer",
    skills: ["API", "AWS"],
    capacity: 100,
  } : member);
  const assignmentPlan = await planWorkspaceAction(plannerOptions("update_assignment", {
    assignmentId: ids.assignment,
    patch: {
      personId: ids.bob,
      projectId: ids.secondProject,
      startDate: "2026-08-05",
      endDate: "2026-08-28",
      allocation: 60,
      label: null,
    },
  }, { snapshot: reassignmentSnapshot }));
  const assignmentDetails = asMap(assignmentPlan);
  assert.equal(assignmentDetails.size, 7);
  assert.equal(assignmentDetails.get("メンバー"), "Alice A → Bob B");
  assert.equal(assignmentDetails.get("プロジェクト"), "Atlas → Nimbus");
  assert.equal(assignmentDetails.get("ラベル"), "Backend → 未設定");
  assert.equal(assignmentDetails.get("要員要件との紐づけ"), "Atlas / Backend Engineer → 未設定");

  const needPlan = await planWorkspaceAction(plannerOptions("update_staffing_need", {
    staffingNeedId: ids.need,
    patch: {
      projectId: ids.secondProject,
      role: "QA Engineer",
      skills: ["QA", "Mobile"],
      startDate: "2026-09-01",
      endDate: "2026-09-10",
      allocation: 30,
    },
  }));
  const needDetails = asMap(needPlan);
  assert.equal(needDetails.size, 8);
  assert.equal(needDetails.get("プロジェクト"), "Atlas → Nimbus");
  assert.equal(needDetails.get("必要スキル"), "API → QA, Mobile");
  assert.equal(needDetails.get("状態"), "充足済み → 未充足");
  assert.equal(needDetails.get("担当候補"), "Alice A → 未設定");
});

test("rejects no-op updates instead of incrementing the workspace revision", async () => {
  await assert.rejects(
    () => planWorkspaceAction(plannerOptions("update_member", { memberId: ids.alice, patch: { name: "Alice A" } }, { role: "admin" })),
    (error) => error.code === "NO_WORKSPACE_CHANGES",
  );
});

test("stable hashing is independent of object key insertion order", async () => {
  const first = await stableSha256({ beta: [2, 1], alpha: { y: true, x: "value" } });
  const second = await stableSha256({ alpha: { x: "value", y: true }, beta: [2, 1] });
  assert.equal(first, second);
  assert.match(first, /^[0-9a-f]{64}$/);
});
