export type Tone = "blue" | "mint" | "orange" | "plum" | "sky";
export type AvatarTone = "lavender" | "peach" | "sky" | "mint" | "sand" | "rose";
export type AssignmentStatus = "confirmed" | "draft";
export type NeedStatus = "open" | "planned" | "filled";
export type ProjectStatus = "進行中" | "要注意" | "準備中" | "完了間近" | "完了";

export type Member = {
  id: string;
  initials: string;
  name: string;
  role: string;
  department: string;
  avatarTone: AvatarTone;
  skills: string[];
  location: string;
  capacity: number;
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

const members: Member[] = [
  { id: "saeki", initials: "YS", name: "佐伯 優斗", role: "Product Designer", department: "デザイン", avatarTone: "lavender", skills: ["Figma", "UX", "Design system"], location: "東京", capacity: 100 },
  { id: "nakamura", initials: "MN", name: "中村 美咲", role: "Frontend Engineer", department: "プロダクト開発", avatarTone: "peach", skills: ["React", "TypeScript", "A11y"], location: "東京", capacity: 100 },
  { id: "suzuki", initials: "KS", name: "鈴木 健太", role: "Backend Engineer", department: "プラットフォーム", avatarTone: "sky", skills: ["Java", "AWS", "Payments"], location: "大阪", capacity: 100 },
  { id: "hayashi", initials: "AH", name: "林 葵", role: "Project Manager", department: "事業推進", avatarTone: "mint", skills: ["PM", "Scrum", "B2B"], location: "東京", capacity: 100 },
  { id: "matsumoto", initials: "RM", name: "松本 蓮", role: "QA Engineer", department: "品質保証", avatarTone: "sand", skills: ["QA", "Mobile", "Automation"], location: "福岡", capacity: 100 },
  { id: "ito", initials: "YI", name: "伊藤 優", role: "Data Analyst", department: "データ戦略", avatarTone: "rose", skills: ["Python", "SQL", "BI"], location: "リモート", capacity: 100 },
  { id: "morita", initials: "AM", name: "森田 葵", role: "UX Researcher", department: "デザイン", avatarTone: "mint", skills: ["Research", "UX", "Interview"], location: "東京", capacity: 100 },
  { id: "takahashi", initials: "NT", name: "高橋 直樹", role: "Mobile Engineer", department: "プロダクト開発", avatarTone: "lavender", skills: ["iOS", "Swift", "Mobile"], location: "大阪", capacity: 100 },
  { id: "okada", initials: "SO", name: "岡田 紗季", role: "QA Engineer", department: "品質保証", avatarTone: "rose", skills: ["QA", "Web", "Automation"], location: "東京", capacity: 100 },
];

const projects: Project[] = [
  { id: "atlas", code: "ATL", name: "Atlas リニューアル", summary: "販売管理プロダクトの全面刷新", status: "進行中", tone: "blue", ownerName: "林 葵", ownerInitials: "AH", startDate: "2026-07-06", endDate: "2026-10-31", nextMilestone: "β版レビュー", nextMilestoneDate: "2026-08-28", progress: 58, demand: 6 },
  { id: "payment", code: "PAY", name: "決済基盤アップデート", summary: "決済処理の可用性と監査対応を強化", status: "要注意", tone: "orange", ownerName: "鈴木 健太", ownerInitials: "KS", startDate: "2026-07-20", endDate: "2026-09-18", nextMilestone: "移行判定", nextMilestoneDate: "2026-08-21", progress: 71, demand: 4 },
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
  { id: "need-mobile-qa", projectId: "mobile", role: "QA Engineer", skills: ["QA", "Mobile"], startDate: "2026-08-24", endDate: "2026-09-04", allocation: 60, status: "open" },
  { id: "need-orion-be", projectId: "orion", role: "Backend Engineer", skills: ["API", "AWS"], startDate: "2026-08-31", endDate: "2026-09-30", allocation: 40, status: "open" },
];

export const initialWorkspace: WorkspaceState = { members, projects, assignments, needs };

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
