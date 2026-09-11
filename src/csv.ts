import { anonymousCandidateLabel } from "./collaboration";
import {
  addDays,
  createProjectCode,
  formatSkillInput,
  hydrateWorkspaceSkills,
  isWeekendDate,
  makeInitials,
  matchMembers,
  memberById,
  memberLabel,
  memberLoad,
  memberPeakLoad,
  memberSkillLevels,
  normalizeCustomValues,
  orderedCustomFields,
  parseSkillInput,
  projectById,
  skillInputProblems,
  searchSceneFromNeed,
  type Assignment,
  type AssignmentStatus,
  type AvatarTone,
  type CustomFieldDefinition,
  type Member,
  type Project,
  type ProjectStatus,
  type WorkspaceState,
} from "./domain";

export const MAX_CSV_ROWS = 500;
export const CSV_PRESETS_KEY = "mosaic-csv-presets-v1";

export const CSV_SOURCES = ["members", "projects", "assignments"] as const;

export type CsvSource = typeof CSV_SOURCES[number];

export type CsvColumn = {
  key: string;
  label: string;
};

export type CsvExportPreset = {
  id: string;
  name: string;
  source: CsvSource;
  columns: string[];
};

export type CsvParseResult = {
  headers: string[];
  rows: Record<string, string>[];
};

export type CsvIssue = {
  row: number;
  message: string;
};

export type MemberImportAction = {
  row: number;
  mode: "create" | "update";
  member: Member;
};

export type ProjectImportAction = {
  row: number;
  mode: "create" | "update";
  project: Project;
};

export type AssignmentImportAction = {
  row: number;
  mode: "create" | "update";
  assignment: Assignment;
};

const MEMBER_CORE_COLUMNS: CsvColumn[] = [
  { key: "id", label: "ID" },
  { key: "name", label: "氏名" },
  { key: "role", label: "職種" },
  { key: "department", label: "部署" },
  { key: "location", label: "勤務地" },
  { key: "capacity", label: "稼働上限" },
  { key: "skills", label: "スキル" },
];

const PROJECT_CORE_COLUMNS: CsvColumn[] = [
  { key: "id", label: "ID" },
  { key: "code", label: "コード" },
  { key: "name", label: "案件名" },
  { key: "summary", label: "概要" },
  { key: "status", label: "状態" },
  { key: "ownerName", label: "責任者" },
  { key: "startDate", label: "開始日" },
  { key: "endDate", label: "終了日" },
  { key: "nextMilestone", label: "次の節目" },
  { key: "nextMilestoneDate", label: "節目日" },
  { key: "progress", label: "進捗" },
  { key: "demand", label: "必要人数" },
];

/**
 * An assignment as a row, and the reason the people and projects are named rather
 * than identified.
 *
 * `app.assignments.person_id` and `.project_id` are uuids, and nobody types a uuid into
 * a spreadsheet. So the columns carry what the screens print — and `memberName` carries
 * `memberLabel`, which appends a distinguishing tag only when a name is shared (#123,
 * #262). #284's owner column writes the raw name and so cannot be read back when two
 * people answer to it; starting from the label means a file that went out comes back in.
 */
const ASSIGNMENT_CORE_COLUMNS: CsvColumn[] = [
  { key: "id", label: "ID" },
  { key: "memberName", label: "メンバー" },
  { key: "projectName", label: "プロジェクト" },
  { key: "startDate", label: "開始日" },
  { key: "endDate", label: "終了日" },
  { key: "allocation", label: "稼働配分" },
  { key: "status", label: "状態" },
  { key: "label", label: "表示名" },
  { key: "weekendWorkDates", label: "稼働した週末" },
];

const AVATAR_TONES: AvatarTone[] = ["lavender", "peach", "sky", "mint", "sand", "rose"];
const TARGET_ID_PATTERN = /^[\w:-]{1,80}$/;

export function memberCsvColumns(catalog: CustomFieldDefinition[] | undefined): CsvColumn[] {
  return [
    ...MEMBER_CORE_COLUMNS,
    ...orderedCustomFields(catalog, "member").map((field) => ({ key: `custom:${field.key}`, label: field.label })),
  ];
}

export function projectCsvColumns(catalog: CustomFieldDefinition[] | undefined): CsvColumn[] {
  return [
    ...PROJECT_CORE_COLUMNS,
    ...orderedCustomFields(catalog, "project").map((field) => ({ key: `custom:${field.key}`, label: field.label })),
  ];
}

export function assignmentCsvColumns(): CsvColumn[] {
  // No custom fields: `customFields` covers members and projects only.
  return [...ASSIGNMENT_CORE_COLUMNS];
}

