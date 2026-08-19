/**
 * Pure workspace tool contract used by the chat Edge Function.
 *
 * Integration contract:
 * - `detectWorkspaceFunctionCalls(interaction)` extracts Gemini Interactions
 *   `function_call` steps as `{ id, name, arguments }`.
 * - `parseWorkspaceToolCall(name, args)` performs strict, server-side argument
 *   validation and returns `{ mode, toolName, args }`.
 * - `readWorkspaceTool(snapshot, name, args)` returns a bounded, data-minimized
 *   result from a `get_workspace` RPC snapshot.
 * - `planWorkspaceAction(...)` creates a normalized action, confirmation
 *   preview, and atomic `save_workspace` payload without touching the network.
 * - `buildWorkspaceSaveRequest(plan)` maps a confirmed plan to RPC arguments.
 *
 * The caller must fetch the snapshot and execute RPCs with `ctx.supabase`, not
 * `ctx.supabaseAdmin`. Organization and role authorization remain enforced by
 * the existing authenticated RPC boundary.
 */

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;
const ROLE_VALUES = new Set(["owner", "admin", "planner", "viewer"]);
const AVATAR_TONES = ["lavender", "peach", "sky", "mint", "sand", "rose"];
const PROJECT_TONES = ["blue", "mint", "orange", "plum", "sky"];
const PROJECT_STATUSES = ["進行中", "要注意", "準備中", "完了間近", "完了"];
const ASSIGNMENT_STATUSES = ["draft", "confirmed"];
const NEED_STATUSES = ["open", "planned", "filled"];
const OPPORTUNITY_STAGES = ["inquiry", "proposal", "negotiation", "won", "lost"];
const ACTIVE_OPPORTUNITY_STAGES = ["inquiry", "proposal", "negotiation"];
const READ_RESOURCES = ["summary", "members", "projects", "assignments", "staffing_needs", "opportunities", "opportunity_needs", "org_units", "org_memberships", "search_scenes", "saved_reports"];
const MAX_READ_RESULTS = 25;
const DEFAULT_READ_RESULTS = 10;
const MAX_SKILLS = 20;
const SKILL_IMPORTANCES = ["must", "nice"];
const REPORT_SOURCES = ["members", "projects"];
const REPORT_GROUP_BY = ["department", "role", "location", "status"];
const REPORT_METRICS = ["count", "avgLoad"];

const READ_TOOL = "read_workspace";
const MEMBER_TOOLS = new Set(["create_member", "update_member", "delete_member"]);
const ORG_TOOLS = new Set(["create_org_unit", "update_org_unit", "delete_org_unit", "set_member_org_memberships"]);
const SEARCH_SCENE_TOOLS = new Set(["create_search_scene", "delete_search_scene"]);
const REPORT_TOOLS = new Set(["create_saved_report", "delete_saved_report"]);
const WRITE_TOOLS = new Set([
  ...MEMBER_TOOLS,
  ...ORG_TOOLS,
  ...SEARCH_SCENE_TOOLS,
  ...REPORT_TOOLS,
  "create_project",
  "update_project",
  "delete_project",
  "create_assignment",
  "update_assignment",
  "delete_assignment",
  "create_staffing_need",
  "update_staffing_need",
  "delete_staffing_need",
  "assign_person_to_need",
  "create_opportunity",
  "update_opportunity",
  "delete_opportunity",
  "create_opportunity_need",
  "update_opportunity_need",
  "delete_opportunity_need",
  "convert_opportunity",
]);

const dateSchema = { type: "string", description: "YYYY-MM-DD形式の日付" };
const uuidSchema = { type: "string", description: "read_workspaceで取得した対象ID" };
const skillsSchema = {
  type: "array",
  items: { type: "string" },
  maxItems: MAX_SKILLS,
  description: "スキル名。完全一致で扱う",
};

const readParameters = {
  type: "object",
  additionalProperties: false,
  properties: {
    resource: { type: "string", enum: READ_RESOURCES },
    query: { type: "string", description: "名称、コード、職種等の部分一致検索" },
    personId: uuidSchema,
    projectId: uuidSchema,
    ownerPersonId: uuidSchema,
    role: { type: "string" },
    location: { type: "string" },
    skills: skillsSchema,
    statuses: {
      type: "array",
      items: { type: "string", enum: [...PROJECT_STATUSES, ...ASSIGNMENT_STATUSES, ...NEED_STATUSES, ...OPPORTUNITY_STAGES] },
      maxItems: 6,
    },
    startDate: dateSchema,
    endDate: dateSchema,
    minAvailablePercent: { type: "number", minimum: 0, maximum: 100 },
    sceneId: uuidSchema,
    reportId: uuidSchema,
    limit: { type: "integer", minimum: 1, maximum: MAX_READ_RESULTS },
  },
  required: ["resource"],
};

const memberFields = {
  name: { type: "string" },
  role: { type: "string" },
  department: { type: "string" },
  location: { type: "string" },
  capacity: { type: "number", minimum: 0, maximum: 100 },
  skills: skillsSchema,
  initials: { type: "string", description: "省略時は氏名から生成" },
  avatarTone: { type: "string", enum: AVATAR_TONES },
};

const projectFields = {
  code: { type: "string", description: "省略時は名称と生成IDから作成" },
  name: { type: "string" },
  summary: { type: "string" },
  status: { type: "string", enum: PROJECT_STATUSES },
  tone: { type: "string", enum: PROJECT_TONES },
  ownerPersonId: uuidSchema,
  startDate: dateSchema,
  endDate: dateSchema,
  nextMilestone: { type: "string" },
  nextMilestoneDate: { ...dateSchema, nullable: true },
  progress: { type: "number", minimum: 0, maximum: 100 },
  demand: { type: "integer", minimum: 0, maximum: 10000 },
};

const assignmentFields = {
  personId: uuidSchema,
  projectId: uuidSchema,
  startDate: dateSchema,
  endDate: dateSchema,
  allocation: { type: "number", exclusiveMinimum: 0, maximum: 100 },
  label: { type: "string", nullable: true },
};

const needFields = {
  projectId: uuidSchema,
  role: { type: "string" },
  skills: skillsSchema,
  startDate: dateSchema,
  endDate: dateSchema,
  allocation: { type: "number", exclusiveMinimum: 0, maximum: 100 },
};

const opportunityFields = {
  code: { type: "string", description: "省略時は名称と生成IDから作成" },
  name: { type: "string" },
  summary: { type: "string" },
  stage: { type: "string", enum: ACTIVE_OPPORTUNITY_STAGES },
  tone: { type: "string", enum: PROJECT_TONES },
  ownerPersonId: uuidSchema,
  startDate: dateSchema,
  endDate: dateSchema,
  demand: { type: "integer", minimum: 0, maximum: 10000 },
};

const opportunityNeedFields = {
  opportunityId: uuidSchema,
  role: { type: "string" },
  skills: skillsSchema,
  startDate: dateSchema,
  endDate: dateSchema,
  allocation: { type: "number", exclusiveMinimum: 0, maximum: 100 },
};

const searchSceneSkillSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    name: { type: "string" },
    minProficiency: { type: "integer", minimum: 1, maximum: 5 },
    importance: { type: "string", enum: SKILL_IMPORTANCES },
  },
  required: ["name", "minProficiency", "importance"],
};

const searchSceneFields = {
  name: { type: "string" },
  query: { type: "string" },
  role: { type: "string" },
  location: { type: "string" },
  skills: { type: "array", items: searchSceneSkillSchema, maxItems: MAX_SKILLS },
  startDate: dateSchema,
  endDate: dateSchema,
  minAvailablePercent: { type: "number", minimum: 0, maximum: 100 },
};

const savedReportFields = {
  name: { type: "string" },
  source: { type: "string", enum: REPORT_SOURCES },
  groupBy: { type: "string", enum: REPORT_GROUP_BY },
  metric: { type: "string", enum: REPORT_METRICS },
};

function declaration(name, description, parameters) {
  return { type: "function", name, description, parameters };
}

function createParameters(fields, required) {
  return { type: "object", additionalProperties: false, properties: fields, required };
}

function updateParameters(idName, fields) {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      [idName]: uuidSchema,
      patch: { type: "object", additionalProperties: false, properties: fields },
    },
    required: [idName, "patch"],
  };
}

export const WORKSPACE_TOOL_DECLARATIONS = Object.freeze([
  declaration(
    READ_TOOL,
    "MOSAICの現在の組織にあるメンバー、プロジェクト、アサイン、要員要件、受注前案件を参照する。変更前のID確認にも必ず使う。",
    readParameters,
  ),
  declaration("create_member", "業務上のアサイン対象メンバーを登録する。ログインユーザーや権限は作成しない。", createParameters(memberFields, ["name", "role", "department", "location", "capacity", "skills"])),
  declaration("update_member", "業務メンバー情報を編集する。", updateParameters("memberId", memberFields)),
  declaration("delete_member", "業務メンバーをアーカイブする。関連アサインは取消し、要員要件は再オープンする。", createParameters({ memberId: uuidSchema }, ["memberId"])),
  declaration("create_project", "プロジェクトを登録する。", createParameters(projectFields, ["name", "startDate", "endDate"])),
  declaration("update_project", "プロジェクトを編集する。期間外になるアサイン・要員要件は取消対象になる。", updateParameters("projectId", projectFields)),
  declaration("delete_project", "プロジェクトをアーカイブし、関連アサイン・要員要件を取り消す。", createParameters({ projectId: uuidSchema }, ["projectId"])),
  declaration("create_assignment", "メンバーをプロジェクトへアサインする。要員要件を充足する場合はassign_person_to_needを使う。", createParameters(assignmentFields, ["personId", "projectId", "startDate", "endDate", "allocation"])),
  declaration("update_assignment", "アサインを編集する。紐づく要員要件を満たさなくなる場合は要件を再オープンする。", updateParameters("assignmentId", assignmentFields)),
  declaration("delete_assignment", "アサインを取り消す。紐づく要員要件は再オープンする。", createParameters({ assignmentId: uuidSchema }, ["assignmentId"])),
  declaration("create_staffing_need", "プロジェクトへ未充足の要員要件を登録する。", createParameters(needFields, ["projectId", "role", "skills", "startDate", "endDate", "allocation"])),
  declaration("update_staffing_need", "要員要件を編集する。既存アサインが新条件を満たさない場合は取り消して再オープンする。", updateParameters("staffingNeedId", needFields)),
  declaration("delete_staffing_need", "要員要件とそれに紐づくアサインを取り消す。", createParameters({ staffingNeedId: uuidSchema }, ["staffingNeedId"])),
  declaration("assign_person_to_need", "条件と空き容量を満たすメンバーで要員要件を充足し、確定アサインを同時作成する。", createParameters({ staffingNeedId: uuidSchema, personId: uuidSchema, label: { type: "string", nullable: true } }, ["staffingNeedId", "personId"])),
  declaration("create_opportunity", "受注前案件を登録する。", createParameters(opportunityFields, ["name", "startDate", "endDate"])),
  declaration("update_opportunity", "受注前案件を編集する。受注と失注はconvert_opportunityまたはdeleteしない専用操作を使う。", updateParameters("opportunityId", opportunityFields)),
  declaration("delete_opportunity", "受注前案件をアーカイブし、要員計画を取り消す。", createParameters({ opportunityId: uuidSchema }, ["opportunityId"])),
  declaration("create_opportunity_need", "受注前案件へ要員計画を登録する。", createParameters(opportunityNeedFields, ["opportunityId", "role", "skills", "startDate", "endDate", "allocation"])),
  declaration("update_opportunity_need", "受注前の要員計画を編集する。", updateParameters("opportunityNeedId", opportunityNeedFields)),
  declaration("delete_opportunity_need", "受注前の要員計画を取り消す。", createParameters({ opportunityNeedId: uuidSchema }, ["opportunityNeedId"])),
  declaration("convert_opportunity", "受注前案件と要員計画を確定プロジェクトと未充足の要員要件へ引き継ぐ。", createParameters({ opportunityId: uuidSchema }, ["opportunityId"])),
  declaration("create_org_unit", "組織内の部門を追加する。", createParameters({ name: { type: "string" }, parentId: { ...uuidSchema, nullable: true }, sortOrder: { type: "integer", minimum: 0, maximum: 10000 } }, ["name"])),
  declaration("update_org_unit", "部門名または親部門を変更する。", updateParameters("orgUnitId", { name: { type: "string" }, parentId: { ...uuidSchema, nullable: true }, sortOrder: { type: "integer", minimum: 0, maximum: 10000 } })),
  declaration("delete_org_unit", "配下部門と所属がない部門を削除する。", createParameters({ orgUnitId: uuidSchema }, ["orgUnitId"])),
  declaration("set_member_org_memberships", "メンバーの主所属・兼務・責任者を設定する。", createParameters({
    memberId: uuidSchema,
    primaryUnitId: { ...uuidSchema, nullable: true },
    extraUnitIds: { type: "array", items: uuidSchema, maxItems: 40 },
    managerUnitIds: { type: "array", items: uuidSchema, maxItems: 40 },
  }, ["memberId"])),
  declaration("create_search_scene", "必須・歓迎スキルを含む検索シーンを組織共有で保存する。", createParameters(searchSceneFields, ["name"])),
  declaration("delete_search_scene", "保存済みの検索シーンを削除する。", createParameters({ sceneId: uuidSchema }, ["sceneId"])),
  declaration("create_saved_report", "メンバーまたはプロジェクトのグループ集計レポートを保存する。", createParameters(savedReportFields, ["name", "source", "groupBy", "metric"])),
  declaration("delete_saved_report", "保存済みの集計レポートを削除する。", createParameters({ reportId: uuidSchema }, ["reportId"])),
]);

const TOOL_NAMES = new Set(WORKSPACE_TOOL_DECLARATIONS.map((tool) => tool.name));

export function isWorkspaceWriteTool(name) {
  return WRITE_TOOLS.has(name);
}

export class WorkspaceToolError extends Error {
  constructor(code, message, options = {}) {
    super(message, options.cause ? { cause: options.cause } : undefined);
    this.name = "WorkspaceToolError";
    this.code = code;
    this.status = options.status ?? 400;
    this.details = options.details;
  }
}

