import { describe, expect, it } from "vitest";
import { applyMemberImport, applyProjectImport, DEFAULT_PROPOSAL_CSV_COLUMNS, exportMembersCsv, exportProjectsCsv, exportProposalCsv, parseCsv, previewMemberImport, previewProjectImport, proposalCsvColumns, PROPOSAL_CSV_COLUMNS, serializeCsv } from "./csv";
import { getWeekStart, initialWorkspace, matchMembers, searchSceneFromNeed, type WorkspaceState } from "./domain";

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

  it("refuses a row whose skill level is not a number, like the forms do", () => {
    // #259: the lenient parser would have imported a skill named 「React:abc」.
    const parsed = parseCsv("name,role,department,location,capacity,skills\n山田 花子,Frontend Engineer,開発,東京,100,React:abc\n");
    const preview = previewMemberImport(initialWorkspace, parsed, () => "new");
    expect(preview.actions).toEqual([]);
    expect(preview.issues[0]).toMatchObject({ row: 2, message: "「React:abc」の習熟度は 1〜5 の数字にしてください" });
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

  /**
   * 候補 is not one of the choices, so it cannot be turned off — and nothing is put back in
   * its place either. The first version fell back to 候補 and 職種 when nothing was chosen,
   * which meant a screen showing no columns and a file with two.
   */
  it("writes the candidates alone when nothing else is chosen", () => {
    expect(proposalCsvColumns(false)).not.toContain("候補");
    const csv = exportProposalCsv(initialWorkspace, {
      memberIds: ids, columns: [], anonymous: false, weekStart,
    });
    expect(rows(csv)).toEqual([["候補"], ["佐伯 優斗"], ["中村 美咲"]]);
  });

  /**
   * Excel, Sheets and LibreOffice run a cell that starts with `=`, `+`, `-`, `@`, a tab or
   * a CR. This file is written to be handed to somebody outside, so a member called
   * `=HYPERLINK(...)` must not arrive as a live link. Quoting does not stop it — the
   * leading character is what decides.
   */
  it("writes a name that starts like a formula so no spreadsheet runs it", () => {
    const hostile = { ...initialWorkspace.members[0], id: "hostile", name: '=HYPERLINK("http://example.test","click")' };
    const state = { ...initialWorkspace, members: [...initialWorkspace.members, hostile] };
    const csv = exportProposalCsv(state, { memberIds: ["hostile"], columns: [], anonymous: false, weekStart });
    const cell = rows(csv)[1].join(",");
    expect(cell.startsWith("=")).toBe(false);
    expect(csv).toContain("'=HYPERLINK");
    // And the apostrophe is not part of the value: the member import takes it back off.
    expect(parseCsv(serializeCsv(["氏名"], [[hostile.name]])).rows[0]["氏名"]).toBe(hostile.name);
  });

  it("numbers the candidates when the names are hidden", () => {
    const csv = exportProposalCsv(initialWorkspace, {
      memberIds: ids, columns: DEFAULT_PROPOSAL_CSV_COLUMNS, anonymous: true, weekStart,
    });
    expect(rows(csv)).toEqual([["候補", "職種"], ["候補A", "Product Designer"], ["候補B", "Frontend Engineer"]]);
  });

  it("does not offer 勤務地 while the names are hidden", () => {
    expect(proposalCsvColumns(false)).toEqual(PROPOSAL_CSV_COLUMNS.filter((column) => column !== "候補"));
    expect(proposalCsvColumns(true)).not.toContain("勤務地");
    // Asking for it anyway does not get it.
    const csv = exportProposalCsv(initialWorkspace, {
      memberIds: ["saeki"], columns: ["勤務地"], anonymous: true, weekStart,
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
      memberIds: ["matsumoto"], columns: ["4週間の稼働率", "要件期間の最小空き"], anonymous: false,
      weekStart, needId: need.id,
    });
    const [header, row] = rows(csv);
    // The columns keep the order they are declared in, not the order they were asked for.
    expect(header).toEqual(["候補", "要件期間の最小空き", "4週間の稼働率"]);
    expect(row[2]).toMatch(/^\d+% \/ \d+% \/ \d+% \/ \d+%$/u);
    // Blank rather than 0 when the requirement does not reach this person: an empty cell
    // says 「not scored」 and 「0%」 would say 「no room」. Somebody who certainly fails the
    // requirement, so this is the empty case and not a coincidence.
    const scored = matchMembers(initialWorkspace, searchSceneFromNeed(need)).map((match) => match.member.id);
    const unscoredId = initialWorkspace.members.find((member) => !scored.includes(member.id))!.id;
    expect(scored, "the demo need should not match everybody").not.toContain(unscoredId);
    const unscored = exportProposalCsv(initialWorkspace, {
      memberIds: [unscoredId], columns: ["要件期間の最小空き"], anonymous: false, weekStart, needId: need.id,
    });
    expect(rows(unscored)[1][1]).toBe("");
  });

  it("keeps the declared column order, not the order they were asked for", () => {
    const csv = exportProposalCsv(initialWorkspace, {
      memberIds: ["saeki"], columns: ["4週間の稼働率", "職種"], anonymous: false, weekStart,
    });
    expect(rows(csv)[0]).toEqual(["候補", "職種", "4週間の稼働率"]);
  });
});

