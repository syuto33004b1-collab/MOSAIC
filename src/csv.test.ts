import { describe, expect, it } from "vitest";
import { applyMemberImport, exportMembersCsv, parseCsv, previewMemberImport, serializeCsv } from "./csv";
import { initialWorkspace } from "./domain";

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
