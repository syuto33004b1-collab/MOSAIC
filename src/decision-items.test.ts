import { describe, expect, it } from "vitest";
import {
  DISPLAY_PERIOD,
  decisionItems,
  idleCostYenOver,
  initialWorkspace,
  memberAvailablePercent,
  memberMatchesNeed,
  periodIdleCostYen,
  periodMemberStats,
  periodRange,
  planningSpan,
  type Assignment,
  type DecisionItem,
  type Member,
  type Opportunity,
  type OpportunityNeed,
  type PeriodRange,
  type Project,
  type StaffingNeed,
  type WorkspaceState,
} from "./domain";

const TODAY = "2026-08-19";

function person(id: string, extra: Partial<Member> = {}): Member {
  return { id, initials: id.slice(0, 2).toUpperCase(), name: `メンバー ${id}`, role: "QA Engineer", department: "QA", avatarTone: "mint", skills: [], location: "Tokyo", capacity: 100, ...extra };
}

function work(id: string, personId: string, startDate: string, endDate: string, allocation: number, extra: Partial<Assignment> = {}): Assignment {
  return { id, personId, projectId: "p", startDate, endDate, allocation, status: "confirmed", ...extra };
}

function state(parts: Partial<WorkspaceState>): WorkspaceState {
  return { ...initialWorkspace, members: [], assignments: [], needs: [], projects: [], opportunities: [], opportunityNeeds: [], ...parts };
}

/** Sixteen whole weeks, Monday 3 August to Sunday 22 November 2026. */
const SIXTEEN_WEEKS: PeriodRange = { from: "2026-08-03", to: "2026-11-22", buckets: [], clipped: false };
const kinds = (items: DecisionItem[]) => items.map((item) => item.key);

describe("decision items: 上限超過 (#524)", () => {
  it("counts weeks with a day over the ceiling, weekend records included, and keeps the day it began", () => {
    const items = decisionItems(state({
      members: [person("a"), person("b")],
      assignments: [
        // Tuesday 1 September: the Monday of that week is 31 August, a month earlier.
        work("a1", "a", "2026-09-01", "2026-09-01", 120),
        work("a2", "a", "2026-09-14", "2026-09-15", 120),
        work("b1", "b", "2026-08-29", "2026-08-29", 120, { weekendWorkDates: ["2026-08-29"] }),
      ],
    }), { range: SIXTEEN_WEEKS, today: TODAY, idleWeeks: 99 });
    const over = items.filter((item) => item.kind === "overload");
    expect(over.map((item) => [item.member.id, item.weeks, item.firstExceedDate])).toEqual([
      ["a", 2, "2026-09-01"],
      ["b", 1, "2026-08-29"],
    ]);
  });

  it("does not count a holiday or a 0% leave, and does count a 50% leave", () => {
    const items = decisionItems(state({
      members: [
        person("holiday"),
        person("off", { unavailability: [{ id: "u", startDate: "2026-10-05", endDate: "2026-10-09", capacityPercent: 0 }] }),
        person("half", { unavailability: [{ id: "u", startDate: "2026-10-05", endDate: "2026-10-09", capacityPercent: 50 }] }),
      ],
      assignments: [
        // 21–23 September 2026 are 敬老の日, 国民の休日 and 秋分の日.
        work("h", "holiday", "2026-09-21", "2026-09-23", 120),
        work("o", "off", "2026-10-05", "2026-10-09", 120),
        work("f", "half", "2026-10-05", "2026-10-09", 60),
      ],
    }), { range: SIXTEEN_WEEKS, today: TODAY, idleWeeks: 99 });
    expect(items.filter((item) => item.kind === "overload").map((item) => item.key)).toEqual(["overload:half"]);
  });

  it("lists exactly the people periodMemberStats says exceed", () => {
    const range = periodRange(DISPLAY_PERIOD, TODAY, planningSpan(initialWorkspace));
    const listed = decisionItems(initialWorkspace, { range, today: TODAY })
      .filter((item) => item.kind === "overload")
      .map((item) => item.member.id)
      .sort();
    const exceeding = initialWorkspace.members.filter((member) => periodMemberStats(initialWorkspace, member, range).exceeds).map((member) => member.id).sort();
    expect(listed.length).toBeGreaterThan(0);
    expect(listed).toEqual(exceeding);
  });

  it("orders by weeks over, then by name", () => {
    const items = decisionItems(state({
      members: [person("b"), person("a"), person("c")],
      assignments: [
        work("b1", "b", "2026-08-03", "2026-08-03", 120),
        work("a1", "a", "2026-08-03", "2026-08-03", 120),
        work("c1", "c", "2026-08-03", "2026-08-03", 120),
        work("c2", "c", "2026-08-10", "2026-08-10", 120),
      ],
    }), { range: SIXTEEN_WEEKS, today: TODAY, idleWeeks: 99 });
    expect(items.filter((item) => item.kind === "overload").map((item) => item.member.id)).toEqual(["c", "a", "b"]);
  });
});