describe("project csv import", () => {
  const rowsOf = (csv: string) => parseCsv(csv).rows;

  it("takes back the file it wrote, and creates what has no id", () => {
    // The export is the template: nothing has to agree on a format because the
    // importer reads exactly what `exportProjectsCsv` produced.
    const exported = exportProjectsCsv(initialWorkspace, ["id", "name", "ownerName", "status", "startDate", "endDate", "progress", "demand"]);
    const withNewRow = exported.trimEnd() + "\r\n,新規 案件,林 葵,準備中,2026-10-01,2026-12-31,0,2\r\n";
    const preview = previewProjectImport(initialWorkspace, parseCsv(withNewRow), () => "brand-new");

    expect(preview.issues).toEqual([]);
    expect(preview.actions.at(-1)?.mode).toBe("create");
    expect(preview.actions.filter((action) => action.mode === "update")).toHaveLength(initialWorkspace.projects.length);

    const next = applyProjectImport(initialWorkspace, preview.actions);
    expect(next.projects).toHaveLength(initialWorkspace.projects.length + 1);
    const created = next.projects.find((project) => project.id === "brand-new");
    expect(created).toMatchObject({ name: "新規 案件", status: "準備中", demand: 2, tone: "blue" });
    // Derived from the name and the id, never read from the file. 「新規 案件」 has no
    // A-Za-z0-9 in it, so `createProjectCode` falls back to its `PJ` prefix.
    expect(created?.code).toBe("PJ-BRANDNEW");

    // A round-tripped row comes back as it went out, with one addition: the seed
    // carries `ownerName` and `ownerInitials` but no `ownerPersonId`, and resolving
    // the owner fills that link in.
    const atlas = initialWorkspace.projects.find((project) => project.id === "atlas")!;
    expect(atlas.ownerPersonId).toBeUndefined();
    expect(next.projects.find((project) => project.id === "atlas")).toEqual({ ...atlas, ownerPersonId: "hayashi" });
  });

  it("resolves the owner by the name on screen, and refuses one two people answer to", () => {
    const twins: WorkspaceState = {
      ...initialWorkspace,
      members: [
        { ...initialWorkspace.members[0], id: "one", name: "林 葵", location: "東京" },
        { ...initialWorkspace.members[1], id: "two", name: "林 葵", location: "大阪" },
      ],
    };
    const ambiguous = previewProjectImport(twins, parseCsv("name,ownerName,startDate,endDate\n案件,林 葵,2026-10-01,2026-12-31\n"), () => "x");
    expect(ambiguous.actions).toEqual([]);
    expect(ambiguous.issues[0].message).toContain("複数います");
    // The label the board prints (#123, #262) is what makes the row writable.
    expect(ambiguous.issues[0].message).toContain("林 葵（東京）");

    const labelled = previewProjectImport(twins, parseCsv("name,ownerName,startDate,endDate\n案件,林 葵（大阪）,2026-10-01,2026-12-31\n"), () => "x");
    expect(labelled.issues).toEqual([]);
    expect(labelled.actions[0].project.ownerPersonId).toBe("two");
    // Stored as the raw name, which is what the export writes back out.
    expect(labelled.actions[0].project.ownerName).toBe("林 葵");

    const missing = previewProjectImport(initialWorkspace, parseCsv("name,ownerName,startDate,endDate\n案件,居ない 人,2026-10-01,2026-12-31\n"), () => "x");
    expect(missing.issues[0].message).toContain("見つかりません");
  });

  it("refuses a shortened period instead of cancelling what falls outside it", () => {
    // `handleEditProject` cancels those assignments and needs. A file cannot show
    // which ones, so the row is refused and the count says what it would have cost.
    const atlas = initialWorkspace.projects.find((project) => project.id === "atlas")!;
    const stranded = initialWorkspace.assignments.filter((assignment) => assignment.projectId === "atlas").length
      + initialWorkspace.needs.filter((need) => need.projectId === "atlas").length;
    expect(stranded).toBeGreaterThan(0);

    // The milestone moves with the period, as it would in the form: leaving it at the
    // seed's 2026-08-28 would fall outside the new range and refuse the row for that
    // instead, which is `handleEditProject`'s own rule and not what is under test here.
    const shrunk = "id,name,ownerName,startDate,endDate,nextMilestoneDate\n"
      + `atlas,${atlas.name},${atlas.ownerName},2026-10-01,2026-10-31,2026-10-05\n`;
    const preview = previewProjectImport(initialWorkspace, parseCsv(shrunk), () => "x");
    expect(preview.actions).toEqual([]);
    expect(preview.issues[0].message).toContain("先に画面で調整してください");

    // Widening the period strands nothing, so it goes through.
    const widened = previewProjectImport(initialWorkspace, parseCsv(`id,name,ownerName,startDate,endDate\natlas,${atlas.name},${atlas.ownerName},2026-01-01,2026-12-31\n`), () => "x");
    expect(widened.issues).toEqual([]);
    expect(widened.actions[0].project.endDate).toBe("2026-12-31");
  });

  it("refuses the values the project form refuses", () => {
    const cases: [string, string][] = [
      ["name,ownerName,startDate,endDate,status\n案件,林 葵,2026-10-01,2026-12-31,着手前\n", "状態は"],
      ["name,ownerName,startDate,endDate\n案件,林 葵,2026-12-31,2026-10-01\n", "終了日は開始日以降"],
      ["name,ownerName,startDate,endDate,nextMilestoneDate\n案件,林 葵,2026-10-01,2026-12-31,2027-03-01\n", "節目日はプロジェクト期間内"],
      ["name,ownerName,startDate,endDate,progress\n案件,林 葵,2026-10-01,2026-12-31,140\n", "進捗は0〜100"],
      ["name,ownerName,startDate,endDate,demand\n案件,林 葵,2026-10-01,2026-12-31,2.5\n", "必要人数は0〜10000名の整数"],
      ["id,name,ownerName,startDate,endDate\nnope,案件,林 葵,2026-10-01,2026-12-31\n", "指定したIDのプロジェクトが見つかりません"],
      ["name,ownerName,startDate,endDate\n,林 葵,2026-10-01,2026-12-31\n", "案件名は必須です"],
    ];
    for (const [csv, message] of cases) {
      const preview = previewProjectImport(initialWorkspace, parseCsv(csv), () => "x");
      expect(preview.actions, message).toEqual([]);
      expect(preview.issues[0].message, message).toContain(message);
    }
    expect(rowsOf(cases[0][0])).toHaveLength(1);
  });

  it("leaves the columns a row omits alone", () => {
    const atlas = initialWorkspace.projects.find((project) => project.id === "atlas")!;
    const preview = previewProjectImport(initialWorkspace, parseCsv("id,progress\natlas,72\n"), () => "x");
    expect(preview.issues).toEqual([]);
    // Everything the row is silent about keeps the stored value; `ownerPersonId` is the
    // one addition, resolved from the `ownerName` the seed already carried.
    expect(preview.actions[0].project).toEqual({ ...atlas, ownerPersonId: "hayashi", progress: 72 });
  });
});
