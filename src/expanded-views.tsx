import { useMemo, useState } from "react";
import {
  ArrowRight,
  BriefcaseBusiness,
  CalendarClock,
  ChevronRight,
  CircleAlert,
  Filter,
  Gauge,
  Layers3,
  Plus,
  Search,
  SlidersHorizontal,
  Sparkles,
  UserRoundPlus,
  UsersRound,
} from "lucide-react";
import {
  addDays,
  addSkillCatalogEntry,
  buildSkillMap,
  customValue,
  formatCustomValue,
  formatWorkHistoryPeriod,
  getWeekStart,
  isActiveOpportunity,
  memberDailyLoads,
  memberLoad,
  memberSearchText,
  memberSkillLevels,
  OPPORTUNITY_STAGE_LABELS,
  opportunityNeedsFor,
  opportunitySearchText,
  pipelineDemandForWeek,
  PROFICIENCY_LABELS,
  projectMembers,
  projectSearchText,
  sortedWorkHistory,
  visibleCustomFields,
  type CustomFieldDefinition,
  type CustomFieldEntity,
  type CustomFieldType,
  type OpportunityStage,
  type Project,
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
  canEdit?: boolean;
  canManageMembers?: boolean;
};

type ReportsViewProps = {
  state: WorkspaceState;
  onOpenWeek: (offset: number) => void;
  onResolveNeed: (needId: string) => void;
  onOpenOpportunity?: (opportunityId: string) => void;
  canEdit?: boolean;
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

export function MembersView({ state, weekOffset, onOpen, onAdd, onAssign, canEdit = true, canManageMembers = true }: MembersViewProps) {
  const [query, setQuery] = useState("");
  const [role, setRole] = useState("すべて");
  const weekStart = getWeekStart(weekOffset);
  const roles = ["すべて", ...Array.from(new Set(state.members.map((member) => member.role)))];
  const queryNeedle = query.toLowerCase();
  const filtered = state.members.filter((member) => {
    const textMatch = memberSearchText(state, member).includes(queryNeedle);
    return textMatch && (role === "すべて" || member.role === role);
  }).sort((a, b) => {
    const aUtilization = a.capacity > 0 ? memberLoad(state, a.id, weekStart) / a.capacity : Number.POSITIVE_INFINITY;
    const bUtilization = b.capacity > 0 ? memberLoad(state, b.id, weekStart) / b.capacity : Number.POSITIVE_INFINITY;
    return aUtilization - bUtilization;
  });

  const available = state.members.filter((member) => member.capacity > 0 && memberLoad(state, member.id, weekStart) <= member.capacity * .6).length;
  const overloaded = state.members.filter((member) => memberLoad(state, member.id, weekStart) > member.capacity).length;
  const listFields = visibleCustomFields(state.customFields, "member", "list");

  return (
    <section className="section-view members-view" aria-labelledby="members-heading">
      <h2 id="members-heading" className="sr-only">メンバー一覧</h2>
      <div className="member-ribbon">
        <div className="ribbon-lead"><span className="ribbon-icon mint"><UsersRound size={18} /></span><div><small>TEAM AVAILABILITY</small><strong>空きが大きい順にメンバーを表示</strong></div></div>
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
        <span className="toolbar-result">空き率の高い順</span>
        {canManageMembers && <button className="view-add-button" onClick={onAdd}><Plus size={15} />メンバーを追加</button>}
      </div>

      <div className="member-table-wrap">
        <table className="member-table">
          <thead><tr><th>メンバー</th><th>スキル</th>{listFields.map((field) => <th key={field.id}>{field.label}</th>)}<th>今週</th><th>4週間のキャパシティ</th><th>次の空き</th><th><span className="sr-only">操作</span></th></tr></thead>
          <tbody>
            {filtered.map((member) => {
              const load = memberLoad(state, member.id, weekStart);
              const weeklyLoads = [0, 1, 2, 3].map((offset) => memberLoad(state, member.id, addDays(weekStart, offset * 7)));
              const nextOpen = member.capacity > 0 ? weeklyLoads.findIndex((value) => value <= member.capacity * .6) : -1;
              const loadRatio = member.capacity > 0 ? load / member.capacity * 100 : load > 0 ? 100 : 0;
              return (
                <tr key={member.id}>
                  <td><button className="member-name-cell" onClick={() => onOpen(member.id)}><span className={"avatar " + member.avatarTone}>{member.initials}</span><span><strong>{member.name}</strong><small>{member.role} · {member.department}</small></span></button></td>
                  <td><div className="member-skills">{memberSkillLevels(member).slice(0, 3).map((level) => <span key={level.name}>{level.name}<small>{level.proficiency}</small></span>)}</div></td>
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

export function ReportsView({ state, onOpenWeek, onResolveNeed, onOpenOpportunity, canEdit = true }: ReportsViewProps) {
  const [range, setRange] = useState(8);
  const weekOffsets = useMemo(() => Array.from({ length: range }, (_, index) => index), [range]);
  const horizon = weekOffsets.map((offset) => {
    const weekStart = getWeekStart(offset);
    const capacity = state.members.reduce((sum, member) => sum + member.capacity, 0) * 5;
    const load = state.members.reduce((sum, member) => sum + memberDailyLoads(state, member.id, weekStart, addDays(weekStart, 4)).reduce((dailySum, day) => dailySum + day.load, 0), 0);
    const confirmed = state.assignments.filter((assignment) => assignment.status === "confirmed" && assignment.startDate <= addDays(weekStart, 4) && assignment.endDate >= weekStart).length;
    const draft = state.assignments.filter((assignment) => assignment.status === "draft" && assignment.startDate <= addDays(weekStart, 4) && assignment.endDate >= weekStart).length;
    return { offset, weekStart, average: capacity > 0 ? Math.round(load / capacity * 100) : 0, confirmed, draft, pipelineDemand: pipelineDemandForWeek(state, weekStart) };
  });
  const departments = Array.from(new Set(state.members.map((member) => member.department))).map((department) => {
    const people = state.members.filter((member) => member.department === department);
    const weekStart = getWeekStart(0);
    const capacity = people.reduce((sum, member) => sum + member.capacity, 0) * 5;
    const load = people.reduce((sum, member) => sum + memberDailyLoads(state, member.id, weekStart, addDays(weekStart, 4)).reduce((dailySum, day) => dailySum + day.load, 0), 0);
    return { department, count: people.length, average: capacity > 0 ? Math.round(load / capacity * 100) : 0 };
  }).sort((a, b) => b.average - a.average);
  const currentOverloads = state.members.filter((member) => memberLoad(state, member.id, getWeekStart(0)) > member.capacity);
  const activeNeeds = state.needs.filter((need) => need.status !== "filled");
  const activeOpportunities = (state.opportunities ?? []).filter(isActiveOpportunity);
  const pipelineNeeds = (state.opportunityNeeds ?? []).filter((need) => activeOpportunities.some((opportunity) => opportunity.id === need.opportunityId));

  return (
    <section className="section-view reports-view" aria-labelledby="reports-heading">
      <div className="report-toolbar">
        <div><small>CAPACITY HORIZON</small><h2 id="reports-heading">需給バランスの見通し</h2><p>確定稼働と受注前の想定人数を分けて確認します。</p></div>
        <div className="range-tabs" aria-label="表示期間">{[4, 8, 12].map((weeks) => <button className={range === weeks ? "selected" : ""} aria-pressed={range === weeks} onClick={() => setRange(weeks)} key={weeks}>{weeks}週間</button>)}</div>
      </div>

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
          <div className="card-heading"><div><small>BY DEPARTMENT</small><h3>部署別の需給</h3></div><Gauge size={18} /></div>
          <div className="department-list">{departments.map((item) => <div key={item.department}><span><strong>{item.department}</strong><small>{item.count}名</small></span><i><b className={item.average > 100 ? "over" : ""} style={{ width: Math.min(100, item.average) + "%" }} /></i><em>{item.average}%</em></div>)}</div>
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

export function FieldsView({ state, onAddField, canManage = false }: FieldsViewProps) {
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
