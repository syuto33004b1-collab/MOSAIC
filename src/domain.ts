export type Tone = "blue" | "mint" | "orange" | "plum" | "sky";
/** Every tone needs a `--<tone>` custom property and an `.avatar.<tone>` rule in
 *  styles.css. This list exists at runtime so a test can check that. */
export const AVATAR_TONES = ["lavender", "peach", "sky", "mint", "sand", "rose"] as const;
export type AvatarTone = (typeof AVATAR_TONES)[number];
export type AssignmentStatus = "confirmed" | "draft";
export type NeedStatus = "open" | "planned" | "filled";
export type ProjectStatus = "進行中" | "要注意" | "準備中" | "完了間近" | "完了";

export type SkillKind = "category" | "skill";
export type SkillProficiency = 1 | 2 | 3 | 4 | 5;

export type SkillDefinition = {
  id: string;
  name: string;
  kind: SkillKind;
  parentId?: string | null;
  sortOrder?: number;
};

export type SkillLevel = {
  name: string;
  proficiency: SkillProficiency;
};

export type NeedSkillRequirement = {
  name: string;
  minProficiency: SkillProficiency;
};

export type SkillMapRow = {
  id: string;
  name: string;
  kind: SkillKind;
  parentId: string | null;
  depth: number;
  path: string[];
  memberCount: number;
  byProficiency: Record<SkillProficiency, number>;
  departments: { department: string; count: number }[];
  openNeedCount: number;
  qualifiedCount: number;
  gap: number;
};

export type CustomFieldEntity = "member" | "project";
export type CustomFieldType = "text" | "number" | "date" | "select";
export type CustomFieldSurface = "list" | "detail" | "search";

export type CustomFieldDefinition = {
  id: string;
  entityType: CustomFieldEntity;
  key: string;
  label: string;
  fieldType: CustomFieldType;
  required?: boolean;
  options?: string[];
  showInList?: boolean;
  showInDetail?: boolean;
  searchable?: boolean;
  sortOrder?: number;
  /** False when the caller's role may read this field but not change it. */
  canEdit?: boolean;
};

export type WorkHistoryEntry = {
  id: string;
  title: string;
  organization: string;
  startDate: string;
  endDate?: string | null;
  description?: string;
};

export type OrgUnit = {
  id: string;
  name: string;
  parentId?: string | null;
  sortOrder?: number;
};

export type OrgMembership = {
  id: string;
  personId: string;
  orgUnitId: string;
  isPrimary: boolean;
  isManager: boolean;
};

export type OrgUnitLoadRow = {
  id: string;
  name: string;
  path: string[];
  depth: number;
  count: number;
  average: number;
  managers: string[];
};

export const PROFICIENCY_LABELS: Record<SkillProficiency, string> = {
  1: "初級",
  2: "基礎",
  3: "実務",
  4: "応用",
  5: "指導",
};

export const OPPORTUNITY_STAGES: OpportunityStage[] = ["inquiry", "proposal", "negotiation", "won", "lost"];
export const ACTIVE_OPPORTUNITY_STAGES: OpportunityStage[] = ["inquiry", "proposal", "negotiation"];
export const OPPORTUNITY_STAGE_LABELS: Record<OpportunityStage, string> = {
  inquiry: "引き合い",
  proposal: "提案",
  negotiation: "商談",
  won: "受注",
  lost: "失注",
};

export type Member = {
  id: string;
  authUserId?: string;
  initials: string;
  name: string;
  role: string;
  department: string;
  avatarTone: AvatarTone;
  skills: string[];
  skillLevels?: SkillLevel[];
  location: string;
  capacity: number;
  customValues?: Record<string, string>;
  workHistory?: WorkHistoryEntry[];
};

export type Project = {
  id: string;
  code: string;
  name: string;
  summary: string;
  status: ProjectStatus;
  tone: Tone;
  ownerPersonId?: string;
  ownerName?: string | null;
  ownerInitials?: string | null;
  startDate: string;
  endDate: string;
  nextMilestone: string;
  nextMilestoneDate?: string | null;
  progress: number;
  demand: number;
  customValues?: Record<string, string>;
};

export type Assignment = {
  id: string;
  personId: string;
  projectId: string;
  startDate: string;
  endDate: string;
  allocation: number;
  status: AssignmentStatus;
  label?: string;
  staffingNeedId?: string | null;
  clientRequestId?: string | null;
};

export type StaffingNeed = {
  id: string;
  projectId: string;
  role: string;
  skills: string[];
  skillRequirements?: NeedSkillRequirement[];
  startDate: string;
  endDate: string;
  allocation: number;
  status: NeedStatus;
  draftPersonId?: string | null;
};

export type OpportunityStage = "inquiry" | "proposal" | "negotiation" | "won" | "lost";

export type Opportunity = {
  id: string;
  code: string;
  name: string;
  summary: string;
  stage: OpportunityStage;
  tone: Tone;
  ownerPersonId?: string;
  ownerName?: string | null;
  ownerInitials?: string | null;
  startDate: string;
  endDate: string;
  demand: number;
  convertedProjectId?: string | null;
};

export type OpportunityNeed = {
  id: string;
  opportunityId: string;
  role: string;
  skills: string[];
  skillRequirements?: NeedSkillRequirement[];
  startDate: string;
  endDate: string;
  allocation: number;
};

export const RESTRICTABLE_ROLES = ["admin", "planner", "viewer"] as const;
export type RestrictableRole = (typeof RESTRICTABLE_ROLES)[number];

export const PERSON_SCOPES = ["organization", "unit_subtree", "unit", "self"] as const;
export type PersonScope = (typeof PERSON_SCOPES)[number];

export const RESTRICTABLE_FEATURES = [
  "searchScenes",
  "savedReports",
  "profileRequests",
  "opportunities",
  "favorites",
  "externalMcp",
] as const;
export type RestrictableFeature = (typeof RESTRICTABLE_FEATURES)[number];

/** Per-role limits as stored. Owner is always unrestricted and never listed. */
export type RolePermission = {
  role: RestrictableRole;
  personScope: PersonScope;
  hiddenFieldKeys: string[];
  readonlyFieldKeys: string[];
  disabledFeatures: RestrictableFeature[];
};

export type WorkspaceState = {
  members: Member[];
  projects: Project[];
  assignments: Assignment[];
  needs: StaffingNeed[];
  skillCatalog?: SkillDefinition[];
  customFields?: CustomFieldDefinition[];
  opportunities?: Opportunity[];
  opportunityNeeds?: OpportunityNeed[];
  orgUnits?: OrgUnit[];
  orgMemberships?: OrgMembership[];
  searchScenes?: SearchScene[];
  savedReports?: SavedReport[];
  profileRequests?: ProfileRequest[];
  rolePermissions?: RolePermission[];
};

export type ProfileRequestScope = "skills" | "workHistory" | "all";
export type ProfileRequestStatus = "open" | "submitted" | "done" | "cancelled";

export type ProfileRequest = {
  id: string;
  personId: string;
  scope: ProfileRequestScope;
  note?: string;
  status: ProfileRequestStatus;
  proposedSkills?: SkillLevel[];
  proposedWorkHistory?: WorkHistoryEntry[];
};

export type ReportSource = "members" | "projects";
export type ReportGroupBy = "department" | "role" | "location" | "status";
export type ReportMetric = "count" | "avgLoad";

export type SavedReport = {
  id: string;
  name: string;
  source: ReportSource;
  groupBy: ReportGroupBy;
  metric: ReportMetric;
};

export type ReportRow = {
  key: string;
  label: string;
  count: number;
  value: number;
};

export type SkillImportance = "must" | "nice";

export type SearchSkillFilter = {
  name: string;
  minProficiency: SkillProficiency;
  importance: SkillImportance;
};

export type SearchScene = {
  id: string;
  name: string;
  query?: string;
  role?: string;
  location?: string;
  skills?: SearchSkillFilter[];
  startDate?: string;
  endDate?: string;
  minAvailablePercent?: number;
};

export type MemberMatch = {
  member: Member;
  score: number;
  availablePercent: number;
  matchedMust: string[];
  matchedNice: string[];
};

export type WeekDay = {
  day: string;
  date: number;
  month: number;
  year: number;
  iso: string;
};

export const projectTone: Record<string, Tone> = {
  atlas: "blue",
  recruit: "mint",
  payment: "orange",
  mobile: "sky",
  kite: "sky",
  nimbus: "plum",
  orion: "orange",
  pulse: "mint",
};

const customFields: CustomFieldDefinition[] = [
  { id: "field-employment", entityType: "member", key: "employment_type", label: "雇用形態", fieldType: "select", options: ["正社員", "契約", "業務委託"], showInList: true, showInDetail: true, searchable: true, sortOrder: 10 },
  { id: "field-joined", entityType: "member", key: "joined_on", label: "入社日", fieldType: "date", showInDetail: true, searchable: false, sortOrder: 20 },
  { id: "field-english", entityType: "member", key: "english", label: "英語", fieldType: "select", options: ["不要", "日常会話", "ビジネス", "ネイティブ"], showInList: true, showInDetail: true, searchable: true, sortOrder: 30 },
  { id: "field-client", entityType: "project", key: "client_name", label: "顧客名", fieldType: "text", showInList: true, showInDetail: true, searchable: true, sortOrder: 10 },
  { id: "field-contract", entityType: "project", key: "contract_type", label: "契約形態", fieldType: "select", options: ["準委任", "請負", "派遣"], showInDetail: true, searchable: true, sortOrder: 20 },
];

const orgUnits: OrgUnit[] = [
  { id: "org-engineering", name: "開発本部", sortOrder: 10 },
  { id: "org-product", name: "プロダクト開発", parentId: "org-engineering", sortOrder: 10 },
  { id: "org-platform", name: "プラットフォーム", parentId: "org-engineering", sortOrder: 20 },
  { id: "org-quality", name: "品質保証", parentId: "org-engineering", sortOrder: 30 },
  { id: "org-design-div", name: "デザイン本部", sortOrder: 20 },
  { id: "org-design", name: "デザイン", parentId: "org-design-div", sortOrder: 10 },
  { id: "org-corporate", name: "コーポレート", sortOrder: 30 },
  { id: "org-business", name: "事業推進", parentId: "org-corporate", sortOrder: 10 },
  { id: "org-data", name: "データ戦略", parentId: "org-corporate", sortOrder: 20 },
];

const orgMemberships: OrgMembership[] = [
  { id: "om-saeki-design", personId: "saeki", orgUnitId: "org-design", isPrimary: true, isManager: true },
  { id: "om-saeki-product", personId: "saeki", orgUnitId: "org-product", isPrimary: false, isManager: false },
  { id: "om-nakamura", personId: "nakamura", orgUnitId: "org-product", isPrimary: true, isManager: true },
  { id: "om-suzuki", personId: "suzuki", orgUnitId: "org-platform", isPrimary: true, isManager: true },
  { id: "om-hayashi", personId: "hayashi", orgUnitId: "org-business", isPrimary: true, isManager: true },
  { id: "om-matsumoto", personId: "matsumoto", orgUnitId: "org-quality", isPrimary: true, isManager: false },
  { id: "om-ito", personId: "ito", orgUnitId: "org-data", isPrimary: true, isManager: true },
  { id: "om-morita", personId: "morita", orgUnitId: "org-design", isPrimary: true, isManager: false },
  { id: "om-takahashi", personId: "takahashi", orgUnitId: "org-product", isPrimary: true, isManager: false },
  { id: "om-okada", personId: "okada", orgUnitId: "org-quality", isPrimary: true, isManager: true },
];