function fail(code, message, options) {
  throw new WorkspaceToolError(code, message, options);
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function record(value, label = "引数") {
  if (!isRecord(value)) fail("INVALID_TOOL_ARGUMENTS", `${label}の形式が正しくありません。`);
  return value;
}

function allowedKeys(value, allowed, label = "引数") {
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unknown.length) fail("INVALID_TOOL_ARGUMENTS", `${label}に未対応の項目があります。`, { details: { fields: unknown } });
}

function requiredString(value, field, options = {}) {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized) fail("INVALID_TOOL_ARGUMENTS", `${field}を入力してください。`);
  const min = options.min ?? 1;
  const max = options.max ?? 120;
  if (normalized.length < min || normalized.length > max) fail("INVALID_TOOL_ARGUMENTS", `${field}の長さを確認してください。`);
  return normalized;
}

function optionalString(value, field, options = {}) {
  if (value === undefined) return undefined;
  if (value === null && options.nullable) return null;
  if (typeof value !== "string") fail("INVALID_TOOL_ARGUMENTS", `${field}の形式が正しくありません。`);
  const normalized = value.trim();
  if (!normalized && options.nullable) return null;
  if (!normalized && options.allowEmpty) return "";
  if (!normalized) fail("INVALID_TOOL_ARGUMENTS", `${field}を入力してください。`);
  if (normalized.length > (options.max ?? 120)) fail("INVALID_TOOL_ARGUMENTS", `${field}が長すぎます。`);
  return normalized;
}

function uuidValue(value, field) {
  const normalized = requiredString(value, field, { max: 36 });
  if (!UUID_PATTERN.test(normalized)) fail("INVALID_TOOL_ARGUMENTS", `${field}のID形式が正しくありません。`);
  return normalized.toLowerCase();
}

function optionalUuid(value, field, options = {}) {
  if (value === undefined) return undefined;
  if (value === null && options.nullable) return null;
  return uuidValue(value, field);
}

function validDateString(value) {
  if (typeof value !== "string" || !DATE_PATTERN.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function dateValue(value, field) {
  if (!validDateString(value)) fail("INVALID_TOOL_ARGUMENTS", `${field}はYYYY-MM-DD形式で入力してください。`);
  return value;
}

function optionalDate(value, field, options = {}) {
  if (value === undefined) return undefined;
  if ((value === null || value === "") && options.nullable) return null;
  return dateValue(value, field);
}

function numberValue(value, field, min, max, options = {}) {
  if (typeof value !== "number" || !Number.isFinite(value)) fail("INVALID_TOOL_ARGUMENTS", `${field}は数値で入力してください。`);
  if (options.integer && !Number.isInteger(value)) fail("INVALID_TOOL_ARGUMENTS", `${field}は整数で入力してください。`);
  if (options.maxDecimals !== undefined) {
    const scale = 10 ** options.maxDecimals;
    const scaled = value * scale;
    const tolerance = Number.EPSILON * Math.max(1, Math.abs(scaled)) * 4;
    if (Math.abs(scaled - Math.round(scaled)) > tolerance) {
      fail("INVALID_TOOL_ARGUMENTS", `${field}は小数点以下${options.maxDecimals}桁以内で入力してください。`);
    }
  }
  if ((options.exclusiveMin ? value <= min : value < min) || value > max) fail("INVALID_TOOL_ARGUMENTS", `${field}の範囲を確認してください。`);
  return value;
}

function optionalNumber(value, field, min, max, options = {}) {
  return value === undefined ? undefined : numberValue(value, field, min, max, options);
}

function enumValue(value, field, values) {
  if (typeof value !== "string" || !values.includes(value)) fail("INVALID_TOOL_ARGUMENTS", `${field}の値が正しくありません。`);
  return value;
}

function optionalEnum(value, field, values) {
  return value === undefined ? undefined : enumValue(value, field, values);
}

function stringArray(value, field, options = {}) {
  if (!Array.isArray(value)) fail("INVALID_TOOL_ARGUMENTS", `${field}は配列で入力してください。`);
  if (value.length > (options.max ?? MAX_SKILLS)) fail("INVALID_TOOL_ARGUMENTS", `${field}の件数が多すぎます。`);
  const seen = new Set();
  const values = [];
  for (const item of value) {
    const normalized = requiredString(item, field, { max: options.itemMax ?? 80 });
    const key = normalized.toLocaleLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      values.push(normalized);
    }
  }
  return values;
}

function optionalStringArray(value, field, options = {}) {
  return value === undefined ? undefined : stringArray(value, field, options);
}

function uuidArray(value, field, options = {}) {
  return stringArray(value, field, { max: options.max ?? 40, itemMax: 36 }).map((item) => {
    if (!UUID_PATTERN.test(item)) fail("INVALID_TOOL_ARGUMENTS", `${field}のID形式が正しくありません。`);
    return item.toLowerCase();
  });
}

function optionalUuidArray(value, field, options = {}) {
  return value === undefined ? undefined : uuidArray(value, field, options);
}

function ensureDateRange(startDate, endDate, label = "期間") {
  if (startDate && endDate && startDate > endDate) fail("INVALID_TOOL_ARGUMENTS", `${label}の終了日は開始日以降にしてください。`);
}

function compact(value) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined));
}

function parseMemberFields(value, patch = false) {
  const input = record(value, patch ? "メンバー変更" : "メンバー");
  allowedKeys(input, Object.keys(memberFields), patch ? "メンバー変更" : "メンバー");
  const parsed = compact({
    name: patch ? optionalString(input.name, "氏名", { max: 120 }) : requiredString(input.name, "氏名", { max: 120 }),
    role: patch ? optionalString(input.role, "職種", { max: 120 }) : requiredString(input.role, "職種", { max: 120 }),
    department: patch ? optionalString(input.department, "部署", { max: 120 }) : requiredString(input.department, "部署", { max: 120 }),
    location: patch ? optionalString(input.location, "勤務地", { max: 120 }) : requiredString(input.location, "勤務地", { max: 120 }),
    capacity: patch ? optionalNumber(input.capacity, "稼働上限", 0, 100, { maxDecimals: 2 }) : numberValue(input.capacity, "稼働上限", 0, 100, { maxDecimals: 2 }),
    skills: patch ? optionalStringArray(input.skills, "スキル") : stringArray(input.skills, "スキル"),
    initials: optionalString(input.initials, "イニシャル", { max: 8 }),
    avatarTone: optionalEnum(input.avatarTone, "アバター色", AVATAR_TONES),
  });
  if (patch && Object.keys(parsed).length === 0) fail("INVALID_TOOL_ARGUMENTS", "メンバーの変更項目を1つ以上指定してください。");
  return parsed;
}

function parseProjectFields(value, patch = false) {
  const input = record(value, patch ? "プロジェクト変更" : "プロジェクト");
  allowedKeys(input, Object.keys(projectFields), patch ? "プロジェクト変更" : "プロジェクト");
  if (patch && input.ownerPersonId === null) {
    fail("INVALID_TOOL_ARGUMENTS", "プロジェクト責任者を未設定にする変更は現在非対応です。別の責任者を指定してください。");
  }
  const parsed = compact({
    code: optionalString(input.code, "プロジェクトコード", { max: 20 })?.toUpperCase(),
    name: patch ? optionalString(input.name, "プロジェクト名", { max: 160 }) : requiredString(input.name, "プロジェクト名", { max: 160 }),
    summary: optionalString(input.summary, "概要", { allowEmpty: true, max: 2000 }),
    status: optionalEnum(input.status, "ステータス", PROJECT_STATUSES),
    tone: optionalEnum(input.tone, "表示色", PROJECT_TONES),
    ownerPersonId: optionalUuid(input.ownerPersonId, "責任者ID"),
    startDate: patch ? optionalDate(input.startDate, "開始日") : dateValue(input.startDate, "開始日"),
    endDate: patch ? optionalDate(input.endDate, "終了日") : dateValue(input.endDate, "終了日"),
    nextMilestone: optionalString(input.nextMilestone, "次のマイルストーン", { allowEmpty: true, max: 240 }),
    nextMilestoneDate: optionalDate(input.nextMilestoneDate, "マイルストーン日", { nullable: true }),
    progress: optionalNumber(input.progress, "進捗", 0, 100, { maxDecimals: 2 }),
    demand: optionalNumber(input.demand, "必要人数", 0, 10000, { integer: true }),
  });
  if (patch && Object.keys(parsed).length === 0) fail("INVALID_TOOL_ARGUMENTS", "プロジェクトの変更項目を1つ以上指定してください。");
  ensureDateRange(parsed.startDate, parsed.endDate, "プロジェクト期間");
  return parsed;
}

function parseAssignmentFields(value, patch = false) {
  const input = record(value, patch ? "アサイン変更" : "アサイン");
  allowedKeys(input, Object.keys(assignmentFields), patch ? "アサイン変更" : "アサイン");
  const parsed = compact({
    personId: patch ? optionalUuid(input.personId, "メンバーID") : uuidValue(input.personId, "メンバーID"),
    projectId: patch ? optionalUuid(input.projectId, "プロジェクトID") : uuidValue(input.projectId, "プロジェクトID"),
    startDate: patch ? optionalDate(input.startDate, "開始日") : dateValue(input.startDate, "開始日"),
    endDate: patch ? optionalDate(input.endDate, "終了日") : dateValue(input.endDate, "終了日"),
    allocation: patch ? optionalNumber(input.allocation, "稼働配分", 0, 100, { exclusiveMin: true, maxDecimals: 2 }) : numberValue(input.allocation, "稼働配分", 0, 100, { exclusiveMin: true, maxDecimals: 2 }),
    label: optionalString(input.label, "ラベル", { allowEmpty: true, nullable: true, max: 240 }),
  });
  if (patch && Object.keys(parsed).length === 0) fail("INVALID_TOOL_ARGUMENTS", "アサインの変更項目を1つ以上指定してください。");
  ensureDateRange(parsed.startDate, parsed.endDate, "アサイン期間");
  return parsed;
}

function parseNeedFields(value, patch = false) {
  const input = record(value, patch ? "要員要件変更" : "要員要件");
  allowedKeys(input, Object.keys(needFields), patch ? "要員要件変更" : "要員要件");
  const parsed = compact({
    projectId: patch ? optionalUuid(input.projectId, "プロジェクトID") : uuidValue(input.projectId, "プロジェクトID"),
    role: patch ? optionalString(input.role, "必要ロール", { max: 120 }) : requiredString(input.role, "必要ロール", { max: 120 }),
    skills: patch ? optionalStringArray(input.skills, "必要スキル") : stringArray(input.skills, "必要スキル"),
    startDate: patch ? optionalDate(input.startDate, "開始日") : dateValue(input.startDate, "開始日"),
    endDate: patch ? optionalDate(input.endDate, "終了日") : dateValue(input.endDate, "終了日"),
    allocation: patch ? optionalNumber(input.allocation, "必要配分", 0, 100, { exclusiveMin: true, maxDecimals: 2 }) : numberValue(input.allocation, "必要配分", 0, 100, { exclusiveMin: true, maxDecimals: 2 }),
  });
  if (patch && Object.keys(parsed).length === 0) fail("INVALID_TOOL_ARGUMENTS", "要員要件の変更項目を1つ以上指定してください。");
  ensureDateRange(parsed.startDate, parsed.endDate, "要員要件期間");
  return parsed;
}

function parseOpportunityFields(value, patch = false) {
  const input = record(value, patch ? "受注前案件変更" : "受注前案件");
  allowedKeys(input, Object.keys(opportunityFields), patch ? "受注前案件変更" : "受注前案件");
  const parsed = compact({
    code: optionalString(input.code, "案件コード", { max: 20 })?.toUpperCase(),
    name: patch ? optionalString(input.name, "案件名", { max: 160 }) : requiredString(input.name, "案件名", { max: 160 }),
    summary: optionalString(input.summary, "概要", { allowEmpty: true, max: 2000 }),
    stage: optionalEnum(input.stage, "段階", ACTIVE_OPPORTUNITY_STAGES),
    tone: optionalEnum(input.tone, "表示色", PROJECT_TONES),
    ownerPersonId: optionalUuid(input.ownerPersonId, "責任者ID"),
    startDate: patch ? optionalDate(input.startDate, "開始日") : dateValue(input.startDate, "開始日"),
    endDate: patch ? optionalDate(input.endDate, "終了日") : dateValue(input.endDate, "終了日"),
    demand: optionalNumber(input.demand, "必要人数", 0, 10000, { integer: true }),
  });
  if (patch && Object.keys(parsed).length === 0) fail("INVALID_TOOL_ARGUMENTS", "受注前案件の変更項目を1つ以上指定してください。");
  ensureDateRange(parsed.startDate, parsed.endDate, "想定期間");
  return parsed;
}

function parseOpportunityNeedFields(value, patch = false) {
  const input = record(value, patch ? "要員計画変更" : "要員計画");
  allowedKeys(input, Object.keys(opportunityNeedFields), patch ? "要員計画変更" : "要員計画");
  const parsed = compact({
    opportunityId: patch ? optionalUuid(input.opportunityId, "受注前案件ID") : uuidValue(input.opportunityId, "受注前案件ID"),
    role: patch ? optionalString(input.role, "必要ロール", { max: 120 }) : requiredString(input.role, "必要ロール", { max: 120 }),
    skills: patch ? optionalStringArray(input.skills, "必要スキル") : stringArray(input.skills, "必要スキル"),
    startDate: patch ? optionalDate(input.startDate, "開始日") : dateValue(input.startDate, "開始日"),
    endDate: patch ? optionalDate(input.endDate, "終了日") : dateValue(input.endDate, "終了日"),
    allocation: patch ? optionalNumber(input.allocation, "必要配分", 0, 100, { exclusiveMin: true, maxDecimals: 2 }) : numberValue(input.allocation, "必要配分", 0, 100, { exclusiveMin: true, maxDecimals: 2 }),
  });
  if (patch && Object.keys(parsed).length === 0) fail("INVALID_TOOL_ARGUMENTS", "要員計画の変更項目を1つ以上指定してください。");
  ensureDateRange(parsed.startDate, parsed.endDate, "要員計画期間");
  return parsed;
}