export function parseCsv(text: string): CsvParseResult {
  const source = text.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const records = splitCsvRecords(source);
  const headers = (records[0] ?? []).map((header) => header.trim()).filter(Boolean);
  if (headers.length === 0) return { headers: [], rows: [] };
  const rows = records.slice(1).filter((record) => record.some((cell) => cell.trim())).map((record) => {
    const row: Record<string, string> = {};
    headers.forEach((header, index) => {
      row[header] = unguardCsvCell((record[index] ?? "").trim());
    });
    return row;
  });
  if (rows.length > MAX_CSV_ROWS) {
    throw new Error(`CSVは${MAX_CSV_ROWS}行以内にしてください`);
  }
  return { headers, rows };
}

export function serializeCsv(headers: string[], rows: string[][]) {
  const lines = [headers, ...rows].map((record) => record.map(escapeCsvCell).join(","));
  return `\uFEFF${lines.join("\r\n")}\r\n`;
}

export function exportMembersCsv(state: WorkspaceState, columns: string[]) {
  const available = memberCsvColumns(state.customFields);
  const selected = resolveColumns(available, columns);
  const rows = state.members.map((member) => selected.map((column) => memberCell(state, member, column.key)));
  return serializeCsv(selected.map((column) => column.key), rows);
}

export function exportProjectsCsv(state: WorkspaceState, columns: string[]) {
  const available = projectCsvColumns(state.customFields);
  const selected = resolveColumns(available, columns);
  const rows = state.projects.map((project) => selected.map((column) => projectCell(state, project, column.key)));
  return serializeCsv(selected.map((column) => column.key), rows);
}

export function exportAssignmentsCsv(state: WorkspaceState, columns: string[]) {
  const selected = resolveColumns(assignmentCsvColumns(), columns);
  const rows = state.assignments.map((assignment) => selected.map((column) => assignmentCell(state, assignment, column.key)));
  return serializeCsv(selected.map((column) => column.key), rows);
}

/**
 * The columns a proposal can be written out with, in the order they appear in the file.
 *
 * #148 asked whether an externally shareable proposal should exist. It settled on a file
 * rather than a link: a file carries no member ids, and nobody at the other end can
 * un-anonymise it. What it also cannot do is expire, which the button says out loud.
 */
export const PROPOSAL_CSV_COLUMNS = ["候補", "職種", "勤務地", "スキル", "要件期間の最小空き", "4週間の稼働率"] as const;
export type ProposalCsvColumn = typeof PROPOSAL_CSV_COLUMNS[number];

/**
 * 候補 is in every file and is not offered as a choice: a row that names nobody is not a
 * proposal, and a file with no columns is not one either. The rest are the sender's to
 * add, and 「既定は最小」 is one of #148's conditions, so only 職種 starts on.
 *
 * The first version let every box be unticked and quietly wrote 候補 and 職種 anyway — a
 * screen showing nothing selected and a file with two columns in it. The evaluation on
 * #148 caught that.
 */
export const REQUIRED_PROPOSAL_CSV_COLUMN: ProposalCsvColumn = "候補";
export const DEFAULT_PROPOSAL_CSV_COLUMNS: ProposalCsvColumn[] = ["職種"];

/**
 * The columns the sender chooses from. 勤務地 is the other half of what 「氏名・勤務地を隠す」
 * hides, so it is not on offer while that is on.
 */
export function proposalCsvColumns(anonymous: boolean): ProposalCsvColumn[] {
  return PROPOSAL_CSV_COLUMNS
    .filter((column) => column !== REQUIRED_PROPOSAL_CSV_COLUMN)
    .filter((column) => !(anonymous && column === "勤務地"));
}

export function exportProposalCsv(state: WorkspaceState, input: {
  memberIds: string[];
  columns: string[];
  anonymous: boolean;
  /** The four weeks the cards show, so the file and the screen agree. */
  weekStart: string;
  /** The requirement the proposal answers, for 要件期間の最小空き. */
  needId?: string;
}) {
  // 候補 always, then whatever was chosen, in the order they are declared rather than the
  // order they were ticked. Nothing is substituted for an empty choice.
  const offered = proposalCsvColumns(input.anonymous);
  const columns: ProposalCsvColumn[] = [
    REQUIRED_PROPOSAL_CSV_COLUMN,
    ...offered.filter((column) => input.columns.includes(column)),
  ];
  const need = input.needId ? (state.needs ?? []).find((item) => item.id === input.needId) : undefined;
  const matches = need ? matchMembers(state, searchSceneFromNeed(need)) : [];
  const availableById = new Map(matches.map((match) => [match.member.id, match.availablePercent]));
  const rows = input.memberIds
    .map((id) => state.members.find((member) => member.id === id))
    .filter((member): member is Member => Boolean(member))
    .map((member, index) => columns.map((column) => {
      switch (column) {
        // Never the id. A file that names 「候補A」 cannot be turned back into a person by
        // whoever receives it, and neither can one that names the person outright.
        case "候補": return input.anonymous ? anonymousCandidateLabel(index) : memberLabel(state, member);
        case "職種": return member.role;
        case "勤務地": return member.location;
        case "スキル": return formatSkillInput(memberSkillLevels(member));
        case "要件期間の最小空き": {
          const available = availableById.get(member.id);
          return available === undefined ? "" : `${available}%`;
        }
        case "4週間の稼働率": return [0, 1, 2, 3]
          .map((offset) => `${memberLoad(state, member.id, addDays(input.weekStart, offset * 7))}%`)
          .join(" / ");
      }
    }));
  return serializeCsv([...columns], rows);
}

