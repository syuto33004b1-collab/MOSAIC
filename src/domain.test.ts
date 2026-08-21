import { describe, expect, it } from "vitest";
import {
  addCustomField,
  editableCustomFields,
  setRolePermission,
  addOrgUnit,
  addProfileRequests,
  addSkillCatalogEntry,
  archiveOrgUnit,
  assignmentSpan,
  boardRange,
  projectMembersOnDays,
  buildSkillMap,
  cancelProfileRequest,
  completeProfileRequest,
  canConvertOpportunity,
  convertOpportunityToProject,
  createProjectCode,
  formatSkillInput,
  formatWorkHistoryPeriod,
  getCurrentWeekStart,
  getIsoWeekNumber,
  getWeekStartForDate,
  matchScore,
  matchScoreMax,
  memberLabel,
  weekLabel,
  hydrateWorkspaceSkills,
  inferSkillCatalog,
  initialWorkspace,
  memberDailyLoads,
  memberLoad,
  memberMatchesNeed,
  memberPeakLoad,
  memberSearchText,
  membersInOrgSubtree,
  moveOrgUnit,
  normalizeCustomValues,
  normalizeWorkHistory,
  orgManagers,
  orgUnitArchiveBlocker,
  orgUnitLoadRows,
  orgUnitPath,
  parseSkillInput,
  pipelineDemandForWeek,
  projectSearchText,
  addSearchScene,
  addSavedReport,
  buildSavedReport,
  matchMembers,
  searchSceneFromNeed,
  setMemberOrgMemberships,
  submitProfileRequest,
  visibleCustomFields,
  type WorkspaceState,
  type Member,
  type SearchScene,
  type SkillProficiency,
  type StaffingNeed,
  type SearchSkillFilter,
  ownerLabel,
  ownerMember,
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

  /**
   * #146: 「今週」 was on figures measured over whatever week the board was paged
   * to. This is what they say instead, and it takes any day of the week so a
   * caller cannot name one week while measuring another.
   */
  it("names the week a figure covers, from any day in it", () => {
    expect(weekLabel("2026-08-17")).toBe("8/17週");
    expect(weekLabel("2026-08-21")).toBe("8/17週");
    expect(weekLabel("2026-08-23")).toBe("8/17週");
    expect(weekLabel("2026-08-24")).toBe("8/24週");
    // No zero padding, and a week that straddles a month keeps its Monday's month.
    expect(weekLabel("2026-09-01")).toBe("8/31週");
    expect(weekLabel("2027-01-01")).toBe("12/28週");
  });

  it("creates distinct database-safe project codes for duplicate names", () => {
    const first = createProjectCode("Project Alpha", "00000000-0000-4000-8000-000000000001");
    const second = createProjectCode("Project Alpha", "11111111-0000-4000-8000-000000000001");
    expect(first).toBe("PROJECTA-00000000000");
    expect(second).toBe("PROJECTA-11111111000");
    expect(first).not.toBe(second);
  });

  const assignment = (startDate: string, endDate: string) => ({
    id: "a", personId: "m", projectId: "p", startDate, endDate, allocation: 40, status: "confirmed" as const,
  });

  it("clips assignments to the visible work week", () => {
    // Starts on the Sunday before, ends on the Wednesday: three columns.
    const week = boardRange("week", 0, "2026-08-17");
    expect(assignmentSpan(assignment("2026-08-16", "2026-08-19"), week)).toEqual({ start: 1, span: 3 });
  });

  /**
   * A column is a position in the range's weekday list, not a count of days. The
   * two agree for one Monday-to-Friday week and nowhere else, which is why the
   * old day-counting version was right until the board could show a month:
   * 2026-08-24 is seven days after the 17th and six columns along.
   */
  it("counts columns, not days, once the range is a month", () => {
    const month = boardRange("month", 0, "2026-08-17");
    expect(month.start).toBe("2026-08-03");
    expect(month.end).toBe("2026-08-31");
    expect(month.days).toHaveLength(21);
    // Every day in view is a weekday, and they are in order.
    expect(month.days.every((day) => day.month === 8)).toBe(true);
    expect(month.days.map((day) => day.iso)).toEqual([...month.days.map((day) => day.iso)].sort());

    expect(assignmentSpan(assignment("2026-08-03", "2026-08-07"), month)).toEqual({ start: 1, span: 5 });
    // The Monday of the fourth week: day 21 of the month, column 16.
    expect(assignmentSpan(assignment("2026-08-24", "2026-08-24"), month)).toEqual({ start: 16, span: 1 });
    // Spanning a weekend takes the columns either side of it and not the weekend.
    expect(assignmentSpan(assignment("2026-08-07", "2026-08-10"), month)).toEqual({ start: 5, span: 2 });
  });

  it("clamps an assignment that runs past both ends of the range", () => {
    const month = boardRange("month", 0, "2026-08-17");
    expect(assignmentSpan(assignment("2026-07-01", "2026-09-30"), month)).toEqual({ start: 1, span: 21 });
  });

  it("drops an assignment that lands only on a weekend inside the range", () => {
    const month = boardRange("month", 0, "2026-08-17");
    // 8/8 is a Saturday and 8/9 a Sunday: inside the month, on no column.
    expect(assignmentSpan(assignment("2026-08-08", "2026-08-09"), month)).toBeNull();
  });

  /**
   * A month anchored on this week's Monday is the wrong month on the 1st or 2nd of
   * a month that opens on a weekend: on Sunday 2026-08-02 the Monday is
   * 2026-07-27. `offset: 0` has to mean the month you are in.
   */
  it("takes the month from today, not from this week's Monday", () => {
    for (const day of ["2026-08-01", "2026-08-02"]) {
      const range = boardRange("month", 0, day);
      expect(range.start, day).toBe("2026-08-03");
      expect(range.end, day).toBe("2026-08-31");
    }
    // And the week still normalises to its Monday, from any day in it.
    expect(boardRange("week", 0, "2026-08-02").start).toBe("2026-07-27");
    expect(boardRange("week", 0, "2026-08-21").start).toBe("2026-08-17");
  });

  /**
   * The board has no weekend columns, so an assignment that only touches a weekend
   * draws no bar. A staffing count that included it would put a number on screen
   * with nothing behind it.
   */
  it("counts only the people whose assignment lands on a day in view", () => {
    const month = boardRange("month", 0, "2026-08-17");
    const state = {
      members: [], projects: [], needs: [],
      assignments: [
        { id: "weekday", personId: "a", projectId: "p", startDate: "2026-08-10", endDate: "2026-08-11", allocation: 50, status: "confirmed" },
        // 8/8 Saturday to 8/9 Sunday: inside the month's span, on no column.
        { id: "weekend", personId: "b", projectId: "p", startDate: "2026-08-08", endDate: "2026-08-09", allocation: 50, status: "confirmed" },
      ],
    } as unknown as WorkspaceState;
    expect(projectMembersOnDays(state, "p", month.days)).toBe(1);
  });

  it("keeps a week that straddles New Year in one range", () => {
    // 2026-12-28 is a Monday; that week runs into 2027.
    const week = boardRange("week", 0, "2026-12-30");
    expect(week.days.map((day) => day.iso)).toEqual([
      "2026-12-28", "2026-12-29", "2026-12-30", "2026-12-31", "2027-01-01",
    ]);
    expect(week.days[0].year).toBe(2026);
    expect(week.days[4].year).toBe(2027);
  });

  it("pages by the unit it is showing", () => {
    expect(boardRange("week", 1, "2026-08-17").start).toBe("2026-08-24");
    expect(boardRange("month", 1, "2026-08-17").start).toBe("2026-09-01");
    expect(boardRange("month", -1, "2026-08-17").start).toBe("2026-07-01");
    // A month that opens on a weekend starts on its first weekday. 2026-08-01 is
    // a Saturday, so August's range starts on the 3rd — checked above.
    expect(boardRange("month", 2, "2026-08-17").start).toBe("2026-10-01");
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

/**
 * #150: 「適合 n点」 was printed with no denominator, and the denominator is not a
 * constant — it moves with how many 「あると良い」 skills the scene names.
 */
describe("what the fit score is out of", () => {
  const scene = (skills: SearchSkillFilter[]): SearchScene => ({ id: "s", name: "s", skills });

  it("tops out at 40 plus 20 per nice-to-have, capped at 60", () => {
    expect(matchScoreMax(scene([]))).toBe(40);
    expect(matchScoreMax(scene([{ name: "A", minProficiency: 3 as const, importance: "nice" as const }]))).toBe(60);
    expect(matchScoreMax(scene([
      { name: "A", minProficiency: 3 as const, importance: "nice" as const },
      { name: "B", minProficiency: 3 as const, importance: "nice" as const },
    ]))).toBe(80);
    expect(matchScoreMax(scene([
      { name: "A", minProficiency: 3 as const, importance: "nice" as const },
      { name: "B", minProficiency: 3 as const, importance: "nice" as const },
      { name: "C", minProficiency: 3 as const, importance: "nice" as const },
      { name: "D", minProficiency: 3 as const, importance: "nice" as const },
    ]))).toBe(100);
  });

  it("counts must-have skills for nothing, because they are a filter", () => {
    expect(matchScoreMax(scene([
      { name: "A", minProficiency: 3 as const, importance: "must" as const },
      { name: "B", minProficiency: 5 as const, importance: "must" as const },
    ]))).toBe(40);
    // And the ceiling is reachable: full availability, no nice-to-haves.
    expect(matchScore(100, 0)).toBe(40);
    expect(matchScore(250, 0)).toBe(40);
  });

  /**
   * The tie-break the guide's heading depends on. `matchScore` rounds, so 60% and 61%
   * both give 24 — before availability became the second key, the name decided which
   * came first and 「要件期間の最小空きが多い順」 was false for any pair inside the same
   * 2.5-point band. The fixture is deliberately in the wrong order by name so the sort
   * has to do the work.
   */
  it("breaks a score tie on availability, not on the name", () => {
    const base = { role: "Engineer", department: "D", location: "東京", capacity: 100 as const, skills: [] as string[], initials: "XX", avatarTone: "" };
    // 「あ」 before 「ん」 by name, and the lower availability, so a name tie-break puts
    // it first and an availability tie-break puts it second.
    const state = {
      members: [
        { ...base, id: "low", name: "あ低 空き", capacity: 60 },
        { ...base, id: "high", name: "ん高 空き", capacity: 61 },
      ],
      projects: [], assignments: [], needs: [],
    } as unknown as WorkspaceState;
    const scene: SearchScene = { id: "s", name: "s", skills: [], startDate: "2026-09-01", endDate: "2026-09-30" };
    const ranked = matchMembers(state, scene);
    expect(ranked.map((match) => match.availablePercent)).toEqual([61, 60]);
    // Both land on the same rounded score, which is the whole point.
    expect(new Set(ranked.map((match) => match.score)).size).toBe(1);
    expect(ranked.map((match) => match.member.id)).toEqual(["high", "low"]);
  });

  /**
   * Why the proposal screen and the resolution guide stopped printing a score.
   * `searchSceneFromNeed` forces every skill to 「必須」 — the requirement type has no
   * importance field to carry anything else — so for those screens the score reduced
   * to `round(空き% × 0.4)`, which is the number printed beside it.
   *
   * If requirements ever gain a nice-to-have, this fails, and showing a score on
   * those screens becomes worth reconsidering. That is the point of pinning it.
   */
  it("a score built from a requirement is the availability and nothing else", () => {
    const need = {
      id: "n", role: "QA Engineer", skills: ["QA", "Mobile"],
      skillRequirements: [{ name: "QA", minProficiency: 3 as const }, { name: "Mobile", minProficiency: 4 as const }],
      startDate: "2026-08-24", endDate: "2026-09-04", allocation: 60,
    };
    expect(matchScoreMax(searchSceneFromNeed(need))).toBe(40);
    for (const available of [0, 25, 60, 100, 140]) {
      expect(matchScore(available, 0)).toBe(Math.min(40, Math.round(available * 0.4)));
    }
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

/**
 * #126: 「不足」 was `max(0, requirementCount - qualifiedHolderCount)` — a count of
 * requirements minus a count of people, so the result was in neither unit. #85 had to
 * put 「1人が1件を担う想定で数えています」 on the screen to make it readable.
 *
 * Measured before the change, and these are the cases the issue named:
 *
 * | case                                             | 未充足 | 保有 | 不足 was |
 * | ------------------------------------------------ | ----- | --- | -------- |
 * | 3 requirements, 1 holder who meets all three      | 3     | 1   | **2**    |
 * | 1 requirement, 3 holders                          | 1     | 3   | 0        |
 * | 2 requirements in periods that do not overlap     | 2     | 1   | **1**    |
 * | 2 requirements, holder too junior for either      | 2     | 1   | 2        |
 * | 2 requirements, holder meets one of them          | 2     | 1   | 1        |
 *
 * It counts requirements no holder qualifies for now, which is the same unit as
 * 未充足 and needs no assumption about how many requirements one person can carry.
 */
describe("what 「不足」 counts", () => {
  // Typed rather than cast: a fixture that stops matching the model should fail here
  // rather than be waved through by `as unknown as`.
  const holder = (id: string, proficiency: SkillProficiency): Member => ({
    id, name: id, role: "Engineer", department: "D", location: "東京", capacity: 100,
    skills: ["Go"], initials: "XX", avatarTone: "mint",
    skillLevels: [{ name: "Go", proficiency }],
  });
  const requirement = (id: string, minProficiency: SkillProficiency, startDate: string, endDate: string): StaffingNeed => ({
    id, projectId: "p", role: "Engineer", skills: ["Go"],
    skillRequirements: [{ name: "Go", minProficiency }],
    startDate, endDate, allocation: 50, status: "open",
  });
  const map = (members: Member[], needs: StaffingNeed[]) =>
    buildSkillMap({ members, projects: [], assignments: [], needs }).find((row) => row.name === "Go")!;

  it("is 0 when someone can meet every requirement, however many there are", () => {
    // The case that made the old arithmetic visible: 3 − 1 = 2, for a skill the team has.
    const row = map([holder("m1", 5)], [requirement("n1", 3, "2026-09-01", "2026-09-30"),
      requirement("n2", 3, "2026-09-01", "2026-09-30"), requirement("n3", 3, "2026-09-01", "2026-09-30")]);
    expect({ openNeedCount: row.openNeedCount, memberCount: row.memberCount, gap: row.gap })
      .toEqual({ openNeedCount: 3, memberCount: 1, gap: 0 });
  });

  it("is 0 for several holders and one requirement", () => {
    const row = map([holder("m1", 5), holder("m2", 4), holder("m3", 3)], [requirement("n1", 3, "2026-09-01", "2026-09-30")]);
    expect(row.gap).toBe(0);
  });

  /**
   * Availability is not part of this number, in either direction. Two requirements in
   * periods that cannot overlap used to read 1; they read 0 now, for the same reason
   * three overlapping ones do — the team has the skill. Whether the one holder is free
   * is what the requirement's own candidate list answers.
   */
  it("ignores whether the periods overlap, because that is another screen's question", () => {
    const apart = map([holder("m1", 5)], [requirement("n1", 3, "2026-09-01", "2026-09-30"),
      requirement("n2", 3, "2026-11-01", "2026-11-30")]);
    const together = map([holder("m1", 5)], [requirement("n1", 3, "2026-09-01", "2026-09-30"),
      requirement("n2", 3, "2026-09-01", "2026-09-30")]);
    expect(apart.gap).toBe(0);
    expect(together.gap).toBe(0);
  });

  it("counts a requirement nobody is senior enough for", () => {
    const both = map([holder("m1", 2)], [requirement("n1", 4, "2026-09-01", "2026-09-30"),
      requirement("n2", 4, "2026-09-01", "2026-09-30")]);
    expect(both.gap).toBe(2);
    // And only the ones that are actually out of reach: the holder covers the 3, not the 5.
    const one = map([holder("m1", 3)], [requirement("n1", 3, "2026-09-01", "2026-09-30"),
      requirement("n2", 5, "2026-09-01", "2026-09-30")]);
    expect(one.gap).toBe(1);
  });

  it("never exceeds the number of requirements, whatever the holders look like", () => {
    for (const proficiency of [1, 2, 3, 4, 5] as SkillProficiency[]) {
      for (const holders of [[], [holder("m1", proficiency)], [holder("m1", proficiency), holder("m2", 1)]]) {
        for (const minimum of [1, 3, 5] as SkillProficiency[]) {
          const row = map(holders, [requirement("n1", minimum, "2026-09-01", "2026-09-30"),
            requirement("n2", minimum, "2026-09-01", "2026-09-30")]);
          expect(row.gap, `${holders.length} holder(s) at ${proficiency} against a minimum of ${minimum}`)
            .toBeLessThanOrEqual(row.openNeedCount);
          expect(row.gap).toBeGreaterThanOrEqual(0);
        }
      }
    }
  });

  /** A category's number is the sum of its skills', which only holds while it is a count. */
  it("adds up across a category", () => {
    const rows = buildSkillMap({
      members: [{ id: "m1", name: "m1", role: "Engineer", department: "D", location: "東京", capacity: 100,
        skills: ["Go", "Rust"], initials: "XX", avatarTone: "mint",
        skillLevels: [{ name: "Go", proficiency: 5 }, { name: "Rust", proficiency: 1 }] }],
      projects: [], assignments: [],
      needs: [requirement("n1", 3, "2026-09-01", "2026-09-30"),
        { id: "n2", projectId: "p", role: "Engineer", skills: ["Rust"],
          skillRequirements: [{ name: "Rust", minProficiency: 4 }],
          startDate: "2026-09-01", endDate: "2026-09-30", allocation: 50, status: "open" }],
    });
    const skills = rows.filter((row) => row.kind === "skill");
    const categories = rows.filter((row) => row.kind === "category");
    const total = skills.reduce((sum, row) => sum + row.gap, 0);
    expect(total).toBe(1);
    for (const category of categories) {
      const own = rows.filter((row) => row.kind === "skill" && row.path.includes(category.name));
      expect(category.gap).toBe(own.reduce((sum, row) => sum + row.gap, 0));
    }
  });
});

/**
 * #123: nothing stops two members having the same name, and two of them were
 * indistinguishable on the screens that pick people — measured with a second 「林 葵」
 * given the same role, the same primary org unit, the same location and the same
 * (unset) custom fields as the first. No member attribute is guaranteed unique, so the
 * label tries the one every member has and then falls back to the id.
 */
describe("telling two people with one name apart", () => {
  const person = (id: string, name: string, location: string): Member => ({
    id, name, role: "Engineer", department: "D", location, capacity: 100,
    skills: [], initials: "XX", avatarTone: "mint",
  });
  const label = (members: Member[], id: string) =>
    memberLabel({ members }, members.find((item) => item.id === id)!);

  it("leaves a name nobody shares alone", () => {
    const members = [person("a", "林 葵", "東京"), person("b", "佐伯 優斗", "大阪")];
    expect(label(members, "a")).toBe("林 葵");
    expect(label(members, "b")).toBe("佐伯 優斗");
  });

  /**
   * A location has to be written to count. 「林 葵（）」 names nobody, and 「東京」 against
   * 「 東京 」 is one place typed twice — the evaluator on #123 found both reading as
   * distinct places, because an unequal string was taken for an unequal location.
   */
  it("ignores a location that is blank or the same place typed twice", () => {
    const blank = [person("a", "林 葵", ""), person("b", "林 葵", "東京")];
    expect(label(blank, "a")).toBe("林 葵（#a）");
    expect(label(blank, "b")).toBe("林 葵（#b）");

    const spaced = [person("a", "林 葵", "東京"), person("b", "林 葵", " 東京 ")];
    expect(label(spaced, "a")).toBe("林 葵（#a）");

    // Written on both sides, and genuinely different: the padding is not printed.
    const padded = [person("a", "林 葵", " 東京 "), person("b", "林 葵", "大阪")];
    expect(label(padded, "a")).toBe("林 葵（東京）");
    expect(label(padded, "b")).toBe("林 葵（大阪）");
  });

  it("uses the location when that is what differs", () => {
    const members = [person("a", "林 葵", "東京"), person("b", "林 葵", "大阪")];
    expect(label(members, "a")).toBe("林 葵（東京）");
    expect(label(members, "b")).toBe("林 葵（大阪）");
    // And a third person elsewhere does not disturb them.
    const withThird = [...members, person("c", "佐伯 優斗", "東京")];
    expect(label(withThird, "c")).toBe("佐伯 優斗");
  });

  /**
   * The measured case: same name, same location. There is nothing left to say except
   * which record this is. A short id is printed whole — the seeded ids are readable
   * slugs and the tail of one is a word fragment, 「#ashi」 out of `hayashi`, which looked
   * like it meant something.
   */
  it("falls back to the id when the location matches too", () => {
    const members = [person("hayashi", "林 葵", "東京"), person("hayashi-2", "林 葵", "東京")];
    expect(label(members, "hayashi")).toBe("林 葵（#hayashi）");
    expect(label(members, "hayashi-2")).toBe("林 葵（#hayashi-2）");
  });

  /**
   * A tag that is cut off is not a tag. The name cell truncates from the end, and #163
   * gave the tag its own box so it is not the part that shrinks — but a box cannot be
   * wider than the cell, which is 122px at 375px. Measured at the cell's font,
   * 「（東京都千代田区）」 is 108px and 「（東京都千代田区丸の内A）」 is 151.9px, and two places
   * sharing a long prefix would differ only in the part that gets cut.
   */
  it("falls back to the id when a location is too long to show whole", () => {
    const long = [
      person("a", "林 葵", "東京都千代田区丸の内A"),
      person("b", "林 葵", "東京都千代田区丸の内B"),
    ];
    expect(label(long, "a")).toBe("林 葵（#a）");
    expect(label(long, "b")).toBe("林 葵（#b）");

    // Eight characters still shows whole, so it is still a tag.
    const eight = [person("a", "林 葵", "東京都千代田区"), person("b", "林 葵", "大阪市北区中之島")];
    expect(label(eight, "a")).toBe("林 葵（東京都千代田区）");
    expect(label(eight, "b")).toBe("林 葵（大阪市北区中之島）");

    // All of a group or none of it, here too: one long location sends everyone to the id.
    const mixed = [person("a", "林 葵", "東京"), person("b", "林 葵", "東京都千代田区丸の内B")];
    expect(label(mixed, "a")).toBe("林 葵（#a）");
    expect(label(mixed, "b")).toBe("林 葵（#b）");
  });

  /**
   * A UUID's tail is meaningless hex either way, so it is the one shape that gets
   * trimmed. Recognised by pattern rather than by length: a first version cut anything
   * over twelve characters, a number taken from the seed slugs, which would have turned
   * a thirteen-character slug into a fragment.
   */
  it("trims a UUID to a tail and prints anything else whole", () => {
    const members = [
      person("0f7c8a12-4b2e-4a55-9d31-aa0000004f2a", "林 葵", "東京"),
      person("0f7c8a12-4b2e-4a55-9d31-aa0000009c81", "林 葵", "東京"),
    ];
    expect(label(members, "0f7c8a12-4b2e-4a55-9d31-aa0000004f2a")).toBe("林 葵（#4f2a）");
    expect(label(members, "0f7c8a12-4b2e-4a55-9d31-aa0000009c81")).toBe("林 葵（#9c81）");
    // Thirteen characters, not a UUID: printed whole rather than cut mid-word.
    const slugs = [person("kawasaki-aoi", "林 葵", "東京"), person("kawasaki-aoi2", "林 葵", "東京")];
    expect(label(slugs, "kawasaki-aoi2")).toBe("林 葵（#kawasaki-aoi2）");
  });

  /**
   * All of a group or none of it. Choosing per person let one namesake read 「（大阪）」
   * while another read 「（#4f2a）」, and adding a third person could change an existing
   * label's kind — which the evaluator on #123 pointed out is unstable.
   */
  it("gives a whole group the same kind of suffix", () => {
    const members = [
      person("aaaa1111", "林 葵", "東京"),
      person("bbbb2222", "林 葵", "東京"),
      person("cccc3333", "林 葵", "大阪"),
    ];
    // Two of the three share 東京, so nobody in the group gets a location.
    expect(label(members, "cccc3333")).toBe("林 葵（#cccc3333）");
    expect(label(members, "aaaa1111")).toBe("林 葵（#aaaa1111）");
    expect(label(members, "bbbb2222")).toBe("林 葵（#bbbb2222）");

    // Make the locations distinct and the whole group switches together.
    const distinct = [person("a", "林 葵", "東京"), person("b", "林 葵", "大阪"), person("c", "林 葵", "福岡")];
    expect(distinct.map((item) => label(distinct, item.id)))
      .toEqual(["林 葵（東京）", "林 葵（大阪）", "林 葵（福岡）"]);
  });

  /**
   * Four characters is the starting length, not a fixed one. Ids that share a tail —
   * a fixture, a migration that appends a suffix — would otherwise print the same
   * token for two different people, which is the defect wearing a different hat.
   */
  it("lengthens the tail rather than printing the same token twice", () => {
    // Two UUIDs sharing their last five characters, which a fixture or a migration can
    // produce. Four would print the same token for both.
    const members = [
      person("0f7c8a12-4b2e-4a55-9d31-aaaaaa14f2a1", "林 葵", "東京"),
      person("0f7c8a12-4b2e-4a55-9d31-bbbbbb24f2a1", "林 葵", "東京"),
    ];
    const first = label(members, "0f7c8a12-4b2e-4a55-9d31-aaaaaa14f2a1");
    const second = label(members, "0f7c8a12-4b2e-4a55-9d31-bbbbbb24f2a1");
    expect(first).not.toBe(second);
    expect(first.startsWith("林 葵（#")).toBe(true);
    expect(first.length).toBeGreaterThan("林 葵（#f2a1）".length);
  });

  it("ignores surrounding whitespace when deciding whether a name is shared", () => {
    const members = [person("a", "林 葵", "東京"), person("b", " 林 葵 ", "大阪")];
    expect(label(members, "a")).toBe("林 葵（東京）");
  });
});

describe("custom fields and work history", () => {
  it("adds unique field definitions and rejects invalid keys or select options", () => {
    const catalog = addCustomField(initialWorkspace.customFields ?? [], {
      entityType: "member",
      key: "visa_status",
      label: "在留資格",
      fieldType: "text",
      showInList: true,
    });
    expect(catalog.at(-1)).toMatchObject({ key: "visa_status", label: "在留資格", showInDetail: true, searchable: true });
    expect(() => addCustomField(catalog, { entityType: "member", key: "visa_status", label: "別ラベル", fieldType: "text" })).toThrow("同じキー");
    expect(() => addCustomField(catalog, { entityType: "member", key: "Visa Status", label: "VISA", fieldType: "text" })).toThrow("英小文字");
    expect(() => addCustomField(catalog, { entityType: "project", key: "phase", label: "フェーズ", fieldType: "select" })).toThrow("選択肢");
  });

  it("validates required values and keeps list/search surfaces separate", () => {
    const required = (initialWorkspace.customFields ?? []).map((field) => field.id === "field-client" ? { ...field, required: true } : field);
    expect(visibleCustomFields(required, "member", "list").map((field) => field.key)).toEqual(["employment_type", "english"]);
    expect(visibleCustomFields(required, "project", "detail").some((field) => field.key === "contract_type")).toBe(true);
    expect(() => normalizeCustomValues(required, "project", {})).toThrow("顧客名は必須です");
    expect(normalizeCustomValues(required, "project", { "field-client": " 北風商事 ", "field-contract": "準委任" })).toEqual({
      "field-client": "北風商事",
      "field-contract": "準委任",
    });
  });

  it("sorts work history with current roles first and rejects inverted dates", () => {
    const history = normalizeWorkHistory([
      { id: "past", title: "開発", organization: "A社", startDate: "2018-04-01", endDate: "2020-03-31" },
      { id: "current", title: "リード", organization: "B社", startDate: "2020-04-01" },
    ]);
    expect(history.map((entry) => entry.id)).toEqual(["current", "past"]);
    expect(formatWorkHistoryPeriod(history[0])).toContain("現在");
    expect(() => normalizeWorkHistory([{ id: "bad", title: "開発", organization: "A社", startDate: "2022-01-01", endDate: "2021-12-31" }])).toThrow("終了日は開始日以降");
  });

  it("includes searchable custom values and work history in member and project search text", () => {
    const member = initialWorkspace.members[0];
    const project = initialWorkspace.projects[0];
    expect(memberSearchText(initialWorkspace, member)).toContain("ビジネス");
    expect(memberSearchText(initialWorkspace, member)).toContain("studio north");
    expect(projectSearchText(initialWorkspace, project)).toContain("atlas株式会社");
  });

  it("creates, submits, and applies profile update requests without writing members until confirmation", () => {
    const created = addProfileRequests(initialWorkspace, ["okada"], { scope: "skills", note: "QAスキルを更新" });
    expect(created.some((request) => request.personId === "okada" && request.status === "open")).toBe(true);
    expect(() => addProfileRequests({ ...initialWorkspace, profileRequests: created }, ["okada"], { scope: "all" })).toThrow("未完了");
    const submitted = submitProfileRequest(initialWorkspace, "req-nakamura-skills", { skills: "React:5, TypeScript:4, A11y:4" }, { canManage: true });
    expect(submitted.profileRequests?.find((request) => request.id === "req-nakamura-skills")?.status).toBe("submitted");
    expect(submitted.members.find((member) => member.id === "nakamura")?.skillLevels?.find((level) => level.name === "React")?.proficiency).toBe(4);
    const completed = completeProfileRequest(submitted, "req-nakamura-skills");
    expect(completed.members.find((member) => member.id === "nakamura")?.skillLevels?.find((level) => level.name === "React")?.proficiency).toBe(5);
    expect(completed.profileRequests?.find((request) => request.id === "req-nakamura-skills")?.status).toBe("done");
    const cancelled = cancelProfileRequest(initialWorkspace.profileRequests ?? [], "req-nakamura-skills");
    expect(cancelled.find((request) => request.id === "req-nakamura-skills")?.status).toBe("cancelled");
    expect(() => submitProfileRequest(initialWorkspace, "req-nakamura-skills", { skills: "React:5" }, { identity: { userId: "user-1" } })).toThrow("権限");
  });
});

describe("pre-award opportunities", () => {
  it("keeps pipeline demand out of confirmed projects and only counts active stages", () => {
    expect(pipelineDemandForWeek(initialWorkspace, "2026-09-07")).toBe(6);
    expect(pipelineDemandForWeek(initialWorkspace, "2026-08-24")).toBe(2);
    expect(pipelineDemandForWeek({
      ...initialWorkspace,
      opportunities: (initialWorkspace.opportunities ?? []).map((opportunity) => opportunity.id === "opp-ledger" ? { ...opportunity, stage: "lost" as const } : opportunity),
    }, "2026-08-24")).toBe(0);
  });

  it("converts an active opportunity into a project and open staffing needs", () => {
    const converted = convertOpportunityToProject(initialWorkspace, "opp-northwind", {
      projectId: "00000000-0000-4000-8000-000000000101",
      needIdMap: {
        "opp-need-northwind-fe": "00000000-0000-4000-8000-000000000201",
        "opp-need-northwind-be": "00000000-0000-4000-8000-000000000202",
      },
    });
    const project = converted.projects.find((item) => item.id === "00000000-0000-4000-8000-000000000101");
    const opportunity = converted.opportunities?.find((item) => item.id === "opp-northwind");
    const copiedNeeds = converted.needs.filter((need) => need.projectId === project?.id);

    expect(project).toMatchObject({ name: "北風商事 販売基盤", status: "準備中", demand: 4, startDate: "2026-09-01", endDate: "2026-12-25" });
    expect(opportunity).toMatchObject({ stage: "won", convertedProjectId: project?.id });
    expect(copiedNeeds).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: "Frontend Engineer", allocation: 60, status: "open" }),
      expect.objectContaining({ role: "Backend Engineer", allocation: 50, status: "open" }),
    ]));
    expect(converted.assignments).toEqual(initialWorkspace.assignments);
    expect(canConvertOpportunity(opportunity!)).toBe(false);
    expect(() => convertOpportunityToProject(converted, "opp-northwind")).toThrow("受注できる段階ではありません");
    expect(() => convertOpportunityToProject({
      ...initialWorkspace,
      opportunities: (initialWorkspace.opportunities ?? []).map((item) => item.id === "opp-harbor" ? { ...item, stage: "lost" as const } : item),
    }, "opp-harbor")).toThrow("受注できる段階ではありません");
  });

  it("matches pipeline staffing plans with the same skill and availability rules as project needs", () => {
    const plan = (initialWorkspace.opportunityNeeds ?? []).find((need) => need.id === "opp-need-harbor-mobile")!;
    expect(memberMatchesNeed(initialWorkspace.members.find((member) => member.id === "takahashi")!, plan)).toBe(true);
    expect(memberMatchesNeed(initialWorkspace.members.find((member) => member.id === "nakamura")!, plan)).toBe(false);
  });
});

describe("organization units", () => {
  it("exposes hierarchy paths, concurrent posts, and descendant members", () => {
    expect(orgUnitPath(initialWorkspace.orgUnits, "org-product")).toEqual(["開発本部", "プロダクト開発"]);
    expect(membersInOrgSubtree(initialWorkspace, "org-product", "primary").map((member) => member.id).sort()).toEqual(["nakamura", "takahashi"]);
    expect(membersInOrgSubtree(initialWorkspace, "org-product").map((member) => member.id).sort()).toEqual(["nakamura", "saeki", "takahashi"]);
    expect(membersInOrgSubtree(initialWorkspace, "org-engineering", "primary").some((member) => member.id === "suzuki")).toBe(true);
    expect(orgManagers(initialWorkspace, "org-design").map((member) => member.id)).toEqual(["saeki"]);
    expect(memberSearchText(initialWorkspace, initialWorkspace.members[0])).toContain("デザイン本部");
    expect(memberSearchText(initialWorkspace, initialWorkspace.members[0])).toContain("プロダクト開発");
  });

  it("rejects cycles, keeps one primary affiliation, and blocks unsafe archives", () => {
    expect(() => moveOrgUnit(initialWorkspace.orgUnits ?? [], "org-engineering", "org-product")).toThrow("自分の配下");
    expect(() => archiveOrgUnit(initialWorkspace, "org-product")).toThrow("所属メンバー");
    expect(() => archiveOrgUnit(initialWorkspace, "org-engineering")).toThrow("配下の部門");
    const added = addOrgUnit(initialWorkspace.orgUnits ?? [], { name: "新規チーム", parentId: "org-product", id: "org-new" });
    expect(added.some((unit) => unit.id === "org-new")).toBe(true);
    expect(() => addOrgUnit(added, { name: "プロダクト開発", parentId: "org-engineering" })).toThrow("同じ名前");
    const emptied = {
      ...initialWorkspace,
      orgMemberships: (initialWorkspace.orgMemberships ?? []).filter((item) => item.orgUnitId !== "org-data"),
    };
    expect(archiveOrgUnit(emptied, "org-data").orgUnits?.some((unit) => unit.id === "org-data")).toBe(false);
  });

  /**
   * The org table used to render a delete button on every row and let
   * archiveOrgUnit reject it, in an error slot 618px above the button. Nine of
   * nine rows were in that state. The view now asks this before offering the
   * control, so the two have to agree — a blocker here and a throw there, or
   * neither (#86).
   */
  it("gives the same verdict for offering an archive as for performing it", () => {
    // Literal expectations, not `toThrow(blocker.reason)`: taking the expected
    // string from the same helper under test would pass if both returned the
    // same wrong reason.
    const cases = [
      { id: "org-engineering", short: "配下に部門あり", reason: "配下の部門を先に移すか削除してください" },
      { id: "org-product", short: "所属メンバーあり", reason: "所属メンバーを先に別部門へ移してください" },
      { id: "org-missing", short: "見つかりません", reason: "部門が見つかりません" },
    ];
    for (const { id, short, reason } of cases) {
      expect(orgUnitArchiveBlocker(initialWorkspace, id)).toEqual({ short, reason });
      expect(() => archiveOrgUnit(initialWorkspace, id)).toThrow(reason);
    }

    const emptied = {
      ...initialWorkspace,
      orgMemberships: (initialWorkspace.orgMemberships ?? []).filter((item) => item.orgUnitId !== "org-data"),
    };
    expect(orgUnitArchiveBlocker(emptied, "org-data")).toBeNull();
    expect(() => archiveOrgUnit(emptied, "org-data")).not.toThrow();

    // Every unit in the shipped data is blocked, which is the fact that made
    // this a bug rather than a style preference. Not a domain invariant — a
    // fixture contract. If a deliberately empty department is ever added to the
    // demo data this fails, and the right response is to update it here.
    const unblocked = (initialWorkspace.orgUnits ?? []).filter((unit) => orgUnitArchiveBlocker(initialWorkspace, unit.id) === null);
    expect(unblocked).toEqual([]);
  });

  it("syncs department from the primary unit and reports subtree utilization", () => {
    const moved = setMemberOrgMemberships(initialWorkspace, "saeki", {
      primaryUnitId: "org-product",
      extraUnitIds: ["org-design"],
      managerUnitIds: ["org-product"],
    });
    expect(moved.members.find((member) => member.id === "saeki")?.department).toBe("プロダクト開発");
    expect(moved.orgMemberships?.filter((item) => item.personId === "saeki")).toEqual(expect.arrayContaining([
      expect.objectContaining({ orgUnitId: "org-product", isPrimary: true, isManager: true }),
      expect.objectContaining({ orgUnitId: "org-design", isPrimary: false, isManager: false }),
    ]));
    const rows = orgUnitLoadRows(initialWorkspace, "2026-08-17");
    expect(rows.find((row) => row.id === "org-engineering")?.count).toBe(5);
    expect(rows.find((row) => row.id === "org-design")?.managers).toEqual(["佐伯 優斗"]);
  });
});

describe("saved reports", () => {
  it("groups members by department count and roles by weekly load", () => {
    const department = (initialWorkspace.savedReports ?? []).find((report) => report.id === "report-dept-count");
    const roleLoad = (initialWorkspace.savedReports ?? []).find((report) => report.id === "report-role-load");
    expect(department).toBeDefined();
    expect(roleLoad).toBeDefined();
    const rows = buildSavedReport(initialWorkspace, department!, "2026-08-17");
    expect(rows.find((row) => row.label === "デザイン")).toMatchObject({ count: 2, value: 2 });
    const frontend = buildSavedReport(initialWorkspace, roleLoad!, "2026-08-17").find((row) => row.label === "Frontend Engineer");
    expect(frontend).toMatchObject({ count: 1, value: 100 });
  });

  it("groups projects by status as counts and rejects invalid combinations", () => {
    const rows = buildSavedReport(initialWorkspace, { id: "x", name: "状態別", source: "projects", groupBy: "status", metric: "count" }, "2026-08-17");
    expect(rows.find((row) => row.label === "進行中")?.count).toBe(4);
    expect(() => addSavedReport([], { name: "不正", source: "projects", groupBy: "department", metric: "count" })).toThrow("グループ");
    const reports = addSavedReport(initialWorkspace.savedReports ?? [], { name: "勤務地別人数", source: "members", groupBy: "location", metric: "count" });
    expect(reports.at(-1)).toMatchObject({ name: "勤務地別人数", groupBy: "location" });
  });
});

describe("search scenes", () => {
  it("scores must/nice skills and availability, and excludes failed musts", () => {
    const frontend = (initialWorkspace.searchScenes ?? []).find((scene) => scene.id === "scene-frontend");
    expect(frontend).toBeDefined();
    const matches = matchMembers(initialWorkspace, frontend!);
    expect(matches.map((match) => match.member.name)).toEqual(["中村 美咲"]);
    expect(matches[0]).toMatchObject({ score: 60, availablePercent: 100, matchedMust: ["React"], matchedNice: ["A11y"] });
  });

  it("converts staffing needs into must-skill scenes and ranks remaining capacity", () => {
    const need = initialWorkspace.needs[0];
    const matches = matchMembers(initialWorkspace, searchSceneFromNeed(need));
    expect(matches.map((match) => match.member.name)).toEqual(["松本 蓮"]);
    expect(matches[0].score).toBe(24);
    expect(matches[0].availablePercent).toBe(60);
  });

  it("adds uniquely named scenes and rejects duplicates", () => {
    const scenes = addSearchScene(initialWorkspace.searchScenes ?? [], {
      name: "大阪バックエンド",
      role: "Backend Engineer",
      location: "大阪",
    });
    expect(scenes.at(-1)).toMatchObject({ name: "大阪バックエンド", role: "Backend Engineer", location: "大阪" });
    expect(() => addSearchScene(scenes, { name: "大阪バックエンド", role: "Backend Engineer" })).toThrow("同じ名前");
  });
});

describe("role permissions", () => {
  const customFields = initialWorkspace.customFields ?? [];

  it("normalizes, sorts, and keeps one row per role", () => {
    const first = setRolePermission([], customFields, {
      role: "planner",
      personScope: "unit_subtree",
      hiddenFieldKeys: [" english ", "english", "joined_on"],
      disabledFeatures: ["favorites", "favorites"],
    });
    expect(first).toEqual([{
      role: "planner",
      personScope: "unit_subtree",
      hiddenFieldKeys: ["english", "joined_on"],
      readonlyFieldKeys: [],
      disabledFeatures: ["favorites"],
    }]);
    const replaced = setRolePermission(first, customFields, { role: "planner", personScope: "self" });
    expect(replaced).toHaveLength(1);
    expect(replaced[0]).toMatchObject({ personScope: "self", hiddenFieldKeys: [], disabledFeatures: [] });
    const both = setRolePermission(replaced, customFields, { role: "admin", personScope: "organization" });
    expect(both.map((permission) => permission.role)).toEqual(["admin", "planner"]);
  });

  it("refuses unknown field keys, unknown features, and hidden/read-only overlap", () => {
    expect(() => setRolePermission([], customFields, { role: "viewer", hiddenFieldKeys: ["nope"] })).toThrow("見つかりません");
    expect(() => setRolePermission([], customFields, { role: "viewer", disabledFeatures: ["aiChat"] })).toThrow("対象ではありません");
    expect(setRolePermission([], customFields, { role: "viewer", disabledFeatures: ["externalMcp"] })[0].disabledFeatures).toEqual(["externalMcp"]);
    expect(() => setRolePermission([], customFields, {
      role: "viewer",
      hiddenFieldKeys: ["english"],
      readonlyFieldKeys: ["english"],
    })).toThrow("両方");
    expect(() => setRolePermission([], customFields, { role: "viewer", personScope: "team" as never })).toThrow("参照範囲");
  });

  it("keeps read-only fields out of the editors but leaves them readable", () => {
    const marked = customFields.map((field) => field.key === "english" ? { ...field, canEdit: false } : field);
    expect(visibleCustomFields(marked, "member", "detail").map((field) => field.key)).toContain("english");
    expect(editableCustomFields(marked, "member", "detail").map((field) => field.key)).not.toContain("english");
  });
});

/**
 * #123, second finding: projects and opportunities carry a denormalised `ownerName`
 * beside `ownerPersonId`, and the seeded projects carry only the name. Three places
 * resolved it with `members.find(member => member.name === ownerName)`, which answers
 * with whoever comes first — so with two namesakes, opening a project's edit form bound
 * it to one of them, renaming a member rewrote the other's projects too, and the archive
 * guard counted projects that were not theirs.
 */
describe("whom an owner name names", () => {
  const person = (id: string, name: string): Member => ({
    id, name, role: "Engineer", department: "D", location: "東京", capacity: 100,
    skills: [], initials: "XX", avatarTone: "mint",
  });
  const state = (...members: Member[]) => ({ ...initialWorkspace, members });

  it("answers with the member the id names", () => {
    const one = person("a", "林 葵");
    expect(ownerMember(state(one, person("b", "佐伯 優斗")), { ownerPersonId: "a", ownerName: "佐伯 優斗" })?.id)
      .toBe("a");
    // The id wins over a stale name, which is the point of storing it.
    expect(ownerLabel(state(one, person("b", "佐伯 優斗")), { ownerPersonId: "a", ownerName: "佐伯 優斗" }))
      .toBe("林 葵");
  });

  it("answers with the one person a name fits", () => {
    const members = state(person("a", "林 葵"), person("b", "佐伯 優斗"));
    expect(ownerMember(members, { ownerName: "林 葵" })?.id).toBe("a");
    // Padding in the stored string is not a different person.
    expect(ownerMember(members, { ownerName: " 林 葵 " })?.id).toBe("a");
  });

  it("refuses to guess when two people share the name", () => {
    const members = state(person("a", "林 葵"), person("b", "林 葵"));
    expect(ownerMember(members, { ownerName: "林 葵" })).toBeUndefined();
    // The record still says a name, so that is what the screen prints. It is not
    // labelled, because a label would claim to know which of them it is.
    expect(ownerLabel(members, { ownerName: "林 葵" })).toBe("林 葵");
  });

  it("has no answer for an owner nobody recorded", () => {
    const members = state(person("a", "林 葵"));
    expect(ownerMember(members, {})).toBeUndefined();
    expect(ownerMember(members, { ownerName: "  " })).toBeUndefined();
    expect(ownerMember(members, { ownerName: "退職 済み" })).toBeUndefined();
    expect(ownerLabel(members, {})).toBeNull();
    // A name that is nobody's now still gets printed: the row records what it records.
    expect(ownerLabel(members, { ownerName: "退職 済み" })).toBe("退職 済み");
  });

  it("labels an owner whose name two people share, once the id says which", () => {
    const members = state(person("a", "林 葵"), person("b", "林 葵"));
    expect(ownerLabel(members, { ownerPersonId: "b", ownerName: "林 葵" })).toBe("林 葵（#b）");
  });
});
