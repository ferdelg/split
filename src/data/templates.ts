/**
 * Starter splits for onboarding. Beginner–intermediate programs with round
 * starting weights in her unit (stored as kg via fromDisplay). Monday first.
 */
import type { DayPlan, PlannedExercise, Split, TemplateId, Timestamp, WeightUnit } from "../types";
import { uid } from "../lib/ids";
import { fromDisplay, toDisplay } from "../lib/units";

export const TEMPLATES: { id: TemplateId; name: string; blurb: string }[] = [
  { id: "full-body-3", name: "3-day full body", blurb: "Mon, Wed, Fri. The whole body each time; great to start." },
  { id: "upper-lower-4", name: "4-day upper/lower", blurb: "Mon, Tue, Thu, Fri. Upper and lower days, twice a week each." },
  { id: "ppl-5", name: "5-day push/pull/legs", blurb: "Mon to Fri. Push, pull, legs, upper, legs and glutes." },
  { id: "blank", name: "Start blank", blurb: "Seven empty days. Build your own." },
];

/** [name, sets, reps min, reps max (0 = single), lb, kg (null = bodyweight), note?] */
type Row = [string, number, number, number, number | null, number | null, string?];

const PLANK: Row = ["Plank", 3, 30, 0, null, null, "Seconds"];

const FULL_BODY: Record<number, [string, Row[]]> = {
  1: ["Full body A", [
    ["Back squat", 3, 5, 0, 95, 40],
    ["Bench press", 3, 8, 0, 75, 35],
    ["Seated cable row", 3, 10, 0, 70, 30],
    ["Dumbbell curl", 2, 10, 12, 15, 7.5],
    PLANK,
  ]],
  3: ["Full body B", [
    ["Romanian deadlift", 3, 8, 0, 85, 40],
    ["Overhead press", 3, 8, 0, 55, 25],
    ["Lat pulldown", 3, 10, 0, 80, 35],
    ["Hip thrust", 3, 10, 0, 95, 40],
    ["Triceps pushdown", 2, 12, 0, 35, 15],
  ]],
  5: ["Full body C", [
    ["Leg press", 3, 10, 0, 180, 80],
    ["Incline dumbbell press", 3, 10, 0, 25, 10],
    ["Lat pulldown", 3, 10, 0, 80, 35],
    ["Lateral raise", 2, 12, 15, 10, 5],
    PLANK,
  ]],
};

const UPPER_LOWER: Record<number, [string, Row[]]> = {
  1: ["Upper A", [
    ["Bench press", 4, 6, 8, 75, 35],
    ["Seated cable row", 4, 8, 10, 70, 30],
    ["Overhead press", 3, 8, 0, 55, 25],
    ["Dumbbell curl", 3, 10, 12, 15, 7.5],
    ["Triceps pushdown", 3, 10, 12, 35, 15],
  ]],
  2: ["Lower A", [
    ["Back squat", 4, 5, 0, 95, 40],
    ["Romanian deadlift", 3, 8, 0, 85, 40],
    ["Leg press", 3, 10, 0, 180, 80],
    ["Seated leg curl", 3, 10, 12, 50, 20],
    PLANK,
  ]],
  4: ["Upper B", [
    ["Overhead press", 4, 6, 8, 55, 25],
    ["Lat pulldown", 4, 8, 10, 80, 35],
    ["Incline dumbbell press", 3, 10, 0, 25, 10],
    ["Lateral raise", 3, 12, 15, 10, 5],
    ["Face pull", 3, 15, 0, 30, 15],
  ]],
  5: ["Lower B", [
    ["Hip thrust", 4, 8, 10, 115, 50],
    ["Bulgarian split squat", 3, 10, 0, 15, 7.5],
    ["Leg press", 3, 12, 0, 160, 70],
    ["Standing calf raise", 3, 12, 0, 90, 40],
    PLANK,
  ]],
};

