import { useLayoutEffect, useRef, useState, type ComponentType, type CSSProperties, type ReactNode } from "react";
import {
  ArrowRight,
  Bell,
  BriefcaseBusiness,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Plus,
  Search,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  UserRoundPlus,
  UsersRound,
  X,
} from "lucide-react";
import { PROFICIENCY_LABELS, type PlanCostAxis } from "./domain";
import { ActiveFilters, FavoriteStar, MilestoneOverdue, MonthRail, PlanCostAxisTabs } from "./expanded-views";
import { TrendLine } from "./trend-line";

/**
 * One part, drawn the way a screen draws it.
 *
 * The markup is a copy, so nothing but a test ties it to the screen. `classes` are the
 * names this entry promises are still worn somewhere else under `src/`; a class a screen
 * dropped would otherwise leave a specimen that looks right and describes nothing.
 * `probe` is the element whose computed style is shown: the one that paints, not its
 * wrapper. `context` are the ancestor classes a screen's selectors need before the part
 * looks the way it does there (`.assignment-form > label`, `.project-detail .profile-capacity`).
 */
export type CatalogSpecimen = {
  label: string;
  classes: readonly string[];
  /** The classes that tell this specimen from its neighbour (`.status-pill.risk`), shown with the first class. */
  modifiers?: readonly string[];
  probe: string;
  context?: readonly string[];
  screens: string;
  wide?: boolean;
  /**
   * The width the part has on its own screen at 1440×900, where that is narrower than
   * the card here: a bar stretched across the page does not read like the same bar in a
   * table cell or a panel.
   */
  width?: number;
  Render: ComponentType;
};

export type CatalogCard = {
  title: string;
  note?: string;
  wide?: boolean;
  /** Charts drawn from made-up numbers carry a visible 見本 mark, so they cannot pass for figures (#125). */
  sample?: boolean;
  specimens: readonly CatalogSpecimen[];
};

export type CatalogSection = { id: string; title: string; cards: readonly CatalogCard[] };

const MONTHS = ["1月", "2月", "3月", "4月", "5月", "6月", "7月", "8月", "9月", "10月", "11月", "12月"];
const noop = () => undefined;

const STAFFED = [3, 4, 4, 4, 2, 4, 4, 4, 4, 3, 4, 4];
function StaffingRailSpecimen() {
  return (
    <div className="ui-catalog-cell">
      <div className="four-week-rail" role="img" aria-label={"見本の充足人数：" + STAFFED.map((count, index) => `${MONTHS[index]} ${count}/4名`).join("、")}>
        <TrendLine guides={[100]} points={STAFFED.map((count, index) => ({ value: (count / 4) * 100, tone: count < 4 ? "short" as const : undefined, title: `${MONTHS[index]}: ${count}/4名` }))} />
      </div>
      <span className="staffed-label">1月 3/4名</span>
    </div>
  );
}

function ProgressSpecimen() {
  return <div className="progress-cell"><span><b style={{ width: "62%" }} /></span><strong>62%</strong></div>;
}

const DEPARTMENTS = [
  { name: "部門A", count: 6, average: 72 },
  { name: "部門B", count: 4, average: 108 },
  { name: "部門C", count: 3, average: 41 },
];
function DepartmentListSpecimen() {
  return (
    <div className="department-list">
      {DEPARTMENTS.map((item) => (
        <div key={item.name}>
          <span><strong>{item.name}</strong><small>{item.count}名</small></span>
          <i><b className={item.average > 100 ? "over" : ""} style={{ width: Math.min(100, item.average) + "%" }} /></i>
          <em>{item.average}%</em>
        </div>
      ))}
    </div>
  );
}

const PLAN_COSTS = [
  { name: "プロジェクトA", yen: "¥2,400,000", width: 100 },
  { name: "プロジェクトB", yen: "¥1,500,000", width: 62.5 },
  { name: "プロジェクトC", yen: "¥600,000", width: 25, unset: 1 },
];
function PlanCostSpecimen() {
  return (
    <div className="plan-cost-list">
      {PLAN_COSTS.map((row) => (
        <div key={row.name}>
          <span><strong>{row.name}</strong>{row.unset ? <small>未設定 {row.unset}名</small> : null}</span>
          <i><b style={{ width: row.width + "%" }} /></i>
          <em>{row.yen}</em>
        </div>
      ))}
    </div>
  );
}

