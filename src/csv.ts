import { anonymousCandidateLabel } from "./collaboration";
import {
  addDays,
  formatSkillInput,
  hydrateWorkspaceSkills,
  makeInitials,
  matchMembers,
  memberLabel,
  memberLoad,
  memberSkillLevels,
  normalizeCustomValues,
  orderedCustomFields,
  parseSkillInput,
  searchSceneFromNeed,
  type AvatarTone,
  type CustomFieldDefinition,
  type Member,
  type Project,
  type WorkspaceState,
} from "./domain";

export const MAX_CSV_ROWS = 500;
export const CSV_PRESETS_KEY = "mosaic-csv-presets-v1";

export type CsvSource = "members" | "projects";

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

export function normalizeCsvPresets(value: unknown): CsvExportPreset[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const record = item as { id?: unknown; name?: unknown; source?: unknown; columns?: unknown };
    const id = typeof record.id === "string" ? record.id : "";
    const name = typeof record.name === "string" ? record.name.trim() : "";
    const source: CsvSource | "" = record.source === "projects" ? "projects" : record.source === "members" ? "members" : "";
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

function memberActionFromRow(state: WorkspaceState, row: Record<string, string>, rowNumber: number, newId: () => string): MemberImportAction {
  const idValue = cell(row, "id");
  const existing = idValue ? state.members.find((member) => member.id === idValue) : undefined;
  if (idValue && !existing) throw new Error("指定したIDのメンバーが見つかりません");
  if (idValue && !TARGET_ID_PATTERN.test(idValue)) throw new Error("IDの形式を確認してください");

  const name = existing ? valueOr(row, "name", existing.name) : required(row, "name", "氏名");
  const role = existing ? valueOr(row, "role", existing.role) : required(row, "role", "職種");
  const department = existing ? valueOr(row, "department", existing.department) : required(row, "department", "部署");
  const location = existing ? valueOr(row, "location", existing.location) : required(row, "location", "勤務地");
  const capacityRaw = hasColumn(row, "capacity") ? cell(row, "capacity") : existing ? String(existing.capacity) : "100";
  const capacity = Number(capacityRaw);
  if (!Number.isFinite(capacity) || capacity < 0 || capacity > 100) throw new Error("稼働上限は0〜100で入力してください");
  const skillInput = hasColumn(row, "skills") ? cell(row, "skills") : existing ? formatSkillInput(memberSkillLevels(existing)) : "";
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
