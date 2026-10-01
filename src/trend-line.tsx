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
  /** `flagged` keeps the dots to toned points, for a series too dense to dot every value. */
  dots?: "all" | "flagged";
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
          const showDot = point.value !== null && (dots === "all" || Boolean(point.tone) || isolated(points, index));
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
