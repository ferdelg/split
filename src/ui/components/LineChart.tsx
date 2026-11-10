import type { ExerciseHistoryPoint, WeightUnit } from "../../types";
import { roundDisplay, toDisplay } from "../../lib/units";
import { shortDate } from "../format";

const VW = 320;
const VH = 120;
const PAD = 8;

/**
 * Top weight over time: one accent line, dots, and HTML axis labels (so text
 * stays ≥ 16 px whatever the SVG scales to). Bodyweight-only history plots
 * reps instead.
 */
export function LineChart(props: { points: ExerciseHistoryPoint[]; unit: WeightUnit }) {
  const loaded = props.points.filter((p) => p.topKg != null);
  const byReps = loaded.length === 0;
  const pts = (byReps ? props.points : loaded).map((p) => ({
    date: p.date,
    v: byReps ? p.reps : roundDisplay(toDisplay(p.topKg as number, props.unit)),
  }));
  if (pts.length === 0) return null;
  const suffix = byReps ? " reps" : ` ${props.unit}`;
  const vals = pts.map((p) => p.v);
  let min = Math.min(...vals);
  let max = Math.max(...vals);
  if (max === min) {
    max += 1;
    min = Math.max(0, min - 1);
  }
  const x = (i: number) => (pts.length === 1 ? VW / 2 : PAD + (i * (VW - 2 * PAD)) / (pts.length - 1));
  const y = (v: number) => PAD + (1 - (v - min) / (max - min)) * (VH - 2 * PAD);
  const d = pts.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p.v).toFixed(1)}`).join(" ");
  const first = pts[0];
  const last = pts[pts.length - 1];
  const desc = `${byReps ? "Reps" : "Top weight"} from ${first.v}${suffix} on ${shortDate(first.date)} to ${last.v}${suffix} on ${shortDate(last.date)}, range ${Math.min(...vals)} to ${Math.max(...vals)}${suffix}.`;
  return (
    <figure class="chart">
      <div class="chart-plot">
        <div class="chart-y" aria-hidden="true">
          <span class="num">{Math.max(...vals)}</span>
          <span class="num">{Math.min(...vals)}</span>
        </div>
        <svg viewBox={`0 0 ${VW} ${VH}`} preserveAspectRatio="none" class="chart-svg" role="img" aria-label={desc}>
          <line x1="0" x2={VW} y1={PAD} y2={PAD} class="chart-rule" />
          <line x1="0" x2={VW} y1={VH - PAD} y2={VH - PAD} class="chart-rule" />
          {pts.length > 1 && <path d={d} class="chart-line" vector-effect="non-scaling-stroke" />}
          {pts.map((p, i) => (
            <path key={p.date} d={`M${x(i).toFixed(1)},${y(p.v).toFixed(1)}h0`} class="chart-dot" vector-effect="non-scaling-stroke" />
          ))}
        </svg>
      </div>
      <figcaption class="chart-x" aria-hidden="true">
        <span>{shortDate(first.date)}</span>
        <span class="chart-unit">{byReps ? "reps" : props.unit}</span>
        <span>{shortDate(last.date)}</span>
      </figcaption>
    </figure>
  );
}
