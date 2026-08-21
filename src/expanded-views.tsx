import { Fragment, useMemo, useState } from "react";
import {
  ArrowRight,
  BriefcaseBusiness,
  Building2,
  CalendarClock,
  ChevronRight,
  CircleAlert,
  ClipboardCheck,
  Download,
  EyeOff,
  Filter,
  Gauge,
  Layers3,
  MailPlus,
  Plus,
  Search,
  SlidersHorizontal,
  Sparkles,
  Star,
  Trash2,
  Upload,
  UserRoundPlus,
  UsersRound,
} from "lucide-react";
import {
  anonymousCandidateLabel,
  isFavorited,
  MAX_PROPOSAL_MEMBERS,
  type Favorite,
} from "./collaboration";
import {
  exportMembersCsv,
  exportProjectsCsv,
  memberCsvColumns,
  parseCsv,
  previewMemberImport,
  projectCsvColumns,
  readCsvPresets,
  writeCsvPresets,
  type CsvExportPreset,
  type CsvIssue,
  type CsvSource,
  type MemberImportAction,
  CSV_PRESETS_KEY,
} from "./csv";
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
  orgUnitArchiveBlocker,
  orgUnitLoadRows,
  orgUnitPath,
  orgUnitTree,
  matchMembers,
  memberById,
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
  PERSON_SCOPES,
  RESTRICTABLE_FEATURES,
  RESTRICTABLE_ROLES,
  type CustomFieldDefinition,
  type CustomFieldEntity,
  type CustomFieldType,
  type Member,
  type OpportunityStage,
  type OrgUnit,
  type PersonScope,
  type ProfileRequest,
  type ProfileRequestScope,
  type Project,
  type ReportGroupBy,
  type RestrictableFeature,
  type RestrictableRole,
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
  query?: string;
  onQueryChange?: (query: string) => void;
  favorites?: Favorite[];
  favoritesOnly?: boolean;
  onFavoritesOnlyChange?: (value: boolean) => void;
  onToggleFavorite?: (projectId: string) => void;
  onCopyQuery?: () => void;
};

type MembersViewProps = {
  state: WorkspaceState;
  weekOffset: number;
  onOpen: (memberId: string) => void;
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
  query?: string;
  onQueryChange?: (query: string) => void;
  favorites?: Favorite[];
  favoritesOnly?: boolean;
  onFavoritesOnlyChange?: (value: boolean) => void;
  onToggleFavorite?: (memberId: string) => void;
  onAddToProposal?: (memberId: string) => void;
  onCopyQuery?: () => void;
};