const PPL: Record<number, [string, Row[]]> = {
  1: ["Push", [
    ["Bench press", 4, 6, 8, 75, 35],
    ["Overhead press", 3, 8, 0, 55, 25],
    ["Incline dumbbell press", 3, 10, 0, 25, 10],
    ["Lateral raise", 3, 12, 15, 10, 5],
    ["Triceps pushdown", 3, 10, 12, 35, 15],
  ]],
  2: ["Pull", [
    ["Lat pulldown", 4, 8, 10, 80, 35],
    ["Seated cable row", 3, 10, 0, 70, 30],
    ["Face pull", 3, 15, 0, 30, 15],
    ["Dumbbell curl", 3, 10, 12, 15, 7.5],
    ["Hammer curl", 2, 12, 0, 15, 7.5],
  ]],
  3: ["Legs", [
    ["Back squat", 4, 5, 0, 95, 40],
    ["Romanian deadlift", 3, 8, 0, 85, 40],
    ["Leg press", 3, 10, 0, 180, 80],
    ["Seated leg curl", 3, 10, 12, 50, 20],
    ["Standing calf raise", 3, 12, 0, 90, 40],
  ]],
  4: ["Upper", [
    ["Overhead press", 4, 6, 8, 55, 25],
    ["Seated cable row", 3, 8, 10, 70, 30],
    ["Bench press", 3, 8, 10, 65, 30],
    ["Lat pulldown", 3, 10, 12, 70, 30],
    ["Lateral raise", 2, 15, 0, 10, 5],
  ]],
  5: ["Legs and glutes", [
    ["Hip thrust", 4, 8, 10, 115, 50],
    ["Bulgarian split squat", 3, 10, 0, 15, 7.5],
    ["Romanian deadlift", 3, 10, 0, 75, 35],
    ["Cable kickback", 3, 12, 15, 15, 7.5],
    PLANK,
  ]],
};

const SPECS: Record<Exclude<TemplateId, "blank">, { name: string; days: Record<number, [string, Row[]]> }> = {
  "full-body-3": { name: "Full body", days: FULL_BODY },
  "upper-lower-4": { name: "Upper/lower", days: UPPER_LOWER },
  "ppl-5": { name: "Push/pull/legs", days: PPL },
};

function rest(): DayPlan {
  return { kind: "rest", name: "Rest", exercises: [] };
}

/**
 * kg for a round display number, nudged up by a few ulps if needed so that
 * converting back never lands a hair BELOW the round number (75 lb → 74.999…
 * would read as off-grid to strict checks). The error is < 1e-13 kg.
 */
function roundKg(display: number, units: WeightUnit): number {
  let kg = fromDisplay(display, units);
  const buf = new Float64Array(1);
  const bits = new BigInt64Array(buf.buffer);
  for (let i = 0; i < 8 && toDisplay(kg, units) < display; i++) {
    buf[0] = kg;
    bits[0] += 1n;
    kg = buf[0];
  }
  return kg;
}

function planned(row: Row, units: WeightUnit): PlannedExercise {
  const [name, sets, min, max, lb, kg, note] = row;
  const display = units === "lb" ? lb : kg;
  const ex: PlannedExercise = {
    id: uid("ex"),
    name,
    sets,
    reps: max > min ? { min, max } : { min },
    weightKg: display == null ? null : roundKg(display, units),
  };
  if (note) ex.note = note;
  return ex;
}

export function buildTemplate(id: TemplateId, units: WeightUnit, now: Timestamp): Split {
  const base = { id: uid("split"), createdAt: now, updatedAt: now };
  if (id === "blank" || !(id in SPECS)) {
    return { ...base, name: "My split", days: Array.from({ length: 7 }, rest) };
  }
  const spec = SPECS[id];
  const days = Array.from({ length: 7 }, (_, wd): DayPlan => {
    const d = spec.days[wd];
    return d ? { kind: "workout", name: d[0], exercises: d[1].map((r) => planned(r, units)) } : rest();
  });
  return { ...base, name: spec.name, days };
}