function CapacityMeterSpecimen() {
  return (
    <div className="capacity-card">
      <div><span>1月の稼働</span><strong>120% / 稼働上限100%</strong></div>
      <div className="capacity-meter"><span style={{ width: "100%" }} /><i>100%</i></div>
      <p>稼働上限を20%超えています。</p>
    </div>
  );
}

const DETAIL_COUNTS = [3, 4, 2];
function ProjectCapacitySpecimen() {
  return (
    <div className="profile-capacity">
      {DETAIL_COUNTS.map((count, index) => (
        <div key={MONTHS[index]}>
          <span>{MONTHS[index]}</span>
          <i>
            <b className={count < 4 ? "short" : ""} style={{ width: (count / 4) * 100 + "%" }} />
            {[1, 2, 3].map((tick) => <span key={tick} className="project-capacity-tick" data-inside={tick / 4 < count / 4 ? "true" : "false"} style={{ left: (tick / 4) * 100 + "%" }} aria-hidden="true" />)}
          </i>
          <strong>{count}/4名</strong>
        </div>
      ))}
    </div>
  );
}

const PICKER_DAYS = [40, 60, 60, 100, 120, 80, 50, 50, 100, 100, 70, 30, 30, 60, 90];
function PickerRailSpecimen() {
  return (
    <div className="ui-catalog-cell">
      <span className="member-picker-rail" aria-hidden="true">
        <TrendLine dots="flagged" guides={[100]} points={PICKER_DAYS.map((load) => ({ value: Math.min(100, load), tone: load > 100 ? "over" as const : undefined }))} />
      </span>
    </div>
  );
}

const MONTH_PEAKS = [80, 110, 40, 60, 90, 100, 30, 70, 85, 95, 50, 65];
function MonthRailSpecimen() {
  return (
    // Twelve labels need about 350px; below that the cell scrolls rather than spill (#574).
    // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- scrollport
    <div className="ui-catalog-cell ui-catalog-natural" tabIndex={0} role="region" aria-label="見本の月ごとの稼働">
      <MonthRail buckets={MONTH_PEAKS.map((peak, index) => ({ from: MONTHS[index], to: MONTHS[index], peak, ratio: Math.min(100, peak), exceeds: peak > 100, open: peak < 60 }))} />
    </div>
  );
}

const HORIZON = MONTHS.map((label, index) => ({
  label,
  average: [72, 85, 96, 104, 88, 64, 58, 70, 91, 112, 76, 60][index],
  draft: index === 3 || index === 9,
  pipeline: index === 5 ? 2 : index === 8 ? 1 : 0,
}));
function HorizonSpecimen() {
  const height = (value: number) => Math.min(100, (value / 120) * 100) + "%";
  return (
    <div className="horizon-card">
      <div className="horizon-plot">
        <div className="horizon-y-labels"><span className="t100">100%</span><span className="t60">60%</span><span className="t0">0</span></div>
        <div className="horizon-grid" style={{ "--horizon-cols": HORIZON.length } as CSSProperties}>
          <div className="horizon-guide g100" /><div className="horizon-guide g60" />
          {HORIZON.map((bucket) => (
            <button className="horizon-week" type="button" key={bucket.label} aria-label={`見本 ${bucket.label} ${bucket.average}%${bucket.pipeline > 0 ? ` 受注前+${bucket.pipeline}名` : ""}`}>
              <span className="horizon-bar"><i className={bucket.average > 100 ? "over" : ""} style={{ height: height(bucket.average) }} />{bucket.draft && <b style={{ bottom: height(bucket.average) }} />}</span>
              <strong>{bucket.average}%</strong>
              {bucket.pipeline > 0 && <span className="pipeline-chip">+{bucket.pipeline}名</span>}
              <small>{bucket.label}</small>
            </button>
          ))}
        </div>
      </div>
      <div className="horizon-caption"><span><i className="confirmed" />確定稼働</span><span><i className="draft" />仮置きあり</span><span><i className="pipeline" />受注前の想定人数</span><button type="button">ボードで確認 <ArrowRight size={13} /></button></div>
    </div>
  );
}