function parseSceneSkills(value) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) fail("INVALID_TOOL_ARGUMENTS", "スキル条件は配列で入力してください。");
  if (value.length > MAX_SKILLS) fail("INVALID_TOOL_ARGUMENTS", "スキル条件の件数が多すぎます。");
  const seen = new Set();
  const skills = [];
  for (const item of value) {
    const skill = record(item, "スキル条件");
    allowedKeys(skill, ["name", "minProficiency", "importance"], "スキル条件");
    const name = requiredString(skill.name, "スキル名", { max: 80 });
    const key = name.toLocaleLowerCase();
    if (seen.has(key)) fail("INVALID_TOOL_ARGUMENTS", "同じスキルを重複して指定できません。");
    seen.add(key);
    skills.push({
      name,
      minProficiency: numberValue(skill.minProficiency, "必要習熟度", 1, 5, { integer: true }),
      importance: enumValue(skill.importance, "重要度", SKILL_IMPORTANCES),
    });
  }
  return skills;
}

function parseSearchSceneFields(value) {
  const input = record(value, "検索シーン");
  allowedKeys(input, Object.keys(searchSceneFields), "検索シーン");
  const parsed = compact({
    name: requiredString(input.name, "検索シーン名", { max: 80 }),
    query: optionalString(input.query, "検索語", { max: 120 }),
    role: optionalString(input.role, "職種", { max: 120 }),
    location: optionalString(input.location, "勤務地", { max: 120 }),
    skills: parseSceneSkills(input.skills),
    startDate: optionalDate(input.startDate, "開始日"),
    endDate: optionalDate(input.endDate, "終了日"),
    minAvailablePercent: optionalNumber(input.minAvailablePercent, "最小空き配分", 0, 100),
  });
  if ((parsed.startDate && !parsed.endDate) || (!parsed.startDate && parsed.endDate)) {
    fail("INVALID_TOOL_ARGUMENTS", "期間は開始日と終了日を両方指定してください。");
  }
  ensureDateRange(parsed.startDate, parsed.endDate, "検索シーン期間");
  return parsed;
}

function allowedReportGroupBy(source) {
  return source === "projects" ? ["status"] : ["department", "role", "location"];
}

function parseSavedReportFields(value) {
  const input = record(value, "保存レポート");
  allowedKeys(input, Object.keys(savedReportFields), "保存レポート");
  const source = enumValue(input.source, "集計対象", REPORT_SOURCES);
  const groupBy = enumValue(input.groupBy, "グループ", REPORT_GROUP_BY);
  const metric = enumValue(input.metric, "指標", REPORT_METRICS);
  if (!allowedReportGroupBy(source).includes(groupBy)) fail("INVALID_TOOL_ARGUMENTS", "この集計対象では使えないグループです。");
  return {
    name: requiredString(input.name, "レポート名", { max: 80 }),
    source,
    groupBy,
    metric: source === "projects" ? "count" : metric,
  };
}

const READ_ALLOWED = {
  summary: ["resource", "startDate", "endDate"],
  members: ["resource", "query", "role", "location", "skills", "startDate", "endDate", "minAvailablePercent", "sceneId", "limit"],
  projects: ["resource", "query", "ownerPersonId", "statuses", "startDate", "endDate", "limit"],
  assignments: ["resource", "personId", "projectId", "statuses", "startDate", "endDate", "limit"],
  staffing_needs: ["resource", "projectId", "statuses", "skills", "startDate", "endDate", "limit"],
  opportunities: ["resource", "query", "ownerPersonId", "statuses", "startDate", "endDate", "limit"],
  opportunity_needs: ["resource", "query", "skills", "startDate", "endDate", "limit"],
  org_units: ["resource", "query", "limit"],
  org_memberships: ["resource", "query", "personId", "limit"],
  search_scenes: ["resource", "query", "limit"],
  saved_reports: ["resource", "query", "reportId", "startDate", "endDate", "limit"],
};

function parseReadArgs(value) {
  const input = record(value);
  const resource = enumValue(input.resource, "参照対象", READ_RESOURCES);
  allowedKeys(input, READ_ALLOWED[resource]);
  const startDate = optionalDate(input.startDate, "開始日");
  const endDate = optionalDate(input.endDate, "終了日");
  if ((startDate && !endDate) || (!startDate && endDate)) fail("INVALID_TOOL_ARGUMENTS", "期間検索では開始日と終了日を両方指定してください。");
  ensureDateRange(startDate, endDate);
  const statusValues = resource === "projects" ? PROJECT_STATUSES : resource === "assignments" ? ASSIGNMENT_STATUSES : resource === "staffing_needs" ? NEED_STATUSES : resource === "opportunities" ? OPPORTUNITY_STAGES : [];
  let statuses;
  if (input.statuses !== undefined) {
    statuses = stringArray(input.statuses, "ステータス", { max: 6, itemMax: 20 });
    if (statuses.some((status) => !statusValues.includes(status))) fail("INVALID_TOOL_ARGUMENTS", "参照対象に合わないステータスが指定されています。");
  }
  const minAvailablePercent = optionalNumber(input.minAvailablePercent, "最小空き配分", 0, 100);
  if (minAvailablePercent !== undefined && (!startDate || resource !== "members")) {
    fail("INVALID_TOOL_ARGUMENTS", "最小空き配分にはメンバー参照と期間指定が必要です。");
  }
  const sceneId = optionalUuid(input.sceneId, "検索シーンID");
  if (sceneId && resource !== "members") fail("INVALID_TOOL_ARGUMENTS", "検索シーンIDはメンバー参照だけで使えます。");
  const reportId = optionalUuid(input.reportId, "レポートID");
  if (reportId && resource !== "saved_reports") fail("INVALID_TOOL_ARGUMENTS", "レポートIDは保存レポート参照だけで使えます。");
  return compact({
    resource,
    query: optionalString(input.query, "検索語", { max: 120 }),
    personId: optionalUuid(input.personId, "メンバーID"),
    projectId: optionalUuid(input.projectId, "プロジェクトID"),
    ownerPersonId: optionalUuid(input.ownerPersonId, "責任者ID"),
    role: optionalString(input.role, "職種", { max: 120 }),
    location: optionalString(input.location, "勤務地", { max: 120 }),
    skills: optionalStringArray(input.skills, "スキル"),
    statuses,
    startDate,
    endDate,
    minAvailablePercent,
    sceneId,
    reportId,
    limit: optionalNumber(input.limit, "取得件数", 1, MAX_READ_RESULTS, { integer: true }) ?? DEFAULT_READ_RESULTS,
  });
}

export function parseWorkspaceToolCall(name, args) {
  if (typeof name !== "string" || !TOOL_NAMES.has(name)) fail("UNKNOWN_WORKSPACE_TOOL", "許可されていないAI操作です。", { status: 400 });
  if (name === READ_TOOL) return { mode: "read", toolName: name, args: parseReadArgs(args) };
  if (!isWorkspaceWriteTool(name)) fail("UNKNOWN_WORKSPACE_TOOL", "許可されていないAI操作です。", { status: 400 });
  const input = record(args);
  let normalized;
  switch (name) {
    case "create_member":
      normalized = parseMemberFields(input);
      break;
    case "update_member":
      allowedKeys(input, ["memberId", "patch"]);
      normalized = { memberId: uuidValue(input.memberId, "メンバーID"), patch: parseMemberFields(input.patch, true) };
      break;
    case "delete_member":
      allowedKeys(input, ["memberId"]);
      normalized = { memberId: uuidValue(input.memberId, "メンバーID") };
      break;
    case "create_project":
      normalized = parseProjectFields(input);
      break;
    case "update_project":
      allowedKeys(input, ["projectId", "patch"]);
      normalized = { projectId: uuidValue(input.projectId, "プロジェクトID"), patch: parseProjectFields(input.patch, true) };
      break;
    case "delete_project":
      allowedKeys(input, ["projectId"]);
      normalized = { projectId: uuidValue(input.projectId, "プロジェクトID") };
      break;
    case "create_assignment":
      normalized = parseAssignmentFields(input);
      break;
    case "update_assignment":
      allowedKeys(input, ["assignmentId", "patch"]);
      normalized = { assignmentId: uuidValue(input.assignmentId, "アサインID"), patch: parseAssignmentFields(input.patch, true) };
      break;
    case "delete_assignment":
      allowedKeys(input, ["assignmentId"]);
      normalized = { assignmentId: uuidValue(input.assignmentId, "アサインID") };
      break;
    case "create_staffing_need":
      normalized = parseNeedFields(input);
      break;
    case "update_staffing_need":
      allowedKeys(input, ["staffingNeedId", "patch"]);
      normalized = { staffingNeedId: uuidValue(input.staffingNeedId, "要員要件ID"), patch: parseNeedFields(input.patch, true) };
      break;
    case "delete_staffing_need":
      allowedKeys(input, ["staffingNeedId"]);
      normalized = { staffingNeedId: uuidValue(input.staffingNeedId, "要員要件ID") };
      break;
    case "assign_person_to_need":
      allowedKeys(input, ["staffingNeedId", "personId", "label"]);
      normalized = compact({
        staffingNeedId: uuidValue(input.staffingNeedId, "要員要件ID"),
        personId: uuidValue(input.personId, "メンバーID"),
        label: optionalString(input.label, "ラベル", { allowEmpty: true, nullable: true, max: 240 }),
      });
      break;
    case "create_opportunity":
      normalized = parseOpportunityFields(input);
      break;
    case "update_opportunity":
      allowedKeys(input, ["opportunityId", "patch"]);
      normalized = { opportunityId: uuidValue(input.opportunityId, "受注前案件ID"), patch: parseOpportunityFields(input.patch, true) };
      break;
    case "delete_opportunity":
      allowedKeys(input, ["opportunityId"]);
      normalized = { opportunityId: uuidValue(input.opportunityId, "受注前案件ID") };
      break;
    case "create_opportunity_need":
      normalized = parseOpportunityNeedFields(input);
      break;
    case "update_opportunity_need":
      allowedKeys(input, ["opportunityNeedId", "patch"]);
      normalized = { opportunityNeedId: uuidValue(input.opportunityNeedId, "要員計画ID"), patch: parseOpportunityNeedFields(input.patch, true) };
      break;
    case "delete_opportunity_need":
      allowedKeys(input, ["opportunityNeedId"]);
      normalized = { opportunityNeedId: uuidValue(input.opportunityNeedId, "要員計画ID") };
      break;
    case "convert_opportunity":
      allowedKeys(input, ["opportunityId"]);
      normalized = { opportunityId: uuidValue(input.opportunityId, "受注前案件ID") };
      break;
    case "create_org_unit":
      allowedKeys(input, ["name", "parentId", "sortOrder"]);
      normalized = compact({
        name: requiredString(input.name, "部門名", { max: 80 }),
        parentId: optionalUuid(input.parentId, "親部門ID", { nullable: true }),
        sortOrder: optionalNumber(input.sortOrder, "並び順", 0, 10000, { integer: true }),
      });
      break;
    case "update_org_unit":
      allowedKeys(input, ["orgUnitId", "patch"]);
      {
        const patchInput = record(input.patch, "部門変更");
        allowedKeys(patchInput, ["name", "parentId", "sortOrder"]);
        const patch = compact({
          name: optionalString(patchInput.name, "部門名", { max: 80 }),
          parentId: optionalUuid(patchInput.parentId, "親部門ID", { nullable: true }),
          sortOrder: optionalNumber(patchInput.sortOrder, "並び順", 0, 10000, { integer: true }),
        });
        if (Object.keys(patch).length === 0) fail("INVALID_TOOL_ARGUMENTS", "部門の変更項目を1つ以上指定してください。");
        normalized = { orgUnitId: uuidValue(input.orgUnitId, "部門ID"), patch };
      }
      break;
    case "delete_org_unit":
      allowedKeys(input, ["orgUnitId"]);
      normalized = { orgUnitId: uuidValue(input.orgUnitId, "部門ID") };
      break;
    case "set_member_org_memberships":
      allowedKeys(input, ["memberId", "primaryUnitId", "extraUnitIds", "managerUnitIds"]);
      normalized = compact({
        memberId: uuidValue(input.memberId, "メンバーID"),
        primaryUnitId: optionalUuid(input.primaryUnitId, "主所属ID", { nullable: true }),
        extraUnitIds: optionalUuidArray(input.extraUnitIds, "兼務部門"),
        managerUnitIds: optionalUuidArray(input.managerUnitIds, "責任者部門"),
      });
      break;
    case "create_search_scene":
      normalized = parseSearchSceneFields(input);
      break;
    case "delete_search_scene":
      allowedKeys(input, ["sceneId"]);
      normalized = { sceneId: uuidValue(input.sceneId, "検索シーンID") };
      break;
    case "create_saved_report":
      normalized = parseSavedReportFields(input);
      break;
    case "delete_saved_report":
      allowedKeys(input, ["reportId"]);
      normalized = { reportId: uuidValue(input.reportId, "レポートID") };
      break;
    default:
      fail("UNKNOWN_WORKSPACE_TOOL", "許可されていないAI操作です。");
  }
  return { mode: "write", toolName: name, args: normalized };
}

export function detectWorkspaceFunctionCalls(interaction) {
  if (!isRecord(interaction)) return [];
  const steps = Array.isArray(interaction.steps)
    ? interaction.steps
    : Array.isArray(interaction.outputs)
      ? interaction.outputs
      : [];
  return steps.filter((step) => isRecord(step) && step.type === "function_call").map((step) => {
    if (typeof step.id !== "string" || !step.id.trim() || typeof step.name !== "string" || !isRecord(step.arguments)) {
      fail("INVALID_FUNCTION_CALL", "GeminiのFunction Call形式が正しくありません。", { status: 502 });
    }
    return { id: step.id, name: step.name, arguments: step.arguments };
  });
}

function safeInteger(value) {
  const number = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isSafeInteger(number) && number >= 0 ? number : undefined;
}