export function previewMemberImport(state: WorkspaceState, parsed: CsvParseResult, newId: () => string): {
  issues: CsvIssue[];
  actions: MemberImportAction[];
} {
  const issues: CsvIssue[] = [];
  const actions: MemberImportAction[] = [];
  const seenIds = new Set<string>();
  parsed.rows.forEach((row, index) => {
    const rowNumber = index + 2;
    try {
      const action = memberActionFromRow(state, row, rowNumber, () => newId());
      if (seenIds.has(action.member.id)) throw new Error("同じIDの行が重複しています");
      seenIds.add(action.member.id);
      actions.push(action);
    } catch (caught) {
      issues.push({ row: rowNumber, message: caught instanceof Error ? caught.message : "行を読み込めませんでした" });
    }
  });
  return { issues, actions };
}

export function applyMemberImport(state: WorkspaceState, actions: MemberImportAction[]): WorkspaceState {
  const members = [...state.members];
  for (const action of actions) {
    const index = members.findIndex((member) => member.id === action.member.id);
    if (index >= 0) members[index] = action.member;
    else members.push(action.member);
  }
  return hydrateWorkspaceSkills({ ...state, members });
}

export function previewProjectImport(state: WorkspaceState, parsed: CsvParseResult, newId: () => string): {
  issues: CsvIssue[];
  actions: ProjectImportAction[];
} {
  const issues: CsvIssue[] = [];
  const actions: ProjectImportAction[] = [];
  const seenIds = new Set<string>();
  parsed.rows.forEach((row, index) => {
    const rowNumber = index + 2;
    try {
      const action = projectActionFromRow(state, row, rowNumber, () => newId());
      if (seenIds.has(action.project.id)) throw new Error("同じIDの行が重複しています");
      seenIds.add(action.project.id);
      actions.push(action);
    } catch (caught) {
      issues.push({ row: rowNumber, message: caught instanceof Error ? caught.message : "行を読み込めませんでした" });
    }
  });
  return { issues, actions };
}

export function applyProjectImport(state: WorkspaceState, actions: ProjectImportAction[]): WorkspaceState {
  const projects = [...state.projects];
  for (const action of actions) {
    const index = projects.findIndex((project) => project.id === action.project.id);
    if (index >= 0) projects[index] = action.project;
    else projects.push(action.project);
  }
  // No `hydrateWorkspaceSkills`: that walks members' skill levels, and a project has none.
  return { ...state, projects };
}

export function previewAssignmentImport(state: WorkspaceState, parsed: CsvParseResult, newId: () => string): {
  issues: CsvIssue[];
  actions: AssignmentImportAction[];
  warnings: string[];
} {
  const issues: CsvIssue[] = [];
  const actions: AssignmentImportAction[] = [];
  const seenIds = new Set<string>();
  parsed.rows.forEach((row, index) => {
    const rowNumber = index + 2;
    try {
      const action = assignmentActionFromRow(state, row, rowNumber, () => newId());
      if (seenIds.has(action.assignment.id)) throw new Error("同じIDの行が重複しています");
      seenIds.add(action.assignment.id);
      actions.push(action);
    } catch (caught) {
      issues.push({ row: rowNumber, message: caught instanceof Error ? caught.message : "行を読み込めませんでした" });
    }
  });
  return { issues, actions, warnings: overloadWarnings(state, actions) };
}

/**
 * What the file would do to someone's ceiling, said before it is placed (#303).
 *
 * The form has said this since #254; this path did not, and it is the one that takes 500
 * rows at once. Measured on the state the import would produce, not row by row: each row
 * is read against the workspace as it stands, so three 60% rows for the same person never
 * saw each other and 180% arrived afterwards as an 上限超過 card.
 *
 * Said, not enforced — the same choice #254 made. A row that warns still goes into
 * `actions`; drafting a knowing overbooking to adjust later is ordinary work.
 */