const RINGS = [
  { load: 72, state: "" },
  { load: 35, state: "open" },
  { load: 115, state: "over" },
];
function LoadRingSpecimen() {
  return (
    <>
      {RINGS.map((ring) => (
        <span className="ui-catalog-pair" key={ring.load}>
          <span className={"load-ring " + ring.state} style={{ "--load": Math.min(100, ring.load) } as CSSProperties}><strong>{ring.load}%</strong></span>
          <small className="capacity-limit">稼働上限 100%</small>
        </span>
      ))}
    </>
  );
}

const PROFICIENCY_COUNTS = { 1: 2, 2: 5, 3: 3, 4: 1, 5: 0 } as const;
function ProficiencySpecimen() {
  const levels = [1, 2, 3, 4, 5] as const;
  return (
    <div className="proficiency-rail" role="img" aria-label={"見本の習熟度分布：" + levels.map((level) => `${PROFICIENCY_LABELS[level]} ${PROFICIENCY_COUNTS[level]}名`).join("、")}>
      {levels.map((level) => (
        <i key={level} title={`${PROFICIENCY_LABELS[level]} ${PROFICIENCY_COUNTS[level]}名`} className={PROFICIENCY_COUNTS[level] > 0 ? `filled level-${level}` : `level-${level}`}>
          <b>{PROFICIENCY_COUNTS[level] || ""}</b>
        </i>
      ))}
    </div>
  );
}

function ViewTabsSpecimen() {
  const [axis, setAxis] = useState<"members" | "projects">("members");
  return (
    <div className="view-tabs" role="group" aria-label="見本の表示軸">
      <button type="button" className={axis === "members" ? "selected" : ""} aria-pressed={axis === "members"} onClick={() => setAxis("members")}><UsersRound size={13} />メンバー別</button>
      <button type="button" className={axis === "projects" ? "selected" : ""} aria-pressed={axis === "projects"} onClick={() => setAxis("projects")}><BriefcaseBusiness size={13} />プロジェクト別</button>
    </div>
  );
}

function PlanCostTabsSpecimen() {
  const [axis, setAxis] = useState<PlanCostAxis>("project");
  return <PlanCostAxisTabs axis={axis} onChange={setAxis} />;
}

function DetailsToggleSpecimen() {
  const [open, setOpen] = useState(false);
  return (
    <button type="button" className={"board-filter-details-toggle" + (open ? " is-open" : "")} aria-expanded={open} onClick={() => setOpen((value) => !value)}>
      <SlidersHorizontal size={14} aria-hidden="true" />
      詳細な条件
      <span className="filter-count">1</span>
      {open ? <ChevronUp size={14} aria-hidden="true" /> : <ChevronDown size={14} aria-hidden="true" />}
    </button>
  );
}

function SearchSpecimen() {
  const [query, setQuery] = useState("");
  return (
    <label className="inline-search">
      <Search size={15} />
      <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="メンバー・案件を検索" aria-label="見本の検索" />
    </label>
  );
}

function SelectFilterSpecimen() {
  const [value, setValue] = useState("すべて");
  return (
    <label className="view-filter"><span className="filter-label">状態</span><select aria-label="見本の状態で絞り込み" value={value} onChange={(event) => setValue(event.target.value)}>
      <option>すべて</option>
      <option>進行中</option>
      <option>要注意</option>
    </select></label>
  );
}

function ToggleSpecimen() {
  const [checked, setChecked] = useState(true);
  return <label className="view-toggle"><input type="checkbox" checked={checked} onChange={(event) => setChecked(event.target.checked)} />上限超過のみ</label>;
}

