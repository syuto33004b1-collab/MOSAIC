import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  Bell,
  BriefcaseBusiness,
  CalendarDays,
  ChartNoAxesCombined,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock3,
  FolderKanban,
  LayoutDashboard,
  MoreHorizontal,
  Plus,
  Save,
  Search,
  SlidersHorizontal,
  Sparkles,
  Undo2,
  UserRoundPlus,
  UsersRound,
  X,
} from "lucide-react";
import { MembersView, ProjectsView, ReportsView } from "./expanded-views";
import {
  addDays,
  assignmentGrid,
  formatDate,
  getWeekDays,
  getWeekStart,
  initialWorkspace,
  makeInitials,
  memberById,
  memberLoad,
  overlaps,
  projectById,
  projectMembers,
  projectTone,
  weekEnd,
  type Assignment,
  type AvatarTone,
  type Project,
  type ProjectStatus,
  type StaffingNeed,
  type Tone,
  type WorkspaceState,
} from "./domain";

type Drawer = "add" | "overload" | "openRole" | "project" | "member" | "newProject" | "newMember" | null;

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
  { id: "members", label: "メンバー", icon: UsersRound },
  { id: "reports", label: "レポート", icon: ChartNoAxesCombined },
];

const pageMeta = {
  board: { eyebrow: "RESOURCE PLANNING", title: "今週のチーム編成", description: "日ごとの重なりと、週全体の余白を確認します。" },
  projects: { eyebrow: "PORTFOLIO CONTROL", title: "プロジェクト・ポートフォリオ", description: "案件ごとの充足と次の節目を横断して管理します。" },
  members: { eyebrow: "TEAM AVAILABILITY", title: "メンバーと空き状況", description: "スキルと4週間の余白から、次の担当者を探します。" },
  reports: { eyebrow: "CAPACITY FORECAST", title: "キャパシティ予測", description: "需給の変化と、判断が必要な例外を見通します。" },
} as const;

const storageKey = "mosaic-local-workspace-v3";

function cloneState(state: WorkspaceState): WorkspaceState {
  return JSON.parse(JSON.stringify(state)) as WorkspaceState;
}