function workspaceSnapshot(value) {
  const input = Array.isArray(value) && value.length === 1 ? value[0] : value;
  const envelope = record(input, "ワークスペース");
  const state = isRecord(envelope.state) ? envelope.state : isRecord(envelope.workspace) ? envelope.workspace : envelope;
  const organization = isRecord(envelope.organization) ? envelope.organization : isRecord(state.organization) ? state.organization : {};
  const organizationId = organization.id ?? envelope.organizationId;
  if (typeof organizationId !== "string" || !UUID_PATTERN.test(organizationId)) fail("INVALID_WORKSPACE", "組織IDを確認できません。", { status: 502 });
  const revision = safeInteger(envelope.revision ?? envelope.workspaceRevision ?? organization.workspaceRevision ?? organization.workspace_revision);
  if (revision === undefined) fail("INVALID_WORKSPACE", "ワークスペースの更新番号を確認できません。", { status: 502 });
  const collections = {};
  for (const key of ["members", "projects", "assignments", "needs"]) {
    if (!Array.isArray(state[key])) fail("INVALID_WORKSPACE", `ワークスペースの${key}形式が正しくありません。`, { status: 502 });
    collections[key] = structuredClone(state[key]);
  }
  collections.skillCatalog = Array.isArray(state.skillCatalog) ? structuredClone(state.skillCatalog) : [];
  collections.customFields = Array.isArray(state.customFields) ? structuredClone(state.customFields) : [];
  collections.opportunities = Array.isArray(state.opportunities) ? structuredClone(state.opportunities) : [];
  collections.opportunityNeeds = Array.isArray(state.opportunityNeeds) ? structuredClone(state.opportunityNeeds) : [];
  collections.orgUnits = Array.isArray(state.orgUnits) ? structuredClone(state.orgUnits) : [];
  collections.orgMemberships = Array.isArray(state.orgMemberships) ? structuredClone(state.orgMemberships) : [];
  collections.searchScenes = Array.isArray(state.searchScenes) ? structuredClone(state.searchScenes) : [];
  collections.savedReports = Array.isArray(state.savedReports) ? structuredClone(state.savedReports) : [];
  return { organizationId: organizationId.toLowerCase(), revision, ...collections };
}

function byId(items, id, label) {
  const item = items.find((candidate) => candidate?.id === id);
  if (!item) fail("WORKSPACE_ENTITY_NOT_FOUND", `${label}が見つかりません。最新データを読み込んでください。`, { status: 404 });
  return item;
}

function overlaps(item, startDate, endDate) {
  return !startDate || (item.startDate <= endDate && item.endDate >= startDate);
}

function lower(value) {
  return typeof value === "string" ? value.toLocaleLowerCase() : "";
}

function containsQuery(values, query) {
  if (!query) return true;
  const needle = lower(query);
  return values.some((value) => lower(value).includes(needle));
}

function skillLevel(member, name) {
  const levels = Array.isArray(member?.skillLevels) ? member.skillLevels : [];
  const found = levels.find((level) => lower(level?.name) === lower(name));
  if (found) return Number(found.proficiency);
  return (member?.skills ?? []).some((skill) => lower(skill) === lower(name)) ? 3 : undefined;
}

function includesSkills(actual, wanted) {
  if (!wanted?.length) return true;
  const actualValues = new Set((Array.isArray(actual) ? actual : []).map(lower));
  return wanted.every((skill) => actualValues.has(lower(skill)));
}

function equivalentSkillSet(actual, wanted) {
  const actualValues = new Set((Array.isArray(actual) ? actual : []).map(lower));
  const wantedValues = new Set((Array.isArray(wanted) ? wanted : []).map(lower));
  return actualValues.size === wantedValues.size && [...actualValues].every((skill) => wantedValues.has(skill));
}

function preserveCanonicalSkills(current, proposed) {
  return equivalentSkillSet(current, proposed) ? [...current] : proposed;
}

const DAY_MS = 86_400_000;

function dayNumber(value) {
  return Math.floor(Date.parse(`${value}T00:00:00Z`) / DAY_MS);
}

function containsBusinessDay(start, end) {
  if (end < start) return false;
  if (end - start >= 6) return true;
  for (let day = start; day <= end; day += 1) {
    const weekday = new Date(day * DAY_MS).getUTCDay();
    if (weekday !== 0 && weekday !== 6) return true;
  }
  return false;
}

function memberPeakLoad(state, personId, startDate, endDate, excludedAssignmentId) {
  const rangeStart = dayNumber(startDate);
  const rangeEnd = dayNumber(endDate);
  const events = new Map();
  for (const assignment of state.assignments) {
    if (assignment.id === excludedAssignmentId || assignment.personId !== personId || assignment.status === "cancelled") continue;
    const clippedStart = Math.max(rangeStart, dayNumber(assignment.startDate));
    const clippedEnd = Math.min(rangeEnd, dayNumber(assignment.endDate));
    if (clippedEnd < clippedStart) continue;
    events.set(clippedStart, (events.get(clippedStart) ?? 0) + Number(assignment.allocation));
    events.set(clippedEnd + 1, (events.get(clippedEnd + 1) ?? 0) - Number(assignment.allocation));
  }
  const days = [...events.keys()].sort((left, right) => left - right);
  let load = 0;
  let peak = 0;
  days.forEach((day, index) => {
    load += events.get(day) ?? 0;
    if (day > rangeEnd) return;
    const next = days[index + 1] ?? rangeEnd + 1;
    if (containsBusinessDay(day, Math.min(rangeEnd, next - 1))) peak = Math.max(peak, load);
  });
  return peak;
}

function buildSavedReportRows(state, report, startDate, endDate) {
  const groups = new Map();
  if (report.source === "projects") {
    for (const project of state.projects) {
      const label = project.status?.trim() || "未設定";
      const current = groups.get(label) ?? { count: 0, load: 0, capacity: 0 };
      groups.set(label, { count: current.count + 1, load: current.load, capacity: current.capacity });
    }
  } else {
    const groupBy = ["department", "role", "location"].includes(report.groupBy) ? report.groupBy : "department";
    for (const member of state.members) {
      const label = (groupBy === "role" ? member.role : groupBy === "location" ? member.location : member.department)?.trim() || "未設定";
      const current = groups.get(label) ?? { count: 0, load: 0, capacity: 0 };
      groups.set(label, {
        count: current.count + 1,
        load: current.load + memberPeakLoad(state, member.id, startDate, endDate),
        capacity: current.capacity + Number(member.capacity),
      });
    }
  }
  return [...groups.entries()].map(([label, group]) => {
    const avgLoad = group.capacity > 0 ? Math.round(group.load / group.capacity * 100) : 0;
    const value = report.source === "members" && report.metric === "avgLoad" ? avgLoad : group.count;
    return { label, count: group.count, value };
  }).sort((left, right) => right.value - left.value || String(left.label).localeCompare(String(right.label), "ja"));
}

function bounded(items, limit) {
  return { items: items.slice(0, limit), total: items.length, truncated: items.length > limit };
}

function orgUnitPath(units, id) {
  const byId = new Map((units ?? []).map((unit) => [unit.id, unit]));
  const path = [];
  const seen = new Set();
  let current = byId.get(id);
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    path.unshift(current.name);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return path;
}

function orgDescendantIds(units, id) {
  const ids = new Set();
  const children = new Map();
  (units ?? []).forEach((unit) => {
    const parentId = unit.parentId ?? null;
    children.set(parentId, [...(children.get(parentId) ?? []), unit.id]);
  });
  const walk = (unitId) => {
    if (ids.has(unitId)) return;
    ids.add(unitId);
    (children.get(unitId) ?? []).forEach(walk);
  };
  walk(id);
  return ids;
}

function membersInOrgSubtree(state, unitId, primaryOnly) {
  const ids = orgDescendantIds(state.orgUnits, unitId);
  const personIds = new Set(
    (state.orgMemberships ?? [])
      .filter((item) => ids.has(item.orgUnitId) && (!primaryOnly || item.isPrimary))
      .map((item) => item.personId),
  );
  return state.members.filter((member) => personIds.has(member.id));
}

function orgSearchLabels(state, personId) {
  return (state.orgMemberships ?? [])
    .filter((item) => item.personId === personId)
    .flatMap((item) => orgUnitPath(state.orgUnits, item.orgUnitId));
}

export function readWorkspaceTool(snapshot, name, args) {
  const parsed = parseWorkspaceToolCall(name, args);
  if (parsed.mode !== "read") fail("INVALID_TOOL_MODE", "参照toolではありません。");
  const state = workspaceSnapshot(snapshot);
  const filters = parsed.args;

  if (filters.resource === "summary") {
    const overloadedMembers = filters.startDate ? state.members.flatMap((member) => {
      const peakAllocation = memberPeakLoad(state, member.id, filters.startDate, filters.endDate);
      return peakAllocation > Number(member.capacity) ? [{ id: member.id, name: member.name, capacity: Number(member.capacity), peakAllocation }] : [];
    }) : [];
    return {
      resource: "summary",
      revision: state.revision,
      counts: {
        members: state.members.length,
        projects: state.projects.length,
        assignments: state.assignments.length,
        staffingNeeds: state.needs.length,
        openStaffingNeeds: state.needs.filter((need) => need.status === "open").length,
        opportunities: state.opportunities.length,
        activeOpportunities: state.opportunities.filter((opportunity) => ACTIVE_OPPORTUNITY_STAGES.includes(opportunity.stage)).length,
        opportunityNeeds: state.opportunityNeeds.length,
      },
      overloadedMembers: overloadedMembers.slice(0, MAX_READ_RESULTS),
    };
  }

  if (filters.resource === "members") {
    if (filters.sceneId) {
      const scene = byId(state.searchScenes, filters.sceneId, "検索シーン");
      const values = state.members.flatMap((member) => {
        const match = memberMatchesScene(state, member, scene);
        if (!match) return [];
        if (!containsQuery([
          member.name,
          member.role,
          member.department,
          member.location,
          ...(member.skills ?? []),
        ], filters.query)) return [];
        return [{
          id: member.id,
          name: member.name,
          role: member.role,
          department: member.department,
          location: member.location,
          skills: member.skills ?? [],
          capacity: Number(member.capacity),
          score: match.score,
          availablePercent: match.availablePercent,
          matchedMust: match.matchedMust,
          matchedNice: match.matchedNice,
        }];
      }).sort((left, right) => right.score - left.score || String(left.name).localeCompare(String(right.name), "ja"));
      return { resource: filters.resource, revision: state.revision, sceneId: scene.id, sceneName: scene.name, ...bounded(values, filters.limit) };
    }
    const values = state.members.filter((member) => containsQuery([
      member.name,
      member.role,
      member.department,
      member.location,
      ...(member.skills ?? []),
      ...Object.values(member.customValues ?? {}),
      ...(member.workHistory ?? []).flatMap((entry) => [entry.title, entry.organization, entry.description ?? ""]),
      ...orgSearchLabels(state, member.id),
    ], filters.query))
      .filter((member) => !filters.role || lower(member.role) === lower(filters.role))
      .filter((member) => !filters.location || lower(member.location) === lower(filters.location))
      .filter((member) => includesSkills(member.skills, filters.skills))
      .map((member) => {
        const availability = filters.startDate ? (() => {
          const peakAllocation = memberPeakLoad(state, member.id, filters.startDate, filters.endDate);
          return { peakAllocation, availablePercent: Math.max(0, Number(member.capacity) - peakAllocation) };
        })() : {};
        return { id: member.id, name: member.name, role: member.role, department: member.department, location: member.location, skills: member.skills ?? [], ...(Array.isArray(member.skillLevels) && member.skillLevels.length ? { skillLevels: member.skillLevels } : {}), ...(member.customValues && Object.keys(member.customValues).length ? { customValues: member.customValues } : {}), ...(Array.isArray(member.workHistory) && member.workHistory.length ? { workHistory: member.workHistory } : {}), capacity: Number(member.capacity), ...availability };
      })
      .filter((member) => filters.minAvailablePercent === undefined || member.availablePercent >= filters.minAvailablePercent);
    return { resource: filters.resource, revision: state.revision, ...bounded(values, filters.limit) };
  }

  if (filters.resource === "projects") {
    const values = state.projects.filter((project) => containsQuery([project.code, project.name, project.summary, project.ownerName, ...Object.values(project.customValues ?? {})], filters.query))
      .filter((project) => !filters.ownerPersonId || project.ownerPersonId === filters.ownerPersonId)
      .filter((project) => !filters.statuses?.length || filters.statuses.includes(project.status))
      .filter((project) => overlaps(project, filters.startDate, filters.endDate))
      .map((project) => ({ id: project.id, code: project.code, name: project.name, summary: project.summary, status: project.status, ownerPersonId: project.ownerPersonId ?? null, ownerName: project.ownerName ?? null, startDate: project.startDate, endDate: project.endDate, nextMilestone: project.nextMilestone, nextMilestoneDate: project.nextMilestoneDate ?? null, progress: Number(project.progress), demand: Number(project.demand), ...(project.customValues && Object.keys(project.customValues).length ? { customValues: project.customValues } : {}) }));
    return { resource: filters.resource, revision: state.revision, ...bounded(values, filters.limit) };
  }

  if (filters.resource === "assignments") {
    const members = new Map(state.members.map((member) => [member.id, member]));
    const projects = new Map(state.projects.map((project) => [project.id, project]));
    const values = state.assignments.filter((assignment) => !filters.personId || assignment.personId === filters.personId)
      .filter((assignment) => !filters.projectId || assignment.projectId === filters.projectId)
      .filter((assignment) => !filters.statuses?.length || filters.statuses.includes(assignment.status))
      .filter((assignment) => overlaps(assignment, filters.startDate, filters.endDate))
      .map((assignment) => ({ id: assignment.id, personId: assignment.personId, personName: members.get(assignment.personId)?.name ?? null, projectId: assignment.projectId, projectName: projects.get(assignment.projectId)?.name ?? null, startDate: assignment.startDate, endDate: assignment.endDate, allocation: Number(assignment.allocation), status: assignment.status, label: assignment.label ?? null, staffingNeedId: assignment.staffingNeedId ?? null }));
    return { resource: filters.resource, revision: state.revision, ...bounded(values, filters.limit) };
  }

  if (filters.resource === "opportunities") {
    const values = state.opportunities.filter((opportunity) => containsQuery([opportunity.code, opportunity.name, opportunity.summary, opportunity.ownerName], filters.query))
      .filter((opportunity) => !filters.ownerPersonId || opportunity.ownerPersonId === filters.ownerPersonId)
      .filter((opportunity) => !filters.statuses?.length || filters.statuses.includes(opportunity.stage))
      .filter((opportunity) => overlaps(opportunity, filters.startDate, filters.endDate))
      .map((opportunity) => ({ id: opportunity.id, code: opportunity.code, name: opportunity.name, summary: opportunity.summary, stage: opportunity.stage, ownerPersonId: opportunity.ownerPersonId ?? null, ownerName: opportunity.ownerName ?? null, startDate: opportunity.startDate, endDate: opportunity.endDate, demand: Number(opportunity.demand), convertedProjectId: opportunity.convertedProjectId ?? null }));
    return { resource: filters.resource, revision: state.revision, ...bounded(values, filters.limit) };
  }

  if (filters.resource === "opportunity_needs") {
    const opportunities = new Map(state.opportunities.map((opportunity) => [opportunity.id, opportunity]));
    const values = state.opportunityNeeds.filter((need) => containsQuery([need.role, ...(need.skills ?? [])], filters.query))
      .filter((need) => includesSkills(need.skills, filters.skills))
      .filter((need) => overlaps(need, filters.startDate, filters.endDate))
      .map((need) => ({ id: need.id, opportunityId: need.opportunityId, opportunityName: opportunities.get(need.opportunityId)?.name ?? null, role: need.role, skills: need.skills ?? [], startDate: need.startDate, endDate: need.endDate, allocation: Number(need.allocation) }));
    return { resource: filters.resource, revision: state.revision, ...bounded(values, filters.limit) };
  }

  if (filters.resource === "search_scenes") {
    const values = state.searchScenes.filter((scene) => containsQuery([scene.name, scene.query, scene.role, scene.location], filters.query))
      .map((scene) => ({
        id: scene.id,
        name: scene.name,
        query: scene.query ?? null,
        role: scene.role ?? null,
        location: scene.location ?? null,
        skills: scene.skills ?? [],
        startDate: scene.startDate ?? null,
        endDate: scene.endDate ?? null,
        minAvailablePercent: scene.minAvailablePercent ?? null,
      }));
    return { resource: filters.resource, revision: state.revision, ...bounded(values, filters.limit) };
  }

  if (filters.resource === "saved_reports") {
    const reports = state.savedReports.filter((report) => containsQuery([report.name, report.source, report.groupBy, report.metric], filters.query));
    const weekStart = filters.startDate;
    const values = (filters.reportId ? reports.filter((report) => report.id === filters.reportId) : reports).map((report) => ({
      id: report.id,
      name: report.name,
      source: report.source,
      groupBy: report.groupBy,
      metric: report.metric,
      ...(weekStart && filters.endDate ? { rows: buildSavedReportRows(state, report, weekStart, filters.endDate) } : {}),
    }));
    if (filters.reportId && values.length === 0) byId(state.savedReports, filters.reportId, "保存レポート");
    return { resource: filters.resource, revision: state.revision, ...bounded(values, filters.limit) };
  }

  const members = new Map(state.members.map((member) => [member.id, member]));
  const projects = new Map(state.projects.map((project) => [project.id, project]));
  if (filters.resource === "org_units") {
    const values = (state.orgUnits ?? []).filter((unit) => containsQuery([unit.name, ...(orgUnitPath(state.orgUnits, unit.id))], filters.query))
      .map((unit) => ({
        id: unit.id,
        name: unit.name,
        parentId: unit.parentId ?? null,
        path: orgUnitPath(state.orgUnits, unit.id),
        sortOrder: Number(unit.sortOrder ?? 0),
        primaryMemberCount: membersInOrgSubtree(state, unit.id, true).length,
        anyMemberCount: membersInOrgSubtree(state, unit.id, false).length,
        managers: (state.orgMemberships ?? []).filter((item) => item.orgUnitId === unit.id && item.isManager).map((item) => ({
          personId: item.personId,
          name: members.get(item.personId)?.name ?? null,
        })),
      }));
    return { resource: filters.resource, revision: state.revision, ...bounded(values, filters.limit) };
  }
  if (filters.resource === "org_memberships") {
    const units = new Map((state.orgUnits ?? []).map((unit) => [unit.id, unit]));
    const values = (state.orgMemberships ?? []).filter((item) => !filters.personId || item.personId === filters.personId)
      .filter((item) => containsQuery([
        members.get(item.personId)?.name,
        units.get(item.orgUnitId)?.name,
        ...(orgUnitPath(state.orgUnits, item.orgUnitId)),
      ], filters.query))
      .map((item) => ({
        id: item.id,
        personId: item.personId,
        personName: members.get(item.personId)?.name ?? null,
        orgUnitId: item.orgUnitId,
        orgUnitName: units.get(item.orgUnitId)?.name ?? null,
        path: orgUnitPath(state.orgUnits, item.orgUnitId),
        isPrimary: Boolean(item.isPrimary),
        isManager: Boolean(item.isManager),
      }));
    return { resource: filters.resource, revision: state.revision, ...bounded(values, filters.limit) };
  }
  const values = state.needs.filter((need) => !filters.projectId || need.projectId === filters.projectId)
    .filter((need) => !filters.statuses?.length || filters.statuses.includes(need.status))
    .filter((need) => includesSkills(need.skills, filters.skills))
    .filter((need) => overlaps(need, filters.startDate, filters.endDate))
    .map((need) => ({ id: need.id, projectId: need.projectId, projectName: projects.get(need.projectId)?.name ?? null, role: need.role, skills: need.skills ?? [], ...(Array.isArray(need.skillRequirements) && need.skillRequirements.length ? { skillRequirements: need.skillRequirements } : {}), startDate: need.startDate, endDate: need.endDate, allocation: Number(need.allocation), status: need.status, draftPersonId: need.draftPersonId ?? null, draftPersonName: members.get(need.draftPersonId)?.name ?? null }));
  return { resource: filters.resource, revision: state.revision, ...bounded(values, filters.limit) };
}