function FormFieldsSpecimen() {
  const [name, setName] = useState("見本 一郎");
  const [role, setRole] = useState("デザイナー");
  const [summary, setSummary] = useState("");
  return (
    <div className="assignment-form">
      <label>名前<input value={name} onChange={(event) => setName(event.target.value)} /></label>
      <label>職種<select value={role} onChange={(event) => setRole(event.target.value)}><option>デザイナー</option><option>エンジニア</option></select></label>
      <label>概要<textarea rows={2} value={summary} onChange={(event) => setSummary(event.target.value)} /></label>
    </div>
  );
}

function DateFieldsSpecimen() {
  const [start, setStart] = useState("2026-01-05");
  const [end, setEnd] = useState("2026-03-31");
  return (
    <div className="form-grid">
      <label>開始日<input type="date" value={start} onChange={(event) => setStart(event.target.value)} /></label>
      <label>終了日<input type="date" min={start} value={end} onChange={(event) => setEnd(event.target.value)} /></label>
    </div>
  );
}

function AllocationSpecimen() {
  const [allocation, setAllocation] = useState("50");
  return (
    <label>稼働配分<div className="allocation-input"><input type="range" min="10" max="100" step="10" value={allocation} onChange={(event) => setAllocation(event.target.value)} /><output>{allocation}%</output></div></label>
  );
}

function FieldFlagSpecimen() {
  const [checked, setChecked] = useState(true);
  return <label className="field-flag"><input type="checkbox" checked={checked} onChange={(event) => setChecked(event.target.checked)} />一覧に表示</label>;
}

function FavoriteSpecimen() {
  const [pressed, setPressed] = useState(false);
  return <FavoriteStar name="見本" pressed={pressed} onToggle={() => setPressed((value) => !value)} />;
}

const status = (className: string, text: string): CatalogSpecimen => ({
  label: `状態: ${text}`,
  classes: ["status-pill"],
  modifiers: [className],
  probe: `.status-pill.${className}`,
  screens: "プロジェクト一覧",
  Render: () => <span className={"status-pill " + className}><i />{text}</span>,
});