export default function Home() {
  const [workspace, setWorkspace] = useState<WorkspaceState>(initialWorkspace);
  const [committedWorkspace, setCommittedWorkspace] = useState<WorkspaceState>(initialWorkspace);
  const [activeNav, setActiveNav] = useState<keyof typeof pageMeta>("board");
  const [viewMode, setViewMode] = useState<"members" | "projects">("members");
  const [weekOffset, setWeekOffset] = useState(0);
  const [filter, setFilter] = useState("すべて");
  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [drawer, setDrawer] = useState<Drawer>(null);
  const [selectedProjectId, setSelectedProjectId] = useState("atlas");
  const [selectedMemberId, setSelectedMemberId] = useState("saeki");
  const [toast, setToast] = useState("");
  const [unsavedChanges, setUnsavedChanges] = useState(0);
  const [hydrated, setHydrated] = useState(false);
  const [form, setForm] = useState({ personId: "saeki", projectId: "atlas", startIndex: "1", duration: "3", allocation: "40" });
  const [projectForm, setProjectForm] = useState({ name: "", status: "準備中" as ProjectStatus, endDate: "2026-10-30", ownerId: "hayashi" });
  const [memberForm, setMemberForm] = useState({ name: "", role: "Frontend Engineer", department: "プロダクト開発", location: "東京" });
  const drawerRef = useRef<HTMLElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        const saved = window.localStorage.getItem(storageKey);
        if (saved) {
          const parsed = JSON.parse(saved) as WorkspaceState;
          if (Array.isArray(parsed.members) && Array.isArray(parsed.assignments)) {
            setWorkspace(parsed);
            setCommittedWorkspace(cloneState(parsed));
          }
        }
      } catch {
        window.localStorage.removeItem(storageKey);
      }
      setHydrated(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 3200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    if (!drawer) return;
    previousFocus.current = document.activeElement as HTMLElement;
    document.body.style.overflow = "hidden";
    window.setTimeout(() => drawerRef.current?.focus(), 0);
    const trapFocus = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const elements = drawerRef.current?.querySelectorAll<HTMLElement>("button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex='-1'])");
      if (!elements || elements.length === 0) return;
      const first = elements[0];
      const last = elements[elements.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
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
        setDrawer(null);
        setNotificationsOpen(false);
      }
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, []);

  const days = useMemo(() => getWeekDays(weekOffset), [weekOffset]);
  const weekStart = getWeekStart(weekOffset);
  const currentWeekStart = getWeekStart(0);
  const currentLoads = workspace.members.map((member) => memberLoad(workspace, member.id, currentWeekStart));
  const averageLoad = Math.round(currentLoads.reduce((sum, load) => sum + load, 0) / currentLoads.length);
  const freeDays = (currentLoads.reduce((sum, load) => sum + Math.max(0, 100 - load), 0) / 100 * 5).toFixed(1);
  const currentOverloads = workspace.members.filter((member) => memberLoad(workspace, member.id, currentWeekStart) > member.capacity);
  const committedOverloads = committedWorkspace.members.filter((member) => memberLoad(committedWorkspace, member.id, currentWeekStart) > member.capacity);
  const overloadPlanned = committedOverloads.some((member) => member.id === "suzuki") && memberLoad(workspace, "suzuki", currentWeekStart) <= 100;
  const activeNeeds = workspace.needs.filter((need) => need.status !== "filled");
  const displayNeed = activeNeeds[0];
  const adjustmentCount = currentOverloads.length + (overloadPlanned ? 1 : 0) + activeNeeds.length;
  const page = pageMeta[activeNav];
  const selectedProject = projectById(workspace, selectedProjectId);
  const selectedMember = memberById(workspace, selectedMemberId);

  const memberRows: ScheduleRow[] = workspace.members.map((member) => {
    const load = memberLoad(workspace, member.id, weekStart);
    const assignments = workspace.assignments.flatMap((assignment) => {
      if (assignment.personId !== member.id) return [];
      const grid = assignmentGrid(assignment, weekStart);
      if (!grid) return [];
      const project = projectById(workspace, assignment.projectId);
      return [{
        id: assignment.id,
        name: assignment.label || project?.name || "休暇",
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
      const grid = assignmentGrid(assignment, weekStart);
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
    const staffed = projectMembers(workspace, project.id, weekStart);
    return {
      id: project.id,
      initials: project.code.slice(0, 2),
      name: project.name,
      role: project.summary,
      avatarTone: project.status === "要注意" ? "peach" : project.status === "準備中" ? "sky" : "lavender",
      tagLabel: staffed + "/" + project.demand + "名",
      alert: staffed < project.demand,
      filterKey: project.status,
      assignments,
    };
  });

  const rows = (viewMode === "members" ? memberRows : projectRows).filter((row) => {
    const queryMatch = (row.name + " " + row.role + " " + row.assignments.map((item) => item.name).join(" ")).toLowerCase().includes(query.toLowerCase());
    const filterMatch = filter === "すべて" || row.filterKey === filter;
    return queryMatch && filterMatch;
  });

  const weekLabel = days[0].month + "月" + days[0].date + "日 — " + days[4].month + "月" + days[4].date + "日";

  const changeView = (mode: "members" | "projects") => {
    setViewMode(mode);
    setFilter("すべて");
  };

  const openProject = (projectId: string) => {
    setSelectedProjectId(projectId);
    setDrawer("project");
  };

  const openMember = (memberId: string) => {
    setSelectedMemberId(memberId);
    setDrawer("member");
  };

  const openAssignmentFor = (memberId: string) => {
    setForm((current) => ({ ...current, personId: memberId }));
    setDrawer("add");
  };

  const handleAddAssignment = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const startDate = days[Number(form.startIndex) - 1]?.iso || days[0].iso;
    const assignment: Assignment = {
      id: "assignment-" + Date.now(),
      personId: form.personId,
      projectId: form.projectId,
      startDate,
      endDate: addDays(startDate, Number(form.duration) - 1),
      allocation: Number(form.allocation),
      status: "draft",
    };
    setWorkspace((current) => ({ ...current, assignments: [...current.assignments, assignment] }));
    setUnsavedChanges((count) => count + 1);
    setDrawer(null);
    setToast((memberById(workspace, form.personId)?.name || "メンバー") + "さんへ仮置きしました");
  };

  const resolveOverload = () => {
    if (memberLoad(workspace, "suzuki", currentWeekStart) <= 100) {
      setToast("鈴木 健太さんの超過はすでに解消予定です");
      return;
    }
    setWorkspace((current) => ({
      ...current,
      assignments: current.assignments.map((assignment) =>
        assignment.id === "a6" ? { ...assignment, allocation: Math.max(0, assignment.allocation - 20), status: "draft" } : assignment
      ),
    }));
    setUnsavedChanges((count) => count + 1);
    setDrawer(null);
    setToast("Atlasの配分を20%減らし、100%に調整しました");
  };

  const placeCandidate = (personId: string, need: StaffingNeed) => {
    if (need.status !== "open") {
      setToast("この不足ロールはすでに解消予定です");
      return;
    }
    const assignment: Assignment = {
      id: "need-assignment-" + need.id,
      personId,
      projectId: need.projectId,
      startDate: need.startDate,
      endDate: need.endDate,
      allocation: need.allocation,
      status: "draft",
    };
    setWorkspace((current) => ({
      ...current,
      assignments: [...current.assignments, assignment],
      needs: current.needs.map((item) => item.id === need.id ? { ...item, status: "planned", draftPersonId: personId } : item),
    }));
    setUnsavedChanges((count) => count + 1);
    setDrawer(null);
    setToast((memberById(workspace, personId)?.name || "候補者") + "さんを" + need.allocation + "%で翌週へ仮置きしました");
  };

  const undoChanges = () => {
    setWorkspace(cloneState(committedWorkspace));
    setUnsavedChanges(0);
    setToast("未保存の変更だけを元に戻しました");
  };

  const saveChanges = () => {
    const count = unsavedChanges;
    const saved: WorkspaceState = {
      ...workspace,
      assignments: workspace.assignments.map((assignment) => assignment.status === "draft" ? { ...assignment, status: "confirmed" } : assignment),
      needs: workspace.needs.map((need) => need.status === "planned" ? { ...need, status: "filled" } : need),
    };
    setWorkspace(saved);
    setCommittedWorkspace(cloneState(saved));
    window.localStorage.setItem(storageKey, JSON.stringify(saved));
    setUnsavedChanges(0);
    setToast(count + "件の変更をこの端末に保存しました");
  };

  const handleCreateProject = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const owner = memberById(workspace, projectForm.ownerId) || workspace.members[0];
    const id = "project-" + Date.now();
    const project: Project = {
      id,
      code: projectForm.name.replace(/[^A-Za-z]/g, "").slice(0, 3).toUpperCase() || "NEW",
      name: projectForm.name,
      summary: "新しく追加したプロジェクト",
      status: projectForm.status,
      tone: "blue",
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
    setUnsavedChanges((count) => count + 1);
    setProjectForm({ name: "", status: "準備中", endDate: "2026-10-30", ownerId: "hayashi" });
    setDrawer(null);
    setToast(project.name + "を追加しました");
  };

  const handleCreateMember = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const id = "member-" + Date.now();
    setWorkspace((current) => ({
      ...current,
      members: [...current.members, {
        id,
        initials: makeInitials(memberForm.name),
        name: memberForm.name,
        role: memberForm.role,
        department: memberForm.department,
        avatarTone: "lavender",
        skills: [memberForm.role.split(" ")[0], "New member"],
        location: memberForm.location,
        capacity: 100,
      }],
    }));
    setUnsavedChanges((count) => count + 1);
    setMemberForm({ name: "", role: "Frontend Engineer", department: "プロダクト開発", location: "東京" });
    setDrawer(null);
    setToast("新しいメンバーを追加しました");
  };

  const openWeekFromReport = (offset: number) => {
    setWeekOffset(offset);
    setActiveNav("board");
    setViewMode("members");
  };

  const primaryAction = () => {
    if (activeNav === "board") setDrawer("add");
    if (activeNav === "projects") setDrawer("newProject");
    if (activeNav === "members") setDrawer("newMember");
    if (activeNav === "reports") openWeekFromReport(0);
  };

  return (
    <main className="app-shell">
      <aside className="sidebar" inert={drawer ? true : undefined}>
        <div className="brand"><span className="brand-mark" aria-hidden="true"><i /><i /><i /><i /></span><span>MOSAIC</span></div>
        <div className="workspace-mode"><span>LOCAL</span><small>個人プレビュー</small></div>

        <nav className="primary-nav" aria-label="メインナビゲーション">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = activeNav === item.id;
            return (
              <button className={"nav-item " + (active ? "active" : "")} aria-label={item.label} aria-current={active ? "page" : undefined} onClick={() => setActiveNav(item.id as keyof typeof pageMeta)} key={item.id}>
                <span className="nav-icon"><Icon size={18} strokeWidth={1.8} /></span><span className="nav-label">{item.label}</span>
                {item.id === "projects" && <span className="nav-count">{workspace.projects.length}</span>}
              </button>
            );
          })}
        </nav>

        <div className="sidebar-spacer" />
        <div className="month-card">
          <div className="month-card-label"><span>8月のチーム稼働</span><strong>{averageLoad}%</strong></div>
          <div className="month-track"><span style={{ width: Math.min(100, averageLoad) + "%" }} /></div>
          <p>余力はあと {Math.max(0, 100 - averageLoad)}%。変更はこの端末だけに保存されます。</p>
        </div>
        <div className="profile-row">
          <span className="avatar avatar-dark">TM</span><span><strong>田中 美穂</strong><small>リソースマネージャー</small></span>
          <button aria-label="アカウントメニュー"><MoreHorizontal size={17} /></button>
        </div>
      </aside>

      <section className="workspace" id="board" inert={drawer ? true : undefined}>
        <header className="topbar">
          <div>
            <p className="eyebrow">{page.eyebrow} <span>/</span> {activeNav === "board" ? "WEEK " + (34 + weekOffset) : "MOSAIC"}</p>
            <h1>{page.title}</h1>
            <p className="date-range">{activeNav === "board" ? days[0].year + "年 " + weekLabel : page.description}</p>
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
                  {(currentOverloads.length > 0 || overloadPlanned) && <button onClick={() => { setDrawer("overload"); setNotificationsOpen(false); }}><span className={"notice-icon " + (overloadPlanned ? "planned" : "danger")}><AlertTriangle size={14} /></span><span><strong>{overloadPlanned ? "稼働超過は解消予定" : "稼働超過を検知"}</strong><small>鈴木 健太さん · 今週</small></span></button>}
                  {displayNeed && <button onClick={() => { setDrawer("openRole"); setNotificationsOpen(false); }}><span className={"notice-icon " + (displayNeed.status === "planned" ? "planned" : "info")}><UserRoundPlus size={14} /></span><span><strong>{displayNeed.status === "planned" ? "不足ロールは解消予定" : displayNeed.role + "担当が未定"}</strong><small>{projectById(workspace, displayNeed.projectId)?.name} · {formatDate(displayNeed.startDate)}</small></span></button>}
                </div>
              )}
            </div>
            <button className="primary-button" onClick={primaryAction}>
              {activeNav === "board" && <Plus size={16} />}{activeNav === "projects" && <BriefcaseBusiness size={16} />}{activeNav === "members" && <UserRoundPlus size={16} />}{activeNav === "reports" && <LayoutDashboard size={16} />}
              {activeNav === "board" ? "アサインを追加" : activeNav === "projects" ? "プロジェクトを追加" : activeNav === "members" ? "メンバーを追加" : "ボードで調整"}
            </button>
          </div>
        </header>

        {activeNav === "board" && (
          <>
            <section className="pulse-strip" aria-label="チームの稼働サマリー">
              <div className="pulse-heading"><span className="live-dot" /><div><small>TEAM PULSE</small><strong>チームの余白</strong></div></div>
              <div className="pulse-metric"><strong>{averageLoad}<small>%</small></strong><span>平均稼働率</span></div>
              <div className="pulse-rule" />
              <div className="pulse-metric"><strong>{freeDays}<small>人日</small></strong><span>今週の空き</span></div>
              <div className="pulse-rule" />
              <button className="pulse-metric warning" onClick={() => adjustmentCount > 0 && setDrawer(currentOverloads.length > 0 || overloadPlanned ? "overload" : "openRole")}><strong>{adjustmentCount}<small>件</small></strong><span>要調整</span><ArrowRight size={14} /></button>
              <div className="pulse-mini-bars" aria-label="曜日別のチーム稼働率">{[72, 84, 91, 78, 64].map((height, index) => <i key={index} style={{ height: height + "%" }} />)}</div>
            </section>

            <div className="board-layout">
              <section className="schedule-card" aria-label="週間アサイン表">
                <div className="schedule-toolbar">
                  <div className="view-tabs" aria-label="表示切替">
                    <button className={viewMode === "members" ? "selected" : ""} aria-pressed={viewMode === "members"} onClick={() => changeView("members")}><UsersRound size={13} />メンバー</button>
                    <button className={viewMode === "projects" ? "selected" : ""} aria-pressed={viewMode === "projects"} onClick={() => changeView("projects")}><BriefcaseBusiness size={13} />プロジェクト</button>
                  </div>
                  <div className="toolbar-actions">
                    <label className="filter-select"><SlidersHorizontal size={13} /><select aria-label={viewMode === "members" ? "職種で絞り込み" : "状態で絞り込み"} value={filter} onChange={(event) => setFilter(event.target.value)}>
                      <option value="すべて">{viewMode === "members" ? "すべての職種" : "すべての状態"}</option>
                      {(viewMode === "members" ? Array.from(new Set(workspace.members.map((member) => member.role))) : ["進行中", "要注意", "準備中", "完了間近"]).map((option) => <option key={option}>{option}</option>)}
                    </select></label>
                    <button onClick={() => setWeekOffset(0)}><CalendarDays size={13} />今日</button>
                    <button className="arrow-button" aria-label="前の週" onClick={() => setWeekOffset((offset) => offset - 1)}><ChevronLeft size={16} /></button>
                    <button className="arrow-button" aria-label="次の週" onClick={() => setWeekOffset((offset) => offset + 1)}><ChevronRight size={16} /></button>
                  </div>
                </div>

                <div className="schedule-scroller">
                  <div className="schedule-table">
                    <div className="schedule-head" role="row">
                      <div className="people-label" role="columnheader">{viewMode === "members" ? "メンバー" : "プロジェクト"} <span>{rows.length}</span></div>
                      {days.map((day, index) => <div className={"day-label " + (index === 0 && weekOffset === 0 ? "today" : "")} role="columnheader" key={day.iso}><span>{day.day}</span><strong>{day.date}</strong></div>)}
                    </div>
                    <div className="schedule-body">
                      {rows.length > 0 ? rows.map((row) => (
                        <div className="schedule-row" role="row" key={row.id}>
                          <div className="person-cell" role="rowheader">
                            <span className={"avatar " + row.avatarTone}>{row.initials}</span><span className="person-copy"><strong>{row.name}</strong><small>{row.role}</small></span><span className={"load " + (row.alert ? "over" : "")}>{row.tagLabel}</span>
                          </div>
                          <div className="week-cell" role="gridcell" aria-label={row.name + "のアサイン"}>
                            <div className="day-grid" aria-hidden="true">{[0, 1, 2, 3, 4].map((index) => <i key={index} />)}</div>
                            {row.assignments.map((assignment) => (
                              <button className={"assignment " + assignment.tone + (assignment.status === "draft" ? " provisional" : "")} style={{ gridColumn: assignment.start + " / span " + assignment.span }} onClick={() => assignment.projectId !== "leave" ? openProject(assignment.projectId) : setToast("休暇 · " + assignment.allocation + "%")} title={assignment.name + " · " + assignment.allocation + "%"} key={assignment.id}>
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
                {(currentOverloads.length > 0 || overloadPlanned) && (
                  <button className={"alert-card urgent " + (overloadPlanned ? "planned" : "")} onClick={() => setDrawer("overload")}>
                    <div className="alert-top"><span>{overloadPlanned ? <CheckCircle2 size={11} /> : <AlertTriangle size={11} />} {overloadPlanned ? "RESOLUTION PLANNED" : "OVER CAPACITY"}</span><small>{memberLoad(workspace, "suzuki", currentWeekStart)}%</small></div>
                    <h3>{overloadPlanned ? "鈴木さんの超過は解消予定" : "鈴木さんの稼働が超過"}</h3><p>{overloadPlanned ? "変更を保存すると警告が解消されます。" : "木・金曜日に2つのプロジェクトが重なっています。"}</p>
                    <div className="alert-people"><span className="avatar sky">KS</span><span>{overloadPlanned ? "内容を確認" : "調整する"} <ArrowRight size={13} /></span></div>
                  </button>
                )}
                {displayNeed && (
                  <button className={"alert-card " + (displayNeed.status === "planned" ? "planned" : "")} onClick={() => setDrawer("openRole")}>
                    <div className="alert-top"><span>{displayNeed.status === "planned" ? <CheckCircle2 size={11} /> : <Clock3 size={11} />} {displayNeed.status === "planned" ? "RESOLUTION PLANNED" : "OPEN ROLE"}</span><small>{formatDate(displayNeed.startDate).replace("2026年", "")}</small></div>
                    <h3>{projectById(workspace, displayNeed.projectId)?.name}の{displayNeed.role}が{displayNeed.status === "planned" ? "解消予定" : "未定"}</h3><p>{displayNeed.status === "planned" ? "候補者を仮置きしました。保存後に充足へ変わります。" : displayNeed.allocation + "%の担当者を開始日までに決めてください。"}</p>
                    <div className="skill-chips">{displayNeed.skills.map((skill) => <span key={skill}>{skill}</span>)}<ArrowRight size={13} /></div>
                  </button>
                )}
                {adjustmentCount === 0 && <div className="attention-clear"><CheckCircle2 size={20} /><strong>調整項目はありません</strong><p>すべての稼働と要員要件が範囲内です。</p></div>}
                <button className="all-alerts" onClick={() => setActiveNav("reports")}>レポートで見通しを確認 <ArrowRight size={13} /></button>
              </aside>
            </div>
          </>
        )}

        {activeNav === "projects" && <ProjectsView state={workspace} weekOffset={weekOffset} onOpen={openProject} onCreate={() => setDrawer("newProject")} />}
        {activeNav === "members" && <MembersView state={workspace} weekOffset={weekOffset} onOpen={openMember} onAdd={() => setDrawer("newMember")} onAssign={openAssignmentFor} />}
        {activeNav === "reports" && <ReportsView state={workspace} onOpenWeek={openWeekFromReport} onResolveNeed={() => displayNeed && setDrawer("openRole")} />}
      </section>

      {unsavedChanges > 0 && (
        <div className="change-bar" role="status" inert={drawer ? true : undefined}>
          <span className="change-count">{unsavedChanges}</span><span><strong>{unsavedChanges}件の変更があります</strong><small>保存するまで確定データには反映されません</small></span>
          <button className="undo-button" onClick={undoChanges}><Undo2 size={14} />元に戻す</button><button className="save-button" onClick={saveChanges}><Save size={14} />この端末に保存</button>
        </div>
      )}

      {drawer && (
        <div className="overlay">
          <button className="overlay-backdrop" aria-label="詳細パネルを閉じる" onClick={() => setDrawer(null)} />
          <section className="drawer" ref={drawerRef} role="dialog" aria-modal="true" aria-label="詳細パネル" tabIndex={-1}>
            <div className="drawer-handle" />
            <div className="drawer-top"><span className="drawer-kicker">{drawer === "add" ? "NEW ASSIGNMENT" : drawer === "newProject" ? "NEW PROJECT" : drawer === "newMember" ? "NEW MEMBER" : drawer === "project" ? "PROJECT DETAIL" : drawer === "member" ? "MEMBER PROFILE" : "RESOLUTION GUIDE"}</span><button className="close-button" aria-label="詳細パネルを閉じる" onClick={() => setDrawer(null)}><X size={18} /></button></div>

            {drawer === "add" && (
              <form className="assignment-form" onSubmit={handleAddAssignment}>
                <div className="drawer-heading"><span className="drawer-icon cobalt"><Plus size={19} /></span><div><h2>アサインを追加</h2><p>日付と稼働配分を仮置きします。</p></div></div>
                <label>メンバー<select value={form.personId} onChange={(event) => setForm({ ...form, personId: event.target.value })}>{workspace.members.map((member) => <option value={member.id} key={member.id}>{member.name} · この週 {memberLoad(workspace, member.id, weekStart)}%</option>)}</select></label>
                <label>プロジェクト<select value={form.projectId} onChange={(event) => setForm({ ...form, projectId: event.target.value })}>{workspace.projects.map((project) => <option value={project.id} key={project.id}>{project.name}</option>)}</select></label>
                <div className="form-grid">
                  <label>開始日<select value={form.startIndex} onChange={(event) => setForm({ ...form, startIndex: event.target.value })}>{days.map((day, index) => <option value={index + 1} key={day.iso}>{day.month}/{day.date}（{day.day}）</option>)}</select></label>
                  <label>日数<select value={form.duration} onChange={(event) => setForm({ ...form, duration: event.target.value })}>{[1, 2, 3, 4, 5].map((day) => <option value={day} key={day}>{day}日</option>)}</select></label>
                </div>
                <label>稼働配分<div className="allocation-input"><input type="range" min="10" max="100" step="10" value={form.allocation} onChange={(event) => setForm({ ...form, allocation: event.target.value })} /><output>{form.allocation}%</output></div></label>
                <div className="form-note"><Sparkles size={15} /><span>保存前は斜線付きの「仮置き」で表示します。</span></div><button className="drawer-primary" type="submit"><Check size={16} />この内容で仮置きする</button>
              </form>
            )}

            {drawer === "overload" && (
              <div className="drawer-content">
                <div className="drawer-heading"><span className={"drawer-icon " + (overloadPlanned ? "mint" : "coral")}>{overloadPlanned ? <CheckCircle2 size={19} /> : <AlertTriangle size={19} />}</span><div><h2>{overloadPlanned ? "解消予定を確認" : "稼働超過を調整"}</h2><p>鈴木 健太さん · Backend Engineer</p></div></div>
                <div className={"capacity-card " + (overloadPlanned ? "resolved" : "")}><div><span>今週の稼働</span><strong>{memberLoad(workspace, "suzuki", currentWeekStart)}%</strong></div><div className="capacity-meter"><span style={{ width: Math.min(100, memberLoad(workspace, "suzuki", currentWeekStart)) + "%" }} /><i>100%</i></div><p>{overloadPlanned ? "保存すると超過警告が解消されます。" : "推奨上限を20%超えています。木・金曜日に作業が重複しています。"}</p></div>
                <div className="drawer-section-title"><span>現在の配分</span><small>合計 {memberLoad(workspace, "suzuki", currentWeekStart)}%</small></div>
                <div className="allocation-list">{workspace.assignments.filter((assignment) => assignment.personId === "suzuki" && overlaps(assignment.startDate, assignment.endDate, currentWeekStart, weekEnd(currentWeekStart))).map((assignment) => <div key={assignment.id}><span className={"project-dot " + (projectById(workspace, assignment.projectId)?.tone || "blue")} /><span><strong>{projectById(workspace, assignment.projectId)?.name}</strong><small>{formatDate(assignment.startDate)} — {formatDate(assignment.endDate)}</small></span><b>{assignment.allocation}%</b></div>)}</div>
                {!overloadPlanned ? <><div className="suggestion-card"><span><Sparkles size={15} /></span><div><strong>おすすめの調整</strong><p>Atlasの配分を30%にすると、今週の稼働が100%になります。</p></div></div><button className="drawer-primary" onClick={resolveOverload}><CheckCircle2 size={16} />Atlasの配分を20%減らす</button></> : <button className="drawer-primary" onClick={() => setDrawer(null)}><Check size={16} />保存前の内容に戻る</button>}
              </div>
            )}

            {drawer === "openRole" && displayNeed && (
              <div className="drawer-content">
                <div className="drawer-heading"><span className={"drawer-icon " + (displayNeed.status === "planned" ? "cobalt" : "mint")}><UserRoundPlus size={19} /></span><div><h2>{displayNeed.status === "planned" ? "解消予定の担当者" : displayNeed.role + "の候補"}</h2><p>{projectById(workspace, displayNeed.projectId)?.name} · {formatDate(displayNeed.startDate)}開始</p></div></div>
                <div className="role-brief"><span>必要な条件</span><div>{displayNeed.skills.map((skill) => <b key={skill}>{skill}</b>)}<b>{displayNeed.allocation}%の空き</b></div></div>
                {displayNeed.status === "planned" ? (
                  <div className="planned-candidate"><CheckCircle2 size={20} /><span><strong>{memberById(workspace, displayNeed.draftPersonId || "")?.name}さんを仮置き済み</strong><small>{displayNeed.allocation}% · {formatDate(displayNeed.startDate)} — {formatDate(displayNeed.endDate)}</small></span></div>
                ) : (
                  <>
                    <div className="candidate-label"><span>条件に合うメンバー</span><small>対象週の空きとスキルから算出</small></div>
                    <div className="candidate-list">{workspace.members.filter((member) => displayNeed.skills.some((skill) => member.skills.includes(skill)) && member.capacity - memberLoad(workspace, member.id, displayNeed.startDate) >= displayNeed.allocation).slice(0, 3).map((member) => <article key={member.id}><span className={"avatar " + member.avatarTone}>{member.initials}</span><span><strong>{member.name}</strong><small>{member.role} · 対象週の空き {member.capacity - memberLoad(workspace, member.id, displayNeed.startDate)}%</small><em><Check size={10} />{member.skills.filter((skill) => displayNeed.skills.includes(skill)).join("・")}に適合</em></span><button onClick={() => placeCandidate(member.id, displayNeed)}>仮置き</button></article>)}</div>
                  </>
                )}
                <p className="drawer-footnote">候補は対象週の稼働と登録スキルに基づく参考情報です。</p>
              </div>
            )}

            {drawer === "project" && selectedProject && (
              <div className="drawer-content">
                <div className="drawer-heading"><span className={"project-code drawer-code " + selectedProject.tone}>{selectedProject.code}</span><div><h2>{selectedProject.name}</h2><p>{selectedProject.summary}</p></div></div>
                <div className="detail-facts"><div><span>状態</span><strong>{selectedProject.status}</strong></div><div><span>進捗</span><strong>{selectedProject.progress}%</strong></div><div><span>責任者</span><strong>{selectedProject.ownerName}</strong></div><div><span>完了予定</span><strong>{formatDate(selectedProject.endDate).replace("2026年", "")}</strong></div></div>
                <div className="drawer-section-title"><span>4週間の充足</span><small>必要 {selectedProject.demand}名</small></div>
                <div className="detail-capacity-rail">{[0, 1, 2, 3].map((offset) => { const count = projectMembers(workspace, selectedProject.id, addDays(currentWeekStart, offset * 7)); return <div key={offset}><i><b className={count < selectedProject.demand ? "short" : ""} style={{ width: Math.min(100, count / selectedProject.demand * 100) + "%" }} /></i><span>{offset === 0 ? "今週" : offset + 1 + "週後"}</span><strong>{count}/{selectedProject.demand}</strong></div>; })}</div>
                <div className="drawer-section-title"><span>担当メンバー</span><small>{projectMembers(workspace, selectedProject.id, weekStart)}名</small></div>
                <div className="detail-member-list">{workspace.assignments.filter((assignment) => assignment.projectId === selectedProject.id && overlaps(assignment.startDate, assignment.endDate, weekStart, weekEnd(weekStart))).map((assignment) => { const member = memberById(workspace, assignment.personId); return <button onClick={() => member && openMember(member.id)} key={assignment.id}><span className={"avatar " + member?.avatarTone}>{member?.initials}</span><span><strong>{member?.name}</strong><small>{member?.role}</small></span><b>{assignment.allocation}%</b></button>; })}</div>
                {workspace.needs.some((need) => need.projectId === selectedProject.id && need.status !== "filled") && <button className="drawer-primary" onClick={() => setDrawer("openRole")}><UserRoundPlus size={16} />不足ロールの候補を見る</button>}
                <button className="drawer-secondary" onClick={() => { setForm((current) => ({ ...current, projectId: selectedProject.id })); setDrawer("add"); }}>この案件へアサインを追加</button>
              </div>
            )}

            {drawer === "member" && selectedMember && (
              <div className="drawer-content">
                <div className="profile-hero"><span className={"avatar profile-avatar " + selectedMember.avatarTone}>{selectedMember.initials}</span><div><h2>{selectedMember.name}</h2><p>{selectedMember.role} · {selectedMember.department}</p><small>{selectedMember.location}</small></div><strong>{memberLoad(workspace, selectedMember.id, weekStart)}%</strong></div>
                <div className="profile-skills">{selectedMember.skills.map((skill) => <span key={skill}>{skill}</span>)}</div>
                <div className="drawer-section-title"><span>4週間のキャパシティ</span><small>上限 {selectedMember.capacity}%</small></div>
                <div className="profile-capacity">{[0, 1, 2, 3].map((offset) => { const load = memberLoad(workspace, selectedMember.id, addDays(weekStart, offset * 7)); return <div key={offset}><span>{offset === 0 ? "今週" : offset + 1 + "週後"}</span><i><b className={load > 100 ? "over" : ""} style={{ width: Math.min(100, load) + "%" }} /></i><strong>{load}%</strong></div>; })}</div>
                <div className="drawer-section-title"><span>現在のアサイン</span><small>{workspace.assignments.filter((assignment) => assignment.personId === selectedMember.id && overlaps(assignment.startDate, assignment.endDate, weekStart, weekEnd(weekStart))).length}件</small></div>
                <div className="allocation-list">{workspace.assignments.filter((assignment) => assignment.personId === selectedMember.id && overlaps(assignment.startDate, assignment.endDate, weekStart, weekEnd(weekStart))).map((assignment) => <div key={assignment.id}><span className={"project-dot " + (projectById(workspace, assignment.projectId)?.tone || "plum")} /><span><strong>{assignment.label || projectById(workspace, assignment.projectId)?.name || "休暇"}</strong><small>{formatDate(assignment.startDate)} — {formatDate(assignment.endDate)}</small></span><b>{assignment.allocation}%</b></div>)}</div>
                <button className="drawer-primary" onClick={() => openAssignmentFor(selectedMember.id)}><Plus size={16} />この人へアサインを追加</button>
              </div>
            )}

            {drawer === "newProject" && (
              <form className="assignment-form" onSubmit={handleCreateProject}>
                <div className="drawer-heading"><span className="drawer-icon cobalt"><BriefcaseBusiness size={19} /></span><div><h2>プロジェクトを追加</h2><p>一覧へ追加し、後から配員を設定します。</p></div></div>
                <label>プロジェクト名<input required value={projectForm.name} onChange={(event) => setProjectForm({ ...projectForm, name: event.target.value })} placeholder="例：顧客ポータル刷新" /></label>
                <label>状態<select value={projectForm.status} onChange={(event) => setProjectForm({ ...projectForm, status: event.target.value as ProjectStatus })}>{["準備中", "進行中", "要注意", "完了間近"].map((status) => <option key={status}>{status}</option>)}</select></label>
                <label>責任者<select value={projectForm.ownerId} onChange={(event) => setProjectForm({ ...projectForm, ownerId: event.target.value })}>{workspace.members.map((member) => <option value={member.id} key={member.id}>{member.name}</option>)}</select></label>
                <label>完了予定<input required type="date" value={projectForm.endDate} onChange={(event) => setProjectForm({ ...projectForm, endDate: event.target.value })} /></label>
                <button className="drawer-primary" type="submit"><Check size={16} />プロジェクトを追加</button>
              </form>
            )}

            {drawer === "newMember" && (
              <form className="assignment-form" onSubmit={handleCreateMember}>
                <div className="drawer-heading"><span className="drawer-icon mint"><UserRoundPlus size={19} /></span><div><h2>メンバーを追加</h2><p>職種と所属を登録します。</p></div></div>
                <label>氏名<input required value={memberForm.name} onChange={(event) => setMemberForm({ ...memberForm, name: event.target.value })} placeholder="例：山田 花子" /></label>
                <label>職種<select value={memberForm.role} onChange={(event) => setMemberForm({ ...memberForm, role: event.target.value })}>{["Frontend Engineer", "Backend Engineer", "QA Engineer", "Product Designer", "Project Manager", "Data Analyst"].map((role) => <option key={role}>{role}</option>)}</select></label>
                <label>部署<select value={memberForm.department} onChange={(event) => setMemberForm({ ...memberForm, department: event.target.value })}>{["プロダクト開発", "プラットフォーム", "品質保証", "デザイン", "事業推進", "データ戦略"].map((department) => <option key={department}>{department}</option>)}</select></label>
                <label>勤務地<select value={memberForm.location} onChange={(event) => setMemberForm({ ...memberForm, location: event.target.value })}>{["東京", "大阪", "福岡", "リモート"].map((location) => <option key={location}>{location}</option>)}</select></label>
                <button className="drawer-primary" type="submit"><Check size={16} />メンバーを追加</button>
              </form>
            )}
          </section>
        </div>
      )}

      <div className={"toast " + (toast ? "show" : "")} role="status" aria-live="polite"><Check size={14} />{toast}</div>
      {!hydrated && <span className="sr-only">保存データを読み込み中</span>}
    </main>
  );
}