function makeInitials(name) {
  const compactName = name.replace(/\s/gu, "");
  return (compactName[0] || "N") + (compactName[compactName.length - 1] || "M");
}

function createProjectCode(name, id) {
  const prefix = name.replace(/[^A-Za-z0-9]/gu, "").slice(0, 8).toUpperCase() || "PJ";
  return `${prefix}-${id.replaceAll("-", "").slice(0, 11).toUpperCase()}`;
}

function assertProjectDates(project) {
  ensureDateRange(project.startDate, project.endDate, "プロジェクト期間");
  if (project.nextMilestoneDate && (project.nextMilestoneDate < project.startDate || project.nextMilestoneDate > project.endDate)) {
    fail("WORKSPACE_VALIDATION_FAILED", "マイルストーン日はプロジェクト期間内にしてください。");
  }
}

function assertWithinProject(item, project, label) {
  ensureDateRange(item.startDate, item.endDate, `${label}期間`);
  if (item.startDate < project.startDate || item.endDate > project.endDate) fail("WORKSPACE_VALIDATION_FAILED", `${label}期間はプロジェクト期間内にしてください。`);
}

function assertWithinOpportunity(item, opportunity, label) {
  ensureDateRange(item.startDate, item.endDate, `${label}期間`);
  if (item.startDate < opportunity.startDate || item.endDate > opportunity.endDate) fail("WORKSPACE_VALIDATION_FAILED", `${label}期間は案件の想定期間内にしてください。`);
}

function isActiveOpportunity(opportunity) {
  return ACTIVE_OPPORTUNITY_STAGES.includes(opportunity.stage) && !opportunity.convertedProjectId;
}

function memberMatchesNeed(member, need) {
  if (lower(member.role) !== lower(need.role)) return false;
  const requirements = Array.isArray(need.skillRequirements) && need.skillRequirements.length
    ? need.skillRequirements
    : (need.skills ?? []).map((name) => ({ name, minProficiency: 1 }));
  return requirements.every((requirement) => {
    const proficiency = skillLevel(member, requirement.name);
    return proficiency !== undefined && proficiency >= Number(requirement.minProficiency ?? 1);
  });
}

function memberMatchesScene(state, member, scene) {
  if (scene.role && lower(member.role) !== lower(scene.role)) return null;
  if (scene.location && lower(member.location) !== lower(scene.location)) return null;
  if (scene.query && !containsQuery([
    member.name,
    member.role,
    member.department,
    member.location,
    ...(member.skills ?? []),
    ...Object.values(member.customValues ?? {}),
    ...(member.workHistory ?? []).flatMap((entry) => [entry.title, entry.organization, entry.description ?? ""]),
  ], scene.query)) return null;
  const skills = Array.isArray(scene.skills) ? scene.skills : [];
  const matchedMust = [];
  for (const requirement of skills.filter((skill) => skill?.importance !== "nice")) {
    const proficiency = skillLevel(member, requirement.name);
    if (proficiency === undefined || proficiency < Number(requirement.minProficiency ?? 1)) return null;
    matchedMust.push(requirement.name);
  }
  const matchedNice = skills.filter((requirement) => requirement?.importance === "nice").flatMap((requirement) => {
    const proficiency = skillLevel(member, requirement.name);
    return proficiency !== undefined && proficiency >= Number(requirement.minProficiency ?? 1) ? [requirement.name] : [];
  });
  const availablePercent = scene.startDate && scene.endDate
    ? Math.max(0, Number(member.capacity) - memberPeakLoad(state, member.id, scene.startDate, scene.endDate))
    : Number(member.capacity);
  if (scene.minAvailablePercent !== undefined && scene.minAvailablePercent !== null && availablePercent < Number(scene.minAvailablePercent)) return null;
  return {
    score: Math.min(60, matchedNice.length * 20) + Math.min(40, Math.round(availablePercent * 0.4)),
    availablePercent,
    matchedMust,
    matchedNice,
  };
}

function assignmentMatchesNeed(state, assignment, need) {
  const member = state.members.find((candidate) => candidate.id === assignment.personId);
  const otherPeak = member
    ? memberPeakLoad(state, member.id, need.startDate, need.endDate, assignment.id)
    : Number.POSITIVE_INFINITY;
  return Boolean(member && memberMatchesNeed(member, need))
    && assignment.projectId === need.projectId
    && assignment.startDate <= need.startDate
    && assignment.endDate >= need.endDate
    && Number(assignment.allocation) >= Number(need.allocation)
    && otherPeak + Number(assignment.allocation) <= Number(member.capacity);
}

function cloneState(state) {
  return {
    members: structuredClone(state.members),
    projects: structuredClone(state.projects),
    assignments: structuredClone(state.assignments),
    needs: structuredClone(state.needs),
    skillCatalog: structuredClone(state.skillCatalog ?? []),
    customFields: structuredClone(state.customFields ?? []),
    opportunities: structuredClone(state.opportunities ?? []),
    opportunityNeeds: structuredClone(state.opportunityNeeds ?? []),
    orgUnits: structuredClone(state.orgUnits ?? []),
    orgMemberships: structuredClone(state.orgMemberships ?? []),
    searchScenes: structuredClone(state.searchScenes ?? []),
    savedReports: structuredClone(state.savedReports ?? []),
  };
}

