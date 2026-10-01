import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { LabelledTrend, TrendLine, trendPolylines, widestText, type TrendPoint } from "./trend-line";

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

  it("draws the line alone when the caller's own controls carry the points", () => {
    const { container } = render(<TrendLine dots="none" points={[{ value: 30, tone: "over" }, { value: null }, { value: 40 }]} />);
    expect(container.querySelectorAll(".trend-line-dot")).toHaveLength(0);
    expect(container.querySelectorAll(".trend-line-slot")).toHaveLength(3);
  });

  it("keeps a dense series to its flagged points, and still shows a point that stands alone", () => {
    const { container } = render(<TrendLine dots="flagged" points={[{ value: 30 }, { value: 120, tone: "over" }, { value: 50 }, { value: null }, { value: 40 }, { value: null }]} />);
    const dots = [...container.querySelectorAll<HTMLElement>(".trend-line-dot")];
    expect(dots.map((dot) => dot.className)).toEqual(["trend-line-dot over", "trend-line-dot"]);
    expect(dots.map((dot) => dot.style.bottom)).toEqual(["100%", "40%"]);
  });
});

describe("LabelledTrend (#583)", () => {
  const cells = [
    { key: "a", month: "10月", figure: "3/4名" },
    { key: "b", month: "11月", figure: "—" },
    { key: "c", month: "12月", figure: "未設定" },
  ];

  it("puts each month's label and figure under its point, in reading order", () => {
    const { container } = render(<LabelledTrend label="見本" points={values(75, null, 100)} cells={cells} />);
    const grid = container.querySelector<HTMLElement>(".labelled-trend-grid")!;
    expect(grid.style.getPropertyValue("--rail-points")).toBe("3");
    expect(grid.firstElementChild).toHaveClass("trend-line");
    const read = [...container.querySelectorAll(".labelled-trend-cell")].map((cell) => [...cell.querySelectorAll(":scope > :not(.labelled-trend-sizer)")].map((node) => node.textContent).join(" "));
    expect(read).toEqual(["10月 3/4名", "11月 —", "12月 未設定"]);
  });

  it("gives every cell the widest month and figure, unseen and unread, so the columns are equal", () => {
    const { container } = render(<LabelledTrend label="見本" points={values(75, null, 100)} cells={cells} />);
    for (const cell of container.querySelectorAll(".labelled-trend-cell")) {
      const sizers = [...cell.querySelectorAll(".labelled-trend-sizer")];
      expect(sizers.map((sizer) => sizer.textContent)).toEqual(["10月", "未設定"]);
      for (const sizer of sizers) expect(sizer).toHaveAttribute("aria-hidden", "true");
    }
  });

  it("is a plain block, not a tab stop, while its months fit", () => {
    const { container } = render(<LabelledTrend label="見本の充足" points={values(75)} cells={cells.slice(0, 1)} />);
    const box = container.querySelector(".labelled-trend")!;
    expect(box).not.toHaveAttribute("tabindex");
    expect(box).not.toHaveAttribute("role");
  });
});

describe("widestText (#583)", () => {
  it("weighs full-width characters over digits, and digits over a slash", () => {
    expect(widestText(["3/4名", "未設定", "—"])).toBe("未設定");
    expect(widestText(["10/12名", "未設定"])).toBe("10/12名");
    expect(widestText(["9月", "10月", "12月"])).toBe("10月");
    expect(widestText(["100%", "80%"])).toBe("100%");
    expect(widestText([])).toBe("");
  });
});
