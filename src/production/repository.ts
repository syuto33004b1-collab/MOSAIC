import type { AuthError, PostgrestError, SupabaseClient, User } from "@supabase/supabase-js";
import type { Assignment, CustomFieldDefinition, CustomFieldEntity, CustomFieldType, Member, Opportunity, OpportunityNeed, OpportunityStage, Project, SkillDefinition, SkillKind, StaffingNeed, WorkHistoryEntry, WorkspaceState } from "../domain";
import { hydrateWorkspaceSkills, OPPORTUNITY_STAGES, normalizeSkillProficiency, normalizeWorkHistory } from "../domain";
import { appAuthRedirectUrl } from "./authRecovery";
import {
  ProductionRepositoryError,
  WorkspaceConflictError,
  type AcceptInvitationResult,
  type AuditEvent,
  type AuditEventPage,
  type InvitationResult,
  type MyContext,
  type OrganizationMember,
  type OrganizationInvitation,
  type OrganizationRole,
  type OrganizationSummary,
  type PendingInvitation,
  type SaveWorkspacePayload,
  type SaveWorkspaceResult,
  type RevokeInvitationResult,
  type WorkspaceEnvelope,
} from "./types";

type UnknownRecord = Record<string, unknown>;

const roleValues = new Set<OrganizationRole>(["owner", "admin", "planner", "viewer"]);
const avatarTones = new Set<Member["avatarTone"]>(["lavender", "peach", "sky", "mint", "sand", "rose"]);
const projectTones = new Set<Project["tone"]>(["blue", "mint", "orange", "plum", "sky"]);
const projectStatuses = new Set<Project["status"]>(["進行中", "要注意", "準備中", "完了間近", "完了"]);
const assignmentStatuses = new Set<Assignment["status"]>(["confirmed", "draft"]);
const needStatuses = new Set<StaffingNeed["status"]>(["open", "planned", "filled"]);
const opportunityStages = new Set<OpportunityStage>(OPPORTUNITY_STAGES);
const customFieldEntities = new Set<CustomFieldEntity>(["member", "project"]);
const customFieldTypes = new Set<CustomFieldType>(["text", "number", "date", "select"]);
const isoDatePattern = /^\d{4}-\d{2}-\d{2}$/;

function asRecord(value: unknown): UnknownRecord | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as UnknownRecord : undefined;
}

function unwrapRpcValue(value: unknown) {
  if (Array.isArray(value) && value.length === 1) return value[0];
  return value;
}