export function stableStringify(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  return `{${Object.keys(value).filter((key) => value[key] !== undefined).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
}

export async function stableSha256(value) {
  const bytes = new TextEncoder().encode(stableStringify(value));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function changedRows(next, previous) {
  const before = new Map(previous.map((item) => [item.id, item]));
  return next.filter((item) => stableStringify(item) !== stableStringify(before.get(item.id)));
}

function removedIds(next, previous) {
  const ids = new Set(next.map((item) => item.id));
  return previous.filter((item) => !ids.has(item.id)).map((item) => item.id);
}

function workspacePayload(next, previous) {
  const payload = {};
  const memberUpsert = changedRows(next.members, previous.members);
  const memberArchive = removedIds(next.members, previous.members);
  if (memberUpsert.length || memberArchive.length) payload.members = { upsert: memberUpsert, archiveIds: memberArchive };
  const projectUpsert = changedRows(next.projects, previous.projects);
  const projectArchive = removedIds(next.projects, previous.projects);
  if (projectUpsert.length || projectArchive.length) payload.projects = { upsert: projectUpsert, archiveIds: projectArchive };
  const assignmentUpsert = changedRows(next.assignments, previous.assignments);
  const assignmentCancel = removedIds(next.assignments, previous.assignments);
  if (assignmentUpsert.length || assignmentCancel.length) payload.assignments = { upsert: assignmentUpsert, cancelIds: assignmentCancel };
  const needUpsert = changedRows(next.needs, previous.needs);
  const needCancel = removedIds(next.needs, previous.needs);
  if (needUpsert.length || needCancel.length) payload.needs = { upsert: needUpsert, cancelIds: needCancel };
  const catalogUpsert = changedRows(next.skillCatalog ?? [], previous.skillCatalog ?? []);
  const catalogArchive = removedIds(next.skillCatalog ?? [], previous.skillCatalog ?? []);
  if (catalogUpsert.length || catalogArchive.length) payload.skillCatalog = { upsert: catalogUpsert, archiveIds: catalogArchive };
  const fieldUpsert = changedRows(next.customFields ?? [], previous.customFields ?? []);
  const fieldArchive = removedIds(next.customFields ?? [], previous.customFields ?? []);
  if (fieldUpsert.length || fieldArchive.length) payload.customFields = { upsert: fieldUpsert, archiveIds: fieldArchive };
  const opportunityUpsert = changedRows(next.opportunities ?? [], previous.opportunities ?? []);
  const opportunityArchive = removedIds(next.opportunities ?? [], previous.opportunities ?? []);
  if (opportunityUpsert.length || opportunityArchive.length) payload.opportunities = { upsert: opportunityUpsert, archiveIds: opportunityArchive };
  const opportunityNeedUpsert = changedRows(next.opportunityNeeds ?? [], previous.opportunityNeeds ?? []);
  const opportunityNeedCancel = removedIds(next.opportunityNeeds ?? [], previous.opportunityNeeds ?? []);
  if (opportunityNeedUpsert.length || opportunityNeedCancel.length) payload.opportunityNeeds = { upsert: opportunityNeedUpsert, cancelIds: opportunityNeedCancel };
  const unitUpsert = changedRows(next.orgUnits ?? [], previous.orgUnits ?? []);
  const unitArchive = removedIds(next.orgUnits ?? [], previous.orgUnits ?? []);
  if (unitUpsert.length || unitArchive.length) payload.orgUnits = { upsert: unitUpsert, archiveIds: unitArchive };
  const membershipUpsert = changedRows(next.orgMemberships ?? [], previous.orgMemberships ?? []);
  const membershipArchive = removedIds(next.orgMemberships ?? [], previous.orgMemberships ?? []);
  if (membershipUpsert.length || membershipArchive.length) payload.orgMemberships = { upsert: membershipUpsert, archiveIds: membershipArchive };
  const sceneUpsert = changedRows(next.searchScenes ?? [], previous.searchScenes ?? []);
  const sceneArchive = removedIds(next.searchScenes ?? [], previous.searchScenes ?? []);
  if (sceneUpsert.length || sceneArchive.length) payload.searchScenes = { upsert: sceneUpsert, archiveIds: sceneArchive };
  const reportUpsert = changedRows(next.savedReports ?? [], previous.savedReports ?? []);
  const reportArchive = removedIds(next.savedReports ?? [], previous.savedReports ?? []);
  if (reportUpsert.length || reportArchive.length) payload.savedReports = { upsert: reportUpsert, archiveIds: reportArchive };
  return payload;
}

function operationCounts(payload) {
  return {
    membersChanged: (payload.members?.upsert.length ?? 0) + (payload.members?.archiveIds.length ?? 0),
    projectsChanged: (payload.projects?.upsert.length ?? 0) + (payload.projects?.archiveIds.length ?? 0),
    assignmentsChanged: (payload.assignments?.upsert.length ?? 0) + (payload.assignments?.cancelIds.length ?? 0),
    staffingNeedsChanged: (payload.needs?.upsert.length ?? 0) + (payload.needs?.cancelIds.length ?? 0),
    assignmentsCancelled: payload.assignments?.cancelIds.length ?? 0,
    staffingNeedsCancelled: payload.needs?.cancelIds.length ?? 0,
    membersArchived: payload.members?.archiveIds.length ?? 0,
    projectsArchived: payload.projects?.archiveIds.length ?? 0,
    opportunitiesChanged: (payload.opportunities?.upsert.length ?? 0) + (payload.opportunities?.archiveIds.length ?? 0),
    opportunityNeedsChanged: (payload.opportunityNeeds?.upsert.length ?? 0) + (payload.opportunityNeeds?.cancelIds.length ?? 0),
  };
}

function resolveGenerator(value, label) {
  const generated = typeof value === "function" ? value() : value;
  if (typeof generated !== "string" || !UUID_PATTERN.test(generated)) fail("INVALID_SERVER_IDENTIFIER", `${label}を生成できませんでした。`, { status: 500 });
  return generated.toLowerCase();
}

function actionPermission(role, toolName) {
  if (!ROLE_VALUES.has(role)) fail("FORBIDDEN", "組織権限を確認できません。", { status: 403 });
  if (role === "viewer") fail("FORBIDDEN", "閲覧者はデータを変更できません。", { status: 403 });
  if (role === "planner" && MEMBER_TOOLS.has(toolName)) fail("FORBIDDEN", "メンバー変更はオーナーまたは管理者だけが実行できます。", { status: 403 });
  if (role === "planner" && ORG_TOOLS.has(toolName)) fail("FORBIDDEN", "組織階層の変更はオーナーまたは管理者だけが実行できます。", { status: 403 });
  if (role === "planner" && SEARCH_SCENE_TOOLS.has(toolName)) fail("FORBIDDEN", "検索シーンの変更はオーナーまたは管理者だけが実行できます。", { status: 403 });
  if (role === "planner" && REPORT_TOOLS.has(toolName)) fail("FORBIDDEN", "レポート定義の変更はオーナーまたは管理者だけが実行できます。", { status: 403 });
}

function payloadIsDestructive(payload) {
  return Boolean(
    payload.members?.archiveIds.length
    ||     payload.projects?.archiveIds.length
    || payload.assignments?.cancelIds.length
    || payload.needs?.cancelIds.length
    || payload.opportunities?.archiveIds.length
    || payload.opportunityNeeds?.cancelIds.length
    || payload.orgUnits?.archiveIds.length
    || payload.orgMemberships?.archiveIds.length
    || payload.searchScenes?.archiveIds.length
    || payload.savedReports?.archiveIds.length,
  );
}

function overloadImpact(state, assignment) {
  const member = state.members.find((candidate) => candidate.id === assignment.personId);
  if (!member) return null;
  const peak = memberPeakLoad(state, member.id, assignment.startDate, assignment.endDate);
  return peak > Number(member.capacity) ? `${member.name}さんの最大稼働が${peak}%となり、上限${Number(member.capacity)}%を超えます。` : null;
}

function actionLabels(toolName) {
  const labels = {
    create_member: ["メンバーを登録", "登録する"],
    update_member: ["メンバーを更新", "更新する"],
    delete_member: ["メンバーをアーカイブ", "アーカイブする"],
    create_project: ["プロジェクトを登録", "登録する"],
    update_project: ["プロジェクトを更新", "更新する"],
    delete_project: ["プロジェクトをアーカイブ", "アーカイブする"],
    create_assignment: ["アサインを登録", "登録する"],
    update_assignment: ["アサインを更新", "更新する"],
    delete_assignment: ["アサインを取消", "取り消す"],
    create_staffing_need: ["要員要件を登録", "登録する"],
    update_staffing_need: ["要員要件を更新", "更新する"],
    delete_staffing_need: ["要員要件を取消", "取り消す"],
    assign_person_to_need: ["要員要件へアサイン", "アサインする"],
    create_opportunity: ["受注前案件を登録", "登録する"],
    update_opportunity: ["受注前案件を更新", "更新する"],
    delete_opportunity: ["受注前案件をアーカイブ", "アーカイブする"],
    create_opportunity_need: ["要員計画を登録", "登録する"],
    update_opportunity_need: ["要員計画を更新", "更新する"],
    delete_opportunity_need: ["要員計画を取消", "取り消す"],
    convert_opportunity: ["受注前案件をプロジェクトへ引き継ぐ", "引き継ぐ"],
    create_org_unit: ["部門を登録", "登録する"],
    update_org_unit: ["部門を更新", "更新する"],
    delete_org_unit: ["部門を削除", "削除する"],
    set_member_org_memberships: ["所属を更新", "更新する"],
    create_search_scene: ["検索シーンを保存", "保存する"],
    delete_search_scene: ["検索シーンを削除", "削除する"],
    create_saved_report: ["レポートを保存", "保存する"],
    delete_saved_report: ["レポートを削除", "削除する"],
  };
  return labels[toolName];
}

function previewValue(value) {
  if (value === null || value === undefined || value === "") return "未設定";
  if (Array.isArray(value)) return value.length ? value.join(", ") : "未設定";
  return String(value);
}

function percentPreview(value) {
  return value === null || value === undefined || value === "" ? "未設定" : `${value}%`;
}

function headcountPreview(value) {
  return value === null || value === undefined || value === "" ? "未設定" : `${value}名`;
}

function memberPreview(state, id, fallback) {
  if (!id) return "未設定";
  return state.members.find((member) => member.id === id)?.name ?? fallback ?? id;
}

function projectPreview(state, id) {
  if (!id) return "未設定";
  return state.projects.find((project) => project.id === id)?.name ?? id;
}

function needPreview(state, id) {
  if (!id) return "未設定";
  const need = state.needs.find((candidate) => candidate.id === id);
  if (!need) return id;
  return `${projectPreview(state, need.projectId)} / ${need.role}`;
}

function needStatusPreview(value) {
  return ({ open: "未充足", planned: "仮置き", filled: "充足済み" })[value] ?? previewValue(value);
}

function addPreviewChange(details, label, before, after, format = previewValue) {
  if (stableStringify(before) === stableStringify(after)) return;
  details.push({ label, value: `${format(before)} → ${format(after)}` });
}

function applyAction(state, toolName, args, newUuid, requestId) {
  const next = cloneState(state);
  const details = [];
  const impacts = [];
  let subject = "";
  let relevantAssignment;

  if (toolName === "create_member") {
    const id = newUuid();
    const member = { id, initials: args.initials ?? makeInitials(args.name), name: args.name, role: args.role, department: args.department, avatarTone: args.avatarTone ?? "lavender", skills: args.skills, location: args.location, capacity: args.capacity };
    next.members.push(member);
    subject = member.name;
    details.push(`${member.role} / ${member.department} / 稼働上限${member.capacity}%`);
  } else if (toolName === "update_member") {
    const current = byId(next.members, args.memberId, "メンバー");
    const patch = {
      ...args.patch,
      ...(args.patch.skills !== undefined ? { skills: preserveCanonicalSkills(current.skills ?? [], args.patch.skills) } : {}),
    };
    const updated = { ...current, ...patch };
    if (patch.name !== undefined && patch.name !== current.name && patch.initials === undefined) updated.initials = makeInitials(updated.name);
    const reopened = new Set();
    const stateWithMember = { ...next, members: next.members.map((member) => member.id === updated.id ? updated : member) };
    for (const need of next.needs) {
      if (need.draftPersonId === updated.id && (!memberMatchesNeed(updated, need) || Number(updated.capacity) < Number(need.allocation))) reopened.add(need.id);
    }
    for (const assignment of next.assignments) {
      if (assignment.personId !== updated.id || !assignment.staffingNeedId) continue;
      const need = next.needs.find((candidate) => candidate.id === assignment.staffingNeedId);
      if (need && (!assignmentMatchesNeed(stateWithMember, assignment, need) || Number(updated.capacity) < Number(assignment.allocation))) reopened.add(need.id);
    }
    next.members = stateWithMember.members;
    next.projects = next.projects.map((project) => project.ownerPersonId === updated.id || (!project.ownerPersonId && project.ownerName === current.name) ? { ...project, ownerPersonId: updated.id, ownerName: updated.name, ownerInitials: updated.initials } : project);
    next.assignments = next.assignments.filter((assignment) => !assignment.staffingNeedId || !reopened.has(assignment.staffingNeedId));
    next.needs = next.needs.map((need) => reopened.has(need.id) ? { ...need, status: "open", draftPersonId: null } : need);
    subject = updated.name;
    addPreviewChange(details, "氏名", current.name, updated.name);
    addPreviewChange(details, "職種", current.role, updated.role);
    addPreviewChange(details, "部署", current.department, updated.department);
    addPreviewChange(details, "勤務地", current.location, updated.location);
    addPreviewChange(details, "スキル", current.skills, updated.skills);
    addPreviewChange(details, "稼働上限", current.capacity, updated.capacity, percentPreview);
    addPreviewChange(details, "イニシャル", current.initials, updated.initials);
    addPreviewChange(details, "アバター色", current.avatarTone, updated.avatarTone);
    if (reopened.size) impacts.push(`${reopened.size}件の要員要件を再オープンし、紐づくアサインを取り消します。`);
  } else if (toolName === "delete_member") {
    const member = byId(next.members, args.memberId, "メンバー");
    const owned = next.projects.filter((project) => project.ownerPersonId === member.id || (!project.ownerPersonId && project.ownerName === member.name));
    if (owned.length) fail("MEMBER_OWNS_PROJECT", `${member.name}さんは${owned[0].name}の責任者です。先に別の責任者へ変更してください。`);
    const assignments = next.assignments.filter((assignment) => assignment.personId === member.id);
    const reopened = new Set(assignments.flatMap((assignment) => assignment.staffingNeedId ? [assignment.staffingNeedId] : []));
    next.needs.forEach((need) => { if (need.draftPersonId === member.id) reopened.add(need.id); });
    next.members = next.members.filter((candidate) => candidate.id !== member.id);
    next.orgMemberships = (next.orgMemberships ?? []).filter((item) => item.personId !== member.id);
    next.assignments = next.assignments.filter((assignment) => assignment.personId !== member.id);
    next.needs = next.needs.map((need) => reopened.has(need.id) ? { ...need, status: "open", draftPersonId: null } : need);
    subject = member.name;
    details.push("メンバーをアーカイブします。");
    if (assignments.length) impacts.push(`${assignments.length}件の関連アサインを取り消します。`);
    if (reopened.size) impacts.push(`${reopened.size}件の要員要件を再オープンします。`);
  } else if (toolName === "create_project") {
    const id = newUuid();
    const owner = args.ownerPersonId ? byId(next.members, args.ownerPersonId, "責任者メンバー") : undefined;
    const project = { id, code: args.code ?? createProjectCode(args.name, id), name: args.name, summary: args.summary ?? "", status: args.status ?? "準備中", tone: args.tone ?? "blue", ownerPersonId: owner?.id, ownerName: owner?.name ?? null, ownerInitials: owner?.initials ?? null, startDate: args.startDate, endDate: args.endDate, nextMilestone: args.nextMilestone ?? "", nextMilestoneDate: args.nextMilestoneDate ?? null, progress: args.progress ?? 0, demand: args.demand ?? 0 };
    assertProjectDates(project);
    if (next.projects.some((candidate) => lower(candidate.code) === lower(project.code))) fail("DUPLICATE_PROJECT_CODE", "同じプロジェクトコードがすでに使われています。");
    next.projects.push(project);
    subject = project.name;
    details.push(`${project.startDate}〜${project.endDate} / ${project.status}`);
  } else if (toolName === "update_project") {
    const current = byId(next.projects, args.projectId, "プロジェクト");
    const owner = args.patch.ownerPersonId ? byId(next.members, args.patch.ownerPersonId, "責任者メンバー") : undefined;
    const updated = { ...current, ...args.patch, ...(owner ? { ownerPersonId: owner.id, ownerName: owner.name, ownerInitials: owner.initials } : {}) };
    assertProjectDates(updated);
    if (next.projects.some((candidate) => candidate.id !== updated.id && lower(candidate.code) === lower(updated.code))) fail("DUPLICATE_PROJECT_CODE", "同じプロジェクトコードがすでに使われています。");
    const cancelledNeeds = new Set(next.needs.filter((need) => need.projectId === updated.id && (need.startDate < updated.startDate || need.endDate > updated.endDate)).map((need) => need.id));
    const cancelledAssignments = new Set(next.assignments.filter((assignment) => assignment.projectId === updated.id && (assignment.startDate < updated.startDate || assignment.endDate > updated.endDate)).map((assignment) => assignment.id));
    const reopened = new Set();
    next.assignments.forEach((assignment) => {
      if (cancelledAssignments.has(assignment.id) && assignment.staffingNeedId && !cancelledNeeds.has(assignment.staffingNeedId)) reopened.add(assignment.staffingNeedId);
      if (assignment.staffingNeedId && cancelledNeeds.has(assignment.staffingNeedId)) cancelledAssignments.add(assignment.id);
    });
    next.projects = next.projects.map((project) => project.id === updated.id ? updated : project);
    next.assignments = next.assignments.filter((assignment) => !cancelledAssignments.has(assignment.id));
    next.needs = next.needs.filter((need) => !cancelledNeeds.has(need.id)).map((need) => reopened.has(need.id) ? { ...need, status: "open", draftPersonId: null } : need);
    subject = updated.name;
    addPreviewChange(details, "プロジェクトコード", current.code, updated.code);
    addPreviewChange(details, "プロジェクト名", current.name, updated.name);
    addPreviewChange(details, "概要", current.summary, updated.summary);
    addPreviewChange(details, "ステータス", current.status, updated.status);
    addPreviewChange(details, "表示色", current.tone, updated.tone);
    addPreviewChange(details, "責任者", current.ownerPersonId, updated.ownerPersonId, (id) => memberPreview(next, id, id === current.ownerPersonId ? current.ownerName : updated.ownerName));
    addPreviewChange(details, "開始日", current.startDate, updated.startDate);
    addPreviewChange(details, "終了日", current.endDate, updated.endDate);
    addPreviewChange(details, "次のマイルストーン", current.nextMilestone, updated.nextMilestone);
    addPreviewChange(details, "マイルストーン日", current.nextMilestoneDate, updated.nextMilestoneDate);
    addPreviewChange(details, "進捗", current.progress, updated.progress, percentPreview);
    addPreviewChange(details, "必要人数", current.demand, updated.demand, headcountPreview);
    if (cancelledAssignments.size) impacts.push(`${cancelledAssignments.size}件の期間外アサインを取り消します。`);
    if (cancelledNeeds.size) impacts.push(`${cancelledNeeds.size}件の期間外要員要件を取り消します。`);
    if (reopened.size) impacts.push(`${reopened.size}件の要員要件を再オープンします。`);
  } else if (toolName === "delete_project") {
    const project = byId(next.projects, args.projectId, "プロジェクト");
    const assignmentCount = next.assignments.filter((assignment) => assignment.projectId === project.id).length;
    const needCount = next.needs.filter((need) => need.projectId === project.id).length;
    next.projects = next.projects.filter((candidate) => candidate.id !== project.id);
    next.assignments = next.assignments.filter((assignment) => assignment.projectId !== project.id);
    next.needs = next.needs.filter((need) => need.projectId !== project.id);
    subject = project.name;
    details.push("プロジェクトをアーカイブします。");
    if (assignmentCount) impacts.push(`${assignmentCount}件の関連アサインを取り消します。`);
    if (needCount) impacts.push(`${needCount}件の関連要員要件を取り消します。`);
  } else if (toolName === "create_assignment") {
    const person = byId(next.members, args.personId, "メンバー");
    const project = byId(next.projects, args.projectId, "プロジェクト");
    const assignment = { id: newUuid(), personId: person.id, projectId: project.id, startDate: args.startDate, endDate: args.endDate, allocation: args.allocation, status: "confirmed", label: args.label ?? null, staffingNeedId: null, clientRequestId: requestId };
    assertWithinProject(assignment, project, "アサイン");
    next.assignments.push(assignment);
    relevantAssignment = assignment;
    subject = `${person.name} → ${project.name}`;
    details.push(`${assignment.startDate}〜${assignment.endDate} / ${assignment.allocation}%`);
  } else if (toolName === "update_assignment") {
    const current = byId(next.assignments, args.assignmentId, "アサイン");
    const updated = { ...current, ...args.patch };
    const person = byId(next.members, updated.personId, "メンバー");
    const project = byId(next.projects, updated.projectId, "プロジェクト");
    assertWithinProject(updated, project, "アサイン");
    if (current.staffingNeedId) {
      const need = next.needs.find((candidate) => candidate.id === current.staffingNeedId);
      const testState = { ...next, assignments: next.assignments.map((assignment) => assignment.id === updated.id ? updated : assignment) };
      if (need && !assignmentMatchesNeed(testState, updated, need)) {
        updated.staffingNeedId = null;
        updated.clientRequestId = null;
        next.needs = next.needs.map((candidate) => candidate.id === need.id ? { ...candidate, status: "open", draftPersonId: null } : candidate);
        impacts.push(`要員要件「${need.role}」を再オープンし、このアサインとの紐づけを解除します。`);
      } else if (need) {
        next.needs = next.needs.map((candidate) => candidate.id === need.id ? {
          ...candidate,
          status: updated.status === "draft" ? "planned" : "filled",
          draftPersonId: updated.personId,
        } : candidate);
      }
    }
    next.assignments = next.assignments.map((assignment) => assignment.id === updated.id ? updated : assignment);
    relevantAssignment = updated;
    subject = `${person.name} → ${project.name}`;
    addPreviewChange(details, "メンバー", current.personId, updated.personId, (id) => memberPreview(next, id));
    addPreviewChange(details, "プロジェクト", current.projectId, updated.projectId, (id) => projectPreview(next, id));
    addPreviewChange(details, "開始日", current.startDate, updated.startDate);
    addPreviewChange(details, "終了日", current.endDate, updated.endDate);
    addPreviewChange(details, "稼働配分", current.allocation, updated.allocation, percentPreview);
    addPreviewChange(details, "ラベル", current.label, updated.label);
    addPreviewChange(details, "要員要件との紐づけ", current.staffingNeedId, updated.staffingNeedId, (id) => needPreview(next, id));
  } else if (toolName === "delete_assignment") {
    const assignment = byId(next.assignments, args.assignmentId, "アサイン");
    const person = byId(next.members, assignment.personId, "メンバー");
    const project = byId(next.projects, assignment.projectId, "プロジェクト");
    next.assignments = next.assignments.filter((candidate) => candidate.id !== assignment.id);
    if (assignment.staffingNeedId) {
      next.needs = next.needs.map((need) => need.id === assignment.staffingNeedId ? { ...need, status: "open", draftPersonId: null } : need);
      impacts.push("紐づく要員要件を再オープンします。");
    }
    subject = `${person.name} → ${project.name}`;
    details.push("アサインを取り消します。");
  } else if (toolName === "create_staffing_need") {
    const project = byId(next.projects, args.projectId, "プロジェクト");
    const need = { id: newUuid(), projectId: project.id, role: args.role, skills: args.skills, startDate: args.startDate, endDate: args.endDate, allocation: args.allocation, status: "open", draftPersonId: null };
    assertWithinProject(need, project, "要員要件");
    next.needs.push(need);
    subject = `${project.name} / ${need.role}`;
    details.push(`${need.startDate}〜${need.endDate} / ${need.allocation}%`);
  } else if (toolName === "update_staffing_need") {
    const current = byId(next.needs, args.staffingNeedId, "要員要件");
    const patch = {
      ...args.patch,
      ...(args.patch.skills !== undefined ? { skills: preserveCanonicalSkills(current.skills ?? [], args.patch.skills) } : {}),
    };
    const updated = { ...current, ...patch };
    const project = byId(next.projects, updated.projectId, "プロジェクト");
    assertWithinProject(updated, project, "要員要件");
    const linked = next.assignments.filter((assignment) => assignment.staffingNeedId === updated.id);
    const testState = { ...next, needs: next.needs.map((need) => need.id === updated.id ? updated : need) };
    const valid = linked.filter((assignment) => assignmentMatchesNeed(testState, assignment, updated));
    const invalidIds = new Set(linked.filter((assignment) => !valid.some((candidate) => candidate.id === assignment.id)).map((assignment) => assignment.id));
    const reconciled = valid.length ? { ...updated, draftPersonId: valid[0].personId } : { ...updated, status: "open", draftPersonId: null };
    next.assignments = next.assignments.filter((assignment) => !invalidIds.has(assignment.id));
    next.needs = next.needs.map((need) => need.id === reconciled.id ? reconciled : need);
    subject = `${project.name} / ${reconciled.role}`;
    addPreviewChange(details, "プロジェクト", current.projectId, reconciled.projectId, (id) => projectPreview(next, id));
    addPreviewChange(details, "必要ロール", current.role, reconciled.role);
    addPreviewChange(details, "必要スキル", current.skills, reconciled.skills);
    addPreviewChange(details, "開始日", current.startDate, reconciled.startDate);
    addPreviewChange(details, "終了日", current.endDate, reconciled.endDate);
    addPreviewChange(details, "必要配分", current.allocation, reconciled.allocation, percentPreview);
    addPreviewChange(details, "状態", current.status, reconciled.status, needStatusPreview);
    addPreviewChange(details, "担当候補", current.draftPersonId, reconciled.draftPersonId, (id) => memberPreview(next, id));
    if (invalidIds.size) impacts.push(`${invalidIds.size}件の条件を満たさないアサインを取り消し、要員要件を再オープンします。`);
  } else if (toolName === "delete_staffing_need") {
    const need = byId(next.needs, args.staffingNeedId, "要員要件");
    const project = byId(next.projects, need.projectId, "プロジェクト");
    const linkedCount = next.assignments.filter((assignment) => assignment.staffingNeedId === need.id).length;
    next.needs = next.needs.filter((candidate) => candidate.id !== need.id);
    next.assignments = next.assignments.filter((assignment) => assignment.staffingNeedId !== need.id);
    subject = `${project.name} / ${need.role}`;
    details.push("要員要件を取り消します。");
    if (linkedCount) impacts.push(`${linkedCount}件の紐づくアサインを取り消します。`);
  } else if (toolName === "assign_person_to_need") {
    const need = byId(next.needs, args.staffingNeedId, "要員要件");
    if (need.status !== "open") fail("STAFFING_NEED_NOT_OPEN", "この要員要件はすでに対応済みです。最新データを確認してください。");
    const person = byId(next.members, args.personId, "メンバー");
    const project = byId(next.projects, need.projectId, "プロジェクト");
    if (!memberMatchesNeed(person, need)) fail("MEMBER_DOES_NOT_MATCH_NEED", "選択したメンバーは必要ロールまたはスキルを満たしていません。");
    const currentPeak = memberPeakLoad(next, person.id, need.startDate, need.endDate);
    if (currentPeak + Number(need.allocation) > Number(person.capacity)) fail("MEMBER_CAPACITY_EXCEEDED", `${person.name}さんの空き容量ではこの要員要件を満たせません。`);
    const assignment = { id: newUuid(), personId: person.id, projectId: project.id, staffingNeedId: need.id, startDate: need.startDate, endDate: need.endDate, allocation: Number(need.allocation), status: "confirmed", label: args.label ?? null, clientRequestId: requestId };
    next.assignments.push(assignment);
    next.needs = next.needs.map((candidate) => candidate.id === need.id ? { ...candidate, status: "filled", draftPersonId: person.id } : candidate);
    relevantAssignment = assignment;
    subject = `${person.name} → ${project.name} / ${need.role}`;
    details.push(`${assignment.startDate}〜${assignment.endDate} / ${assignment.allocation}%`);
  } else if (toolName === "create_opportunity") {
    const id = newUuid();
    const owner = args.ownerPersonId ? byId(next.members, args.ownerPersonId, "責任者メンバー") : undefined;
    const opportunity = { id, code: args.code ?? createProjectCode(args.name, id), name: args.name, summary: args.summary ?? "", stage: args.stage ?? "inquiry", tone: args.tone ?? "sky", ownerPersonId: owner?.id, ownerName: owner?.name ?? null, ownerInitials: owner?.initials ?? null, startDate: args.startDate, endDate: args.endDate, demand: args.demand ?? 0 };
    ensureDateRange(opportunity.startDate, opportunity.endDate, "想定期間");
    if (next.opportunities.some((candidate) => lower(candidate.code) === lower(opportunity.code))) fail("DUPLICATE_OPPORTUNITY_CODE", "同じ案件コードがすでに使われています。");
    next.opportunities.push(opportunity);
    subject = opportunity.name;
    details.push(`${opportunity.startDate}〜${opportunity.endDate} / ${opportunity.stage}`);
  } else if (toolName === "update_opportunity") {
    const current = byId(next.opportunities, args.opportunityId, "受注前案件");
    if (!isActiveOpportunity(current)) fail("OPPORTUNITY_NOT_EDITABLE", "受注済みまたは失注の案件は編集できません。");
    const owner = args.patch.ownerPersonId ? byId(next.members, args.patch.ownerPersonId, "責任者メンバー") : undefined;
    const updated = { ...current, ...args.patch, ...(owner ? { ownerPersonId: owner.id, ownerName: owner.name, ownerInitials: owner.initials } : {}) };
    ensureDateRange(updated.startDate, updated.endDate, "想定期間");
    if (!isActiveOpportunity(updated)) fail("OPPORTUNITY_NOT_EDITABLE", "受注と失注は専用の操作から行ってください。");
    if (next.opportunities.some((candidate) => candidate.id !== updated.id && lower(candidate.code) === lower(updated.code))) fail("DUPLICATE_OPPORTUNITY_CODE", "同じ案件コードがすでに使われています。");
    const cancelled = new Set(next.opportunityNeeds.filter((need) => need.opportunityId === updated.id && (need.startDate < updated.startDate || need.endDate > updated.endDate)).map((need) => need.id));
    next.opportunities = next.opportunities.map((opportunity) => opportunity.id === updated.id ? updated : opportunity);
    next.opportunityNeeds = next.opportunityNeeds.filter((need) => !cancelled.has(need.id));
    subject = updated.name;
    addPreviewChange(details, "案件コード", current.code, updated.code);
    addPreviewChange(details, "案件名", current.name, updated.name);
    addPreviewChange(details, "概要", current.summary, updated.summary);
    addPreviewChange(details, "段階", current.stage, updated.stage);
    addPreviewChange(details, "責任者", current.ownerPersonId, updated.ownerPersonId, (id) => memberPreview(next, id, id === current.ownerPersonId ? current.ownerName : updated.ownerName));
    addPreviewChange(details, "開始日", current.startDate, updated.startDate);
    addPreviewChange(details, "終了日", current.endDate, updated.endDate);
    addPreviewChange(details, "必要人数", current.demand, updated.demand, headcountPreview);
    if (cancelled.size) impacts.push(`${cancelled.size}件の期間外要員計画を取り消します。`);
  } else if (toolName === "delete_opportunity") {
    const opportunity = byId(next.opportunities, args.opportunityId, "受注前案件");
    const needCount = next.opportunityNeeds.filter((need) => need.opportunityId === opportunity.id).length;
    next.opportunities = next.opportunities.filter((candidate) => candidate.id !== opportunity.id);
    next.opportunityNeeds = next.opportunityNeeds.filter((need) => need.opportunityId !== opportunity.id);
    subject = opportunity.name;
    details.push("受注前案件をアーカイブします。");
    if (needCount) impacts.push(`${needCount}件の関連要員計画を取り消します。`);
  } else if (toolName === "create_opportunity_need") {
    const opportunity = byId(next.opportunities, args.opportunityId, "受注前案件");
    if (!isActiveOpportunity(opportunity)) fail("OPPORTUNITY_NOT_EDITABLE", "進行中の受注前案件にだけ要員計画を追加できます。");
    const need = { id: newUuid(), opportunityId: opportunity.id, role: args.role, skills: args.skills, startDate: args.startDate, endDate: args.endDate, allocation: args.allocation };
    assertWithinOpportunity(need, opportunity, "要員計画");
    next.opportunityNeeds.push(need);
    subject = `${opportunity.name} / ${need.role}`;
    details.push(`${need.startDate}〜${need.endDate} / ${need.allocation}%`);
  } else if (toolName === "update_opportunity_need") {
    const current = byId(next.opportunityNeeds, args.opportunityNeedId, "要員計画");
    const patch = {
      ...args.patch,
      ...(args.patch.skills !== undefined ? { skills: preserveCanonicalSkills(current.skills ?? [], args.patch.skills) } : {}),
    };
    const updated = { ...current, ...patch };
    const opportunity = byId(next.opportunities, updated.opportunityId, "受注前案件");
    if (!isActiveOpportunity(opportunity)) fail("OPPORTUNITY_NOT_EDITABLE", "進行中の受注前案件の要員計画だけ編集できます。");
    assertWithinOpportunity(updated, opportunity, "要員計画");
    next.opportunityNeeds = next.opportunityNeeds.map((need) => need.id === updated.id ? updated : need);
    subject = `${opportunity.name} / ${updated.role}`;
    addPreviewChange(details, "案件", current.opportunityId, updated.opportunityId, (id) => next.opportunities.find((item) => item.id === id)?.name ?? id);
    addPreviewChange(details, "必要ロール", current.role, updated.role);
    addPreviewChange(details, "必要スキル", current.skills, updated.skills);
    addPreviewChange(details, "開始日", current.startDate, updated.startDate);
    addPreviewChange(details, "終了日", current.endDate, updated.endDate);
    addPreviewChange(details, "必要配分", current.allocation, updated.allocation, percentPreview);
  } else if (toolName === "delete_opportunity_need") {
    const need = byId(next.opportunityNeeds, args.opportunityNeedId, "要員計画");
    const opportunity = byId(next.opportunities, need.opportunityId, "受注前案件");
    next.opportunityNeeds = next.opportunityNeeds.filter((candidate) => candidate.id !== need.id);
    subject = `${opportunity.name} / ${need.role}`;
    details.push("要員計画を取り消します。");
  } else if (toolName === "convert_opportunity") {
    const opportunity = byId(next.opportunities, args.opportunityId, "受注前案件");
    if (!isActiveOpportunity(opportunity)) fail("OPPORTUNITY_NOT_CONVERTIBLE", "受注できる段階ではありません。");
    const owner = opportunity.ownerPersonId ? byId(next.members, opportunity.ownerPersonId, "責任者メンバー") : undefined;
    const projectId = newUuid();
    const project = {
      id: projectId,
      code: createProjectCode(opportunity.name, projectId),
      name: opportunity.name,
      summary: opportunity.summary ?? "",
      status: "準備中",
      tone: opportunity.tone ?? "sky",
      ownerPersonId: owner?.id ?? opportunity.ownerPersonId,
      ownerName: owner?.name ?? opportunity.ownerName ?? null,
      ownerInitials: owner?.initials ?? opportunity.ownerInitials ?? null,
      startDate: opportunity.startDate,
      endDate: opportunity.endDate,
      nextMilestone: "キックオフ",
      nextMilestoneDate: opportunity.startDate,
      progress: 0,
      demand: Number(opportunity.demand ?? 0),
    };
    const planNeeds = next.opportunityNeeds.filter((need) => need.opportunityId === opportunity.id);
    next.projects.push(project);
    planNeeds.forEach((need) => {
      next.needs.push({
        id: newUuid(),
        projectId,
        role: need.role,
        skills: need.skills ?? [],
        skillRequirements: need.skillRequirements,
        startDate: need.startDate,
        endDate: need.endDate,
        allocation: Number(need.allocation),
        status: "open",
        draftPersonId: null,
      });
    });
    next.opportunities = next.opportunities.map((item) => item.id === opportunity.id ? { ...item, stage: "won", convertedProjectId: projectId } : item);
    subject = opportunity.name;
    details.push(`プロジェクト「${project.name}」へ引き継ぎます。`);
    if (planNeeds.length) impacts.push(`${planNeeds.length}件の要員計画を未充足の要員要件として複製します。`);
  } else if (toolName === "create_org_unit") {
    if ((next.orgUnits ?? []).some((unit) => lower(unit.name) === lower(args.name))) fail("WORKSPACE_VALIDATION_FAILED", "同じ名前の部門がすでにあります。");
    if (args.parentId) byId(next.orgUnits, args.parentId, "親部門");
    const unit = { id: newUuid(), name: args.name, parentId: args.parentId ?? null, sortOrder: args.sortOrder ?? (next.orgUnits.length + 1) };
    next.orgUnits.push(unit);
    subject = unit.name;
    details.push(args.parentId ? `親部門: ${orgUnitPath(next.orgUnits, args.parentId).join(" / ")}` : "最上位部門");
  } else if (toolName === "update_org_unit") {
    const current = byId(next.orgUnits, args.orgUnitId, "部門");
    const parentId = args.patch.parentId === undefined ? current.parentId ?? null : args.patch.parentId;
    if (parentId) {
      byId(next.orgUnits, parentId, "親部門");
      if (parentId === current.id || orgDescendantIds(next.orgUnits, current.id).has(parentId)) {
        fail("WORKSPACE_VALIDATION_FAILED", "部門を自分の配下へは移せません。");
      }
    }
    const name = args.patch.name ?? current.name;
    if ((next.orgUnits ?? []).some((unit) => unit.id !== current.id && lower(unit.name) === lower(name))) {
      fail("WORKSPACE_VALIDATION_FAILED", "同じ名前の部門がすでにあります。");
    }
    const updated = { ...current, ...args.patch, parentId };
    next.orgUnits = next.orgUnits.map((unit) => unit.id === updated.id ? updated : unit);
    if (args.patch.name && args.patch.name !== current.name) {
      next.members = next.members.map((member) => {
        const primary = (next.orgMemberships ?? []).find((item) => item.personId === member.id && item.isPrimary);
        return primary?.orgUnitId === updated.id ? { ...member, department: updated.name } : member;
      });
    }
    subject = updated.name;
    addPreviewChange(details, "部門名", current.name, updated.name);
    addPreviewChange(details, "親部門", current.parentId ?? null, updated.parentId ?? null, (value) => value ? orgUnitPath(next.orgUnits, value).join(" / ") : "最上位");
  } else if (toolName === "delete_org_unit") {
    const unit = byId(next.orgUnits, args.orgUnitId, "部門");
    if ((next.orgUnits ?? []).some((item) => item.parentId === unit.id)) fail("WORKSPACE_VALIDATION_FAILED", "配下の部門を先に移すか削除してください。");
    if ((next.orgMemberships ?? []).some((item) => item.orgUnitId === unit.id)) fail("WORKSPACE_VALIDATION_FAILED", "所属メンバーを先に別部門へ移してください。");
    next.orgUnits = next.orgUnits.filter((item) => item.id !== unit.id);
    subject = unit.name;
    details.push("部門を削除します。");
  } else if (toolName === "set_member_org_memberships") {
    const member = byId(next.members, args.memberId, "メンバー");
    const extra = [...new Set(args.extraUnitIds ?? [])].filter((id) => id && id !== args.primaryUnitId);
    const managerIds = new Set(args.managerUnitIds ?? []);
    const unitIds = [...new Set([args.primaryUnitId, ...extra].filter(Boolean))];
    unitIds.forEach((id) => byId(next.orgUnits, id, "部門"));
    const remaining = (next.orgMemberships ?? []).filter((item) => item.personId !== member.id);
    next.orgMemberships = [
      ...remaining,
      ...unitIds.map((orgUnitId) => ({
        id: (state.orgMemberships ?? []).find((item) => item.personId === member.id && item.orgUnitId === orgUnitId)?.id ?? newUuid(),
        personId: member.id,
        orgUnitId,
        isPrimary: orgUnitId === args.primaryUnitId,
        isManager: managerIds.has(orgUnitId),
      })),
    ];
    const primary = next.orgUnits.find((unit) => unit.id === args.primaryUnitId);
    if (primary) next.members = next.members.map((item) => item.id === member.id ? { ...item, department: primary.name } : item);
    subject = member.name;
    details.push(primary ? `主所属: ${orgUnitPath(next.orgUnits, primary.id).join(" / ")}` : "主所属なし");
    if (extra.length) details.push(`兼務: ${extra.map((id) => orgUnitPath(next.orgUnits, id).join(" / ")).join("、")}`);
  } else if (toolName === "create_search_scene") {
    if (next.searchScenes.some((scene) => lower(scene.name) === lower(args.name))) fail("DUPLICATE_SEARCH_SCENE", "同じ名前の検索シーンがすでにあります。");
    const scene = compact({
      id: newUuid(),
      name: args.name,
      query: args.query,
      role: args.role,
      location: args.location,
      skills: args.skills ?? [],
      startDate: args.startDate,
      endDate: args.endDate,
      minAvailablePercent: args.minAvailablePercent,
    });
    next.searchScenes.push(scene);
    subject = scene.name;
    details.push([scene.role, scene.location, `${(scene.skills ?? []).length}件のスキル条件`].filter(Boolean).join(" / "));
  } else if (toolName === "delete_search_scene") {
    const scene = byId(next.searchScenes, args.sceneId, "検索シーン");
    next.searchScenes = next.searchScenes.filter((candidate) => candidate.id !== scene.id);
    subject = scene.name;
    details.push("検索シーンを削除します。");
  } else if (toolName === "create_saved_report") {
    if (next.savedReports.some((report) => lower(report.name) === lower(args.name))) fail("DUPLICATE_SAVED_REPORT", "同じ名前のレポートがすでにあります。");
    const report = { id: newUuid(), name: args.name, source: args.source, groupBy: args.groupBy, metric: args.metric };
    next.savedReports.push(report);
    subject = report.name;
    details.push(`${report.source} / ${report.groupBy} / ${report.metric}`);
  } else if (toolName === "delete_saved_report") {
    const report = byId(next.savedReports, args.reportId, "保存レポート");
    next.savedReports = next.savedReports.filter((candidate) => candidate.id !== report.id);
    subject = report.name;
    details.push("レポート定義を削除します。");
  }

  if (relevantAssignment) {
    const overload = overloadImpact(next, relevantAssignment);
    if (overload) impacts.push(overload);
  }
  return { next, subject, details, impacts };
}

export async function planWorkspaceAction(options) {
  const { snapshot, role, toolName, args } = options ?? {};
  const parsed = parseWorkspaceToolCall(toolName, args);
  if (parsed.mode !== "write") fail("INVALID_TOOL_MODE", "変更toolではありません。");
  actionPermission(role, parsed.toolName);
  const current = workspaceSnapshot(snapshot);
  const requestId = resolveGenerator(options.requestId ?? (() => crypto.randomUUID()), "request ID");
  const uuidSource = options.uuid ?? (() => crypto.randomUUID());
  const newUuid = () => resolveGenerator(uuidSource, "UUID");
  const applied = applyAction(current, parsed.toolName, parsed.args, newUuid, requestId);
  const payload = workspacePayload(applied.next, current);
  if (Object.keys(payload).length === 0) fail("NO_WORKSPACE_CHANGES", "変更内容が現在のデータと同じため、保存は行いません。", { status: 409 });
  const payloadHash = await stableSha256(payload);
  const counts = operationCounts(payload);
  const [label, confirmLabel] = actionLabels(parsed.toolName);
  const destructive = payloadIsDestructive(payload);
  const preview = {
    type: parsed.toolName,
    title: `${label}しますか？`,
    summary: applied.subject,
    details: applied.details,
    impacts: applied.impacts,
    confirmLabel,
    destructive,
  };
  return {
    kind: "workspace_action",
    version: 1,
    toolName: parsed.toolName,
    role,
    organizationId: current.organizationId,
    expectedRevision: current.revision,
    requestId,
    action: { toolName: parsed.toolName, args: parsed.args },
    payload,
    payloadHash,
    counts,
    preview,
  };
}

export function buildWorkspaceSaveRequest(plan) {
  const value = record(plan, "保存計画");
  if (value.kind !== "workspace_action" || value.version !== 1 || !isRecord(value.payload)) fail("INVALID_WORKSPACE_PLAN", "保存計画の形式が正しくありません。", { status: 500 });
  const organizationId = uuidValue(value.organizationId, "組織ID");
  const requestId = uuidValue(value.requestId, "request ID");
  const expectedRevision = safeInteger(value.expectedRevision);
  if (expectedRevision === undefined) fail("INVALID_WORKSPACE_PLAN", "保存計画の更新番号が正しくありません。", { status: 500 });
  if (typeof value.payloadHash !== "string" || !/^[0-9a-f]{64}$/u.test(value.payloadHash)) fail("INVALID_WORKSPACE_PLAN", "保存計画のhashが正しくありません。", { status: 500 });
  if (Object.keys(value.payload).length === 0) fail("NO_WORKSPACE_CHANGES", "空の変更は保存できません。", { status: 409 });
  return {
    p_organization_id: organizationId,
    p_expected_revision: expectedRevision,
    p_request_id: requestId,
    p_payload: value.payload,
    p_payload_hash: value.payloadHash,
  };
}