const skillCatalog: SkillDefinition[] = [
  { id: "cat-engineering", name: "エンジニアリング", kind: "category", sortOrder: 10 },
  { id: "cat-frontend", name: "フロントエンド", kind: "category", parentId: "cat-engineering", sortOrder: 10 },
  { id: "cat-backend", name: "バックエンド", kind: "category", parentId: "cat-engineering", sortOrder: 20 },
  { id: "cat-mobile", name: "モバイル", kind: "category", parentId: "cat-engineering", sortOrder: 30 },
  { id: "cat-data", name: "データ", kind: "category", parentId: "cat-engineering", sortOrder: 40 },
  { id: "cat-design", name: "デザイン", kind: "category", sortOrder: 20 },
  { id: "cat-quality", name: "品質保証", kind: "category", sortOrder: 30 },
  { id: "cat-delivery", name: "デリバリー", kind: "category", sortOrder: 40 },
  { id: "skill-react", name: "React", kind: "skill", parentId: "cat-frontend", sortOrder: 10 },
  { id: "skill-typescript", name: "TypeScript", kind: "skill", parentId: "cat-frontend", sortOrder: 20 },
  { id: "skill-a11y", name: "A11y", kind: "skill", parentId: "cat-frontend", sortOrder: 30 },
  { id: "skill-java", name: "Java", kind: "skill", parentId: "cat-backend", sortOrder: 10 },
  { id: "skill-aws", name: "AWS", kind: "skill", parentId: "cat-backend", sortOrder: 20 },
  { id: "skill-api", name: "API", kind: "skill", parentId: "cat-backend", sortOrder: 30 },
  { id: "skill-payments", name: "Payments", kind: "skill", parentId: "cat-backend", sortOrder: 40 },
  { id: "skill-ios", name: "iOS", kind: "skill", parentId: "cat-mobile", sortOrder: 10 },
  { id: "skill-swift", name: "Swift", kind: "skill", parentId: "cat-mobile", sortOrder: 20 },
  { id: "skill-mobile", name: "Mobile", kind: "skill", parentId: "cat-mobile", sortOrder: 30 },
  { id: "skill-python", name: "Python", kind: "skill", parentId: "cat-data", sortOrder: 10 },
  { id: "skill-sql", name: "SQL", kind: "skill", parentId: "cat-data", sortOrder: 20 },
  { id: "skill-bi", name: "BI", kind: "skill", parentId: "cat-data", sortOrder: 30 },
  { id: "skill-figma", name: "Figma", kind: "skill", parentId: "cat-design", sortOrder: 10 },
  { id: "skill-ux", name: "UX", kind: "skill", parentId: "cat-design", sortOrder: 20 },
  { id: "skill-design-system", name: "Design system", kind: "skill", parentId: "cat-design", sortOrder: 30 },
  { id: "skill-research", name: "Research", kind: "skill", parentId: "cat-design", sortOrder: 40 },
  { id: "skill-interview", name: "Interview", kind: "skill", parentId: "cat-design", sortOrder: 50 },
  { id: "skill-qa", name: "QA", kind: "skill", parentId: "cat-quality", sortOrder: 10 },
  { id: "skill-automation", name: "Automation", kind: "skill", parentId: "cat-quality", sortOrder: 20 },
  { id: "skill-web", name: "Web", kind: "skill", parentId: "cat-quality", sortOrder: 30 },
  { id: "skill-pm", name: "PM", kind: "skill", parentId: "cat-delivery", sortOrder: 10 },
  { id: "skill-scrum", name: "Scrum", kind: "skill", parentId: "cat-delivery", sortOrder: 20 },
  { id: "skill-b2b", name: "B2B", kind: "skill", parentId: "cat-delivery", sortOrder: 30 },
];

const members: Member[] = [
  { id: "saeki", initials: "YS", name: "佐伯 優斗", role: "Product Designer", department: "デザイン", avatarTone: "lavender", skills: ["Figma", "UX", "Design system"], skillLevels: [{ name: "Figma", proficiency: 5 }, { name: "UX", proficiency: 4 }, { name: "Design system", proficiency: 4 }], location: "東京", capacity: 100, customValues: { "field-employment": "正社員", "field-joined": "2021-04-01", "field-english": "ビジネス" }, workHistory: [{ id: "wh-saeki-1", title: "プロダクトデザイナー", organization: "GIFTEE Inc.", startDate: "2021-04-01", description: "販売管理と採用ブランドの体験設計" }, { id: "wh-saeki-2", title: "UIデザイナー", organization: "Studio North", startDate: "2018-04-01", endDate: "2021-03-31", description: "B2B管理画面のデザインシステム構築" }] },
  { id: "nakamura", initials: "MN", name: "中村 美咲", role: "Frontend Engineer", department: "プロダクト開発", avatarTone: "peach", skills: ["React", "TypeScript", "A11y"], skillLevels: [{ name: "React", proficiency: 4 }, { name: "TypeScript", proficiency: 4 }, { name: "A11y", proficiency: 3 }], location: "東京", capacity: 100, customValues: { "field-employment": "正社員", "field-joined": "2022-07-01", "field-english": "日常会話" }, workHistory: [{ id: "wh-nakamura-1", title: "フロントエンドエンジニア", organization: "Atlas リニューアル", startDate: "2022-07-01", description: "販売管理フロントの刷新" }] },
  { id: "suzuki", initials: "KS", name: "鈴木 健太", role: "Backend Engineer", department: "プラットフォーム", avatarTone: "sky", skills: ["Java", "AWS", "Payments"], skillLevels: [{ name: "Java", proficiency: 4 }, { name: "AWS", proficiency: 5 }, { name: "Payments", proficiency: 3 }], location: "大阪", capacity: 100, customValues: { "field-employment": "正社員", "field-joined": "2019-10-01", "field-english": "ビジネス" } },
  { id: "hayashi", initials: "AH", name: "林 葵", role: "Project Manager", department: "事業推進", avatarTone: "mint", skills: ["PM", "Scrum", "B2B"], skillLevels: [{ name: "PM", proficiency: 5 }, { name: "Scrum", proficiency: 4 }, { name: "B2B", proficiency: 3 }], location: "東京", capacity: 100 },
  { id: "matsumoto", initials: "RM", name: "松本 蓮", role: "QA Engineer", department: "品質保証", avatarTone: "sand", skills: ["QA", "Mobile", "Automation"], skillLevels: [{ name: "QA", proficiency: 4 }, { name: "Mobile", proficiency: 3 }, { name: "Automation", proficiency: 3 }], location: "福岡", capacity: 100 },
  { id: "ito", initials: "YI", name: "伊藤 優", role: "Data Analyst", department: "データ戦略", avatarTone: "rose", skills: ["Python", "SQL", "BI"], skillLevels: [{ name: "Python", proficiency: 4 }, { name: "SQL", proficiency: 5 }, { name: "BI", proficiency: 3 }], location: "リモート", capacity: 100 },
  { id: "morita", initials: "AM", name: "森田 葵", role: "UX Researcher", department: "デザイン", avatarTone: "mint", skills: ["Research", "UX", "Interview"], skillLevels: [{ name: "Research", proficiency: 5 }, { name: "UX", proficiency: 4 }, { name: "Interview", proficiency: 4 }], location: "東京", capacity: 100 },
  { id: "takahashi", initials: "NT", name: "高橋 直樹", role: "Mobile Engineer", department: "プロダクト開発", avatarTone: "lavender", skills: ["iOS", "Swift", "Mobile"], skillLevels: [{ name: "iOS", proficiency: 4 }, { name: "Swift", proficiency: 4 }, { name: "Mobile", proficiency: 4 }], location: "大阪", capacity: 100 },
  { id: "okada", initials: "SO", name: "岡田 紗季", role: "QA Engineer", department: "品質保証", avatarTone: "rose", skills: ["QA", "Web", "Automation"], skillLevels: [{ name: "QA", proficiency: 3 }, { name: "Web", proficiency: 3 }, { name: "Automation", proficiency: 4 }], location: "東京", capacity: 100 },
];

const projects: Project[] = [
  { id: "atlas", code: "ATL", name: "Atlas リニューアル", summary: "販売管理プロダクトの全面刷新", status: "進行中", tone: "blue", ownerName: "林 葵", ownerInitials: "AH", startDate: "2026-07-06", endDate: "2026-10-31", nextMilestone: "β版レビュー", nextMilestoneDate: "2026-08-28", progress: 58, demand: 6, customValues: { "field-client": "Atlas株式会社", "field-contract": "準委任" } },
  { id: "payment", code: "PAY", name: "決済基盤アップデート", summary: "決済処理の可用性と監査対応を強化", status: "要注意", tone: "orange", ownerName: "鈴木 健太", ownerInitials: "KS", startDate: "2026-07-20", endDate: "2026-09-18", nextMilestone: "移行判定", nextMilestoneDate: "2026-08-21", progress: 71, demand: 4, customValues: { "field-client": "決済基盤チーム", "field-contract": "請負" } },
  { id: "recruit", code: "REC", name: "採用サイト", summary: "採用ブランドと応募体験の刷新", status: "完了間近", tone: "mint", ownerName: "林 葵", ownerInitials: "AH", startDate: "2026-07-27", endDate: "2026-09-04", nextMilestone: "公開前確認", nextMilestoneDate: "2026-08-26", progress: 84, demand: 3 },
  { id: "mobile", code: "MOB", name: "モバイル会員証", summary: "会員証とクーポンを統合した新規アプリ", status: "準備中", tone: "sky", ownerName: "高橋 直樹", ownerInitials: "NT", startDate: "2026-08-24", endDate: "2026-11-27", nextMilestone: "キックオフ", nextMilestoneDate: "2026-08-24", progress: 12, demand: 3 },
  { id: "kite", code: "KIT", name: "Kite データ統合", summary: "事業データを統合し指標定義を標準化", status: "進行中", tone: "sky", ownerName: "伊藤 優", ownerInitials: "YI", startDate: "2026-06-15", endDate: "2026-12-18", nextMilestone: "データ品質レビュー", nextMilestoneDate: "2026-09-02", progress: 46, demand: 4 },
  { id: "nimbus", code: "NIM", name: "Nimbus 運用保守", summary: "顧客基盤の継続改善と運用支援", status: "進行中", tone: "plum", ownerName: "中村 美咲", ownerInitials: "MN", startDate: "2026-04-01", endDate: "2027-03-31", nextMilestone: "月次リリース", nextMilestoneDate: "2026-08-27", progress: 62, demand: 3 },
  { id: "orion", code: "ORI", name: "Orion 顧客ポータル", summary: "法人顧客向けセルフサービス基盤", status: "要注意", tone: "orange", ownerName: "森田 葵", ownerInitials: "AM", startDate: "2026-08-03", endDate: "2026-09-30", nextMilestone: "要件凍結", nextMilestoneDate: "2026-08-20", progress: 35, demand: 5 },
  { id: "pulse", code: "PLS", name: "Pulse 社内ポータル", summary: "社内ナレッジと申請導線を再設計", status: "進行中", tone: "mint", ownerName: "佐伯 優斗", ownerInitials: "YS", startDate: "2026-08-10", endDate: "2026-10-09", nextMilestone: "情報設計レビュー", nextMilestoneDate: "2026-08-25", progress: 29, demand: 4 },
];

const assignments: Assignment[] = [
  { id: "a1", personId: "saeki", projectId: "atlas", startDate: "2026-08-17", endDate: "2026-09-11", allocation: 50, status: "confirmed" },
  { id: "a2", personId: "saeki", projectId: "recruit", startDate: "2026-08-20", endDate: "2026-08-28", allocation: 30, status: "confirmed" },
  { id: "a3", personId: "nakamura", projectId: "atlas", startDate: "2026-08-17", endDate: "2026-10-30", allocation: 80, status: "confirmed" },
  { id: "a4", personId: "nakamura", projectId: "nimbus", startDate: "2026-08-20", endDate: "2026-09-25", allocation: 20, status: "confirmed", label: "運用サポート" },
  { id: "a5", personId: "suzuki", projectId: "payment", startDate: "2026-08-17", endDate: "2026-09-18", allocation: 70, status: "confirmed" },
  { id: "a6", personId: "suzuki", projectId: "atlas", startDate: "2026-08-20", endDate: "2026-08-21", allocation: 50, status: "confirmed" },
  { id: "a7", personId: "hayashi", projectId: "recruit", startDate: "2026-08-18", endDate: "2026-09-04", allocation: 60, status: "confirmed" },
  { id: "a8", personId: "matsumoto", projectId: "atlas", startDate: "2026-08-17", endDate: "2026-08-28", allocation: 40, status: "confirmed", label: "Atlas QA" },
  { id: "a9", personId: "ito", projectId: "kite", startDate: "2026-08-17", endDate: "2026-09-18", allocation: 70, status: "confirmed" },
  { id: "a11", personId: "morita", projectId: "orion", startDate: "2026-08-17", endDate: "2026-09-18", allocation: 60, status: "confirmed" },
  { id: "a12", personId: "morita", projectId: "atlas", startDate: "2026-08-17", endDate: "2026-08-28", allocation: 20, status: "confirmed" },
  { id: "a13", personId: "takahashi", projectId: "nimbus", startDate: "2026-08-17", endDate: "2026-08-21", allocation: 30, status: "confirmed" },
  { id: "a14", personId: "takahashi", projectId: "pulse", startDate: "2026-08-17", endDate: "2026-08-21", allocation: 60, status: "confirmed" },
  { id: "a15", personId: "takahashi", projectId: "mobile", startDate: "2026-08-24", endDate: "2026-10-30", allocation: 60, status: "confirmed" },
  { id: "a16", personId: "okada", projectId: "payment", startDate: "2026-08-17", endDate: "2026-08-28", allocation: 50, status: "confirmed" },
];

