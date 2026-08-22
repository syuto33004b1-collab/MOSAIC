import { describe, expect, it } from "vitest";
import { applyMemberImport, DEFAULT_PROPOSAL_CSV_COLUMNS, exportMembersCsv, exportProposalCsv, parseCsv, previewMemberImport, proposalCsvColumns, PROPOSAL_CSV_COLUMNS, serializeCsv } from "./csv";
import { getWeekStart, initialWorkspace } from "./domain";

describe("csv round-trip", () => {
  it("parses quoted commas and serializes a BOM", () => {
    const text = serializeCsv(["name", "role"], [["佐伯, 優斗", "Product Designer"]]);
    expect(text.startsWith("\uFEFF")).toBe(true);
    expect(parseCsv(text)).toEqual({
      headers: ["name", "role"],
      rows: [{ name: "佐伯, 優斗", role: "Product Designer" }],
    });
  });

  it("exports selected member columns including custom fields", () => {
    const csv = exportMembersCsv(initialWorkspace, ["name", "role", "custom:english"]);
    const parsed = parseCsv(csv);
    expect(parsed.headers).toEqual(["name", "role", "custom:english"]);
    const saeki = parsed.rows.find((row) => row.name === "佐伯 優斗");
    expect(saeki).toMatchObject({ role: "Product Designer", "custom:english": "ビジネス" });
  });

  it("creates and updates members from a validated preview", () => {
    const parsed = parseCsv("id,name,role,department,location,capacity,skills\nsaeki,佐伯 優斗,Product Designer,デザイン,東京,80,\"Figma:5, UX:4\"\n,山田 花子,Frontend Engineer,プロダクト開発,大阪,100,React:4\n");
    let created = 0;
    const preview = previewMemberImport(initialWorkspace, parsed, () => `new-${++created}`);
    expect(preview.issues).toEqual([]);
    expect(preview.actions.map((action) => action.mode)).toEqual(["update", "create"]);
    const next = applyMemberImport(initialWorkspace, preview.actions);
    expect(next.members.find((member) => member.id === "saeki")?.capacity).toBe(80);
    expect(next.members.some((member) => member.name === "山田 花子" && member.id === "new-1")).toBe(true);
  });

  it("collects row errors without applying invalid rows", () => {
    const parsed = parseCsv("name,role,department,location,capacity\n,Frontend Engineer,開発,東京,100\n");
    const preview = previewMemberImport(initialWorkspace, parsed, () => "new");
    expect(preview.actions).toEqual([]);
    expect(preview.issues[0]).toMatchObject({ row: 2, message: "氏名は必須です" });
  });
});

/**
 * #148 asked whether the proposal should be shareable outside the organisation. A link
 * cannot be: measured, the copied one is `?nav=proposal&members=saeki&anonymous=1` — real
 * member ids, and the reader can untick the hiding. A file can. It carries no ids and
 * nobody at the other end can un-anonymise it; what it cannot do is expire, which the
 * button says out loud.
 */
describe("writing a proposal out", () => {
  const weekStart = getWeekStart(0);
  const ids = ["saeki", "nakamura"];
  /** Rows without the BOM, split on the CRLF `serializeCsv` writes. */
  const rows = (csv: string) => csv.replace(/^\uFEFF/u, "").trimEnd().split("\r\n").map((line) => line.split(","));

  it("says who and what they do, and nothing else, by default", () => {
    const csv = exportProposalCsv(initialWorkspace, {
      memberIds: ids, columns: DEFAULT_PROPOSAL_CSV_COLUMNS, anonymous: false, weekStart,
    });
    expect(rows(csv)).toEqual([
      ["候補", "職種"],
      ["佐伯 優斗", "Product Designer"],
      ["中村 美咲", "Frontend Engineer"],
    ]);
  });

  it("numbers the candidates when the names are hidden", () => {
    const csv = exportProposalCsv(initialWorkspace, {
      memberIds: ids, columns: DEFAULT_PROPOSAL_CSV_COLUMNS, anonymous: true, weekStart,
    });
    expect(rows(csv)).toEqual([["候補", "職種"], ["候補A", "Product Designer"], ["候補B", "Frontend Engineer"]]);
  });

  it("does not offer 勤務地 while the names are hidden", () => {
    expect(proposalCsvColumns(false)).toEqual([...PROPOSAL_CSV_COLUMNS]);
    expect(proposalCsvColumns(true)).not.toContain("勤務地");
    // Asking for it anyway does not get it.
    const csv = exportProposalCsv(initialWorkspace, {
      memberIds: ["saeki"], columns: ["候補", "勤務地"], anonymous: true, weekStart,
    });
    expect(rows(csv)[0]).toEqual(["候補"]);
  });

  it("carries no member id in any column, whatever is asked for", () => {
    const csv = exportProposalCsv(initialWorkspace, {
      memberIds: initialWorkspace.members.map((member) => member.id),
      columns: [...PROPOSAL_CSV_COLUMNS], anonymous: false, weekStart,
    });
    for (const member of initialWorkspace.members) {
      expect(csv, `${member.id} reached the file`).not.toContain(member.id);
    }
  });

  it("writes the four weeks the cards show, and the availability the requirement gives", () => {
    const need = (initialWorkspace.needs ?? [])[0];
    expect(need, "the demo data should carry a staffing need").toBeDefined();
    const csv = exportProposalCsv(initialWorkspace, {
      memberIds: ["matsumoto"], columns: ["候補", "4週間の稼働率", "要件期間の最小空き"], anonymous: false,
      weekStart, needId: need.id,
    });
    const [header, row] = rows(csv);
    // The columns keep the order they are declared in, not the order they were asked for.
    expect(header).toEqual(["候補", "要件期間の最小空き", "4週間の稼働率"]);
    expect(row[2]).toMatch(/^\d+% \/ \d+% \/ \d+% \/ \d+%$/u);
    // Blank rather than 0 when the requirement does not reach this person: an empty cell
    // says 「not scored」 and 「0%」 would say 「no room」.
    const unscored = exportProposalCsv(initialWorkspace, {
      memberIds: ["ito"], columns: ["候補", "要件期間の最小空き"], anonymous: false, weekStart, needId: need.id,
    });
    expect(rows(unscored)[1][1]).toMatch(/^(\d+%)?$/u);
  });

  it("falls back to the default columns rather than writing an empty file", () => {
    const csv = exportProposalCsv(initialWorkspace, {
      memberIds: ["saeki"], columns: [], anonymous: false, weekStart,
    });
    expect(rows(csv)[0]).toEqual(["候補", "職種"]);
  });
});