function overloadWarnings(state: WorkspaceState, actions: AssignmentImportAction[]): string[] {
  const applied = applyAssignmentImport(state, actions);
  // Per person rather than per row: an overload is a property of a member and a span, and
  // several rows can make one. The rows are named in the message instead, so no row is
  // pointed at that did not contribute and none that did is hidden.
  const spans = new Map<string, { rows: number[]; start: string; end: string }>();
  for (const action of actions) {
    const { personId, startDate, endDate } = action.assignment;
    const span = spans.get(personId);
    if (!span) spans.set(personId, { rows: [action.row], start: startDate, end: endDate });
    else {
      span.rows.push(action.row);
      if (startDate < span.start) span.start = startDate;
      if (endDate > span.end) span.end = endDate;
    }
  }
  const warnings: string[] = [];
  // Insertion order, so the warnings follow the file.
  for (const [personId, span] of spans) {
    const member = memberById(state, personId);
    if (!member) continue;
    // The peak over the days this import touches, the same measure `addOverload` takes of
    // the assignment form. Whether the file caused the overload is not asked, because the
    // form does not ask it either.
    const projected = memberPeakLoad(applied, personId, span.start, span.end);
    if (projected <= member.capacity) continue;
    warnings.push(`${span.rows.join("・")}行目: ${memberLabel(state, member)}さんの稼働が${projected}%になります（稼働上限${member.capacity}%）。仮置きはできます。`);
  }
  return warnings;
}

export function applyAssignmentImport(state: WorkspaceState, actions: AssignmentImportAction[]): WorkspaceState {
  const assignments = [...state.assignments];
  for (const action of actions) {
    const index = assignments.findIndex((assignment) => assignment.id === action.assignment.id);
    if (index >= 0) assignments[index] = action.assignment;
    else assignments.push(action.assignment);
  }
  return { ...state, assignments };
}

export function normalizeCsvPresets(value: unknown): CsvExportPreset[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const record = item as { id?: unknown; name?: unknown; source?: unknown; columns?: unknown };
    const id = typeof record.id === "string" ? record.id : "";
    const name = typeof record.name === "string" ? record.name.trim() : "";
    // Every target, checked against the list rather than spelled out: leaving
    // 「assignments」 off dropped its saved column sets on the next read (#286).
    const source: CsvSource | "" = CSV_SOURCES.includes(record.source as CsvSource) ? record.source as CsvSource : "";
    const columns = Array.isArray(record.columns) ? record.columns.filter((column): column is string => typeof column === "string" && column.trim().length > 0) : [];
    if (!TARGET_ID_PATTERN.test(id) || !name || !source || columns.length === 0) return [];
    return [{ id, name: name.slice(0, 40), source, columns: [...new Set(columns)].slice(0, 40) }];
  }).slice(0, 20);
}

export function readCsvPresets(storageKey = CSV_PRESETS_KEY, storage?: Pick<Storage, "getItem">): CsvExportPreset[] {
  try {
    const raw = (storage ?? window.localStorage).getItem(storageKey);
    return raw ? normalizeCsvPresets(JSON.parse(raw) as unknown) : [];
  } catch {
    return [];
  }
}

export function writeCsvPresets(presets: CsvExportPreset[], storageKey = CSV_PRESETS_KEY, storage?: Pick<Storage, "setItem">) {
  (storage ?? window.localStorage).setItem(storageKey, JSON.stringify(normalizeCsvPresets(presets)));
}

function resolveColumns(available: CsvColumn[], columns: string[]) {
  const allowed = new Map(available.map((column) => [column.key, column]));
  const selected = columns.flatMap((key) => {
    const column = allowed.get(key);
    return column ? [column] : [];
  });
  return selected.length ? selected : available;
}

function memberCell(state: WorkspaceState, member: Member, key: string) {
  if (key.startsWith("custom:")) {
    const field = orderedCustomFields(state.customFields, "member").find((item) => `custom:${item.key}` === key);
    return field ? member.customValues?.[field.id] ?? "" : "";
  }
  if (key === "skills") return formatSkillInput(memberSkillLevels(member));
  const value = member[key as keyof Member];
  return value == null ? "" : String(value);
}

function projectCell(state: WorkspaceState, project: Project, key: string) {
  if (key.startsWith("custom:")) {
    const field = orderedCustomFields(state.customFields, "project").find((item) => `custom:${item.key}` === key);
    return field ? project.customValues?.[field.id] ?? "" : "";
  }
  const value = project[key as keyof Project];
  return value == null ? "" : String(value);
}

function assignmentCell(state: WorkspaceState, assignment: Assignment, key: string) {
  switch (key) {
    case "memberName": {
      const member = memberById(state, assignment.personId);
      return member ? memberLabel(state, member) : "";
    }
    case "projectName": {
      const project = projectById(state, assignment.projectId);
      return project ? projectCsvName(state, project) : "";
    }
    // Space-separated: a comma would need quoting in every row, and these are dates.
    case "weekendWorkDates": return (assignment.weekendWorkDates ?? []).join(" ");
    default: {
      const value = assignment[key as keyof Assignment];
      return value == null ? "" : String(value);
    }
  }
}