const needs: StaffingNeed[] = [
  { id: "need-mobile-qa", projectId: "mobile", role: "QA Engineer", skills: ["QA", "Mobile"], skillRequirements: [{ name: "QA", minProficiency: 3 }, { name: "Mobile", minProficiency: 3 }], startDate: "2026-08-24", endDate: "2026-09-04", allocation: 60, status: "open" },
  { id: "need-orion-be", projectId: "orion", role: "Backend Engineer", skills: ["API", "AWS"], skillRequirements: [{ name: "API", minProficiency: 3 }, { name: "AWS", minProficiency: 4 }], startDate: "2026-08-31", endDate: "2026-09-30", allocation: 40, status: "open" },
];

const opportunities: Opportunity[] = [
  { id: "opp-northwind", code: "NWD", name: "北風商事 販売基盤", summary: "基幹販売の刷新に向けた引き合い。受注後にプロジェクト化する。", stage: "inquiry", tone: "sky", ownerPersonId: "hayashi", ownerName: "林 葵", ownerInitials: "AH", startDate: "2026-09-01", endDate: "2026-12-25", demand: 4 },
  { id: "opp-harbor", code: "HBR", name: "Harbor 会員アプリ", summary: "会員証とクーポンを統合する提案段階の案件。", stage: "proposal", tone: "mint", ownerPersonId: "takahashi", ownerName: "高橋 直樹", ownerInitials: "NT", startDate: "2026-10-05", endDate: "2027-01-29", demand: 3 },
  { id: "opp-ledger", code: "LDG", name: "Ledger 会計連携", summary: "会計システムのAPI連携。商談中で要員計画を先に置いている。", stage: "negotiation", tone: "orange", ownerPersonId: "suzuki", ownerName: "鈴木 健太", ownerInitials: "KS", startDate: "2026-08-24", endDate: "2026-11-27", demand: 2 },
];

const opportunityNeeds: OpportunityNeed[] = [
  { id: "opp-need-northwind-fe", opportunityId: "opp-northwind", role: "Frontend Engineer", skills: ["React", "TypeScript"], skillRequirements: [{ name: "React", minProficiency: 3 }, { name: "TypeScript", minProficiency: 3 }], startDate: "2026-11-02", endDate: "2026-12-18", allocation: 60 },
  { id: "opp-need-northwind-be", opportunityId: "opp-northwind", role: "Backend Engineer", skills: ["Java", "API"], skillRequirements: [{ name: "Java", minProficiency: 3 }, { name: "API", minProficiency: 3 }], startDate: "2026-09-07", endDate: "2026-12-18", allocation: 50 },
  { id: "opp-need-harbor-mobile", opportunityId: "opp-harbor", role: "Mobile Engineer", skills: ["iOS", "Swift"], skillRequirements: [{ name: "iOS", minProficiency: 3 }, { name: "Swift", minProficiency: 3 }], startDate: "2026-10-05", endDate: "2027-01-22", allocation: 40 },
  { id: "opp-need-ledger-be", opportunityId: "opp-ledger", role: "Backend Engineer", skills: ["AWS", "API"], skillRequirements: [{ name: "AWS", minProficiency: 4 }, { name: "API", minProficiency: 3 }], startDate: "2026-08-24", endDate: "2026-11-20", allocation: 40 },
];

const searchScenes: SearchScene[] = [
  {
    id: "scene-frontend",
    name: "フロントエンド候補",
    role: "Frontend Engineer",
    skills: [
      { name: "React", minProficiency: 3, importance: "must" },
      { name: "A11y", minProficiency: 3, importance: "nice" },
    ],
  },
  {
    id: "scene-mobile-qa",
    name: "モバイルQA候補",
    role: "QA Engineer",
    skills: [
      { name: "QA", minProficiency: 3, importance: "must" },
      { name: "Mobile", minProficiency: 3, importance: "must" },
      { name: "Automation", minProficiency: 3, importance: "nice" },
    ],
    startDate: "2026-08-24",
    endDate: "2026-09-04",
    minAvailablePercent: 40,
  },
];

const savedReports: SavedReport[] = [
  { id: "report-dept-count", name: "部署別人数", source: "members", groupBy: "department", metric: "count" },
  { id: "report-role-load", name: "職種別稼働", source: "members", groupBy: "role", metric: "avgLoad" },
];

const profileRequests: ProfileRequest[] = [
  { id: "req-nakamura-skills", personId: "nakamura", scope: "skills", note: "フロント案件に向けてスキルを更新してください", status: "open" },
  { id: "req-saeki-history", personId: "saeki", scope: "workHistory", note: "直近の担当案件を経歴へ反映してください", status: "submitted", proposedWorkHistory: [{ id: "wh-saeki-proposed", title: "プロダクトデザイナー", organization: "Atlas リニューアル", startDate: "2024-04-01", description: "販売管理の体験設計を担当" }] },
];

export const initialWorkspace: WorkspaceState = { members, projects, assignments, needs, skillCatalog, customFields, opportunities, opportunityNeeds, orgUnits, orgMemberships, searchScenes, savedReports, profileRequests };

function isoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function localIsoDate(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** Today, in the viewer's own timezone, as the board marks its column. */
export function currentLocalDate(now = new Date()) {
  return localIsoDate(now);
}

export function getCurrentWeekStart(now = new Date()) {
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const daysSinceMonday = (monday.getDay() + 6) % 7;
  monday.setDate(monday.getDate() - daysSinceMonday);
  return localIsoDate(monday);
}

export function getWeekStartForDate(iso: string) {
  const date = new Date(iso + "T00:00:00Z");
  const daysSinceMonday = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - daysSinceMonday);
  return isoDate(date);
}

export function addDays(iso: string, amount: number) {
  const date = new Date(iso + "T00:00:00Z");
  date.setUTCDate(date.getUTCDate() + amount);
  return isoDate(date);
}

export function getWeekStart(offset: number, anchor = getCurrentWeekStart()) {
  return addDays(anchor, offset * 7);
}

export function getWeekDays(offset: number, anchor = getCurrentWeekStart()): WeekDay[] {
  const start = getWeekStart(offset, anchor);
  // Five days from a Monday are all weekdays, so nothing here is ever dropped.
  return Array.from({ length: 5 }, (_, index) => weekDayFrom(addDays(start, index))!);
}

export type BoardUnit = "week" | "month";

/**
 * What the board is showing: the weekdays in view, and the dates they span.
 *
 * A week is the five weekdays from a Monday, as it always was. A month is every
 * weekday of a calendar month — 20 to 23 of them — so the range's own ends are
 * the first and last weekday, not the 1st and the 31st. Nothing in this app draws
 * a Saturday, and a range that claimed to start on one would put the wrong date
 * under the wrong column.
 */
export type BoardRange = { unit: BoardUnit; start: string; end: string; days: WeekDay[] };

const WEEKDAY_LABELS = ["月", "火", "水", "木", "金"];

function weekDayFrom(iso: string): WeekDay | null {
  const date = new Date(iso + "T00:00:00Z");
  const index = (date.getUTCDay() + 6) % 7;
  if (index > 4) return null;
  return {
    day: WEEKDAY_LABELS[index],
    date: date.getUTCDate(),
    month: date.getUTCMonth() + 1,
    year: date.getUTCFullYear(),
    iso,
  };
}

/**
 * Anchored on today, not on this week's Monday. A first version took the Monday,
 * which is the same month for 28 or 29 days out of 31 — and on the 1st or 2nd of a
 * month that opens on a weekend, it is the month before. On Sunday 2026-08-02 the
 * Monday is 2026-07-27, so `offset: 0` would have shown July.
 */
export function boardRange(unit: BoardUnit, offset: number, today = currentLocalDate()): BoardRange {
  if (unit === "week") {
    const days = getWeekDays(offset, getWeekStartForDate(today));
    return { unit, start: days[0].iso, end: days[days.length - 1].iso, days };
  }
  const from = new Date(today + "T00:00:00Z");
  const first = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + offset, 1));
  const month = first.getUTCMonth();
  const days: WeekDay[] = [];
  for (const cursor = first; cursor.getUTCMonth() === month; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
    const day = weekDayFrom(isoDate(cursor));
    if (day) days.push(day);
  }
  return { unit, start: days[0].iso, end: days[days.length - 1].iso, days };
}

/**
 * Which columns an assignment occupies, 1-based, or null if it is not in view.
 *
 * The column is the assignment's position in `range.days`, looked up — not its
 * distance in calendar days from the start. Those agree for one Monday-to-Friday
 * week and nowhere else: the Monday after next is seven days out and six columns
 * along. The previous version measured in days and was right only because a
 * week's worth of columns hid the discrepancy.
 */
export function assignmentSpan(assignment: Assignment, range: BoardRange) {
  if (!overlaps(assignment.startDate, assignment.endDate, range.start, range.end)) return null;
  const first = range.days.findIndex((day) => day.iso >= assignment.startDate);
  // `findLastIndex` over the same predicate rather than a second `findIndex`:
  // an assignment can start before the range and end inside it.
  let last = -1;
  for (let index = range.days.length - 1; index >= 0; index -= 1) {
    if (range.days[index].iso <= assignment.endDate) { last = index; break; }
  }
  // Both are -1 only for an assignment that overlaps the range's span but lands
  // entirely on its weekends — a Saturday-to-Sunday assignment inside the month.
  if (first < 0 || last < 0 || last < first) return null;
  return { start: first + 1, span: last - first + 1 };
}

export function overlaps(startDate: string, endDate: string, rangeStart: string, rangeEnd: string) {
  return startDate <= rangeEnd && endDate >= rangeStart;
}

export function weekEnd(weekStart: string) {
  return addDays(weekStart, 4);
}

export type DailyLoad = { date: string; load: number };

const millisecondsPerDay = 86_400_000;

function isoDayNumber(value: string) {
  const milliseconds = Date.parse(value + "T00:00:00Z");
  return Number.isFinite(milliseconds) ? Math.floor(milliseconds / millisecondsPerDay) : null;
}

function intervalContainsBusinessDay(startDay: number, endDay: number) {
  if (endDay < startDay) return false;
  if (endDay - startDay >= 6) return true;
  for (let day = startDay; day <= endDay; day += 1) {
    const weekday = new Date(day * millisecondsPerDay).getUTCDay();
    if (weekday !== 0 && weekday !== 6) return true;
  }
  return false;
}

export function memberDailyLoads(state: WorkspaceState, memberId: string, startDate: string, endDate: string): DailyLoad[] {
  const days: DailyLoad[] = [];
  for (let date = startDate; date <= endDate; date = addDays(date, 1)) {
    const day = new Date(date + "T00:00:00Z").getUTCDay();
    if (day === 0 || day === 6) continue;
    const load = state.assignments
      .filter((assignment) => assignment.personId === memberId && assignment.startDate <= date && assignment.endDate >= date)
      .reduce((sum, assignment) => sum + assignment.allocation, 0);
    days.push({ date, load });
  }
  return days;
}

export function memberPeakLoad(state: WorkspaceState, memberId: string, startDate: string, endDate: string) {
  const rangeStart = isoDayNumber(startDate);
  const rangeEnd = isoDayNumber(endDate);
  if (rangeStart === null || rangeEnd === null || rangeEnd < rangeStart) return 0;

  const events = new Map<number, number>();
  state.assignments.forEach((assignment) => {
    if (assignment.personId !== memberId) return;
    const assignmentStart = isoDayNumber(assignment.startDate);
    const assignmentEnd = isoDayNumber(assignment.endDate);
    if (assignmentStart === null || assignmentEnd === null) return;
    const clippedStart = Math.max(rangeStart, assignmentStart);
    const clippedEnd = Math.min(rangeEnd, assignmentEnd);
    if (clippedEnd < clippedStart) return;
    events.set(clippedStart, (events.get(clippedStart) ?? 0) + assignment.allocation);
    events.set(clippedEnd + 1, (events.get(clippedEnd + 1) ?? 0) - assignment.allocation);
  });

  const eventDays = [...events.keys()].sort((left, right) => left - right);
  let load = 0;
  let peak = 0;
  eventDays.forEach((eventDay, index) => {
    load += events.get(eventDay) ?? 0;
    if (eventDay > rangeEnd) return;
    const nextEventDay = eventDays[index + 1] ?? rangeEnd + 1;
    if (intervalContainsBusinessDay(eventDay, Math.min(rangeEnd, nextEventDay - 1))) {
      peak = Math.max(peak, load);
    }
  });
  return peak;
}

