import { useMemo, useState } from "react";
import {
  ArrowRight,
  BriefcaseBusiness,
  Building2,
  CalendarClock,
  ChevronRight,
  CircleAlert,
  ClipboardCheck,
  Filter,
  Gauge,
  Layers3,
  MailPlus,
  Plus,
  Search,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  UserRoundPlus,
  UsersRound,
} from "lucide-react";
import {
  addDays,
  addOrgUnit,
  addSkillCatalogEntry,
  archiveOrgUnit,
  buildSkillMap,
  customValue,
  formatCustomValue,
  formatSkillInput,
  formatWorkHistoryPeriod,
  getWeekStart,
  isActiveOpportunity,
  isActiveProfileRequest,
  canActAsProfileRequestSubject,
  memberDailyLoads,
  memberLoad,
  memberOrgMemberships,
  memberSearchText,
  memberSkillLevels,
  OPPORTUNITY_STAGE_LABELS,
  opportunityNeedsFor,
  opportunitySearchText,
  pipelineDemandForWeek,
  membersInOrgSubtree,
  moveOrgUnit,
  orgManagers,
  orgUnitLoadRows,
  orgUnitPath,
  orgUnitTree,
  matchMembers,
  parseSkillInput,
  PROFICIENCY_LABELS,
  profileRequestScopeLabel,
  profileRequestStatusLabel,
  projectMembers,
  projectSearchText,
  sortedWorkHistory,
  visibleCustomFields,
  allowedReportGroupBy,
  buildSavedReport,
  type CustomFieldDefinition,
  type CustomFieldEntity,
  type CustomFieldType,
  type OpportunityStage,
  type OrgUnit,
  type ProfileRequest,
  type ProfileRequestScope,
  type Project,
  type ReportGroupBy,
  type ReportMetric,
  type ReportSource,
  type SearchSkillFilter,
  type SkillKind,
  type WorkHistoryEntry,
  type WorkspaceState,
} from "./domain";

type ProjectsViewProps = {
  state: WorkspaceState;
  weekOffset: number;
  onOpen: (projectId: string) => void;
  onCreate: () => void;
  canEdit?: boolean;
};

type MembersViewProps = {
  state: WorkspaceState;
  weekOffset: number;
  onOpen: (memberId: string) => void;
  onAdd: () => void;
  onAssign: (memberId: string) => void;
  onAddScene: (input: {
    name: string;
    query?: string;
    role?: string;
    location?: string;
    skills?: SearchSkillFilter[];
    startDate?: string;
    endDate?: string;
    minAvailablePercent?: number;
  }) => void;
  onDeleteScene: (sceneId: string) => void;
  canEdit?: boolean;
  canManageMembers?: boolean;
  canManageScenes?: boolean;
};

type ReportsViewProps = {
  state: WorkspaceState;
  onOpenWeek: (offset: number) => void;
  onResolveNeed: (needId: string) => void;
  onOpenOpportunity?: (opportunityId: string) => void;
  onAddReport: (input: { name: string; source: ReportSource; groupBy: ReportGroupBy; metric: ReportMetric }) => void;
  onDeleteReport: (reportId: string) => void;
  canEdit?: boolean;
  canManageReports?: boolean;
};

type OpportunitiesViewProps = {
  state: WorkspaceState;
  onOpen: (opportunityId: string) => void;
  onCreate: () => void;
  canEdit?: boolean;
};

type SkillsViewProps = {
  state: WorkspaceState;
  onAddCatalogEntry: (input: { name: string; kind: SkillKind; parentId?: string | null }) => void;
  onOpenMember: (memberId: string) => void;
  onResolveNeed: (needId: string) => void;
  canEdit?: boolean;
};

type FieldsViewProps = {
  state: WorkspaceState;
  onAddField: (input: {
    entityType: CustomFieldEntity;
    key: string;
    label: string;
    fieldType: CustomFieldType;
    required?: boolean;
    options?: string[];
    showInList?: boolean;
    showInDetail?: boolean;
    searchable?: boolean;
  }) => void;
  canManage?: boolean;
  identity?: { userId?: string };
  onCreateRequests?: (personIds: string[], input: { scope: ProfileRequestScope; note: string }) => void;
  onSubmitRequest?: (requestId: string, proposed: { skills: string; workHistory: WorkHistoryEntry[] }) => void;
  onCompleteRequest?: (requestId: string) => void;
  onCancelRequest?: (requestId: string) => void;
};

type OrgViewProps = {
  state: WorkspaceState;
  onAddUnit: (input: { name: string; parentId?: string | null }) => void;
  onMoveUnit: (id: string, parentId: string | null) => void;
  onArchiveUnit: (id: string) => void;
  canManage?: boolean;
};

type MemberOrgFieldsProps = {
  units: OrgUnit[];
  primaryUnitId: string;
  extraUnitIds: string[];
  managerUnitIds: string[];
  onChange: (next: { primaryUnitId: string; extraUnitIds: string[]; managerUnitIds: string[] }) => void;
};

const statusClass: Record<Project["status"], string> = {
  "進行中": "active",
  "要注意": "risk",
  "準備中": "ready",
  "完了間近": "closing",
  "完了": "closing",
};

function formatMonthDay(iso?: string | null) {
  if (!iso) return "未設定";
  const [, month, day] = iso.split("-").map(Number);
  if (!month || !day) return "未設定";
  return month + "/" + day;
}

