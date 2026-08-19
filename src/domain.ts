export type Tone = "blue" | "mint" | "orange" | "plum" | "sky";
export type AvatarTone = "lavender" | "peach" | "sky" | "mint" | "sand" | "rose";
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
};

export type WorkHistoryEntry = {
  id: string;
  title: string;
  organization: string;
  startDate: string;
  endDate?: string | null;
  description?: string;
};

export const PROFICIENCY_LABELS: Record<SkillProficiency, string> = {
  1: "初級",
  2: "基礎",
  3: "実務",
  4: "応用",
  5: "指導",
};

export type Member = {
  id: string;
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

export type WorkspaceState = {
  members: Member[];
  projects: Project[];
  assignments: Assignment[];
  needs: StaffingNeed[];
  skillCatalog?: SkillDefinition[];
  customFields?: CustomFieldDefinition[];
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

export const initialWorkspace: WorkspaceState = { members, projects, assignments, needs, skillCatalog, customFields };

function isoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function localIsoDate(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
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

export function getWeekDays(offset: number): WeekDay[] {
  const start = getWeekStart(offset);
  return Array.from({ length: 5 }, (_, index) => {
    const date = new Date(addDays(start, index) + "T00:00:00Z");
    return {
      day: ["月", "火", "水", "木", "金"][index],
      date: date.getUTCDate(),
      month: date.getUTCMonth() + 1,
      year: date.getUTCFullYear(),
      iso: isoDate(date),
    };
  });
}

export function overlaps(startDate: string, endDate: string, rangeStart: string, rangeEnd: string) {
  return startDate <= rangeEnd && endDate >= rangeStart;
}

export function weekEnd(weekStart: string) {
  return addDays(weekStart, 4);
}

export function assignmentGrid(assignment: Assignment, weekStart: string) {
  const end = weekEnd(weekStart);
  if (!overlaps(assignment.startDate, assignment.endDate, weekStart, end)) return null;
  const visibleStart = assignment.startDate < weekStart ? weekStart : assignment.startDate;
  const visibleEnd = assignment.endDate > end ? end : assignment.endDate;
  const startIndex = Math.round((Date.parse(visibleStart + "T00:00:00Z") - Date.parse(weekStart + "T00:00:00Z")) / 86400000);
  const endIndex = Math.round((Date.parse(visibleEnd + "T00:00:00Z") - Date.parse(weekStart + "T00:00:00Z")) / 86400000);
  return { start: startIndex + 1, span: endIndex - startIndex + 1 };
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

export function projectMembers(state: WorkspaceState, projectId: string, weekStart: string) {
  const end = weekEnd(weekStart);
  return new Set(state.assignments
    .filter((assignment) => assignment.projectId === projectId && overlaps(assignment.startDate, assignment.endDate, weekStart, end))
    .map((assignment) => assignment.personId)).size;
}

export function memberById(state: WorkspaceState, id: string) {
  return state.members.find((member) => member.id === id);
}

export function projectById(state: WorkspaceState, id: string) {
  return state.projects.find((project) => project.id === id);
}

export function formatDate(iso: string) {
  const [year, month, day] = iso.split("-").map(Number);
  return year + "年" + month + "月" + day + "日";
}

export function getIsoWeekNumber(iso: string) {
  const date = new Date(iso + "T00:00:00Z");
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  return Math.ceil((((date.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
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

export function needSkillRequirements(need: Pick<StaffingNeed, "skills" | "skillRequirements">): NeedSkillRequirement[] {
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

export function memberMatchesNeed(member: Pick<Member, "role" | "skills" | "skillLevels">, need: Pick<StaffingNeed, "role" | "skills" | "skillRequirements">) {
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

export function inferSkillCatalog(state: Pick<WorkspaceState, "members" | "needs" | "skillCatalog">): SkillDefinition[] {
  const catalog = [...(state.skillCatalog ?? [])];
  const known = new Set(catalog.filter((item) => item.kind === "skill").map((item) => skillKey(item.name)));
  const names = new Set<string>();
  state.members.forEach((member) => memberSkillLevels(member).forEach((level) => names.add(level.name)));
  state.needs.forEach((need) => needSkillRequirements(need).forEach((requirement) => names.add(requirement.name)));
  names.forEach((name) => {
    if (known.has(skillKey(name))) return;
    catalog.push({ id: catalogIdForName(name), name, kind: "skill", sortOrder: catalog.length + 1 });
    known.add(skillKey(name));
  });
  return catalog;
}

export function hydrateWorkspaceSkills(state: WorkspaceState): WorkspaceState {
  const skillCatalog = inferSkillCatalog(state);
  return {
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
  };
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
      gap: Math.max(0, openNeedCount - qualifiedCount),
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

export function memberSearchText(state: Pick<WorkspaceState, "customFields">, member: Member) {
  return entitySearchText(
    state.customFields,
    "member",
    member.customValues,
    [member.name, member.role, member.department, member.location, ...(member.skills ?? [])],
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
