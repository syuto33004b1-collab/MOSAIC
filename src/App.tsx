import { type CSSProperties, type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  Bell,
  BriefcaseBusiness,
  Building2,
  CalendarDays,
  ChartNoAxesCombined,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock3,
  FolderKanban,
  Inbox,
  Layers3,
  LayoutDashboard,
  MoreHorizontal,
  Plus,
  Save,
  Search,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  Undo2,
  UserRoundPlus,
  UsersRound,
  X,
  type LucideIcon,
} from "lucide-react";
import { CustomFieldFacts, CustomFieldInputs, CsvTransferPanel, FavoriteStar, FieldsView, MemberOrgFields, MembersView, OpportunitiesView, OrgFacts, OrgView, ProjectsView, ProposalView, ReportsView, SkillsView, WorkHistoryEditor, WorkHistoryList } from "./expanded-views";
import { AiChat } from "./components/ai-chat/AiChat";
import type { ChatTransport } from "./lib/ai/chatClient";
import {
  addCustomField,
  addDays,
  addOrgUnit,
  addProfileRequests,
  addSearchScene,
  addSavedReport,
  addSkillCatalogEntry,
  archiveOrgUnit,
  assignmentSpan,
  boardRange,
  type BoardUnit,
  cancelProfileRequest,
  canConvertOpportunity,
  completeProfileRequest,
  convertOpportunityToProject,
  createProjectCode,
  formatDate,
  formatSkillInput,
  getIsoWeekNumber,
  getWeekStartForDate,
  currentLocalDate,
  getWeekStart,
  hydrateWorkspaceSkills,
  initialWorkspace,
  isActiveOpportunity,
  makeInitials,
  memberById,
  memberDailyLoads,
  memberLoad,
  memberMatchesNeed,
  memberOrgMemberships,
  memberPeakLoad,
  matchMembers,
  memberSearchText,
  memberSkillLevels,
  moveOrgUnit,
  needSkillRequirements,
  normalizeCustomValues,
  normalizeWorkHistory,
  OPPORTUNITY_STAGE_LABELS,
  opportunityById,
  opportunityNeedsFor,
  orgUnitTree,
  overlaps,
  parseSkillInput,
  projectById,
  projectMembers,
  projectMembersOnDays,
  projectSearchText,
  projectTone,
  setMemberOrgMemberships,
  setRolePermission,
  searchSceneFromNeed,
  submitProfileRequest,
  editableCustomFields,
  visibleCustomFields,
  weekEnd,
  type Assignment,
  type AvatarTone,
  type CustomFieldEntity,
  type CustomFieldType,
  type Member,
  type Opportunity,
  type OpportunityNeed,
  type OpportunityStage,
  type PersonScope,
  type ProfileRequestScope,
  type Project,
  type ProjectStatus,
  type ReportGroupBy,
  type ReportMetric,
  type ReportSource,
  type RestrictableFeature,
  type RestrictableRole,
  type SearchSkillFilter,
  type SkillKind,
  type StaffingNeed,
  type Tone,
  type WeekDay,
  type WorkHistoryEntry,
  type WorkspaceState,
} from "./domain";

import {
  buildShareHref,
  isFavorited,
  parseShareSearch,
  readDemoFavorites,
  retainedMemberIds,
  toggleFavorite,
  writeDemoFavorites,
  type Favorite,
  type FavoriteKind,
} from "./collaboration";
import { applyMemberImport, type MemberImportAction } from "./csv";

export type OrganizationRole = "owner" | "admin" | "planner" | "viewer";

export type WorkspacePermissions = {
  personScope: PersonScope;
  hiddenFieldKeys: string[];
  readonlyFieldKeys: string[];
  disabledFeatures: RestrictableFeature[];
};

export type SharedWorkspaceAdapter = {
  initialState: WorkspaceState;
  initialRevision: number;
  initialPermissions?: WorkspacePermissions;
  save: (state: WorkspaceState, expectedRevision: number, requestId: string) => Promise<{ revision: number; savedAt: string }>;
  reload: () => Promise<{ state: WorkspaceState; revision: number; permissions?: WorkspacePermissions }>;
  subscribe: (onRevision: (revision?: number) => void) => () => void;
  listFavorites?: () => Promise<Favorite[]>;
  setFavorite?: (kind: FavoriteKind, targetId: string, favorite: boolean) => Promise<Favorite[]>;
  submitProfileRequest?: (
    requestId: string,
    proposed: { skills: string; workHistory: WorkHistoryEntry[] },
    expectedRevision: number,
    requestIdToken: string,
  ) => Promise<{ revision: number; savedAt: string; state?: WorkspaceState }>;
};

export type AppProps = {
  mode?: "demo" | "shared";
  organizationId?: string;
  organizationName?: string;
  identity?: { name: string; email: string; role: OrganizationRole; userId?: string };
  shared?: SharedWorkspaceAdapter;
  onSignOut?: () => void;
  onOpenOperations?: () => void;
  onAccessInvalidated?: () => void;
  aiChatTransport?: ChatTransport;
};

type Drawer = "add" | "assignment" | "overload" | "openRole" | "project" | "member" | "newProject" | "newMember" | "editProject" | "editMember" | "needForm" | "opportunity" | "newOpportunity" | "editOpportunity" | "opportunityNeedForm" | null;

type AssignmentEditForm = {
  personId: string;
  projectId: string;
  startDate: string;
  endDate: string;
  allocation: string;
};

type MemberForm = {
  name: string;
  role: string;
  department: string;
  location: string;
  skills: string;
  capacity: string;
  customValues: Record<string, string>;
  workHistory: WorkHistoryEntry[];
  primaryUnitId: string;
  extraUnitIds: string[];
  managerUnitIds: string[];
};

type ProjectEditForm = {
  name: string;
  summary: string;
  status: ProjectStatus;
  ownerId: string;
  startDate: string;
  endDate: string;
  nextMilestone: string;
  nextMilestoneDate: string;
  progress: string;
  demand: string;
  customValues: Record<string, string>;
};

type NeedForm = {
  projectId: string;
  role: string;
  skills: string;
  startDate: string;
  endDate: string;
  allocation: string;
};

type OpportunityForm = {
  name: string;
  summary: string;
  stage: OpportunityStage;
  ownerId: string;
  startDate: string;
  endDate: string;
  demand: string;
};

type OpportunityNeedForm = {
  opportunityId: string;
  role: string;
  skills: string;
  startDate: string;
  endDate: string;
  allocation: string;
};

type ScheduleItem = {
  id: string;
  name: string;
  start: number;
  span: number;
  tone: Tone;
  allocation: number;
  status: "confirmed" | "draft";
  projectId: string;
};

type ScheduleRow = {
  id: string;
  initials: string;
  name: string;
  role: string;
  avatarTone: AvatarTone;
  tagLabel: string;
  alert?: boolean;
  filterKey: string;
  assignments: ScheduleItem[];
};

const navItems = [
  { id: "board", label: "アサインボード", icon: LayoutDashboard },
  { id: "projects", label: "プロジェクト", icon: FolderKanban },
  { id: "opportunities", label: "受注前", icon: Inbox },
  { id: "members", label: "メンバー", icon: UsersRound },
  { id: "proposal", label: "提案", icon: Sparkles },
  { id: "org", label: "組織", icon: Building2 },
  { id: "skills", label: "スキルマップ", icon: Layers3 },
  { id: "fields", label: "項目定義", icon: SlidersHorizontal },
  { id: "reports", label: "レポート", icon: ChartNoAxesCombined },
];

const pageMeta = {
  /* 「今週」 came out of the title: the board can show a month now, and paging
     already made the word wrong within a week. The exact range is on the line
     below it, from the range itself (#139). */
  board: { eyebrow: "RESOURCE PLANNING", title: "チーム編成", description: "日ごとの重なりと、期間全体の稼働を確認します。" },
  projects: { eyebrow: "PORTFOLIO CONTROL", title: "プロジェクト・ポートフォリオ", description: "案件ごとの充足と次の節目を横断して管理します。" },
  opportunities: { eyebrow: "PRE-AWARD PIPELINE", title: "受注前案件", description: "引き合いから商談までの要員計画を、確定プロジェクトと分けて検討します。" },
  members: { eyebrow: "TEAM AVAILABILITY", title: "メンバーと空き状況", description: "スキルと4週間の稼働から、次の担当者を探します。" },
  proposal: { eyebrow: "CANDIDATE PROPOSAL", title: "候補者提案", description: "氏名を隠して、スキルと空き状況だけを比較します。" },
  org: { eyebrow: "ORGANIZATION TREE", title: "組織階層", description: "部門の階層、責任者、兼務を管理し、検索とレポートへ使います。" },
  skills: { eyebrow: "SKILL TAXONOMY", title: "スキルマップ", description: "分類、習熟度、不足領域を組織全体で確認します。" },
  fields: { eyebrow: "FIELD DEFINITIONS", title: "項目と経歴", description: "独自項目の配置と、メンバーの業務経歴を管理します。" },
  reports: { eyebrow: "CAPACITY FORECAST", title: "キャパシティ予測", description: "需給の変化と、判断が必要な例外を見通します。" },
} as const;

const storageKey = "mosaic-local-workspace-v3";

/**
 * The days an assignment bar covers, for the button's accessible name (#88).
 *
 * Three of the four 「Atlas リニューアル」 bars on the board shared a name *and* a
 * day range — only the row told them apart — so the name carries both. `start`
 * is the 1-based grid column `assignmentGrid` produced. That function clamps to
 * `weekEnd`, four days after Monday, and `getWeekDays` returns five, so the
 * indices land in range; the clamp here is because that invariant lives in
 * another file and a `days[undefined]` would blank the board.
 */
function assignmentDayRange(days: WeekDay[], start: number, span: number) {
  const at = (index: number) => days[Math.min(Math.max(index, 0), days.length - 1)];
  const first = at(start - 1);
  const last = at(start + span - 2);
  const label = (day: WeekDay) => day.month + "/" + day.date;
  return first === last ? label(first) : label(first) + "〜" + label(last);
}

function cloneState(state: WorkspaceState): WorkspaceState {
  return JSON.parse(JSON.stringify(state)) as WorkspaceState;
}

function migrateDemoWorkspace(state: WorkspaceState): WorkspaceState {
  const memberIds = new Set(state.members.map((member) => member.id));
  const projectIds = new Set(state.projects.map((project) => project.id));
  const opportunityIds = new Set((state.opportunities ?? []).map((opportunity) => opportunity.id));
  return hydrateWorkspaceSkills({
    ...state,
    assignments: state.assignments.filter((assignment) => assignment.allocation > 0 && memberIds.has(assignment.personId) && projectIds.has(assignment.projectId)),
    needs: state.needs.filter((need) => projectIds.has(need.projectId)),
    opportunities: state.opportunities ?? [],
    opportunityNeeds: (state.opportunityNeeds ?? []).filter((need) => opportunityIds.has(need.opportunityId)),
  });
}

function assignmentMatchesNeed(state: WorkspaceState, assignment: Assignment, need: StaffingNeed) {
  const member = memberById(state, assignment.personId);
  return Boolean(member && memberMatchesNeed(member, need))
    && assignment.projectId === need.projectId
    && assignment.startDate <= need.startDate
    && assignment.endDate >= need.endDate
    && assignment.allocation >= need.allocation;
}

function assignmentStillFulfillsNeed(
  state: WorkspaceState,
  need: StaffingNeed,
  edited: AssignmentEditForm,
  allocation: number,
) {
  const member = memberById(state, edited.personId);
  const memberMatches = Boolean(member && memberMatchesNeed(member, need));
  return memberMatches
    && edited.projectId === need.projectId
    && edited.startDate <= need.startDate
    && edited.endDate >= need.endDate
    && allocation >= need.allocation;
}

function newId() {
  return crypto.randomUUID();
}

function emptyMemberForm(state: WorkspaceState): MemberForm {
  const primaryUnitId = state.orgUnits?.find((unit) => unit.name === "プロダクト開発")?.id
    ?? orgUnitTree(state.orgUnits)[0]?.id
    ?? "";
  return {
    name: "",
    role: "Frontend Engineer",
    department: orgUnitTree(state.orgUnits).find((unit) => unit.id === primaryUnitId)?.name ?? "プロダクト開発",
    location: "東京",
    skills: "",
    capacity: "100",
    customValues: {},
    workHistory: [],
    primaryUnitId,
    extraUnitIds: [],
    managerUnitIds: [],
  };
}

function memberFormFrom(state: WorkspaceState, member: Member): MemberForm {
  const memberships = memberOrgMemberships(state, member.id);
  return {
    name: member.name,
    role: member.role,
    department: member.department,
    location: member.location,
    skills: formatSkillInput(memberSkillLevels(member)),
    capacity: String(member.capacity),
    customValues: { ...(member.customValues ?? {}) },
    workHistory: member.workHistory ? member.workHistory.map((entry) => ({ ...entry })) : [],
    primaryUnitId: memberships.find((item) => item.isPrimary)?.orgUnitId ?? "",
    extraUnitIds: memberships.filter((item) => !item.isPrimary).map((item) => item.orgUnitId),
    managerUnitIds: memberships.filter((item) => item.isManager).map((item) => item.orgUnitId),
  };
}

function applyMemberOrg(state: WorkspaceState, personId: string, form: MemberForm) {
  if (!(state.orgUnits ?? []).length) return state;
  return setMemberOrgMemberships(state, personId, {
    primaryUnitId: form.primaryUnitId || null,
    extraUnitIds: form.extraUnitIds,
    managerUnitIds: form.managerUnitIds,
  });
}


function initialShareLink() {
  return parseShareSearch(window.location.search);
}

async function copyText(value: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }
  throw new Error("clipboard unavailable");
}

function drawerFromShare(link: ReturnType<typeof parseShareSearch>, state: WorkspaceState): { drawer: Drawer; memberId?: string; projectId?: string; toast?: string } {
  if (link?.nav === "members" && link.open) {
    if (memberById(state, link.open)) return { drawer: "member", memberId: link.open };
    return { drawer: null, toast: "共有リンクのメンバーが見つかりません" };
  }
  if (link?.nav === "projects" && link.open) {
    if (projectById(state, link.open)) return { drawer: "project", projectId: link.open };
    return { drawer: null, toast: "共有リンクのプロジェクトが見つかりません" };
  }
  return { drawer: null };
}