type ProposalViewProps = {
  state: WorkspaceState;
  weekOffset: number;
  selectedIds: string[];
  anonymous: boolean;
  favorites?: Favorite[];
  onSelectedIdsChange: (ids: string[]) => void;
  onAnonymousChange: (value: boolean) => void;
  onOpenMember: (memberId: string) => void;
  onToggleFavorite?: (memberId: string) => void;
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
  canManageRequests?: boolean;
  canManageAdminPermissions?: boolean;
  onSaveRolePermission?: (input: {
    role: RestrictableRole;
    personScope: PersonScope;
    hiddenFieldKeys: string[];
    readonlyFieldKeys: string[];
    disabledFeatures: RestrictableFeature[];
  }) => void;
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


/**
 * One week of a project's staffing, for both the bar's `title` and the rail's
 * accessible name. The rail carried neither the week numbers nor the counts in
 * its name, so a screen reader got 「4週間の充足人数」 and nothing else (#85).
 */
function weekStaffingLabel(index: number, count: number, demand: number) {
  return demand === 0 ? `${index + 1}週目: 必要人数未設定` : `${index + 1}週目: ${count}/${demand}名`;
}

export function FavoriteStar({ name, pressed, onToggle }: { name: string; pressed: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      className={"favorite-star" + (pressed ? " is-on" : "")}
      aria-pressed={pressed}
      aria-label={pressed ? `${name}のお気に入りを解除` : `${name}をお気に入りに追加`}
      onClick={(event) => {
        event.stopPropagation();
        onToggle();
      }}
    >
      <Star size={14} fill={pressed ? "currentColor" : "none"} />
    </button>
  );
}

export function ProjectsView({
  state,
  weekOffset,
  onOpen,
  query,
  onQueryChange,
  favorites = [],
  favoritesOnly = false,
  onFavoritesOnlyChange,
  onToggleFavorite,
  onCopyQuery,
}: ProjectsViewProps) {
  const [localQuery, setLocalQuery] = useState("");
  const [status, setStatus] = useState("すべて");
  const weekStart = getWeekStart(weekOffset);
  const searchValue = query ?? localQuery;
  const queryNeedle = searchValue.toLowerCase();
  const setSearchValue = (value: string) => {
    if (onQueryChange) onQueryChange(value);
    else setLocalQuery(value);
  };
  const filtered = state.projects.filter((project) => {
    const need = state.needs.some((item) => item.projectId === project.id && item.status !== "filled");
    const textMatch = projectSearchText(state, project).includes(queryNeedle);
    const statusMatch = status === "すべて" || project.status === status || (status === "欠員あり" && need);
    const favoriteMatch = !favoritesOnly || isFavorited(favorites, "project", project.id);
    return textMatch && statusMatch && favoriteMatch;
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
        <div className="inline-search"><Search size={15} /><input value={searchValue} onChange={(event) => setSearchValue(event.target.value)} placeholder="案件名・責任者を検索" aria-label="案件を検索" /></div>
        <label className="view-filter"><Filter size={14} /><select value={status} onChange={(event) => setStatus(event.target.value)} aria-label="プロジェクト状態で絞り込み">
          {["すべて", "進行中", "要注意", "準備中", "完了間近", "完了", "欠員あり"].map((option) => <option key={option}>{option}</option>)}
        </select></label>
        <label className="view-toggle"><input type="checkbox" checked={favoritesOnly} onChange={(event) => onFavoritesOnlyChange?.(event.target.checked)} disabled={!onFavoritesOnlyChange} />お気に入りのみ</label>
        <span className="toolbar-result">{filtered.length}件を表示</span>
        {onCopyQuery && searchValue.trim() && <button className="view-add-button ghost" type="button" onClick={onCopyQuery}>検索リンクをコピー</button>}
      </div>

      {/* The rail is four bars with no week labels and no key. `title` puts the
          numbers within reach of a mouse only, so the values go in the rail's
          accessible name and the reading of the bars goes here, once, rather
          than per row (#85). */}
      <p className="viz-caption">「4週間の充足」は今週から4週分。バーの長さが充足率で、必要人数に届かない週は橙色です。</p>

      <div className="portfolio-table-wrap">
        <table className="portfolio-table">
          <thead>
            <tr><th className="col-favorite"><span className="sr-only">お気に入り</span></th><th className="col-name">プロジェクト</th><th className="col-status">状態</th>{listFields.map((field) => <th key={field.id} className="col-custom">{field.label}</th>)}<th className="col-rail">4週間の充足</th><th className="col-progress">進捗</th><th className="col-milestone">次の節目</th><th className="col-owner">責任者</th><th className="col-open"><span className="sr-only">詳細</span></th></tr>
          </thead>
          <tbody>
            {filtered.map((project) => {
              const currentMembers = projectMembers(state, project.id, weekStart);
              const need = state.needs.find((item) => item.projectId === project.id && item.status !== "filled");
              const weeks = [0, 1, 2, 3].map((offset) => projectMembers(state, project.id, addDays(weekStart, offset * 7)));
              return (
                <tr key={project.id}>
                  <td>{onToggleFavorite ? <FavoriteStar name={project.name} pressed={isFavorited(favorites, "project", project.id)} onToggle={() => onToggleFavorite(project.id)} /> : null}</td>
                  <td>
                    <button className="project-name-cell" onClick={() => onOpen(project.id)}>
                      <span className={"project-code " + project.tone}>{project.code}</span>
                      <span className="row-name-copy"><strong>{project.name}</strong><small>{project.summary}</small></span>
                    </button>
                  </td>
                  <td><span className={"status-pill " + statusClass[project.status]}><i />{project.status}</span>{need && <small className={"need-note " + (need.status === "planned" ? "planned" : "")}>{need.status === "planned" ? "解消予定" : need.role + " 不足"}</small>}</td>
                  {listFields.map((field) => <td key={field.id}><span className="custom-field-cell">{formatCustomValue(field, customValue(project.customValues, field.id))}</span></td>)}
                  <td>
                    <div className="four-week-rail" aria-label={project.name + "の4週間の充足人数：" + weeks.map((count, index) => weekStaffingLabel(index, count, project.demand)).join("、")}>
                      {weeks.map((count, index) => <i key={index} title={weekStaffingLabel(index, count, project.demand)}><b className={project.demand > 0 && count < project.demand ? "short" : ""} style={{ width: (project.demand === 0 ? 100 : Math.min(100, count / project.demand * 100)) + "%" }} /></i>)}
                    </div>
                    <span className="staffed-label">{project.demand === 0 ? "必要人数未設定" : `今週 ${currentMembers}/${project.demand}名`}</span>
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
        {filtered.length === 0 && <div className="view-empty"><BriefcaseBusiness size={22} /><strong>条件に合うプロジェクトがありません</strong><p>{favoritesOnly ? "お気に入りの条件を変更してください。" : "検索語または状態を変更してください。"}</p></div>}
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

export function OpportunitiesView({ state, onOpen }: OpportunitiesViewProps) {
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
              <tr><th className="col-name">案件</th><th className="col-status">段階</th><th className="col-period">想定期間</th><th className="col-headcount">必要人数</th><th className="col-owner">責任者</th><th className="col-open"><span className="sr-only">詳細</span></th></tr>
            </thead>
            <tbody>
              {filtered.filter((opportunity) => !isActiveOpportunity(opportunity)).map((opportunity) => (
                <tr key={opportunity.id}>
                  <td>
                    <button className="project-name-cell" onClick={() => onOpen(opportunity.id)}>
                      <span className={"project-code " + opportunity.tone}>{opportunity.code}</span>
                      <span className="row-name-copy"><strong>{opportunity.name}</strong><small>{opportunity.summary}</small></span>
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

export function MembersView({
  state,
  weekOffset,
  onOpen,
  onAssign,
  onAddScene,
  onDeleteScene,
  canEdit = true,
  canManageScenes = false,
  query,
  onQueryChange,
  favorites = [],
  favoritesOnly = false,
  onFavoritesOnlyChange,
  onToggleFavorite,
  onAddToProposal,
  onCopyQuery,
}: MembersViewProps) {
  const [localQuery, setLocalQuery] = useState("");
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
  const searchValue = query ?? localQuery;
  const queryNeedle = searchValue.toLowerCase();
  const setSearchValue = (value: string) => {
    if (onQueryChange) onQueryChange(value);
    else setLocalQuery(value);
  };
  const scopedMembers = orgFilter ? membersInOrgSubtree(state, orgFilter, "any") : state.members;
  const filtered = (selectedScene ? scopedMembers.filter((member) => scoreById.has(member.id)) : scopedMembers).filter((member) => {
    const textMatch = memberSearchText(state, member).includes(queryNeedle);
    const favoriteMatch = !favoritesOnly || isFavorited(favorites, "member", member.id);
    return textMatch && favoriteMatch && (role === "すべて" || member.role === role);
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
        <div className="ribbon-lead"><span className="ribbon-icon mint"><UsersRound size={18} /></span><div><small>TEAM AVAILABILITY</small><strong>{selectedScene ? "保存シーンのスコア順に候補を表示" : "稼働率の低い順にメンバーを表示"}</strong></div></div>
        <div className="ribbon-stat"><strong>{state.members.length}</strong><span>登録メンバー</span></div>
        <div className="ribbon-divider" />
        <div className="ribbon-stat good"><strong>{available}</strong><span>稼働率60%以下</span></div>
        <div className="ribbon-divider" />
        <div className="ribbon-stat risk"><strong>{overloaded}</strong><span>上限超過</span></div>
        <div className="capacity-legend"><span>稼働率</span><span><i className="open" />60%以下</span><span><i className="steady" />適正</span><span><i className="hot" />上限超過</span></div>
      </div>

      <div className="view-toolbar">
        <div className="inline-search"><Search size={15} /><input value={searchValue} onChange={(event) => setSearchValue(event.target.value)} placeholder="名前・スキル・経歴を検索" aria-label="メンバーを検索" /></div>
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
        <label className="view-toggle"><input type="checkbox" checked={favoritesOnly} onChange={(event) => onFavoritesOnlyChange?.(event.target.checked)} disabled={!onFavoritesOnlyChange} />お気に入りのみ</label>
        <span className="toolbar-result">{selectedScene ? "スコアの高い順" : "稼働率の低い順"}</span>
        {onCopyQuery && searchValue.trim() && <button className="view-add-button ghost" type="button" onClick={onCopyQuery}>検索リンクをコピー</button>}
      </div>

      {/* Folded by default: this screen exists to show candidates, and the nine
          fields for saving a search scene were the tallest thing standing
          between the top of the page and the first one (#81 has the numbers).
          `<details>` rather than state and a button, for the native semantics
          and the expanded-state mapping. The summary names what is inside
          rather than repeating the action — 「検索シーンを保存」 is the button
          within, and two similarly named controls are hard to tell apart by
          voice. */}
      {canManageScenes && (
        <details className="search-scene-disclosure">
          <summary>検索シーンの条件を入力</summary>
          <form className="field-catalog-form search-scene-form" onSubmit={(event) => { event.preventDefault(); submitScene(); }}>
          <label>シーン名<input value={sceneName} onChange={(event) => setSceneName(event.target.value)} placeholder="フロントエンド候補" /></label>
          <label>職種<input value={sceneRole} onChange={(event) => setSceneRole(event.target.value)} placeholder="Frontend Engineer" /></label>
          <label>勤務地<input value={sceneLocation} onChange={(event) => setSceneLocation(event.target.value)} placeholder="東京" /></label>
          <label>検索語<input value={sceneQuery} onChange={(event) => setSceneQuery(event.target.value)} placeholder="React" /></label>
          <label>必須スキル<input value={mustSkills} onChange={(event) => setMustSkills(event.target.value)} placeholder="React:3, TypeScript:3" /></label>
          <label>歓迎スキル<input value={niceSkills} onChange={(event) => setNiceSkills(event.target.value)} placeholder="A11y:3" /></label>
          <label>開始日<input type="date" value={sceneStart} onChange={(event) => setSceneStart(event.target.value)} aria-label="検索シーンの開始日" /></label>
          <label>終了日<input type="date" value={sceneEnd} onChange={(event) => setSceneEnd(event.target.value)} aria-label="検索シーンの終了日" /></label>
          <label>最小空き（%）<input type="number" min={0} max={100} value={sceneMinAvailable} onChange={(event) => setSceneMinAvailable(event.target.value)} placeholder="40" /></label>
          <button type="submit" className="view-add-button"><Plus size={15} />検索シーンを保存</button>
          {error && <p className="skill-catalog-error" role="alert">{error}</p>}
          </form>
        </details>
      )}

      <div className="member-table-wrap">
        <table className="member-table">
          <thead><tr><th className="col-favorite"><span className="sr-only">お気に入り</span></th><th className="col-name">メンバー</th><th className="col-skills">スキル</th>{selectedScene && <th className="col-score">スコア</th>}{listFields.map((field) => <th key={field.id} className="col-custom">{field.label}</th>)}<th className="col-week">今週の稼働</th><th className="col-rail">4週間の稼働</th><th className="col-next">次に稼働率60%以下</th><th className="col-actions"><span className="sr-only">操作</span></th></tr></thead>
          <tbody>
            {filtered.map((member) => {
              const load = memberLoad(state, member.id, weekStart);
              const weeklyLoads = [0, 1, 2, 3].map((offset) => memberLoad(state, member.id, addDays(weekStart, offset * 7)));
              const nextOpen = member.capacity > 0 ? weeklyLoads.findIndex((value) => value <= member.capacity * .6) : -1;
              const loadRatio = member.capacity > 0 ? load / member.capacity * 100 : load > 0 ? 100 : 0;
              const match = scoreById.get(member.id);
              return (
                <tr key={member.id}>
                  <td>{onToggleFavorite ? <FavoriteStar name={member.name} pressed={isFavorited(favorites, "member", member.id)} onToggle={() => onToggleFavorite(member.id)} /> : null}</td>
                  <td><button className="member-name-cell" onClick={() => onOpen(member.id)}><span className={"avatar " + member.avatarTone}>{member.initials}</span><span className="row-name-copy"><strong>{member.name}</strong><small>{member.role} · {member.department}{memberOrgMemberships(state, member.id).some((item) => !item.isPrimary) ? " · 兼務あり" : ""}</small></span></button></td>
                  <td><div className="member-skills">{memberSkillLevels(member).slice(0, 3).map((level) => <span key={level.name}>{level.name}<small>{level.proficiency}</small></span>)}</div></td>
                  {selectedScene && <td><span className="match-score">{match?.score ?? 0}点<small>空き{match?.availablePercent ?? 0}%</small></span></td>}
                  {listFields.map((field) => <td key={field.id}><span className="custom-field-cell">{formatCustomValue(field, customValue(member.customValues, field.id))}</span></td>)}
                  <td><span className={"load-ring " + (load > member.capacity ? "over" : member.capacity > 0 && load <= member.capacity * .6 ? "open" : "")} style={{ "--load": Math.min(100, loadRatio) } as React.CSSProperties}><strong>{load}%</strong></span><small className="capacity-limit">稼働上限 {member.capacity}%</small></td>
                  <td><div className="member-week-rail">{weeklyLoads.map((value, index) => { const ratio = member.capacity > 0 ? value / member.capacity * 100 : value > 0 ? 100 : 0; /* The label is a sibling of the bar, not a child: it belongs to its own grid track so it cannot overlap the next week's. */ return <Fragment key={index}><i className={value > member.capacity ? "over" : member.capacity > 0 && value <= member.capacity * .6 ? "open" : ""}><b style={{ height: Math.max(12, Math.min(100, ratio)) + "%" }} /></i><small>{value}%</small></Fragment>; })}</div></td>
                  <td><span className="next-open">{member.capacity === 0 ? "稼働不可 · 稼働上限0%" : nextOpen === -1 ? "4週間で該当なし" : nextOpen === 0 ? "今週 空き" + Math.max(0, member.capacity - load) + "%" : (nextOpen + 1) + "週後"}<small>{member.location}</small></span></td>
                  <td className="member-row-actions">{onAddToProposal && <button className="quick-assign quiet" onClick={() => onAddToProposal(member.id)}><Sparkles size={14} />提案へ</button>}{canEdit ? <button className="quick-assign" onClick={() => onAssign(member.id)}><UserRoundPlus size={14} />アサイン</button> : <span className="read-only-label">閲覧のみ</span>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {filtered.length === 0 && <div className="view-empty"><UsersRound size={22} /><strong>条件に合うメンバーがいません</strong><p>{favoritesOnly ? "お気に入りの条件を変更してください。" : "検索語または職種を変更してください。"}</p></div>}
      </div>
    </section>
  );
}


function proposalWeeklyLoads(state: WorkspaceState, member: Member, weekStart: string) {
  return [0, 1, 2, 3].map((offset) => memberLoad(state, member.id, addDays(weekStart, offset * 7)));
}

export function ProposalView({
  state,
  weekOffset,
  selectedIds,
  anonymous,
  favorites = [],
  onSelectedIdsChange,
  onAnonymousChange,
  onOpenMember,
  onToggleFavorite,
}: ProposalViewProps) {
  const [pickerQuery, setPickerQuery] = useState("");
  const weekStart = getWeekStart(weekOffset);
  const selected = selectedIds
    .map((id) => memberById(state, id))
    .filter((member): member is Member => Boolean(member));
  const needle = pickerQuery.toLowerCase();
  const pickerMembers = state.members.filter((member) => {
    if (selectedIds.includes(member.id)) return false;
    return memberSearchText(state, member).includes(needle);
  });
  const favoriteMembers = state.members.filter((member) => isFavorited(favorites, "member", member.id) && !selectedIds.includes(member.id));

  const addMember = (memberId: string) => {
    if (selectedIds.includes(memberId) || selectedIds.length >= MAX_PROPOSAL_MEMBERS) return;
    onSelectedIdsChange([...selectedIds, memberId]);
  };

  return (
    <section className="section-view proposal-view" aria-labelledby="proposal-heading">
      <h2 id="proposal-heading" className="sr-only">候補者提案</h2>
      <div className="member-ribbon">
        <div className="ribbon-lead">
          <span className="ribbon-icon mint"><Sparkles size={18} /></span>
          <div>
            <small>ANONYMOUS PROPOSAL</small>
            <strong>{anonymous ? "氏名を隠して候補を比較します" : "社内向けに候補を並べます"}</strong>
          </div>
        </div>
        <div className="ribbon-stat"><strong>{selected.length}</strong><span>選定中</span></div>
        <div className="ribbon-divider" />
        <div className="ribbon-stat"><strong>{anonymous ? "匿名" : "記名"}</strong><span>表示モード</span></div>
      </div>

      <div className="view-toolbar">
        <label className="view-toggle">
          <input type="checkbox" checked={anonymous} onChange={(event) => onAnonymousChange(event.target.checked)} />
          <EyeOff size={14} />氏名・勤務地を隠す
        </label>
        <span className="toolbar-result">最大{MAX_PROPOSAL_MEMBERS}名。社内リンクはログインが必要です。</span>
      </div>

      <div className="proposal-layout">
        <aside className="proposal-picker">
          <div className="inline-search"><Search size={15} /><input value={pickerQuery} onChange={(event) => setPickerQuery(event.target.value)} placeholder="候補を検索して追加" aria-label="提案に追加するメンバーを検索" /></div>
          {favoriteMembers.length > 0 && (
            <div className="proposal-picker-group">
              <small>お気に入り</small>
              {favoriteMembers.slice(0, 8).map((member) => (
                <button type="button" key={member.id} className="proposal-picker-item" onClick={() => addMember(member.id)} disabled={selectedIds.length >= MAX_PROPOSAL_MEMBERS}>
                  <span className={"avatar " + member.avatarTone}>{member.initials}</span>
                  <span className="proposal-picker-copy"><strong>{member.name}</strong><small>{member.role}</small></span>
                  <Plus size={14} />
                </button>
              ))}
            </div>
          )}
          <div className="proposal-picker-group">
            <small>メンバー</small>
            {pickerMembers.slice(0, 12).map((member) => (
              <button type="button" key={member.id} className="proposal-picker-item" onClick={() => addMember(member.id)} disabled={selectedIds.length >= MAX_PROPOSAL_MEMBERS}>
                <span className={"avatar " + member.avatarTone}>{member.initials}</span>
                <span className="proposal-picker-copy"><strong>{member.name}</strong><small>{member.role}</small></span>
                <Plus size={14} />
              </button>
            ))}
            {pickerMembers.length === 0 && <p className="proposal-picker-empty">追加できるメンバーがありません。</p>}
          </div>
        </aside>

        <div className="proposal-cards">
          {selected.length === 0 && (
            <div className="view-empty proposal-empty">
              <UsersRound size={22} />
              <strong>左側から候補を追加してください</strong>
              <p>匿名にすると、共有リンクを開いた社内メンバーにも氏名は出ません。</p>
            </div>
          )}
          {selected.map((member, index) => {
            const label = anonymous ? anonymousCandidateLabel(index) : member.name;
            const weeklyLoads = proposalWeeklyLoads(state, member, weekStart);
            return (
              <article className={"proposal-card" + (anonymous ? " is-anonymous" : "")} key={member.id}>
                <header>
                  <span className={"avatar " + (anonymous ? "sand" : member.avatarTone)}>{anonymous ? anonymousCandidateLabel(index).slice(-1) : member.initials}</span>
                  <div>
                    <h3>{label}</h3>
                    <p>{member.role}{anonymous ? "" : ` · ${member.department}`}</p>
                    {!anonymous && <small>{member.location}</small>}
                  </div>
                  {onToggleFavorite && !anonymous && <FavoriteStar name={member.name} pressed={isFavorited(favorites, "member", member.id)} onToggle={() => onToggleFavorite(member.id)} />}
                  <button type="button" className="proposal-remove" onClick={() => onSelectedIdsChange(selectedIds.filter((id) => id !== member.id))}>外す</button>
                </header>
                <div className="member-skills">{memberSkillLevels(member).slice(0, 4).map((level) => <span key={level.name}>{level.name}<small>{level.proficiency}</small></span>)}</div>
                <div className="proposal-weeks" aria-label={`${label}の4週間の稼働`}>
                  {weeklyLoads.map((load, weekIndex) => {
                    const ratio = member.capacity > 0 ? load / member.capacity * 100 : load > 0 ? 100 : 0;
                    return (
                      <div key={weekIndex}>
                        <span>{weekIndex === 0 ? "今週" : `${weekIndex + 1}週後`}</span>
                        <i><b className={load > member.capacity ? "over" : ""} style={{ width: Math.min(100, ratio) + "%" }} /></i>
                        <strong>{load}% / {member.capacity}%</strong>
                      </div>
                    );
                  })}
                </div>
                {!anonymous && <button type="button" className="proposal-open" onClick={() => onOpenMember(member.id)}>詳細を開く</button>}
              </article>
            );
          })}
        </div>
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

      {/* Position is the encoding in the 習熟度 rail — the five cells are levels
          1 to 5 — and nothing on the screen said so. This is the key for the
          positions, not for the colours, and it also names what the number in a
          cell counts (#85). */}
      <p className="viz-caption">習熟度は左から <b>初級</b>・<b>基礎</b>・<b>実務</b>・<b>応用</b>・<b>指導</b> の5段階。マスの数字は保有者数です。</p>

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
                  <div className="proficiency-rail" aria-label={`${row.name}の習熟度分布：${([1, 2, 3, 4, 5] as const).map((level) => `${PROFICIENCY_LABELS[level]} ${row.byProficiency[level]}名`).join("、")}`}>
                    {([1, 2, 3, 4, 5] as const).map((level) => (
                      <i key={level} title={`${PROFICIENCY_LABELS[level]} ${row.byProficiency[level]}名`} className={row.byProficiency[level] > 0 ? "filled level-" + level : "level-" + level}>
                        <b>{row.byProficiency[level] || ""}</b>
                      </i>
                    ))}
                  </div>
                </td>
                <td><span className="skill-departments">{row.departments.slice(0, 2).map((item) => item.department).join(" / ") || "—"}</span></td>
                <td>{row.openNeedCount > 0 && needForSkill(row.name) ? <button className="skill-need-link" aria-label={`${row.name}の未充足 ${row.openNeedCount}件を開く`} onClick={() => onResolveNeed(needForSkill(row.name)!.id)}>{row.openNeedCount}件</button> : `${row.openNeedCount}件`}</td>
                <td>{row.gap > 0 ? <strong className="skill-gap">{row.gap}件</strong> : <span className="skill-ok">0件</span>}</td>
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

const PERSON_SCOPE_LABELS: Record<PersonScope, string> = {
  organization: "組織全体",
  unit_subtree: "所属部門と配下",
  unit: "所属部門のみ",
  self: "本人のみ",
};

const FEATURE_LABELS: Record<RestrictableFeature, string> = {
  searchScenes: "検索シーン",
  savedReports: "保存レポート",
  profileRequests: "更新依頼",
  opportunities: "受注前案件",
  favorites: "お気に入り",
  externalMcp: "社外MCP参照",
};

const RESTRICTABLE_ROLE_LABELS: Record<RestrictableRole, string> = {
  admin: "管理者",
  planner: "プランナー",
  viewer: "閲覧者",
};

export function RolePermissionsPanel({
  state,
  canManage = false,
  canManageAdmin = false,
  onSave,
}: {
  state: WorkspaceState;
  canManage?: boolean;
  canManageAdmin?: boolean;
  onSave?: (input: {
    role: RestrictableRole;
    personScope: PersonScope;
    hiddenFieldKeys: string[];
    readonlyFieldKeys: string[];
    disabledFeatures: RestrictableFeature[];
  }) => void;
}) {
  const [role, setRole] = useState<RestrictableRole>("planner");
  const [error, setError] = useState("");
  const permissions = state.rolePermissions ?? [];
  const current = permissions.find((permission) => permission.role === role);
  const fields = state.customFields ?? [];
  const [draft, setDraft] = useState<{
    personScope: PersonScope;
    hiddenFieldKeys: string[];
    readonlyFieldKeys: string[];
    disabledFeatures: RestrictableFeature[];
  } | null>(null);
  const active = draft ?? {
    personScope: current?.personScope ?? "organization",
    hiddenFieldKeys: current?.hiddenFieldKeys ?? [],
    readonlyFieldKeys: current?.readonlyFieldKeys ?? [],
    disabledFeatures: current?.disabledFeatures ?? [],
  };
  const editable = canManage && (role !== "admin" || canManageAdmin);

  const selectRole = (next: RestrictableRole) => {
    setRole(next);
    setDraft(null);
    setError("");
  };

  const toggleKey = (list: "hiddenFieldKeys" | "readonlyFieldKeys", key: string) => {
    const keys = active[list].includes(key) ? active[list].filter((item) => item !== key) : [...active[list], key];
    setDraft({ ...active, [list]: keys });
  };

  const toggleFeature = (feature: RestrictableFeature) => {
    const features = active.disabledFeatures.includes(feature)
      ? active.disabledFeatures.filter((item) => item !== feature)
      : [...active.disabledFeatures, feature];
    setDraft({ ...active, disabledFeatures: features });
  };

  const submit = () => {
    try {
      onSave?.({ role, ...active });
      setDraft(null);
      setError("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "権限設定を保存できませんでした");
    }
  };

  return (
    <section className="balance-card role-permission-card" aria-labelledby="role-permission-heading">
      <div className="card-heading">
        <div><small>ROLE PERMISSIONS</small><h3 id="role-permission-heading">ロール別の権限</h3></div>
        <span>{permissions.length === 0 ? "制限なし" : `${permissions.length}ロールに制限あり`}</span>
      </div>
      <p className="role-permission-note">オーナーは常に制限されません。設定していないロールは制限なしで動作します。</p>
      <form className="field-catalog-form role-permission-form" onSubmit={(event) => { event.preventDefault(); submit(); }}>
        <label>ロール<select aria-label="権限を設定するロール" value={role} onChange={(event) => selectRole(event.target.value as RestrictableRole)}>
          {RESTRICTABLE_ROLES.map((option) => <option value={option} key={option}>{RESTRICTABLE_ROLE_LABELS[option]}</option>)}
        </select></label>
        <label>参照範囲<select aria-label="参照できる人の範囲" value={active.personScope} disabled={!editable} onChange={(event) => setDraft({ ...active, personScope: event.target.value as PersonScope })}>
          {PERSON_SCOPES.map((option) => <option value={option} key={option}>{PERSON_SCOPE_LABELS[option]}</option>)}
        </select></label>
        <fieldset className="role-permission-features">
          <legend>使えない機能</legend>
          {RESTRICTABLE_FEATURES.map((feature) => (
            <label key={feature} className="field-flag">
              <input
                type="checkbox"
                checked={active.disabledFeatures.includes(feature)}
                disabled={!editable}
                onChange={() => toggleFeature(feature)}
              />
              {FEATURE_LABELS[feature]}
            </label>
          ))}
        </fieldset>
        {fields.length > 0 && (
          <>
            <fieldset className="role-permission-fields">
              <legend>非表示の独自項目</legend>
              {fields.map((field) => (
                <label key={`hidden-${field.id}`} className="field-flag">
                  <input
                    type="checkbox"
                    checked={active.hiddenFieldKeys.includes(field.key)}
                    disabled={!editable}
                    onChange={() => toggleKey("hiddenFieldKeys", field.key)}
                  />
                  {field.label}
                </label>
              ))}
            </fieldset>
            <fieldset className="role-permission-fields">
              <legend>編集できない独自項目</legend>
              {fields.map((field) => (
                <label key={`readonly-${field.id}`} className="field-flag">
                  <input
                    type="checkbox"
                    checked={active.readonlyFieldKeys.includes(field.key)}
                    disabled={!editable}
                    onChange={() => toggleKey("readonlyFieldKeys", field.key)}
                  />
                  {field.label}
                </label>
              ))}
            </fieldset>
          </>
        )}
        {editable && <button type="submit" className="view-add-button">{RESTRICTABLE_ROLE_LABELS[role]}の権限を更新</button>}
        {!editable && <p className="role-permission-note">{role === "admin" ? "管理者の権限設定はオーナーだけが変更できます。" : "権限設定を変更する権限がありません。"}</p>}
        {error && <p className="skill-catalog-error" role="alert">{error}</p>}
      </form>
    </section>
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
export function FieldsView({ state, onAddField, canManage = false, canManageRequests = canManage, canManageAdminPermissions = false, onSaveRolePermission, identity, onCreateRequests, onSubmitRequest, onCompleteRequest, onCancelRequest }: FieldsViewProps) {
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

      <RolePermissionsPanel
        state={state}
        canManage={canManage}
        canManageAdmin={canManageAdminPermissions}
        onSave={onSaveRolePermission}
      />

      <ProfileRequestsPanel
        state={state}
        identity={identity}
        canManage={canManageRequests}
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
              const blocker = canManage ? orgUnitArchiveBlocker(state, unit.id) : null;
              return (
                <tr key={unit.id} className={depth === 0 ? "category-row" : ""}>
                  <td>
                    <span className={"skill-tree-name depth-" + Math.min(3, depth)}>
                      <strong>{unit.name}</strong>
                      <small>{orgUnitPath(state.orgUnits, unit.id).slice(0, -1).join(" / ") || "最上位"}</small>
                    </span>
                  </td>
                  <td><strong>{primaryCount}</strong><small>名</small></td>
                  {/* 0名 rather than an em dash: the column beside it writes 2名,
                      and a dash reads as "not applicable" rather than "none". */}
                  <td>{concurrentCount}名</td>
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
                    /* A unit with children or members cannot be removed, and the
                       button used to say so in the form's shared error slot, far
                       from the row it belonged to. Offering the control only
                       when it works puts the reason in the row and leaves the
                       destructive colour on the one row where it means
                       something. The full sentence is screen-reader text rather
                       than only a `title`, which keyboard and touch never see. */
                    <td>
                      {blocker ? (
                        <span className="read-only-label" title={blocker.reason}>
                          {blocker.short}
                          <span className="sr-only">。削除できません。{blocker.reason}</span>
                        </span>
                      ) : (
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
                      )}
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

function downloadCsv(filename: string, content: string) {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

type CsvTransferPanelProps = {
  state: WorkspaceState;
  organizationId?: string;
  canImport?: boolean;
  onImportMembers: (actions: MemberImportAction[]) => void;
};

export function CsvTransferPanel({ state, organizationId, canImport = false, onImportMembers }: CsvTransferPanelProps) {
  const storageKey = `${CSV_PRESETS_KEY}:${organizationId ?? "demo"}`;
  const [source, setSource] = useState<CsvSource>("members");
  const available = source === "members" ? memberCsvColumns(state.customFields) : projectCsvColumns(state.customFields);
  const [columns, setColumns] = useState<string[]>(() => memberCsvColumns(state.customFields).map((column) => column.key));
  const [presets, setPresets] = useState<CsvExportPreset[]>(() => readCsvPresets(storageKey));
  const [presetName, setPresetName] = useState("");
  const [issues, setIssues] = useState<CsvIssue[]>([]);
  const [pending, setPending] = useState<MemberImportAction[]>([]);
  const [importMessage, setImportMessage] = useState("");

  const toggleColumn = (key: string) => {
    setColumns((current) => current.includes(key) ? current.filter((item) => item !== key) : [...current, key]);
  };

  const changeSource = (next: CsvSource) => {
    setSource(next);
    setColumns((next === "members" ? memberCsvColumns(state.customFields) : projectCsvColumns(state.customFields)).map((column) => column.key));
  };

  const savePreset = () => {
    const name = presetName.trim();
    if (!name || columns.length === 0) return;
    const next = [...presets.filter((preset) => preset.name !== name), {
      id: crypto.randomUUID(),
      name,
      source,
      columns,
    }].slice(-20);
    setPresets(next);
    writeCsvPresets(next, storageKey);
    setPresetName("");
  };

  const applyPreset = (preset: CsvExportPreset) => {
    setSource(preset.source);
    setColumns(preset.columns);
  };

  const removePreset = (id: string) => {
    const next = presets.filter((preset) => preset.id !== id);
    setPresets(next);
    writeCsvPresets(next, storageKey);
  };

  const exportNow = () => {
    const csv = source === "members" ? exportMembersCsv(state, columns) : exportProjectsCsv(state, columns);
    downloadCsv(`mosaic-${source}.csv`, csv);
  };

  const onFile = async (file: File | undefined) => {
    if (!file || !canImport) return;
    setImportMessage("");
    setIssues([]);
    setPending([]);
    try {
      const parsed = parseCsv(await file.text());
      const preview = previewMemberImport(state, parsed, () => crypto.randomUUID());
      setIssues(preview.issues);
      setPending(preview.actions);
      setImportMessage(preview.actions.length ? `${preview.actions.length}行を仮置きできます` : "適用できる行がありません");
    } catch (caught) {
      setImportMessage(caught instanceof Error ? caught.message : "CSVを読み込めませんでした");
    }
  };

  return (
    <section className="section-view csv-view" aria-labelledby="csv-heading">
      <h2 id="csv-heading">CSV入出力</h2>
      <p className="csv-lead">UTF-8（BOM付き）で出力します。メンバーCSVは氏名・職種・部署・勤務地があれば新規登録できます。IDがある行は更新です。</p>
      <div className="csv-toolbar">
        <label className="view-filter">対象
          <select aria-label="CSVの対象" value={source} onChange={(event) => changeSource(event.target.value as CsvSource)}>
            <option value="members">メンバー</option>
            <option value="projects">プロジェクト</option>
          </select>
        </label>
        <button className="view-add-button" type="button" onClick={exportNow} disabled={columns.length === 0}><Download size={15} />CSVをダウンロード</button>
      </div>
      <div className="csv-columns" role="group" aria-label="出力する列">
        {available.map((column) => (
          <label key={column.key} className="field-flag">
            <input type="checkbox" checked={columns.includes(column.key)} onChange={() => toggleColumn(column.key)} />
            {column.label}
          </label>
        ))}
      </div>
      <div className="csv-presets">
        <input value={presetName} onChange={(event) => setPresetName(event.target.value)} placeholder="出力設定名" aria-label="出力設定名" />
        <button className="view-add-button ghost" type="button" onClick={savePreset} disabled={!presetName.trim() || columns.length === 0}>この列構成を保存</button>
        {presets.map((preset) => (
          <span className="csv-preset" key={preset.id}>
            <button type="button" onClick={() => applyPreset(preset)}>{preset.name}</button>
            <button type="button" aria-label={`${preset.name}を削除`} onClick={() => removePreset(preset.id)}>×</button>
          </span>
        ))}
      </div>
      {canImport && (
        <div className="csv-import">
          <strong>メンバーCSVを取り込む</strong>
          <label className="view-add-button ghost">
            <Upload size={15} />ファイルを選択
            <input className="sr-only" type="file" accept=".csv,text/csv" onChange={(event) => void onFile(event.target.files?.[0])} />
          </label>
          {importMessage && <p>{importMessage}</p>}
          {issues.length > 0 && (
            <ul className="csv-issues">
              {issues.map((issue) => <li key={`${issue.row}-${issue.message}`}>{issue.row}行目: {issue.message}</li>)}
            </ul>
          )}
          {pending.length > 0 && (
            <button className="view-add-button" type="button" onClick={() => { onImportMembers(pending); setPending([]); setImportMessage("仮置きしました。チームへ保存すると確定します。"); }}>
              {pending.length}行を仮置きする
            </button>
          )}
        </div>
      )}
      {!canImport && <p className="csv-lead">取り込みはオーナーまたは管理者だけが実行できます。</p>}
    </section>
  );
}
