import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";

/**
 * A small line chart for a run of values over time (#580, #581).
 *
 * The member detail's month chart already drew its line this way: one SVG stretched over
 * the plot with `preserveAspectRatio="none"` and a non-scaling stroke, and the points as
 * HTML so they stay round at any aspect ratio. This is the same shape for the places that
 * used to draw a bar per bucket.
 *
 * Decoration for assistive technology: every caller already carries the values in text or
 * in an accessible name, so the whole chart is `aria-hidden`.
 */
export type TrendTone = "over" | "short" | "open";

export type TrendPoint = {
  /** `null` is a bucket with nothing to plot (outside a project, say); the line breaks there. */
  value: number | null;
  tone?: TrendTone;
  /** For a pointer, on the bucket's whole column rather than the few pixels of its point. */
  title?: string;
};

const clamp = (value: number, max: number) => Math.min(max, Math.max(0, value));
const y = (value: number, max: number) => 100 - (clamp(value, max) / max) * 100;
const round = (value: number) => Number(value.toFixed(2));

/**
 * One `points` string per unbroken run of values, x at each bucket's centre. A run of one
 * point is left out: a polyline of one point draws nothing, so its dot carries it.
 */
export function trendPolylines(points: readonly TrendPoint[], max: number): string[] {
  const runs: string[][] = [];
  let run: string[] = [];
  points.forEach((point, index) => {
    if (point.value === null) {
      if (run.length > 0) runs.push(run);
      run = [];
      return;
    }
    run.push(`${round(index + 0.5)},${round(y(point.value, max))}`);
  });
  if (run.length > 0) runs.push(run);
  return runs.filter((item) => item.length > 1).map((item) => item.join(" "));
}

/** Whether the point at `index` has no plotted neighbour, so only its dot can show it. */
function isolated(points: readonly TrendPoint[], index: number) {
  return (points[index - 1]?.value ?? null) === null && (points[index + 1]?.value ?? null) === null;
}

export function TrendLine({
  points,
  max = 100,
  guides = [],
  dots = "all",
  className,
}: {
  points: readonly TrendPoint[];
  max?: number;
  /** Values that get a dashed reference line: the ceiling, or the headcount the project needs. */
  guides?: readonly number[];
  /**
   * `flagged` keeps the dots to toned points, for a series too dense to dot every value.
   * `none` draws the line alone, for a caller whose points are controls of their own.
   */
  dots?: "all" | "flagged" | "none";
  className?: string;
}) {
  const count = points.length;
  if (count === 0) return null;
  return (
    <span className={"trend-line" + (className ? " " + className : "")} aria-hidden="true">
      <span className="trend-line-plot">
        <svg viewBox={`0 0 ${count} 100`} preserveAspectRatio="none" focusable="false">
          {guides.map((guide) => (
            <line key={guide} className="trend-line-guide" data-value={guide} x1="0" x2={count} y1={round(y(guide, max))} y2={round(y(guide, max))} vectorEffect="non-scaling-stroke" />
          ))}
          {trendPolylines(points, max).map((line) => (
            <polyline key={line} className="trend-line-path" points={line} fill="none" vectorEffect="non-scaling-stroke" />
          ))}
        </svg>
        {points.map((point, index) => {
          const showDot = point.value !== null && dots !== "none" && (dots === "all" || Boolean(point.tone) || isolated(points, index));
          return (
            <i
              key={index}
              className="trend-line-slot"
              title={point.title}
              style={{ left: `${(index / count) * 100}%`, width: `${100 / count}%` }}
            >
              {showDot && <b className={"trend-line-dot" + (point.tone ? " " + point.tone : "")} style={{ bottom: `${(clamp(point.value!, max) / max) * 100}%` }} />}
            </i>
          );
        })}
      </span>
    </span>
  );
}

/**
 * Width, in digits, of each glyph the figures and months here use: tabular digits are one
 * digit wide, a slash and a percent sign about 0.7 and 1.4, a full-width character (名, 月,
 * 未設定, —) about 1.7. Only used to pick which label sets every column's width.
 */
const GLYPHS: [RegExp, number][] = [[/\d/u, 1], [/\//u, 0.71], [/%/u, 1.43], [/[\u2014\u3000-\u9fff\uff00-\uffef]/u, 1.71]];

export function widestText(texts: readonly string[]) {
  const width = (text: string) => [...text].reduce((sum, char) => sum + (GLYPHS.find(([pattern]) => pattern.test(char))?.[1] ?? 1), 0);
  return texts.reduce((widest, text) => (width(text) > width(widest) ? text : widest), "");
}

export type TrendCell = { key: string; month: string; figure: string };

/**
 * A line with each month's label and figure under its point (#583).
 *
 * The line puts month i at (i + 0.5) / N of its width, so the columns under it are equal:
 * each cell carries the widest month and the widest figure as invisible sizers, the way
 * the members list's month rail does (#581). When the months do not fit their box the
 * row scrolls sideways, and only then is it a focusable, named region — a card per
 * candidate would otherwise put a tab stop in every card for nothing.
 */
export function LabelledTrend({
  points,
  cells,
  max = 100,
  guides = [],
  label,
  className,
}: {
  points: readonly TrendPoint[];
  cells: readonly TrendCell[];
  max?: number;
  guides?: readonly number[];
  /** The scroll region's name, used only while the months overflow. */
  label: string;
  className?: string;
}) {
  const [scrollable, setScrollable] = useState(false);
  const cleanup = useRef<(() => void) | null>(null);
  const observe = useCallback((node: HTMLDivElement | null) => {
    cleanup.current?.();
    cleanup.current = null;
    // jsdom has no layout and no ResizeObserver; the row is then never a scroll region.
    if (!node || typeof ResizeObserver === "undefined") return;
    const measure = () => setScrollable(node.scrollWidth > node.clientWidth + 1);
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    if (node.firstElementChild) observer.observe(node.firstElementChild);
    cleanup.current = () => observer.disconnect();
  }, []);
  useEffect(() => () => cleanup.current?.(), []);
  const widestMonth = widestText(cells.map((cell) => cell.month));
  const widestFigure = widestText(cells.map((cell) => cell.figure));
  return (
    <div
      className={"labelled-trend" + (className ? " " + className : "")}
      ref={observe}
      {...(scrollable ? { role: "region", tabIndex: 0, "aria-label": label } : {})}
    >
      <div className="labelled-trend-grid" style={{ "--rail-points": cells.length } as CSSProperties}>
        <TrendLine points={points} max={max} guides={guides} />
        {cells.map((cell) => (
          <span className="labelled-trend-cell" key={cell.key}>
            <span className="labelled-trend-month">{cell.month}</span>
            <strong className="labelled-trend-figure">{cell.figure}</strong>
            <span className="labelled-trend-month labelled-trend-sizer" aria-hidden="true">{widestMonth}</span>
            <strong className="labelled-trend-figure labelled-trend-sizer" aria-hidden="true">{widestFigure}</strong>
          </span>
        ))}
      </div>
    </div>
  );
}
