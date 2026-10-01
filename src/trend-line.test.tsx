import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TrendLine, trendPolylines, type TrendPoint } from "./trend-line";

const values = (...items: (number | null)[]): TrendPoint[] => items.map((value) => ({ value }));

describe("trendPolylines (#581)", () => {
  it("puts each value at its bucket's centre, on a 0–100 scale from the top", () => {
    expect(trendPolylines(values(0, 50, 100), 100)).toEqual(["0.5,100 1.5,50 2.5,0"]);
  });

  it("breaks the line at a missing value instead of drawing across it", () => {
    expect(trendPolylines(values(20, 40, null, 60, 80), 100)).toEqual(["0.5,80 1.5,60", "3.5,40 4.5,20"]);
  });

  it("leaves a run of one point to its dot, since a one-point polyline draws nothing", () => {
    expect(trendPolylines(values(20, null, 60, null), 100)).toEqual([]);
  });

  it("keeps values inside the scale", () => {
    expect(trendPolylines(values(-10, 150), 100)).toEqual(["0.5,100 1.5,0"]);
    expect(trendPolylines(values(60), 120)).toEqual([]);
    expect(trendPolylines(values(60, 120), 120)).toEqual(["0.5,50 1.5,0"]);
  });
});

describe("TrendLine (#581)", () => {
  it("is decoration: the values are read from the caller's text or name", () => {
    const { container } = render(<TrendLine points={values(10, 20)} />);
    expect(container.querySelector(".trend-line")).toHaveAttribute("aria-hidden", "true");
  });

  it("draws nothing for no points", () => {
    const { container } = render(<TrendLine points={[]} />);
    expect(container.innerHTML).toBe("");
  });

  it("draws a guide at its value and a slot per bucket, with the title on the whole slot", () => {
    const { container } = render(<TrendLine guides={[100]} points={[{ value: 40, title: "1月: 2/5名" }, { value: null, title: "2月: —" }, { value: 80 }]} />);
    const guide = container.querySelector(".trend-line-guide")!;
    expect(guide.getAttribute("y1")).toBe("0");
    expect(guide.getAttribute("data-value")).toBe("100");
    expect(container.querySelector("svg")!.getAttribute("viewBox")).toBe("0 0 3 100");
    const slots = [...container.querySelectorAll<HTMLElement>(".trend-line-slot")];
    expect(slots.map((slot) => slot.title)).toEqual(["1月: 2/5名", "2月: —", ""]);
    expect(slots.map((slot) => slot.style.left)).toEqual(["0%", "33.33333333333333%", "66.66666666666666%"]);
    // The missing bucket keeps its slot and gets no point.
    expect(slots.map((slot) => slot.querySelectorAll(".trend-line-dot").length)).toEqual([1, 0, 1]);
    expect((slots[2].querySelector(".trend-line-dot") as HTMLElement).style.bottom).toBe("80%");
  });

  it("marks a point with its tone", () => {
    const { container } = render(<TrendLine points={[{ value: 100, tone: "over" }, { value: 30, tone: "short" }, { value: 20, tone: "open" }]} />);
    expect([...container.querySelectorAll(".trend-line-dot")].map((dot) => dot.className)).toEqual([
      "trend-line-dot over",
      "trend-line-dot short",
      "trend-line-dot open",
    ]);
  });

  it("keeps a dense series to its flagged points, and still shows a point that stands alone", () => {
    const { container } = render(<TrendLine dots="flagged" points={[{ value: 30 }, { value: 120, tone: "over" }, { value: 50 }, { value: null }, { value: 40 }, { value: null }]} />);
    const dots = [...container.querySelectorAll<HTMLElement>(".trend-line-dot")];
    expect(dots.map((dot) => dot.className)).toEqual(["trend-line-dot over", "trend-line-dot"]);
    expect(dots.map((dot) => dot.style.bottom)).toEqual(["100%", "40%"]);
  });
});