function memberActionFromRow(state: WorkspaceState, row: Record<string, string>, rowNumber: number, newId: () => string): MemberImportAction {
  const existing = existingById(cell(row, "id"), state.members, "メンバー");

  const name = existing ? valueOr(row, "name", existing.name) : required(row, "name", "氏名");
  const role = existing ? valueOr(row, "role", existing.role) : required(row, "role", "職種");
  const department = existing ? valueOr(row, "department", existing.department) : required(row, "department", "部署");
  const location = existing ? valueOr(row, "location", existing.location) : required(row, "location", "勤務地");
  const capacityRaw = hasColumn(row, "capacity") ? cell(row, "capacity") : existing ? String(existing.capacity) : "100";
  const capacity = Number(capacityRaw);
  if (!Number.isFinite(capacity) || capacity < 0 || capacity > 100) throw new Error("稼働上限は0〜100で入力してください");
  const skillInput = hasColumn(row, "skills") ? cell(row, "skills") : existing ? formatSkillInput(memberSkillLevels(existing)) : "";
  // The same check the forms make (#259): a row is refused for 「React:abc」 rather
  // than importing a skill named that.
  const skillProblems = skillInputProblems(skillInput);
  if (skillProblems.length > 0) throw new Error(skillProblems[0]);
  const skillLevels = parseSkillInput(skillInput);
  const customValues = customValuesFromRow(state.customFields, "member", row, existing?.customValues);
  const member: Member = {
    id: existing?.id ?? newId(),
    initials: makeInitials(name),
    name,
    role,
    department,
    avatarTone: existing?.avatarTone ?? AVATAR_TONES[state.members.length % AVATAR_TONES.length],
    skills: skillLevels.map((level) => level.name),
    skillLevels,
    location,
    capacity,
    customValues,
    workHistory: existing?.workHistory ?? [],
  };
  return { row: rowNumber, mode: existing ? "update" : "create", member };
}

/**
 * The member a cell names, by what the screens print rather than by id.
 *
 * `memberLabel` is tried first: it is what the board and the pickers show (#123, #262),
 * appending a tag only when a name is shared, so pasting 「佐伯 優斗（#saeki）」 resolves.
 * A bare name comes next, because the project export writes the raw `ownerName`. A bare
 * name two people answer to is refused rather than silently taking the first of them.
 *
 * `label` names the column in the message, since two of them use this.
 */
function memberFromCell(state: WorkspaceState, value: string, label: string) {
  const wanted = value.trim();
  const labelled = state.members.filter((member) => memberLabel(state, member) === wanted);
  if (labelled.length === 1) return labelled[0];
  const named = state.members.filter((member) => member.name.trim() === wanted);
  if (named.length === 1) return named[0];
  if (named.length > 1) {
    throw new Error(`${label}「${wanted}」は複数います。「${memberLabel(state, named[0])}」のように書いてください`);
  }
  throw new Error(`${label}「${wanted}」が見つかりません`);
}

/**
 * What to write for a project so the row can be read back.
 *
 * The name, unless two projects share it — then the code, which is unique. Same shape as
 * `memberLabel`: write whatever distinguishes, so an export is always re-importable.
 */
function projectCsvName(state: Pick<WorkspaceState, "projects">, project: Project) {
  const sameName = state.projects.filter((other) => other.name.trim() === project.name.trim());
  return sameName.length > 1 ? project.code : project.name;
}

/** The project a cell names. Both the name and the code, because either is on screen. */
function projectFromCell(state: WorkspaceState, value: string) {
  const wanted = value.trim();
  const named = state.projects.filter((project) => project.name.trim() === wanted);
  if (named.length === 1) return named[0];
  if (named.length > 1) throw new Error(`プロジェクト「${wanted}」は複数あります。コードで指定してください`);
  const coded = state.projects.filter((project) => project.code.trim() === wanted);
  if (coded.length === 1) return coded[0];
  throw new Error(`プロジェクト「${wanted}」が見つかりません`);
}

const PROJECT_STATUSES: ProjectStatus[] = ["進行中", "要注意", "準備中", "完了間近", "完了"];

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/u;

/**
 * A date the rest of the app can do arithmetic on.
 *
 * The forms get this from `input[type=date]`, which cannot produce 「2026-02-31」 or
 * 「きのう」. A file can, and every comparison here is a string comparison, so
 * 「2026-02-31」 sorts after 「2026-02-01」 and passes the period check on its way to a
 * `date` column that will reject it — at save time, with a Postgres error, long after
 * the row could have been pointed at.
 */
function isoDate(value: string, label: string) {
  if (!ISO_DATE.test(value)) throw new Error(`${label}は YYYY-MM-DD の形式で入力してください`);
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) {
    throw new Error(`${label}「${value}」は存在しない日付です`);
  }
  return value;
}