export const UI_CATALOG: readonly CatalogSection[] = [
  {
    id: "charts",
    title: "グラフ",
    cards: [
      {
        title: "折れ線（推移を線で見せる）",
        note: "時間の推移は折れ線で表します（#580）。点線は100%（必要人数・稼働上限）、橙色の点は不足か上限超過です。",
        wide: true,
        sample: true,
        specimens: [
          { label: "充足", classes: ["four-week-rail", "trend-line", "staffed-label"], probe: ".four-week-rail .trend-line", screens: "プロジェクト一覧（12か月の充足）", width: 162, Render: StaffingRailSpecimen },
          { label: "月ごとの稼働", classes: ["member-week-rail", "trend-line"], probe: ".member-week-rail .trend-line", screens: "メンバー一覧（12か月の稼働）", wide: true, Render: MonthRailSpecimen },
          { label: "日ごとの稼働", classes: ["member-picker-rail", "trend-line"], probe: ".member-picker-rail .trend-line", screens: "アサインの追加（メンバーの候補）", wide: true, width: 518, Render: PickerRailSpecimen },
        ],
      },
      {
        title: "横棒（割合を長さで見せる）",
        note: "順序の無い比較と1つの値のメーターは、#580 の例外として棒のまま残します。プロジェクト詳細の充足は #583 で折れ線にします。",
        wide: true,
        sample: true,
        specimens: [
          { label: "進捗バー", classes: ["progress-cell"], probe: ".progress-cell b", screens: "プロジェクト一覧（進捗）", Render: ProgressSpecimen },
          { label: "上限との比較", classes: ["capacity-card", "capacity-meter"], probe: ".capacity-meter span", screens: "上限超過の詳細", wide: true, Render: CapacityMeterSpecimen },
          { label: "充足と必要人数の目盛り", classes: ["profile-capacity", "project-capacity-tick"], probe: ".profile-capacity b", context: ["project-detail"], screens: "プロジェクト詳細", wide: true, width: 473, Render: ProjectCapacitySpecimen },
          { label: "部門ごとの稼働", classes: ["department-list"], probe: ".department-list b", screens: "レポート（部門別）", wide: true, Render: DepartmentListSpecimen },
          { label: "計画コスト", classes: ["plan-cost-list"], probe: ".plan-cost-list b", screens: "レポート（計画コスト）", wide: true, Render: PlanCostSpecimen },
        ],
      },
      {
        title: "縦棒（量を高さで見せる）",
        note: "需給の見通しは #582 で折れ線にします。",
        wide: true,
        sample: true,
        specimens: [
          { label: "需給の見通し", classes: ["horizon-card", "horizon-plot", "horizon-grid", "horizon-week", "horizon-bar"], probe: ".horizon-bar i", screens: "レポート", wide: true, Render: HorizonSpecimen },
        ],
      },
      {
        title: "円と段階",
        sample: true,
        specimens: [
          { label: "稼働リング", classes: ["load-ring", "capacity-limit"], probe: ".load-ring", screens: "メンバー一覧", Render: LoadRingSpecimen },
          { label: "習熟度の分布", classes: ["proficiency-rail"], probe: ".proficiency-rail i.filled", screens: "スキルマップ", Render: ProficiencySpecimen },
        ],
      },
    ],
  },
  {
    id: "tabs",
    title: "タブと切り替え",
    cards: [
      {
        title: "切り替えタブ",
        note: "どちらも押すと選択が移ります。",
        specimens: [
          { label: "表示軸", classes: ["view-tabs"], probe: ".view-tabs button.selected", screens: "アサインボード", Render: ViewTabsSpecimen },
          { label: "集計軸", classes: ["range-tabs"], probe: ".range-tabs button.selected", context: ["plan-cost-card"], screens: "レポート（計画コスト）", Render: PlanCostTabsSpecimen },
        ],
      },
      {
        title: "開閉",
        specimens: [
          { label: "詳細な条件", classes: ["board-filter-details-toggle", "filter-count"], probe: ".board-filter-details-toggle", screens: "アサインボード", Render: DetailsToggleSpecimen },
        ],
      },
    ],
  },
  {
    id: "inputs",
    title: "入力",
    cards: [
      {
        title: "検索と絞り込み",
        specimens: [
          { label: "検索", classes: ["inline-search"], probe: ".inline-search", screens: "アサインボード、プロジェクト、メンバーほか", Render: SearchSpecimen },
          { label: "絞り込みの選択", classes: ["view-filter", "filter-label"], probe: ".view-filter", screens: "アサインボード、プロジェクト、メンバー、レポートほか", Render: SelectFilterSpecimen },
          { label: "絞り込みのチェック", classes: ["view-toggle"], probe: ".view-toggle", screens: "アサインボード、プロジェクト、メンバー", Render: ToggleSpecimen },
        ],
      },
      {
        title: "フォーム",
        specimens: [
          { label: "文字・選択・複数行", classes: ["assignment-form"], probe: ".assignment-form > label > input", screens: "追加と編集のパネル", wide: true, Render: FormFieldsSpecimen },
          { label: "日付", classes: ["form-grid"], probe: ".form-grid input", context: ["assignment-form"], screens: "アサインの追加と編集", wide: true, Render: DateFieldsSpecimen },
          { label: "稼働配分", classes: ["allocation-input"], probe: ".allocation-input input", context: ["assignment-form"], screens: "アサインの追加と編集", Render: AllocationSpecimen },
          { label: "項目の設定", classes: ["field-flag"], probe: ".field-flag", context: ["field-catalog-form"], screens: "項目定義", wide: true, Render: FieldFlagSpecimen },
        ],
      },
    ],
  },
  {
    id: "buttons",
    title: "ボタン",
    cards: [
      {
        title: "主ボタン",
        specimens: [
          { label: "上部バー", classes: ["primary-button"], probe: ".primary-button", context: ["topbar-actions"], screens: "各画面の右上", Render: () => <button type="button" className="primary-button"><Plus size={16} />アサインを追加</button> },
          { label: "パネル", classes: ["drawer-primary"], probe: ".drawer-primary", screens: "追加と編集のパネル", Render: () => <button type="button" className="drawer-primary"><Check size={16} />この内容で仮置きする</button> },
        ],
      },
      {
        title: "副ボタンと危険な操作",
        specimens: [
          { label: "パネルの副ボタン", classes: ["drawer-secondary"], probe: ".drawer-secondary", screens: "詳細と編集のパネル", Render: () => <button type="button" className="drawer-secondary">詳細を開く</button> },
          { label: "パネルの危険な操作", classes: ["drawer-danger"], probe: ".drawer-danger", screens: "詳細と編集のパネル", Render: () => <button type="button" className="drawer-danger"><Trash2 size={15} />アーカイブ</button> },
          { label: "画面の追加", classes: ["view-add-button"], probe: ".view-add-button", screens: "メンバー、スキルマップ、組織、項目定義ほか", Render: () => <button type="button" className="view-add-button"><Plus size={15} />追加する</button> },
          { label: "画面の控えめな操作", classes: ["view-add-button"], modifiers: ["ghost"], probe: ".view-add-button.ghost", screens: "絞り込み中の表示ほか", Render: () => <button type="button" className="view-add-button ghost">条件をクリア</button> },
        ],
      },
      {
        title: "行とツールバーの操作",
        specimens: [
          { label: "行の操作", classes: ["quick-assign"], probe: ".quick-assign", screens: "メンバー一覧", Render: () => <button type="button" className="quick-assign"><UserRoundPlus size={14} />アサイン</button> },
          { label: "行の控えめな操作", classes: ["quick-assign"], modifiers: ["quiet"], probe: ".quick-assign.quiet", screens: "メンバー一覧", Render: () => <button type="button" className="quick-assign quiet"><Sparkles size={14} />提案へ</button> },
          { label: "行を開く", classes: ["row-open"], probe: ".row-open", screens: "プロジェクト一覧", Render: () => <button type="button" className="row-open" aria-label="見本の詳細を見る"><ChevronRight size={16} /></button> },
          { label: "お気に入り", classes: ["favorite-star"], probe: ".favorite-star", screens: "一覧と詳細", Render: FavoriteSpecimen },
          { label: "ツールバー", classes: ["toolbar-actions", "board-month-pager"], probe: ".board-month-pager button", screens: "アサインボード（今月）", Render: () => <div className="toolbar-actions"><div className="board-month-pager"><button type="button"><CalendarDays size={13} />今月</button></div></div> },
        ],
      },
      {
        title: "アイコンだけのボタン",
        specimens: [
          { label: "上部バー", classes: ["icon-button"], probe: ".icon-button", screens: "通知", Render: () => <button type="button" className="icon-button" aria-label="見本の通知"><Bell size={18} /></button> },
          { label: "上部バー（印あり）", classes: ["icon-button"], modifiers: ["has-dot"], probe: ".icon-button.has-dot", screens: "通知があるとき", Render: () => <button type="button" className="icon-button has-dot" aria-label="見本の通知 未読あり"><Bell size={18} /></button> },
          { label: "送り", classes: ["arrow-button"], probe: ".arrow-button", context: ["toolbar-actions"], screens: "アサインボード", Render: () => <button type="button" className="arrow-button" aria-label="見本 前の月"><ChevronLeft size={16} /></button> },
          { label: "閉じる", classes: ["close-button"], probe: ".close-button", screens: "パネルとダイアログ", Render: () => <button type="button" className="close-button" aria-label="見本を閉じる"><X size={18} /></button> },
        ],
      },
      {
        title: "文字だけのボタン",
        specimens: [
          { label: "次の画面へ", classes: ["all-alerts"], probe: ".all-alerts", screens: "要調整", Render: () => <button type="button" className="all-alerts">レポートで見通しを確認 <ArrowRight size={13} /></button> },
          { label: "件数から開く", classes: ["skill-need-link"], probe: ".skill-need-link", screens: "スキルマップ", Render: () => <button type="button" className="skill-need-link" aria-label="見本の未充足 2件を開く">2件</button> },
        ],
      },
    ],
  },
  {
    id: "badges",
    title: "バッジとチップ",
    cards: [
      {
        title: "状態",
        specimens: [
          status("active", "進行中"),
          status("risk", "要注意"),
          status("ready", "準備中"),
          status("closing", "完了間近"),
          { label: "稼働", classes: ["load"], probe: ".load", screens: "アサインボード", Render: () => <span className="load">72%</span> },
          { label: "稼働（上限超過）", classes: ["load"], modifiers: ["over"], probe: ".load.over", screens: "アサインボード", Render: () => <span className="load over">115%</span> },
          { label: "不足", classes: ["need-note"], probe: ".need-note", screens: "プロジェクト一覧", Render: () => <small className="need-note">デザイナー 不足</small> },
          { label: "不足（解消予定）", classes: ["need-note"], modifiers: ["planned"], probe: ".need-note.planned", screens: "プロジェクト一覧", Render: () => <small className="need-note planned">解消予定</small> },
          { label: "期限超過", classes: ["milestone-overdue"], probe: ".milestone-overdue", context: ["milestone-cell"], screens: "プロジェクト一覧と詳細", Render: () => <><strong>リリース判定</strong><small>8/1<MilestoneOverdue date="2026-08-01" today="2026-09-01" /></small></> },
        ],
      },
      {
        title: "件数と点数",
        specimens: [
          { label: "条件の数", classes: ["filter-count"], probe: ".filter-count", screens: "アサインボード", Render: () => <span className="filter-count">2</span> },
          { label: "受注前の人数", classes: ["pipeline-chip"], probe: ".pipeline-chip", screens: "レポート", Render: () => <span className="pipeline-chip">+2名</span> },
          { label: "一致の点数", classes: ["match-score"], probe: ".match-score", screens: "メンバー一覧（検索シーン）", Render: () => <span className="match-score">7/9点<small>空き40%</small></span> },
        ],
      },
      {
        title: "ラベル",
        specimens: [
          { label: "スキル", classes: ["skill-chips"], probe: ".skill-chips span", screens: "要調整", Render: () => <div className="skill-chips"><span>React</span><span>TypeScript</span><ArrowRight size={13} /></div> },
          { label: "スキルと習熟度", classes: ["member-skills"], probe: ".member-skills span", screens: "メンバー一覧、提案", Render: () => <div className="member-skills"><span>React<small>4</small></span><span>設計<small>3</small></span></div> },
          { label: "同名の区別", classes: ["row-name-tag"], probe: ".row-name-tag", context: ["member-name-cell"], screens: "メンバー一覧", Render: () => <strong><span className="row-name-main">見本 一郎</span><span className="row-name-tag">（大阪）</span></strong> },
          { label: "閲覧のみ", classes: ["read-only-label"], probe: ".read-only-label", screens: "メンバー一覧、組織", Render: () => <span className="read-only-label">閲覧のみ</span> },
        ],
      },
      {
        title: "絞り込み中の表示",
        specimens: [
          {
            label: "外せる条件",
            classes: ["toolbar-chips", "filter-chip", "toolbar-clear-all"],
            probe: ".filter-chip",
            screens: "アサインボード、プロジェクト、メンバー",
            wide: true,
            Render: () => <ActiveFilters applied={[{ key: "status", label: "状態", value: "要注意", onClear: noop }, { key: "favorites", label: "お気に入りのみ", onClear: noop }]} result="3件" onClearAll={noop} />,
          },
        ],
      },
    ],
  },
];

