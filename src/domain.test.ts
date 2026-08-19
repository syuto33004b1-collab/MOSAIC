import { describe, expect, it } from "vitest";
import {
  addSkillCatalogEntry,
  assignmentGrid,
  buildSkillMap,
  createProjectCode,
  formatSkillInput,
  getCurrentWeekStart,
  getIsoWeekNumber,
  getWeekStartForDate,
  hydrateWorkspaceSkills,
  inferSkillCatalog,
  initialWorkspace,
  memberDailyLoads,
  memberLoad,
  memberMatchesNeed,
  memberPeakLoad,
  parseSkillInput,
  type WorkspaceState,
} from "./domain";

describe("calendar helpers", () => {
  it("uses the local Monday as the current-week anchor", () => {
    expect(getCurrentWeekStart(new Date(2026, 7, 17, 12))).toBe("2026-08-17");
    expect(getCurrentWeekStart(new Date(2026, 7, 23, 12))).toBe("2026-08-17");
    expect(getCurrentWeekStart(new Date(2026, 7, 24, 12))).toBe("2026-08-24");
  });

  it("computes ISO week numbers across year boundaries", () => {
    expect(getIsoWeekNumber("2026-01-01")).toBe(1);
    expect(getIsoWeekNumber("2026-08-17")).toBe(34);
  });

  it("normalizes any date to its Monday planning week", () => {
    expect(getWeekStartForDate("2026-08-17")).toBe("2026-08-17");
    expect(getWeekStartForDate("2026-08-21")).toBe("2026-08-17");
    expect(getWeekStartForDate("2026-08-23")).toBe("2026-08-17");
  });

  it("creates distinct database-safe project codes for duplicate names", () => {
    const first = createProjectCode("Project Alpha", "00000000-0000-4000-8000-000000000001");
    const second = createProjectCode("Project Alpha", "11111111-0000-4000-8000-000000000001");
    expect(first).toBe("PROJECTA-00000000000");
    expect(second).toBe("PROJECTA-11111111000");
    expect(first).not.toBe(second);
  });

  it("clips assignments to the visible work week", () => {
    expect(assignmentGrid({
      id: "a",
      personId: "m",
      projectId: "p",
      startDate: "2026-08-16",
      endDate: "2026-08-19",
      allocation: 40,
      status: "confirmed",
    }, "2026-08-17")).toEqual({ start: 1, span: 3 });
  });
});

describe("capacity calculations", () => {
  it("only counts assignments that overlap the selected week", () => {
    const state = {
      members: [{ id: "m", initials: "M", name: "Member", role: "QA", department: "QA", avatarTone: "mint", skills: [], location: "Tokyo", capacity: 100 }],
      projects: [],
      needs: [],
      assignments: [
        { id: "current", personId: "m", projectId: "p", startDate: "2026-08-17", endDate: "2026-08-21", allocation: 60, status: "confirmed" },
        { id: "next", personId: "m", projectId: "p", startDate: "2026-08-24", endDate: "2026-08-28", allocation: 40, status: "confirmed" },
      ],
    } satisfies WorkspaceState;

    expect(memberLoad(state, "m", "2026-08-17")).toBe(60);
    expect(memberLoad(state, "m", "2026-08-24")).toBe(40);
  });

  it("uses the peak daily load instead of summing non-overlapping work", () => {
    const state = {
      members: [{ id: "m", initials: "M", name: "Member", role: "QA", department: "QA", avatarTone: "mint", skills: [], location: "Tokyo", capacity: 100 }],
      projects: [],
      needs: [],
      assignments: [
        { id: "monday", personId: "m", projectId: "p", startDate: "2026-08-17", endDate: "2026-08-17", allocation: 100, status: "confirmed" },
        { id: "tuesday", personId: "m", projectId: "p", startDate: "2026-08-18", endDate: "2026-08-18", allocation: 100, status: "confirmed" },
      ],
    } satisfies WorkspaceState;

    expect(memberDailyLoads(state, "m", "2026-08-17", "2026-08-21").map((day) => day.load)).toEqual([100, 100, 0, 0, 0]);
    expect(memberLoad(state, "m", "2026-08-17")).toBe(100);
    expect(memberPeakLoad(state, "m", "2026-08-17", "2026-08-28")).toBe(100);
  });

  it("calculates peak load for an extreme date range without scanning every day", () => {
    const state = {
      members: [{ id: "m", initials: "M", name: "Member", role: "QA", department: "QA", avatarTone: "mint", skills: [], location: "Tokyo", capacity: 100 }],
      projects: [],
      needs: [],
      assignments: [
        { id: "long", personId: "m", projectId: "p", startDate: "2026-08-17", endDate: "9999-12-31", allocation: 40, status: "confirmed" },
        { id: "overlap", personId: "m", projectId: "p", startDate: "2026-08-18", endDate: "2026-08-18", allocation: 30, status: "confirmed" },
      ],
    } satisfies WorkspaceState;

    expect(memberPeakLoad(state, "m", "2026-08-17", "9999-12-31")).toBe(70);
  });
});

