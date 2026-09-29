import { describe, expect, it } from "vitest";
import {
  buildSavedReport,
  initialWorkspace,
  PERIOD_ALL,
  PERIOD_CHOICES,
  periodRange,
  planningSpan,
  type Assignment,
  type Member,
  type PeriodRange,
  type SavedReport,
  type WorkspaceState,
} from "./domain";
// @ts-expect-error -- The Edge Function module is plain JavaScript with no declarations, and tsconfig does not allow JS.
import { readWorkspaceTool } from "../supabase/functions/chat/workspace-tools.mjs";

/**
 * The same workspace and the same period, through the screen's `buildSavedReport` and
 * through the AI assistant's `read_workspace` (#495). The assistant used to divide each
 * member's peak by the nominal ceiling, so a group could read 39% in chat and 27% on the
 * reports screen.
 */

const organizationId = "20000000-0000-4000-8000-000000000001";

const reports: SavedReport[] = [
  { id: "67000000-0000-4000-8000-000000000001", name: "部署別稼働", source: "members", groupBy: "department", metric: "avgLoad" },
  { id: "67000000-0000-4000-8000-000000000002", name: "職種別稼働", source: "members", groupBy: "role", metric: "avgLoad" },
  { id: "67000000-0000-4000-8000-000000000003", name: "勤務地別稼働", source: "members", groupBy: "location", metric: "avgLoad" },
  { id: "67000000-0000-4000-8000-000000000004", name: "部署別人数", source: "members", groupBy: "department", metric: "count" },
  { id: "67000000-0000-4000-8000-000000000005", name: "状態別", source: "projects", groupBy: "status", metric: "count" },
];

type Row = { label: string; count: number; value: number };

function screenRows(state: WorkspaceState, report: SavedReport, range: PeriodRange): Row[] {
  return buildSavedReport(state, report, range).map(({ label, count, value }) => ({ label, count, value }));
}

function assistantRows(state: WorkspaceState, report: SavedReport, startDate: string, endDate: string): Row[] {
  const result = readWorkspaceTool(
    { organizationId, revision: 1, ...state, savedReports: [report] },
    "read_workspace",
    { resource: "saved_reports", reportId: report.id, startDate, endDate },
  );
  return result.items[0].rows;
}

/** The whole span as one bucket, so a range does not have to start on a week or a month. */
function span(from: string, to: string): PeriodRange {
  return { from, to, buckets: [{ from, to }], clipped: false };
}

function person(id: string, capacity: number, extra: Partial<Member> = {}): Member {
  return {
    id,
    initials: id.slice(0, 2),
    name: id,
    role: "検証",
    department: id,
    avatarTone: "lavender",
    skills: [],
    location: "東京",
    capacity,
    ...extra,
  };
}

function booking(id: string, personId: string, startDate: string, endDate: string, allocation: number, extra: Partial<Assignment> = {}): Assignment {
  return { id, personId, projectId: "project", startDate, endDate, allocation, status: "confirmed", ...extra };
}

function workspace(members: Member[], assignments: Assignment[]): WorkspaceState {
  return { members, projects: [], assignments, needs: [] };
}