/** What this page does not show yet, so an empty spot is not read as 「there is none」. */
export const UI_CATALOG_GAPS = [
  "メンバー詳細の月の稼働（折れ線と表）",
  "アサインボードの表とバー",
  "一覧の表（プロジェクト・メンバー・スキル・組織）",
  "パネルとダイアログ（「その他」のメニューを含む）、通知、トースト、変更の保存バー",
  "サイドバーのナビと件数",
  "本番だけの画面（ログイン、設定、組織の作成）",
  "AI秘書",
] as const;

function colorName(value: string) {
  const match = value.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)$/u);
  if (!match) return value || "—";
  const alpha = match[4] === undefined ? 1 : Number(match[4]);
  if (alpha === 0) return "透明";
  const hex = "#" + [match[1], match[2], match[3]].map((part) => Number(part).toString(16).padStart(2, "0")).join("");
  return alpha < 1 ? `${hex}（${Math.round(alpha * 100)}%）` : hex;
}

/** The computed values, not the first declaration: the theme layer overrides much of the base one. */
export function measuredStyle(style: Pick<CSSStyleDeclaration, "fontSize" | "color" | "backgroundColor" | "borderRadius">) {
  return `実測: 文字 ${style.fontSize || "—"} · 文字色 ${colorName(style.color)} · 背景 ${colorName(style.backgroundColor)} · 角丸 ${style.borderRadius || "—"}`;
}