function projectActionFromRow(state: WorkspaceState, row: Record<string, string>, rowNumber: number, newId: () => string): ProjectImportAction {
  const existing = existingById(cell(row, "id"), state.projects, "プロジェクト");

  const name = existing ? valueOr(row, "name", existing.name) : required(row, "name", "案件名");

  // Resolved only when the file actually says something new about the owner. An update
  // that omits the column — 「id,progress」 — keeps the link the project already has, and
  // so does a round-tripped row that names the same person: re-resolving either would
  // refuse the row whenever that name is shared, which is a namesake breaking a change
  // that never mentioned them. The export writes the raw name, so this is the ordinary
  // case, not the corner one.
  const ownerCellGiven = hasColumn(row, "ownerName") ? cell(row, "ownerName") : "";
  const ownerUnchanged = Boolean(existing?.ownerPersonId)
    && (!hasColumn(row, "ownerName") || ownerCellGiven === (existing?.ownerName ?? ""));
  const owner = existing && ownerUnchanged
    ? null
    : memberFromCell(state, existing ? valueOr(row, "ownerName", existing.ownerName ?? "") : required(row, "ownerName", "責任者"), "責任者");

  const statusRaw = hasColumn(row, "status") ? cell(row, "status") : existing?.status ?? "準備中";
  if (!PROJECT_STATUSES.includes(statusRaw as ProjectStatus)) {
    throw new Error(`状態は ${PROJECT_STATUSES.join(" / ")} のいずれかにしてください`);
  }
  const status = statusRaw as ProjectStatus;

  const startDate = isoDate(existing ? valueOr(row, "startDate", existing.startDate) : required(row, "startDate", "開始日"), "開始日");
  const endDate = isoDate(existing ? valueOr(row, "endDate", existing.endDate) : required(row, "endDate", "終了日"), "終了日");
  if (endDate < startDate) throw new Error("終了日は開始日以降にしてください");

  const milestoneGiven = hasColumn(row, "nextMilestoneDate");
  const milestoneRaw = milestoneGiven ? cell(row, "nextMilestoneDate") : existing?.nextMilestoneDate ?? "";
  const milestoneDate = milestoneRaw ? isoDate(milestoneRaw, "節目日") : "";
  if (milestoneDate && (milestoneDate < startDate || milestoneDate > endDate)) {
    // Names the value when the row never mentioned it: a file that only moves the period
    // is otherwise refused over a column the writer did not type.
    throw new Error(milestoneGiven
      ? "節目日はプロジェクト期間内にしてください"
      : `保存済みの節目日「${milestoneDate}」が変更後の期間の外です。nextMilestoneDate も指定してください`);
  }

  const progressRaw = hasColumn(row, "progress") ? cell(row, "progress") : existing ? String(existing.progress) : "0";
  const progress = Number(progressRaw);
  if (!Number.isFinite(progress) || progress < 0 || progress > 100) throw new Error("進捗は0〜100で入力してください");

  const demandRaw = hasColumn(row, "demand") ? cell(row, "demand") : existing ? String(existing.demand) : "1";
  const demand = Number(demandRaw);
  if (!Number.isInteger(demand) || demand < 0 || demand > 10000) throw new Error("必要人数は0〜10000名の整数で入力してください");

  // `handleEditProject` cancels the assignments and needs a shortened period leaves
  // outside it, and reopens the needs those assignments filled. A file of 500 rows
  // cannot show which of them would go, so the row is refused instead and the count
  // says what it would have cost.
  if (existing && (startDate !== existing.startDate || endDate !== existing.endDate)) {
    const strandedAssignments = state.assignments
      .filter((assignment) => assignment.projectId === existing.id && (assignment.startDate < startDate || assignment.endDate > endDate)).length;
    const strandedNeeds = state.needs
      .filter((need) => need.projectId === existing.id && (need.startDate < startDate || need.endDate > endDate)).length;
    if (strandedAssignments + strandedNeeds > 0) {
      throw new Error(`この期間にすると範囲外になるアサインが${strandedAssignments}件、要員要件が${strandedNeeds}件あります。先に画面で調整してください`);
    }
  }

  const id = existing?.id ?? newId();
  const project: Project = {
    ...(existing ?? {}),
    id,
    // Derived from the name and the id, so a `code` cell is read past rather than
    // trusted: rewriting it in a spreadsheet would only decouple it from both.
    code: existing?.code ?? createProjectCode(name, id),
    name,
    summary: hasColumn(row, "summary") ? cell(row, "summary") : existing?.summary ?? "",
    status,
    tone: existing?.tone ?? "blue",
    ownerPersonId: owner ? owner.id : existing?.ownerPersonId,
    ownerName: owner ? owner.name : existing?.ownerName ?? null,
    ownerInitials: owner ? owner.initials : existing?.ownerInitials ?? null,
    startDate,
    endDate,
    nextMilestone: hasColumn(row, "nextMilestone") ? cell(row, "nextMilestone") : existing?.nextMilestone ?? "",
    nextMilestoneDate: milestoneDate || null,
    progress,
    demand,
    customValues: customValuesFromRow(state.customFields, "project", row, existing?.customValues),
  };
  return { row: rowNumber, mode: existing ? "update" : "create", project };
}

