/** Display helpers shared by the screens (pure; unit math lives in lib/units). */
import type { ExerciseRecord, PersonalBest, WeightUnit } from "../types";
import { formatWeight } from "../lib/units";
import { MONTH_NAMES, WEEKDAY_NAMES, parseISO } from "../lib/date";

/** "135 lb", "bodyweight". */
export const w = (kg: number | null, unit: WeightUnit) => formatWeight(kg, unit);
/** "135" (no unit), "bodyweight". */
export const wn = (kg: number | null, unit: WeightUnit) => formatWeight(kg, unit, { unit: false });

/** "Last: 135 lb × 5, 5, 5" or "Last: 135 × 5, 140 × 4 lb"-style when weights vary. */
export function lastLine(last: ExerciseRecord["last"], unit: WeightUnit): string | null {
  if (!last || last.sets.length === 0) return null;
  const weights = new Set(last.sets.map((s) => (s.weightKg == null ? "bw" : s.weightKg.toFixed(2))));
  if (weights.size === 1) {
    const kg = last.sets[0].weightKg;
    return `Last: ${w(kg, unit)} × ${last.sets.map((s) => s.reps).join(", ")}`;
  }
  return `Last: ${last.sets.map((s) => `${wn(s.weightKg, unit)} × ${s.reps}`).join(", ")}`;
}

/** "Tuesday · Nov 10" for the Today header. */
export function headerDate(iso: string): string {
  const d = parseISO(iso);
  return `${WEEKDAY_NAMES[d.getDay()]} · ${MONTH_NAMES[d.getMonth()].slice(0, 3)} ${d.getDate()}`;
}

/** "Nov 10". */
export function shortDate(iso: string): string {
  const d = parseISO(iso);
  return `${MONTH_NAMES[d.getMonth()].slice(0, 3)} ${d.getDate()}`;
}

export function pbLine(pb: PersonalBest, unit: WeightUnit): string {
  const now = pb.weightKg == null ? `${pb.reps} reps` : `${w(pb.weightKg, unit)} × ${pb.reps}`;
  const kind = pb.kind === "heaviest" ? "Heaviest" : "Most reps";
  let was = "";
  if (pb.previous) {
    was = pb.kind === "heaviest" ? ` (was ${w(pb.previous.weightKg, unit)})` : ` (was ${pb.previous.reps})`;
  }
  return `${kind}: ${now}${was}`;
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n.toLocaleString()} ${n === 1 ? one : many}`;
}