export function ProjectsView({ state, weekOffset, onOpen, onCreate, canEdit = true }: ProjectsViewProps) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("すべて");
  const weekStart = getWeekStart(weekOffset);
  const queryNeedle = query.toLowerCase();
  const filtered = state.projects.filter((project) => {
    const need = state.needs.some((item) => item.projectId === project.id && item.status !== "filled");
    const textMatch = projectSearchText(state, project).includes(queryNeedle);
    const statusMatch = status === "すべて" || project.status === status || (status === "欠員あり" && need);
    return textMatch && statusMatch;
  });
  const listFields = visibleCustomFields(state.customFields, "project", "list");

  const portfolioRisks = state.projects.filter((project) => project.status === "要注意").length;
  const openNeeds = state.needs.filter((need) => need.status !== "filled").length;

  return (
    <section className="section-view projects-view" aria-labelledby="projects-heading">
      <h2 id="projects-heading" className="sr-only">プロジェクト一覧</h2>
      <div className="portfolio-ribbon">
        <div className="ribbon-lead">
          <span className="ribbon-icon"><Layers3 size={18} /></span>
          <div><small>PORTFOLIO PULSE</small><strong>8つの案件を横断して配員を確認</strong></div>
        </div>
        <div className="ribbon-stat"><strong>{state.projects.length}</strong><span>登録案件</span></div>
        <div className="ribbon-divider" />
        <div className="ribbon-stat risk"><strong>{portfolioRisks}</strong><span>要注意</span></div>
        <div className="ribbon-divider" />
        <div className="ribbon-stat warning"><strong>{openNeeds}</strong><span>未充足ロール</span></div>
        <div className="portfolio-weave" aria-hidden="true">{[64, 82, 71, 92, 76, 55, 88, 69].map((value, index) => <i key={index}><b style={{ width: value + "%" }} /></i>)}</div>
      </div>

      <div className="view-toolbar">
        <div className="inline-search"><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="案件名・責任者を検索" aria-label="案件を検索" /></div>
        <label className="view-filter"><Filter size={14} /><select value={status} onChange={(event) => setStatus(event.target.value)} aria-label="プロジェクト状態で絞り込み">
          {["すべて", "進行中", "要注意", "準備中", "完了間近", "完了", "欠員あり"].map((option) => <option key={option}>{option}</option>)}
        </select></label>
        <span className="toolbar-result">{filtered.length}件を表示</span>
        {canEdit && <button className="view-add-button" onClick={onCreate}><Plus size={15} />プロジェクトを追加</button>}
      </div>

      <div className="portfolio-table-wrap">
        <table className="portfolio-table">
          <thead>
            <tr><th>プロジェクト</th><th>状態</th>{listFields.map((field) => <th key={field.id}>{field.label}</th>)}<th>4週間の充足</th><th>進捗</th><th>次の節目</th><th>責任者</th><th><span className="sr-only">詳細</span></th></tr>
          </thead>
          <tbody>
            {filtered.map((project) => {
              const currentMembers = projectMembers(state, project.id, weekStart);
              const need = state.needs.find((item) => item.projectId === project.id && item.status !== "filled");
              const weeks = [0, 1, 2, 3].map((offset) => projectMembers(state, project.id, addDays(weekStart, offset * 7)));
              return (
                <tr key={project.id}>
                  <td>
                    <button className="project-name-cell" onClick={() => onOpen(project.id)}>
                      <span className={"project-code " + project.tone}>{project.code}</span>
                      <span><strong>{project.name}</strong><small>{project.summary}</small></span>
                    </button>
                  </td>
                  <td><span className={"status-pill " + statusClass[project.status]}><i />{project.status}</span>{need && <small className={"need-note " + (need.status === "planned" ? "planned" : "")}>{need.status === "planned" ? "解消予定" : need.role + " 不足"}</small>}</td>
                  {listFields.map((field) => <td key={field.id}><span className="custom-field-cell">{formatCustomValue(field, customValue(project.customValues, field.id))}</span></td>)}
                  <td>
                    <div className="four-week-rail" aria-label={project.name + "の4週間の充足人数"}>
                      {weeks.map((count, index) => <i key={index} title={project.demand === 0 ? (index + 1) + "週目: 必要人数未設定" : (index + 1) + "週目: " + count + "/" + project.demand + "名"}><b className={project.demand > 0 && count < project.demand ? "short" : ""} style={{ width: (project.demand === 0 ? 100 : Math.min(100, count / project.demand * 100)) + "%" }} /></i>)}
                    </div>
                    <span className="staffed-label">{project.demand === 0 ? "必要人数未設定" : `${currentMembers}/${project.demand}名`}</span>
                  </td>
                  <td><div className="progress-cell"><span><b style={{ width: project.progress + "%" }} /></span><strong>{project.progress}%</strong></div></td>
                  <td><span className="milestone-cell"><strong>{project.nextMilestone}</strong><small>{formatMonthDay(project.nextMilestoneDate)}</small></span></td>
                  <td><span className="owner-cell"><i>{project.ownerInitials}</i><span>{project.ownerName}</span></span></td>
                  <td><button className="row-open" aria-label={project.name + "の詳細を見る"} onClick={() => onOpen(project.id)}><ChevronRight size={16} /></button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {filtered.length === 0 && <div className="view-empty"><BriefcaseBusiness size={22} /><strong>条件に合うプロジェクトがありません</strong><p>検索語または状態を変更してください。</p></div>}
      </div>
    </section>
  );
}

const opportunityStageClass: Record<OpportunityStage, string> = {
  inquiry: "ready",
  proposal: "active",
  negotiation: "risk",
  won: "closing",
  lost: "closing",
};

export function OpportunitiesView({ state, onOpen, onCreate, canEdit = true }: OpportunitiesViewProps) {
  const [query, setQuery] = useState("");
  const [stage, setStage] = useState("進行中");
  const queryNeedle = query.toLowerCase();
  const opportunities = state.opportunities ?? [];
  const filtered = opportunities.filter((opportunity) => {
    const textMatch = opportunitySearchText(opportunity, opportunityNeedsFor(state, opportunity.id)).includes(queryNeedle);
    const stageMatch = stage === "すべて"
      || (stage === "進行中" && isActiveOpportunity(opportunity))
      || opportunity.stage === stage
      || (stage === "引き合い" && opportunity.stage === "inquiry")
      || (stage === "提案" && opportunity.stage === "proposal")
      || (stage === "商談" && opportunity.stage === "negotiation")
      || (stage === "受注" && opportunity.stage === "won")
      || (stage === "失注" && opportunity.stage === "lost");
    return textMatch && stageMatch;
  });
  const activeCount = opportunities.filter(isActiveOpportunity).length;
  const plannedHeadcount = opportunities.filter(isActiveOpportunity).reduce((sum, opportunity) => sum + opportunity.demand, 0);
  const columns: OpportunityStage[] = ["inquiry", "proposal", "negotiation"];

  return (
    <section className="section-view projects-view" aria-labelledby="opportunities-heading">
      <h2 id="opportunities-heading" className="sr-only">受注前案件</h2>
      <div className="portfolio-ribbon">
        <div className="ribbon-lead">
          <span className="ribbon-icon"><BriefcaseBusiness size={18} /></span>
          <div><small>PRE-AWARD PIPELINE</small><strong>確定プロジェクトと分けて要員を検討</strong></div>
        </div>
        <div className="ribbon-stat"><strong>{activeCount}</strong><span>進行中の案件</span></div>
        <div className="ribbon-divider" />
        <div className="ribbon-stat warning"><strong>{plannedHeadcount}</strong><span>想定人数</span></div>
        <div className="ribbon-divider" />
        <div className="ribbon-stat"><strong>{(state.opportunityNeeds ?? []).length}</strong><span>要員計画</span></div>
      </div>

      <div className="view-toolbar">
        <div className="inline-search"><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="案件名・スキルを検索" aria-label="受注前案件を検索" /></div>
        <label className="view-filter"><Filter size={14} /><select value={stage} onChange={(event) => setStage(event.target.value)} aria-label="案件段階で絞り込み">
          {["進行中", "引き合い", "提案", "商談", "受注", "失注", "すべて"].map((option) => <option key={option}>{option}</option>)}
        </select></label>
        <span className="toolbar-result">{filtered.length}件を表示</span>
        {canEdit && <button className="view-add-button" onClick={onCreate}><Plus size={15} />受注前案件を追加</button>}
      </div>

      <div className="pipeline-board">
        {columns.map((column) => {
          const items = filtered.filter((opportunity) => opportunity.stage === column);
          return (
            <section className="pipeline-column" key={column} aria-label={OPPORTUNITY_STAGE_LABELS[column]}>
              <header><span>{OPPORTUNITY_STAGE_LABELS[column]}</span><strong>{items.length}</strong></header>
              {items.map((opportunity) => (
                <button className="pipeline-card" onClick={() => onOpen(opportunity.id)} key={opportunity.id}>
                  <span className={"project-code " + opportunity.tone}>{opportunity.code}</span>
                  <strong>{opportunity.name}</strong>
                  <small>{opportunity.summary}</small>
                  <em>{opportunity.demand}名 · {opportunityNeedsFor(state, opportunity.id).length}ロール · {opportunity.ownerName ?? "責任者未設定"}</em>
                </button>
              ))}
              {items.length === 0 && <p className="pipeline-empty">案件はありません</p>}
            </section>
          );
        })}
      </div>

      {filtered.some((opportunity) => !isActiveOpportunity(opportunity)) && (
        <div className="portfolio-table-wrap">
          <table className="portfolio-table">
            <thead>
              <tr><th>案件</th><th>段階</th><th>想定期間</th><th>必要人数</th><th>責任者</th><th><span className="sr-only">詳細</span></th></tr>
            </thead>
            <tbody>
              {filtered.filter((opportunity) => !isActiveOpportunity(opportunity)).map((opportunity) => (
                <tr key={opportunity.id}>
                  <td>
                    <button className="project-name-cell" onClick={() => onOpen(opportunity.id)}>
                      <span className={"project-code " + opportunity.tone}>{opportunity.code}</span>
                      <span><strong>{opportunity.name}</strong><small>{opportunity.summary}</small></span>
                    </button>
                  </td>
                  <td><span className={"status-pill " + opportunityStageClass[opportunity.stage]}><i />{OPPORTUNITY_STAGE_LABELS[opportunity.stage]}</span></td>
                  <td>{formatMonthDay(opportunity.startDate)} — {formatMonthDay(opportunity.endDate)}</td>
                  <td>{opportunity.demand}名</td>
                  <td><span className="owner-cell"><i>{opportunity.ownerInitials}</i><span>{opportunity.ownerName}</span></span></td>
                  <td><button className="row-open" aria-label={opportunity.name + "の詳細を見る"} onClick={() => onOpen(opportunity.id)}><ChevronRight size={16} /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {filtered.length === 0 && <div className="view-empty"><BriefcaseBusiness size={22} /><strong>条件に合う受注前案件がありません</strong><p>検索語または段階を変更してください。</p></div>}
    </section>
  );
}

export function MembersView({ state, weekOffset, onOpen, onAdd, onAssign, onAddScene, onDeleteScene, canEdit = true, canManageMembers = true, canManageScenes = false }: MembersViewProps) {
  const [query, setQuery] = useState("");
  const [role, setRole] = useState("すべて");
  const [orgFilter, setOrgFilter] = useState("");
  const [sceneId, setSceneId] = useState("");
  const [sceneName, setSceneName] = useState("");
  const [sceneQuery, setSceneQuery] = useState("");
  const [sceneRole, setSceneRole] = useState("");
  const [sceneLocation, setSceneLocation] = useState("");
  const [mustSkills, setMustSkills] = useState("");
  const [niceSkills, setNiceSkills] = useState("");
  const [sceneStart, setSceneStart] = useState("");
  const [sceneEnd, setSceneEnd] = useState("");
  const [sceneMinAvailable, setSceneMinAvailable] = useState("");
  const [error, setError] = useState("");
  const weekStart = getWeekStart(weekOffset);
  const roles = ["すべて", ...Array.from(new Set(state.members.map((member) => member.role)))];
  const orgUnits = orgUnitTree(state.orgUnits);
  const scenes = state.searchScenes ?? [];
  const selectedScene = scenes.find((scene) => scene.id === sceneId);
  const scoreById = new Map((selectedScene ? matchMembers(state, selectedScene) : []).map((match) => [match.member.id, match]));
  const queryNeedle = query.toLowerCase();
  const scopedMembers = orgFilter ? membersInOrgSubtree(state, orgFilter, "any") : state.members;
  const filtered = (selectedScene ? scopedMembers.filter((member) => scoreById.has(member.id)) : scopedMembers).filter((member) => {
    const textMatch = memberSearchText(state, member).includes(queryNeedle);
    return textMatch && (role === "すべて" || member.role === role);
  }).sort((a, b) => {
    if (selectedScene) return (scoreById.get(b.id)?.score ?? 0) - (scoreById.get(a.id)?.score ?? 0) || a.name.localeCompare(b.name, "ja");
    const aUtilization = a.capacity > 0 ? memberLoad(state, a.id, weekStart) / a.capacity : Number.POSITIVE_INFINITY;
    const bUtilization = b.capacity > 0 ? memberLoad(state, b.id, weekStart) / b.capacity : Number.POSITIVE_INFINITY;
    return aUtilization - bUtilization;
  });

  const available = state.members.filter((member) => member.capacity > 0 && memberLoad(state, member.id, weekStart) <= member.capacity * .6).length;
  const overloaded = state.members.filter((member) => memberLoad(state, member.id, weekStart) > member.capacity).length;
  const listFields = visibleCustomFields(state.customFields, "member", "list");

  const submitScene = () => {
    try {
      const minAvailable = sceneMinAvailable.trim() === "" ? undefined : Number(sceneMinAvailable);
      onAddScene({
        name: sceneName,
        query: sceneQuery.trim() || undefined,
        role: sceneRole.trim() || undefined,
        location: sceneLocation.trim() || undefined,
        skills: [
          ...parseSkillInput(mustSkills).map((level) => ({ name: level.name, minProficiency: level.proficiency, importance: "must" as const })),
          ...parseSkillInput(niceSkills).map((level) => ({ name: level.name, minProficiency: level.proficiency, importance: "nice" as const })),
        ],
        startDate: sceneStart || undefined,
        endDate: sceneEnd || undefined,
        minAvailablePercent: minAvailable,
      });
      setSceneName("");
      setSceneQuery("");
      setSceneRole("");
      setSceneLocation("");
      setMustSkills("");
      setNiceSkills("");
      setSceneStart("");
      setSceneEnd("");
      setSceneMinAvailable("");
      setError("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "検索シーンを保存できませんでした");
    }
  };

  return (
    <section className="section-view members-view" aria-labelledby="members-heading">
      <h2 id="members-heading" className="sr-only">メンバー一覧</h2>
      <div className="member-ribbon">
        <div className="ribbon-lead"><span className="ribbon-icon mint"><UsersRound size={18} /></span><div><small>TEAM AVAILABILITY</small><strong>{selectedScene ? "保存シーンのスコア順に候補を表示" : "空きが大きい順にメンバーを表示"}</strong></div></div>
        <div className="ribbon-stat"><strong>{state.members.length}</strong><span>登録メンバー</span></div>
        <div className="ribbon-divider" />
        <div className="ribbon-stat good"><strong>{available}</strong><span>40%以上の空き</span></div>
        <div className="ribbon-divider" />
        <div className="ribbon-stat risk"><strong>{overloaded}</strong><span>稼働超過</span></div>
        <div className="capacity-legend"><span><i className="open" />空き</span><span><i className="steady" />適正</span><span><i className="hot" />超過</span></div>
      </div>

      <div className="view-toolbar">
        <div className="inline-search"><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="名前・スキル・経歴を検索" aria-label="メンバーを検索" /></div>
        <label className="view-filter"><Filter size={14} /><select value={role} onChange={(event) => setRole(event.target.value)} aria-label="職種で絞り込み">{roles.map((option) => <option key={option}>{option}</option>)}</select></label>
        {orgUnits.length > 0 && (
          <label className="view-filter"><Building2 size={14} /><select value={orgFilter} onChange={(event) => setOrgFilter(event.target.value)} aria-label="組織で絞り込み">
            <option value="">すべての部門</option>
            {orgUnits.map((unit) => <option value={unit.id} key={unit.id}>{orgUnitPath(state.orgUnits, unit.id).join(" / ")}</option>)}
          </select></label>
        )}
        <label className="view-filter"><Sparkles size={14} /><select value={sceneId} onChange={(event) => setSceneId(event.target.value)} aria-label="保存した検索シーン">
          <option value="">シーンなし</option>
          {scenes.map((scene) => <option value={scene.id} key={scene.id}>{scene.name}</option>)}
        </select></label>
        {canManageScenes && selectedScene && <button className="view-add-button" type="button" onClick={() => { onDeleteScene(selectedScene.id); setSceneId(""); }}>このシーンを削除</button>}
        <span className="toolbar-result">{selectedScene ? "スコアの高い順" : "空き率の高い順"}</span>
        {canManageMembers && <button className="view-add-button" onClick={onAdd}><Plus size={15} />メンバーを追加</button>}
      </div>

      {canManageScenes && (
        <form className="field-catalog-form search-scene-form" onSubmit={(event) => { event.preventDefault(); submitScene(); }}>
          <label>シーン名<input value={sceneName} onChange={(event) => setSceneName(event.target.value)} placeholder="フロントエンド候補" /></label>
          <label>職種<input value={sceneRole} onChange={(event) => setSceneRole(event.target.value)} placeholder="Frontend Engineer" /></label>
          <label>勤務地<input value={sceneLocation} onChange={(event) => setSceneLocation(event.target.value)} placeholder="東京" /></label>
          <label>検索語<input value={sceneQuery} onChange={(event) => setSceneQuery(event.target.value)} placeholder="React" /></label>
          <label>必須スキル<input value={mustSkills} onChange={(event) => setMustSkills(event.target.value)} placeholder="React:3, TypeScript:3" /></label>
          <label>歓迎スキル<input value={niceSkills} onChange={(event) => setNiceSkills(event.target.value)} placeholder="A11y:3" /></label>
          <label>開始日<input type="date" value={sceneStart} onChange={(event) => setSceneStart(event.target.value)} aria-label="検索シーンの開始日" /></label>
          <label>終了日<input type="date" value={sceneEnd} onChange={(event) => setSceneEnd(event.target.value)} aria-label="検索シーンの終了日" /></label>
          <label>最小空き（%）<input type="number" min={0} max={100} value={sceneMinAvailable} onChange={(event) => setSceneMinAvailable(event.target.value)} placeholder="40" aria-label="最小空き配分" /></label>
          <button type="submit" className="view-add-button"><Plus size={15} />検索シーンを保存</button>
          {error && <p className="skill-catalog-error" role="alert">{error}</p>}
        </form>
      )}

      <div className="member-table-wrap">
        <table className="member-table">
          <thead><tr><th>メンバー</th><th>スキル</th>{selectedScene && <th>スコア</th>}{listFields.map((field) => <th key={field.id}>{field.label}</th>)}<th>今週</th><th>4週間のキャパシティ</th><th>次の空き</th><th><span className="sr-only">操作</span></th></tr></thead>
          <tbody>
            {filtered.map((member) => {
              const load = memberLoad(state, member.id, weekStart);
              const weeklyLoads = [0, 1, 2, 3].map((offset) => memberLoad(state, member.id, addDays(weekStart, offset * 7)));
              const nextOpen = member.capacity > 0 ? weeklyLoads.findIndex((value) => value <= member.capacity * .6) : -1;
              const loadRatio = member.capacity > 0 ? load / member.capacity * 100 : load > 0 ? 100 : 0;
              const match = scoreById.get(member.id);
              return (
                <tr key={member.id}>
                  <td><button className="member-name-cell" onClick={() => onOpen(member.id)}><span className={"avatar " + member.avatarTone}>{member.initials}</span><span><strong>{member.name}</strong><small>{member.role} · {member.department}{memberOrgMemberships(state, member.id).some((item) => !item.isPrimary) ? " · 兼務あり" : ""}</small></span></button></td>
                  <td><div className="member-skills">{memberSkillLevels(member).slice(0, 3).map((level) => <span key={level.name}>{level.name}<small>{level.proficiency}</small></span>)}</div></td>
                  {selectedScene && <td><span className="match-score">{match?.score ?? 0}点<small>{match?.availablePercent ?? 0}%空き</small></span></td>}
                  {listFields.map((field) => <td key={field.id}><span className="custom-field-cell">{formatCustomValue(field, customValue(member.customValues, field.id))}</span></td>)}
                  <td><span className={"load-ring " + (load > member.capacity ? "over" : member.capacity > 0 && load <= member.capacity * .6 ? "open" : "")} style={{ "--load": Math.min(100, loadRatio) } as React.CSSProperties}><strong>{load}%</strong></span><small className="capacity-limit">上限 {member.capacity}%</small></td>
                  <td><div className="member-week-rail">{weeklyLoads.map((value, index) => { const ratio = member.capacity > 0 ? value / member.capacity * 100 : value > 0 ? 100 : 0; return <i className={value > member.capacity ? "over" : member.capacity > 0 && value <= member.capacity * .6 ? "open" : ""} key={index}><b style={{ height: Math.max(12, Math.min(100, ratio)) + "%" }} /><small>{value}%</small></i>; })}</div></td>
                  <td><span className="next-open">{member.capacity === 0 ? "稼働不可 · 上限0%" : nextOpen === -1 ? "4週先まで満員" : nextOpen === 0 ? "今週 " + Math.max(0, member.capacity - load) + "%空き" : (nextOpen + 1) + "週目から"}<small>{member.location}</small></span></td>
                  <td>{canEdit ? <button className="quick-assign" onClick={() => onAssign(member.id)}><UserRoundPlus size={14} />アサイン</button> : <span className="read-only-label">閲覧のみ</span>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function ReportsView({ state, onOpenWeek, onResolveNeed, onOpenOpportunity, onAddReport, onDeleteReport, canEdit = true, canManageReports = false }: ReportsViewProps) {
  const [range, setRange] = useState(8);
  const [reportId, setReportId] = useState((state.savedReports ?? [])[0]?.id ?? "");
  const [reportName, setReportName] = useState("");
  const [source, setSource] = useState<ReportSource>("members");
  const [groupBy, setGroupBy] = useState<ReportGroupBy>("department");
  const [metric, setMetric] = useState<ReportMetric>("count");
  const [error, setError] = useState("");
  const weekOffsets = useMemo(() => Array.from({ length: range }, (_, index) => index), [range]);
  const horizon = weekOffsets.map((offset) => {
    const weekStart = getWeekStart(offset);
    const capacity = state.members.reduce((sum, member) => sum + member.capacity, 0) * 5;
    const load = state.members.reduce((sum, member) => sum + memberDailyLoads(state, member.id, weekStart, addDays(weekStart, 4)).reduce((dailySum, day) => dailySum + day.load, 0), 0);
    const confirmed = state.assignments.filter((assignment) => assignment.status === "confirmed" && assignment.startDate <= addDays(weekStart, 4) && assignment.endDate >= weekStart).length;
    const draft = state.assignments.filter((assignment) => assignment.status === "draft" && assignment.startDate <= addDays(weekStart, 4) && assignment.endDate >= weekStart).length;
    return { offset, weekStart, average: capacity > 0 ? Math.round(load / capacity * 100) : 0, confirmed, draft, pipelineDemand: pipelineDemandForWeek(state, weekStart) };
  });
  const orgRows = (state.orgUnits ?? []).length > 0
    ? orgUnitLoadRows(state, getWeekStart(0))
    : Array.from(new Set(state.members.map((member) => member.department))).map((department) => {
      const people = state.members.filter((member) => member.department === department);
      const weekStart = getWeekStart(0);
      const capacity = people.reduce((sum, member) => sum + member.capacity, 0) * 5;
      const load = people.reduce((sum, member) => sum + memberDailyLoads(state, member.id, weekStart, addDays(weekStart, 4)).reduce((dailySum, day) => dailySum + day.load, 0), 0);
      return { id: department, name: department, path: [department], depth: 0, count: people.length, average: capacity > 0 ? Math.round(load / capacity * 100) : 0, managers: [] as string[] };
    }).sort((a, b) => b.average - a.average);
  const currentOverloads = state.members.filter((member) => memberLoad(state, member.id, getWeekStart(0)) > member.capacity);
  const activeNeeds = state.needs.filter((need) => need.status !== "filled");
  const activeOpportunities = (state.opportunities ?? []).filter(isActiveOpportunity);
  const pipelineNeeds = (state.opportunityNeeds ?? []).filter((need) => activeOpportunities.some((opportunity) => opportunity.id === need.opportunityId));
  const reports = state.savedReports ?? [];
  const selectedReport = reports.find((report) => report.id === reportId) ?? reports[0];
  const reportRows = selectedReport ? buildSavedReport(state, selectedReport, getWeekStart(0)) : [];
  const maxValue = Math.max(1, ...reportRows.map((row) => row.value));
  const groupOptions = allowedReportGroupBy(source);
  const submitReport = () => {
    try {
      onAddReport({ name: reportName, source, groupBy, metric });
      setReportName("");
      setError("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "レポートを保存できませんでした");
    }
  };

  return (
    <section className="section-view reports-view" aria-labelledby="reports-heading">
      <div className="report-toolbar">
        <div><small>CAPACITY HORIZON</small><h2 id="reports-heading">需給バランスの見通し</h2><p>確定稼働と受注前の想定人数を分けて確認します。</p></div>
        <div className="range-tabs" aria-label="表示期間">{[4, 8, 12].map((weeks) => <button className={range === weeks ? "selected" : ""} aria-pressed={range === weeks} onClick={() => setRange(weeks)} key={weeks}>{weeks}週間</button>)}</div>
      </div>

      <section className="balance-card saved-report-card" aria-labelledby="saved-report-heading">
        <div className="card-heading"><div><small>SAVED REPORTS</small><h3 id="saved-report-heading">任意項目レポート</h3></div><Gauge size={18} /></div>
        <div className="view-toolbar">
          <label className="view-filter"><Filter size={14} /><select value={selectedReport?.id ?? ""} onChange={(event) => setReportId(event.target.value)} aria-label="保存したレポート">
            {reports.length === 0 && <option value="">レポートなし</option>}
            {reports.map((report) => <option value={report.id} key={report.id}>{report.name}</option>)}
          </select></label>
          {canManageReports && selectedReport && <button className="view-add-button" type="button" onClick={() => { onDeleteReport(selectedReport.id); setReportId(""); }}>このレポートを削除</button>}
        </div>
        {canManageReports && (
          <form className="field-catalog-form" onSubmit={(event) => { event.preventDefault(); submitReport(); }}>
            <label>レポート名<input value={reportName} onChange={(event) => setReportName(event.target.value)} placeholder="部署別人数" /></label>
            <label>対象<select aria-label="レポートの集計対象" value={source} onChange={(event) => {
              const next = event.target.value as ReportSource;
              setSource(next);
              const allowed = allowedReportGroupBy(next);
              if (!allowed.includes(groupBy)) setGroupBy(allowed[0]);
              if (next === "projects") setMetric("count");
            }}>
              <option value="members">メンバー</option>
              <option value="projects">プロジェクト</option>
            </select></label>
            <label>グループ<select aria-label="レポートのグループ" value={groupBy} onChange={(event) => setGroupBy(event.target.value as ReportGroupBy)}>
              {groupOptions.map((option) => <option value={option} key={option}>{option === "department" ? "部署" : option === "role" ? "職種" : option === "location" ? "勤務地" : "状態"}</option>)}
            </select></label>
            <label>指標<select aria-label="レポートの指標" value={source === "projects" ? "count" : metric} onChange={(event) => setMetric(event.target.value as ReportMetric)} disabled={source === "projects"}>
              <option value="count">件数</option>
              <option value="avgLoad">平均稼働率</option>
            </select></label>
            <button type="submit" className="view-add-button"><Plus size={15} />レポートを保存</button>
            {error && <p className="skill-catalog-error" role="alert">{error}</p>}
          </form>
        )}
        <div className="department-list">
          {reportRows.map((row) => (
            <div key={row.key}>
              <span><strong>{row.label}</strong><small>{row.count}{selectedReport?.source === "projects" ? "件" : "名"}</small></span>
              <i><b className={selectedReport?.metric === "avgLoad" && row.value > 100 ? "over" : ""} style={{ width: Math.min(100, row.value / maxValue * 100) + "%" }} /></i>
              <em>{selectedReport?.metric === "avgLoad" ? `${row.value}%` : row.value}</em>
            </div>
          ))}
          {reportRows.length === 0 && <p className="view-empty">表示できる集計がありません。</p>}
        </div>
      </section>

      <div className="horizon-card">
        <div className="horizon-y-labels"><span>120%</span><span>100%</span><span>60%</span><span>0</span></div>
        <div className="horizon-grid">
          <div className="horizon-guide g120" /><div className="horizon-guide g100" /><div className="horizon-guide g60" />
          {horizon.map((week) => (
            <button className="horizon-week" onClick={() => onOpenWeek(week.offset)} key={week.weekStart}>
              <span className="horizon-bar"><i className={week.average > 100 ? "over" : ""} style={{ height: Math.min(100, week.average / 120 * 100) + "%" }} />{week.draft > 0 && <b style={{ bottom: Math.min(100, week.average / 120 * 100) + "%" }} />}</span>
              <strong>{week.average}%</strong>
              {week.pipelineDemand > 0 && <span className="pipeline-chip">+{week.pipelineDemand}名</span>}
              <small>{formatMonthDay(week.weekStart)}週</small>
            </button>
          ))}
        </div>
        <div className="horizon-caption"><span><i className="confirmed" />確定稼働</span><span><i className="draft" />仮置きあり</span><span><i className="pipeline" />受注前の想定人数</span><button onClick={() => onOpenWeek(0)}>ボードで確認 <ArrowRight size={13} /></button></div>
      </div>

      <div className="report-lower-grid">
        <section className="balance-card">
          <div className="card-heading"><div><small>BY ORGANIZATION</small><h3>{(state.orgUnits ?? []).length > 0 ? "組織別の需給" : "部署別の需給"}</h3></div><Gauge size={18} /></div>
          <div className="department-list">{orgRows.map((item) => <div key={item.id}><span><strong>{item.name}</strong><small>{item.count}名{item.managers.length ? ` · ${item.managers[0]}` : ""}</small></span><i><b className={item.average > 100 ? "over" : ""} style={{ width: Math.min(100, item.average) + "%" }} /></i><em>{item.average}%</em></div>)}</div>
        </section>

        <section className="exceptions-card">
          <div className="card-heading"><div><small>EXCEPTIONS</small><h3>判断が必要な項目</h3></div><span>{currentOverloads.length + activeNeeds.length + pipelineNeeds.length}</span></div>
          <div className="exception-list">
            {currentOverloads.map((member) => <button onClick={() => onOpenWeek(0)} key={member.id}><span className="exception-icon risk"><CircleAlert size={14} /></span><span><strong>{member.name}さんが{memberLoad(state, member.id, getWeekStart(0))}%</strong><small>今週の稼働を調整してください</small></span><ChevronRight size={15} /></button>)}
            {activeNeeds.map((need) => <button onClick={() => onResolveNeed(need.id)} key={need.id}><span className={"exception-icon " + (need.status === "planned" ? "planned" : "open")}><CalendarClock size={14} /></span><span><strong>{state.projects.find((project) => project.id === need.projectId)?.name}</strong><small>{need.role} {need.allocation}% · {need.status === "planned" ? "解消予定" : "担当未定"}</small></span><ChevronRight size={15} /></button>)}
            {pipelineNeeds.map((need) => {
              const opportunity = activeOpportunities.find((item) => item.id === need.opportunityId);
              return <button onClick={() => onOpenOpportunity?.(need.opportunityId)} key={need.id}><span className="exception-icon pipeline"><BriefcaseBusiness size={14} /></span><span><strong>{opportunity?.name ?? "受注前案件"}</strong><small>{need.role} {need.allocation}% · {OPPORTUNITY_STAGE_LABELS[opportunity?.stage ?? "inquiry"]}の要員計画</small></span><ChevronRight size={15} /></button>;
            })}
          </div>
        </section>
      </div>

      <div className="report-insight"><span><Sparkles size={17} /></span><div><strong>今週の示唆</strong><p>確定プロジェクトの不足と、受注前案件の想定人数を分けて照合できます。</p></div>{activeNeeds[0] && <button onClick={() => onResolveNeed(activeNeeds[0].id)}>{canEdit ? "候補を見る" : "候補を確認"} <ArrowRight size={13} /></button>}</div>
    </section>
  );
}

export function SkillsView({ state, onAddCatalogEntry, onOpenMember, onResolveNeed, canEdit = true }: SkillsViewProps) {
  const [query, setQuery] = useState("");
  const [focus, setFocus] = useState<"すべて" | "不足あり" | "保有あり">("すべて");
  const [name, setName] = useState("");
  const [kind, setKind] = useState<SkillKind>("skill");
  const [parentId, setParentId] = useState("");
  const [error, setError] = useState("");
  const rows = useMemo(() => buildSkillMap(state), [state]);
  const categories = (state.skillCatalog ?? []).filter((item) => item.kind === "category");
  const filtered = rows.filter((row) => {
    const text = (row.name + " " + row.path.join(" ")).toLowerCase();
    const textMatch = text.includes(query.toLowerCase());
    const focusMatch = focus === "すべて" || (focus === "不足あり" ? row.gap > 0 : row.memberCount > 0);
    return textMatch && focusMatch;
  });
  const skillRows = rows.filter((row) => row.kind === "skill");
  const covered = skillRows.filter((row) => row.memberCount > 0).length;
  const gaps = skillRows.filter((row) => row.gap > 0).length;
  const needForSkill = (skillName: string) => state.needs.find((need) => need.status !== "filled" && need.skills.some((item) => item.toLocaleLowerCase() === skillName.toLocaleLowerCase()));

  const submitCatalog = () => {
    try {
      addSkillCatalogEntry(state.skillCatalog ?? [], { name, kind, parentId: parentId || null });
      onAddCatalogEntry({ name, kind, parentId: parentId || null });
      setName("");
      setError("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "分類を追加できませんでした");
    }
  };

  return (
    <section className="section-view skills-view" aria-labelledby="skills-heading">
      <h2 id="skills-heading" className="sr-only">スキルマップ</h2>
      <div className="member-ribbon">
        <div className="ribbon-lead"><span className="ribbon-icon"><Layers3 size={18} /></span><div><small>SKILL TAXONOMY</small><strong>分類・習熟度・不足を同じマップで確認</strong></div></div>
        <div className="ribbon-stat"><strong>{skillRows.length}</strong><span>登録スキル</span></div>
        <div className="ribbon-divider" />
        <div className="ribbon-stat good"><strong>{covered}</strong><span>保有あり</span></div>
        <div className="ribbon-divider" />
        <div className="ribbon-stat risk"><strong>{gaps}</strong><span>不足スキル</span></div>
      </div>

      <div className="view-toolbar">
        <div className="inline-search"><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="スキル・分類を検索" aria-label="スキルを検索" /></div>
        <label className="view-filter"><Filter size={14} /><select value={focus} onChange={(event) => setFocus(event.target.value as typeof focus)} aria-label="スキルマップの表示">
          {(["すべて", "不足あり", "保有あり"] as const).map((option) => <option key={option}>{option}</option>)}
        </select></label>
        <span className="toolbar-result">{filtered.length}件を表示</span>
      </div>

      {canEdit && (
        <form className="skill-catalog-form" onSubmit={(event) => { event.preventDefault(); submitCatalog(); }}>
          <label>名前<input value={name} onChange={(event) => setName(event.target.value)} placeholder="React または フロントエンド" /></label>
          <label>種類<select value={kind} onChange={(event) => setKind(event.target.value as SkillKind)} aria-label="スキル種類">{[{ value: "skill", label: "スキル" }, { value: "category", label: "分類" }].map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}</select></label>
          <label>親分類<select value={parentId} onChange={(event) => setParentId(event.target.value)} aria-label="親分類">
            <option value="">なし（最上位）</option>
            {categories.map((category) => <option value={category.id} key={category.id}>{category.name}</option>)}
          </select></label>
          <button type="submit" className="view-add-button"><Plus size={15} />分類またはスキルを追加</button>
          {error && <p className="skill-catalog-error" role="alert">{error}</p>}
        </form>
      )}

      <div className="skill-map-wrap">
        <table className="skill-map-table">
          <thead>
            <tr>
              <th>スキル分類</th>
              <th>保有</th>
              <th>習熟度</th>
              <th>部署</th>
              <th>未充足</th>
              <th>不足</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((row) => (
              <tr key={row.id} className={row.kind === "category" ? "category-row" : row.gap > 0 ? "gap-row" : ""}>
                <td>
                  <span className={"skill-tree-name depth-" + row.depth}>
                    <strong>{row.name}</strong>
                    <small>{row.kind === "category" ? "分類" : row.path.slice(0, -1).join(" / ") || "未分類"}</small>
                  </span>
                </td>
                <td><strong>{row.memberCount}</strong><small>名</small></td>
                <td>
                  <div className="proficiency-rail" aria-label={`${row.name}の習熟度分布`}>
                    {([1, 2, 3, 4, 5] as const).map((level) => (
                      <i key={level} title={`${PROFICIENCY_LABELS[level]} ${row.byProficiency[level]}名`} className={row.byProficiency[level] > 0 ? "filled level-" + level : "level-" + level}>
                        <b>{row.byProficiency[level] || ""}</b>
                      </i>
                    ))}
                  </div>
                </td>
                <td><span className="skill-departments">{row.departments.slice(0, 2).map((item) => item.department).join(" / ") || "—"}</span></td>
                <td>{row.openNeedCount > 0 && needForSkill(row.name) ? <button className="skill-need-link" onClick={() => onResolveNeed(needForSkill(row.name)!.id)}>{row.openNeedCount}件</button> : row.openNeedCount}</td>
                <td>{row.gap > 0 ? <strong className="skill-gap">{row.gap}</strong> : <span className="skill-ok">充足</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length === 0 && <div className="view-empty"><Layers3 size={22} /><strong>条件に合うスキルがありません</strong><p>検索語または表示条件を変更してください。</p></div>}
      </div>

      <div className="report-insight">
        <span><Sparkles size={17} /></span>
        <div><strong>スキルマップの見方</strong><p>習熟度は初級から指導までの5段階です。未充足の要員要件より保有者が少ないスキルを不足として表示します。</p></div>
        {state.members[0] && <button onClick={() => onOpenMember(state.members[0].id)}>メンバーを確認 <ArrowRight size={13} /></button>}
      </div>
    </section>
  );
}

export function CustomFieldFacts({ fields, values }: { fields: CustomFieldDefinition[]; values?: Record<string, string> }) {
  if (fields.length === 0) return null;
  return (
    <div className="detail-facts custom-field-facts">
      {fields.map((field) => (
        <div key={field.id}><span>{field.label}</span><strong>{formatCustomValue(field, customValue(values, field.id))}</strong></div>
      ))}
    </div>
  );
}

export function WorkHistoryList({ entries }: { entries?: WorkHistoryEntry[] }) {
  const history = sortedWorkHistory(entries);
  if (history.length === 0) return <div className="candidate-empty"><BriefcaseBusiness size={18} /><span><strong>業務経歴はまだありません</strong><small>担当した案件や所属を時系列で残せます。</small></span></div>;
  return (
    <div className="work-history-list">
      {history.map((entry) => (
        <article key={entry.id}>
          <span><strong>{entry.title}</strong><small>{entry.organization}</small></span>
          <em>{formatWorkHistoryPeriod(entry)}</em>
          {entry.description && <p>{entry.description}</p>}
        </article>
      ))}
    </div>
  );
}

export function CustomFieldInputs({
  fields,
  values,
  onChange,
}: {
  fields: CustomFieldDefinition[];
  values: Record<string, string>;
  onChange: (values: Record<string, string>) => void;
}) {
  if (fields.length === 0) return null;
  return (
    <div className="custom-field-inputs">
      {fields.map((field) => {
        const value = values[field.id] ?? "";
        const setValue = (next: string) => onChange({ ...values, [field.id]: next });
        const label = field.label + (field.required ? "（必須）" : "");
        if (field.fieldType === "select") {
          return (
            <label key={field.id}>{label}
              <select aria-label={field.label} value={value} onChange={(event) => setValue(event.target.value)}>
                <option value="">未設定</option>
                {(field.options ?? []).map((option) => <option key={option}>{option}</option>)}
              </select>
            </label>
          );
        }
        return (
          <label key={field.id}>{label}
            <input
              aria-label={field.label}
              required={field.required}
              type={field.fieldType === "number" ? "number" : field.fieldType === "date" ? "date" : "text"}
              value={value}
              onChange={(event) => setValue(event.target.value)}
            />
          </label>
        );
      })}
    </div>
  );
}

export function WorkHistoryEditor({
  entries,
  onChange,
}: {
  entries: WorkHistoryEntry[];
  onChange: (entries: WorkHistoryEntry[]) => void;
}) {
  const update = (index: number, patch: Partial<WorkHistoryEntry>) => {
    onChange(entries.map((entry, current) => current === index ? { ...entry, ...patch } : entry));
  };
  return (
    <div className="work-history-editor">
      <div className="drawer-section-title"><span>業務経歴</span><small>{entries.length}件</small></div>
      {entries.map((entry, index) => (
        <div className="work-history-form" key={entry.id}>
          <label>役割<input aria-label={`経歴${index + 1}の役割`} value={entry.title} onChange={(event) => update(index, { title: event.target.value })} /></label>
          <label>所属・案件<input aria-label={`経歴${index + 1}の所属`} value={entry.organization} onChange={(event) => update(index, { organization: event.target.value })} /></label>
          <div className="form-grid">
            <label>開始日<input aria-label={`経歴${index + 1}の開始日`} type="date" value={entry.startDate} onChange={(event) => update(index, { startDate: event.target.value })} /></label>
            <label>終了日<input aria-label={`経歴${index + 1}の終了日`} type="date" value={entry.endDate ?? ""} onChange={(event) => update(index, { endDate: event.target.value || null })} /></label>
          </div>
          <label>概要<textarea aria-label={`経歴${index + 1}の概要`} rows={2} value={entry.description ?? ""} onChange={(event) => update(index, { description: event.target.value })} /></label>
          <button type="button" className="drawer-danger compact" onClick={() => onChange(entries.filter((_, current) => current !== index))}>この経歴を削除</button>
        </div>
      ))}
      <button type="button" className="drawer-secondary" onClick={() => onChange([...entries, { id: crypto.randomUUID(), title: "", organization: "", startDate: "", endDate: null, description: "" }])}>
        <Plus size={15} />経歴を追加
      </button>
    </div>
  );
}

export function ProfileRequestsPanel({
  state,
  identity,
  canManage = false,
  onCreateRequests,
  onSubmitRequest,
  onCompleteRequest,
  onCancelRequest,
}: {
  state: WorkspaceState;
  identity?: { userId?: string };
  canManage?: boolean;
  onCreateRequests?: (personIds: string[], input: { scope: ProfileRequestScope; note: string }) => void;
  onSubmitRequest?: (requestId: string, proposed: { skills: string; workHistory: WorkHistoryEntry[] }) => void;
  onCompleteRequest?: (requestId: string) => void;
  onCancelRequest?: (requestId: string) => void;
}) {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [scope, setScope] = useState<ProfileRequestScope>("skills");
  const [note, setNote] = useState("");
  const [createError, setCreateError] = useState("");
  const [submitSkills, setSubmitSkills] = useState<Record<string, string>>({});
  const [submitHistory, setSubmitHistory] = useState<Record<string, WorkHistoryEntry[]>>({});
  const [submitError, setSubmitError] = useState<Record<string, string>>({});
  const requests = state.profileRequests ?? [];
  const members = new Map(state.members.map((member) => [member.id, member]));
  const visible = requests.filter((request) => {
    if (canManage) return true;
    return canActAsProfileRequestSubject(members.get(request.personId), identity, false);
  });
  const openCount = visible.filter((request) => request.status === "open").length;
  const reviewCount = visible.filter((request) => request.status === "submitted").length;

  const toggleMember = (personId: string) => {
    setSelectedIds((current) => current.includes(personId) ? current.filter((id) => id !== personId) : [...current, personId]);
  };

  const create = () => {
    try {
      onCreateRequests?.(selectedIds, { scope, note });
      setSelectedIds([]);
      setNote("");
      setCreateError("");
    } catch (caught) {
      setCreateError(caught instanceof Error ? caught.message : "依頼を作成できませんでした");
    }
  };

  const submit = (request: ProfileRequest) => {
    try {
      const member = members.get(request.personId);
      onSubmitRequest?.(request.id, {
        skills: submitSkills[request.id] ?? formatSkillInput(memberSkillLevels(member ?? { skills: [] })),
        workHistory: submitHistory[request.id] ?? member?.workHistory ?? [],
      });
      setSubmitError((current) => ({ ...current, [request.id]: "" }));
    } catch (caught) {
      setSubmitError((current) => ({ ...current, [request.id]: caught instanceof Error ? caught.message : "提出できませんでした" }));
    }
  };

  return (
    <section className="balance-card profile-request-card" aria-labelledby="profile-request-heading">
      <div className="card-heading">
        <div><small>PROFILE REQUESTS</small><h3 id="profile-request-heading">プロフィール更新依頼</h3></div>
        <span>{openCount}件未対応 · {reviewCount}件確認待ち</span>
      </div>
      {canManage && onCreateRequests && (
        <form className="field-catalog-form profile-request-form" onSubmit={(event) => { event.preventDefault(); create(); }}>
          <fieldset className="profile-request-members">
            <legend>対象メンバー</legend>
            {state.members.map((member) => (
              <label key={member.id}>
                <input type="checkbox" checked={selectedIds.includes(member.id)} onChange={() => toggleMember(member.id)} />
                {member.name}
              </label>
            ))}
          </fieldset>
          <label>依頼内容<select aria-label="依頼内容" value={scope} onChange={(event) => setScope(event.target.value as ProfileRequestScope)}>
            <option value="skills">スキル</option>
            <option value="workHistory">業務経歴</option>
            <option value="all">スキルと経歴</option>
          </select></label>
          <label>メモ<input value={note} onChange={(event) => setNote(event.target.value)} placeholder="スキル棚卸しをお願いします" /></label>
          <button type="submit" className="view-add-button"><MailPlus size={15} />依頼を作成</button>
          {createError && <p className="skill-catalog-error" role="alert">{createError}</p>}
        </form>
      )}
      <div className="profile-request-list">
        {visible.map((request) => {
          const member = members.get(request.personId);
          const canSubmit = request.status === "open" && canActAsProfileRequestSubject(member, identity, canManage);
          const skillsValue = submitSkills[request.id] ?? formatSkillInput(memberSkillLevels(member ?? { skills: [] }));
          const historyValue = submitHistory[request.id] ?? member?.workHistory ?? [];
          return (
            <article className="profile-request-item" key={request.id}>
              <header>
                <strong>{member?.name ?? "不明なメンバー"}</strong>
                <small>{profileRequestScopeLabel(request.scope)} · {profileRequestStatusLabel(request.status)}</small>
              </header>
              {request.note && <p>{request.note}</p>}
              {request.status === "submitted" && request.proposedSkills?.length ? <p>提案スキル: {formatSkillInput(request.proposedSkills)}</p> : null}
              {request.status === "submitted" && request.proposedWorkHistory?.length ? <p>提案経歴: {request.proposedWorkHistory.map((entry) => entry.title).join("、")}</p> : null}
              {canSubmit && onSubmitRequest && (
                <div className="profile-request-submit">
                  {request.scope !== "workHistory" && <label>更新後のスキル<input aria-label={`${member?.name ?? "メンバー"}の更新スキル`} value={skillsValue} onChange={(event) => setSubmitSkills((current) => ({ ...current, [request.id]: event.target.value }))} placeholder="React:4, TypeScript:3" /></label>}
                  {request.scope !== "skills" && <WorkHistoryEditor entries={historyValue} onChange={(workHistory) => setSubmitHistory((current) => ({ ...current, [request.id]: workHistory }))} />}
                  <button type="button" className="view-add-button" onClick={() => submit(request)}><ClipboardCheck size={15} />{member?.name}の内容で提出</button>
                  {submitError[request.id] && <p className="skill-catalog-error" role="alert">{submitError[request.id]}</p>}
                </div>
              )}
              {canManage && request.status === "submitted" && onCompleteRequest && <button type="button" className="view-add-button" onClick={() => onCompleteRequest(request.id)}>{member?.name}を確認して反映</button>}
              {canManage && isActiveProfileRequest(request) && onCancelRequest && <button type="button" className="drawer-danger compact" onClick={() => onCancelRequest(request.id)}>{member?.name}の依頼を取り消す</button>}
            </article>
          );
        })}
        {visible.length === 0 && <p className="view-empty">表示できる更新依頼はありません。</p>}
      </div>
    </section>
  );
}
export function FieldsView({ state, onAddField, canManage = false, identity, onCreateRequests, onSubmitRequest, onCompleteRequest, onCancelRequest }: FieldsViewProps) {
  const [query, setQuery] = useState("");
  const [entityType, setEntityType] = useState<CustomFieldEntity | "すべて">("すべて");
  const [formEntity, setFormEntity] = useState<CustomFieldEntity>("member");
  const [key, setKey] = useState("");
  const [label, setLabel] = useState("");
  const [fieldType, setFieldType] = useState<CustomFieldType>("text");
  const [options, setOptions] = useState("");
  const [required, setRequired] = useState(false);
  const [showInList, setShowInList] = useState(false);
  const [showInDetail, setShowInDetail] = useState(true);
  const [searchable, setSearchable] = useState(true);
  const [error, setError] = useState("");
  const fields = (state.customFields ?? []).filter((field) => {
    const text = (field.label + " " + field.key).toLowerCase();
    return text.includes(query.toLowerCase()) && (entityType === "すべて" || field.entityType === entityType);
  });
  const memberCount = (state.customFields ?? []).filter((field) => field.entityType === "member").length;
  const projectCount = (state.customFields ?? []).filter((field) => field.entityType === "project").length;

  const submit = () => {
    try {
      onAddField({
        entityType: formEntity,
        key,
        label,
        fieldType,
        required,
        options: fieldType === "select" ? options.split(/[、,]/) : [],
        showInList,
        showInDetail,
        searchable,
      });
      setKey("");
      setLabel("");
      setOptions("");
      setError("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "項目を追加できませんでした");
    }
  };

  return (
    <section className="section-view fields-view" aria-labelledby="fields-heading">
      <h2 id="fields-heading" className="sr-only">項目定義</h2>
      <div className="member-ribbon">
        <div className="ribbon-lead"><span className="ribbon-icon mint"><SlidersHorizontal size={18} /></span><div><small>FIELD DEFINITIONS</small><strong>一覧・詳細・検索で使う独自項目を定義</strong></div></div>
        <div className="ribbon-stat"><strong>{memberCount}</strong><span>メンバー項目</span></div>
        <div className="ribbon-divider" />
        <div className="ribbon-stat"><strong>{projectCount}</strong><span>案件項目</span></div>
        <div className="ribbon-divider" />
        <div className="ribbon-stat"><strong>{(state.members.filter((member) => (member.workHistory ?? []).length > 0).length)}</strong><span>経歴あり</span></div>
      </div>

      <ProfileRequestsPanel
        state={state}
        identity={identity}
        canManage={canManage}
        onCreateRequests={onCreateRequests}
        onSubmitRequest={onSubmitRequest}
        onCompleteRequest={onCompleteRequest}
        onCancelRequest={onCancelRequest}
      />

      <div className="view-toolbar">
        <div className="inline-search"><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="項目名・キーを検索" aria-label="項目を検索" /></div>
        <label className="view-filter"><Filter size={14} /><select value={entityType} onChange={(event) => setEntityType(event.target.value as typeof entityType)} aria-label="項目の対象">
          {(["すべて", "member", "project"] as const).map((option) => <option value={option} key={option}>{option === "すべて" ? "すべて" : option === "member" ? "メンバー" : "プロジェクト"}</option>)}
        </select></label>
        <span className="toolbar-result">{fields.length}件を表示</span>
      </div>

      {canManage && (
        <form className="field-catalog-form" onSubmit={(event) => { event.preventDefault(); submit(); }}>
          <label>対象<select aria-label="項目の対象エンティティ" value={formEntity} onChange={(event) => setFormEntity(event.target.value as CustomFieldEntity)}><option value="member">メンバー</option><option value="project">プロジェクト</option></select></label>
          <label>項目名<input value={label} onChange={(event) => setLabel(event.target.value)} placeholder="雇用形態" /></label>
          <label>キー<input value={key} onChange={(event) => setKey(event.target.value)} placeholder="employment_type" /></label>
          <label>形式<select aria-label="項目の入力形式" value={fieldType} onChange={(event) => setFieldType(event.target.value as CustomFieldType)}><option value="text">テキスト</option><option value="number">数値</option><option value="date">日付</option><option value="select">選択</option></select></label>
          {fieldType === "select" && <label className="field-options">選択肢<input value={options} onChange={(event) => setOptions(event.target.value)} placeholder="正社員, 契約, 業務委託" /></label>}
          <label className="field-flag"><input type="checkbox" checked={required} onChange={(event) => setRequired(event.target.checked)} />必須</label>
          <label className="field-flag"><input type="checkbox" checked={showInList} onChange={(event) => setShowInList(event.target.checked)} />一覧</label>
          <label className="field-flag"><input type="checkbox" checked={showInDetail} onChange={(event) => setShowInDetail(event.target.checked)} />詳細</label>
          <label className="field-flag"><input type="checkbox" checked={searchable} onChange={(event) => setSearchable(event.target.checked)} />検索</label>
          <button type="submit" className="view-add-button"><Plus size={15} />項目を追加</button>
          {error && <p className="skill-catalog-error" role="alert">{error}</p>}
        </form>
      )}

      <div className="skill-map-wrap">
        <table className="skill-map-table">
          <thead>
            <tr>
              <th>項目</th>
              <th>対象</th>
              <th>形式</th>
              <th>画面</th>
              <th>必須</th>
            </tr>
          </thead>
          <tbody>
            {fields.map((field) => (
              <tr key={field.id}>
                <td><span className="skill-tree-name"><strong>{field.label}</strong><small>{field.key}</small></span></td>
                <td>{field.entityType === "member" ? "メンバー" : "プロジェクト"}</td>
                <td>{field.fieldType === "select" ? `選択（${(field.options ?? []).join(" / ")}）` : field.fieldType === "number" ? "数値" : field.fieldType === "date" ? "日付" : "テキスト"}</td>
                <td><span className="field-surfaces">{field.showInList ? "一覧" : ""}{field.showInDetail !== false ? " 詳細" : ""}{field.searchable !== false ? " 検索" : ""}</span></td>
                <td>{field.required ? "必須" : "任意"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {fields.length === 0 && <div className="view-empty"><SlidersHorizontal size={22} /><strong>条件に合う項目がありません</strong><p>検索語または対象を変更してください。</p></div>}
      </div>
    </section>
  );
}

export function OrgFacts({ state, personId }: { state: WorkspaceState; personId: string }) {
  const memberships = memberOrgMemberships(state, personId);
  if (memberships.length === 0) return null;
  const primary = memberships.find((item) => item.isPrimary);
  const extras = memberships.filter((item) => !item.isPrimary);
  const managed = memberships.filter((item) => item.isManager);
  return (
    <div className="detail-facts custom-field-facts">
      <div><span>主所属</span><strong>{primary ? orgUnitPath(state.orgUnits, primary.orgUnitId).join(" / ") : "未設定"}</strong></div>
      {extras.length > 0 && <div><span>兼務</span><strong>{extras.map((item) => orgUnitPath(state.orgUnits, item.orgUnitId).join(" / ")).join("、")}</strong></div>}
      {managed.length > 0 && <div><span>責任者</span><strong>{managed.map((item) => orgUnitByName(state, item.orgUnitId)).join("、")}</strong></div>}
    </div>
  );
}

function orgUnitByName(state: WorkspaceState, id: string) {
  return orgUnitTree(state.orgUnits).find((unit) => unit.id === id)?.name ?? id;
}

export function MemberOrgFields({ units, primaryUnitId, extraUnitIds, managerUnitIds, onChange }: MemberOrgFieldsProps) {
  if (units.length === 0) return null;
  const tree = orgUnitTree(units);
  const affiliated = new Set([primaryUnitId, ...extraUnitIds].filter(Boolean));
  const toggle = (list: string[], id: string, enabled: boolean) => enabled ? [...new Set([...list, id])] : list.filter((item) => item !== id);
  return (
    <div className="member-org-fields">
      <label htmlFor="member-primary-org">主所属
        <select
          id="member-primary-org"
          aria-label="主所属"
          required
          value={primaryUnitId}
          onChange={(event) => onChange({
            primaryUnitId: event.target.value,
            extraUnitIds: extraUnitIds.filter((id) => id !== event.target.value),
            managerUnitIds: managerUnitIds.filter((id) => id === event.target.value || extraUnitIds.includes(id)),
          })}
        >
          <option value="">未設定</option>
          {tree.map((unit) => <option value={unit.id} key={unit.id}>{orgUnitPath(units, unit.id).join(" / ")}</option>)}
        </select>
      </label>
      <fieldset className="org-flag-set">
        <legend>兼務</legend>
        {tree.filter((unit) => unit.id !== primaryUnitId).map((unit) => (
          <label className="field-flag" key={unit.id}>
            <input
              type="checkbox"
              checked={extraUnitIds.includes(unit.id)}
              onChange={(event) => onChange({
                primaryUnitId,
                extraUnitIds: toggle(extraUnitIds, unit.id, event.target.checked),
                managerUnitIds: event.target.checked ? managerUnitIds : managerUnitIds.filter((id) => id !== unit.id),
              })}
            />
            {orgUnitPath(units, unit.id).join(" / ")}
          </label>
        ))}
      </fieldset>
      <fieldset className="org-flag-set">
        <legend>責任者</legend>
        {tree.filter((unit) => affiliated.has(unit.id)).map((unit) => (
          <label className="field-flag" key={unit.id}>
            <input
              type="checkbox"
              aria-label={`${unit.name}の責任者`}
              checked={managerUnitIds.includes(unit.id)}
              onChange={(event) => onChange({
                primaryUnitId,
                extraUnitIds,
                managerUnitIds: toggle(managerUnitIds, unit.id, event.target.checked),
              })}
            />
            {orgUnitPath(units, unit.id).join(" / ")}
          </label>
        ))}
        {affiliated.size === 0 && <p className="org-flag-empty">所属を選ぶと責任者を設定できます。</p>}
      </fieldset>
    </div>
  );
}

export function OrgView({ state, onAddUnit, onMoveUnit, onArchiveUnit, canManage = false }: OrgViewProps) {
  const [query, setQuery] = useState("");
  const [name, setName] = useState("");
  const [parentId, setParentId] = useState("");
  const [error, setError] = useState("");
  const units = orgUnitTree(state.orgUnits);
  const filtered = units.filter((unit) => orgUnitPath(state.orgUnits, unit.id).join(" ").toLowerCase().includes(query.toLowerCase()));
  const roots = units.filter((unit) => !unit.parentId).length;
  const managers = new Set((state.orgMemberships ?? []).filter((item) => item.isManager).map((item) => item.personId)).size;
  const concurrent = new Set((state.orgMemberships ?? []).filter((item) => !item.isPrimary).map((item) => item.personId)).size;

  const submit = () => {
    try {
      addOrgUnit(state.orgUnits ?? [], { name, parentId: parentId || null });
      onAddUnit({ name, parentId: parentId || null });
      setName("");
      setError("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "部門を追加できませんでした");
    }
  };

  return (
    <section className="section-view org-view" aria-labelledby="org-heading">
      <h2 id="org-heading" className="sr-only">組織階層</h2>
      <div className="member-ribbon">
        <div className="ribbon-lead"><span className="ribbon-icon mint"><Building2 size={18} /></span><div><small>ORGANIZATION TREE</small><strong>部門階層・責任者・兼務を同じツリーで管理</strong></div></div>
        <div className="ribbon-stat"><strong>{units.length}</strong><span>部門</span></div>
        <div className="ribbon-divider" />
        <div className="ribbon-stat"><strong>{roots}</strong><span>最上位</span></div>
        <div className="ribbon-divider" />
        <div className="ribbon-stat"><strong>{managers}</strong><span>責任者</span></div>
        <div className="ribbon-divider" />
        <div className="ribbon-stat"><strong>{concurrent}</strong><span>兼務あり</span></div>
      </div>

      <div className="view-toolbar">
        <div className="inline-search"><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="部門名を検索" aria-label="部門を検索" /></div>
        <span className="toolbar-result">{filtered.length}件を表示</span>
      </div>

      {canManage && (
        <form className="skill-catalog-form org-catalog-form" onSubmit={(event) => { event.preventDefault(); submit(); }}>
          <label>部門名<input value={name} onChange={(event) => setName(event.target.value)} placeholder="新規チーム" aria-label="部門名" /></label>
          <label>親部門<select value={parentId} onChange={(event) => setParentId(event.target.value)} aria-label="親部門">
            <option value="">なし（最上位）</option>
            {units.map((unit) => <option value={unit.id} key={unit.id}>{orgUnitPath(state.orgUnits, unit.id).join(" / ")}</option>)}
          </select></label>
          <button type="submit" className="view-add-button"><Plus size={15} />部門を追加</button>
          {error && <p className="skill-catalog-error" role="alert">{error}</p>}
        </form>
      )}

      <div className="skill-map-wrap">
        <table className="skill-map-table">
          <thead>
            <tr>
              <th>部門</th>
              <th>主所属</th>
              <th>兼務</th>
              <th>責任者</th>
              {canManage && <th>親部門</th>}
              {canManage && <th><span className="sr-only">操作</span></th>}
            </tr>
          </thead>
          <tbody>
            {filtered.map((unit) => {
              const depth = Math.max(0, orgUnitPath(state.orgUnits, unit.id).length - 1);
              const primaryCount = membersInOrgSubtree(state, unit.id, "primary").length;
              const concurrentCount = membersInOrgSubtree(state, unit.id, "any").length - primaryCount;
              const managerNames = orgManagers(state, unit.id).map((member) => member.name);
              return (
                <tr key={unit.id} className={depth === 0 ? "category-row" : ""}>
                  <td>
                    <span className={"skill-tree-name depth-" + Math.min(3, depth)}>
                      <strong>{unit.name}</strong>
                      <small>{orgUnitPath(state.orgUnits, unit.id).slice(0, -1).join(" / ") || "最上位"}</small>
                    </span>
                  </td>
                  <td><strong>{primaryCount}</strong><small>名</small></td>
                  <td>{concurrentCount > 0 ? `${concurrentCount}名` : "—"}</td>
                  <td>{managerNames.join(" / ") || "未設定"}</td>
                  {canManage && (
                    <td>
                      <select
                        aria-label={`${unit.name}の親部門`}
                        value={unit.parentId ?? ""}
                        onChange={(event) => {
                          try {
                            moveOrgUnit(state.orgUnits ?? [], unit.id, event.target.value || null);
                            onMoveUnit(unit.id, event.target.value || null);
                            setError("");
                          } catch (caught) {
                            setError(caught instanceof Error ? caught.message : "部門を移せませんでした");
                          }
                        }}
                      >
                        <option value="">なし（最上位）</option>
                        {units.filter((candidate) => candidate.id !== unit.id).map((candidate) => (
                          <option value={candidate.id} key={candidate.id}>{orgUnitPath(state.orgUnits, candidate.id).join(" / ")}</option>
                        ))}
                      </select>
                    </td>
                  )}
                  {canManage && (
                    <td>
                      <button
                        type="button"
                        className="drawer-danger compact"
                        onClick={() => {
                          try {
                            archiveOrgUnit(state, unit.id);
                            onArchiveUnit(unit.id);
                            setError("");
                          } catch (caught) {
                            setError(caught instanceof Error ? caught.message : "部門を削除できませんでした");
                          }
                        }}
                      >
                        <Trash2 size={13} />削除
                      </button>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
        {filtered.length === 0 && <div className="view-empty"><Building2 size={22} /><strong>条件に合う部門がありません</strong><p>検索語を変更するか、部門を追加してください。</p></div>}
      </div>
    </section>
  );
}