/** `.status-pill.risk .other`: the modifiers ride on the first class, which is the one they modify. */
export function specimenClassText(specimen: Pick<CatalogSpecimen, "classes" | "modifiers">) {
  return specimen.classes
    .map((name, index) => "." + name + (index === 0 ? (specimen.modifiers ?? []).map((modifier) => "." + modifier).join("") : ""))
    .join(" ");
}

function SpecimenFigure({ specimen }: { specimen: CatalogSpecimen }) {
  const stageRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLElement>(null);
  // Measured again when a tab, toggle or input changes the specimen, once its transition
  // has finished (mid-transition the computed value is still the old one), and when the
  // pointer leaves, so a click does not leave the hover colour standing as the reading.
  useLayoutEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const measure = () => {
      const target = stage.querySelector(specimen.probe);
      if (measureRef.current) measureRef.current.textContent = target ? measuredStyle(getComputedStyle(target)) : "実測: 対象が見つかりません";
    };
    measure();
    const observer = new MutationObserver(measure);
    observer.observe(stage, { attributes: true, childList: true, subtree: true });
    stage.addEventListener("transitionend", measure);
    stage.addEventListener("pointerout", measure);
    return () => {
      observer.disconnect();
      stage.removeEventListener("transitionend", measure);
      stage.removeEventListener("pointerout", measure);
    };
  }, [specimen.probe]);
  const { Render } = specimen;
  const body = (specimen.context ?? []).reduceRight<ReactNode>((child, name) => <div className={name}>{child}</div>, <Render />);
  return (
    <figure className={"ui-catalog-specimen" + (specimen.wide ? " ui-catalog-wide" : "")}>
      <div className="ui-catalog-stage" ref={stageRef} style={specimen.width ? { maxWidth: specimen.width } : undefined}>{body}</div>
      <figcaption>
        <strong>{specimen.label}</strong>
        <code>{specimenClassText(specimen)}</code>
        <span>{specimen.screens}</span>
        <small className="ui-catalog-measure" ref={measureRef} />
      </figcaption>
    </figure>
  );
}