const ASSIGNMENT_STATUSES: AssignmentStatus[] = ["draft", "confirmed"];

function assignmentActionFromRow(state: WorkspaceState, row: Record<string, string>, rowNumber: number, newId: () => string): AssignmentImportAction {
  const existing = existingById(cell(row, "id"), state.assignments, "アサイン");

  // Resolved only when the file says something new, the same rule #284 arrived at for a
  // project's owner: re-resolving a name that has not changed would refuse the row the
  // moment a namesake appeared, over a person the row never meant to touch.
  const heldMember = existing ? memberById(state, existing.personId) : undefined;
  const member = heldMember && (!hasColumn(row, "memberName") || cell(row, "memberName") === memberLabel(state, heldMember))
    ? heldMember
    : memberFromCell(state, existing ? valueOr(row, "memberName", "") : required(row, "memberName", "メンバー"), "メンバー");

  const heldProject = existing ? projectById(state, existing.projectId) : undefined;
  const project = heldProject && (!hasColumn(row, "projectName") || cell(row, "projectName") === projectCsvName(state, heldProject))
    ? heldProject
    : projectFromCell(state, existing ? valueOr(row, "projectName", "") : required(row, "projectName", "プロジェクト"));

  const startDate = isoDate(existing ? valueOr(row, "startDate", existing.startDate) : required(row, "startDate", "開始日"), "開始日");
  const endDate = isoDate(existing ? valueOr(row, "endDate", existing.endDate) : required(row, "endDate", "終了日"), "終了日");
  if (endDate < startDate) throw new Error("終了日は開始日以降にしてください");
  // `handleEditProject` cancels an assignment that reaches outside its project, so one
  // imported that way would vanish the next time anyone edited that project.
  if (startDate < project.startDate || endDate > project.endDate) {
    throw new Error(`プロジェクト「${project.name}」の期間（${project.startDate}〜${project.endDate}）に収まる範囲にしてください`);
  }

  const allocationRaw = existing ? valueOr(row, "allocation", String(existing.allocation)) : required(row, "allocation", "稼働配分");
  const allocation = Number(allocationRaw);
  // Whole percents, which is all the screens can make: the range in the add form steps by
  // 10 and the edit form's number input by 1. The column is `numeric(5,2)` with a
  // `> 0` check, so 「0.001」 would round to 0.00 on the way in and violate it — refusing
  // it here says so, rather than letting the whole save fail on a constraint name.
  if (!Number.isInteger(allocation) || allocation < 1 || allocation > 100) {
    throw new Error("稼働配分は1〜100の整数で入力してください");
  }

  const statusRaw = hasColumn(row, "status") ? cell(row, "status") : existing?.status ?? "draft";
  if (!ASSIGNMENT_STATUSES.includes(statusRaw as AssignmentStatus)) {
    // The column accepts `cancelled` in the database, but cancelling is something the
    // screens do to an assignment that exists — not a row a file brings in.
    throw new Error(`状態は ${ASSIGNMENT_STATUSES.join(" または ")} にしてください`);
  }

  const labelValue = hasColumn(row, "label") ? cell(row, "label") : existing?.label ?? "";
  // Code points, like Postgres's `char_length`. `String.length` counts UTF-16 units, so a
  // label of 240 characters that the column accepts would be refused here for containing
  // an emoji.
  if ([...labelValue].length > 240) throw new Error("表示名は240文字以内にしてください");

  const weekendGiven = hasColumn(row, "weekendWorkDates");
  const weekendDates = weekendGiven ? cell(row, "weekendWorkDates").split(/\s+/u).filter(Boolean) : [];
  for (const date of weekendDates) {
    isoDate(date, "稼働した週末");
    // Both halves of what the database asks: Saturday or Sunday, and inside the period.
    if (!isWeekendDate(date)) throw new Error(`稼働した週末「${date}」は土日ではありません`);
    if (date < startDate || date > endDate) throw new Error(`稼働した週末「${date}」がアサインの期間外です`);
  }

  const assignment: Assignment = {
    ...(existing ?? {}),
    id: existing?.id ?? newId(),
    personId: member.id,
    projectId: project.id,
    startDate,
    endDate,
    allocation,
    status: statusRaw as AssignmentStatus,
    label: labelValue || undefined,
  };
  // Only when the column is there. `weekendWorkDates` distinguishes absent from `[]` in
  // the save payload — absent leaves the stored days alone, `[]` clears them — so
  // writing one unconditionally would erase a Saturday over a row about the allocation.
  if (weekendGiven) assignment.weekendWorkDates = [...new Set(weekendDates)].sort();
  // The RPC links an assignment to a need with the same project, person, period and
  // allocation. Changing any of those leaves the stored link pointing at a need this
  // assignment no longer answers, and omitting the key would preserve it, so it is
  // detached: the need goes back to being visibly unfilled.
  if (existing && (member.id !== existing.personId || project.id !== existing.projectId
    || startDate !== existing.startDate || endDate !== existing.endDate || allocation !== existing.allocation)) {
    assignment.staffingNeedId = null;
  }
  return { row: rowNumber, mode: existing ? "update" : "create", assignment };
}