describe("a saved report's average reads the same on the screen and in the AI assistant (#495)", () => {
  it("matches on the demo workspace for every period the reports screen offers", () => {
    const origin = "2026-08-19";
    let loaded = 0;
    for (const choice of PERIOD_CHOICES) {
      const range = periodRange(choice, origin, planningSpan(initialWorkspace));
      for (const report of reports) {
        const screen = screenRows(initialWorkspace, report, range);
        expect(assistantRows(initialWorkspace, report, range.from, range.to), `${JSON.stringify(choice)} ${report.name}`).toEqual(screen);
        if (report.metric === "avgLoad") loaded += screen.filter((row) => row.value > 0).length;
      }
    }
    expect(loaded).toBeGreaterThan(0);
  });

  it("fixes the definition on a hand-counted group", () => {
    // 2026-09-16 (Wed) to 09-29 (Tue). 09-21, 22 and 23 are holidays, so 7 weekdays remain:
    // 16, 17, 18, 24, 25, 28, 29.
    // A (100%): 40% over 09-10..09-24 and 30% over 09-18..10-10 → 40+40+70+70+30+30+30 = 310.
    //   Saturday 09-19 is recorded twice on the 30% assignment and counts once → 340. The
    //   recorded Thursday 09-17 is a weekday and is not counted again. Ceiling 7 × 100 = 700.
    // B (80%), nothing assigned: load 0, ceiling 7 × 80 = 560.
    // 340 / 1260 = 26.98% → 27. Peak ÷ nominal ceiling was (70 + 0) / 180 → 39.
    const state = workspace(
      [person("A", 100, { department: "手計算" }), person("B", 80, { department: "手計算" })],
      [
        booking("x", "A", "2026-09-10", "2026-09-24", 40, { weekendWorkDates: ["2026-09-17"] }),
        booking("y", "A", "2026-09-18", "2026-10-10", 30, { weekendWorkDates: ["2026-09-19", "2026-09-19"] }),
      ],
    );
    const range = span("2026-09-16", "2026-09-29");
    const expected = [{ label: "手計算", count: 2, value: 27 }];
    expect(screenRows(state, reports[0], range)).toEqual(expected);
    expect(assistantRows(state, reports[0], range.from, range.to)).toEqual(expected);
  });

  it("matches on leaves, weekend work, a zero ceiling and ranges that cut assignments", () => {
    const state = workspace(
      [
        // 50% leave alone: the ceiling drops, the load stays as assigned.
        person("C", 100, { unavailability: [{ id: "c1", startDate: "2026-09-24", endDate: "2026-09-25", capacityPercent: 50 }] }),
        // A 0% leave takes the weekdays, but a Saturday and Sunday inside it that were recorded still carry load.
        person("D", 100, { unavailability: [{ id: "d1", startDate: "2026-09-26", endDate: "2026-09-28", capacityPercent: 0 }] }),
        // No weekday ceiling at all, but a recorded Saturday.
        person("E", 0, { role: "兼務" }),
        // 50% over the whole span on an 80% person, and a one-day 0% inside it: 50, not 40, and 0 on the 17th.
        person("F", 80, {
          role: "兼務",
          unavailability: [
            { id: "f1", startDate: "2026-09-16", endDate: "2026-09-30", capacityPercent: 50 },
            { id: "f2", startDate: "2026-09-17", endDate: "2026-09-17", capacityPercent: 0 },
          ],
        }),
        // A leave ending on a day that does not exist stops where the string comparison stops (02-28),
        // not where `Date.parse` rolls it (03-02). 02-29 is recorded but is not a day in 2026.
        person("G", 100, { location: "大阪", unavailability: [{ id: "g1", startDate: "2026-02-25", endDate: "2026-02-30", capacityPercent: 20 }] }),
        person("H", 60, { location: "大阪" }),
      ],
      [
        booking("c", "C", "2026-09-01", "2026-10-31", 60, { status: "draft" }),
        booking("d", "D", "2026-09-16", "2026-09-29", 50, { weekendWorkDates: ["2026-09-26", "2026-09-27"] }),
        booking("e", "E", "2026-09-14", "2026-09-30", 20, { weekendWorkDates: ["2026-09-19"] }),
        booking("f", "F", "2026-09-16", "2026-09-30", 40),
        booking("g", "G", "2026-02-01", "2026-03-31", 30, { weekendWorkDates: ["2026-02-28", "2026-02-29", "2026-03-01"] }),
        booking("h", "H", "2026-03-02", "2026-03-02", 100),
      ],
    );
    const ranges = [
      span("2026-09-16", "2026-09-29"),
      span("2026-09-01", "2026-10-31"),
      span("2026-09-17", "2026-09-17"),
      span("2026-02-20", "2026-03-06"),
      span("2026-03-02", "2026-03-02"),
      periodRange({ unit: "month", count: 1 }, "2026-09-10"),
      periodRange({ unit: "week", count: 4 }, "2026-02-18"),
      periodRange(PERIOD_ALL, "2026-02-18", planningSpan(state)),
    ];
    for (const range of ranges) {
      for (const report of reports) {
        expect(assistantRows(state, report, range.from, range.to), `${range.from}..${range.to} ${report.name}`)
          .toEqual(screenRows(state, report, range));
      }
    }
  });

  it("clips a period outside the holiday calendar the way the screen's 「全て」 does", () => {
    const state = workspace(
      [person("L", 100)],
      [booking("l", "L", "2012-01-01", "2039-12-31", 40), booking("m", "L", "2030-04-01", "2030-06-30", 30)],
    );
    const planned = planningSpan(state)!;
    const range = periodRange(PERIOD_ALL, "2026-08-19", planned);
    expect([range.from, range.to]).toEqual(["2016-01-01", "2035-12-31"]);
    expect(assistantRows(state, reports[0], planned.from, planned.to)).toEqual(screenRows(state, reports[0], range));
  });
});