export function UiCatalogView() {
  return (
    <section className="section-view ui-catalog" aria-label="部品の一覧">
      <p className="ui-catalog-lead">数値と名前はすべて見本で、業務データではありません。タブ・開閉・入力は動きますが、ボタンは押しても何も起きません。「実測」は描画後の文字の大きさ・文字色・背景・角丸です。</p>
      {UI_CATALOG.map((section) => (
        <section className="ui-catalog-section" aria-labelledby={`ui-catalog-${section.id}`} key={section.id}>
          <h2 id={`ui-catalog-${section.id}`}>{section.title}</h2>
          <div className="ui-catalog-cards">
            {section.cards.map((card) => (
              <article className={"balance-card ui-catalog-card" + (card.wide ? " ui-catalog-wide" : "")} key={card.title}>
                <div className="card-heading"><h3>{card.title}</h3>{card.sample && <span className="ui-catalog-sample">見本</span>}</div>
                {card.note && <p className="viz-caption">{card.note}</p>}
                <div className="ui-catalog-specimens">
                  {card.specimens.map((specimen) => <SpecimenFigure specimen={specimen} key={specimen.label} />)}
                </div>
              </article>
            ))}
          </div>
        </section>
      ))}
      <section className="ui-catalog-section" aria-labelledby="ui-catalog-gaps">
        <h2 id="ui-catalog-gaps">まだ並べていない部品</h2>
        <ul className="ui-catalog-gaps">{UI_CATALOG_GAPS.map((gap) => <li key={gap}>{gap}</li>)}</ul>
      </section>
    </section>
  );
}