function customValuesFromRow(
  catalog: CustomFieldDefinition[] | undefined,
  entityType: "member" | "project",
  row: Record<string, string>,
  previous?: Record<string, string>,
) {
  const next = { ...(previous ?? {}) };
  orderedCustomFields(catalog, entityType).forEach((field) => {
    const key = `custom:${field.key}`;
    if (!hasColumn(row, key) && !hasColumn(row, field.key)) return;
    next[field.id] = cell(row, key) || cell(row, field.key);
  });
  return normalizeCustomValues(catalog, entityType, next);
}

/**
 * The row a given `id` names, or `undefined` when the column is empty and the row creates.
 *
 * The format comes first. A saved id is a uuid or a demo slug, so it always matches
 * `TARGET_ID_PATTERN`; checking existence first meant a malformed id missed the `find` and
 * was reported as 「見つかりません」, which reads as “that row is gone” rather than “you wrote
 * the id wrong” — and left the format message unreachable on all three paths (#302).
 */
function existingById<T extends { id: string }>(idValue: string, items: readonly T[], noun: string) {
  if (!idValue) return undefined;
  if (!TARGET_ID_PATTERN.test(idValue)) throw new Error("IDの形式を確認してください");
  const found = items.find((item) => item.id === idValue);
  if (!found) throw new Error(`指定したIDの${noun}が見つかりません`);
  return found;
}

function required(row: Record<string, string>, key: string, label: string) {
  const value = cell(row, key);
  if (!value) throw new Error(`${label}は必須です`);
  return value;
}

function valueOr(row: Record<string, string>, key: string, fallback: string) {
  return hasColumn(row, key) ? required(row, key, key) : fallback;
}

function hasColumn(row: Record<string, string>, key: string) {
  return Object.prototype.hasOwnProperty.call(row, key);
}

function cell(row: Record<string, string>, key: string) {
  return (row[key] ?? "").trim();
}

/**
 * A cell a spreadsheet will not run.
 *
 * Excel, Sheets and LibreOffice read a cell starting with `=`, `+`, `-`, `@`, a tab or a
 * CR as a formula, so a member named `=HYPERLINK("http://…","click")` becomes a live link
 * in whoever's spreadsheet opens the file. Quoting does not help — the leading character
 * is what decides. A single apostrophe in front does, and every export goes through
 * `serializeCsv`, so this is the one place to do it. `parseCsv` takes the apostrophe back
 * off, so a name that went out through the member export comes back through the import
 * unchanged.
 *
 * It applied to the member and project exports already; #148 is what made it matter,
 * because that file is written to be handed to somebody outside.
 */
const FORMULA_LEAD = /^[=+\-@\t\r]/u;

function escapeCsvCell(value: string) {
  const guarded = FORMULA_LEAD.test(value) ? `'${value}` : value;
  if (/[",\n\r]/.test(guarded)) return `"${guarded.replaceAll("\"", "\"\"")}"`;
  return guarded;
}

/** The other half of `escapeCsvCell`: an apostrophe it added is not part of the value. */
function unguardCsvCell(value: string) {
  return value.startsWith("'") && FORMULA_LEAD.test(value.slice(1)) ? value.slice(1) : value;
}

function splitCsvRecords(text: string) {
  const records: string[][] = [];
  let record: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === "\"" && text[index + 1] === "\"") {
        cell += "\"";
        index += 1;
      } else if (char === "\"") {
        quoted = false;
      } else {
        cell += char;
      }
      continue;
    }
    if (char === "\"") {
      quoted = true;
      continue;
    }
    if (char === ",") {
      record.push(cell);
      cell = "";
      continue;
    }
    if (char === "\n") {
      record.push(cell);
      records.push(record);
      record = [];
      cell = "";
      continue;
    }
    cell += char;
  }
  if (quoted) throw new Error("CSVの引用符が閉じていません");
  if (cell || record.length) {
    record.push(cell);
    records.push(record);
  }
  return records.filter((item) => item.length > 1 || item[0] !== "");
}
