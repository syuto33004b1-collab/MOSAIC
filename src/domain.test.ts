import { describe, expect, it } from "vitest";
import { assignmentGrid, createProjectCode, getCurrentWeekStart, getIsoWeekNumber, getWeekStartForDate, memberDailyLoads, memberLoad, memberPeakLoad, type WorkspaceState } from "./domain";

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