export default function Home({ mode = "demo", organizationId, organizationName = "MOSAIC デモ", identity, shared, onSignOut, onOpenOperations, onAccessInvalidated, aiChatTransport }: AppProps) {
  const startingWorkspace = shared?.initialState ?? initialWorkspace;
  const startingShare = initialShareLink();
  const opening = drawerFromShare(startingShare, startingWorkspace);
  const [workspace, setWorkspace] = useState<WorkspaceState>(() => cloneState(startingWorkspace));
  const [committedWorkspace, setCommittedWorkspace] = useState<WorkspaceState>(() => cloneState(startingWorkspace));
  const [activeNav, setActiveNav] = useState<keyof typeof pageMeta>(startingShare?.nav ?? "board");
  const [viewMode, setViewMode] = useState<"members" | "projects">("members");
  const [weekOffset, setWeekOffset] = useState(0);
  /**
   * The board's span. Only the board's — everything else on the page stays
   * week-scoped, because the sidebar's utilisation card and the attention panel
   * carry the word 「週」 in their labels (#119) and a month behind a week's label
   * is the defect #115 was about. `currentWeekStart` below is the week containing
   * this range's start, which in week mode is the range itself.
   */
  const [boardUnit, setBoardUnit] = useState<BoardUnit>("week");
  const [filter, setFilter] = useState("すべて");
  const [query, setQuery] = useState("");
  const [memberQuery, setMemberQuery] = useState(startingShare?.nav === "members" ? startingShare.q ?? "" : "");
  const [projectQuery, setProjectQuery] = useState(startingShare?.nav === "projects" ? startingShare.q ?? "" : "");
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [favorites, setFavorites] = useState<Favorite[]>(() => mode === "demo" ? readDemoFavorites() : []);
  const [proposalMemberIds, setProposalMemberIds] = useState<string[]>(startingShare?.nav === "proposal" ? startingShare.memberIds ?? [] : []);
  const [proposalAnonymous, setProposalAnonymous] = useState(startingShare?.nav === "proposal" ? Boolean(startingShare.anonymous) : false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [drawer, setDrawer] = useState<Drawer>(opening.drawer);
  const [selectedProjectId, setSelectedProjectId] = useState(opening.projectId ?? startingWorkspace.projects[0]?.id ?? "");
  const [selectedMemberId, setSelectedMemberId] = useState(opening.memberId ?? startingWorkspace.members[0]?.id ?? "");
  const [selectedAssignmentId, setSelectedAssignmentId] = useState("");
  const [selectedNeedId, setSelectedNeedId] = useState(startingWorkspace.needs[0]?.id ?? "");
  const [toast, setToast] = useState(opening.toast ?? "");
  const [unsavedChanges, setUnsavedChanges] = useState(0);
  const [hydrated, setHydrated] = useState(mode === "shared");
  const [revision, setRevision] = useState(shared?.initialRevision ?? 0);
  const [permissions, setPermissions] = useState<WorkspacePermissions | undefined>(shared?.initialPermissions);
  const [syncStatus, setSyncStatus] = useState<"idle" | "saving" | "refreshing" | "conflict" | "error">("idle");
  const [syncError, setSyncError] = useState("");
  const [syncRetryable, setSyncRetryable] = useState(true);
  const [form, setForm] = useState({ personId: startingWorkspace.members[0]?.id ?? "", projectId: startingWorkspace.projects[0]?.id ?? "", startDate: getWeekStart(0), endDate: addDays(getWeekStart(0), 4), allocation: "40" });
  const [projectForm, setProjectForm] = useState({ name: "", status: "準備中" as ProjectStatus, endDate: addDays(getWeekStart(0), 90), ownerId: startingWorkspace.members[0]?.id ?? "" });
  const [memberForm, setMemberForm] = useState<MemberForm>(() => emptyMemberForm(startingWorkspace));
  const [memberEditForm, setMemberEditForm] = useState<MemberForm>(() => emptyMemberForm(startingWorkspace));
  const [projectEditForm, setProjectEditForm] = useState<ProjectEditForm>({ name: "", summary: "", status: "準備中", ownerId: "", startDate: "", endDate: "", nextMilestone: "", nextMilestoneDate: "", progress: "0", demand: "1", customValues: {} });
  const [needForm, setNeedForm] = useState<NeedForm>({ projectId: startingWorkspace.projects[0]?.id ?? "", role: "Frontend Engineer", skills: "", startDate: getWeekStart(0), endDate: addDays(getWeekStart(0), 4), allocation: "40" });
  const [editingNeedId, setEditingNeedId] = useState<string | null>(null);
  const [opportunityForm, setOpportunityForm] = useState<OpportunityForm>({ name: "", summary: "", stage: "inquiry", ownerId: startingWorkspace.members[0]?.id ?? "", startDate: getWeekStart(0), endDate: addDays(getWeekStart(0), 90), demand: "3" });
  const [opportunityEditForm, setOpportunityEditForm] = useState<OpportunityForm>({ name: "", summary: "", stage: "inquiry", ownerId: "", startDate: "", endDate: "", demand: "1" });
  const [opportunityNeedForm, setOpportunityNeedForm] = useState<OpportunityNeedForm>({ opportunityId: startingWorkspace.opportunities?.[0]?.id ?? "", role: "Frontend Engineer", skills: "", startDate: getWeekStart(0), endDate: addDays(getWeekStart(0), 4), allocation: "40" });
  const [editingOpportunityNeedId, setEditingOpportunityNeedId] = useState<string | null>(null);
  const [selectedOpportunityId, setSelectedOpportunityId] = useState(startingWorkspace.opportunities?.[0]?.id ?? "");
  const [selectedOpportunityNeedId, setSelectedOpportunityNeedId] = useState(startingWorkspace.opportunityNeeds?.[0]?.id ?? "");
  const [assignmentEditForm, setAssignmentEditForm] = useState<AssignmentEditForm>({ personId: "", projectId: "", startDate: "", endDate: "", allocation: "40" });
  const [pendingSave, setPendingSave] = useState<{ requestId: string; snapshot: string } | null>(null);
  const [saveOutcomePending, setSaveOutcomePending] = useState(false);
  const [formDirty, setFormDirty] = useState(false);
  const [aiActionBusy, setAiActionBusy] = useState(false);
  const drawerRef = useRef<HTMLElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const unsavedRef = useRef(0);
  const revisionRef = useRef(revision);
  const syncBusyRef = useRef(false);
  const saveBusyRef = useRef(false);
  const pendingRemoteRevisionRef = useRef(0);
  const pendingUnknownRefreshRef = useRef(false);
  const refreshWorkspaceRef = useRef<(remoteRevision?: number, propagateError?: boolean) => Promise<void>>(async () => undefined);
  const saveOutcomeUncertainRef = useRef(false);
  const formDirtyRef = useRef(false);
  const favoritesRef = useRef(favorites);

  const clearFormDraft = useCallback(() => {
    formDirtyRef.current = false;
    setFormDirty(false);
  }, []);

  const markFormDraftDirty = () => {
    if (formDirtyRef.current) return;
    formDirtyRef.current = true;
    setFormDirty(true);
  };

  const closeDrawer = useCallback(() => {
    clearFormDraft();
    setDrawer(null);
  }, [clearFormDraft]);

  const drainPendingRefresh = useCallback(() => {
    if (syncBusyRef.current || saveBusyRef.current) return;
    if (pendingUnknownRefreshRef.current) {
      pendingUnknownRefreshRef.current = false;
      void refreshWorkspaceRef.current();
      return;
    }
    const pendingRevision = pendingRemoteRevisionRef.current;
    if (pendingRevision <= revisionRef.current) {
      pendingRemoteRevisionRef.current = 0;
      return;
    }
    pendingRemoteRevisionRef.current = 0;
    void refreshWorkspaceRef.current(pendingRevision);
  }, []);

  useEffect(() => {
    if (mode !== "demo") return;
    const timer = window.setTimeout(() => {
      let nextState = startingWorkspace;
      try {
        const saved = window.localStorage.getItem(storageKey);
        if (saved) {
          const parsed = JSON.parse(saved) as WorkspaceState;
          if (Array.isArray(parsed.members) && Array.isArray(parsed.assignments)) {
            const migrated = migrateDemoWorkspace(parsed);
            nextState = migrated;
            setWorkspace(migrated);
            setCommittedWorkspace(cloneState(migrated));
          }
        }
      } catch {
        window.localStorage.removeItem(storageKey);
      }
      const restored = drawerFromShare(parseShareSearch(window.location.search), nextState);
      if (restored.memberId) setSelectedMemberId(restored.memberId);
      if (restored.projectId) setSelectedProjectId(restored.projectId);
      if (restored.drawer) setDrawer(restored.drawer);
      else if (nextState !== startingWorkspace) closeDrawer();
      if (restored.toast) setToast(restored.toast);
      setHydrated(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [closeDrawer, mode, startingWorkspace]);

  useEffect(() => {
    unsavedRef.current = unsavedChanges;
  }, [unsavedChanges]);

  useEffect(() => {
    if (unsavedChanges === 0 && !formDirty) return;
    const warnBeforeLeaving = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warnBeforeLeaving);
    return () => window.removeEventListener("beforeunload", warnBeforeLeaving);
  }, [formDirty, unsavedChanges]);

  useEffect(() => {
    revisionRef.current = revision;
  }, [revision]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 3200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    favoritesRef.current = favorites;
  }, [favorites]);

  useEffect(() => {
    if (mode !== "shared" || !shared?.listFavorites) return;
    if ((shared.initialPermissions?.disabledFeatures ?? []).includes("favorites")) return;
    let active = true;
    shared.listFavorites()
      .then((items) => {
        if (active) setFavorites(items);
      })
      .catch(() => {
        if (active) setToast("お気に入りを読み込めませんでした");
      });
    return () => {
      active = false;
    };
  }, [mode, shared]);

  useEffect(() => {
    if (!drawer) return;
    previousFocus.current = document.activeElement as HTMLElement;
    document.body.style.overflow = "hidden";
    window.setTimeout(() => drawerRef.current?.focus(), 0);
    const trapFocus = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const elements = drawerRef.current?.querySelectorAll<HTMLElement>("button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex='-1'])");
      if (!elements || elements.length === 0) return;
      const first = elements[0];
      const last = elements[elements.length - 1];
      const activeElement = document.activeElement;
      if (activeElement === drawerRef.current || !drawerRef.current?.contains(activeElement)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (event.shiftKey && activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", trapFocus);
    return () => {
      document.body.style.overflow = "";
      document.removeEventListener("keydown", trapFocus);
      previousFocus.current?.focus();
    };
  }, [drawer]);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeDrawer();
        setNotificationsOpen(false);
      }
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [closeDrawer]);

  useEffect(() => {
    if (mode !== "shared" || !shared) return;
    let active = true;

    const refreshIfSafe = async (remoteRevision?: number, propagateError = false) => {
      if (!active) return;
      if (saveOutcomeUncertainRef.current) {
        if (remoteRevision !== undefined) {
          pendingRemoteRevisionRef.current = Math.max(pendingRemoteRevisionRef.current, remoteRevision);
        } else pendingUnknownRefreshRef.current = true;
        return;
      }
      if (syncBusyRef.current || saveBusyRef.current) {
        if (remoteRevision !== undefined) {
          pendingRemoteRevisionRef.current = Math.max(pendingRemoteRevisionRef.current, remoteRevision);
        } else pendingUnknownRefreshRef.current = true;
        return;
      }
      if (remoteRevision !== undefined && remoteRevision <= revisionRef.current) return;
      if (remoteRevision !== undefined && (unsavedRef.current > 0 || formDirtyRef.current)) {
        setSyncStatus("conflict");
        if (propagateError) throw new Error("最新データを反映する前に編集が始まりました。");
        return;
      }
      syncBusyRef.current = true;
      setSyncStatus("refreshing");
      setSyncError("");
      try {
        const latest = await shared.reload();
        if (latest.permissions) setPermissions(latest.permissions);
        if (!active || latest.revision <= revisionRef.current) {
          if (active) setSyncStatus("idle");
          return;
        }
        if (unsavedRef.current > 0 || formDirtyRef.current) {
          setSyncStatus("conflict");
          setSyncError("最新データの確認中に編集が始まりました。下書きは保持されています。");
          if (propagateError) {
            throw Object.assign(new Error("最新データの確認中に編集が始まりました。"), { code: "LOCAL_CHANGES_DURING_REFRESH" });
          }
          return;
        }
        revisionRef.current = latest.revision;
        setRevision(latest.revision);
        setWorkspace(cloneState(latest.state));
        setCommittedWorkspace(cloneState(latest.state));
        closeDrawer();
        setSyncStatus("idle");
        setToast("チームの最新変更を反映しました");
      } catch (error) {
        if (typeof error === "object" && error !== null && "code" in error && error.code === "LOCAL_CHANGES_DURING_REFRESH") throw error;
        if (!active) return;
        if (typeof error === "object" && error !== null && "code" in error && error.code === "FORBIDDEN") onAccessInvalidated?.();
        setSyncStatus("error");
        setSyncError(error instanceof Error ? error.message : "共有データの再読み込みに失敗しました");
        if (propagateError) throw error;
      } finally {
        syncBusyRef.current = false;
        if (active) drainPendingRefresh();
      }
    };

    const triggerRefresh = (remoteRevision?: number, propagateError = false) => refreshIfSafe(remoteRevision, propagateError);
    refreshWorkspaceRef.current = triggerRefresh;
    drainPendingRefresh();
    const unsubscribe = shared.subscribe((remoteRevision) => void refreshIfSafe(remoteRevision));
    const handleFocus = () => void refreshIfSafe();
    const handleVisibility = () => {
      if (document.visibilityState === "visible") void refreshIfSafe();
    };
    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      active = false;
      if (refreshWorkspaceRef.current === triggerRefresh) refreshWorkspaceRef.current = async () => undefined;
      unsubscribe();
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [closeDrawer, drainPendingRefresh, mode, onAccessInvalidated, shared]);

  const handleAiWorkspaceRevision = useCallback(async (remoteRevision: number) => {
    if (!Number.isSafeInteger(remoteRevision) || remoteRevision < 0 || remoteRevision <= revisionRef.current) return;
    await refreshWorkspaceRef.current(remoteRevision, true);
  }, []);

  /**
   * Below 620px the nav is one scrolling row (#83), so the current screen's item
   * can sit past the right edge — a deep link like `?nav=reports` at 390px opens
   * with 194px of the row off-screen and the active item at the far end.
   *
   * Guarded by the same query the layout uses, rather than relying on
   * `"nearest"` to be a no-op on the desktop column: it is, at the top of the
   * page, but that was measured in one scroll position and this is not the place
   * to depend on it. Re-run on resize because the item can go off-screen without
   * `activeNav` changing — a rotation, or dragging a desktop window narrow while
   * レポート is open.
   */
  const activeNavItemRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    const bringIntoView = () => {
      if (!window.matchMedia("(max-width: 620px)").matches) return;
      activeNavItemRef.current?.scrollIntoView({ block: "nearest", inline: "nearest" });
    };
    bringIntoView();
    window.addEventListener("resize", bringIntoView);
    return () => window.removeEventListener("resize", bringIntoView);
  }, [activeNav]);

  const range = useMemo(() => boardRange(boardUnit, weekOffset), [boardUnit, weekOffset]);
  const days = range.days;
  /**
   * The week everything week-scoped works from — the drawers' 「この週」, the
   * attention panel, and the week offset the other screens receive.
   *
   * Derived from the range, not from `weekOffset` directly. The offset counts
   * whatever unit the board is showing, so `getWeekStart(weekOffset)` read a month
   * of paging as that many *weeks*: one page into September put these figures on
   * the week after next. In week mode this is the same value it always was.
   */
  const weekStart = getWeekStartForDate(range.start);
  const visibleProposalIds = retainedMemberIds(proposalMemberIds, workspace.members.map((member) => member.id));
  // The week the range opens in. Identical to `range.start` in week mode; in month
  // mode it is the month's first week, so everything keyed off it stays a week and
  // keeps saying so.
  const currentWeekStart = weekStart;
  /** The same week, as a count of weeks from this one, for the screens that take one. */
  const viewWeekOffset = Math.round((Date.parse(weekStart + "T00:00:00Z") - Date.parse(getWeekStart(0) + "T00:00:00Z")) / 604_800_000);
  const currentDailyLoads = workspace.members.flatMap((member) => memberDailyLoads(workspace, member.id, currentWeekStart, weekEnd(currentWeekStart)).map((day) => ({ ...day, capacity: member.capacity })));
  const totalCapacity = workspace.members.reduce((sum, member) => sum + member.capacity, 0) * 5;
  const averageLoad = totalCapacity > 0 ? Math.round(currentDailyLoads.reduce((sum, day) => sum + day.load, 0) / totalCapacity * 100) : 0;
  const freeDays = (currentDailyLoads.reduce((sum, day) => sum + Math.max(0, day.capacity - day.load), 0) / 100).toFixed(1);
  const currentOverloads = workspace.members.filter((member) => memberLoad(workspace, member.id, currentWeekStart) > member.capacity);
  const committedOverloads = committedWorkspace.members.filter((member) => memberLoad(committedWorkspace, member.id, currentWeekStart) > member.capacity);
  const overloadMember = currentOverloads[0] ?? committedOverloads.find((member) => memberLoad(workspace, member.id, currentWeekStart) <= member.capacity);
  const overloadPlanned = Boolean(overloadMember && committedOverloads.some((member) => member.id === overloadMember.id) && memberLoad(workspace, overloadMember.id, currentWeekStart) <= overloadMember.capacity);
  const overloadDates = overloadMember ? (() => {
    const current = memberDailyLoads(workspace, overloadMember.id, currentWeekStart, weekEnd(currentWeekStart)).filter((day) => day.load > overloadMember.capacity).map((day) => day.date);
    return current.length > 0 ? current : memberDailyLoads(committedWorkspace, overloadMember.id, currentWeekStart, weekEnd(currentWeekStart)).filter((day) => day.load > overloadMember.capacity).map((day) => day.date);
  })() : [];
  const overloadAssignments = overloadMember ? workspace.assignments
    .filter((assignment) => assignment.personId === overloadMember.id && overloadDates.some((date) => assignment.startDate <= date && assignment.endDate >= date))
    .sort((a, b) => a.allocation - b.allocation) : [];
  const activeNeeds = workspace.needs.filter((need) => need.status !== "filled");
  const displayNeed = activeNeeds[0];
  const selectedNeed = workspace.needs.find((need) => need.id === selectedNeedId);
  const candidateMatches = selectedNeed ? matchMembers(workspace, searchSceneFromNeed(selectedNeed)).slice(0, 5) : [];
  const adjustmentCount = currentOverloads.length + (overloadPlanned ? 1 : 0) + activeNeeds.length;
  const page = pageMeta[activeNav];
  const selectedProject = projectById(workspace, selectedProjectId);
  const selectedProjectNeeds = selectedProject ? workspace.needs.filter((need) => need.projectId === selectedProject.id) : [];
  const selectedMember = memberById(workspace, selectedMemberId);
  const selectedAssignment = workspace.assignments.find((assignment) => assignment.id === selectedAssignmentId);
  const selectedAssignmentIsPersisted = Boolean(selectedAssignment && committedWorkspace.assignments.some((assignment) => assignment.id === selectedAssignment.id));
  const selectedOpportunity = opportunityById(workspace, selectedOpportunityId);
  const selectedOpportunityNeeds = selectedOpportunity ? opportunityNeedsFor(workspace, selectedOpportunity.id) : [];
  const selectedOpportunityNeed = selectedOpportunityNeeds.find((need) => need.id === selectedOpportunityNeedId) ?? selectedOpportunityNeeds[0];
  const opportunityCandidates = selectedOpportunityNeed ? workspace.members.filter((member) => {
    const available = member.capacity - memberPeakLoad(workspace, member.id, selectedOpportunityNeed.startDate, selectedOpportunityNeed.endDate);
    return memberMatchesNeed(member, selectedOpportunityNeed) && available >= selectedOpportunityNeed.allocation;
  }).slice(0, 3) : [];
  const role = identity?.role ?? (mode === "demo" ? "owner" : "viewer");
  const operationLocked = mode === "shared" && (syncStatus === "saving" || syncStatus === "refreshing" || syncStatus === "conflict");
  const hasEditPermission = mode === "demo" || role !== "viewer";
  const canEdit = hasEditPermission && !operationLocked && !saveOutcomePending;
  const canManageMembers = (mode === "demo" || role === "owner" || role === "admin") && !operationLocked && !saveOutcomePending;
  const disabledFeatures = new Set<RestrictableFeature>(permissions?.disabledFeatures ?? []);
  const featureEnabled = (feature: RestrictableFeature) => !disabledFeatures.has(feature);
  const visibleNavItems = navItems.filter((item) => item.id !== "opportunities" || featureEnabled("opportunities"));
  const accountActionLocked = operationLocked || saveOutcomePending || aiActionBusy;
  const roleLabel: Record<OrganizationRole, string> = { owner: "オーナー", admin: "管理者", planner: "プランナー", viewer: "閲覧者" };
  const displayName = identity?.name || "デモユーザー";
  const canAddAssignment = canEdit && workspace.members.length > 0 && workspace.projects.length > 0;

  const memberRows: ScheduleRow[] = workspace.members.map((member) => {
    // The peak over what is on screen, not over the first week of it. The chip
    // carries no words, so following the range is all it takes to stay honest —
    // and `alert` means "over capacity somewhere in view", which is what a board
    // showing a month should say.
    const load = memberPeakLoad(workspace, member.id, range.start, range.end);
    const assignments = workspace.assignments.flatMap((assignment) => {
      if (assignment.personId !== member.id) return [];
      const grid = assignmentSpan(assignment, range);
      if (!grid) return [];
      const project = projectById(workspace, assignment.projectId);
      return [{
        id: assignment.id,
        name: assignment.label || project?.name || "プロジェクト未登録",
        start: grid.start,
        span: grid.span,
        tone: projectById(workspace, assignment.projectId)?.tone || projectTone[assignment.projectId] || "plum",
        allocation: assignment.allocation,
        status: assignment.status,
        projectId: assignment.projectId,
      }];
    });
    return {
      id: member.id,
      initials: member.initials,
      name: member.name,
      role: member.role + " · " + member.department,
      avatarTone: member.avatarTone,
      tagLabel: load + "%",
      alert: load > member.capacity,
      filterKey: member.role,
      assignments,
    };
  });

  const projectRows: ScheduleRow[] = workspace.projects.map((project) => {
    const assignments = workspace.assignments.flatMap((assignment) => {
      if (assignment.projectId !== project.id) return [];
      const grid = assignmentSpan(assignment, range);
      if (!grid) return [];
      const member = memberById(workspace, assignment.personId);
      return [{
        id: assignment.id,
        name: (member?.name || "担当未定") + " · " + assignment.allocation + "%",
        start: grid.start,
        span: grid.span,
        tone: project.tone,
        allocation: assignment.allocation,
        status: assignment.status,
        projectId: project.id,
      }];
    });
    const staffed = projectMembersOnDays(workspace, project.id, range.days);
    return {
      id: project.id,
      initials: project.code.slice(0, 2),
      name: project.name,
      role: project.summary,
      avatarTone: project.status === "要注意" ? "peach" : project.status === "準備中" ? "sky" : "lavender",
      tagLabel: project.demand === 0 ? "未設定" : staffed + "/" + project.demand + "名",
      alert: staffed < project.demand,
      filterKey: project.status,
      assignments,
    };
  });

  const rows = (viewMode === "members" ? memberRows : projectRows).filter((row) => {
    const entity = viewMode === "members" ? memberById(workspace, row.id) : projectById(workspace, row.id);
    const extraSearch = entity && "skills" in entity
      ? memberSearchText(workspace, entity)
      : entity
        ? projectSearchText(workspace, entity)
        : "";
    const queryMatch = (row.name + " " + row.role + " " + row.assignments.map((item) => item.name).join(" ") + " " + extraSearch).toLowerCase().includes(query.toLowerCase());
    const filterMatch = filter === "すべて" || row.filterKey === filter;
    return queryMatch && filterMatch;
  });

  /**
   * One place for the words that describe the range, because #115 was a label and
   * a number that had drifted apart. `unitWord` goes into the paging buttons and
   * the grid's name; `rangeLabel` into the date line, from the range's real ends —
   * a month starts on its first weekday, which in August 2026 is the 3rd.
   */
  const unitWord = range.unit === "week" ? "週" : "月";
  /** The Monday the week-scoped figures cover, for the labels that name it. */
  const measuredWeek = { month: Number(currentWeekStart.slice(5, 7)), date: Number(currentWeekStart.slice(8, 10)) };
  const rangeEndDay = days[days.length - 1];
  // The end's year only when it differs: a week can straddle New Year, and
  // 「2026年 12月28日 — 1月1日」 leaves the reader to guess which January.
  const rangeLabel = days[0].month + "月" + days[0].date + "日 — "
    + (rangeEndDay.year === days[0].year ? "" : rangeEndDay.year + "年 ")
    + rangeEndDay.month + "月" + rangeEndDay.date + "日";
  const todayIso = currentLocalDate();

  const changeView = (mode: "members" | "projects") => {
    setViewMode(mode);
    setFilter("すべて");
  };

  const markUnsaved = () => {
    unsavedRef.current += 1;
    setUnsavedChanges((count) => count + 1);
  };

  const updateSaveOutcomePending = (pending: boolean) => {
    saveOutcomeUncertainRef.current = pending;
    setSaveOutcomePending(pending);
  };

  const confirmWorkspaceExit = () => {
    if (accountActionLocked) {
      setToast("同期処理が終わってから組織の切替や退出を行ってください");
      return false;
    }
    return (unsavedChanges === 0 && !formDirty) || window.confirm("未保存の変更があります。このまま続けると変更が失われる場合があります。続けますか？");
  };

  const openOperations = () => {
    if (confirmWorkspaceExit()) onOpenOperations?.();
  };

  const signOut = () => {
    if (confirmWorkspaceExit()) onSignOut?.();
  };

  const openProject = (projectId: string) => {
    setSelectedProjectId(projectId);
    setDrawer("project");
  };

  const openMember = (memberId: string) => {
    setSelectedMemberId(memberId);
    setDrawer("member");
  };

  const currentShareHref = (link: Parameters<typeof buildShareHref>[1]) => buildShareHref(window.location, link);

  const copyShareLink = async (link: Parameters<typeof buildShareHref>[1], success = "リンクをコピーしました") => {
    try {
      await copyText(currentShareHref(link));
      setToast(success);
    } catch {
      setToast("リンクをコピーできませんでした");
    }
  };

  const toggleFavoriteTarget = async (kind: FavoriteKind, targetId: string) => {
    if ((permissions?.disabledFeatures ?? []).includes("favorites")) {
      setToast("お気に入りはこの権限では利用できません");
      return;
    }
    const current = favoritesRef.current;
    const next = toggleFavorite(current, kind, targetId);
    const favorite = isFavorited(next, kind, targetId);
    setFavorites(next);
    if (mode === "demo") {
      writeDemoFavorites(next);
      return;
    }
    if (!shared?.setFavorite) return;
    try {
      const saved = await shared.setFavorite(kind, targetId, favorite);
      setFavorites(saved);
    } catch {
      setFavorites(current);
      setToast("お気に入りを更新できませんでした");
    }
  };

  const addMemberToProposal = (memberId: string) => {
    setProposalMemberIds((current) => retainedMemberIds([...current, memberId], workspace.members.map((member) => member.id)));
    setActiveNav("proposal");
    closeDrawer();
    setToast("提案ビューに追加しました");
  };

  const openStaffingNeed = (needId: string) => {
    const need = workspace.needs.find((item) => item.id === needId);
    if (!need) {
      setToast("要員要件が更新されました。最新の一覧から選び直してください");
      return;
    }
    setSelectedNeedId(need.id);
    setDrawer("openRole");
    setNotificationsOpen(false);
  };

  const openOpportunity = (opportunityId: string) => {
    const opportunity = opportunityById(workspace, opportunityId);
    if (!opportunity) {
      setToast("受注前案件が更新されました。最新の一覧から選び直してください");
      return;
    }
    setSelectedOpportunityId(opportunity.id);
    setSelectedOpportunityNeedId(opportunityNeedsFor(workspace, opportunity.id)[0]?.id ?? "");
    setDrawer("opportunity");
    setNotificationsOpen(false);
  };

  const openMemberEditor = (member: Member) => {
    if (!canManageMembers) return;
    setSelectedMemberId(member.id);
    setMemberEditForm(memberFormFrom(workspace, member));
    setDrawer("editMember");
  };

  const openProjectEditor = (project: Project) => {
    if (!canEdit) return;
    setSelectedProjectId(project.id);
    setProjectEditForm({
      name: project.name,
      summary: project.summary,
      status: project.status,
      ownerId: project.ownerPersonId ?? workspace.members.find((member) => member.name === project.ownerName)?.id ?? workspace.members[0]?.id ?? "",
      startDate: project.startDate,
      endDate: project.endDate,
      nextMilestone: project.nextMilestone,
      nextMilestoneDate: project.nextMilestoneDate ?? "",
      progress: String(project.progress),
      demand: String(project.demand),
      customValues: { ...(project.customValues ?? {}) },
    });
    setDrawer("editProject");
  };

  const openNeedCreator = (projectId: string) => {
    if (!canEdit) return;
    const project = projectById(workspace, projectId);
    if (!project) {
      setToast("先にプロジェクトを登録してください");
      return;
    }
    setEditingNeedId(null);
    setNeedForm({
      projectId: project.id,
      role: "Frontend Engineer",
      skills: "",
      startDate: project.startDate,
      endDate: project.endDate,
      allocation: "40",
    });
    setDrawer("needForm");
  };

  const openNeedEditor = (need: StaffingNeed) => {
    if (!canEdit) return;
    setSelectedNeedId(need.id);
    setEditingNeedId(need.id);
    setNeedForm({
      projectId: need.projectId,
      role: need.role,
      skills: formatSkillInput(needSkillRequirements(need).map((requirement) => ({ name: requirement.name, proficiency: requirement.minProficiency }))),
      startDate: need.startDate,
      endDate: need.endDate,
      allocation: String(need.allocation),
    });
    setDrawer("needForm");
  };

  const openAssignment = (assignmentId: string) => {
    const assignment = workspace.assignments.find((item) => item.id === assignmentId);
    if (!assignment) return;
    setSelectedAssignmentId(assignment.id);
    setAssignmentEditForm({
      personId: assignment.personId,
      projectId: assignment.projectId,
      startDate: assignment.startDate,
      endDate: assignment.endDate,
      allocation: String(assignment.allocation),
    });
    setDrawer("assignment");
  };

  const openNewAssignment = (memberId?: string, projectId?: string) => {
    if (!canEdit) return;
    setForm((current) => {
      const resolvedProject = projectById(workspace, projectId ?? current.projectId) ?? workspace.projects[0];
      const visibleWeekStart = days[0].iso;
      const startDate = resolvedProject && visibleWeekStart >= resolvedProject.startDate && visibleWeekStart <= resolvedProject.endDate ? visibleWeekStart : resolvedProject?.startDate ?? visibleWeekStart;
      const suggestedEndDate = addDays(startDate, 4);
      return {
        ...current,
        personId: memberById(workspace, memberId ?? current.personId)?.id ?? workspace.members[0]?.id ?? "",
        projectId: resolvedProject?.id ?? "",
        startDate,
        endDate: resolvedProject && suggestedEndDate > resolvedProject.endDate ? resolvedProject.endDate : suggestedEndDate,
      };
    });
    setDrawer("add");
  };

  const openAssignmentFor = (memberId: string) => openNewAssignment(memberId);

  const selectAssignmentProject = (projectId: string) => {
    const project = projectById(workspace, projectId);
    if (!project) return;
    const startDate = form.startDate >= project.startDate && form.startDate <= project.endDate ? form.startDate : project.startDate;
    const currentEndDate = form.endDate >= startDate && form.endDate <= project.endDate ? form.endDate : addDays(startDate, 4);
    setForm({ ...form, projectId: project.id, startDate, endDate: currentEndDate > project.endDate ? project.endDate : currentEndDate });
  };

  const handleAddAssignment = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canAddAssignment || !memberById(workspace, form.personId) || !projectById(workspace, form.projectId)) {
      setToast("先にメンバーとプロジェクトを登録してください");
      return;
    }
    const project = projectById(workspace, form.projectId);
    const allocation = Number(form.allocation);
    if (!project || !form.startDate || !form.endDate || form.endDate < form.startDate) {
      setToast("アサインの終了日は開始日以降に設定してください");
      return;
    }
    if (form.startDate < project.startDate || form.endDate > project.endDate) {
      setToast("アサイン期間はプロジェクト期間内に設定してください");
      return;
    }
    if (!Number.isFinite(allocation) || allocation <= 0 || allocation > 100) {
      setToast("稼働配分は1〜100%で設定してください");
      return;
    }
    const assignment: Assignment = {
      id: newId(),
      personId: form.personId,
      projectId: form.projectId,
      startDate: form.startDate,
      endDate: form.endDate,
      allocation,
      status: "draft",
    };
    setWorkspace((current) => ({ ...current, assignments: [...current.assignments, assignment] }));
    markUnsaved();
    closeDrawer();
    setToast((memberById(workspace, form.personId)?.name || "メンバー") + "さんへ仮置きしました");
  };

  const handleEditAssignment = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canEdit || !selectedAssignment) return;
    const allocation = Number(assignmentEditForm.allocation);
    const editedProject = projectById(workspace, assignmentEditForm.projectId);
    if (!memberById(workspace, assignmentEditForm.personId) || !editedProject) {
      setToast("メンバーまたはプロジェクトを選び直してください");
      return;
    }
    if (!assignmentEditForm.startDate || !assignmentEditForm.endDate || assignmentEditForm.endDate < assignmentEditForm.startDate) {
      setToast("終了日は開始日以降に設定してください");
      return;
    }
    if (assignmentEditForm.startDate < editedProject.startDate || assignmentEditForm.endDate > editedProject.endDate) {
      setToast("アサイン期間はプロジェクト期間内に設定してください");
      return;
    }
    if (!Number.isFinite(allocation) || allocation <= 0 || allocation > 100) {
      setToast("稼働配分は1〜100%で設定してください");
      return;
    }
    const changed = selectedAssignment.personId !== assignmentEditForm.personId
      || selectedAssignment.projectId !== assignmentEditForm.projectId
      || selectedAssignment.startDate !== assignmentEditForm.startDate
      || selectedAssignment.endDate !== assignmentEditForm.endDate
      || selectedAssignment.allocation !== allocation;
    if (!changed) {
      closeDrawer();
      setToast("アサインの変更はありません");
      return;
    }
    const linkedNeed = selectedAssignment.staffingNeedId
      ? workspace.needs.find((need) => need.id === selectedAssignment.staffingNeedId)
      : undefined;
    const stillFulfillsNeed = Boolean(linkedNeed && assignmentStillFulfillsNeed(
      workspace,
      linkedNeed,
      assignmentEditForm,
      allocation,
    ));
    const detachFromNeed = Boolean(selectedAssignment.staffingNeedId && !stillFulfillsNeed);
    const editedAssignment: Assignment = {
      ...selectedAssignment,
      personId: assignmentEditForm.personId,
      projectId: assignmentEditForm.projectId,
      startDate: assignmentEditForm.startDate,
      endDate: assignmentEditForm.endDate,
      allocation,
      status: "draft",
    };
    const nextAssignment: Assignment = detachFromNeed ? {
      ...editedAssignment,
      staffingNeedId: null,
      clientRequestId: null,
    } : editedAssignment;
    setWorkspace((current) => ({
      ...current,
      assignments: current.assignments.map((assignment) => assignment.id === selectedAssignment.id ? nextAssignment : assignment),
      needs: linkedNeed ? current.needs.map((need) => need.id === linkedNeed.id ? {
        ...need,
        status: stillFulfillsNeed ? need.status : "open",
        draftPersonId: stillFulfillsNeed ? assignmentEditForm.personId : null,
      } : need) : current.needs,
    }));
    markUnsaved();
    setSelectedAssignmentId(nextAssignment.id);
    closeDrawer();
    setToast(detachFromNeed && linkedNeed ? "アサインを変更し、元の不足ロールを再オープンしました" : "アサインの変更を仮置きしました");
  };

  const removeAssignment = () => {
    if (!canEdit || !selectedAssignment) return;
    const persisted = selectedAssignmentIsPersisted;
    const confirmed = window.confirm(persisted
      ? "このアサインを取消予定にします。チームへ保存するまで元に戻せます。続けますか？"
      : "この仮置きを削除します。続けますか？");
    if (!confirmed) return;
    const nextWorkspace: WorkspaceState = {
      ...workspace,
      assignments: workspace.assignments.filter((assignment) => assignment.id !== selectedAssignment.id),
      needs: selectedAssignment.staffingNeedId ? workspace.needs.map((need) => {
        if (need.id !== selectedAssignment.staffingNeedId) return need;
        return { ...need, status: "open", draftPersonId: null };
      }) : workspace.needs,
    };
    setWorkspace(nextWorkspace);
    if (persisted) {
      markUnsaved();
    } else {
      const nextCount = JSON.stringify(nextWorkspace) === JSON.stringify(committedWorkspace) ? 0 : Math.max(1, unsavedChanges - 1);
      unsavedRef.current = nextCount;
      setUnsavedChanges(nextCount);
    }
    setSelectedAssignmentId("");
    closeDrawer();
    setToast(persisted ? "アサインを取消予定にしました" : "仮置きを削除しました");
  };

  const resolveOverload = () => {
    if (!canEdit || !overloadMember || overloadAssignments.length === 0) return;
    const allocations = new Map(workspace.assignments.filter((assignment) => assignment.personId === overloadMember.id).map((assignment) => [assignment.id, assignment.allocation]));
    const reductions = new Map<string, number>();
    for (const day of memberDailyLoads(workspace, overloadMember.id, currentWeekStart, weekEnd(currentWeekStart))) {
      const activeAssignments = workspace.assignments
        .filter((assignment) => assignment.personId === overloadMember.id && assignment.startDate <= day.date && assignment.endDate >= day.date)
        .sort((a, b) => (allocations.get(a.id) ?? 0) - (allocations.get(b.id) ?? 0));
      let remaining = Math.max(0, activeAssignments.reduce((sum, assignment) => sum + (allocations.get(assignment.id) ?? 0), 0) - overloadMember.capacity);
      for (const assignment of activeAssignments) {
        if (remaining <= 0) break;
        const currentAllocation = allocations.get(assignment.id) ?? 0;
        const reduction = Math.min(currentAllocation, remaining);
        allocations.set(assignment.id, currentAllocation - reduction);
        reductions.set(assignment.id, (reductions.get(assignment.id) ?? 0) + reduction);
        remaining -= reduction;
      }
    }
    const reduced = Array.from(reductions.values()).reduce((sum, reduction) => sum + reduction, 0);
    if (reduced === 0) {
      setToast(overloadMember.name + "さんの超過はすでに解消予定です");
      return;
    }
    const reopenedNeedIds = new Set<string>();
    const assignments = workspace.assignments.flatMap((assignment) => {
      const reduction = reductions.get(assignment.id) ?? 0;
      if (reduction === 0) return [assignment];
      const allocation = Math.max(0, assignment.allocation - reduction);
      const linkedNeed = assignment.staffingNeedId ? workspace.needs.find((need) => need.id === assignment.staffingNeedId) : undefined;
      if (linkedNeed && allocation < linkedNeed.allocation) reopenedNeedIds.add(linkedNeed.id);
      if (allocation === 0) return [];
      return [{
        ...assignment,
        allocation,
        status: "draft" as const,
        ...(linkedNeed && allocation < linkedNeed.allocation ? { staffingNeedId: null, clientRequestId: null } : {}),
      }];
    });
    setWorkspace({
      ...workspace,
      assignments,
      needs: workspace.needs.map((need) => reopenedNeedIds.has(need.id) ? { ...need, status: "open", draftPersonId: null } : need),
    });
    markUnsaved();
    closeDrawer();
    setToast(overloadMember.name + "さんの案件配分を合計" + reduced + "%減らしました");
  };

  const placeCandidate = (personId: string, need: StaffingNeed) => {
    if (!canEdit) return;
    if (need.status !== "open") {
      setToast("この不足ロールはすでに解消予定です");
      return;
    }
    const assignment: Assignment = {
      id: newId(),
      personId,
      projectId: need.projectId,
      startDate: need.startDate,
      endDate: need.endDate,
      allocation: need.allocation,
      status: "draft",
      staffingNeedId: need.id,
      clientRequestId: newId(),
    };
    setWorkspace((current) => ({
      ...current,
      assignments: [...current.assignments, assignment],
      needs: current.needs.map((item) => item.id === need.id ? { ...item, status: "planned", draftPersonId: personId } : item),
    }));
    markUnsaved();
    closeDrawer();
    setToast((memberById(workspace, personId)?.name || "候補者") + "さんを" + formatDate(need.startDate) + "から" + need.allocation + "%で仮置きしました");
  };

  const undoChanges = () => {
    if (operationLocked) return;
    setWorkspace(cloneState(committedWorkspace));
    setPendingSave(null);
    updateSaveOutcomePending(false);
    setUnsavedChanges(0);
    unsavedRef.current = 0;
    setSyncError("");
    clearFormDraft();
    if (syncStatus !== "conflict") setSyncStatus("idle");
    setToast("未保存の変更だけを元に戻しました");
    drainPendingRefresh();
  };

  const saveChanges = async () => {
    if (!hasEditPermission || operationLocked || unsavedChanges === 0 || saveBusyRef.current || syncBusyRef.current) return;
    let deferPendingRefresh = false;
    const count = unsavedChanges;
    const saved: WorkspaceState = {
      ...workspace,
      assignments: workspace.assignments.map((assignment) => assignment.status === "draft" ? { ...assignment, status: "confirmed" } : assignment),
      needs: workspace.needs.map((need) => need.status === "planned" ? { ...need, status: "filled" } : need),
    };
    saveBusyRef.current = true;
    setSyncStatus("saving");
    setSyncError("");
    setSyncRetryable(true);
    try {
      if (mode === "shared" && shared) {
        const snapshot = JSON.stringify(saved);
        const saveRequest = pendingSave?.snapshot === snapshot ? pendingSave : { requestId: newId(), snapshot };
        if (saveRequest !== pendingSave) setPendingSave(saveRequest);
        const result = await shared.save(saved, revisionRef.current, saveRequest.requestId);
        revisionRef.current = result.revision;
        setRevision(result.revision);
        setToast(count + "件の変更をチームへ保存しました");
      } else {
        window.localStorage.setItem(storageKey, JSON.stringify(saved));
        setToast(count + "件の変更をデモ環境へ保存しました");
      }
      setWorkspace(saved);
      setCommittedWorkspace(cloneState(saved));
      setPendingSave(null);
      updateSaveOutcomePending(false);
      setUnsavedChanges(0);
      unsavedRef.current = 0;
      clearFormDraft();
      setSyncStatus("idle");
    } catch (error) {
      const message = error instanceof Error ? error.message : "保存に失敗しました";
      const code = typeof error === "object" && error !== null && "code" in error ? String(error.code) : "";
      if (code === "FORBIDDEN") onAccessInvalidated?.();
      if (code === "WORKSPACE_CONFLICT" || /conflict|revision|競合|他のユーザーが先に更新/i.test(message)) {
        updateSaveOutcomePending(false);
        setSyncStatus("conflict");
        setSyncError("別のユーザーが先に更新しました。下書きは保持されています。");
      } else {
        const retryable = !(typeof error === "object" && error !== null && "retryable" in error && error.retryable === false);
        updateSaveOutcomePending(retryable);
        deferPendingRefresh = retryable;
        setSyncStatus("error");
        setSyncError(message);
        setSyncRetryable(retryable);
      }
    } finally {
      saveBusyRef.current = false;
      if (!deferPendingRefresh) drainPendingRefresh();
    }
  };

  const discardAndReloadShared = async () => {
    if (!shared || saveBusyRef.current || syncBusyRef.current) return;
    updateSaveOutcomePending(false);
    syncBusyRef.current = true;
    setSyncStatus("refreshing");
    setSyncError("");
    try {
      const latest = await shared.reload();
      if (latest.permissions) setPermissions(latest.permissions);
      revisionRef.current = latest.revision;
      setRevision(latest.revision);
      setWorkspace(cloneState(latest.state));
      setCommittedWorkspace(cloneState(latest.state));
      setPendingSave(null);
      setUnsavedChanges(0);
      unsavedRef.current = 0;
      clearFormDraft();
      setDrawer(null);
      setSyncStatus("idle");
      setToast("共有版を再読み込みしました");
    } catch (error) {
      if (typeof error === "object" && error !== null && "code" in error && error.code === "FORBIDDEN") onAccessInvalidated?.();
      setSyncStatus("error");
      setSyncError(error instanceof Error ? error.message : "共有版の再読み込みに失敗しました");
    } finally {
      syncBusyRef.current = false;
      drainPendingRefresh();
    }
  };

  const handleCreateProject = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canEdit) return;
    const owner = memberById(workspace, projectForm.ownerId) || workspace.members[0];
    if (!owner) {
      setToast("先に責任者となるメンバーを登録してください");
      return;
    }
    const id = newId();
    const project: Project = {
      id,
      code: createProjectCode(projectForm.name, id),
      name: projectForm.name,
      summary: "新しく追加したプロジェクト",
      status: projectForm.status,
      tone: "blue",
      ownerPersonId: owner.id,
      ownerName: owner.name,
      ownerInitials: owner.initials,
      startDate: days[0].iso,
      endDate: projectForm.endDate,
      nextMilestone: "キックオフ",
      nextMilestoneDate: days[0].iso,
      progress: 0,
      demand: 3,
    };
    setWorkspace((current) => ({ ...current, projects: [...current.projects, project] }));
    setForm((current) => ({ ...current, projectId: projectById(workspace, current.projectId)?.id ?? id }));
    markUnsaved();
    setProjectForm({ name: "", status: "準備中", endDate: addDays(getWeekStart(0), 90), ownerId: owner.id });
    closeDrawer();
    setToast(project.name + "を追加しました");
  };

  const handleCreateMember = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canManageMembers) return;
    const capacity = Number(memberForm.capacity);
    const name = memberForm.name.trim();
    if (!name) {
      setToast("氏名を入力してください");
      return;
    }
    if (!Number.isFinite(capacity) || capacity < 0 || capacity > 100) {
      setToast("稼働上限は0〜100%で設定してください");
      return;
    }
    const id = newId();
    const skillLevels = parseSkillInput(memberForm.skills);
    let customValues: Record<string, string>;
    let workHistory: WorkHistoryEntry[];
    try {
      customValues = normalizeCustomValues(workspace.customFields, "member", memberForm.customValues);
      workHistory = normalizeWorkHistory(memberForm.workHistory.filter((entry) => entry.title.trim() && entry.organization.trim() && entry.startDate));
    } catch (caught) {
      setToast(caught instanceof Error ? caught.message : "入力内容を確認してください");
      return;
    }
    const primaryUnit = (workspace.orgUnits ?? []).find((unit) => unit.id === memberForm.primaryUnitId);
    try {
      setWorkspace((current) => applyMemberOrg(hydrateWorkspaceSkills({
        ...current,
        members: [...current.members, {
          id,
          initials: makeInitials(name),
          name,
          role: memberForm.role,
          department: primaryUnit?.name ?? memberForm.department,
          avatarTone: "lavender",
          skills: skillLevels.map((level) => level.name),
          skillLevels,
          location: memberForm.location,
          capacity,
          customValues,
          workHistory,
        }],
      }), id, memberForm));
    } catch (caught) {
      setToast(caught instanceof Error ? caught.message : "所属を保存できませんでした");
      return;
    }
    setForm((current) => ({ ...current, personId: memberById(workspace, current.personId)?.id ?? id }));
    setProjectForm((current) => ({ ...current, ownerId: memberById(workspace, current.ownerId)?.id ?? id }));
    markUnsaved();
    setMemberForm(emptyMemberForm(workspace));
    closeDrawer();
    setToast("新しいメンバーを追加しました");
  };

  const handleEditMember = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canManageMembers || !selectedMember) return;
    const name = memberEditForm.name.trim();
    const capacity = Number(memberEditForm.capacity);
    if (!name) {
      setToast("氏名を入力してください");
      return;
    }
    if (!Number.isFinite(capacity) || capacity < 0 || capacity > 100) {
      setToast("稼働上限は0〜100%で設定してください");
      return;
    }
    const skillLevels = parseSkillInput(memberEditForm.skills);
    let customValues: Record<string, string>;
    let workHistory: WorkHistoryEntry[];
    try {
      customValues = normalizeCustomValues(workspace.customFields, "member", memberEditForm.customValues);
      workHistory = normalizeWorkHistory(memberEditForm.workHistory.filter((entry) => entry.title.trim() && entry.organization.trim() && entry.startDate));
    } catch (caught) {
      setToast(caught instanceof Error ? caught.message : "入力内容を確認してください");
      return;
    }
    const primaryUnit = (workspace.orgUnits ?? []).find((unit) => unit.id === memberEditForm.primaryUnitId);
    const updatedMember: Member = {
      ...selectedMember,
      initials: makeInitials(name),
      name,
      role: memberEditForm.role.trim(),
      department: primaryUnit?.name ?? memberEditForm.department.trim(),
      location: memberEditForm.location.trim(),
      skills: skillLevels.map((level) => level.name),
      skillLevels,
      capacity,
      customValues,
      workHistory,
    };
    const members = workspace.members.map((member) => member.id === updatedMember.id ? updatedMember : member);
    let memberState: WorkspaceState;
    try {
      memberState = applyMemberOrg(hydrateWorkspaceSkills({ ...workspace, members }), updatedMember.id, memberEditForm);
    } catch (caught) {
      setToast(caught instanceof Error ? caught.message : "所属を保存できませんでした");
      return;
    }
    const reopenedNeedIds = new Set<string>();
    workspace.needs.forEach((need) => {
      if (need.draftPersonId === updatedMember.id && (!memberMatchesNeed(updatedMember, need) || capacity < need.allocation)) {
        reopenedNeedIds.add(need.id);
      }
    });
    workspace.assignments.forEach((assignment) => {
      if (assignment.personId !== updatedMember.id || !assignment.staffingNeedId) return;
      const need = workspace.needs.find((item) => item.id === assignment.staffingNeedId);
      if (need && (!assignmentMatchesNeed(memberState, assignment, need) || capacity < assignment.allocation)) reopenedNeedIds.add(need.id);
    });
    const nextWorkspace: WorkspaceState = {
      ...memberState,
      projects: memberState.projects.map((project) => project.ownerPersonId === updatedMember.id || (!project.ownerPersonId && project.ownerName === selectedMember.name) ? {
        ...project,
        ownerPersonId: updatedMember.id,
        ownerName: updatedMember.name,
        ownerInitials: updatedMember.initials,
      } : project),
      assignments: workspace.assignments.filter((assignment) => !assignment.staffingNeedId || !reopenedNeedIds.has(assignment.staffingNeedId)),
      needs: workspace.needs.map((need) => reopenedNeedIds.has(need.id) ? { ...need, status: "open", draftPersonId: null } : need),
    };
    if (JSON.stringify(nextWorkspace) === JSON.stringify(workspace)) {
      clearFormDraft();
      setDrawer("member");
      setToast("メンバー情報の変更はありません");
      return;
    }
    setWorkspace(nextWorkspace);
    markUnsaved();
    clearFormDraft();
    setDrawer("member");
    setToast(reopenedNeedIds.size > 0 ? "メンバー情報を更新し、満たせない要員要件を再オープンしました" : "メンバー情報を更新しました");
  };

  const archiveMember = () => {
    if (!canManageMembers || !selectedMember) return;
    const ownedProjects = workspace.projects.filter((project) => project.ownerPersonId === selectedMember.id || (!project.ownerPersonId && project.ownerName === selectedMember.name));
    if (ownedProjects.length > 0) {
      setToast(`責任者になっている案件（${ownedProjects[0].name}）を別メンバーへ変更してからアーカイブしてください`);
      return;
    }
    if (!window.confirm(`${selectedMember.name}さんをアーカイブします。関連するアサインは取消予定になり、要員要件は再オープンされます。続けますか？`)) return;
    const removedAssignments = workspace.assignments.filter((assignment) => assignment.personId === selectedMember.id);
    const reopenedNeedIds = new Set(removedAssignments.flatMap((assignment) => assignment.staffingNeedId ? [assignment.staffingNeedId] : []));
    workspace.needs.forEach((need) => {
      if (need.draftPersonId === selectedMember.id) reopenedNeedIds.add(need.id);
    });
    const nextWorkspace: WorkspaceState = {
      ...workspace,
      members: workspace.members.filter((member) => member.id !== selectedMember.id),
      assignments: workspace.assignments.filter((assignment) => assignment.personId !== selectedMember.id),
      needs: workspace.needs.map((need) => reopenedNeedIds.has(need.id) ? { ...need, status: "open", draftPersonId: null } : need),
    };
    setWorkspace(nextWorkspace);
    setForm((current) => ({ ...current, personId: nextWorkspace.members[0]?.id ?? "" }));
    setProjectForm((current) => ({ ...current, ownerId: nextWorkspace.members[0]?.id ?? "" }));
    setSelectedMemberId(nextWorkspace.members[0]?.id ?? "");
    markUnsaved();
    closeDrawer();
    setToast("メンバーをアーカイブ予定にしました");
  };

  const handleEditProject = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canEdit || !selectedProject) return;
    const owner = memberById(workspace, projectEditForm.ownerId);
    const progress = Number(projectEditForm.progress);
    const demand = Number(projectEditForm.demand);
    if (!projectEditForm.name.trim() || !owner) {
      setToast("プロジェクト名と責任者を確認してください");
      return;
    }
    if (!projectEditForm.startDate || !projectEditForm.endDate || projectEditForm.endDate < projectEditForm.startDate) {
      setToast("プロジェクトの終了日は開始日以降に設定してください");
      return;
    }
    if (projectEditForm.nextMilestoneDate && (projectEditForm.nextMilestoneDate < projectEditForm.startDate || projectEditForm.nextMilestoneDate > projectEditForm.endDate)) {
      setToast("次のマイルストーン日はプロジェクト期間内に設定してください");
      return;
    }
    if (!Number.isFinite(progress) || progress < 0 || progress > 100 || !Number.isInteger(demand) || demand < 0 || demand > 10000) {
      setToast("進捗は0〜100%、必要人数は0〜10000名で設定してください");
      return;
    }
    let customValues: Record<string, string>;
    try {
      customValues = normalizeCustomValues(workspace.customFields, "project", projectEditForm.customValues);
    } catch (caught) {
      setToast(caught instanceof Error ? caught.message : "独自項目を確認してください");
      return;
    }
    const updatedProject: Project = {
      ...selectedProject,
      name: projectEditForm.name.trim(),
      summary: projectEditForm.summary.trim(),
      status: projectEditForm.status,
      ownerPersonId: owner.id,
      ownerName: owner.name,
      ownerInitials: owner.initials,
      startDate: projectEditForm.startDate,
      endDate: projectEditForm.endDate,
      nextMilestone: projectEditForm.nextMilestone.trim(),
      nextMilestoneDate: projectEditForm.nextMilestoneDate || null,
      progress,
      demand,
      customValues,
    };
    const removedNeedIds = new Set(workspace.needs.filter((need) => need.projectId === updatedProject.id && (need.startDate < updatedProject.startDate || need.endDate > updatedProject.endDate)).map((need) => need.id));
    const removedAssignmentIds = new Set(workspace.assignments.filter((assignment) => assignment.projectId === updatedProject.id && (assignment.startDate < updatedProject.startDate || assignment.endDate > updatedProject.endDate)).map((assignment) => assignment.id));
    const reopenedNeedIds = new Set<string>();
    workspace.assignments.forEach((assignment) => {
      if (removedAssignmentIds.has(assignment.id) && assignment.staffingNeedId && !removedNeedIds.has(assignment.staffingNeedId)) reopenedNeedIds.add(assignment.staffingNeedId);
      if (assignment.staffingNeedId && removedNeedIds.has(assignment.staffingNeedId)) removedAssignmentIds.add(assignment.id);
    });
    const nextWorkspace: WorkspaceState = {
      ...workspace,
      projects: workspace.projects.map((project) => project.id === updatedProject.id ? updatedProject : project),
      assignments: workspace.assignments.filter((assignment) => !removedAssignmentIds.has(assignment.id)),
      needs: workspace.needs.filter((need) => !removedNeedIds.has(need.id)).map((need) => reopenedNeedIds.has(need.id) ? { ...need, status: "open", draftPersonId: null } : need),
    };
    if (JSON.stringify(nextWorkspace) === JSON.stringify(workspace)) {
      clearFormDraft();
      setDrawer("project");
      setToast("プロジェクト情報の変更はありません");
      return;
    }
    setWorkspace(nextWorkspace);
    markUnsaved();
    clearFormDraft();
    setDrawer("project");
    setToast(removedNeedIds.size + removedAssignmentIds.size > 0 ? "案件情報を更新し、期間外のアサイン・要員要件を取消予定にしました" : "プロジェクト情報を更新しました");
  };

  const archiveProject = () => {
    if (!canEdit || !selectedProject) return;
    if (!window.confirm(`${selectedProject.name}をアーカイブします。関連するアサインと要員要件も取消予定になります。続けますか？`)) return;
    const nextWorkspace: WorkspaceState = {
      ...workspace,
      projects: workspace.projects.filter((project) => project.id !== selectedProject.id),
      assignments: workspace.assignments.filter((assignment) => assignment.projectId !== selectedProject.id),
      needs: workspace.needs.filter((need) => need.projectId !== selectedProject.id),
    };
    setWorkspace(nextWorkspace);
    setForm((current) => ({ ...current, projectId: nextWorkspace.projects[0]?.id ?? "" }));
    setNeedForm((current) => ({ ...current, projectId: nextWorkspace.projects[0]?.id ?? "" }));
    setSelectedProjectId(nextWorkspace.projects[0]?.id ?? "");
    markUnsaved();
    closeDrawer();
    setToast("プロジェクトをアーカイブ予定にしました");
  };

  const handleSaveNeed = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canEdit) return;
    const project = projectById(workspace, needForm.projectId);
    const allocation = Number(needForm.allocation);
    const roleName = needForm.role.trim();
    if (!project || !roleName) {
      setToast("プロジェクトと必要ロールを確認してください");
      return;
    }
    if (!needForm.startDate || !needForm.endDate || needForm.endDate < needForm.startDate) {
      setToast("要員要件の終了日は開始日以降に設定してください");
      return;
    }
    if (needForm.startDate < project.startDate || needForm.endDate > project.endDate) {
      setToast("要員要件の期間はプロジェクト期間内に設定してください");
      return;
    }
    if (!Number.isFinite(allocation) || allocation <= 0 || allocation > 100) {
      setToast("必要配分は1〜100%で設定してください");
      return;
    }
    const existing = editingNeedId ? workspace.needs.find((need) => need.id === editingNeedId) : undefined;
    const skillRequirements = parseSkillInput(needForm.skills, 1).map((item) => ({ name: item.name, minProficiency: item.proficiency }));
    const nextNeed: StaffingNeed = {
      id: existing?.id ?? newId(),
      projectId: project.id,
      role: roleName,
      skills: skillRequirements.map((item) => item.name),
      skillRequirements,
      startDate: needForm.startDate,
      endDate: needForm.endDate,
      allocation,
      status: existing?.status ?? "open",
      draftPersonId: existing?.draftPersonId ?? null,
    };
    const withEditedNeed: WorkspaceState = hydrateWorkspaceSkills({
      ...workspace,
      needs: existing ? workspace.needs.map((need) => need.id === existing.id ? nextNeed : need) : [...workspace.needs, nextNeed],
    });
    const linkedAssignments = existing ? workspace.assignments.filter((assignment) => assignment.staffingNeedId === existing.id) : [];
    const validLinkedAssignments = linkedAssignments.filter((assignment) => assignmentMatchesNeed(withEditedNeed, assignment, nextNeed));
    const invalidLinkedAssignmentIds = new Set(linkedAssignments.filter((assignment) => !validLinkedAssignments.some((valid) => valid.id === assignment.id)).map((assignment) => assignment.id));
    const reconciledNeed: StaffingNeed = validLinkedAssignments.length > 0 ? {
      ...nextNeed,
      draftPersonId: validLinkedAssignments[0].personId,
    } : {
      ...nextNeed,
      status: "open",
      draftPersonId: null,
    };
    const nextWorkspace: WorkspaceState = {
      ...withEditedNeed,
      assignments: workspace.assignments.filter((assignment) => !invalidLinkedAssignmentIds.has(assignment.id)),
      needs: withEditedNeed.needs.map((need) => need.id === reconciledNeed.id ? reconciledNeed : need),
    };
    if (existing && JSON.stringify(nextWorkspace) === JSON.stringify(workspace)) {
      clearFormDraft();
      setDrawer("openRole");
      setToast("要員要件の変更はありません");
      return;
    }
    setWorkspace(nextWorkspace);
    setSelectedNeedId(reconciledNeed.id);
    markUnsaved();
    clearFormDraft();
    setDrawer("openRole");
    setToast(invalidLinkedAssignmentIds.size > 0 ? "要員要件を更新し、条件を満たさないアサインを取消予定にしました" : existing ? "要員要件を更新しました" : "要員要件を追加しました");
  };

  const cancelNeed = () => {
    if (!canEdit || !selectedNeed) return;
    if (!window.confirm(`${selectedNeed.role}の要員要件を取り消します。紐づくアサインも取消予定になります。続けますか？`)) return;
    const nextWorkspace: WorkspaceState = {
      ...workspace,
      assignments: workspace.assignments.filter((assignment) => assignment.staffingNeedId !== selectedNeed.id),
      needs: workspace.needs.filter((need) => need.id !== selectedNeed.id),
    };
    setWorkspace(nextWorkspace);
    setSelectedNeedId(nextWorkspace.needs[0]?.id ?? "");
    markUnsaved();
    closeDrawer();
    setToast("要員要件を取消予定にしました");
  };

  const openWeekFromReport = (offset: number) => {
    setWeekOffset(offset);
    setActiveNav("board");
    setViewMode("members");
  };

  const handleAddCatalogEntry = (input: { name: string; kind: SkillKind; parentId?: string | null }) => {
    if (!canEdit) return;
    setWorkspace((current) => ({
      ...current,
      skillCatalog: addSkillCatalogEntry(current.skillCatalog ?? [], input),
    }));
    markUnsaved();
    setToast(input.kind === "category" ? "スキル分類を追加しました" : "スキルを分類へ追加しました");
  };

  const handleAddCustomField = (input: {
    entityType: CustomFieldEntity;
    key: string;
    label: string;
    fieldType: CustomFieldType;
    required?: boolean;
    options?: string[];
    showInList?: boolean;
    showInDetail?: boolean;
    searchable?: boolean;
  }) => {
    if (!canManageMembers) throw new Error("項目定義を変更する権限がありません");
    const customFields = addCustomField(workspace.customFields ?? [], input);
    setWorkspace((current) => ({ ...current, customFields }));
    markUnsaved();
    setToast("独自項目を追加しました");
  };

  const handleCreateOpportunity = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canEdit) return;
    const owner = memberById(workspace, opportunityForm.ownerId) || workspace.members[0];
    const name = opportunityForm.name.trim();
    const demand = Number(opportunityForm.demand);
    if (!name) {
      setToast("案件名を入力してください");
      return;
    }
    if (!owner) {
      setToast("先に責任者となるメンバーを登録してください");
      return;
    }
    if (!opportunityForm.startDate || !opportunityForm.endDate || opportunityForm.endDate < opportunityForm.startDate) {
      setToast("想定期間の終了日は開始日以降に設定してください");
      return;
    }
    if (!Number.isInteger(demand) || demand < 0 || demand > 10000) {
      setToast("必要人数は0〜10000で設定してください");
      return;
    }
    const id = newId();
    const opportunity: Opportunity = {
      id,
      code: createProjectCode(name, id),
      name,
      summary: opportunityForm.summary.trim() || "新しく追加した受注前案件",
      stage: opportunityForm.stage,
      tone: "sky",
      ownerPersonId: owner.id,
      ownerName: owner.name,
      ownerInitials: owner.initials,
      startDate: opportunityForm.startDate,
      endDate: opportunityForm.endDate,
      demand,
    };
    setWorkspace((current) => ({ ...current, opportunities: [...(current.opportunities ?? []), opportunity] }));
    setSelectedOpportunityId(id);
    setOpportunityNeedForm((current) => ({ ...current, opportunityId: id, startDate: opportunity.startDate, endDate: opportunity.endDate }));
    markUnsaved();
    setOpportunityForm({ name: "", summary: "", stage: "inquiry", ownerId: owner.id, startDate: getWeekStart(0), endDate: addDays(getWeekStart(0), 90), demand: "3" });
    closeDrawer();
    setToast(opportunity.name + "を追加しました");
  };

  const openOpportunityEditor = (opportunity: Opportunity) => {
    if (!canEdit || !isActiveOpportunity(opportunity)) return;
    setSelectedOpportunityId(opportunity.id);
    setOpportunityEditForm({
      name: opportunity.name,
      summary: opportunity.summary,
      stage: opportunity.stage,
      ownerId: opportunity.ownerPersonId ?? workspace.members[0]?.id ?? "",
      startDate: opportunity.startDate,
      endDate: opportunity.endDate,
      demand: String(opportunity.demand),
    });
    setDrawer("editOpportunity");
  };

  const handleEditOpportunity = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canEdit || !selectedOpportunity || !isActiveOpportunity(selectedOpportunity)) return;
    const owner = memberById(workspace, opportunityEditForm.ownerId);
    const name = opportunityEditForm.name.trim();
    const demand = Number(opportunityEditForm.demand);
    if (!name || !owner) {
      setToast("案件名と責任者を確認してください");
      return;
    }
    if (!opportunityEditForm.startDate || !opportunityEditForm.endDate || opportunityEditForm.endDate < opportunityEditForm.startDate) {
      setToast("想定期間の終了日は開始日以降に設定してください");
      return;
    }
    if (!Number.isInteger(demand) || demand < 0 || demand > 10000) {
      setToast("必要人数は0〜10000で設定してください");
      return;
    }
    if (opportunityEditForm.stage === "won" || opportunityEditForm.stage === "lost") {
      setToast("受注と失注は専用の操作から行ってください");
      return;
    }
    const nextNeeds = opportunityNeedsFor(workspace, selectedOpportunity.id).filter((need) => need.startDate >= opportunityEditForm.startDate && need.endDate <= opportunityEditForm.endDate);
    const removedNeedIds = new Set(opportunityNeedsFor(workspace, selectedOpportunity.id).filter((need) => !nextNeeds.some((item) => item.id === need.id)).map((need) => need.id));
    setWorkspace((current) => ({
      ...current,
      opportunities: (current.opportunities ?? []).map((item) => item.id === selectedOpportunity.id ? {
        ...item,
        name,
        summary: opportunityEditForm.summary.trim(),
        stage: opportunityEditForm.stage,
        ownerPersonId: owner.id,
        ownerName: owner.name,
        ownerInitials: owner.initials,
        startDate: opportunityEditForm.startDate,
        endDate: opportunityEditForm.endDate,
        demand,
      } : item),
      opportunityNeeds: (current.opportunityNeeds ?? []).filter((need) => !removedNeedIds.has(need.id)),
    }));
    markUnsaved();
    setDrawer("opportunity");
    setToast(removedNeedIds.size > 0 ? "案件情報を更新し、期間外の要員計画を取消予定にしました" : "受注前案件を更新しました");
  };

  const archiveOpportunity = () => {
    if (!canEdit || !selectedOpportunity) return;
    if (!window.confirm(`${selectedOpportunity.name}を一覧から外します。要員計画も取消予定になります。続けますか？`)) return;
    setWorkspace((current) => ({
      ...current,
      opportunities: (current.opportunities ?? []).filter((item) => item.id !== selectedOpportunity.id),
      opportunityNeeds: (current.opportunityNeeds ?? []).filter((need) => need.opportunityId !== selectedOpportunity.id),
    }));
    setSelectedOpportunityId((workspace.opportunities ?? []).find((item) => item.id !== selectedOpportunity.id)?.id ?? "");
    markUnsaved();
    closeDrawer();
    setToast("受注前案件を取消予定にしました");
  };

  const markOpportunityLost = () => {
    if (!canEdit || !selectedOpportunity || !isActiveOpportunity(selectedOpportunity)) return;
    if (!window.confirm(`${selectedOpportunity.name}を失注にしますか？`)) return;
    setWorkspace((current) => ({
      ...current,
      opportunities: (current.opportunities ?? []).map((item) => item.id === selectedOpportunity.id ? { ...item, stage: "lost" as const } : item),
    }));
    markUnsaved();
    setToast("失注として記録しました");
  };

  const convertSelectedOpportunity = () => {
    if (!canEdit || !selectedOpportunity) return;
    if (!canConvertOpportunity(selectedOpportunity)) {
      setToast("受注できる段階ではありません");
      return;
    }
    if (!window.confirm(`${selectedOpportunity.name}をプロジェクトへ引き継ぎます。要員計画は未充足の要員要件になります。続けますか？`)) return;
    try {
      const converted = convertOpportunityToProject(workspace, selectedOpportunity.id);
      const project = converted.projects.find((item) => item.id === converted.opportunities?.find((opportunity) => opportunity.id === selectedOpportunity.id)?.convertedProjectId);
      setWorkspace(converted);
      if (project) setSelectedProjectId(project.id);
      markUnsaved();
      setDrawer("project");
      setToast("プロジェクトへ引き継ぎました");
    } catch (caught) {
      setToast(caught instanceof Error ? caught.message : "受注処理に失敗しました");
    }
  };

  const openOpportunityNeedEditor = (need?: OpportunityNeed) => {
    if (!canEdit || !selectedOpportunity || !isActiveOpportunity(selectedOpportunity)) return;
    setOpportunityNeedForm({
      opportunityId: selectedOpportunity.id,
      role: need?.role ?? "Frontend Engineer",
      skills: need ? formatSkillInput(needSkillRequirements(need).map((item) => ({ name: item.name, proficiency: item.minProficiency }))) : "",
      startDate: need?.startDate ?? selectedOpportunity.startDate,
      endDate: need?.endDate ?? selectedOpportunity.endDate,
      allocation: String(need?.allocation ?? 40),
    });
    setEditingOpportunityNeedId(need?.id ?? null);
    setDrawer("opportunityNeedForm");
  };

  const handleSaveOpportunityNeed = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canEdit) return;
    const opportunity = opportunityById(workspace, opportunityNeedForm.opportunityId);
    const allocation = Number(opportunityNeedForm.allocation);
    const roleName = opportunityNeedForm.role.trim();
    if (!opportunity || !isActiveOpportunity(opportunity) || !roleName) {
      setToast("進行中の案件と必要ロールを確認してください");
      return;
    }
    if (!opportunityNeedForm.startDate || !opportunityNeedForm.endDate || opportunityNeedForm.endDate < opportunityNeedForm.startDate) {
      setToast("要員計画の終了日は開始日以降に設定してください");
      return;
    }
    if (opportunityNeedForm.startDate < opportunity.startDate || opportunityNeedForm.endDate > opportunity.endDate) {
      setToast("要員計画の期間は案件の想定期間内に設定してください");
      return;
    }
    if (!Number.isFinite(allocation) || allocation <= 0 || allocation > 100) {
      setToast("必要配分は1〜100%で設定してください");
      return;
    }
    const existing = editingOpportunityNeedId ? (workspace.opportunityNeeds ?? []).find((need) => need.id === editingOpportunityNeedId) : undefined;
    const skillRequirements = parseSkillInput(opportunityNeedForm.skills, 1).map((item) => ({ name: item.name, minProficiency: item.proficiency }));
    const nextNeed: OpportunityNeed = {
      id: existing?.id ?? newId(),
      opportunityId: opportunity.id,
      role: roleName,
      skills: skillRequirements.map((item) => item.name),
      skillRequirements,
      startDate: opportunityNeedForm.startDate,
      endDate: opportunityNeedForm.endDate,
      allocation,
    };
    setWorkspace((current) => hydrateWorkspaceSkills({
      ...current,
      opportunityNeeds: existing
        ? (current.opportunityNeeds ?? []).map((need) => need.id === existing.id ? nextNeed : need)
        : [...(current.opportunityNeeds ?? []), nextNeed],
    }));
    setSelectedOpportunityId(opportunity.id);
    setSelectedOpportunityNeedId(nextNeed.id);
    markUnsaved();
    setDrawer("opportunity");
    setToast(existing ? "要員計画を更新しました" : "要員計画を追加しました");
  };

  const cancelOpportunityNeed = (need: OpportunityNeed) => {
    if (!canEdit) return;
    if (!window.confirm(`${need.role}の要員計画を取り消しますか？`)) return;
    setWorkspace((current) => ({
      ...current,
      opportunityNeeds: (current.opportunityNeeds ?? []).filter((item) => item.id !== need.id),
    }));
    markUnsaved();
    setToast("要員計画を取消予定にしました");
  };

  const handleAddOrgUnit = (input: { name: string; parentId?: string | null }) => {
    if (!canManageMembers) throw new Error("組織階層を変更する権限がありません");
    const orgUnits = addOrgUnit(workspace.orgUnits ?? [], input);
    setWorkspace((current) => ({ ...current, orgUnits }));
    markUnsaved();
    setToast("部門を追加しました");
  };

  const handleMoveOrgUnit = (id: string, parentId: string | null) => {
    if (!canManageMembers) throw new Error("組織階層を変更する権限がありません");
    const orgUnits = moveOrgUnit(workspace.orgUnits ?? [], id, parentId);
    setWorkspace((current) => ({ ...current, orgUnits }));
    markUnsaved();
    setToast("部門の所属を更新しました");
  };

  const handleArchiveOrgUnit = (id: string) => {
    if (!canManageMembers) throw new Error("組織階層を変更する権限がありません");
    setWorkspace((current) => archiveOrgUnit(current, id));
    markUnsaved();
    setToast("部門を削除しました");
  };

  const handleAddSearchScene = (input: {
    name: string;
    query?: string;
    role?: string;
    location?: string;
    skills?: SearchSkillFilter[];
    startDate?: string;
    endDate?: string;
    minAvailablePercent?: number;
  }) => {
    if (!canManageMembers) throw new Error("検索シーンを変更する権限がありません");
    const searchScenes = addSearchScene(workspace.searchScenes ?? [], input);
    setWorkspace((current) => ({ ...current, searchScenes }));
    markUnsaved();
    setToast("検索シーンを保存しました");
  };

  const handleDeleteSearchScene = (sceneId: string) => {
    if (!canManageMembers) return;
    setWorkspace((current) => ({ ...current, searchScenes: (current.searchScenes ?? []).filter((scene) => scene.id !== sceneId) }));
    markUnsaved();
    setToast("検索シーンを削除しました");
  };

  const handleAddSavedReport = (input: { name: string; source: ReportSource; groupBy: ReportGroupBy; metric: ReportMetric }) => {
    if (!canManageMembers) throw new Error("レポート定義を変更する権限がありません");
    const savedReports = addSavedReport(workspace.savedReports ?? [], input);
    setWorkspace((current) => ({ ...current, savedReports }));
    markUnsaved();
    setToast("レポートを保存しました");
  };

  const handleDeleteSavedReport = (reportId: string) => {
    if (!canManageMembers) return;
    setWorkspace((current) => ({ ...current, savedReports: (current.savedReports ?? []).filter((report) => report.id !== reportId) }));
    markUnsaved();
    setToast("レポートを削除しました");
  };

  const handleSaveRolePermission = (input: {
    role: RestrictableRole;
    personScope: PersonScope;
    hiddenFieldKeys: string[];
    readonlyFieldKeys: string[];
    disabledFeatures: RestrictableFeature[];
  }) => {
    if (!canManageMembers) throw new Error("権限設定を変更する権限がありません");
    if (input.role === "admin" && mode !== "demo" && role !== "owner") throw new Error("管理者の権限設定はオーナーだけが変更できます");
    const rolePermissions = setRolePermission(workspace.rolePermissions ?? [], workspace.customFields ?? [], input);
    setWorkspace((current) => ({ ...current, rolePermissions }));
    markUnsaved();
    setToast(`${input.role === "admin" ? "管理者" : input.role === "planner" ? "プランナー" : "閲覧者"}の権限を更新しました`);
  };

  const handleCreateProfileRequests = (personIds: string[], input: { scope: ProfileRequestScope; note: string }) => {
    if (!canManageMembers) throw new Error("更新依頼を作成する権限がありません");
    const profileRequests = addProfileRequests(workspace, personIds, input);
    setWorkspace((current) => ({ ...current, profileRequests }));
    markUnsaved();
    setToast(personIds.length > 1 ? `${personIds.length}件の更新依頼を作成しました` : "更新依頼を作成しました");
  };

  const handleSubmitProfileRequest = (requestId: string, proposed: { skills: string; workHistory: WorkHistoryEntry[] }) => {
    const next = submitProfileRequest(workspace, requestId, proposed, { identity, canManage: canManageMembers });
    if (mode === "shared" && role === "viewer" && shared?.submitProfileRequest) {
      const requestToken = newId();
      const submitRemote = shared.submitProfileRequest;
      void (async () => {
        try {
          setSyncStatus("saving");
          const result = await submitRemote(requestId, proposed, revisionRef.current, requestToken);
          revisionRef.current = result.revision;
          setRevision(result.revision);
          const state = result.state ? cloneState(result.state) : next;
          setWorkspace(state);
          setCommittedWorkspace(cloneState(state));
          setSyncStatus("idle");
          setToast("更新内容を提出しました");
        } catch (error) {
          setSyncStatus("error");
          setSyncError(error instanceof Error ? error.message : "提出に失敗しました");
          throw error;
        }
      })();
      return;
    }
    setWorkspace(next);
    markUnsaved();
    setToast("更新内容を提出しました");
  };

  const handleCompleteProfileRequest = (requestId: string) => {
    if (!canManageMembers) return;
    setWorkspace(completeProfileRequest(workspace, requestId));
    markUnsaved();
    setToast("更新内容をメンバーへ反映しました");
  };

  const handleCancelProfileRequest = (requestId: string) => {
    if (!canManageMembers) return;
    setWorkspace((current) => ({ ...current, profileRequests: cancelProfileRequest(current.profileRequests ?? [], requestId) }));
    markUnsaved();
    setToast("更新依頼を取り消しました");
  };

  const handleImportMembers = (actions: MemberImportAction[]) => {
    if (!canManageMembers || actions.length === 0) return;
    setWorkspace((current) => applyMemberImport(current, actions));
    markUnsaved();
    const created = actions.filter((action) => action.mode === "create").length;
    const updated = actions.filter((action) => action.mode === "update").length;
    setToast(`CSVから${created}件追加、${updated}件更新を仮置きしました`);
  };

  /**
   * The header's primary slot means one thing: the main action that completes on
   * this screen. Four screens add something, the proposal screen copies its
   * share link and the skills screen opens an unfilled role — all of them finish
   * where you are. Going to another screen does not qualify, because a slot that
   * sometimes navigates cannot be predicted from its position (#104). Reports
   * reaches the board from three other kinds of control inside its own view, so
   * removing its entry costs nothing.
   *
   * Every screen is listed, `null` for the ones with no such action, so adding a
   * screen to pageMeta is a compile error rather than a silently empty slot.
   * Label, icon, handler and enabled state live together because they used to be
   * four parallel nine-branch ternaries, which is why "no action" was not
   * expressible: the label chain ended in a bare `: "ボードで調整"`.
   */
  const primaryActions: Record<keyof typeof pageMeta, { label: string; icon: LucideIcon; enabled: boolean; run: () => void } | null> = {
    board: { label: "アサインを追加", icon: Plus, enabled: canAddAssignment, run: () => openNewAssignment() },
    projects: { label: "プロジェクトを追加", icon: BriefcaseBusiness, enabled: canEdit, run: () => setDrawer("newProject") },
    opportunities: { label: "受注前案件を追加", icon: Inbox, enabled: canEdit, run: () => setDrawer("newOpportunity") },
    members: { label: "メンバーを追加", icon: UserRoundPlus, enabled: canManageMembers, run: () => setDrawer("newMember") },
    proposal: {
      label: "提案リンクをコピー",
      icon: Sparkles,
      enabled: visibleProposalIds.length > 0,
      run: () => void copyShareLink({ nav: "proposal", memberIds: visibleProposalIds, anonymous: proposalAnonymous }, "提案リンクをコピーしました"),
    },
    skills: {
      label: "不足ロールを確認",
      icon: Layers3,
      enabled: workspace.needs.some((need) => need.status !== "filled"),
      run: () => {
        const openNeed = workspace.needs.find((need) => need.status !== "filled");
        if (openNeed) openStaffingNeed(openNeed.id);
      },
    },
    // These three used to navigate. The org tree, the field definitions and the
    // forecast each carry their own create action in the page.
    org: null,
    fields: null,
    reports: null,
  };
  const primary = primaryActions[activeNav];

  return (
    <main className="app-shell">
      <aside className="sidebar" inert={drawer ? true : undefined}>
        <div className="brand">
          <span className="brand-mark" aria-hidden="true"><i /><i /><i /><i /></span>
          <span className="brand-copy"><strong>MOSAIC</strong><small>Resource orchestration</small></span>
        </div>
        <div className={"workspace-mode " + (mode === "shared" ? "shared" : "demo")}><span>{mode === "shared" ? "SHARED" : "DEMO"}</span><small>{organizationName}</small></div>

        <nav className="primary-nav" aria-label="メインナビゲーション">
          {visibleNavItems.map((item) => {
            const Icon = item.icon;
            const active = activeNav === item.id;
            /* Two badges, two meanings: every registered project, but only the
               opportunities still in play. A bare number said neither, and
               `aria-label` on the button was overriding the badge's text, so the
               figure reached no screen reader at all. The word is on the badge
               itself now, so it is there for a pointer-less reader too, and the
               name repeats the visible text rather than paraphrasing it (#85).
               The badge is hidden below 820px, where the nav is icons only. */
            const badge = item.id === "projects" ? { count: workspace.projects.length, meaning: "登録" }
              : item.id === "opportunities" ? { count: (workspace.opportunities ?? []).filter(isActiveOpportunity).length, meaning: "進行中" }
                : null;
            return (
              <button ref={active ? activeNavItemRef : undefined} className={"nav-item " + (active ? "active" : "")} aria-label={badge ? `${item.label} ${badge.meaning} ${badge.count}件` : item.label} aria-current={active ? "page" : undefined} onClick={() => setActiveNav(item.id as keyof typeof pageMeta)} key={item.id}>
                <span className="nav-icon"><Icon size={18} strokeWidth={1.8} /></span><span className="nav-label">{item.label}</span>
                {badge && <span className="nav-count">{badge.meaning} {badge.count}</span>}
              </button>
            );
          })}
        </nav>

        <div className="sidebar-spacer" />
        <div className="month-card">
          {/* `averageLoad` is week-scoped: memberDailyLoads skips Saturday and
              Sunday, and capacity is a per-day percentage, so the denominator is
              capacity x 5 weekdays. This label said 「{month}月のチーム稼働」,
              presenting a week's figure as a month's — and paging the board moved
              the month in the label while the metric stayed week-scoped (#115).
              It names the Monday now, the way the board's own header does.
              「平均稼働率」 rather than 「チーム稼働率」: the board's pulse strip
              shows this same variable under that name, and one value with two
              names is what #82 is about.
              Named from `currentWeekStart`, the week the figure is actually
              measured over, and not from the board's first column. Those are the
              same thing while the board shows a week; once it can show a month,
              the first column is the 1st and the week began in the month before —
              which is #115 again, from the other end (#139). */}
          <div className="month-card-label"><span>{measuredWeek.month}/{measuredWeek.date}週の平均稼働率</span><strong>{averageLoad}%</strong></div>
          <div className="month-track"><span style={{ width: Math.min(100, averageLoad) + "%" }} /></div>
          <p>{totalCapacity === 0 ? "稼働上限が未設定です。" : averageLoad > 100 ? `稼働上限を ${averageLoad - 100}% 超えています。` : `稼働上限まであと ${100 - averageLoad}%。`}{mode === "shared" ? "変更は組織内で共有されます。" : "サンプルデータはこの端末だけに保存されます。"}</p>
        </div>
        <div className="profile-row">
          <span className="avatar avatar-dark">{makeInitials(displayName)}</span><span><strong>{displayName}</strong><small>{roleLabel[role]}</small></span>
          <span className="profile-actions">{onOpenOperations && <button aria-label="組織と監査ログを管理" disabled={accountActionLocked} onClick={openOperations}><MoreHorizontal size={17} /></button>}{onSignOut && <button aria-label="ログアウト" disabled={accountActionLocked} onClick={signOut}>退出</button>}</span>
        </div>
      </aside>

      <section className="workspace" id="board" inert={drawer ? true : undefined}>
        <header className="topbar">
          <div>
            <p className="eyebrow">{page.eyebrow} <span>/</span> {activeNav === "board" ? (range.unit === "week" ? "WEEK " + getIsoWeekNumber(days[0].iso) : "MONTH " + days[0].month) : "MOSAIC"}</p>
            <h1>{page.title}</h1>
            <p className="date-range">{activeNav === "board" ? days[0].year + "年 " + rangeLabel : page.description}</p>
          </div>
          <div className="topbar-actions">
            {activeNav === "board" && (searchOpen ? (
              <label className="search-box"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="メンバー・案件を検索" aria-label="メンバー・案件を検索" /><button type="button" onClick={() => { setSearchOpen(false); setQuery(""); }} aria-label="検索を閉じる"><X size={15} /></button></label>
            ) : <button className="icon-button" aria-label="検索" onClick={() => setSearchOpen(true)}><Search size={18} /></button>)}
            <div className="notification-wrap">
              <button className="icon-button has-dot" aria-label="通知" aria-expanded={notificationsOpen} onClick={() => setNotificationsOpen((open) => !open)}><Bell size={18} /></button>
              {notificationsOpen && (
                <div className="notification-popover">
                  <div className="popover-head"><strong>通知</strong><button aria-label="通知を閉じる" onClick={() => setNotificationsOpen(false)}><X size={15} /></button></div>
                  {(currentOverloads.length > 0 || overloadPlanned) && overloadMember && <button onClick={() => { setDrawer("overload"); setNotificationsOpen(false); }}><span className={"notice-icon " + (overloadPlanned ? "planned" : "danger")}><AlertTriangle size={14} /></span><span><strong>{overloadPlanned ? "上限超過は解消予定" : "上限超過を検知"}</strong><small>{overloadMember.name}さん · 今週</small></span></button>}
                  {activeNeeds.map((need) => <button onClick={() => openStaffingNeed(need.id)} key={need.id}><span className={"notice-icon " + (need.status === "planned" ? "planned" : "info")}><UserRoundPlus size={14} /></span><span><strong>{need.status === "planned" ? `${need.role}は解消予定` : `${need.role}担当が未定`}</strong><small>{projectById(workspace, need.projectId)?.name} · {formatDate(need.startDate)}</small></span></button>)}
                </div>
              )}
            </div>
            {/* `enabled` is checked in the handler as well as on the attribute:
                the old code guarded each branch (`activeNav === "board" &&
                canAddAssignment`), and that guard should not come to depend on
                the disabled attribute being honoured. */}
            {primary && (
              <button className="primary-button" onClick={() => { if (primary.enabled) primary.run(); }} disabled={!primary.enabled}>
                <primary.icon size={16} />
                {primary.label}
              </button>
            )}
          </div>
        </header>

        {mode === "shared" && (
          <div className={"sync-banner " + syncStatus} role={syncStatus === "error" || syncStatus === "conflict" ? "alert" : "status"}>
            <span className="live-dot" /><span><strong>{syncStatus === "saving" ? "チームへ保存中" : syncStatus === "refreshing" ? "最新データを確認中" : syncStatus === "conflict" ? "他のユーザーの変更があります" : syncStatus === "error" ? (syncRetryable ? "共有データに接続できません" : "入力内容を保存できません") : "チームと同期済み"}</strong><small>{syncError || `revision ${revision}`}</small></span>
            {syncStatus === "conflict" && <button onClick={() => void discardAndReloadShared()}>下書きを破棄して再読み込み</button>}
            {syncStatus === "error" && (unsavedChanges > 0
              ? (syncRetryable ? <button onClick={() => void saveChanges()}>もう一度保存</button> : <button onClick={undoChanges}>未保存変更を元に戻す</button>)
              : <button onClick={() => void discardAndReloadShared()}>再試行</button>)}
          </div>
        )}

        {activeNav === "board" && (
          <>
            <section className="pulse-strip" aria-label="チームの稼働サマリー">
              <div className="pulse-heading"><span className="live-dot" /><div><small>TEAM PULSE</small><strong>チームの稼働サマリー</strong></div></div>
              <div className="pulse-metric"><strong>{averageLoad}<small>%</small></strong><span>平均稼働率</span></div>
              <div className="pulse-rule" />
              <div className="pulse-metric"><strong>{freeDays}<small>人日</small></strong><span>今週の空き</span></div>
              <div className="pulse-rule" />
              <button className="pulse-metric warning" onClick={() => { if (currentOverloads.length > 0 || overloadPlanned) setDrawer("overload"); else if (displayNeed) openStaffingNeed(displayNeed.id); }}><strong>{adjustmentCount}<small>件</small></strong><span>要調整</span><ArrowRight size={14} /></button>
              <div className="pulse-mini-bars" aria-hidden="true">{[72, 84, 91, 78, 64].map((height, index) => <i key={index} style={{ height: height + "%" }} />)}</div>
            </section>

            <div className="board-layout">
              <section
                className="schedule-card"
                aria-label={unitWord + "間アサイン表"}
                /* The header row and every row's cell must divide the same box
                   into the same days (#106), so the track list is set once here,
                   on their common ancestor, rather than by each of them. It is
                   inline because the column count is data: five in week mode, 20
                   to 23 in a month. 34px because 23 columns at the week's 72px
                   would be 1656px of grid and 835px of sideways scroll (#139). */
                style={{ "--schedule-day-tracks": `repeat(${days.length}, minmax(${range.unit === "week" ? 72 : 34}px, 1fr))` } as CSSProperties}
              >
                <div className="schedule-toolbar">
                  {/* 「メンバー別」 not 「メンバー」: the sidebar has a nav button
                      called 「メンバー」 that leaves this screen, and one label
                      cannot mean two things (#88). The wording is the grid's own
                      aria-label, 「メンバー別の週間アサイン」, rather than a third
                      way of saying it. `role="group"` so the label below is
                      actually exposed — on a bare div it was not. */}
                  <div className="view-tabs" role="group" aria-label="表示軸">
                    <button className={viewMode === "members" ? "selected" : ""} aria-pressed={viewMode === "members"} onClick={() => changeView("members")}><UsersRound size={13} />メンバー別</button>
                    <button className={viewMode === "projects" ? "selected" : ""} aria-pressed={viewMode === "projects"} onClick={() => changeView("projects")}><BriefcaseBusiness size={13} />プロジェクト別</button>
                  </div>
                  <div className="toolbar-actions">
                    <label className="filter-select"><SlidersHorizontal size={13} /><select aria-label={viewMode === "members" ? "職種で絞り込み" : "状態で絞り込み"} value={filter} onChange={(event) => setFilter(event.target.value)}>
                      <option value="すべて">{viewMode === "members" ? "すべての職種" : "すべての状態"}</option>
                      {(viewMode === "members" ? Array.from(new Set(workspace.members.map((member) => member.role))) : ["進行中", "要注意", "準備中", "完了間近", "完了"]).map((option) => <option key={option}>{option}</option>)}
                    </select></label>
                    {/* The unit changes what the arrows step by, so it sits with
                        them rather than in the axis group above. Offset resets on
                        the way: 3 weeks out is not 3 months out. */}
                    <div className="view-tabs" role="group" aria-label="表示する期間">
                      <button className={range.unit === "week" ? "selected" : ""} aria-pressed={range.unit === "week"} onClick={() => { setBoardUnit("week"); setWeekOffset(0); }}>週</button>
                      <button className={range.unit === "month" ? "selected" : ""} aria-pressed={range.unit === "month"} onClick={() => { setBoardUnit("month"); setWeekOffset(0); }}>月</button>
                    </div>
                    <button onClick={() => setWeekOffset(0)}><CalendarDays size={13} />今日</button>
                    <button className="arrow-button" aria-label={"前の" + unitWord} onClick={() => setWeekOffset((offset) => offset - 1)}><ChevronLeft size={16} /></button>
                    <button className="arrow-button" aria-label={"次の" + unitWord} onClick={() => setWeekOffset((offset) => offset + 1)}><ChevronRight size={16} /></button>
                  </div>
                </div>

                <div className="schedule-scroller">
                  <div className="schedule-table" role="grid" aria-label={(viewMode === "members" ? "メンバー別の" : "プロジェクト別の") + unitWord + "間アサイン"}>
                    <div className="schedule-head" role="row">
                      <div className="people-label" role="columnheader">{viewMode === "members" ? "メンバー" : "プロジェクト"} <span>{rows.length}</span></div>
                      {/* Today by date, not by position: it is the first column
                          only in the current week, and somewhere in the middle of
                          the current month. */}
                      {days.map((day) => <div className={"day-label " + (day.iso === todayIso ? "today" : "")} role="columnheader" key={day.iso}><span>{day.day}</span><strong>{day.date}</strong></div>)}
                    </div>
                    <div className="schedule-body">
                      {rows.length > 0 ? rows.map((row) => (
                        <div className="schedule-row" role="row" key={row.id}>
                          <div className="person-cell" role="rowheader">
                            <span className={"avatar " + row.avatarTone}>{row.initials}</span><span className="person-copy"><strong>{row.name}</strong><small>{row.role}</small></span><span className={"load " + (row.alert ? "over" : "")}>{row.tagLabel}</span>
                          </div>
                          <div className="week-cell" role="gridcell" aria-label={row.name + "のアサイン"}>
                            {/* One line per column, from the range rather than a
                                hard-coded five (#139). */}
                            <div className="day-grid" aria-hidden="true">{days.map((day) => <i key={day.iso} />)}</div>
                            {row.assignments.map((assignment) => (
                              <button className={"assignment " + assignment.tone + (assignment.status === "draft" ? " provisional" : "")} style={{ gridColumn: assignment.start + " / span " + assignment.span }} onClick={() => openAssignment(assignment.id)} aria-label={assignment.name + "のアサイン詳細（" + row.name + "・" + assignmentDayRange(days, assignment.start, assignment.span) + "）"} title={assignment.name + " · " + assignment.allocation + "%"} key={assignment.id}>
                                <span>{assignment.name}</span>{assignment.allocation > 0 && <small>{assignment.allocation}%</small>}
                              </button>
                            ))}
                          </div>
                        </div>
                      )) : <div className="empty-state"><Search size={22} /><strong>条件に合う項目がありません</strong><p>検索語または絞り込み条件を見直してください。</p><button onClick={() => { setQuery(""); setFilter("すべて"); }}>条件をクリア</button></div>}
                    </div>
                  </div>
                </div>
              </section>

              <aside className="attention-panel">
                <div className="attention-title"><div><small>NEEDS ATTENTION</small><h2>要調整</h2></div><span>{adjustmentCount}</span></div>
                {(currentOverloads.length > 0 || overloadPlanned) && overloadMember && (
                  <button className={"alert-card urgent " + (overloadPlanned ? "planned" : "")} onClick={() => setDrawer("overload")}>
                    <div className="alert-top"><span>{overloadPlanned ? <CheckCircle2 size={11} /> : <AlertTriangle size={11} />} {overloadPlanned ? "解消予定" : "上限超過"}</span><small>{memberLoad(workspace, overloadMember.id, currentWeekStart)}%</small></div>
                    <h3>{overloadMember.name}さんの超過は{overloadPlanned ? "解消予定" : "要調整"}</h3><p>{overloadPlanned ? "変更を保存すると警告が解消されます。" : "今週の稼働配分が稼働上限を超えています。"}</p>
                    <div className="alert-people"><span className={"avatar " + overloadMember.avatarTone}>{overloadMember.initials}</span><span>{overloadPlanned || !canEdit ? "内容を確認" : "調整する"} <ArrowRight size={13} /></span></div>
                  </button>
                )}
                {activeNeeds.map((need) => (
                  <button className={"alert-card " + (need.status === "planned" ? "planned" : "")} onClick={() => openStaffingNeed(need.id)} key={need.id}>
                    <div className="alert-top"><span>{need.status === "planned" ? <CheckCircle2 size={11} /> : <Clock3 size={11} />} {need.status === "planned" ? "解消予定" : "未充足ロール"}</span><small>{formatDate(need.startDate).replace(/^\d{4}年/, "")}</small></div>
                    <h3>{projectById(workspace, need.projectId)?.name}の{need.role}が{need.status === "planned" ? "解消予定" : "未定"}</h3><p>{need.status === "planned" ? "候補者を仮置きしました。保存後に充足へ変わります。" : "稼働配分" + need.allocation + "%の担当者を開始日までに決めてください。"}</p>
                    <div className="skill-chips">{need.skills.map((skill) => <span key={skill}>{skill}</span>)}<ArrowRight size={13} /></div>
                  </button>
                ))}
                {adjustmentCount === 0 && <div className="attention-clear"><CheckCircle2 size={20} /><strong>調整項目はありません</strong><p>すべての稼働と要員要件が範囲内です。</p></div>}
                <button className="all-alerts" onClick={() => setActiveNav("reports")}>レポートで見通しを確認 <ArrowRight size={13} /></button>
              </aside>
            </div>
          </>
        )}

        {activeNav === "projects" && <ProjectsView state={workspace} weekOffset={viewWeekOffset} onOpen={openProject} query={projectQuery} onQueryChange={setProjectQuery} favorites={favorites} favoritesOnly={favoritesOnly} onFavoritesOnlyChange={setFavoritesOnly} onToggleFavorite={(projectId) => void toggleFavoriteTarget("project", projectId)} onCopyQuery={() => void copyShareLink({ nav: "projects", q: projectQuery }, "検索リンクをコピーしました")} />}
        {activeNav === "opportunities" && <OpportunitiesView state={workspace} onOpen={openOpportunity} />}
        {activeNav === "members" && <MembersView state={workspace} weekOffset={viewWeekOffset} onOpen={openMember} onAssign={openAssignmentFor} onAddScene={handleAddSearchScene} onDeleteScene={handleDeleteSearchScene} canEdit={canEdit} canManageScenes={canManageMembers && featureEnabled("searchScenes")} query={memberQuery} onQueryChange={setMemberQuery} favorites={favorites} favoritesOnly={favoritesOnly} onFavoritesOnlyChange={setFavoritesOnly} onToggleFavorite={(memberId) => void toggleFavoriteTarget("member", memberId)} onAddToProposal={addMemberToProposal} onCopyQuery={() => void copyShareLink({ nav: "members", q: memberQuery }, "検索リンクをコピーしました")} />}
        {activeNav === "proposal" && <ProposalView state={workspace} weekOffset={viewWeekOffset} selectedIds={visibleProposalIds} anonymous={proposalAnonymous} favorites={favorites} onSelectedIdsChange={setProposalMemberIds} onAnonymousChange={setProposalAnonymous} onOpenMember={openMember} onToggleFavorite={(memberId) => void toggleFavoriteTarget("member", memberId)} />}
        {activeNav === "org" && <OrgView state={workspace} onAddUnit={handleAddOrgUnit} onMoveUnit={handleMoveOrgUnit} onArchiveUnit={handleArchiveOrgUnit} canManage={canManageMembers} />}
        {activeNav === "skills" && <SkillsView state={hydrateWorkspaceSkills(workspace)} onAddCatalogEntry={handleAddCatalogEntry} onOpenMember={openMember} onResolveNeed={openStaffingNeed} canEdit={canEdit} />}
        {activeNav === "fields" && (
          <>
            <FieldsView state={workspace} onAddField={handleAddCustomField} canManage={canManageMembers} canManageRequests={canManageMembers && featureEnabled("profileRequests")} canManageAdminPermissions={mode === "demo" || role === "owner"} onSaveRolePermission={handleSaveRolePermission} identity={identity} onCreateRequests={handleCreateProfileRequests} onSubmitRequest={handleSubmitProfileRequest} onCompleteRequest={handleCompleteProfileRequest} onCancelRequest={handleCancelProfileRequest} />
            <CsvTransferPanel state={workspace} organizationId={organizationId} canImport={canManageMembers} onImportMembers={handleImportMembers} />
          </>
        )}
        {activeNav === "reports" && <ReportsView state={workspace} onOpenWeek={openWeekFromReport} onResolveNeed={openStaffingNeed} onOpenOpportunity={openOpportunity} onAddReport={handleAddSavedReport} onDeleteReport={handleDeleteSavedReport} canEdit={canEdit} canManageReports={canManageMembers && featureEnabled("savedReports")} />}
      </section>

      {unsavedChanges > 0 && (
        <div className="change-bar" role="status" inert={drawer ? true : undefined}>
          <span className="change-count">{unsavedChanges}</span><span><strong>{unsavedChanges}件の変更があります</strong><small>保存するまで確定データには反映されません</small></span>
          <button className="undo-button" disabled={operationLocked || saveOutcomePending} onClick={undoChanges}><Undo2 size={14} />元に戻す</button><button className="save-button" disabled={operationLocked} onClick={() => void saveChanges()}><Save size={14} />{syncStatus === "saving" ? "保存中…" : syncStatus === "refreshing" ? "確認中…" : mode === "shared" ? "チームへ保存" : "デモへ保存"}</button>
        </div>
      )}

      {drawer && (
        <div className="overlay">
          <button className="overlay-backdrop" aria-label="詳細パネルを閉じる" onClick={closeDrawer} />
          <section className="drawer" ref={drawerRef} role="dialog" aria-modal="true" aria-label="詳細パネル" tabIndex={-1}>
            <div className="drawer-handle" />
            <div className="drawer-top"><span className="drawer-kicker">{drawer === "add" ? "NEW ASSIGNMENT" : drawer === "assignment" ? "ASSIGNMENT DETAIL" : drawer === "newProject" ? "NEW PROJECT" : drawer === "newMember" ? "NEW MEMBER" : drawer === "editProject" ? "EDIT PROJECT" : drawer === "editMember" ? "EDIT MEMBER" : drawer === "needForm" ? (editingNeedId ? "EDIT STAFFING NEED" : "NEW STAFFING NEED") : drawer === "opportunity" ? "OPPORTUNITY DETAIL" : drawer === "newOpportunity" ? "NEW OPPORTUNITY" : drawer === "editOpportunity" ? "EDIT OPPORTUNITY" : drawer === "opportunityNeedForm" ? (editingOpportunityNeedId ? "EDIT STAFFING PLAN" : "NEW STAFFING PLAN") : drawer === "project" ? "PROJECT DETAIL" : drawer === "member" ? "MEMBER PROFILE" : "RESOLUTION GUIDE"}</span><button className="close-button" aria-label="詳細パネルを閉じる" onClick={closeDrawer}><X size={18} /></button></div>

            {drawer === "add" && (
              <form className="assignment-form" onChange={markFormDraftDirty} onSubmit={handleAddAssignment}>
                <div className="drawer-heading"><span className="drawer-icon cobalt"><Plus size={19} /></span><div><h2>アサインを追加</h2><p>日付と稼働配分を仮置きします。</p></div></div>
                <label htmlFor="assignment-member">メンバー<select id="assignment-member" aria-label="メンバー" value={form.personId} onChange={(event) => setForm({ ...form, personId: event.target.value })}>{workspace.members.map((member) => <option value={member.id} key={member.id}>{member.name} · この週 {memberLoad(workspace, member.id, weekStart)}%</option>)}</select></label>
                <label htmlFor="assignment-project">プロジェクト<select id="assignment-project" aria-label="プロジェクト" value={form.projectId} onChange={(event) => selectAssignmentProject(event.target.value)}>{workspace.projects.map((project) => <option value={project.id} key={project.id}>{project.name}</option>)}</select></label>
                <div className="form-grid">
                  <label>開始日<input required type="date" value={form.startDate} onChange={(event) => setForm({ ...form, startDate: event.target.value })} /></label>
                  <label>終了日<input required type="date" min={form.startDate} value={form.endDate} onChange={(event) => setForm({ ...form, endDate: event.target.value })} /></label>
                </div>
                <label>稼働配分<div className="allocation-input"><input type="range" min="10" max="100" step="10" value={form.allocation} onChange={(event) => setForm({ ...form, allocation: event.target.value })} /><output>{form.allocation}%</output></div></label>
                <div className="form-note"><Sparkles size={15} /><span>保存前は斜線付きの「仮置き」で表示します。</span></div><button className="drawer-primary" type="submit" disabled={!canAddAssignment}><Check size={16} />この内容で仮置きする</button>
              </form>
            )}

            {drawer === "assignment" && selectedAssignment && (
              <form className="assignment-form assignment-edit-form" onChange={markFormDraftDirty} onSubmit={handleEditAssignment}>
                <div className="drawer-heading"><span className="drawer-icon cobalt"><CalendarDays size={19} /></span><div><h2>アサインの詳細</h2><p>{projectById(workspace, selectedAssignment.projectId)?.name ?? "プロジェクト"} · {memberById(workspace, selectedAssignment.personId)?.name ?? "担当者"}</p></div></div>
                <label htmlFor="assignment-edit-member">メンバー<select id="assignment-edit-member" aria-label="メンバー" disabled={!canEdit} value={assignmentEditForm.personId} onChange={(event) => setAssignmentEditForm({ ...assignmentEditForm, personId: event.target.value })}>{workspace.members.map((member) => <option value={member.id} key={member.id}>{member.name}</option>)}</select></label>
                <label htmlFor="assignment-edit-project">プロジェクト<select id="assignment-edit-project" aria-label="プロジェクト" disabled={!canEdit} value={assignmentEditForm.projectId} onChange={(event) => setAssignmentEditForm({ ...assignmentEditForm, projectId: event.target.value })}>{workspace.projects.map((project) => <option value={project.id} key={project.id}>{project.name}</option>)}</select></label>
                <div className="form-grid">
                  <label>開始日<input required disabled={!canEdit} type="date" min={projectById(workspace, assignmentEditForm.projectId)?.startDate} max={projectById(workspace, assignmentEditForm.projectId)?.endDate} value={assignmentEditForm.startDate} onChange={(event) => setAssignmentEditForm({ ...assignmentEditForm, startDate: event.target.value })} /></label>
                  <label>終了日<input required disabled={!canEdit} min={assignmentEditForm.startDate || projectById(workspace, assignmentEditForm.projectId)?.startDate} max={projectById(workspace, assignmentEditForm.projectId)?.endDate} type="date" value={assignmentEditForm.endDate} onChange={(event) => setAssignmentEditForm({ ...assignmentEditForm, endDate: event.target.value })} /></label>
                </div>
                <label>稼働配分（%）<input required disabled={!canEdit} min="1" max="100" step="1" type="number" value={assignmentEditForm.allocation} onChange={(event) => setAssignmentEditForm({ ...assignmentEditForm, allocation: event.target.value })} /></label>
                <div className="form-note"><SlidersHorizontal size={15} /><span>{canEdit ? selectedAssignment.staffingNeedId ? "要員要件を満たさない変更では、元の不足ロールを再オープンします。変更は保存まで元に戻せます。" : "変更と取消は仮置きされ、チームへ保存するまで元に戻せます。" : "このアサインは閲覧のみです。変更権限があるメンバーへ依頼してください。"}</span></div>
                {canEdit ? (
                  <div className="assignment-edit-actions">
                    <button className="drawer-primary" type="submit"><Check size={16} />変更を仮置き</button>
                    <button className="drawer-danger" type="button" onClick={removeAssignment}><Trash2 size={15} />{selectedAssignmentIsPersisted ? "アサインを取消" : "仮置きを削除"}</button>
                  </div>
                ) : <button className="drawer-secondary" type="button" onClick={closeDrawer}>閉じる</button>}
              </form>
            )}

            {drawer === "overload" && overloadMember && (
              <div className="drawer-content">
                <div className="drawer-heading"><span className={"drawer-icon " + (overloadPlanned ? "mint" : "coral")}>{overloadPlanned ? <CheckCircle2 size={19} /> : <AlertTriangle size={19} />}</span><div><h2>{overloadPlanned ? "解消予定を確認" : "上限超過を調整"}</h2><p>{overloadMember.name}さん · {overloadMember.role}</p></div></div>
                <div className={"capacity-card " + (overloadPlanned ? "resolved" : "")}><div><span>今週の稼働</span><strong>{memberLoad(workspace, overloadMember.id, currentWeekStart)}% / 稼働上限{overloadMember.capacity}%</strong></div><div className="capacity-meter"><span style={{ width: Math.min(100, memberLoad(workspace, overloadMember.id, currentWeekStart) / overloadMember.capacity * 100) + "%" }} /><i>{overloadMember.capacity}%</i></div><p>{overloadPlanned ? "保存すると超過警告が解消されます。" : `稼働上限を${Math.max(0, memberLoad(workspace, overloadMember.id, currentWeekStart) - overloadMember.capacity)}%超えています。`}</p></div>
                <div className="drawer-section-title"><span>現在の配分</span><small>合計 {memberLoad(workspace, overloadMember.id, currentWeekStart)}%</small></div>
                <div className="allocation-list">{overloadAssignments.map((assignment) => <div key={assignment.id}><span className={"project-dot " + (projectById(workspace, assignment.projectId)?.tone || "blue")} /><span><strong>{projectById(workspace, assignment.projectId)?.name}</strong><small>{formatDate(assignment.startDate)} — {formatDate(assignment.endDate)}</small></span><b>{assignment.allocation}%</b></div>)}</div>
                {!overloadPlanned && canEdit && overloadAssignments.length > 0 ? <><div className="suggestion-card"><span><Sparkles size={15} /></span><div><strong>おすすめの調整</strong><p>超過している各営業日の案件配分を順に減らし、すべての日を稼働上限内へ収めます。</p></div></div><button className="drawer-primary" onClick={resolveOverload}><CheckCircle2 size={16} />推奨配分へ調整</button></> : <button className="drawer-primary" onClick={closeDrawer}><Check size={16} />閉じる</button>}
              </div>
            )}

            {drawer === "openRole" && selectedNeed && (
              <div className="drawer-content">
                <div className="drawer-heading"><span className={"drawer-icon " + (selectedNeed.status === "open" ? "mint" : "cobalt")}><UserRoundPlus size={19} /></span><div><h2>{selectedNeed.status === "open" ? `${selectedNeed.role}の候補` : selectedNeed.status === "planned" ? "解消予定の担当者" : "充足済みの担当者"}</h2><p>{projectById(workspace, selectedNeed.projectId)?.name} · {formatDate(selectedNeed.startDate)}開始</p></div></div>
                <div className="role-brief"><span>必要な条件</span><div>{selectedNeed.skills.map((skill) => <b key={skill}>{skill}</b>)}<b>{selectedNeed.role}</b><b>稼働配分 {selectedNeed.allocation}%</b></div></div>
                {selectedNeed.status !== "open" ? (
                  <div className="planned-candidate"><CheckCircle2 size={20} /><span><strong>{memberById(workspace, selectedNeed.draftPersonId || "")?.name ?? "担当者"}{selectedNeed.status === "planned" ? "さんを仮置き済み" : "さんで充足済み"}</strong><small>稼働配分 {selectedNeed.allocation}% · {formatDate(selectedNeed.startDate)} — {formatDate(selectedNeed.endDate)}</small></span></div>
                ) : (
                  <>
                    <div className="candidate-label"><span>条件に合うメンバー</span><small>必須条件を満たす候補をスコア順に最大5名</small></div>
                    {candidateMatches.length > 0 ? <div className="candidate-list">{candidateMatches.map((match) => <article key={match.member.id}><span className={"avatar " + match.member.avatarTone}>{match.member.initials}</span><span><strong>{match.member.name}</strong><small>{match.member.role} · 要件期間の最小空き {match.availablePercent}% · 適合 {match.score}点</small><em><Check size={10} />{match.matchedMust.length > 0 ? `${match.matchedMust.join("・")}に適合` : `${selectedNeed.role}に適合`}</em></span>{canEdit ? <button onClick={() => placeCandidate(match.member.id, selectedNeed)}>仮置き</button> : <span className="read-only-label">閲覧のみ</span>}</article>)}</div> : <div className="candidate-empty"><UsersRound size={18} /><span><strong>条件を満たす候補がいません</strong><small>メンバーのスキルまたは要件期間の配分を見直してください。</small></span></div>}
                  </>
                )}
                <p className="drawer-footnote">候補は対象週の稼働と登録スキルに基づく参考情報です。</p>
                {canEdit && <div className="entity-action-row"><button className="drawer-secondary" onClick={() => openNeedEditor(selectedNeed)}>要員要件を編集</button><button className="drawer-danger" onClick={cancelNeed}><Trash2 size={15} />要員要件を取消</button></div>}
              </div>
            )}

            {drawer === "project" && selectedProject && (
              <div className="drawer-content">
                <div className="drawer-heading"><span className={"project-code drawer-code " + selectedProject.tone}>{selectedProject.code}</span><div><h2>{selectedProject.name}</h2><p>{selectedProject.summary}</p></div></div>
                <div className="detail-facts"><div><span>状態</span><strong>{selectedProject.status}</strong></div><div><span>進捗</span><strong>{selectedProject.progress}%</strong></div><div><span>責任者</span><strong>{selectedProject.ownerName ?? "未設定"}</strong></div><div><span>完了予定</span><strong>{formatDate(selectedProject.endDate).replace(/^\d{4}年/, "")}</strong></div></div>
                <CustomFieldFacts fields={visibleCustomFields(workspace.customFields, "project", "detail")} values={selectedProject.customValues} />
                {(workspace.opportunities ?? []).some((opportunity) => opportunity.convertedProjectId === selectedProject.id) && (
                  <button className="drawer-secondary" onClick={() => openOpportunity((workspace.opportunities ?? []).find((opportunity) => opportunity.convertedProjectId === selectedProject.id)!.id)}>元の受注前案件を開く</button>
                )}
                <div className="drawer-section-title"><span>4週間の充足</span><small>{selectedProject.demand === 0 ? "必要人数 未設定" : `必要 ${selectedProject.demand}名`}</small></div>
                <div className="detail-capacity-rail">{[0, 1, 2, 3].map((offset) => { const count = projectMembers(workspace, selectedProject.id, addDays(currentWeekStart, offset * 7)); return <div key={offset}><i><b className={selectedProject.demand > 0 && count < selectedProject.demand ? "short" : ""} style={{ width: (selectedProject.demand === 0 ? 100 : Math.min(100, count / selectedProject.demand * 100)) + "%" }} /></i><span>{offset === 0 ? "今週" : offset + 1 + "週後"}</span><strong>{selectedProject.demand === 0 ? "未設定" : `${count}/${selectedProject.demand}`}</strong></div>; })}</div>
                <div className="drawer-section-title"><span>担当メンバー</span><small>{projectMembers(workspace, selectedProject.id, weekStart)}名</small></div>
                <div className="detail-member-list">{workspace.assignments.filter((assignment) => assignment.projectId === selectedProject.id && overlaps(assignment.startDate, assignment.endDate, weekStart, weekEnd(weekStart))).map((assignment) => { const member = memberById(workspace, assignment.personId); return <button onClick={() => member && openMember(member.id)} key={assignment.id}><span className={"avatar " + member?.avatarTone}>{member?.initials}</span><span><strong>{member?.name}</strong><small>{member?.role}</small></span><b>{assignment.allocation}%</b></button>; })}</div>
                <div className="drawer-section-title"><span>要員要件</span><small>{selectedProjectNeeds.length}件</small></div>
                {selectedProjectNeeds.length > 0 ? <div className="detail-need-list">{selectedProjectNeeds.map((need) => <button onClick={() => openStaffingNeed(need.id)} key={need.id}><span><strong>{need.role}</strong><small>{formatDate(need.startDate)} — {formatDate(need.endDate)} · {need.allocation}%</small></span><em>{need.status === "open" ? "候補を見る" : need.status === "planned" ? "解消予定" : "充足済み"}</em><ChevronRight size={14} /></button>)}</div> : <div className="candidate-empty"><UsersRound size={18} /><span><strong>要員要件はありません</strong><small>必要なロールと期間を追加できます。</small></span></div>}
                {canEdit && <button className="drawer-primary" onClick={() => openNeedCreator(selectedProject.id)}><UserRoundPlus size={16} />要員要件を追加</button>}
                {canEdit && <button className="drawer-secondary" onClick={() => openNewAssignment(undefined, selectedProject.id)}>この案件へアサインを追加</button>}
                <div className="entity-action-row">
                  <FavoriteStar name={selectedProject.name} pressed={isFavorited(favorites, "project", selectedProject.id)} onToggle={() => void toggleFavoriteTarget("project", selectedProject.id)} />
                  <button className="drawer-secondary" type="button" onClick={() => void copyShareLink({ nav: "projects", open: selectedProject.id }, "案件リンクをコピーしました")}>この案件のリンクをコピー</button>
                </div>
                {canEdit && <div className="entity-action-row"><button className="drawer-secondary" onClick={() => openProjectEditor(selectedProject)}>案件情報を編集</button><button className="drawer-danger" onClick={archiveProject}><Trash2 size={15} />案件をアーカイブ</button></div>}
              </div>
            )}

            {drawer === "member" && selectedMember && (
              <div className="drawer-content">
                <div className="profile-hero">
                  <span className={"avatar profile-avatar " + selectedMember.avatarTone}>{selectedMember.initials}</span>
                  <div><h2>{selectedMember.name}</h2><p>{selectedMember.role} · {selectedMember.department}</p><small>{selectedMember.location}</small></div>
                  <FavoriteStar name={selectedMember.name} pressed={isFavorited(favorites, "member", selectedMember.id)} onToggle={() => void toggleFavoriteTarget("member", selectedMember.id)} />
                  <strong>{memberLoad(workspace, selectedMember.id, weekStart)}%</strong>
                </div>
                <div className="profile-skills">{memberSkillLevels(selectedMember).map((level) => <span key={level.name}>{level.name}<small>{level.proficiency}</small></span>)}</div>
                <OrgFacts state={workspace} personId={selectedMember.id} />
                <CustomFieldFacts fields={visibleCustomFields(workspace.customFields, "member", "detail")} values={selectedMember.customValues} />
                <div className="drawer-section-title"><span>業務経歴</span><small>{(selectedMember.workHistory ?? []).length}件</small></div>
                <WorkHistoryList entries={selectedMember.workHistory} />
                <div className="drawer-section-title"><span>4週間の稼働</span><small>稼働上限 {selectedMember.capacity}%</small></div>
                <div className="profile-capacity">{[0, 1, 2, 3].map((offset) => { const load = memberLoad(workspace, selectedMember.id, addDays(weekStart, offset * 7)); const ratio = selectedMember.capacity > 0 ? load / selectedMember.capacity * 100 : load > 0 ? 100 : 0; return <div key={offset}><span>{offset === 0 ? "今週" : offset + 1 + "週後"}</span><i><b className={load > selectedMember.capacity ? "over" : ""} style={{ width: Math.min(100, ratio) + "%" }} /></i><strong>{load}% / {selectedMember.capacity}%</strong></div>; })}</div>
                <div className="drawer-section-title"><span>現在のアサイン</span><small>{workspace.assignments.filter((assignment) => assignment.personId === selectedMember.id && overlaps(assignment.startDate, assignment.endDate, weekStart, weekEnd(weekStart))).length}件</small></div>
                <div className="allocation-list">{workspace.assignments.filter((assignment) => assignment.personId === selectedMember.id && overlaps(assignment.startDate, assignment.endDate, weekStart, weekEnd(weekStart))).map((assignment) => <div key={assignment.id}><span className={"project-dot " + (projectById(workspace, assignment.projectId)?.tone || "plum")} /><span><strong>{assignment.label || projectById(workspace, assignment.projectId)?.name || "プロジェクト未登録"}</strong><small>{formatDate(assignment.startDate)} — {formatDate(assignment.endDate)}</small></span><b>{assignment.allocation}%</b></div>)}</div>
                <div className="entity-action-row">
                  <button className="drawer-secondary" type="button" onClick={() => void copyShareLink({ nav: "members", open: selectedMember.id }, "メンバーリンクをコピーしました")}>このメンバーのリンクをコピー</button>
                  <button className="drawer-secondary" type="button" onClick={() => addMemberToProposal(selectedMember.id)}>提案ビューに追加</button>
                </div>
                {canEdit && <button className="drawer-primary" onClick={() => openAssignmentFor(selectedMember.id)}><Plus size={16} />この人へアサインを追加</button>}
                {canManageMembers && <div className="entity-action-row"><button className="drawer-secondary" onClick={() => openMemberEditor(selectedMember)}>メンバー情報を編集</button><button className="drawer-danger" onClick={archiveMember}><Trash2 size={15} />メンバーをアーカイブ</button></div>}
              </div>
            )}

            {drawer === "editMember" && selectedMember && (
              <form className="assignment-form" onChange={markFormDraftDirty} onSubmit={handleEditMember}>
                <div className="drawer-heading"><span className="drawer-icon mint"><UsersRound size={19} /></span><div><h2>メンバー情報を編集</h2><p>スキルと稼働上限は候補判定にも反映されます。</p></div></div>
                <label>氏名<input required value={memberEditForm.name} onChange={(event) => setMemberEditForm({ ...memberEditForm, name: event.target.value })} /></label>
                <label>職種<input required value={memberEditForm.role} onChange={(event) => setMemberEditForm({ ...memberEditForm, role: event.target.value })} /></label>
                <label>スキル（カンマ区切り）<input value={memberEditForm.skills} onChange={(event) => setMemberEditForm({ ...memberEditForm, skills: event.target.value })} placeholder="React:4, TypeScript:3, A11y" /></label>
                {(workspace.orgUnits ?? []).length > 0
                  ? <MemberOrgFields
                      units={workspace.orgUnits ?? []}
                      primaryUnitId={memberEditForm.primaryUnitId}
                      extraUnitIds={memberEditForm.extraUnitIds}
                      managerUnitIds={memberEditForm.managerUnitIds}
                      onChange={(org) => setMemberEditForm({ ...memberEditForm, ...org, department: (workspace.orgUnits ?? []).find((unit) => unit.id === org.primaryUnitId)?.name ?? memberEditForm.department })}
                    />
                  : <div className="form-grid"><label>部署<input required value={memberEditForm.department} onChange={(event) => setMemberEditForm({ ...memberEditForm, department: event.target.value })} /></label><label>勤務地<input required value={memberEditForm.location} onChange={(event) => setMemberEditForm({ ...memberEditForm, location: event.target.value })} /></label></div>}
                {(workspace.orgUnits ?? []).length > 0 && <label>勤務地<input required value={memberEditForm.location} onChange={(event) => setMemberEditForm({ ...memberEditForm, location: event.target.value })} /></label>}
                <label>稼働上限（%）<input required type="number" min="0" max="100" step="1" value={memberEditForm.capacity} onChange={(event) => setMemberEditForm({ ...memberEditForm, capacity: event.target.value })} /></label>
                <CustomFieldInputs fields={editableCustomFields(workspace.customFields, "member", "detail")} values={memberEditForm.customValues} onChange={(customValues) => setMemberEditForm({ ...memberEditForm, customValues })} />
                <WorkHistoryEditor entries={memberEditForm.workHistory} onChange={(workHistory) => setMemberEditForm({ ...memberEditForm, workHistory })} />
                <div className="form-note"><SlidersHorizontal size={15} /><span>変更後に満たせない要員要件がある場合、紐づくアサインを取消予定にして要件を再オープンします。</span></div>
                <button className="drawer-primary" type="submit" disabled={!canManageMembers}><Check size={16} />変更を仮置き</button>
              </form>
            )}

            {drawer === "editProject" && selectedProject && (
              <form className="assignment-form" onChange={markFormDraftDirty} onSubmit={handleEditProject}>
                <div className="drawer-heading"><span className="drawer-icon cobalt"><BriefcaseBusiness size={19} /></span><div><h2>プロジェクトを編集</h2><p>{selectedProject.code} · 期間変更時は範囲外の配員も整合します。</p></div></div>
                <label>プロジェクト名<input required value={projectEditForm.name} onChange={(event) => setProjectEditForm({ ...projectEditForm, name: event.target.value })} /></label>
                <label>概要<textarea value={projectEditForm.summary} onChange={(event) => setProjectEditForm({ ...projectEditForm, summary: event.target.value })} rows={3} /></label>
                <div className="form-grid"><label htmlFor="project-edit-status">状態<select id="project-edit-status" aria-label="状態" value={projectEditForm.status} onChange={(event) => setProjectEditForm({ ...projectEditForm, status: event.target.value as ProjectStatus })}>{["準備中", "進行中", "要注意", "完了間近", "完了"].map((status) => <option key={status}>{status}</option>)}</select></label><label htmlFor="project-edit-owner">責任者<select id="project-edit-owner" aria-label="責任者" required value={projectEditForm.ownerId} onChange={(event) => setProjectEditForm({ ...projectEditForm, ownerId: event.target.value })}>{workspace.members.map((member) => <option value={member.id} key={member.id}>{member.name}</option>)}</select></label></div>
                <div className="form-grid"><label>開始日<input required type="date" value={projectEditForm.startDate} onChange={(event) => setProjectEditForm({ ...projectEditForm, startDate: event.target.value })} /></label><label>終了日<input required type="date" min={projectEditForm.startDate} value={projectEditForm.endDate} onChange={(event) => setProjectEditForm({ ...projectEditForm, endDate: event.target.value })} /></label></div>
                <label>次のマイルストーン<input value={projectEditForm.nextMilestone} onChange={(event) => setProjectEditForm({ ...projectEditForm, nextMilestone: event.target.value })} /></label>
                <label>マイルストーン日<input type="date" min={projectEditForm.startDate} max={projectEditForm.endDate} value={projectEditForm.nextMilestoneDate} onChange={(event) => setProjectEditForm({ ...projectEditForm, nextMilestoneDate: event.target.value })} /></label>
                <div className="form-grid"><label>進捗（%）<input required type="number" min="0" max="100" value={projectEditForm.progress} onChange={(event) => setProjectEditForm({ ...projectEditForm, progress: event.target.value })} /></label><label>必要人数<input required type="number" min="0" max="10000" value={projectEditForm.demand} onChange={(event) => setProjectEditForm({ ...projectEditForm, demand: event.target.value })} /></label></div>
                <CustomFieldInputs fields={editableCustomFields(workspace.customFields, "project", "detail")} values={projectEditForm.customValues} onChange={(customValues) => setProjectEditForm({ ...projectEditForm, customValues })} />
                <button className="drawer-primary" type="submit" disabled={!canEdit}><Check size={16} />変更を仮置き</button>
              </form>
            )}

            {drawer === "needForm" && (
              <form className="assignment-form" onChange={markFormDraftDirty} onSubmit={handleSaveNeed}>
                <div className="drawer-heading"><span className="drawer-icon mint"><UserRoundPlus size={19} /></span><div><h2>{editingNeedId ? "要員要件を編集" : "要員要件を追加"}</h2><p>必要ロール・期間・稼働配分から候補を照合します。</p></div></div>
                <label htmlFor="staffing-need-project">プロジェクト<select id="staffing-need-project" aria-label="プロジェクト" required value={needForm.projectId} onChange={(event) => setNeedForm({ ...needForm, projectId: event.target.value })}>{workspace.projects.map((project) => <option value={project.id} key={project.id}>{project.name}</option>)}</select></label>
                <label>必要ロール<input required value={needForm.role} onChange={(event) => setNeedForm({ ...needForm, role: event.target.value })} placeholder="Frontend Engineer" /></label>
                <label>必要スキル（カンマ区切り）<input value={needForm.skills} onChange={(event) => setNeedForm({ ...needForm, skills: event.target.value })} placeholder="React:3, TypeScript:2" /></label>
                <div className="form-grid"><label>開始日<input required type="date" value={needForm.startDate} onChange={(event) => setNeedForm({ ...needForm, startDate: event.target.value })} /></label><label>終了日<input required type="date" min={needForm.startDate} value={needForm.endDate} onChange={(event) => setNeedForm({ ...needForm, endDate: event.target.value })} /></label></div>
                <label>必要配分（%）<input required type="number" min="1" max="100" step="1" value={needForm.allocation} onChange={(event) => setNeedForm({ ...needForm, allocation: event.target.value })} /></label>
                <div className="form-note"><Sparkles size={15} /><span>条件変更で既存の担当者が要件を満たさなくなる場合、アサインを取消予定にして再募集します。</span></div>
                <button className="drawer-primary" type="submit" disabled={!canEdit}><Check size={16} />{editingNeedId ? "変更を仮置き" : "要員要件を追加"}</button>
              </form>
            )}

            {drawer === "opportunity" && selectedOpportunity && (
              <div className="drawer-content">
                <div className="drawer-heading"><span className={"project-code drawer-code " + selectedOpportunity.tone}>{selectedOpportunity.code}</span><div><h2>{selectedOpportunity.name}</h2><p>{selectedOpportunity.summary}</p></div></div>
                <div className="detail-facts">
                  <div><span>段階</span><strong>{OPPORTUNITY_STAGE_LABELS[selectedOpportunity.stage]}</strong></div>
                  <div><span>想定人数</span><strong>{selectedOpportunity.demand}名</strong></div>
                  <div><span>責任者</span><strong>{selectedOpportunity.ownerName ?? "未設定"}</strong></div>
                  <div><span>想定期間</span><strong>{formatDate(selectedOpportunity.startDate).replace(/^\d{4}年/, "")} — {formatDate(selectedOpportunity.endDate).replace(/^\d{4}年/, "")}</strong></div>
                </div>
                {selectedOpportunity.convertedProjectId && projectById(workspace, selectedOpportunity.convertedProjectId) && (
                  <button className="drawer-secondary" onClick={() => openProject(selectedOpportunity.convertedProjectId!)}>引き継いだプロジェクトを開く</button>
                )}
                <div className="drawer-section-title"><span>要員計画</span><small>{selectedOpportunityNeeds.length}件</small></div>
                {selectedOpportunityNeeds.length > 0 ? (
                  <div className="detail-need-list">
                    {selectedOpportunityNeeds.map((need) => (
                      <button onClick={() => setSelectedOpportunityNeedId(need.id)} key={need.id} className={need.id === selectedOpportunityNeed?.id ? "selected-need" : ""}>
                        <span><strong>{need.role}</strong><small>{formatDate(need.startDate)} — {formatDate(need.endDate)} · {need.allocation}%</small></span>
                        <em>候補を見る</em>
                        <ChevronRight size={14} />
                      </button>
                    ))}
                  </div>
                ) : <div className="candidate-empty"><UsersRound size={18} /><span><strong>要員計画はありません</strong><small>必要なロールと期間を追加できます。</small></span></div>}
                {selectedOpportunityNeed && (
                  <>
                    <div className="candidate-label"><span>{selectedOpportunityNeed.role}の候補</span><small>確定アサインにはせず、空きとスキルから検討します</small></div>
                    {opportunityCandidates.length > 0 ? (
                      <div className="candidate-list">
                        {opportunityCandidates.map((member) => (
                          <article key={member.id}>
                            <span className={"avatar " + member.avatarTone}>{member.initials}</span>
                            <span>
                              <strong>{member.name}</strong>
                              <small>{member.role} · 要件期間の最小空き {member.capacity - memberPeakLoad(workspace, member.id, selectedOpportunityNeed.startDate, selectedOpportunityNeed.endDate)}%</small>
                              <em><Check size={10} />{selectedOpportunityNeed.skills.length > 0 ? `${member.skills.filter((skill) => selectedOpportunityNeed.skills.some((neededSkill) => neededSkill.toLocaleLowerCase() === skill.toLocaleLowerCase())).join("・")}に適合` : `${selectedOpportunityNeed.role}に適合`}</em>
                            </span>
                            <button type="button" onClick={() => openMember(member.id)}>詳細</button>
                          </article>
                        ))}
                      </div>
                    ) : <div className="candidate-empty"><UsersRound size={18} /><span><strong>条件を満たす候補がいません</strong><small>メンバーのスキルまたは想定期間の配分を見直してください。</small></span></div>}
                  </>
                )}
                {canEdit && isActiveOpportunity(selectedOpportunity) && <button className="drawer-primary" onClick={() => openOpportunityNeedEditor()}><UserRoundPlus size={16} />要員計画を追加</button>}
                {canEdit && isActiveOpportunity(selectedOpportunity) && selectedOpportunityNeed && <button className="drawer-secondary" onClick={() => openOpportunityNeedEditor(selectedOpportunityNeed)}>選択中の計画を編集</button>}
                {canEdit && isActiveOpportunity(selectedOpportunity) && selectedOpportunityNeed && <button className="drawer-danger" onClick={() => cancelOpportunityNeed(selectedOpportunityNeed)}><Trash2 size={15} />選択中の計画を取消</button>}
                {canEdit && canConvertOpportunity(selectedOpportunity) && <button className="drawer-primary" onClick={convertSelectedOpportunity}><CheckCircle2 size={16} />プロジェクトへ引き継ぐ</button>}
                {canEdit && isActiveOpportunity(selectedOpportunity) && (
                  <div className="entity-action-row">
                    <button className="drawer-secondary" onClick={() => openOpportunityEditor(selectedOpportunity)}>案件情報を編集</button>
                    <button className="drawer-secondary" onClick={markOpportunityLost}>失注にする</button>
                    <button className="drawer-danger" onClick={archiveOpportunity}><Trash2 size={15} />案件を取消</button>
                  </div>
                )}
              </div>
            )}

            {drawer === "newOpportunity" && (
              <form className="assignment-form" onChange={markFormDraftDirty} onSubmit={handleCreateOpportunity}>
                <div className="drawer-heading"><span className="drawer-icon cobalt"><Inbox size={19} /></span><div><h2>受注前案件を追加</h2><p>想定期間と必要人数を先に置き、候補を検討します。</p></div></div>
                <label>案件名<input required value={opportunityForm.name} onChange={(event) => setOpportunityForm({ ...opportunityForm, name: event.target.value })} placeholder="例：北風商事 基盤刷新" /></label>
                <label>概要<textarea value={opportunityForm.summary} onChange={(event) => setOpportunityForm({ ...opportunityForm, summary: event.target.value })} rows={3} /></label>
                <div className="form-grid">
                  <label htmlFor="opportunity-new-stage">段階<select id="opportunity-new-stage" aria-label="段階" value={opportunityForm.stage} onChange={(event) => setOpportunityForm({ ...opportunityForm, stage: event.target.value as OpportunityStage })}>{(["inquiry", "proposal", "negotiation"] as const).map((stage) => <option value={stage} key={stage}>{OPPORTUNITY_STAGE_LABELS[stage]}</option>)}</select></label>
                  <label htmlFor="opportunity-new-owner">責任者<select id="opportunity-new-owner" aria-label="責任者" required value={opportunityForm.ownerId} onChange={(event) => setOpportunityForm({ ...opportunityForm, ownerId: event.target.value })}>{workspace.members.map((member) => <option value={member.id} key={member.id}>{member.name}</option>)}</select></label>
                </div>
                <div className="form-grid"><label>開始日<input required type="date" value={opportunityForm.startDate} onChange={(event) => setOpportunityForm({ ...opportunityForm, startDate: event.target.value })} /></label><label>終了日<input required type="date" min={opportunityForm.startDate} value={opportunityForm.endDate} onChange={(event) => setOpportunityForm({ ...opportunityForm, endDate: event.target.value })} /></label></div>
                <label>必要人数<input required type="number" min="0" max="10000" value={opportunityForm.demand} onChange={(event) => setOpportunityForm({ ...opportunityForm, demand: event.target.value })} /></label>
                <button className="drawer-primary" type="submit" disabled={!canEdit}><Check size={16} />受注前案件を追加</button>
              </form>
            )}

            {drawer === "editOpportunity" && selectedOpportunity && (
              <form className="assignment-form" onChange={markFormDraftDirty} onSubmit={handleEditOpportunity}>
                <div className="drawer-heading"><span className="drawer-icon cobalt"><Inbox size={19} /></span><div><h2>受注前案件を編集</h2><p>{selectedOpportunity.code} · 期間外の要員計画は取消予定になります。</p></div></div>
                <label>案件名<input required value={opportunityEditForm.name} onChange={(event) => setOpportunityEditForm({ ...opportunityEditForm, name: event.target.value })} /></label>
                <label>概要<textarea value={opportunityEditForm.summary} onChange={(event) => setOpportunityEditForm({ ...opportunityEditForm, summary: event.target.value })} rows={3} /></label>
                <div className="form-grid">
                  <label htmlFor="opportunity-edit-stage">段階<select id="opportunity-edit-stage" aria-label="段階" value={opportunityEditForm.stage} onChange={(event) => setOpportunityEditForm({ ...opportunityEditForm, stage: event.target.value as OpportunityStage })}>{(["inquiry", "proposal", "negotiation"] as const).map((stage) => <option value={stage} key={stage}>{OPPORTUNITY_STAGE_LABELS[stage]}</option>)}</select></label>
                  <label htmlFor="opportunity-edit-owner">責任者<select id="opportunity-edit-owner" aria-label="責任者" required value={opportunityEditForm.ownerId} onChange={(event) => setOpportunityEditForm({ ...opportunityEditForm, ownerId: event.target.value })}>{workspace.members.map((member) => <option value={member.id} key={member.id}>{member.name}</option>)}</select></label>
                </div>
                <div className="form-grid"><label>開始日<input required type="date" value={opportunityEditForm.startDate} onChange={(event) => setOpportunityEditForm({ ...opportunityEditForm, startDate: event.target.value })} /></label><label>終了日<input required type="date" min={opportunityEditForm.startDate} value={opportunityEditForm.endDate} onChange={(event) => setOpportunityEditForm({ ...opportunityEditForm, endDate: event.target.value })} /></label></div>
                <label>必要人数<input required type="number" min="0" max="10000" value={opportunityEditForm.demand} onChange={(event) => setOpportunityEditForm({ ...opportunityEditForm, demand: event.target.value })} /></label>
                <button className="drawer-primary" type="submit" disabled={!canEdit}><Check size={16} />変更を仮置き</button>
              </form>
            )}

            {drawer === "opportunityNeedForm" && (
              <form className="assignment-form" onChange={markFormDraftDirty} onSubmit={handleSaveOpportunityNeed}>
                <div className="drawer-heading"><span className="drawer-icon mint"><UserRoundPlus size={19} /></span><div><h2>{editingOpportunityNeedId ? "要員計画を編集" : "要員計画を追加"}</h2><p>受注前の必要ロールと期間から候補を照合します。</p></div></div>
                <label htmlFor="opportunity-need-parent">案件<select id="opportunity-need-parent" aria-label="案件" required value={opportunityNeedForm.opportunityId} onChange={(event) => setOpportunityNeedForm({ ...opportunityNeedForm, opportunityId: event.target.value })}>{(workspace.opportunities ?? []).filter(isActiveOpportunity).map((opportunity) => <option value={opportunity.id} key={opportunity.id}>{opportunity.name}</option>)}</select></label>
                <label>必要ロール<input required value={opportunityNeedForm.role} onChange={(event) => setOpportunityNeedForm({ ...opportunityNeedForm, role: event.target.value })} placeholder="Frontend Engineer" /></label>
                <label>必要スキル（カンマ区切り）<input value={opportunityNeedForm.skills} onChange={(event) => setOpportunityNeedForm({ ...opportunityNeedForm, skills: event.target.value })} placeholder="React:3, TypeScript:2" /></label>
                <div className="form-grid"><label>開始日<input required type="date" value={opportunityNeedForm.startDate} onChange={(event) => setOpportunityNeedForm({ ...opportunityNeedForm, startDate: event.target.value })} /></label><label>終了日<input required type="date" min={opportunityNeedForm.startDate} value={opportunityNeedForm.endDate} onChange={(event) => setOpportunityNeedForm({ ...opportunityNeedForm, endDate: event.target.value })} /></label></div>
                <label>必要配分（%）<input required type="number" min="1" max="100" step="1" value={opportunityNeedForm.allocation} onChange={(event) => setOpportunityNeedForm({ ...opportunityNeedForm, allocation: event.target.value })} /></label>
                <button className="drawer-primary" type="submit" disabled={!canEdit}><Check size={16} />{editingOpportunityNeedId ? "変更を仮置き" : "要員計画を追加"}</button>
              </form>
            )}

            {drawer === "newProject" && (
              <form className="assignment-form" onChange={markFormDraftDirty} onSubmit={handleCreateProject}>
                <div className="drawer-heading"><span className="drawer-icon cobalt"><BriefcaseBusiness size={19} /></span><div><h2>プロジェクトを追加</h2><p>一覧へ追加し、後から配員を設定します。</p></div></div>
                <label>プロジェクト名<input required value={projectForm.name} onChange={(event) => setProjectForm({ ...projectForm, name: event.target.value })} placeholder="例：顧客ポータル刷新" /></label>
                <label htmlFor="project-new-status">状態<select id="project-new-status" aria-label="状態" value={projectForm.status} onChange={(event) => setProjectForm({ ...projectForm, status: event.target.value as ProjectStatus })}>{["準備中", "進行中", "要注意", "完了間近"].map((status) => <option key={status}>{status}</option>)}</select></label>
                <label htmlFor="project-new-owner">責任者<select id="project-new-owner" aria-label="責任者" value={projectForm.ownerId} onChange={(event) => setProjectForm({ ...projectForm, ownerId: event.target.value })}>{workspace.members.map((member) => <option value={member.id} key={member.id}>{member.name}</option>)}</select></label>
                <label>完了予定<input required type="date" min={days[0].iso} value={projectForm.endDate} onChange={(event) => setProjectForm({ ...projectForm, endDate: event.target.value })} /></label>
                <button className="drawer-primary" type="submit" disabled={!canEdit}><Check size={16} />プロジェクトを追加</button>
              </form>
            )}

            {drawer === "newMember" && (
              <form className="assignment-form" onChange={markFormDraftDirty} onSubmit={handleCreateMember}>
                <div className="drawer-heading"><span className="drawer-icon mint"><UserRoundPlus size={19} /></span><div><h2>メンバーを追加</h2><p>職種と所属を登録します。</p></div></div>
                <label>氏名<input required value={memberForm.name} onChange={(event) => setMemberForm({ ...memberForm, name: event.target.value })} placeholder="例：山田 花子" /></label>
                <label htmlFor="member-new-role">職種<select id="member-new-role" aria-label="職種" value={memberForm.role} onChange={(event) => setMemberForm({ ...memberForm, role: event.target.value })}>{["Frontend Engineer", "Backend Engineer", "QA Engineer", "Product Designer", "Project Manager", "Data Analyst"].map((role) => <option key={role}>{role}</option>)}</select></label>
                {(workspace.orgUnits ?? []).length === 0 && (
                  <label htmlFor="member-new-department">部署<select id="member-new-department" aria-label="部署" value={memberForm.department} onChange={(event) => setMemberForm({ ...memberForm, department: event.target.value })}>{["プロダクト開発", "プラットフォーム", "品質保証", "デザイン", "事業推進", "データ戦略"].map((department) => <option key={department}>{department}</option>)}</select></label>
                )}
                <MemberOrgFields
                  units={workspace.orgUnits ?? []}
                  primaryUnitId={memberForm.primaryUnitId}
                  extraUnitIds={memberForm.extraUnitIds}
                  managerUnitIds={memberForm.managerUnitIds}
                  onChange={(org) => setMemberForm({ ...memberForm, ...org, department: (workspace.orgUnits ?? []).find((unit) => unit.id === org.primaryUnitId)?.name ?? memberForm.department })}
                />
                <label htmlFor="member-new-location">勤務地<select id="member-new-location" aria-label="勤務地" value={memberForm.location} onChange={(event) => setMemberForm({ ...memberForm, location: event.target.value })}>{["東京", "大阪", "福岡", "リモート"].map((location) => <option key={location}>{location}</option>)}</select></label>
                <label>スキル（カンマ区切り）<input value={memberForm.skills} onChange={(event) => setMemberForm({ ...memberForm, skills: event.target.value })} placeholder="React:4, TypeScript:3, A11y" /></label>
                <label>稼働上限（%）<input required type="number" min="0" max="100" step="1" value={memberForm.capacity} onChange={(event) => setMemberForm({ ...memberForm, capacity: event.target.value })} /></label>
                <CustomFieldInputs fields={editableCustomFields(workspace.customFields, "member", "detail")} values={memberForm.customValues} onChange={(customValues) => setMemberForm({ ...memberForm, customValues })} />
                <WorkHistoryEditor entries={memberForm.workHistory} onChange={(workHistory) => setMemberForm({ ...memberForm, workHistory })} />
                <button className="drawer-primary" type="submit" disabled={!canManageMembers}><Check size={16} />メンバーを追加</button>
              </form>
            )}
          </section>
        </div>
      )}

      <AiChat
        transport={aiChatTransport}
        organizationId={organizationId}
        hasLocalChanges={unsavedChanges > 0 || formDirty}
        organizationRole={role}
        syncBusy={operationLocked || saveOutcomePending}
        onActionBusyChange={setAiActionBusy}
        onWorkspaceRevision={handleAiWorkspaceRevision}
        suspended={Boolean(drawer)}
        elevated={unsavedChanges > 0}
        unavailableReason={mode === "demo" ? "AIチャットは、共有モードでログインすると利用できます。" : undefined}
      />
      <div className={"toast " + (toast ? "show" : "")} role="status" aria-live="polite"><Check size={14} />{toast}</div>
      {!hydrated && <span className="sr-only">保存データを読み込み中</span>}
    </main>
  );
}