describe("skill taxonomy and matching", () => {
  it("parses comma-separated skills and optional proficiency suffixes", () => {
    expect(parseSkillInput("AWS, API, aws")).toEqual([
      { name: "AWS", proficiency: 3 },
      { name: "API", proficiency: 3 },
    ]);
    expect(parseSkillInput("React:4, TypeScript, A11y:2")).toEqual([
      { name: "React", proficiency: 4 },
      { name: "TypeScript", proficiency: 3 },
      { name: "A11y", proficiency: 2 },
    ]);
    expect(formatSkillInput(parseSkillInput("React:4"))).toBe("React:4");
  });

  it("requires every staffing-need skill at or above the minimum proficiency", () => {
    const need = { role: "QA Engineer", skills: ["QA", "Mobile"], skillRequirements: [{ name: "QA", minProficiency: 3 as const }, { name: "Mobile", minProficiency: 3 as const }] };
    expect(memberMatchesNeed({ role: "QA Engineer", skills: ["QA", "Mobile"], skillLevels: [{ name: "QA", proficiency: 4 }, { name: "Mobile", proficiency: 3 }] }, need)).toBe(true);
    expect(memberMatchesNeed({ role: "QA Engineer", skills: ["QA", "Mobile"], skillLevels: [{ name: "QA", proficiency: 4 }, { name: "Mobile", proficiency: 2 }] }, need)).toBe(false);
    expect(memberMatchesNeed({ role: "QA Engineer", skills: ["QA"] }, need)).toBe(false);
    expect(memberMatchesNeed({ role: "Backend Engineer", skills: ["QA", "Mobile"] }, need)).toBe(false);
  });

  it("keeps existing exact-name matching when proficiency is omitted", () => {
    expect(memberMatchesNeed(
      { role: "QA Engineer", skills: ["QA", "Mobile"] },
      { role: "QA Engineer", skills: ["QA", "Mobile"] },
    )).toBe(true);
  });

  it("infers missing catalog entries and hydrates member skill levels", () => {
    const state = hydrateWorkspaceSkills({
      members: [{ id: "m", initials: "M", name: "Member", role: "QA", department: "QA", avatarTone: "mint", skills: ["Rust"], location: "Tokyo", capacity: 100 }],
      projects: [],
      assignments: [],
      needs: [{ id: "n", projectId: "p", role: "QA", skills: ["Rust"], startDate: "2026-08-17", endDate: "2026-08-21", allocation: 40, status: "open" }],
    });

    expect(state.members[0].skillLevels).toEqual([{ name: "Rust", proficiency: 3 }]);
    expect(inferSkillCatalog(state).some((item) => item.name === "Rust" && item.kind === "skill")).toBe(true);
  });

  it("builds a skill map with department distribution and open-need gaps", () => {
    const rows = buildSkillMap(initialWorkspace);
    const api = rows.find((row) => row.name === "API");
    const aws = rows.find((row) => row.name === "AWS");
    const engineering = rows.find((row) => row.name === "エンジニアリング");

    expect(api).toMatchObject({ kind: "skill", memberCount: 0, openNeedCount: 1, qualifiedCount: 0, gap: 1 });
    expect(aws).toMatchObject({ kind: "skill", memberCount: 1, openNeedCount: 1, qualifiedCount: 1, gap: 0 });
    expect(engineering?.kind).toBe("category");
    expect(engineering?.openNeedCount).toBeGreaterThan(0);
    expect(aws?.departments[0]).toMatchObject({ department: "プラットフォーム", count: 1 });
  });

  it("rejects duplicate catalog names and non-category parents", () => {
    expect(() => addSkillCatalogEntry(initialWorkspace.skillCatalog ?? [], { name: "React", kind: "skill" })).toThrow("同じ名前");
    expect(() => addSkillCatalogEntry(initialWorkspace.skillCatalog ?? [], { name: "GraphQL", kind: "skill", parentId: "skill-react" })).toThrow("親には分類");
    expect(addSkillCatalogEntry(initialWorkspace.skillCatalog ?? [], { name: "GraphQL", kind: "skill", parentId: "cat-backend", id: "skill-graphql" }).some((item) => item.id === "skill-graphql")).toBe(true);
  });
});
