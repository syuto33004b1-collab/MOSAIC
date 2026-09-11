import { describe, expect, it } from "vitest";
import { normalizeCsvPresets, applyAssignmentImport, applyMemberImport, applyProjectImport, assignmentCsvColumns, exportAssignmentsCsv, previewAssignmentImport, DEFAULT_PROPOSAL_CSV_COLUMNS, exportMembersCsv, exportProjectsCsv, exportProposalCsv, parseCsv, previewMemberImport, previewProjectImport, proposalCsvColumns, PROPOSAL_CSV_COLUMNS, serializeCsv } from "./csv";
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

  it("refuses a date no calendar has, which the form's date input could not produce", () => {
    // Every comparison here is a string comparison, so 「2026-02-31」 sorts where a real
    // date would and reaches a `date` column that rejects it at save time.
    const cases: [string, string][] = [
      ["name,ownerName,startDate,endDate\n案件,林 葵,2026-02-31,2026-12-31\n", "開始日「2026-02-31」は存在しない日付です"],
      ["name,ownerName,startDate,endDate\n案件,林 葵,2026-10-01,2026-13-01\n", "終了日「2026-13-01」は存在しない日付です"],
      ["name,ownerName,startDate,endDate\n案件,林 葵,きのう,2026-12-31\n", "開始日は YYYY-MM-DD の形式で入力してください"],
      ["name,ownerName,startDate,endDate\n案件,林 葵,2026-1-1,2026-12-31\n", "開始日は YYYY-MM-DD の形式で入力してください"],
      ["name,ownerName,startDate,endDate,nextMilestoneDate\n案件,林 葵,2026-10-01,2026-12-31,2026-11-31\n", "節目日「2026-11-31」は存在しない日付です"],
    ];
    for (const [csv, message] of cases) {
      const preview = previewProjectImport(initialWorkspace, parseCsv(csv), () => "x");
      expect(preview.actions, message).toEqual([]);
      expect(preview.issues[0].message, message).toBe(message);
    }
    // A leap day that exists still goes through.
    const leap = previewProjectImport(initialWorkspace, parseCsv("name,ownerName,startDate,endDate\n案件,林 葵,2028-02-29,2028-03-01\n"), () => "x");
    expect(leap.issues).toEqual([]);
  });

  it("keeps the owner a row does not mention, even when the name is shared", () => {
    // The export writes the raw name, so re-resolving on every update would refuse
    // 「id,progress」 for a project whose owner has a namesake — a change that never
    // mentioned the owner at all.
    const twins: WorkspaceState = {
      ...initialWorkspace,
      members: [
        { ...initialWorkspace.members[0], id: "one", name: "林 葵", location: "東京" },
        { ...initialWorkspace.members[1], id: "two", name: "林 葵", location: "大阪" },
      ],
      projects: [{ ...initialWorkspace.projects[0], id: "p", ownerPersonId: "two", ownerName: "林 葵", ownerInitials: "AH" }],
      assignments: [],
      needs: [],
    };

    const omitted = previewProjectImport(twins, parseCsv("id,progress\np,64\n"), () => "x");
    expect(omitted.issues).toEqual([]);
    expect(omitted.actions[0].project).toMatchObject({ ownerPersonId: "two", progress: 64 });

    // The same name written back out is the same owner, not an ambiguous one.
    const roundTripped = previewProjectImport(twins, parseCsv("id,ownerName,progress\np,林 葵,64\n"), () => "x");
    expect(roundTripped.issues).toEqual([]);
    expect(roundTripped.actions[0].project.ownerPersonId).toBe("two");

    // Naming the other one is a change, so it resolves — and is refused when ambiguous.
    const moved = previewProjectImport(twins, parseCsv("id,ownerName\np,林 葵（東京）\n"), () => "x");
    expect(moved.actions[0].project.ownerPersonId).toBe("one");
    const unlinked: WorkspaceState = { ...twins, projects: [{ ...twins.projects[0], ownerPersonId: undefined }] };
    expect(previewProjectImport(unlinked, parseCsv("id,progress\np,64\n"), () => "x").issues[0].message).toContain("複数います");
  });

  it("names the stored milestone when a period-only row falls foul of it", () => {
    const atlas = initialWorkspace.projects.find((project) => project.id === "atlas")!;
    expect(atlas.nextMilestoneDate).toBe("2026-08-28");
    const preview = previewProjectImport(initialWorkspace, parseCsv(`id,startDate,endDate\natlas,2026-09-01,2026-09-30\n`), () => "x");
    expect(preview.issues[0].message).toBe("保存済みの節目日「2026-08-28」が変更後の期間の外です。nextMilestoneDate も指定してください");
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

describe("assignment csv", () => {
  const atlas = initialWorkspace.projects.find((project) => project.id === "atlas")!;
  const inAtlas = initialWorkspace.assignments.find((assignment) => assignment.projectId === "atlas")!;

  it("writes the label the board prints, so a namesake survives the round trip", () => {
    // #284's owner column writes the raw name and cannot be read back when two people
    // answer to it. This one starts from `memberLabel`, so it can.
    const twins: WorkspaceState = {
      ...initialWorkspace,
      members: [
        { ...initialWorkspace.members[0], id: "one", name: "林 葵", location: "東京" },
        { ...initialWorkspace.members[1], id: "two", name: "林 葵", location: "大阪" },
      ],
      projects: [atlas],
      assignments: [{ ...inAtlas, id: "a", personId: "two", projectId: atlas.id }],
      needs: [],
    };
    const csv = exportAssignmentsCsv(twins, assignmentCsvColumns().map((column) => column.key));
    expect(parseCsv(csv).rows[0].memberName).toBe("林 葵（大阪）");

    const back = previewAssignmentImport(twins, parseCsv(csv), () => "x");
    expect(back.issues).toEqual([]);
    expect(back.actions[0].assignment.personId).toBe("two");
    expect(applyAssignmentImport(twins, back.actions).assignments).toHaveLength(1);
  });

  it("creates from names, and keeps the weekend days it is given", () => {
    const csv = "memberName,projectName,startDate,endDate,allocation,status,weekendWorkDates\n"
      + `佐伯 優斗,${atlas.name},2026-08-21,2026-08-23,40,confirmed,2026-08-22 2026-08-23\n`;
    const preview = previewAssignmentImport(initialWorkspace, parseCsv(csv), () => "fresh");
    expect(preview.issues).toEqual([]);
    expect(preview.actions[0]).toMatchObject({ mode: "create" });
    expect(preview.actions[0].assignment).toMatchObject({
      id: "fresh", personId: "saeki", projectId: "atlas", allocation: 40, status: "confirmed",
      weekendWorkDates: ["2026-08-22", "2026-08-23"],
    });
    // The project can also be named by its code, which is what the export writes for it.
    const byCode = previewAssignmentImport(initialWorkspace, parseCsv(
      `memberName,projectName,startDate,endDate,allocation\n佐伯 優斗,${atlas.code},2026-08-21,2026-08-23,40\n`,
    ), () => "x");
    expect(byCode.issues).toEqual([]);
    expect(byCode.actions[0].assignment.projectId).toBe("atlas");
    // Nothing said about the status: a draft, like the form's own default.
    expect(byCode.actions[0].assignment.status).toBe("draft");
  });

  it("refuses what the database and the screens refuse", () => {
    const head = "memberName,projectName,startDate,endDate,allocation";
    const cases: [string, string][] = [
      // `allocation_percent` is `> 0`, unlike a project's progress.
      [`${head}\n佐伯 優斗,${atlas.name},2026-08-21,2026-08-23,0\n`, "稼働配分は1〜100の整数で入力してください"],
      [`${head}\n佐伯 優斗,${atlas.name},2026-08-21,2026-08-23,140\n`, "稼働配分は1〜100の整数で入力してください"],
      [`${head}\n佐伯 優斗,${atlas.name},2026-08-23,2026-08-21,40\n`, "終了日は開始日以降にしてください"],
      [`${head}\n佐伯 優斗,${atlas.name},2026-02-31,2026-08-23,40\n`, "開始日「2026-02-31」は存在しない日付です"],
      [`${head}\n居ない 人,${atlas.name},2026-08-21,2026-08-23,40\n`, "メンバー「居ない 人」が見つかりません"],
      [`${head}\n佐伯 優斗,無い案件,2026-08-21,2026-08-23,40\n`, "プロジェクト「無い案件」が見つかりません"],
      // Outside the project: `handleEditProject` would cancel it at the next edit.
      [`${head}\n佐伯 優斗,${atlas.name},2026-01-01,2026-01-05,40\n`, `プロジェクト「${atlas.name}」の期間（${atlas.startDate}〜${atlas.endDate}）に収まる範囲にしてください`],
      [`${head},status\n佐伯 優斗,${atlas.name},2026-08-21,2026-08-23,40,cancelled\n`, "状態は draft または confirmed にしてください"],
      // Saturday and Sunday only, and inside the assignment: both halves of what the
      // `assignment_weekend_days` table asks.
      [`${head},weekendWorkDates\n佐伯 優斗,${atlas.name},2026-08-21,2026-08-23,40,2026-08-21\n`, "稼働した週末「2026-08-21」は土日ではありません"],
      [`${head},weekendWorkDates\n佐伯 優斗,${atlas.name},2026-08-21,2026-08-23,40,2026-08-29\n`, "稼働した週末「2026-08-29」がアサインの期間外です"],
      [`id,${head}\nnope,佐伯 優斗,${atlas.name},2026-08-21,2026-08-23,40\n`, "指定したIDのアサインが見つかりません"],
    ];
    for (const [csv, message] of cases) {
      const preview = previewAssignmentImport(initialWorkspace, parseCsv(csv), () => "x");
      expect(preview.actions, message).toEqual([]);
      expect(preview.issues[0].message, message).toBe(message);
    }
  });

  it("leaves an updated row's untouched columns alone", () => {
    const preview = previewAssignmentImport(initialWorkspace, parseCsv(`id,allocation\n${inAtlas.id},35\n`), () => "x");
    expect(preview.issues).toEqual([]);
    expect(preview.actions[0].assignment).toMatchObject({
      id: inAtlas.id, personId: inAtlas.personId, projectId: inAtlas.projectId,
      startDate: inAtlas.startDate, endDate: inAtlas.endDate, allocation: 35, status: inAtlas.status,
    });
  });

  it("does not link a staffing need, leaving that to the RPC", () => {
    const preview = previewAssignmentImport(initialWorkspace, parseCsv(
      `memberName,projectName,startDate,endDate,allocation\n佐伯 優斗,${atlas.name},2026-08-21,2026-08-23,40\n`,
    ), () => "x");
    expect(preview.actions[0].assignment.staffingNeedId).toBeUndefined();
  });
});

/** The four the evaluation of #286 found, each one a save that would have failed or lied. */
describe("assignment csv, after review", () => {
  const atlas = initialWorkspace.projects.find((project) => project.id === "atlas")!;
  const linked = initialWorkspace.assignments.find((assignment) => assignment.staffingNeedId)
    ?? { ...initialWorkspace.assignments[0], staffingNeedId: "need-1" };
  const withLink: WorkspaceState = {
    ...initialWorkspace,
    assignments: [{ ...linked, id: "a", projectId: atlas.id, staffingNeedId: "need-1", weekendWorkDates: ["2026-08-22"], startDate: "2026-08-21", endDate: "2026-08-23" }],
  };

  it("detaches the need when the row changes what the RPC matches on", () => {
    // The RPC links on project, person, period and allocation. Keep the stale link and
    // the assignment answers a need it no longer fills.
    const moved = previewAssignmentImport(withLink, parseCsv("id,allocation\na,55\n"), () => "x");
    expect(moved.issues).toEqual([]);
    expect(moved.actions[0].assignment.staffingNeedId).toBeNull();

    // A row that changes nothing it matches on keeps the link.
    const untouched = previewAssignmentImport(withLink, parseCsv("id,label\na,特別対応\n"), () => "x");
    expect(untouched.actions[0].assignment.staffingNeedId).toBe("need-1");
  });

  it("does not erase a weekend day over a row about the allocation", () => {
    // `weekendWorkDates` tells absent from `[]` in the save payload: absent leaves the
    // stored days alone, `[]` clears them.
    const preview = previewAssignmentImport(withLink, parseCsv("id,allocation\na,55\n"), () => "x");
    expect(preview.actions[0].assignment.weekendWorkDates).toEqual(["2026-08-22"]);
    // Naming the column with nothing in it is how you clear them.
    const cleared = previewAssignmentImport(withLink, parseCsv("id,weekendWorkDates\na,\n"), () => "x");
    expect(cleared.actions[0].assignment.weekendWorkDates).toEqual([]);
  });

  it("keeps the member a row does not change, even once a namesake turns up", () => {
    const twins: WorkspaceState = {
      ...withLink,
      members: [
        { ...initialWorkspace.members[0], id: "one", name: "林 葵", location: "東京" },
        { ...initialWorkspace.members[1], id: "two", name: "林 葵", location: "大阪" },
      ],
      assignments: [{ ...withLink.assignments[0], personId: "two" }],
    };
    const preview = previewAssignmentImport(twins, parseCsv("id,allocation\na,55\n"), () => "x");
    expect(preview.issues).toEqual([]);
    expect(preview.actions[0].assignment.personId).toBe("two");
  });

  it("writes a project's code when two share a name, so the row can come back", () => {
    const twoAtlas: WorkspaceState = {
      ...initialWorkspace,
      projects: [atlas, { ...atlas, id: "atlas2", code: "ATL2", name: atlas.name }],
      assignments: [{ ...initialWorkspace.assignments[0], id: "a", projectId: "atlas2" }],
      needs: [],
    };
    const csv = exportAssignmentsCsv(twoAtlas, ["id", "memberName", "projectName", "startDate", "endDate", "allocation"]);
    expect(parseCsv(csv).rows[0].projectName).toBe("ATL2");
    const back = previewAssignmentImport(twoAtlas, parseCsv(csv), () => "x");
    expect(back.issues).toEqual([]);
    expect(back.actions[0].assignment.projectId).toBe("atlas2");
  });

  it("refuses an allocation the numeric(5,2) column would round to zero", () => {
    const head = "memberName,projectName,startDate,endDate,allocation";
    for (const value of ["0.001", "0", "40.5", "abc"]) {
      const preview = previewAssignmentImport(initialWorkspace, parseCsv(`${head}\n佐伯 優斗,${atlas.name},2026-08-21,2026-08-23,${value}\n`), () => "x");
      expect(preview.issues[0].message, value).toBe("稼働配分は1〜100の整数で入力してください");
    }
  });

  it("counts the label in characters, like char_length does", () => {
    const head = "memberName,projectName,startDate,endDate,allocation,label";
    const row = (label: string) => `${head}\n佐伯 優斗,${atlas.name},2026-08-21,2026-08-23,40,${label}\n`;
    // 240 emoji are 480 UTF-16 units and 240 characters: the column takes them.
    const ok = previewAssignmentImport(initialWorkspace, parseCsv(row("🙂".repeat(240))), () => "x");
    expect(ok.issues).toEqual([]);
    const tooLong = previewAssignmentImport(initialWorkspace, parseCsv(row("あ".repeat(241))), () => "x");
    expect(tooLong.issues[0].message).toBe("表示名は240文字以内にしてください");
  });

  it("keeps a saved column set for every target, assignments included", () => {
    // The normaliser named two of the three, so an assignment preset was dropped on read.
    const presets = normalizeCsvPresets([
      { id: "p1", name: "アサイン用", source: "assignments", columns: ["memberName", "projectName"] },
      { id: "p2", name: "壊れた", source: "nonsense", columns: ["x"] },
    ]);
    expect(presets.map((preset) => preset.source)).toEqual(["assignments"]);
  });
});

/**
 * #302: all three imports read the `id` column the same way, so the order of its two
 * checks is pinned once, in both directions. Existence first made the format message
 * unreachable — a saved id always matches the pattern, so a malformed one missed the
 * `find` and came back as 「見つかりません」, which reads as a row that is gone.
 */
describe("the id column a file writes back", () => {
  const atlas = initialWorkspace.projects.find((project) => project.id === "atlas")!;
  const paths: { noun: string; preview: (id: string) => { issues: { message: string }[] } }[] = [
    {
      noun: "メンバー",
      preview: (id) => previewMemberImport(initialWorkspace, parseCsv(`id,name,role,department,location,capacity\n${id},山田 花子,Frontend Engineer,開発,東京,100\n`), () => "x"),
    },
    {
      noun: "プロジェクト",
      preview: (id) => previewProjectImport(initialWorkspace, parseCsv(`id,name,ownerName,startDate,endDate\n${id},案件,林 葵,2026-10-01,2026-12-31\n`), () => "x"),
    },
    {
      noun: "アサイン",
      preview: (id) => previewAssignmentImport(initialWorkspace, parseCsv(`id,memberName,projectName,startDate,endDate,allocation\n${id},佐伯 優斗,${atlas.name},2026-08-21,2026-08-23,40\n`), () => "x"),
    },
  ];

  it("says the id is malformed, rather than missing, on every path", () => {
    // Both limbs of `/^[\w:-]{1,80}$/`: a character it does not allow, and one too many.
    for (const malformed of ["abc def", "a".repeat(81)]) {
      for (const { noun, preview } of paths) {
        expect(preview(malformed).issues[0].message, `${noun} / ${malformed.slice(0, 12)}`).toBe("IDの形式を確認してください");
      }
    }
  });

  it("still says the row is absent when the id is well formed and nothing has it", () => {
    for (const { noun, preview } of paths) {
      expect(preview("nope").issues[0].message, noun).toBe(`指定したIDの${noun}が見つかりません`);
    }
  });
});

/**
 * #303: the assignment form has warned about an overbooking since #254; the path that
 * takes 500 rows at once said nothing. Each row was read against the workspace as it
 * stands, so rows in one file never saw each other and the overload arrived afterwards
 * as an 上限超過 card. Warned, not refused — the warned rows still go in.
 */
describe("what an assignment file would do to a ceiling", () => {
  const atlas = initialWorkspace.projects.find((project) => project.id === "atlas")!;
  const head = "memberName,projectName,startDate,endDate,allocation";
  // 2026-09-21 — 09-25 is a clear Monday-to-Friday for 佐伯 優斗: the demo assignments
  // that reach them end on 09-11 and 08-28. So the sums below are the file's own.
  const clear = (allocation: number) => `佐伯 優斗,${atlas.name},2026-09-21,2026-09-25,${allocation}`;
  const preview = (...rows: string[]) => previewAssignmentImport(initialWorkspace, parseCsv([head, ...rows].join("\n") + "\n"), () => crypto.randomUUID());

  it("adds up the rows of one file, which none of them could see alone", () => {
    const result = preview(clear(60), clear(60), clear(60));
    expect(result.warnings).toEqual([
      "2・3・4行目: 佐伯 優斗さんの稼働が180%になります（稼働上限100%）。仮置きはできます。",
    ]);
    // Said, not enforced: every row is still placed.
    expect(result.issues).toEqual([]);
    expect(result.actions).toHaveLength(3);
  });

  it("adds the file to what the workspace already holds", () => {
    // 佐伯 優斗 is at 80% across 08-21 — 08-23 already (50% on Atlas, 30% on 採用サイト).
    const result = preview(`佐伯 優斗,${atlas.name},2026-08-21,2026-08-23,100`);
    expect(result.warnings).toEqual([
      "2行目: 佐伯 優斗さんの稼働が180%になります（稼働上限100%）。仮置きはできます。",
    ]);
    expect(result.actions).toHaveLength(1);
  });

  it("says nothing when the file fits, and does not count a row it refused", () => {
    expect(preview(clear(60)).warnings).toEqual([]);
    // The refused row carries a usable 60%; counting it would push the pair to 120%.
    const withRefused = preview(clear(60), `佐伯 優斗,${atlas.name},2026-02-31,2026-09-25,60`);
    expect(withRefused.issues).toHaveLength(1);
    expect(withRefused.actions).toHaveLength(1);
    expect(withRefused.warnings).toEqual([]);
  });
});