describe("decision items: 遊休 (#482, #486)", () => {
  it("lists a member with sixteen weeks under 20%, and not with fifteen", () => {
    const idle = (assignments: Assignment[], members = [person("a")]) => decisionItems(state({ members, assignments }), { range: SIXTEEN_WEEKS, today: TODAY })
      .filter((item) => item.kind === "idle");
    expect(idle([]).map((item) => [item.member.id, item.weeks])).toEqual([["a", 16]]);
    expect(idle([work("busy", "a", "2026-08-03", "2026-08-07", 100)])).toEqual([]);
  });

  it("does not call exactly 20% idle, and does call 19%", () => {
    const idleAt = (allocation: number) => decisionItems(state({ members: [person("a")], assignments: [work("w", "a", "2026-08-03", "2026-11-22", allocation)] }), { range: SIXTEEN_WEEKS, today: TODAY })
      .filter((item) => item.kind === "idle").length;
    expect(idleAt(20)).toBe(0);
    expect(idleAt(19)).toBe(1);
    // The threshold is a whole number, compared without floating point.
    const at = (allocation: number, idleBelowPercent: number) => decisionItems(state({ members: [person("a")], assignments: [work("w", "a", "2026-08-03", "2026-11-22", allocation)] }), { range: SIXTEEN_WEEKS, today: TODAY, idleBelowPercent })
      .filter((item) => item.kind === "idle").length;
    expect(at(30, 30)).toBe(0);
    expect(at(29, 30)).toBe(1);
  });

  it("skips a week with no ceiling at all, and leaves a recorded weekend out of the share", () => {
    const leave = person("a", { unavailability: [{ id: "u", startDate: "2026-08-03", endDate: "2026-08-07", capacityPercent: 0 }] });
    const weeksOf = (members: Member[], assignments: Assignment[] = []) => decisionItems(state({ members, assignments }), { range: SIXTEEN_WEEKS, today: TODAY, idleWeeks: 1 })
      .filter((item) => item.kind === "idle")
      .map((item) => item.weeks);
    expect(weeksOf([leave])).toEqual([15]);
    const saturdays = Array.from({ length: 16 }, (_, index) => {
      const date = new Date(Date.UTC(2026, 7, 8 + index * 7)).toISOString().slice(0, 10);
      return work(`s${index}`, "b", date, date, 100, { weekendWorkDates: [date] });
    });
    expect(weeksOf([person("b")], saturdays)).toEqual([16]);
    expect(weeksOf([person("zero", { capacity: 0 })])).toEqual([]);
  });

  it("orders idle people by weeks, not by what they cost", () => {
    const cheap = person("cheap", { monthlyCost: 100_000 });
    const dear = person("dear", { monthlyCost: 900_000 });
    const items = decisionItems(state({
      members: [dear, cheap],
      assignments: [work("d", "dear", "2026-08-03", "2026-08-07", 100)],
    }), { range: SIXTEEN_WEEKS, today: TODAY, idleWeeks: 15 });
    const idle = items.filter((item) => item.kind === "idle");
    expect(idle.map((item) => [item.member.id, item.weeks])).toEqual([["cheap", 16], ["dear", 15]]);
    // The item carries the idle weeks and no money of its own.
    expect(idle[1].spans).toHaveLength(15);
    expect(idle[1].spans[0]).toEqual({ from: "2026-08-10", to: "2026-08-16" });
    expect(Object.keys(idle[1]).sort()).toEqual(["key", "kind", "member", "spans", "weeks"]);
  });

  it("can put the same person under both 上限超過 and 遊休, with distinct keys", () => {
    const items = decisionItems(state({ members: [person("a")], assignments: [work("over", "a", "2026-08-03", "2026-08-03", 120)] }), { range: SIXTEEN_WEEKS, today: TODAY, idleWeeks: 15 });
    expect(kinds(items)).toEqual(["overload:a", "idle:a"]);
  });
});