export function memberLoad(state: WorkspaceState, memberId: string, weekStart: string) {
  return memberPeakLoad(state, memberId, weekStart, weekEnd(weekStart));
}

/**
 * Distinct people assigned to a project on one of these days.
 *
 * Days, not a start and an end: a range from the 3rd to the 31st contains the 8th
 * and 9th, and a Saturday-to-Sunday assignment there draws no bar, because the
 * board has no weekend columns. Counting it would put a number on screen with
 * nothing behind it.
 */
export function projectMembersOnDays(state: WorkspaceState, projectId: string, days: WeekDay[]) {
  return new Set(state.assignments
    .filter((assignment) => assignment.projectId === projectId
      && days.some((day) => assignment.startDate <= day.iso && assignment.endDate >= day.iso))
    .map((assignment) => assignment.personId)).size;
}

export function projectMembers(state: WorkspaceState, projectId: string, weekStart: string) {
  return new Set(state.assignments
    .filter((assignment) => assignment.projectId === projectId
      && overlaps(assignment.startDate, assignment.endDate, weekStart, weekEnd(weekStart)))
    .map((assignment) => assignment.personId)).size;
}

export function memberById(state: WorkspaceState, id: string) {
  return state.members.find((member) => member.id === id);
}

/**
 * Whom an owner field names, when that can be known.
 *
 * Projects and opportunities carry both `ownerPersonId` and a denormalised `ownerName`,
 * and the seeded projects carry only the name. Three places resolved the name with
 * `members.find(member => member.name === ownerName)`, which returns whoever comes
 * first: opening a project's edit form bound it to that person, renaming a member
 * rewrote the owner of every project holding the old name — taking over a namesake's
 * projects — and the archive guard counted somebody else's.
 *
 * A name that two people share does not name a person, so this returns nobody rather
 * than the first of them. The callers then leave the record alone, which is the honest
 * answer: what the row records is a name, and the name is not enough.
 */
export function ownerMember(state: WorkspaceState, owner: { ownerPersonId?: string; ownerName?: string | null }) {
  if (owner.ownerPersonId) return memberById(state, owner.ownerPersonId);
  const name = owner.ownerName?.trim();
  if (!name) return undefined;
  const named = state.members.filter((member) => member.name.trim() === name);
  return named.length === 1 ? named[0] : undefined;
}

/** What to print for an owner: the member's label when it is theirs, else the stored name. */
export function ownerLabel(state: WorkspaceState, owner: { ownerPersonId?: string; ownerName?: string | null }) {
  const member = ownerMember(state, owner);
  return member ? memberLabel(state, member) : owner.ownerName ?? null;
}

export function projectById(state: WorkspaceState, id: string) {
  return state.projects.find((project) => project.id === id);
}

export function formatDate(iso: string) {
  const [year, month, day] = iso.split("-").map(Number);
  return year + "年" + month + "月" + day + "日";
}

/**
 * The name of the week a figure was measured over — 「8/17週」.
 *
 * 「今週」 is reserved for the week containing today. Every other week-scoped
 * figure on these screens follows the board's paging, and once the board can show
 * a month the week it opens in is not the range either — so those figures name
 * their own week rather than claiming to be the current one (#146; #115 and #119
 * are the same defect from the other end).
 *
 * Takes any date in the week, not only its Monday, so a caller cannot name one
 * week while measuring another.
 */
export function weekLabel(iso: string) {
  const monday = getWeekStartForDate(iso);
  return Number(monday.slice(5, 7)) + "/" + Number(monday.slice(8, 10)) + "週";
}