function readString(record: UnknownRecord | undefined, ...keys: string[]) {
  for (const key of keys) {
    const value = record?.[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  return undefined;
}

function readNumber(record: UnknownRecord | undefined, ...keys: string[]) {
  for (const key of keys) {
    const value = record?.[key];
    const number = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
    if (Number.isSafeInteger(number) && number >= 0) return number;
  }
  return undefined;
}

function readIdentifier(record: UnknownRecord | undefined, ...keys: string[]) {
  for (const key of keys) {
    const value = record?.[key];
    if (typeof value === "string" && value) return value;
    if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return String(value);
  }
  return undefined;
}

function readArray(record: UnknownRecord | undefined, ...keys: string[]): unknown[] {
  for (const key of keys) {
    const value = record?.[key];
    if (Array.isArray(value)) return value;
  }
  return [];
}

function normalizeRole(value: unknown): OrganizationRole {
  return typeof value === "string" && roleValues.has(value as OrganizationRole) ? value as OrganizationRole : "viewer";
}

function optionalString(record: UnknownRecord, key: string) {
  const value = record[key];
  return typeof value === "string" && value ? value : undefined;
}

function nullableString(record: UnknownRecord, key: string) {
  const value = record[key];
  return value === null ? null : typeof value === "string" ? value : undefined;
}

function finiteNumber(record: UnknownRecord, key: string) {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function validDate(value: unknown): value is string {
  return typeof value === "string" && isoDatePattern.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}

function normalizeIncomingCustomValues(value: unknown): Record<string, string> | null {
  const record = asRecord(value);
  if (!record) return null;
  const next: Record<string, string> = {};
  for (const [key, raw] of Object.entries(record)) {
    if (typeof raw !== "string") return null;
    const trimmed = raw.trim();
    if (trimmed) next[key] = trimmed;
  }
  return next;
}

function normalizeIncomingWorkHistory(value: unknown): WorkHistoryEntry[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) return undefined;
  try {
    return normalizeWorkHistory(value.map((entry) => {
      const record = asRecord(entry);
      const id = readString(record, "id");
      const title = readString(record, "title");
      const organization = readString(record, "organization");
      if (!id || !title || !organization || !record || !validDate(record.startDate)) {
        throw new Error("invalid work history");
      }
      return {
        id,
        title,
        organization,
        startDate: record.startDate,
        endDate: record.endDate === null || record.endDate === undefined || record.endDate === "" ? null : validDate(record.endDate) ? record.endDate : undefined,
        description: optionalString(record, "description"),
      };
    }));
  } catch {
    return undefined;
  }
}

function normalizeCustomFieldDefinition(value: unknown): CustomFieldDefinition | undefined {
  const record = asRecord(value);
  if (!record) return undefined;
  const id = readString(record, "id");
  const key = readString(record, "key");
  const label = readString(record, "label");
  const entityType = record.entityType;
  const fieldType = record.fieldType;
  if (!id || !key || !label || !customFieldEntities.has(entityType as CustomFieldEntity) || !customFieldTypes.has(fieldType as CustomFieldType)) {
    return undefined;
  }
  const options = readArray(record, "options").flatMap((option) => typeof option === "string" && option.trim() ? [option.trim()] : []);
  const sortOrder = finiteNumber(record, "sortOrder");
  return {
    id,
    entityType: entityType as CustomFieldEntity,
    key,
    label,
    fieldType: fieldType as CustomFieldType,
    ...(record.required === true ? { required: true } : {}),
    ...(options.length ? { options } : {}),
    ...(record.showInList === true ? { showInList: true } : {}),
    ...(record.showInDetail === false ? { showInDetail: false } : { showInDetail: true }),
    ...(record.searchable === false ? { searchable: false } : { searchable: true }),
    ...(sortOrder !== undefined ? { sortOrder } : {}),
  };
}

function normalizeWorkspaceMember(value: unknown): Member | undefined {
  const record = asRecord(value);
  if (!record) return undefined;
  const id = readString(record, "id");
  const initials = readString(record, "initials");
  const name = readString(record, "name");
  const role = readString(record, "role");
  const department = readString(record, "department");
  const location = readString(record, "location");
  const capacity = finiteNumber(record, "capacity");
  const avatarTone = record.avatarTone;
  const skills = record.skills;
  if (!id || !initials || !name || !role || !department || !location || capacity === undefined || capacity < 0 || capacity > 100) return undefined;
  if (typeof avatarTone !== "string" || !avatarTones.has(avatarTone as Member["avatarTone"])) return undefined;
  if (!Array.isArray(skills) || skills.some((skill) => typeof skill !== "string" || !skill.trim())) return undefined;
  const skillLevels = readArray(record, "skillLevels").flatMap((value) => {
    const level = asRecord(value);
    const skillName = readString(level, "name");
    const proficiency = level ? normalizeSkillProficiency(level.proficiency) : undefined;
    return skillName && proficiency ? [{ name: skillName, proficiency }] : [];
  });
  const customValues = record.customValues === undefined ? undefined : normalizeIncomingCustomValues(record.customValues);
  if (record.customValues !== undefined && customValues === null) return undefined;
  const workHistory = record.workHistory === undefined ? undefined : normalizeIncomingWorkHistory(record.workHistory);
  if (record.workHistory !== undefined && workHistory === undefined) return undefined;
  return {
    id,
    initials,
    name,
    role,
    department,
    location,
    capacity,
    avatarTone: avatarTone as Member["avatarTone"],
    skills: skills as string[],
    ...(skillLevels.length ? { skillLevels } : {}),
    ...(customValues && Object.keys(customValues).length ? { customValues } : {}),
    ...(workHistory ? { workHistory } : {}),
  };
}

function normalizeWorkspaceProject(value: unknown): Project | undefined {
  const record = asRecord(value);
  if (!record) return undefined;
  const id = readString(record, "id");
  const code = readString(record, "code");
  const name = readString(record, "name");
  const summary = typeof record.summary === "string" ? record.summary : undefined;
  const status = record.status;
  const tone = record.tone;
  const progress = finiteNumber(record, "progress");
  const demand = finiteNumber(record, "demand");
  const nextMilestone = typeof record.nextMilestone === "string" ? record.nextMilestone : undefined;
  if (!id || !code || !name || summary === undefined || nextMilestone === undefined || progress === undefined || progress < 0 || progress > 100 || demand === undefined || demand < 0 || demand > 10000) return undefined;
  if (typeof status !== "string" || !projectStatuses.has(status as Project["status"])) return undefined;
  if (typeof tone !== "string" || !projectTones.has(tone as Project["tone"])) return undefined;
  if (!validDate(record.startDate) || !validDate(record.endDate) || record.startDate > record.endDate) return undefined;
  if (record.nextMilestoneDate !== null && record.nextMilestoneDate !== undefined && !validDate(record.nextMilestoneDate)) return undefined;
  const customValues = record.customValues === undefined ? undefined : normalizeIncomingCustomValues(record.customValues);
  if (record.customValues !== undefined && customValues === null) return undefined;
  return {
    id,
    code,
    name,
    summary,
    status: status as Project["status"],
    tone: tone as Project["tone"],
    ownerPersonId: optionalString(record, "ownerPersonId"),
    ownerName: nullableString(record, "ownerName"),
    ownerInitials: nullableString(record, "ownerInitials"),
    startDate: record.startDate,
    endDate: record.endDate,
    nextMilestone,
    nextMilestoneDate: record.nextMilestoneDate as string | null | undefined,
    progress,
    demand,
    ...(customValues && Object.keys(customValues).length ? { customValues } : {}),
  };
}

function normalizeWorkspaceAssignment(value: unknown): Assignment | undefined {
  const record = asRecord(value);
  if (!record) return undefined;
  const id = readString(record, "id");
  const personId = readString(record, "personId");
  const projectId = readString(record, "projectId");
  const allocation = finiteNumber(record, "allocation");
  const status = record.status;
  if (!id || !personId || !projectId || allocation === undefined || allocation <= 0 || allocation > 100) return undefined;
  if (typeof status !== "string" || !assignmentStatuses.has(status as Assignment["status"])) return undefined;
  if (!validDate(record.startDate) || !validDate(record.endDate) || record.startDate > record.endDate) return undefined;
  return {
    id,
    personId,
    projectId,
    startDate: record.startDate,
    endDate: record.endDate,
    allocation,
    status: status as Assignment["status"],
    label: optionalString(record, "label"),
    staffingNeedId: nullableString(record, "staffingNeedId"),
    clientRequestId: nullableString(record, "clientRequestId"),
  };
}

function normalizeWorkspaceNeed(value: unknown): StaffingNeed | undefined {
  const record = asRecord(value);
  if (!record) return undefined;
  const id = readString(record, "id");
  const projectId = readString(record, "projectId");
  const role = readString(record, "role");
  const allocation = finiteNumber(record, "allocation");
  const status = record.status;
  const skills = record.skills;
  if (!id || !projectId || !role || allocation === undefined || allocation <= 0 || allocation > 100) return undefined;
  if (typeof status !== "string" || !needStatuses.has(status as StaffingNeed["status"])) return undefined;
  if (!validDate(record.startDate) || !validDate(record.endDate) || record.startDate > record.endDate) return undefined;
  if (!Array.isArray(skills) || skills.some((skill) => typeof skill !== "string" || !skill.trim())) return undefined;
  return {
    id,
    projectId,
    role,
    skills: skills as string[],
    skillRequirements: readArray(record, "skillRequirements").flatMap((value) => {
      const requirement = asRecord(value);
      const skillName = readString(requirement, "name");
      const minProficiency = requirement ? normalizeSkillProficiency(requirement.minProficiency, 1) : undefined;
      return skillName && minProficiency ? [{ name: skillName, minProficiency }] : [];
    }),
    startDate: record.startDate,
    endDate: record.endDate,
    allocation,
    status: status as StaffingNeed["status"],
    draftPersonId: nullableString(record, "draftPersonId"),
  };
}

function normalizeWorkspaceOpportunity(value: unknown): Opportunity | undefined {
  const record = asRecord(value);
  if (!record) return undefined;
  const id = readString(record, "id");
  const code = readString(record, "code");
  const name = readString(record, "name");
  const summary = typeof record.summary === "string" ? record.summary : undefined;
  const stage = record.stage;
  const tone = record.tone;
  const demand = finiteNumber(record, "demand");
  if (!id || !code || !name || summary === undefined || demand === undefined || demand < 0 || demand > 10000) return undefined;
  if (typeof stage !== "string" || !opportunityStages.has(stage as OpportunityStage)) return undefined;
  if (typeof tone !== "string" || !projectTones.has(tone as Opportunity["tone"])) return undefined;
  if (!validDate(record.startDate) || !validDate(record.endDate) || record.startDate > record.endDate) return undefined;
  if (record.convertedProjectId !== null && record.convertedProjectId !== undefined && typeof record.convertedProjectId !== "string") return undefined;
  const convertedProjectId = nullableString(record, "convertedProjectId");
  return {
    id,
    code,
    name,
    summary,
    stage: stage as OpportunityStage,
    tone: tone as Opportunity["tone"],
    ownerPersonId: optionalString(record, "ownerPersonId"),
    ownerName: nullableString(record, "ownerName"),
    ownerInitials: nullableString(record, "ownerInitials"),
    startDate: record.startDate,
    endDate: record.endDate,
    demand,
    ...(convertedProjectId ? { convertedProjectId } : {}),
  };
}

function normalizeWorkspaceOpportunityNeed(value: unknown): OpportunityNeed | undefined {
  const record = asRecord(value);
  if (!record) return undefined;
  const id = readString(record, "id");
  const opportunityId = readString(record, "opportunityId");
  const role = readString(record, "role");
  const allocation = finiteNumber(record, "allocation");
  const skills = record.skills;
  if (!id || !opportunityId || !role || allocation === undefined || allocation <= 0 || allocation > 100) return undefined;
  if (!validDate(record.startDate) || !validDate(record.endDate) || record.startDate > record.endDate) return undefined;
  if (!Array.isArray(skills) || skills.some((skill) => typeof skill !== "string" || !skill.trim())) return undefined;
  return {
    id,
    opportunityId,
    role,
    skills: skills as string[],
    skillRequirements: readArray(record, "skillRequirements").flatMap((value) => {
      const requirement = asRecord(value);
      const skillName = readString(requirement, "name");
      const minProficiency = requirement ? normalizeSkillProficiency(requirement.minProficiency, 1) : undefined;
      return skillName && minProficiency ? [{ name: skillName, minProficiency }] : [];
    }),
    startDate: record.startDate,
    endDate: record.endDate,
    allocation,
  };
}

function normalizeSkillDefinition(value: unknown): SkillDefinition | undefined {
  const record = asRecord(value);
  if (!record) return undefined;
  const id = readString(record, "id");
  const name = readString(record, "name");
  const kind = record.kind;
  if (!id || !name || (kind !== "category" && kind !== "skill")) return undefined;
  const parentId = nullableString(record, "parentId");
  const sortOrder = finiteNumber(record, "sortOrder");
  return {
    id,
    name,
    kind: kind as SkillKind,
    parentId,
    ...(sortOrder !== undefined ? { sortOrder } : {}),
  };
}

function normalizeWorkspaceState(value: unknown): WorkspaceState | undefined {
  const record = asRecord(value);
  if (!record || !Array.isArray(record.members) || !Array.isArray(record.projects) || !Array.isArray(record.assignments) || !Array.isArray(record.needs)) return undefined;
  const members = record.members.map(normalizeWorkspaceMember);
  const projects = record.projects.map(normalizeWorkspaceProject);
  const assignments = record.assignments.map(normalizeWorkspaceAssignment);
  const needs = record.needs.map(normalizeWorkspaceNeed);
  if ([...members, ...projects, ...assignments, ...needs].some((item) => !item)) return undefined;
  const memberIds = new Set((members as Member[]).map((member) => member.id));
  const projectIds = new Set((projects as Project[]).map((project) => project.id));
  const assignmentIds = new Set((assignments as Assignment[]).map((assignment) => assignment.id));
  const needIds = new Set((needs as StaffingNeed[]).map((need) => need.id));
  if (memberIds.size !== members.length || projectIds.size !== projects.length || assignmentIds.size !== assignments.length || needIds.size !== needs.length) return undefined;
  if ((assignments as Assignment[]).some((assignment) => !memberIds.has(assignment.personId) || !projectIds.has(assignment.projectId))) return undefined;
  if ((needs as StaffingNeed[]).some((need) => !projectIds.has(need.projectId))) return undefined;
  const opportunityValues = record.opportunities === undefined ? [] : readArray(record, "opportunities").map(normalizeWorkspaceOpportunity);
  const opportunityNeedValues = record.opportunityNeeds === undefined ? [] : readArray(record, "opportunityNeeds").map(normalizeWorkspaceOpportunityNeed);
  if (opportunityValues.some((item) => !item) || opportunityNeedValues.some((item) => !item)) return undefined;
  const opportunities = opportunityValues as Opportunity[];
  const opportunityNeeds = opportunityNeedValues as OpportunityNeed[];
  const opportunityIds = new Set(opportunities.map((item) => item.id));
  if (opportunityIds.size !== opportunities.length) return undefined;
  const opportunityNeedIds = new Set(opportunityNeeds.map((item) => item.id));
  if (opportunityNeedIds.size !== opportunityNeeds.length) return undefined;
  if (opportunityNeeds.some((need) => !opportunityIds.has(need.opportunityId))) return undefined;
  if (opportunities.some((opportunity) => opportunity.convertedProjectId && !projectIds.has(opportunity.convertedProjectId))) return undefined;
  const catalogValues = record.skillCatalog === undefined ? undefined : readArray(record, "skillCatalog").map(normalizeSkillDefinition);
  if (catalogValues && catalogValues.some((item) => !item)) return undefined;
  const customFieldValues = record.customFields === undefined ? undefined : readArray(record, "customFields").map(normalizeCustomFieldDefinition);
  if (customFieldValues && customFieldValues.some((item) => !item)) return undefined;
  return hydrateWorkspaceSkills({
    members: members as Member[],
    projects: projects as Project[],
    assignments: assignments as Assignment[],
    needs: needs as StaffingNeed[],
    opportunities,
    opportunityNeeds,
    ...(catalogValues ? { skillCatalog: catalogValues as SkillDefinition[] } : {}),
    ...(customFieldValues ? { customFields: customFieldValues as CustomFieldDefinition[] } : {}),
  });
}

function rpcError(action: string, error: PostgrestError) {
  if (error.code === "40001" || /revision conflict|stale workspace/i.test(error.message)) {
    return new WorkspaceConflictError(error);
  }
  if (error.code === "42501" || /permission|not authorized|forbidden/i.test(error.message)) {
    return new ProductionRepositoryError("この操作を行う権限がありません。", {
      cause: error,
      code: "FORBIDDEN",
    });
  }
  if (error.code === "P0002" && /invitation/i.test(error.message)) {
    return new ProductionRepositoryError("この招待は無効、期限切れ、または別のメールアドレス宛てです。", {
      cause: error,
      code: "INVITATION_NOT_AVAILABLE",
    });
  }
  if (error.code === "P0002") {
    return new ProductionRepositoryError("対象のデータが見つからないか、すでに利用できません。", {
      cause: error,
      code: "NOT_FOUND",
      retryable: false,
    });
  }
  if (error.code === "23514" && /active owner/i.test(error.message)) {
    return new ProductionRepositoryError("組織には有効なownerが1名以上必要です。先に別のownerを設定してください。", {
      cause: error,
      code: "LAST_OWNER_REQUIRED",
      retryable: false,
    });
  }
  if (error.code === "23505" && /active member/i.test(error.message)) {
    return new ProductionRepositoryError("このメールアドレスはすでに組織へ参加しています。", {
      cause: error,
      code: "MEMBER_ALREADY_ACTIVE",
    });
  }
  if (error.code === "23505") {
    return new ProductionRepositoryError("同じ識別子のデータがすでに登録されています。未保存変更を戻してから、内容を変更してください。", {
      cause: error,
      code: "DUPLICATE_VALUE",
      retryable: false,
    });
  }
  if (error.code === "23503") {
    return new ProductionRepositoryError("参照しているメンバーまたはプロジェクトが更新されています。最新データを読み込んでください。", {
      cause: error,
      code: "RELATED_RECORD_CHANGED",
      retryable: false,
    });
  }
  if (["22023", "22P02", "23514"].includes(error.code)) {
    return new ProductionRepositoryError("入力内容が業務ルールに合いません。日付、配分、権限を確認してください。", {
      cause: error,
      code: "VALIDATION_FAILED",
      retryable: false,
    });
  }
  if (error.code === "54000") {
    return new ProductionRepositoryError("一度に保存できる変更件数を超えています。変更を分けて保存してください。", {
      cause: error,
      code: "PAYLOAD_LIMIT_EXCEEDED",
      retryable: false,
    });
  }
  return new ProductionRepositoryError(`${action}できませんでした。通信状況を確認して再試行してください。`, {
    cause: error,
    code: error.code,
    retryable: true,
  });
}

function authError(error: AuthError) {
  return new ProductionRepositoryError("メールアドレスまたはパスワードを確認してください。", {
    cause: error,
    code: error.code ?? "AUTH_ERROR",
  });
}

function passwordUpdateError(error: AuthError) {
  if (error.code === "weak_password" || error.code === "same_password") {
    return new ProductionRepositoryError("パスワードは12文字以上で、英大文字・英小文字・数字を含めてください。", {
      cause: error,
      code: "WEAK_PASSWORD",
      retryable: false,
    });
  }
  return new ProductionRepositoryError("パスワードを更新できませんでした。リンクの有効期限を確認してください。", {
    cause: error,
    code: error.code ?? "PASSWORD_UPDATE_ERROR",
    retryable: false,
  });
}

async function functionError(error: unknown) {
  let status: number | undefined;
  let payload: unknown;
  const record = asRecord(error);
  const context = asRecord(record?.context);
  if (context) {
    status = typeof context.status === "number" ? context.status : undefined;
    if (typeof context.json === "function") {
      try {
        payload = await (context.json as () => Promise<unknown>)();
      } catch {
        payload = undefined;
      }
    }
  }
  const bodyError = asRecord(asRecord(payload)?.error);
  const message = typeof bodyError?.message === "string" ? bodyError.message : "";
  const code = typeof bodyError?.code === "string" ? bodyError.code : "";
  const retryable = typeof bodyError?.retryable === "boolean"
    ? bodyError.retryable
    : status === 429 || (status !== undefined && status >= 500);
  if (message) {
    return new ProductionRepositoryError(message, {
      cause: error,
      code: code || "INVITE_ERROR",
      retryable,
    });
  }
  if (status === 401) {
    return new ProductionRepositoryError("ログイン状態を確認できませんでした。再度ログインしてください。", {
      cause: error,
      code: "UNAUTHORIZED",
    });
  }
  return new ProductionRepositoryError("招待を完了できませんでした。通信状況を確認してください。", {
    cause: error,
    code: "INVITE_UNAVAILABLE",
    retryable: true,
  });
}

function normalizeOrganization(value: unknown): OrganizationSummary | undefined {
  const record = asRecord(value);
  const nested = asRecord(record?.organization);
  const id = readString(record, "organization_id", "id") ?? readString(nested, "id");
  const name = readString(record, "organization_name", "name") ?? readString(nested, "name");
  if (!id || !name) return undefined;
  return {
    id,
    name,
    role: normalizeRole(record?.role ?? record?.organization_role ?? nested?.role),
    slug: readString(record, "slug") ?? readString(nested, "slug"),
    accessRevision: readNumber(record, "access_revision", "accessRevision") ?? readNumber(nested, "access_revision", "accessRevision"),
  };
}

function normalizeInvitation(value: unknown): PendingInvitation | undefined {
  const record = asRecord(value);
  const organization = asRecord(record?.organization);
  const id = readString(record, "id", "invitation_id");
  const organizationId = readString(record, "organization_id", "organizationId") ?? readString(organization, "id");
  const organizationName = readString(record, "organization_name", "organizationName") ?? readString(organization, "name");
  if (!id || !organizationId || !organizationName) return undefined;
  return {
    id,
    organizationId,
    organizationName,
    role: normalizeRole(record?.role),
    expiresAt: readString(record, "expires_at", "expiresAt"),
  };
}

export function normalizeOrganizationInvitation(value: unknown): OrganizationInvitation | undefined {
  const record = asRecord(value);
  const id = readString(record, "id", "invitation_id");
  const organizationId = readString(record, "organization_id", "organizationId");
  const email = readString(record, "email");
  const role = readString(record, "role");
  const rawStatus = readString(record, "status") ?? "pending";
  if (!id || !organizationId || !email || !role || !["admin", "planner", "viewer"].includes(role) || !["pending", "expired"].includes(rawStatus)) return undefined;
  return {
    id,
    organizationId,
    email,
    role: role as OrganizationInvitation["role"],
    status: rawStatus as OrganizationInvitation["status"],
    expiresAt: readString(record, "expires_at", "expiresAt"),
    createdAt: readString(record, "created_at", "createdAt"),
    invitedByUserId: readString(record, "invited_by_user_id", "invitedByUserId"),
    invitedByName: readString(record, "invited_by_name", "invitedByName"),
  };
}

export function normalizeMyContext(value: unknown, user: User): MyContext {
  const record = asRecord(unwrapRpcValue(value));
  if (!record) {
    throw new ProductionRepositoryError("アカウント情報の形式を確認できませんでした。", { code: "INVALID_CONTEXT" });
  }
  const identity = asRecord(record.profile) ?? asRecord(record.identity) ?? asRecord(record.user) ?? record;
  const organizations = readArray(record, "organizations", "memberships")
    .map(normalizeOrganization)
    .filter((item): item is OrganizationSummary => Boolean(item));
  const invitations = readArray(record, "invitations", "pending_invitations")
    .map(normalizeInvitation)
    .filter((item): item is PendingInvitation => Boolean(item));

  return {
    userId: readString(identity, "id", "user_id") ?? user.id,
    name: readString(identity, "name", "display_name", "displayName", "full_name") ?? user.email?.split("@")[0] ?? "MOSAICユーザー",
    email: readString(identity, "email") ?? user.email ?? "",
    organizations,
    invitations,
  };
}

export function normalizeWorkspace(value: unknown): WorkspaceEnvelope {
  const record = asRecord(unwrapRpcValue(value));
  const stateCandidate = record?.state ?? record?.workspace ?? record?.workspace_state ?? (record ? {
    assignments: record.assignments,
    members: record.members,
    needs: record.needs,
    projects: record.projects,
    skillCatalog: record.skillCatalog,
    customFields: record.customFields,
    opportunities: record.opportunities,
    opportunityNeeds: record.opportunityNeeds,
  } : value);
  const rawState = typeof stateCandidate === "string" ? JSON.parse(stateCandidate) as unknown : stateCandidate;
  const state = normalizeWorkspaceState(rawState);
  if (!state) {
    throw new ProductionRepositoryError("共有ワークスペースのデータ形式が正しくありません。", { code: "INVALID_WORKSPACE" });
  }
  const revision = readNumber(record, "revision", "workspace_revision", "workspaceRevision")
    ?? readNumber(asRecord(record?.organization), "revision", "workspace_revision", "workspaceRevision");
  if (revision === undefined) {
    throw new ProductionRepositoryError("共有ワークスペースの更新番号を確認できませんでした。", { code: "INVALID_REVISION" });
  }
  return {
    state,
    revision,
    savedAt: readString(record, "saved_at", "savedAt", "updated_at")
      ?? readString(asRecord(record?.organization), "workspaceChangedAt", "workspace_changed_at"),
  };
}

function normalizeMember(value: unknown): OrganizationMember | undefined {
  const record = asRecord(value);
  const profile = asRecord(record?.profile);
  const email = readString(record, "email") ?? readString(profile, "email");
  const name = readString(record, "name", "display_name", "displayName", "full_name") ?? readString(profile, "display_name", "displayName", "name") ?? email;
  if (!name) return undefined;
  const rawStatus = readString(record, "status") ?? "active";
  const status: OrganizationMember["status"] = rawStatus === "active" ? "active" : "suspended";
  return {
    membershipId: readString(record, "membership_id", "membershipId"),
    userId: readString(record, "user_id", "userId", "id") ?? readString(profile, "id"),
    email,
    name,
    role: normalizeRole(record?.role),
    status,
    joinedAt: readString(record, "joined_at", "joinedAt", "created_at"),
  };
}

function auditSummary(action: string, entityType: string, oldData?: UnknownRecord, newData?: UnknownRecord) {
  const entityLabels: Record<string, string> = {
    assignments: "アサイン",
    organization_invitations: "組織招待",
    organization_memberships: "メンバー権限",
    organizations: "組織",
    people: "メンバー",
    projects: "プロジェクト",
    staffing_needs: "要員要件",
    custom_fields: "カスタム項目",
    custom_field_values: "カスタム項目値",
    work_history: "業務経歴",
    opportunities: "受注前案件",
    opportunity_needs: "要員計画",
  };
  const actionLabels: Record<string, string> = { delete: "削除", insert: "追加", update: "更新" };
  const source = newData ?? oldData;
  const subject = readString(source, "name", "email", "code", "label", "role") ?? entityLabels[entityType] ?? entityType;
  return `${subject}を${actionLabels[action] ?? action}`;
}

export function normalizeAuditEvent(value: unknown, index: number): AuditEvent | undefined {
  const record = asRecord(value);
  if (!record) return undefined;
  const createdAt = readString(record, "created_at", "occurred_at", "occurredAt");
  if (!createdAt) return undefined;
  const actor = asRecord(record.actor);
  const action = readString(record, "action", "event_type") ?? "update";
  const entityType = readString(record, "entity_type", "entityType") ?? "workspace";
  const oldData = asRecord(record.old_data) ?? asRecord(record.oldData);
  const newData = asRecord(record.new_data) ?? asRecord(record.newData);
  return {
    id: readIdentifier(record, "id") ?? `${createdAt}-${index}`,
    action,
    entityType,
    entityId: readString(record, "entity_id", "entityId"),
    actorName: readString(record, "actor_name", "actorName", "display_name", "displayName") ?? readString(actor, "name", "display_name") ?? "MOSAICユーザー",
    actorEmail: readString(record, "actor_email", "actorEmail", "email") ?? readString(actor, "email"),
    createdAt,
    summary: readString(record, "summary", "description") ?? auditSummary(action, entityType, oldData, newData),
    requestId: readString(record, "request_id", "requestId"),
    workspaceRevision: readNumber(record, "workspace_revision", "workspaceRevision"),
    oldData,
    newData,
  };
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  const record = value as UnknownRecord;
  return `{${Object.keys(record).filter((key) => record[key] !== undefined).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(",")}}`;
}

export async function sha256Hex(value: unknown) {
  const bytes = new TextEncoder().encode(stableJson(value));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function changedRows<T extends { id: string }>(next: T[], previous: T[]) {
  const previousById = new Map(previous.map((item) => [item.id, item]));
  return next.filter((item) => stableJson(item) !== stableJson(previousById.get(item.id)));
}

function removedIds<T extends { id: string }>(next: T[], previous: T[]) {
  const nextIds = new Set(next.map((item) => item.id));
  return previous.filter((item) => !nextIds.has(item.id)).map((item) => item.id);
}

export function workspaceChangesPayload(
  state: WorkspaceState,
  previous: WorkspaceState,
  role: OrganizationRole,
): SaveWorkspacePayload {
  const payload: SaveWorkspacePayload = {};
  const memberUpsert = changedRows(state.members, previous.members);
  const memberArchiveIds = removedIds(state.members, previous.members);
  if (role === "owner" || role === "admin") {
    if (memberUpsert.length || memberArchiveIds.length) payload.members = { upsert: memberUpsert, archiveIds: memberArchiveIds };
  } else if (memberUpsert.length || memberArchiveIds.length) {
    throw new ProductionRepositoryError("権限が変更されたため、メンバー変更を保存できません。未保存内容を確認して再読み込みしてください。", {
      code: "FORBIDDEN",
      retryable: false,
    });
  }

  const projectUpsert = changedRows(state.projects, previous.projects);
  const projectArchiveIds = removedIds(state.projects, previous.projects);
  if (projectUpsert.length || projectArchiveIds.length) payload.projects = { upsert: projectUpsert, archiveIds: projectArchiveIds };

  const assignmentUpsert = changedRows(state.assignments, previous.assignments);
  const assignmentCancelIds = removedIds(state.assignments, previous.assignments);
  if (assignmentUpsert.length || assignmentCancelIds.length) payload.assignments = { upsert: assignmentUpsert, cancelIds: assignmentCancelIds };

  const needUpsert = changedRows(state.needs, previous.needs);
  const needCancelIds = removedIds(state.needs, previous.needs);
  if (needUpsert.length || needCancelIds.length) payload.needs = { upsert: needUpsert, cancelIds: needCancelIds };

  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const persistedId = (id: string) => uuidPattern.test(id);
  const nextCatalog = (state.skillCatalog ?? []).filter((item) => persistedId(item.id));
  const previousCatalog = (previous.skillCatalog ?? []).filter((item) => persistedId(item.id));
  const catalogUpsert = changedRows(nextCatalog, previousCatalog);
  const catalogArchiveIds = removedIds(nextCatalog, previousCatalog);
  if (catalogUpsert.length || catalogArchiveIds.length) payload.skillCatalog = { upsert: catalogUpsert, archiveIds: catalogArchiveIds };
  const nextFields = (state.customFields ?? []).filter((item) => persistedId(item.id));
  const previousFields = (previous.customFields ?? []).filter((item) => persistedId(item.id));
  const fieldUpsert = changedRows(nextFields, previousFields);
  const fieldArchiveIds = removedIds(nextFields, previousFields);
  if (role === "owner" || role === "admin") {
    if (fieldUpsert.length || fieldArchiveIds.length) payload.customFields = { upsert: fieldUpsert, archiveIds: fieldArchiveIds };
  } else if (fieldUpsert.length || fieldArchiveIds.length) {
    throw new ProductionRepositoryError("権限が変更されたため、項目定義を保存できません。未保存内容を確認して再読み込みしてください。", {
      code: "FORBIDDEN",
      retryable: false,
    });
  }

  const opportunityUpsert = changedRows(state.opportunities ?? [], previous.opportunities ?? []);
  const opportunityArchiveIds = removedIds(state.opportunities ?? [], previous.opportunities ?? []);
  if (opportunityUpsert.length || opportunityArchiveIds.length) payload.opportunities = { upsert: opportunityUpsert, archiveIds: opportunityArchiveIds };

  const opportunityNeedUpsert = changedRows(state.opportunityNeeds ?? [], previous.opportunityNeeds ?? []);
  const opportunityNeedCancelIds = removedIds(state.opportunityNeeds ?? [], previous.opportunityNeeds ?? []);
  if (opportunityNeedUpsert.length || opportunityNeedCancelIds.length) {
    payload.opportunityNeeds = { upsert: opportunityNeedUpsert, cancelIds: opportunityNeedCancelIds };
  }
  return payload;
}

export class ProductionRepository {
  constructor(private readonly client: SupabaseClient) {}

  async signIn(email: string, password: string) {
    const { data, error } = await this.client.auth.signInWithPassword({ email, password });
    if (error) throw authError(error);
    return data.user;
  }

  async signOut() {
    const { error } = await this.client.auth.signOut();
    if (error) {
      throw new ProductionRepositoryError("ログアウトできませんでした。もう一度お試しください。", {
        cause: error,
        code: error.code ?? "SIGN_OUT_ERROR",
        retryable: true,
      });
    }
  }

  async requestPasswordReset(email: string) {
    const { error } = await this.client.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: appAuthRedirectUrl(),
    });
    if (!error || error.code === "user_not_found") return;
    if (error.code === "over_email_send_rate_limit" || error.status === 429) {
      throw new ProductionRepositoryError("メールを連続して送れません。しばらくしてからもう一度お試しください。", {
        cause: error,
        code: "RATE_LIMITED",
        retryable: true,
      });
    }
    throw new ProductionRepositoryError("再設定メールを送れませんでした。通信状況を確認してください。", {
      cause: error,
      code: error.code ?? "RESET_EMAIL_ERROR",
      retryable: true,
    });
  }

  async updatePassword(password: string) {
    const { error } = await this.client.auth.updateUser({ password });
    if (!error) return;
    throw passwordUpdateError(error);
  }

  async completeOnboarding(displayName: string, password: string) {
    const name = displayName.trim();
    if (!name) {
      throw new ProductionRepositoryError("表示名を入力してください。", { code: "VALIDATION_FAILED" });
    }
    const { error: profileError } = await this.client.rpc("update_my_profile", { p_display_name: name });
    if (profileError) throw rpcError("表示名を保存", profileError);
    const { error } = await this.client.auth.updateUser({
      password,
      data: { mosaic_invite: false, full_name: name },
    });
    if (error) throw passwordUpdateError(error);
  }

  async getMyContext(user: User) {
    const { data, error } = await this.client.rpc("get_my_context");
    if (error) throw rpcError("アカウント情報を読み込み", error);
    return normalizeMyContext(data, user);
  }

  async createOrganization(name: string, requestId: string) {
    const { data, error } = await this.client.rpc("create_organization", {
      p_name: name.trim(),
      p_request_id: requestId,
    });
    if (error) throw rpcError("組織を作成", error);
    const value = asRecord(unwrapRpcValue(data));
    const organization = normalizeOrganization(value?.organization ?? value);
    if (!organization) {
      throw new ProductionRepositoryError("組織の作成結果を確認できませんでした。同じ内容でもう一度お試しください。", {
        code: "INVALID_CREATE_RESULT",
        retryable: true,
      });
    }
    return organization;
  }

  async getWorkspace(organizationId: string) {
    const { data, error } = await this.client.rpc("get_workspace", { p_organization_id: organizationId });
    if (error) throw rpcError("共有データを読み込み", error);
    return normalizeWorkspace(data);
  }

  async saveWorkspace(
    organizationId: string,
    state: WorkspaceState,
    expectedRevision: number,
    requestId: string,
    previousState: WorkspaceState = { assignments: [], members: [], needs: [], projects: [], opportunities: [], opportunityNeeds: [] },
    role: OrganizationRole = "planner",
  ): Promise<SaveWorkspaceResult> {
    const payload = workspaceChangesPayload(state, previousState, role);
    const payloadHash = await sha256Hex(payload);
    const { data, error } = await this.client.rpc("save_workspace", {
      p_expected_revision: expectedRevision,
      p_organization_id: organizationId,
      p_payload: payload,
      p_payload_hash: payloadHash,
      p_request_id: requestId,
    });
    if (error) throw rpcError("共有データを保存", error);
    const record = asRecord(unwrapRpcValue(data));
    const revision = readNumber(record, "revision", "workspace_revision");
    if (revision === undefined) {
      throw new ProductionRepositoryError("保存結果の更新番号を確認できませんでした。", { code: "INVALID_SAVE_RESULT" });
    }
    return {
      revision,
      savedAt: readString(record, "saved_at", "savedAt", "updated_at") ?? new Date().toISOString(),
    };
  }

  async inviteMember(organizationId: string, email: string, role: Exclude<OrganizationRole, "owner">): Promise<InvitationResult> {
    const { data, error } = await this.client.functions.invoke("invite", {
      body: {
        organizationId,
        email: email.trim().toLowerCase(),
        role,
        redirectTo: appAuthRedirectUrl(),
      },
    });
    if (error) throw await functionError(error);
    const result = asRecord(unwrapRpcValue(data));
    const record = asRecord(result?.invitation) ?? result;
    const returnedRole = normalizeRole(record?.role ?? role);
    return {
      id: readString(record, "id", "invitation_id"),
      email: readString(record, "email") ?? email.trim().toLowerCase(),
      role: returnedRole === "owner" ? role : returnedRole,
      expiresAt: readString(record, "expires_at", "expiresAt"),
      authInvite: result?.authInvite === "existing" ? "existing" : "sent",
    };
  }

  async listOrganizationInvitations(organizationId: string): Promise<OrganizationInvitation[]> {
    const { data, error } = await this.client.rpc("list_organization_invitations", { p_organization_id: organizationId });
    if (error) throw rpcError("招待一覧を読み込み", error);
    const values = Array.isArray(data) ? data : readArray(asRecord(unwrapRpcValue(data)), "invitations", "items");
    return values.map(normalizeOrganizationInvitation).filter((item): item is OrganizationInvitation => Boolean(item));
  }

  async revokeOrganizationInvitation(
    organizationId: string,
    invitationId: string,
    requestId = crypto.randomUUID(),
  ): Promise<RevokeInvitationResult> {
    const { data, error } = await this.client.rpc("revoke_organization_invitation", {
      p_invitation_id: invitationId,
      p_organization_id: organizationId,
      p_request_id: requestId,
    });
    if (error) throw rpcError("招待を取り消し", error);
    const result = asRecord(unwrapRpcValue(data));
    return {
      changed: result?.changed === true,
      accessRevision: readNumber(result, "access_revision", "accessRevision"),
      requestId: readString(result, "request_id", "requestId"),
    };
  }

  async acceptInvitation(token: string): Promise<AcceptInvitationResult> {
    const { data, error } = await this.client.rpc("accept_invitation", { p_invitation_id: token });
    if (error) throw rpcError("招待を承認", error);
    const result = asRecord(unwrapRpcValue(data));
    const record = asRecord(result?.organization) ?? result;
    return {
      organizationId: readString(record, "organization_id", "organizationId", "id"),
      organizationName: readString(record, "organization_name", "organizationName", "name"),
      role: record?.role ? normalizeRole(record.role) : undefined,
    };
  }

  async listOrganizationMembers(organizationId: string) {
    const { data, error } = await this.client.rpc("list_organization_members", { p_organization_id: organizationId });
    if (error) throw rpcError("メンバー一覧を読み込み", error);
    const values = Array.isArray(data) ? data : readArray(asRecord(unwrapRpcValue(data)), "members", "items");
    return values.map(normalizeMember).filter((item): item is OrganizationMember => Boolean(item));
  }

  async manageOrganizationMember(
    organizationId: string,
    userId: string,
    role: OrganizationRole,
    status: OrganizationMember["status"],
  ) {
    const { data, error } = await this.client.rpc("manage_organization_member", {
      p_organization_id: organizationId,
      p_request_id: crypto.randomUUID(),
      p_role: role,
      p_status: status,
      p_user_id: userId,
    });
    if (error) throw rpcError("メンバー権限を更新", error);
    const result = asRecord(unwrapRpcValue(data));
    const member = normalizeMember(result?.member ?? result);
    if (!member) throw new ProductionRepositoryError("更新後のメンバー情報を確認できませんでした。", { code: "INVALID_MEMBER_RESULT" });
    return member;
  }

  async listAuditEvents(organizationId: string, limit = 50, before?: string): Promise<AuditEventPage> {
    const { data, error } = await this.client.rpc("list_audit_events", {
      p_before: before ?? null,
      p_limit: limit,
      p_organization_id: organizationId,
    });
    if (error) throw rpcError("監査ログを読み込み", error);
    const record = asRecord(unwrapRpcValue(data));
    const values = Array.isArray(data) ? data : readArray(record, "events", "items");
    return {
      events: values.map(normalizeAuditEvent).filter((item): item is AuditEvent => Boolean(item)),
      nextBefore: readIdentifier(record, "next_before", "nextBefore"),
    };
  }

  subscribeToWorkspace(organizationId: string, onRevision: (revision?: number) => void) {
    const channel = this.client
      .channel(`mosaic-workspace-${organizationId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          filter: `id=eq.${organizationId}`,
          schema: "app",
          table: "organizations",
        },
        (payload) => {
          const revision = readNumber(asRecord(payload.new), "workspace_revision", "revision");
          if (revision !== undefined) onRevision(revision);
        },
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") onRevision();
      });

    return () => {
      void this.client.removeChannel(channel);
    };
  }
}