describe("decision items: 未充足, 節目超過, 受注前の影響 (#524)", () => {
  const need = (id: string, startDate: string, endDate: string, status: StaffingNeed["status"] = "open"): StaffingNeed => ({ id, projectId: "p", role: "QA Engineer", skills: [], startDate, endDate, allocation: 40, status });

  it("counts open needs that have not ended and fall in the range, the started ones first and nearest first", () => {
    const items = decisionItems(state({
      needs: [
        need("future-late", "2026-10-01", "2026-10-30"),
        need("past-old", "2026-08-03", "2026-09-30"),
        need("future-soon", "2026-08-24", "2026-09-30"),
        need("past-recent", "2026-08-17", "2026-09-30"),
        need("planned", "2026-08-24", "2026-09-30", "planned"),
        need("filled", "2026-08-24", "2026-09-30", "filled"),
        need("ended", "2026-08-03", "2026-08-18"),
        need("outside", "2026-12-01", "2026-12-31"),
      ],
    }), { range: SIXTEEN_WEEKS, today: TODAY });
    const unstaffed = items.filter((item) => item.kind === "unstaffed");
    expect(unstaffed.map((item) => [item.need.id, item.startPassed])).toEqual([
      ["past-recent", true],
      ["past-old", true],
      ["future-soon", false],
      ["future-late", false],
    ]);
  });

  it("counts overdue milestones on projects not 完了, the most overdue first, whatever the range", () => {
    const project = (id: string, nextMilestoneDate: string | null, status: Project["status"] = "進行中"): Project => ({ ...initialWorkspace.projects[0], id, name: `案件 ${id}`, status, nextMilestoneDate });
    const items = decisionItems(state({
      projects: [
        project("week", "2026-08-12"),
        project("year", "2025-08-19"),
        project("done", "2026-08-01", "完了"),
        project("today", TODAY),
        project("none", null),
      ],
    }), { range: SIXTEEN_WEEKS, today: TODAY });
    expect(items.map((item) => item.kind === "milestone" ? [item.project.id, item.overdueDays] : null)).toEqual([["year", 365], ["week", 7]]);
  });

  it("lists pre-award plans nobody has room for, as the opportunity's own candidate list would", () => {
    const opportunity = (id: string, extra: Partial<Opportunity> = {}): Opportunity => ({ ...initialWorkspace.opportunities![0], id, stage: "proposal", convertedProjectId: null, ...extra });
    const plan = (id: string, opportunityId: string, startDate = "2026-09-07", endDate = "2026-10-30"): OpportunityNeed => ({ id, opportunityId, role: "QA Engineer", skills: [], startDate, endDate, allocation: 50 });
    const busy = person("busy");
    const workspace = state({
      members: [busy],
      assignments: [work("w", "busy", "2026-08-03", "2026-12-31", 80)],
      opportunities: [opportunity("open"), opportunity("won", { stage: "won" }), opportunity("converted", { convertedProjectId: "p" })],
      opportunityNeeds: [
        plan("no-room", "open"),
        plan("won", "won"),
        plan("converted", "converted"),
        plan("ended", "open", "2026-08-03", "2026-08-18"),
        plan("outside", "open", "2027-01-04", "2027-01-29"),
      ],
    });
    const items = decisionItems(workspace, { range: SIXTEEN_WEEKS, today: TODAY });
    expect(items.filter((item) => item.kind === "pipeline").map((item) => item.need.id)).toEqual(["no-room"]);
    expect(memberMatchesNeed(busy, plan("no-room", "open")) && memberAvailablePercent(workspace, busy, "2026-09-07", "2026-10-30") >= 50).toBe(false);

    // Free the person and the plan has a candidate, so it stops being a decision.
    const free = { ...workspace, assignments: [] };
    expect(decisionItems(free, { range: SIXTEEN_WEEKS, today: TODAY }).filter((item) => item.kind === "pipeline")).toEqual([]);
  });

  it("orders the kinds as the owner fixed, and keeps only milestones without a range", () => {
    const workspace = state({
      members: [person("a")],
      assignments: [work("over", "a", "2026-08-03", "2026-08-03", 120)],
      needs: [need("n", "2026-08-24", "2026-09-30")],
      projects: [{ ...initialWorkspace.projects[0], id: "m", status: "進行中", nextMilestoneDate: "2026-08-01" }],
      opportunities: [{ ...initialWorkspace.opportunities![0], id: "o", stage: "proposal", convertedProjectId: null }],
      opportunityNeeds: [{ id: "plan", opportunityId: "o", role: "Nobody", skills: [], startDate: "2026-09-07", endDate: "2026-10-30", allocation: 50 }],
    });
    expect(kinds(decisionItems(workspace, { range: SIXTEEN_WEEKS, today: TODAY, idleWeeks: 15 }))).toEqual([
      "unstaffed:n", "overload:a", "idle:a", "milestone:m", "pipeline:plan",
    ]);
    const empty: PeriodRange = { from: "", to: "", buckets: [], clipped: true };
    expect(kinds(decisionItems(workspace, { range: empty, today: TODAY }))).toEqual(["milestone:m"]);
  });
});

describe("idle cost over the idle weeks (#486)", () => {
  const member = person("a", { monthlyCost: 600_000 });
  const workspace = state({ members: [member] });

  it("matches the one-span figure, and rounds once over many spans", () => {
    expect(idleCostYenOver(workspace, member, [{ from: "2026-08-01", to: "2026-08-31" }])).toBe(periodIdleCostYen(workspace, member, "2026-08-01", "2026-08-31"));
    // Two halves of August are the same month of cost as August whole.
    expect(idleCostYenOver(workspace, member, [{ from: "2026-08-01", to: "2026-08-15" }, { from: "2026-08-16", to: "2026-08-31" }])).toBe(600_000);
  });

  it("is null when the cost is hidden or unset", () => {
    expect(idleCostYenOver(workspace, { ...member, monthlyCost: undefined }, [{ from: "2026-08-01", to: "2026-08-31" }])).toBeNull();
    expect(idleCostYenOver(workspace, { ...member, monthlyCost: null }, [{ from: "2026-08-01", to: "2026-08-31" }])).toBeNull();
  });
});
