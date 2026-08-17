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
  Sparkles,
  UserRoundPlus,
  UsersRound,
} from "lucide-react";
import {
  addDays,
  getWeekStart,
  memberLoad,
  projectMembers,
  type Project,
  type WorkspaceState,
} from "./domain";

type ProjectsViewProps = {
  state: WorkspaceState;
  weekOffset: number;
  onOpen: (projectId: string) => void;
  onCreate: () => void;
};

type MembersViewProps = {
  state: WorkspaceState;
  weekOffset: number;
  onOpen: (memberId: string) => void;
  onAdd: () => void;
  onAssign: (memberId: string) => void;
};

type ReportsViewProps = {
  state: WorkspaceState;
  onOpenWeek: (offset: number) => void;
  onResolveNeed: () => void;
};

const statusClass: Record<Project["status"], string> = {
  "進行中": "active",
  "要注意": "risk",
  "準備中": "ready",
  "完了間近": "closing",
};

function formatMonthDay(iso: string) {
  const [, month, day] = iso.split("-").map(Number);
  return month + "/" + day;
}

export function ProjectsView({ state, weekOffset, onOpen, onCreate }: ProjectsViewProps) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("すべて");
  const weekStart = getWeekStart(weekOffset);
  const filtered = state.projects.filter((project) => {
    const need = state.needs.some((item) => item.projectId === project.id && item.status !== "filled");
    const textMatch = (project.name + " " + project.summary + " " + project.ownerName).toLowerCase().includes(query.toLowerCase());
    const statusMatch = status === "すべて" || project.status === status || (status === "欠員あり" && need);
    return textMatch && statusMatch;
  });

  const portfolioRisks = state.projects.filter((project) => project.status === "要注意").length;
  const openNeeds = state.needs.filter((need) => need.status !== "filled").length;

  return (
    <section className="section-view projects-view" aria-labelledby="projects-heading">
      <div className="portfolio-ribbon">
        <div className="ribbon-lead">
          <span className="ribbon-icon"><Layers3 size={18} /></span>
          <div><small>PORTFOLIO PULSE</small><strong>8つの案件を横断して配員を確認</strong></div>
        </div>
        <div className="ribbon-stat"><strong>{state.projects.length}</strong><span>進行中の案件</span></div>
        <div className="ribbon-divider" />
        <div className="ribbon-stat risk"><strong>{portfolioRisks}</strong><span>要注意</span></div>
        <div className="ribbon-divider" />
        <div className="ribbon-stat warning"><strong>{openNeeds}</strong><span>未充足ロール</span></div>
        <div className="portfolio-weave" aria-hidden="true">{[64, 82, 71, 92, 76, 55, 88, 69].map((value, index) => <i key={index}><b style={{ width: value + "%" }} /></i>)}</div>
      </div>

      <div className="view-toolbar">
        <div className="inline-search"><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="案件名・責任者を検索" aria-label="案件を検索" /></div>
        <label className="view-filter"><Filter size={14} /><select value={status} onChange={(event) => setStatus(event.target.value)} aria-label="プロジェクト状態で絞り込み">
          {["すべて", "進行中", "要注意", "準備中", "完了間近", "欠員あり"].map((option) => <option key={option}>{option}</option>)}
        </select></label>
        <span className="toolbar-result">{filtered.length}件を表示</span>
        <button className="view-add-button" onClick={onCreate}><Plus size={15} />プロジェクトを追加</button>
      </div>

      <div className="portfolio-table-wrap">
        <table className="portfolio-table">
          <thead>
            <tr><th>プロジェクト</th><th>状態</th><th>4週間の充足</th><th>進捗</th><th>次の節目</th><th>責任者</th><th><span className="sr-only">詳細</span></th></tr>
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
                  <td>
                    <div className="four-week-rail" aria-label={project.name + "の4週間の充足人数"}>
                      {weeks.map((count, index) => <i key={index} title={(index + 1) + "週目: " + count + "/" + project.demand + "名"}><b className={count < project.demand ? "short" : ""} style={{ width: Math.min(100, count / project.demand * 100) + "%" }} /></i>)}
                    </div>
                    <span className="staffed-label">{currentMembers}/{project.demand}名</span>
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

export function MembersView({ state, weekOffset, onOpen, onAdd, onAssign }: MembersViewProps) {
  const [query, setQuery] = useState("");
  const [role, setRole] = useState("すべて");
  const weekStart = getWeekStart(weekOffset);
  const roles = ["すべて", ...Array.from(new Set(state.members.map((member) => member.role)))];
  const filtered = state.members.filter((member) => {
    const textMatch = (member.name + " " + member.role + " " + member.skills.join(" ")).toLowerCase().includes(query.toLowerCase());
    return textMatch && (role === "すべて" || member.role === role);
  }).sort((a, b) => memberLoad(state, a.id, weekStart) - memberLoad(state, b.id, weekStart));

  const available = state.members.filter((member) => memberLoad(state, member.id, weekStart) <= 60).length;
  const overloaded = state.members.filter((member) => memberLoad(state, member.id, weekStart) > member.capacity).length;

  return (
    <section className="section-view members-view" aria-labelledby="members-heading">
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
        <div className="inline-search"><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="名前・スキルを検索" aria-label="メンバーを検索" /></div>
        <label className="view-filter"><Filter size={14} /><select value={role} onChange={(event) => setRole(event.target.value)} aria-label="職種で絞り込み">{roles.map((option) => <option key={option}>{option}</option>)}</select></label>
        <span className="toolbar-result">空き率の高い順</span>
        <button className="view-add-button" onClick={onAdd}><Plus size={15} />メンバーを追加</button>
      </div>

      <div className="member-table-wrap">
        <table className="member-table">
          <thead><tr><th>メンバー</th><th>スキル</th><th>今週</th><th>4週間のキャパシティ</th><th>次の空き</th><th><span className="sr-only">操作</span></th></tr></thead>
          <tbody>
            {filtered.map((member) => {
              const load = memberLoad(state, member.id, weekStart);
              const weeklyLoads = [0, 1, 2, 3].map((offset) => memberLoad(state, member.id, addDays(weekStart, offset * 7)));
              const nextOpen = weeklyLoads.findIndex((value) => value <= 60);
              return (
                <tr key={member.id}>
                  <td><button className="member-name-cell" onClick={() => onOpen(member.id)}><span className={"avatar " + member.avatarTone}>{member.initials}</span><span><strong>{member.name}</strong><small>{member.role} · {member.department}</small></span></button></td>
                  <td><div className="member-skills">{member.skills.slice(0, 3).map((skill) => <span key={skill}>{skill}</span>)}</div></td>
                  <td><span className={"load-ring " + (load > member.capacity ? "over" : load <= 60 ? "open" : "")} style={{ "--load": Math.min(100, load) } as React.CSSProperties}><strong>{load}%</strong></span></td>
                  <td><div className="member-week-rail">{weeklyLoads.map((value, index) => <i className={value > 100 ? "over" : value <= 60 ? "open" : ""} key={index}><b style={{ height: Math.max(12, Math.min(100, value)) + "%" }} /><small>{value}%</small></i>)}</div></td>
                  <td><span className="next-open">{nextOpen === -1 ? "4週先まで満員" : nextOpen === 0 ? "今週 " + Math.max(0, 100 - load) + "%空き" : (nextOpen + 1) + "週目から"}<small>{member.location}</small></span></td>
                  <td><button className="quick-assign" onClick={() => onAssign(member.id)}><UserRoundPlus size={14} />アサイン</button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function ReportsView({ state, onOpenWeek, onResolveNeed }: ReportsViewProps) {
  const [range, setRange] = useState(8);
  const weekOffsets = useMemo(() => Array.from({ length: range }, (_, index) => index), [range]);
  const horizon = weekOffsets.map((offset) => {
    const weekStart = getWeekStart(offset);
    const loads = state.members.map((member) => memberLoad(state, member.id, weekStart));
    const confirmed = state.assignments.filter((assignment) => assignment.status === "confirmed" && assignment.startDate <= addDays(weekStart, 4) && assignment.endDate >= weekStart).length;
    const draft = state.assignments.filter((assignment) => assignment.status === "draft" && assignment.startDate <= addDays(weekStart, 4) && assignment.endDate >= weekStart).length;
    return { offset, weekStart, average: Math.round(loads.reduce((sum, value) => sum + value, 0) / loads.length), confirmed, draft };
  });
  const departments = Array.from(new Set(state.members.map((member) => member.department))).map((department) => {
    const people = state.members.filter((member) => member.department === department);
    const loads = people.map((member) => memberLoad(state, member.id, getWeekStart(0)));
    return { department, count: people.length, average: Math.round(loads.reduce((sum, value) => sum + value, 0) / loads.length) };
  }).sort((a, b) => b.average - a.average);
  const currentOverloads = state.members.filter((member) => memberLoad(state, member.id, getWeekStart(0)) > member.capacity);
  const activeNeeds = state.needs.filter((need) => need.status !== "filled");

  return (
    <section className="section-view reports-view" aria-labelledby="reports-heading">
      <div className="report-toolbar">
        <div><small>CAPACITY HORIZON</small><h2>需給バランスの見通し</h2><p>確定・仮置き・空きを同じ時間軸で確認します。</p></div>
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
              <small>{formatMonthDay(week.weekStart)}週</small>
            </button>
          ))}
        </div>
        <div className="horizon-caption"><span><i className="confirmed" />確定稼働</span><span><i className="draft" />仮置きあり</span><button onClick={() => onOpenWeek(0)}>ボードで確認 <ArrowRight size={13} /></button></div>
      </div>

      <div className="report-lower-grid">
        <section className="balance-card">
          <div className="card-heading"><div><small>BY DEPARTMENT</small><h3>部署別の需給</h3></div><Gauge size={18} /></div>
          <div className="department-list">{departments.map((item) => <div key={item.department}><span><strong>{item.department}</strong><small>{item.count}名</small></span><i><b className={item.average > 100 ? "over" : ""} style={{ width: Math.min(100, item.average) + "%" }} /></i><em>{item.average}%</em></div>)}</div>
        </section>

        <section className="exceptions-card">
          <div className="card-heading"><div><small>EXCEPTIONS</small><h3>判断が必要な項目</h3></div><span>{currentOverloads.length + activeNeeds.length}</span></div>
          <div className="exception-list">
            {currentOverloads.map((member) => <button onClick={() => onOpenWeek(0)} key={member.id}><span className="exception-icon risk"><CircleAlert size={14} /></span><span><strong>{member.name}さんが{memberLoad(state, member.id, getWeekStart(0))}%</strong><small>今週の稼働を調整してください</small></span><ChevronRight size={15} /></button>)}
            {activeNeeds.map((need) => <button onClick={onResolveNeed} key={need.id}><span className={"exception-icon " + (need.status === "planned" ? "planned" : "open")}><CalendarClock size={14} /></span><span><strong>{state.projects.find((project) => project.id === need.projectId)?.name}</strong><small>{need.role} {need.allocation}% · {need.status === "planned" ? "解消予定" : "担当未定"}</small></span><ChevronRight size={15} /></button>)}
          </div>
        </section>
      </div>

      <div className="report-insight"><span><Sparkles size={17} /></span><div><strong>今週の示唆</strong><p>品質保証には翌週60%の余力があります。モバイル会員証のQAを仮置きすると、翌週の不足を解消できます。</p></div><button onClick={onResolveNeed}>候補を見る <ArrowRight size={13} /></button></div>
    </section>
  );
}