export function getIsoWeekNumber(iso: string) {
  const date = new Date(iso + "T00:00:00Z");
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  return Math.ceil((((date.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
}

/**
 * A member's name, with just enough beside it to tell them from a namesake.
 *
 * #123: nothing stops two members having the same name — `handleCreateMember` rejects
 * only an empty one — and two of them are indistinguishable on the screens that pick
 * people. Measured, with a second 「林 葵」 given the same role, the same primary org unit
 * and the same location as the first:
 *
 * | place                          | showed                              | told apart |
 * | ------------------------------ | ----------------------------------- | ---------- |
 * | member row                     | 林 葵 / Project Manager · 事業推進  | no         |
 * | detail panel heading           | 林 葵                               | no         |
 * | assignment form's options      | 林 葵 · 8/17週 60% / … 0%           | no         |
 * | assignment bar's aria-label    | 採用サイトのアサイン詳細（林 葵・…） | no         |
 * | board row, proposal picker     | AH 林 葵 / 林葵 林 葵               | by accident |
 *
 * The accident is that seeded members carry romanised `initials` while a new one gets
 * `makeInitials`, so the avatars differed. Not a designed distinction.
 *
 * What the same measurement showed is that **no member attribute is guaranteed unique**.
 * Those two shared their org unit, their location, and every custom field (all unset).
 * So this tries the one attribute every member has, then falls back to the id:
 *
 * 1. `location`, when it is unique among the namesakes — 「林 葵（大阪）」
 * 2. otherwise the tail of the id — 「林 葵（#4f2a）」
 *
 * `department` is deliberately not in that list: it is already printed beside the name in
 * the member list and on the board, and the measurement above is a case where it
 * collides. Something already on screen cannot do the distinguishing. Custom fields are
 * out too — they can be unset, and both of those were.
 *
 * A name shared by nobody comes back untouched, which is almost every row.
 */
export function memberLabel(state: Pick<WorkspaceState, "members">, member: Pick<Member, "id" | "name" | "location">) {
  return memberLabels(state.members).get(member.id) ?? member.name;
}

/**
 * Every member's label, in one pass, cached against the array itself.
 *
 * `memberLabel` is called once per row, and a filter over all members inside it made
 * the member list O(n²) — a thousand people is a million name comparisons per render.
 * React hands back the same `members` array until the workspace changes, so a WeakMap
 * keyed on it turns that into one pass, and the cache goes away with the array.
 */
const labelCache = new WeakMap<readonly Pick<Member, "id" | "name" | "location">[], Map<string, string>>();

export function memberLabels(members: readonly Pick<Member, "id" | "name" | "location">[]): ReadonlyMap<string, string> {
  const cached = labelCache.get(members);
  if (cached) return cached;
  const byName = new Map<string, Pick<Member, "id" | "name" | "location">[]>();
  for (const member of members) {
    const key = member.name.trim();
    const group = byName.get(key) ?? [];
    group.push(member);
    byName.set(key, group);
  }
  const labels = new Map<string, string>();
  for (const [name, group] of byName) {
    if (group.length < 2) {
      labels.set(group[0].id, group[0].name);
      continue;
    }
    // The whole group takes the same kind of suffix. Deciding per person let one
    // namesake read 「（大阪）」 while another read 「（#4f2a）」, and adding a third person
    // could change an existing label's kind — the evaluator on #123 asked for this.
    // A location only counts when it is written: 「林 葵（）」 tells nobody anything, and
    // 「東京」 against 「 東京 」 is one place typed twice.
    const locations = group.map((member) => member.location.trim());
    const byLocation = locations.every(Boolean) && new Set(locations).size === group.length;
    const ids = group.map((item) => item.id);
    for (const [index, member] of group.entries()) {
      labels.set(member.id, byLocation
        ? `${name}（${locations[index]}）`
        : `${name}（#${idTail(member.id, ids)}）`);
    }
  }
  labelCache.set(members, labels);
  return labels;
}

/**
 * Enough of `id` to tell it from the others, and never a fragment of a word.
 *
 * New ids are `crypto.randomUUID()`, where any tail is meaningless hex and four
 * characters read as what they are. Anything else is printed whole: the seeded members
 * carry readable slugs — `hayashi`, `saeki` — and the tail of one of those is a word
 * fragment. 「#ashi」 out of `hayashi` looked like it meant something, measured on the
 * DEMO data, which is what a reader sees.
 *
 * A UUID is recognised rather than guessed at by length. A first version trimmed
 * anything over twelve characters, which is a number taken from the seed slugs and
 * would have cut a thirteen-character one into a fragment.
 *
 * The loop is there because a fixture or a migration can produce ids that share a tail;
 * printing the same token for two different people would be the defect wearing a
 * different hat.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

function idTail(id: string, among: string[]) {
  if (!UUID.test(id)) return id;
  const others = among.filter((other) => other !== id);
  for (let length = 4; length < id.length; length += 1) {
    const tail = id.slice(-length);
    if (!others.some((other) => other.endsWith(tail))) return tail;
  }
  return id;
}

export function makeInitials(name: string) {
  const compact = name.replace(/\s/g, "");
  return (compact[0] || "N") + (compact[compact.length - 1] || "M");
}

export function createProjectCode(name: string, id: string) {
  const prefix = name.replace(/[^A-Za-z0-9]/g, "").slice(0, 8).toUpperCase() || "PJ";
  const suffix = id.replaceAll("-", "").slice(0, 11).toUpperCase();
  return `${prefix}-${suffix}`;
}

export function isSkillProficiency(value: number): value is SkillProficiency {
  return value === 1 || value === 2 || value === 3 || value === 4 || value === 5;
}

export function normalizeSkillProficiency(value: unknown, fallback: SkillProficiency = 3): SkillProficiency {
  const number = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  return isSkillProficiency(number) ? number : fallback;
}

function skillKey(name: string) {
  return name.trim().toLocaleLowerCase();
}

export function memberSkillLevels(member: Pick<Member, "skills" | "skillLevels">): SkillLevel[] {
  if (member.skillLevels?.length) {
    const seen = new Set<string>();
    return member.skillLevels.flatMap((level) => {
      const name = level.name.trim();
      const key = skillKey(name);
      if (!name || seen.has(key)) return [];
      seen.add(key);
      return [{ name, proficiency: normalizeSkillProficiency(level.proficiency) }];
    });
  }
  return (member.skills ?? []).flatMap((name) => {
    const trimmed = name.trim();
    return trimmed ? [{ name: trimmed, proficiency: 3 as const }] : [];
  });
}

export function needSkillRequirements(need: Pick<StaffingNeed | OpportunityNeed, "skills" | "skillRequirements">): NeedSkillRequirement[] {
  if (need.skillRequirements?.length) {
    const seen = new Set<string>();
    return need.skillRequirements.flatMap((requirement) => {
      const name = requirement.name.trim();
      const key = skillKey(name);
      if (!name || seen.has(key)) return [];
      seen.add(key);
      return [{ name, minProficiency: normalizeSkillProficiency(requirement.minProficiency, 1) }];
    });
  }
  return (need.skills ?? []).flatMap((name) => {
    const trimmed = name.trim();
    return trimmed ? [{ name: trimmed, minProficiency: 1 as const }] : [];
  });
}

export function parseSkillInput(value: string, defaultProficiency: SkillProficiency = 3): SkillLevel[] {
  const seen = new Set<string>();
  return value.split(",").flatMap((part) => {
    const trimmed = part.trim();
    if (!trimmed) return [];
    const separator = trimmed.lastIndexOf(":");
    const maybeLevel = separator >= 0 ? trimmed.slice(separator + 1).trim() : "";
    const hasLevel = /^\d+$/.test(maybeLevel);
    const name = (hasLevel ? trimmed.slice(0, separator) : trimmed).trim();
    const key = skillKey(name);
    if (!name || name.length > 80 || seen.has(key)) return [];
    seen.add(key);
    return [{ name, proficiency: hasLevel ? normalizeSkillProficiency(maybeLevel, defaultProficiency) : defaultProficiency }];
  });
}

export function formatSkillInput(levels: SkillLevel[]): string {
  return levels.map((level) => `${level.name}:${level.proficiency}`).join(", ");
}

export function memberMatchesNeed(member: Pick<Member, "role" | "skills" | "skillLevels">, need: Pick<StaffingNeed | OpportunityNeed, "role" | "skills" | "skillRequirements">) {
  if (member.role.toLocaleLowerCase() !== need.role.toLocaleLowerCase()) return false;
  const levels = memberSkillLevels(member);
  return needSkillRequirements(need).every((requirement) => {
    const level = levels.find((item) => skillKey(item.name) === skillKey(requirement.name));
    return Boolean(level && level.proficiency >= requirement.minProficiency);
  });
}

function catalogIdForName(name: string) {
  return `skill:${skillKey(name)}`;
}

export function inferSkillCatalog(state: Pick<WorkspaceState, "members" | "needs" | "skillCatalog" | "opportunityNeeds">): SkillDefinition[] {
  const catalog = [...(state.skillCatalog ?? [])];
  const known = new Set(catalog.filter((item) => item.kind === "skill").map((item) => skillKey(item.name)));
  const names = new Set<string>();
  state.members.forEach((member) => memberSkillLevels(member).forEach((level) => names.add(level.name)));
  state.needs.forEach((need) => needSkillRequirements(need).forEach((requirement) => names.add(requirement.name)));
  (state.opportunityNeeds ?? []).forEach((need) => needSkillRequirements(need).forEach((requirement) => names.add(requirement.name)));
  names.forEach((name) => {
    if (known.has(skillKey(name))) return;
    catalog.push({ id: catalogIdForName(name), name, kind: "skill", sortOrder: catalog.length + 1 });
    known.add(skillKey(name));
  });
  return catalog;
}

export function hydrateWorkspaceSkills(state: WorkspaceState): WorkspaceState {
  const skillCatalog = inferSkillCatalog(state);
  return hydrateWorkspaceOrg({
    ...state,
    skillCatalog,
    members: state.members.map((member) => {
      const skillLevels = memberSkillLevels(member);
      return { ...member, skillLevels, skills: skillLevels.map((level) => level.name) };
    }),
    needs: state.needs.map((need) => {
      const skillRequirements = needSkillRequirements(need);
      return { ...need, skillRequirements, skills: skillRequirements.map((requirement) => requirement.name) };
    }),
    opportunityNeeds: (state.opportunityNeeds ?? []).map((need) => {
      const skillRequirements = needSkillRequirements(need);
      return { ...need, skillRequirements, skills: skillRequirements.map((requirement) => requirement.name) };
    }),
  });
}

export function skillCatalogTree(catalog: SkillDefinition[]): SkillDefinition[] {
  const byParent = new Map<string | null, SkillDefinition[]>();
  catalog.forEach((item) => {
    const parentId = item.parentId ?? null;
    const siblings = byParent.get(parentId) ?? [];
    siblings.push(item);
    byParent.set(parentId, siblings);
  });
  byParent.forEach((siblings) => siblings.sort((left, right) => (left.sortOrder ?? 0) - (right.sortOrder ?? 0) || left.name.localeCompare(right.name, "ja")));
  const ordered: SkillDefinition[] = [];
  const walk = (parentId: string | null) => {
    (byParent.get(parentId) ?? []).forEach((item) => {
      ordered.push(item);
      walk(item.id);
    });
  };
  walk(null);
  catalog.forEach((item) => {
    if (!ordered.some((candidate) => candidate.id === item.id)) ordered.push(item);
  });
  return ordered;
}

export function skillCatalogPath(catalog: SkillDefinition[], skillId: string): string[] {
  const byId = new Map(catalog.map((item) => [item.id, item]));
  const path: string[] = [];
  const seen = new Set<string>();
  let current = byId.get(skillId);
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    path.unshift(current.name);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return path;
}

export function addSkillCatalogEntry(
  catalog: SkillDefinition[],
  input: { name: string; kind: SkillKind; parentId?: string | null; id?: string },
): SkillDefinition[] {
  const name = input.name.trim();
  if (!name || name.length > 80) throw new Error("スキル名は1〜80文字で入力してください");
  if (catalog.some((item) => skillKey(item.name) === skillKey(name))) throw new Error("同じ名前のスキルまたは分類がすでにあります");
  const parentId = input.parentId || null;
  if (parentId) {
    const parent = catalog.find((item) => item.id === parentId);
    if (!parent) throw new Error("親分類が見つかりません");
    if (parent.kind !== "category") throw new Error("親には分類だけを指定できます");
  }
  return [
    ...catalog,
    {
      id: input.id ?? (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : catalogIdForName(name)),
      name,
      kind: input.kind,
      parentId,
      sortOrder: catalog.length + 1,
    },
  ];
}

function emptyProficiency(): Record<SkillProficiency, number> {
  return { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
}

export function buildSkillMap(state: WorkspaceState): SkillMapRow[] {
  const catalog = inferSkillCatalog(state);
  const ordered = skillCatalogTree(catalog);
  const children = new Map<string, string[]>();
  catalog.forEach((item) => {
    if (!item.parentId) return;
    const list = children.get(item.parentId) ?? [];
    list.push(item.id);
    children.set(item.parentId, list);
  });

  const membersBySkill = new Map<string, { member: Member; proficiency: SkillProficiency }[]>();
  state.members.forEach((member) => {
    memberSkillLevels(member).forEach((level) => {
      const key = skillKey(level.name);
      const list = membersBySkill.get(key) ?? [];
      list.push({ member, proficiency: level.proficiency });
      membersBySkill.set(key, list);
    });
  });

  const openNeeds = state.needs.filter((need) => need.status !== "filled");
  const needsBySkill = new Map<string, NeedSkillRequirement[]>();
  openNeeds.forEach((need) => {
    needSkillRequirements(need).forEach((requirement) => {
      const key = skillKey(requirement.name);
      const list = needsBySkill.get(key) ?? [];
      list.push(requirement);
      needsBySkill.set(key, list);
    });
  });

  const rows = new Map<string, SkillMapRow>();
  ordered.forEach((item) => {
    const holders = item.kind === "skill" ? (membersBySkill.get(skillKey(item.name)) ?? []) : [];
    const byProficiency = emptyProficiency();
    const departmentCounts = new Map<string, number>();
    holders.forEach(({ member, proficiency }) => {
      byProficiency[proficiency] += 1;
      departmentCounts.set(member.department, (departmentCounts.get(member.department) ?? 0) + 1);
    });
    const requirements = item.kind === "skill" ? (needsBySkill.get(skillKey(item.name)) ?? []) : [];
    const qualifiedCount = item.kind === "skill"
      ? holders.filter(({ proficiency }) => requirements.length === 0 || requirements.some((requirement) => proficiency >= requirement.minProficiency)).length
      : 0;
    const openNeedCount = requirements.length;
    /**
     * #126: this was `max(0, openNeedCount - qualifiedCount)` — a count of
     * requirements minus a count of people. The result was in neither unit, and #85
     * had to add 「1人が1件を担う想定で数えています」 to the screen to make it readable
     * at all. Measured, three requirements met by one qualified holder came out as 2,
     * and two requirements in periods that do not overlap came out as 1.
     *
     * It counts requirements no holder qualifies for now: the same pairing read from the
     * requirement's side instead of the holder's. Not the complement of
     * `qualifiedCount` — that counts holders who clear at least one requirement, and
     * neither number determines the other. Same unit as `openNeedCount`, so
     * `gap <= openNeedCount` always, and the assumption about one person per
     * requirement is gone.
     *
     * Availability is deliberately not folded in. This map answers 「do we have anyone
     * with this skill」; whether they are free in a requirement's period is answered by
     * that requirement's resolution guide, which prints 要件期間の最小空き. Two answers
     * to one question is what #124 is about.
     */
    const gap = requirements.filter((requirement) =>
      !holders.some(({ proficiency }) => proficiency >= requirement.minProficiency)).length;
    rows.set(item.id, {
      id: item.id,
      name: item.name,
      kind: item.kind,
      parentId: item.parentId ?? null,
      depth: Math.max(0, skillCatalogPath(catalog, item.id).length - 1),
      path: skillCatalogPath(catalog, item.id),
      memberCount: holders.length,
      byProficiency,
      departments: [...departmentCounts.entries()].map(([department, count]) => ({ department, count })).sort((left, right) => right.count - left.count || left.department.localeCompare(right.department, "ja")),
      openNeedCount,
      qualifiedCount,
      gap,
    });
  });

  const descendants = (id: string): string[] => (children.get(id) ?? []).flatMap((childId) => [childId, ...descendants(childId)]);
  ordered.filter((item) => item.kind === "category").forEach((category) => {
    const row = rows.get(category.id);
    if (!row) return;
    const childRows = descendants(category.id).map((id) => rows.get(id)).filter((item): item is SkillMapRow => Boolean(item && item.kind === "skill"));
    const byProficiency = emptyProficiency();
    childRows.forEach((child) => {
      ([1, 2, 3, 4, 5] as SkillProficiency[]).forEach((level) => {
        byProficiency[level] += child.byProficiency[level];
      });
    });
    row.memberCount = childRows.reduce((sum, child) => sum + child.memberCount, 0);
    row.byProficiency = byProficiency;
    row.openNeedCount = childRows.reduce((sum, child) => sum + child.openNeedCount, 0);
    row.qualifiedCount = childRows.reduce((sum, child) => sum + child.qualifiedCount, 0);
    row.gap = childRows.reduce((sum, child) => sum + child.gap, 0);
    const departmentCounts = new Map<string, number>();
    childRows.forEach((child) => child.departments.forEach(({ department, count }) => {
      departmentCounts.set(department, (departmentCounts.get(department) ?? 0) + count);
    }));
    row.departments = [...departmentCounts.entries()].map(([department, count]) => ({ department, count })).sort((left, right) => right.count - left.count || left.department.localeCompare(right.department, "ja"));
  });

  return ordered.map((item) => rows.get(item.id)).filter((row): row is SkillMapRow => Boolean(row));
}

const customFieldKeyPattern = /^[a-z][a-z0-9_]{0,39}$/;
const customFieldDatePattern = /^\d{4}-\d{2}-\d{2}$/;

export const CUSTOM_FIELD_TYPES: CustomFieldType[] = ["text", "number", "date", "select"];
export const CUSTOM_FIELD_ENTITIES: CustomFieldEntity[] = ["member", "project"];

function fieldKey(value: string) {
  return value.trim().toLocaleLowerCase();
}

export function orderedCustomFields(catalog: CustomFieldDefinition[] | undefined, entityType?: CustomFieldEntity) {
  return [...(catalog ?? [])]
    .filter((field) => !entityType || field.entityType === entityType)
    .sort((left, right) => (left.sortOrder ?? 0) - (right.sortOrder ?? 0) || left.label.localeCompare(right.label, "ja"));
}

export function visibleCustomFields(catalog: CustomFieldDefinition[] | undefined, entityType: CustomFieldEntity, surface: CustomFieldSurface) {
  return orderedCustomFields(catalog, entityType).filter((field) => {
    if (surface === "list") return Boolean(field.showInList);
    if (surface === "search") return field.searchable !== false;
    return field.showInDetail !== false;
  });
}

/** Fields the caller may change. Read-only fields stay visible in detail facts. */
export function editableCustomFields(catalog: CustomFieldDefinition[] | undefined, entityType: CustomFieldEntity, surface: CustomFieldSurface) {
  return visibleCustomFields(catalog, entityType, surface).filter((field) => field.canEdit !== false);
}

export function customValue(values: Record<string, string> | undefined, fieldId: string) {
  const value = values?.[fieldId];
  return typeof value === "string" ? value.trim() : "";
}

export function formatCustomValue(field: CustomFieldDefinition, value?: string) {
  const trimmed = (value ?? "").trim();
  if (!trimmed) return "未設定";
  if (field.fieldType === "date") {
    const [, month, day] = trimmed.split("-");
    return month && day ? `${Number(month)}/${Number(day)}` : trimmed;
  }
  return trimmed;
}

export function validateCustomValue(field: CustomFieldDefinition, value: string | undefined) {
  const trimmed = (value ?? "").trim();
  if (!trimmed) {
    if (field.required) throw new Error(`${field.label}は必須です`);
    return "";
  }
  if (field.fieldType === "number") {
    const number = Number(trimmed);
    if (!Number.isFinite(number)) throw new Error(`${field.label}は数値で入力してください`);
    return String(number);
  }
  if (field.fieldType === "date") {
    if (!customFieldDatePattern.test(trimmed) || Number.isNaN(Date.parse(`${trimmed}T00:00:00Z`))) {
      throw new Error(`${field.label}は日付で入力してください`);
    }
    return trimmed;
  }
  if (field.fieldType === "select") {
    if (!(field.options ?? []).includes(trimmed)) throw new Error(`${field.label}の候補から選択してください`);
    return trimmed;
  }
  if (trimmed.length > 200) throw new Error(`${field.label}は200文字以内にしてください`);
  return trimmed;
}

export function normalizeCustomValues(catalog: CustomFieldDefinition[] | undefined, entityType: CustomFieldEntity, values: Record<string, string> | undefined) {
  const next: Record<string, string> = {};
  orderedCustomFields(catalog, entityType).forEach((field) => {
    const value = validateCustomValue(field, customValue(values, field.id));
    if (value) next[field.id] = value;
  });
  return next;
}

export function addCustomField(catalog: CustomFieldDefinition[], input: {
  id?: string;
  entityType: CustomFieldEntity;
  key: string;
  label: string;
  fieldType: CustomFieldType;
  required?: boolean;
  options?: string[];
  showInList?: boolean;
  showInDetail?: boolean;
  searchable?: boolean;
  sortOrder?: number;
}): CustomFieldDefinition[] {
  const key = fieldKey(input.key);
  const label = input.label.trim();
  if (!CUSTOM_FIELD_ENTITIES.includes(input.entityType)) throw new Error("対象はメンバーまたはプロジェクトです");
  if (!CUSTOM_FIELD_TYPES.includes(input.fieldType)) throw new Error("項目の入力形式を確認してください");
  if (!customFieldKeyPattern.test(key)) throw new Error("項目キーは英小文字で始まる半角英数と_にしてください");
  if (!label) throw new Error("項目名を入力してください");
  if (label.length > 40) throw new Error("項目名は40文字以内にしてください");
  if (catalog.some((field) => field.entityType === input.entityType && fieldKey(field.key) === key)) {
    throw new Error("同じキーの項目がすでにあります");
  }
  if (catalog.some((field) => field.entityType === input.entityType && field.label.trim().toLocaleLowerCase() === label.toLocaleLowerCase())) {
    throw new Error("同じ名前の項目がすでにあります");
  }
  const options = [...new Set((input.options ?? []).map((option) => option.trim()).filter(Boolean))];
  if (input.fieldType === "select" && options.length < 1) throw new Error("選択肢を1件以上入力してください");
  if (input.fieldType !== "select" && options.length) throw new Error("選択肢は選択式の項目だけに設定できます");
  const siblings = catalog.filter((field) => field.entityType === input.entityType);
  return [...catalog, {
    id: input.id ?? `field:${input.entityType}:${key}`,
    entityType: input.entityType,
    key,
    label,
    fieldType: input.fieldType,
    required: Boolean(input.required),
    ...(options.length ? { options } : {}),
    showInList: Boolean(input.showInList),
    showInDetail: input.showInDetail !== false,
    searchable: input.searchable !== false,
    sortOrder: input.sortOrder ?? (siblings.length + 1) * 10,
  }];
}

/**
 * Replaces one role's limits. Mirrors private.apply_role_permissions so the form
 * reports the same refusals the database would; the database stays the boundary.
 */
export function setRolePermission(
  permissions: RolePermission[],
  customFields: CustomFieldDefinition[],
  input: {
    role: RestrictableRole;
    personScope?: PersonScope;
    hiddenFieldKeys?: string[];
    readonlyFieldKeys?: string[];
    disabledFeatures?: string[];
  },
): RolePermission[] {
  if (!RESTRICTABLE_ROLES.includes(input.role)) throw new Error("対象は管理者・計画担当・閲覧者です");
  const personScope = input.personScope ?? "organization";
  if (!PERSON_SCOPES.includes(personScope)) throw new Error("参照範囲を確認してください");
  const knownKeys = new Set(customFields.map((field) => field.key));
  const normalizeKeys = (keys: string[] | undefined) => {
    const unique = [...new Set((keys ?? []).map((key) => key.trim()).filter(Boolean))].sort();
    const unknown = unique.find((key) => !knownKeys.has(key));
    if (unknown) throw new Error(`独自項目「${unknown}」が見つかりません`);
    if (unique.length > 100) throw new Error("項目は100件までです");
    return unique;
  };
  const hiddenFieldKeys = normalizeKeys(input.hiddenFieldKeys);
  const readonlyFieldKeys = normalizeKeys(input.readonlyFieldKeys);
  const overlap = hiddenFieldKeys.find((key) => readonlyFieldKeys.includes(key));
  if (overlap) throw new Error(`独自項目「${overlap}」を非表示と編集不可の両方にはできません`);
  const disabledFeatures = [...new Set((input.disabledFeatures ?? []).map((feature) => feature.trim()).filter(Boolean))].sort();
  const unsupported = disabledFeatures.find((feature) => !RESTRICTABLE_FEATURES.includes(feature as RestrictableFeature));
  if (unsupported) throw new Error(`機能「${unsupported}」は権限設定の対象ではありません`);
  const next: RolePermission = {
    role: input.role,
    personScope,
    hiddenFieldKeys,
    readonlyFieldKeys,
    disabledFeatures: disabledFeatures as RestrictableFeature[],
  };
  const others = permissions.filter((permission) => permission.role !== input.role);
  return [...others, next].sort((left, right) => RESTRICTABLE_ROLES.indexOf(left.role) - RESTRICTABLE_ROLES.indexOf(right.role));
}

export function sortedWorkHistory(entries: WorkHistoryEntry[] | undefined) {
  return [...(entries ?? [])].sort((left, right) => {
    const leftEnd = left.endDate || "9999-12-31";
    const rightEnd = right.endDate || "9999-12-31";
    return rightEnd.localeCompare(leftEnd) || right.startDate.localeCompare(left.startDate) || left.title.localeCompare(right.title, "ja");
  });
}

export function normalizeWorkHistory(entries: WorkHistoryEntry[] | undefined) {
  const seen = new Set<string>();
  return sortedWorkHistory(entries).map((entry) => {
    const title = entry.title.trim();
    const organization = entry.organization.trim();
    if (!title) throw new Error("経歴の役割を入力してください");
    if (!organization) throw new Error("経歴の所属を入力してください");
    if (!customFieldDatePattern.test(entry.startDate) || Number.isNaN(Date.parse(`${entry.startDate}T00:00:00Z`))) {
      throw new Error("経歴の開始日を確認してください");
    }
    const endDate = entry.endDate ? entry.endDate.trim() : "";
    if (endDate && (!customFieldDatePattern.test(endDate) || Number.isNaN(Date.parse(`${endDate}T00:00:00Z`)))) {
      throw new Error("経歴の終了日を確認してください");
    }
    if (endDate && endDate < entry.startDate) throw new Error("経歴の終了日は開始日以降にしてください");
    if (seen.has(entry.id)) throw new Error("経歴のIDが重複しています");
    seen.add(entry.id);
    const description = entry.description?.trim() ?? "";
    return {
      id: entry.id,
      title,
      organization,
      startDate: entry.startDate,
      ...(endDate ? { endDate } : {}),
      ...(description ? { description } : {}),
    };
  });
}

export const PROFILE_REQUEST_SCOPES: ProfileRequestScope[] = ["skills", "workHistory", "all"];
export const PROFILE_REQUEST_STATUSES: ProfileRequestStatus[] = ["open", "submitted", "done", "cancelled"];

export function profileRequestScopeLabel(scope: ProfileRequestScope) {
  return scope === "skills" ? "スキル" : scope === "workHistory" ? "業務経歴" : "スキルと経歴";
}

export function profileRequestStatusLabel(status: ProfileRequestStatus) {
  return status === "open" ? "未対応" : status === "submitted" ? "確認待ち" : status === "done" ? "完了" : "取消";
}

export function isActiveProfileRequest(request: ProfileRequest) {
  return request.status === "open" || request.status === "submitted";
}

export function canActAsProfileRequestSubject(
  member: Member | undefined,
  identity?: { userId?: string },
  canManage = false,
) {
  if (canManage) return true;
  return Boolean(member?.authUserId && identity?.userId && member.authUserId === identity.userId);
}

export function addProfileRequests(state: WorkspaceState, personIds: string[], input: {
  id?: string;
  scope: ProfileRequestScope;
  note?: string;
}): ProfileRequest[] {
  if (!PROFILE_REQUEST_SCOPES.includes(input.scope)) throw new Error("依頼内容を確認してください");
  const note = input.note?.trim() ?? "";
  if (note.length > 400) throw new Error("依頼メモは400文字以内にしてください");
  const unique = [...new Set(personIds.map((personId) => personId.trim()).filter(Boolean))];
  if (!unique.length) throw new Error("対象メンバーを選んでください");
  const existing = state.profileRequests ?? [];
  const next = [...existing];
  unique.forEach((personId) => {
    if (!state.members.some((member) => member.id === personId)) throw new Error("対象メンバーが見つかりません");
    if (next.some((request) => request.personId === personId && isActiveProfileRequest(request))) {
      throw new Error("このメンバーには未完了の更新依頼があります");
    }
    next.push({
      id: unique.length === 1 && input.id ? input.id : crypto.randomUUID(),
      personId,
      scope: input.scope,
      ...(note ? { note } : {}),
      status: "open",
    });
  });
  return next;
}

function proposedSkillLevels(value: string | SkillLevel[] | undefined) {
  if (typeof value === "string") return parseSkillInput(value);
  return (value ?? []).flatMap((level) => {
    const name = level.name.trim();
    return name ? [{ name, proficiency: normalizeSkillProficiency(level.proficiency) }] : [];
  });
}

export function submitProfileRequest(state: WorkspaceState, requestId: string, proposed: {
  skills?: string | SkillLevel[];
  workHistory?: WorkHistoryEntry[];
}, options?: { identity?: { userId?: string }; canManage?: boolean }): WorkspaceState {
  const requests = state.profileRequests ?? [];
  const request = requests.find((item) => item.id === requestId);
  if (!request) throw new Error("更新依頼が見つかりません");
  if (request.status !== "open") throw new Error("この依頼は提出できる状態ではありません");
  const member = state.members.find((item) => item.id === request.personId);
  if (!canActAsProfileRequestSubject(member, options?.identity, options?.canManage)) {
    throw new Error("この依頼を提出する権限がありません");
  }
  const proposedSkills = request.scope === "workHistory" ? undefined : proposedSkillLevels(proposed.skills);
  const proposedWorkHistory = request.scope === "skills"
    ? undefined
    : normalizeWorkHistory((proposed.workHistory ?? []).filter((entry) => entry.title.trim() && entry.organization.trim() && entry.startDate));
  if (request.scope !== "workHistory" && !proposedSkills?.length) throw new Error("更新するスキルを入力してください");
  if (request.scope !== "skills" && !proposedWorkHistory?.length) throw new Error("更新する経歴を入力してください");
  return {
    ...state,
    profileRequests: requests.map((item) => item.id === requestId ? {
      ...item,
      status: "submitted" as const,
      ...(proposedSkills?.length ? { proposedSkills } : {}),
      ...(proposedWorkHistory?.length ? { proposedWorkHistory } : {}),
    } : item),
  };
}

export function cancelProfileRequest(requests: ProfileRequest[], requestId: string): ProfileRequest[] {
  const request = requests.find((item) => item.id === requestId);
  if (!request) throw new Error("更新依頼が見つかりません");
  if (request.status === "done" || request.status === "cancelled") throw new Error("この依頼は取り消せません");
  return requests.map((item) => item.id === requestId ? { ...item, status: "cancelled" as const } : item);
}

export function completeProfileRequest(state: WorkspaceState, requestId: string): WorkspaceState {
  const requests = state.profileRequests ?? [];
  const request = requests.find((item) => item.id === requestId);
  if (!request) throw new Error("更新依頼が見つかりません");
  if (request.status !== "submitted") throw new Error("確認できるのは提出済みの依頼です");
  const members = state.members.map((member) => {
    if (member.id !== request.personId) return member;
    return {
      ...member,
      ...(request.scope !== "workHistory" && request.proposedSkills?.length ? {
        skills: request.proposedSkills.map((level) => level.name),
        skillLevels: request.proposedSkills,
      } : {}),
      ...(request.scope !== "skills" && request.proposedWorkHistory ? { workHistory: request.proposedWorkHistory } : {}),
    };
  });
  return hydrateWorkspaceSkills({
    ...state,
    members,
    profileRequests: requests.map((item) => item.id === requestId ? { ...item, status: "done" as const } : item),
  });
}

export function formatWorkHistoryPeriod(entry: Pick<WorkHistoryEntry, "startDate" | "endDate">) {
  const start = formatCustomValue({ id: "", entityType: "member", key: "start", label: "開始", fieldType: "date" }, entry.startDate);
  const end = entry.endDate ? formatCustomValue({ id: "", entityType: "member", key: "end", label: "終了", fieldType: "date" }, entry.endDate) : "現在";
  return `${start} — ${end}`;
}

export function entitySearchText(
  catalog: CustomFieldDefinition[] | undefined,
  entityType: CustomFieldEntity,
  values: Record<string, string> | undefined,
  extra: string[] = [],
  workHistory?: WorkHistoryEntry[],
) {
  const searchable = visibleCustomFields(catalog, entityType, "search").map((field) => customValue(values, field.id));
  const history = (workHistory ?? []).flatMap((entry) => [entry.title, entry.organization, entry.description ?? ""]);
  return [...extra, ...searchable, ...history].join(" ").toLocaleLowerCase();
}

export function memberSearchText(state: Pick<WorkspaceState, "customFields" | "orgUnits" | "orgMemberships">, member: Member) {
  return entitySearchText(
    state.customFields,
    "member",
    member.customValues,
    [member.name, member.role, member.department, member.location, ...(member.skills ?? []), ...memberOrgSearchLabels(state, member.id)],
    member.workHistory,
  );
}

export function projectSearchText(state: Pick<WorkspaceState, "customFields">, project: Project) {
  return entitySearchText(
    state.customFields,
    "project",
    project.customValues,
    [project.code, project.name, project.summary, project.ownerName ?? ""],
  );
}

export const REPORT_SOURCES: ReportSource[] = ["members", "projects"];
export const REPORT_GROUP_BY: ReportGroupBy[] = ["department", "role", "location", "status"];
export const REPORT_METRICS: ReportMetric[] = ["count", "avgLoad"];

export function allowedReportGroupBy(source: ReportSource): ReportGroupBy[] {
  return source === "projects" ? ["status"] : ["department", "role", "location"];
}

export function addSavedReport(reports: SavedReport[], input: {
  id?: string;
  name: string;
  source: ReportSource;
  groupBy: ReportGroupBy;
  metric: ReportMetric;
}): SavedReport[] {
  const name = input.name.trim();
  if (!name) throw new Error("レポート名を入力してください");
  if (name.length > 80) throw new Error("レポート名は80文字以内にしてください");
  if (reports.some((report) => report.name.trim().toLocaleLowerCase() === name.toLocaleLowerCase())) {
    throw new Error("同じ名前のレポートがすでにあります");
  }
  if (!REPORT_SOURCES.includes(input.source)) throw new Error("集計対象はメンバーまたはプロジェクトです");
  if (!REPORT_METRICS.includes(input.metric)) throw new Error("指標は件数または平均稼働率です");
  if (!allowedReportGroupBy(input.source).includes(input.groupBy)) throw new Error("この集計対象では使えないグループです");
  return [...reports, {
    id: input.id ?? crypto.randomUUID(),
    name,
    source: input.source,
    groupBy: input.groupBy,
    metric: input.source === "projects" ? "count" : input.metric,
  }];
}

function reportGroupLabel(value: string | undefined) {
  const trimmed = value?.trim() ?? "";
  return trimmed || "未設定";
}

export function buildSavedReport(state: WorkspaceState, report: SavedReport, weekStart: string): ReportRow[] {
  const groups = new Map<string, { count: number; load: number; capacity: number }>();
  if (report.source === "projects") {
    state.projects.forEach((project) => {
      const label = reportGroupLabel(project.status);
      const current = groups.get(label) ?? { count: 0, load: 0, capacity: 0 };
      groups.set(label, { count: current.count + 1, load: current.load, capacity: current.capacity });
    });
  } else {
    const groupBy = allowedReportGroupBy("members").includes(report.groupBy) ? report.groupBy : "department";
    state.members.forEach((member) => {
      const label = reportGroupLabel(groupBy === "role" ? member.role : groupBy === "location" ? member.location : member.department);
      const current = groups.get(label) ?? { count: 0, load: 0, capacity: 0 };
      groups.set(label, {
        count: current.count + 1,
        load: current.load + memberLoad(state, member.id, weekStart),
        capacity: current.capacity + member.capacity,
      });
    });
  }
  return [...groups.entries()].map(([label, group]) => {
    const avgLoad = group.capacity > 0 ? Math.round(group.load / group.capacity * 100) : 0;
    const value = report.source === "members" && report.metric === "avgLoad" ? avgLoad : group.count;
    return { key: label, label, count: group.count, value };
  }).sort((left, right) => right.value - left.value || left.label.localeCompare(right.label, "ja"));
}

export function isActiveOpportunity(opportunity: Pick<Opportunity, "stage">) {
  return opportunity.stage === "inquiry" || opportunity.stage === "proposal" || opportunity.stage === "negotiation";
}

export function canConvertOpportunity(opportunity: Pick<Opportunity, "stage" | "convertedProjectId">) {
  return isActiveOpportunity(opportunity) && !opportunity.convertedProjectId;
}

export function opportunityById(state: Pick<WorkspaceState, "opportunities">, id: string) {
  return (state.opportunities ?? []).find((opportunity) => opportunity.id === id);
}

export function opportunityNeedsFor(state: Pick<WorkspaceState, "opportunityNeeds">, opportunityId: string) {
  return (state.opportunityNeeds ?? []).filter((need) => need.opportunityId === opportunityId);
}

export function opportunitySearchText(opportunity: Opportunity, needs: OpportunityNeed[] = []) {
  const needText = needs.flatMap((need) => [need.role, ...need.skills]);
  return [opportunity.code, opportunity.name, opportunity.summary, opportunity.ownerName ?? "", OPPORTUNITY_STAGE_LABELS[opportunity.stage], ...needText].join(" ").toLocaleLowerCase();
}

export function pipelineDemandForWeek(state: Pick<WorkspaceState, "opportunities">, weekStart: string) {
  const weekClose = weekEnd(weekStart);
  return (state.opportunities ?? [])
    .filter((opportunity) => isActiveOpportunity(opportunity) && overlaps(opportunity.startDate, opportunity.endDate, weekStart, weekClose))
    .reduce((sum, opportunity) => sum + opportunity.demand, 0);
}

function nextEntityId(prefix: string, seed: string) {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `${prefix}:${seed}`;
}

export function convertOpportunityToProject(
  state: WorkspaceState,
  opportunityId: string,
  options?: { projectId?: string; needIdMap?: Record<string, string> },
): WorkspaceState {
  const opportunity = opportunityById(state, opportunityId);
  if (!opportunity) throw new Error("受注前案件が見つかりません");
  if (!canConvertOpportunity(opportunity)) throw new Error("受注できる段階ではありません");
  const owner = opportunity.ownerPersonId ? memberById(state, opportunity.ownerPersonId) : undefined;
  const projectId = options?.projectId ?? nextEntityId("project", opportunity.id);
  const project: Project = {
    id: projectId,
    code: createProjectCode(opportunity.name, projectId),
    name: opportunity.name,
    summary: opportunity.summary,
    status: "準備中",
    tone: opportunity.tone,
    ownerPersonId: owner?.id ?? opportunity.ownerPersonId,
    ownerName: owner?.name ?? opportunity.ownerName ?? null,
    ownerInitials: owner?.initials ?? opportunity.ownerInitials ?? null,
    startDate: opportunity.startDate,
    endDate: opportunity.endDate,
    nextMilestone: "キックオフ",
    nextMilestoneDate: opportunity.startDate,
    progress: 0,
    demand: opportunity.demand,
  };
  const staffingNeeds: StaffingNeed[] = opportunityNeedsFor(state, opportunity.id).map((need) => {
    const skillRequirements = needSkillRequirements(need);
    return {
      id: options?.needIdMap?.[need.id] ?? nextEntityId("need", need.id),
      projectId,
      role: need.role,
      skills: skillRequirements.map((requirement) => requirement.name),
      skillRequirements,
      startDate: need.startDate,
      endDate: need.endDate,
      allocation: need.allocation,
      status: "open",
      draftPersonId: null,
    };
  });
  return hydrateWorkspaceSkills({
    ...state,
    projects: [...state.projects, project],
    needs: [...state.needs, ...staffingNeeds],
    opportunities: (state.opportunities ?? []).map((item) => item.id === opportunity.id
      ? { ...item, stage: "won", convertedProjectId: projectId }
      : item),
  });
}

function orgNameKey(name: string) {
  return name.trim().toLocaleLowerCase();
}

export function orgUnitById(units: OrgUnit[] | undefined, id: string) {
  return (units ?? []).find((unit) => unit.id === id);
}

export function orgUnitPath(units: OrgUnit[] | undefined, id: string) {
  const byId = new Map((units ?? []).map((unit) => [unit.id, unit]));
  const path: string[] = [];
  const seen = new Set<string>();
  let current = byId.get(id);
  while (current) {
    if (seen.has(current.id)) throw new Error("組織階層に循環があります");
    seen.add(current.id);
    path.unshift(current.name);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return path;
}

export function orgUnitTree(units: OrgUnit[] | undefined) {
  const catalog = units ?? [];
  const byParent = new Map<string | null, OrgUnit[]>();
  catalog.forEach((item) => {
    const parentId = item.parentId ?? null;
    const siblings = byParent.get(parentId) ?? [];
    siblings.push(item);
    byParent.set(parentId, siblings);
  });
  byParent.forEach((siblings) => siblings.sort((left, right) => (left.sortOrder ?? 0) - (right.sortOrder ?? 0) || left.name.localeCompare(right.name, "ja")));
  const ordered: OrgUnit[] = [];
  const walk = (parentId: string | null) => {
    (byParent.get(parentId) ?? []).forEach((item) => {
      ordered.push(item);
      walk(item.id);
    });
  };
  walk(null);
  catalog.forEach((item) => {
    if (!ordered.some((candidate) => candidate.id === item.id)) ordered.push(item);
  });
  return ordered;
}

export function orgUnitDescendantIds(units: OrgUnit[] | undefined, id: string) {
  const ids = new Set<string>();
  const children = new Map<string | null, string[]>();
  (units ?? []).forEach((unit) => {
    const parentId = unit.parentId ?? null;
    children.set(parentId, [...(children.get(parentId) ?? []), unit.id]);
  });
  const walk = (unitId: string) => {
    if (ids.has(unitId)) return;
    ids.add(unitId);
    (children.get(unitId) ?? []).forEach(walk);
  };
  walk(id);
  return ids;
}

export function assertOrgUnitAcyclic(units: OrgUnit[]) {
  units.forEach((unit) => {
    orgUnitPath(units, unit.id);
    if (unit.parentId === unit.id) throw new Error("組織階層に循環があります");
    if (unit.parentId && orgUnitDescendantIds(units, unit.id).has(unit.parentId) && unit.parentId !== unit.id) {
      throw new Error("組織階層に循環があります");
    }
  });
}

export function addOrgUnit(units: OrgUnit[], input: { name: string; parentId?: string | null; id?: string }) {
  const name = input.name.trim();
  if (!name || name.length > 80) throw new Error("部門名は1〜80文字で入力してください");
  if (units.some((unit) => orgNameKey(unit.name) === orgNameKey(name))) throw new Error("同じ名前の部門がすでにあります");
  const parentId = input.parentId || null;
  if (parentId && !units.some((unit) => unit.id === parentId)) throw new Error("親部門が見つかりません");
  const next = [
    ...units,
    {
      id: input.id ?? (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `org:${orgNameKey(name)}`),
      name,
      parentId,
      sortOrder: units.length + 1,
    },
  ];
  assertOrgUnitAcyclic(next);
  return next;
}

export function moveOrgUnit(units: OrgUnit[], id: string, parentId: string | null) {
  const current = units.find((unit) => unit.id === id);
  if (!current) throw new Error("部門が見つかりません");
  if (parentId && !units.some((unit) => unit.id === parentId)) throw new Error("親部門が見つかりません");
  if (parentId === id || (parentId && orgUnitDescendantIds(units, id).has(parentId))) throw new Error("部門を自分の配下へは移せません");
  const next = units.map((unit) => unit.id === id ? { ...unit, parentId } : unit);
  assertOrgUnitAcyclic(next);
  return next;
}

/**
 * Why this unit cannot be removed, or null when it can be. `archiveOrgUnit` is
 * the only caller that has to reject; everything else that wants to know —
 * whether to offer the control at all, and what to say instead — asks here, so
 * that the offer and the refusal come from one place rather than two that can
 * drift. As of #86 every unit in the shipped data is blocked, which is how nine
 * delete buttons came to exist that all failed.
 *
 * `short` is for a table cell; `reason` is the sentence the caller was already
 * throwing.
 */
export function orgUnitArchiveBlocker(
  state: Pick<WorkspaceState, "orgUnits" | "orgMemberships">,
  id: string,
): { reason: string; short: string } | null {
  if (!orgUnitById(state.orgUnits, id)) return { reason: "部門が見つかりません", short: "見つかりません" };
  if ((state.orgUnits ?? []).some((item) => item.parentId === id)) {
    return { reason: "配下の部門を先に移すか削除してください", short: "配下に部門あり" };
  }
  if ((state.orgMemberships ?? []).some((item) => item.orgUnitId === id)) {
    return { reason: "所属メンバーを先に別部門へ移してください", short: "所属メンバーあり" };
  }
  return null;
}

export function archiveOrgUnit(state: WorkspaceState, id: string): WorkspaceState {
  const blocker = orgUnitArchiveBlocker(state, id);
  if (blocker) throw new Error(blocker.reason);
  return {
    ...state,
    orgUnits: (state.orgUnits ?? []).filter((item) => item.id !== id),
  };
}

export function memberOrgMemberships(state: Pick<WorkspaceState, "orgMemberships">, personId: string) {
  return (state.orgMemberships ?? []).filter((item) => item.personId === personId);
}

export function memberPrimaryOrgUnit(state: Pick<WorkspaceState, "orgUnits" | "orgMemberships">, personId: string) {
  const primary = memberOrgMemberships(state, personId).find((item) => item.isPrimary);
  return primary ? orgUnitById(state.orgUnits, primary.orgUnitId) : undefined;
}

export function memberOrgSearchLabels(state: Pick<WorkspaceState, "orgUnits" | "orgMemberships">, personId: string) {
  return memberOrgMemberships(state, personId).flatMap((item) => orgUnitPath(state.orgUnits, item.orgUnitId));
}

export function membersInOrgSubtree(
  state: Pick<WorkspaceState, "members" | "orgUnits" | "orgMemberships">,
  unitId: string,
  mode: "primary" | "any" = "any",
) {
  const ids = orgUnitDescendantIds(state.orgUnits, unitId);
  const personIds = new Set(
    (state.orgMemberships ?? [])
      .filter((item) => ids.has(item.orgUnitId) && (mode === "any" || item.isPrimary))
      .map((item) => item.personId),
  );
  return state.members.filter((member) => personIds.has(member.id));
}

export function orgManagers(state: Pick<WorkspaceState, "members" | "orgMemberships">, unitId: string) {
  const managerIds = new Set((state.orgMemberships ?? []).filter((item) => item.orgUnitId === unitId && item.isManager).map((item) => item.personId));
  return state.members.filter((member) => managerIds.has(member.id));
}

export function setMemberOrgMemberships(
  state: WorkspaceState,
  personId: string,
  input: { primaryUnitId?: string | null; extraUnitIds?: string[]; managerUnitIds?: string[] },
): WorkspaceState {
  if (!state.members.some((member) => member.id === personId)) throw new Error("メンバーが見つかりません");
  const units = state.orgUnits ?? [];
  const extra = [...new Set(input.extraUnitIds ?? [])].filter((id) => id && id !== input.primaryUnitId);
  const managerIds = new Set(input.managerUnitIds ?? []);
  const unitIds = [...new Set([input.primaryUnitId, ...extra].filter((id): id is string => Boolean(id)))];
  unitIds.forEach((id) => {
    if (!orgUnitById(units, id)) throw new Error("部門が見つかりません");
  });
  const remaining = (state.orgMemberships ?? []).filter((item) => item.personId !== personId);
  const nextMemberships: OrgMembership[] = [
    ...remaining,
    ...unitIds.map((orgUnitId, index) => ({
      id: memberOrgMemberships(state, personId).find((item) => item.orgUnitId === orgUnitId)?.id
        ?? (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `om:${personId}:${orgUnitId}:${index}`),
      personId,
      orgUnitId,
      isPrimary: orgUnitId === input.primaryUnitId,
      isManager: managerIds.has(orgUnitId),
    })),
  ];
  if (nextMemberships.filter((item) => item.personId === personId && item.isPrimary).length > 1) {
    throw new Error("主所属は1つだけ設定できます");
  }
  return hydrateWorkspaceOrg({ ...state, orgMemberships: nextMemberships });
}

export function hydrateWorkspaceOrg(state: WorkspaceState): WorkspaceState {
  const units = state.orgUnits ?? [];
  const members = state.members;
  const memberIds = new Set(members.map((member) => member.id));
  const unitIds = new Set(units.map((unit) => unit.id));
  if (units.length) assertOrgUnitAcyclic(units);
  const seenPrimary = new Set<string>();
  const orgMemberships = (state.orgMemberships ?? [])
    .filter((item) => memberIds.has(item.personId) && unitIds.has(item.orgUnitId))
    .map((item) => {
      if (!item.isPrimary) return item;
      if (seenPrimary.has(item.personId)) return { ...item, isPrimary: false };
      seenPrimary.add(item.personId);
      return item;
    });
  return {
    ...state,
    orgUnits: units,
    orgMemberships,
    members: members.map((member) => {
      const primary = orgMemberships.find((item) => item.personId === member.id && item.isPrimary);
      const unit = primary ? orgUnitById(units, primary.orgUnitId) : undefined;
      return unit ? { ...member, department: unit.name } : member;
    }),
  };
}

export function orgUnitLoadRows(state: WorkspaceState, weekStart: string): OrgUnitLoadRow[] {
  const weekClose = addDays(weekStart, 4);
  return orgUnitTree(state.orgUnits).map((unit) => {
    const people = membersInOrgSubtree(state, unit.id, "primary");
    const capacity = people.reduce((sum, member) => sum + member.capacity, 0) * 5;
    const load = people.reduce((sum, member) => sum + memberDailyLoads(state, member.id, weekStart, weekClose).reduce((dailySum, day) => dailySum + day.load, 0), 0);
    return {
      id: unit.id,
      name: unit.name,
      path: orgUnitPath(state.orgUnits, unit.id),
      depth: Math.max(0, orgUnitPath(state.orgUnits, unit.id).length - 1),
      count: people.length,
      average: capacity > 0 ? Math.round(load / capacity * 100) : 0,
      managers: orgManagers(state, unit.id).map((member) => member.name),
    };
  });
}

export function searchSceneSkills(scene: Pick<SearchScene, "skills">): SearchSkillFilter[] {
  const seen = new Set<string>();
  return (scene.skills ?? []).flatMap((skill) => {
    const name = skill.name.trim();
    const key = skillKey(name);
    if (!name || seen.has(key)) return [];
    seen.add(key);
    return [{
      name,
      minProficiency: normalizeSkillProficiency(skill.minProficiency, 3),
      importance: skill.importance === "nice" ? "nice" : "must",
    }];
  });
}

export function searchSceneFromNeed(need: Pick<StaffingNeed, "id" | "role" | "skills" | "skillRequirements" | "startDate" | "endDate" | "allocation">): SearchScene {
  return {
    id: `need:${need.id}`,
    name: need.role,
    role: need.role,
    skills: needSkillRequirements(need).map((requirement) => ({
      name: requirement.name,
      minProficiency: requirement.minProficiency,
      importance: "must" as const,
    })),
    startDate: need.startDate,
    endDate: need.endDate,
    minAvailablePercent: need.allocation,
  };
}

export function addSearchScene(scenes: SearchScene[], input: {
  id?: string;
  name: string;
  query?: string;
  role?: string;
  location?: string;
  skills?: SearchSkillFilter[];
  startDate?: string;
  endDate?: string;
  minAvailablePercent?: number;
}): SearchScene[] {
  const name = input.name.trim();
  if (!name) throw new Error("検索シーン名を入力してください");
  if (name.length > 80) throw new Error("検索シーン名は80文字以内にしてください");
  if (scenes.some((scene) => scene.name.trim().toLocaleLowerCase() === name.toLocaleLowerCase())) {
    throw new Error("同じ名前の検索シーンがすでにあります");
  }
  const query = input.query?.trim() ?? "";
  if (query.length > 120) throw new Error("検索語は120文字以内にしてください");
  const role = input.role?.trim() ?? "";
  const location = input.location?.trim() ?? "";
  if (role.length > 120) throw new Error("職種は120文字以内にしてください");
  if (location.length > 120) throw new Error("勤務地は120文字以内にしてください");
  const startDate = input.startDate?.trim() ?? "";
  const endDate = input.endDate?.trim() ?? "";
  if ((startDate && !endDate) || (!startDate && endDate)) throw new Error("期間は開始日と終了日を両方指定してください");
  if (startDate && endDate && startDate > endDate) throw new Error("終了日は開始日以降にしてください");
  if (input.minAvailablePercent !== undefined && (!Number.isFinite(input.minAvailablePercent) || input.minAvailablePercent < 0 || input.minAvailablePercent > 100)) {
    throw new Error("最小空きは0〜100で指定してください");
  }
  const seenSkills = new Set<string>();
  (input.skills ?? []).forEach((skill) => {
    const key = skillKey(skill.name);
    if (!key) return;
    if (seenSkills.has(key)) throw new Error("同じスキルを重複して指定できません");
    seenSkills.add(key);
    if (skill.importance !== "must" && skill.importance !== "nice") throw new Error("スキルの重要度は必須または歓迎にしてください");
  });
  const skills = searchSceneSkills({ skills: input.skills });
  return [...scenes, {
    id: input.id ?? crypto.randomUUID(),
    name,
    ...(query ? { query } : {}),
    ...(role ? { role } : {}),
    ...(location ? { location } : {}),
    ...(skills.length ? { skills } : {}),
    ...(startDate ? { startDate, endDate } : {}),
    ...(input.minAvailablePercent !== undefined ? { minAvailablePercent: input.minAvailablePercent } : {}),
  }];
}

export function memberAvailablePercent(state: WorkspaceState, member: Member, startDate?: string, endDate?: string) {
  if (!startDate || !endDate) return member.capacity;
  return Math.max(0, member.capacity - memberPeakLoad(state, member.id, startDate, endDate));
}

export function matchScore(availablePercent: number, matchedNiceCount: number) {
  return Math.min(60, matchedNiceCount * 20) + Math.min(40, Math.round(availablePercent * 0.4));
}

/**
 * The highest score this scene can produce, which is not always 100.
 *
 * `matchScore` gives 20 per satisfied 「あると良い」 skill up to 60, plus 40 for the
 * availability. A scene with one such skill therefore tops out at 60, and one with
 * none at 40 — so 「n/100点」 would be a lie for most scenes, and 「n点」 alone leaves
 * the reader with no denominator at all (#150).
 *
 * The 「必須」 skills are absent on purpose: `matchMember` drops a candidate that
 * misses one, so they gate inclusion rather than earn points.
 */
export function matchScoreMax(scene: SearchScene) {
  const nice = searchSceneSkills(scene).filter((skill) => skill.importance === "nice").length;
  // Through `matchScore` rather than repeating its two caps: full availability is by
  // definition the top of the availability half, so this stays correct if the weights
  // move.
  return matchScore(100, nice);
}

export function matchMember(state: WorkspaceState, member: Member, scene: SearchScene): MemberMatch | null {
  if (scene.role && member.role.toLocaleLowerCase() !== scene.role.toLocaleLowerCase()) return null;
  if (scene.location && member.location.toLocaleLowerCase() !== scene.location.toLocaleLowerCase()) return null;
  if (scene.query && !memberSearchText(state, member).includes(scene.query.trim().toLocaleLowerCase())) return null;
  const skills = searchSceneSkills(scene);
  const levels = memberSkillLevels(member);
  const matchedMust: string[] = [];
  for (const requirement of skills.filter((skill) => skill.importance === "must")) {
    const level = levels.find((item) => skillKey(item.name) === skillKey(requirement.name));
    if (!level || level.proficiency < requirement.minProficiency) return null;
    matchedMust.push(requirement.name);
  }
  const matchedNice = skills.filter((skill) => skill.importance === "nice").flatMap((requirement) => {
    const level = levels.find((item) => skillKey(item.name) === skillKey(requirement.name));
    return level && level.proficiency >= requirement.minProficiency ? [requirement.name] : [];
  });
  const availablePercent = memberAvailablePercent(state, member, scene.startDate, scene.endDate);
  if (scene.minAvailablePercent !== undefined && availablePercent < scene.minAvailablePercent) return null;
  return {
    member,
    score: matchScore(availablePercent, matchedNice.length),
    availablePercent,
    matchedMust,
    matchedNice,
  };
}

/**
 * Best first: score, then availability, then name.
 *
 * Availability is the tie-break because `matchScore` rounds — 60% and 61% both give 24
 * — and the screens that consume this order print the availability rather than the
 * score (#150). Without it the heading 「要件期間の最小空きが多い順」 was false for any
 * pair inside the same 2.5-point band, and the name decided which came first.
 */
export function matchMembers(state: WorkspaceState, scene: SearchScene): MemberMatch[] {
  return state.members.flatMap((member) => {
    const match = matchMember(state, member, scene);
    return match ? [match] : [];
  }).sort((left, right) => right.score - left.score
    || right.availablePercent - left.availablePercent
    || left.member.name.localeCompare(right.member.name, "ja"));
}
