import { describe, expect, it } from "vitest";
import {
  addSet,
  addTodayExercise,
  completeSet,
  completedSets,
  editSet,
  extraSession,
  finalizeSession,
  isExerciseComplete,
  markAll,
  removeSet,
  resolveToday,
  sessionFromPlan,
  skipExercise,
  swapExercise,
  uncompleteSet,
  weightsChanged,
} from "../src/data/session";
import { buildTemplate } from "../src/data/templates";
import { WEEK_ORDER, weekdayOf } from "../src/lib/date";
import type { Session, Split, SplitsDoc } from "../src/types";

const T0 = Date.UTC(2026, 10, 1);
const NOW = Date.UTC(2026, 10, 10, 14);
const split: Split = buildTemplate("upper-lower-4", "lb", T0);
const doc: SplitsDoc = { activeId: split.id, splits: [split], history: [{ splitId: split.id, from: "2026-11-01" }] };
const TUE = "2026-11-10";

function fresh(): Session {
  return sessionFromPlan(TUE, split.days[2], { splitId: split.id, weekday: 2 }, NOW);
}
const ex0 = (s: Session) => s.exercises[0];

describe("today resolution", () => {
  it("weekday mapping: Sunday = 0, Monday-first order", () => {
    expect(WEEK_ORDER).toEqual([1, 2, 3, 4, 5, 6, 0]);
    expect(weekdayOf("2026-11-15")).toBe(0);
    expect(weekdayOf("2026-11-09")).toBe(1);
    expect(weekdayOf(TUE)).toBe(2);
    const sun = resolveToday("2026-11-15", doc, null);
    expect(sun.weekday).toBe(0);
    expect(sun.planWeekday).toBe(0);
    expect(sun.plan).toEqual(split.days[0]);
    const tue = resolveToday(TUE, doc, null);
    expect(tue.plan).toEqual(split.days[2]);
    expect(tue.split?.id).toBe(split.id);
  });

  it("picking another day's workout", () => {
    const r = resolveToday("2026-11-11", doc, 4); // Wed (rest), doing Thursday's
    expect(r.weekday).toBe(3);
    expect(r.planWeekday).toBe(4);
    expect(r.plan).toEqual(split.days[4]);
  });

  it("no split → no plan", () => {
    const r = resolveToday(TUE, null, null);
    expect(r.plan).toBeNull();
    expect(r.split).toBeNull();
  });
});

describe("session state machine", () => {
  it("sessionFromPlan copies the plan (reps.min, plan weight, not done)", () => {
    const plan = structuredClone(split.days[2]);
    const s = sessionFromPlan(TUE, plan, { splitId: split.id, weekday: 2 }, NOW);
    expect(s.date).toBe(TUE);
    expect(s.title).toBe(plan.name);
    expect(s.from).toEqual({ splitId: split.id, weekday: 2 });
    expect(s.startedAt).toBe(NOW);
    expect(s.finishedAt).toBeUndefined();
    expect(s.exercises.map((e) => e.name)).toEqual(plan.exercises.map((e) => e.name));
    s.exercises.forEach((e, i) => {
      const p = plan.exercises[i];
      expect(e.source).toBe("plan");
      expect(e.planExerciseId).toBe(p.id);
      expect(e.reps).toEqual(p.reps);
      expect(e.sets).toHaveLength(p.sets);
      for (const set of e.sets) expect(set).toMatchObject({ reps: p.reps.min, weightKg: p.weightKg, done: false });
    });
    // a copy: editing the plan afterwards doesn't touch the session
    const snap = structuredClone(s);
    plan.exercises[0].name = "Changed";
    plan.exercises[0].weightKg = 999;
    expect(s).toEqual(snap);
  });

  it("extraSession: from null, title, no exercises", () => {
    const s = extraSession(TUE, "Extra workout", NOW);
    expect(s).toMatchObject({ date: TUE, title: "Extra workout", from: null, exercises: [] });
  });

  it("complete / uncomplete a set; pure", () => {
    const s = fresh();
    const id = ex0(s).id;
    const c = completeSet(s, id, 0, NOW + 1);
    expect(ex0(c).sets[0]).toMatchObject({ done: true, doneAt: NOW + 1 });
    expect(ex0(s).sets[0].done).toBe(false);
    expect(completedSets(c)).toBe(1);
    const u = uncompleteSet(c, id, 0);
    expect(ex0(u).sets[0].done).toBe(false);
    expect(completedSets(u)).toBe(0);
  });

  it("editSet changes reps/weight and marks done unless done:false", () => {
    const s = fresh();
    const id = ex0(s).id;
    const e = editSet(s, id, 1, { weightKg: 70 }, NOW);
    expect(ex0(e).sets[1]).toMatchObject({ weightKg: 70, done: true });
    const e2 = editSet(s, id, 1, { reps: 12, done: false }, NOW);
    expect(ex0(e2).sets[1]).toMatchObject({ reps: 12, done: false });
    const bw = editSet(s, id, 0, { weightKg: null }, NOW);
    expect(ex0(bw).sets[0].weightKg).toBeNull();
  });

  it("markAll completes the rest of the exercise", () => {
    const s = completeSet(fresh(), fresh().exercises[0].id, 0, NOW);
    const id = ex0(s).id;
    const m = markAll(s, id, NOW + 5);
    expect(ex0(m).sets.every((x) => x.done)).toBe(true);
    expect(ex0(m).sets[0].doneAt).toBe(NOW); // already-done sets keep their time
    expect(isExerciseComplete(ex0(m))).toBe(true);
    expect(isExerciseComplete(ex0(s))).toBe(false);
  });

  it("addSet copies the last set (not done); removeSet keeps at least one", () => {
    let s = fresh();
    const id = ex0(s).id;
    const n = ex0(s).sets.length;
    s = editSet(s, id, n - 1, { reps: 9, weightKg: 80 }, NOW);
    const a = addSet(s, id);
    expect(ex0(a).sets).toHaveLength(n + 1);
    expect(ex0(a).sets[n]).toMatchObject({ reps: 9, weightKg: 80, done: false });
    let r = a;
    for (let i = 0; i < 20; i++) r = removeSet(r, id);
    expect(ex0(r).sets).toHaveLength(1);
  });

  it("skip / swap / add are today-only: they never touch the split", () => {
    const before = structuredClone(split);
    let s = fresh();
    const id = ex0(s).id;
    s = skipExercise(s, id, true);
    expect(ex0(s).skipped).toBe(true);
    expect(isExerciseComplete(ex0(s))).toBe(false);
    s = skipExercise(s, id, false);
    expect(ex0(s).skipped).toBeFalsy();
    const oldName = ex0(s).name;
    s = swapExercise(s, id, "Leg press", 100);
    expect(ex0(s)).toMatchObject({ name: "Leg press", source: "swapped", swappedFrom: oldName });
    expect(ex0(s).sets.every((x) => x.weightKg === 100)).toBe(true);
    s = addTodayExercise(s, "Calf raise", 3, { min: 12, max: 15 }, 40);
    const last = s.exercises[s.exercises.length - 1];
    expect(last).toMatchObject({ name: "Calf raise", source: "added", reps: { min: 12, max: 15 } });
    expect(last.sets).toHaveLength(3);
    expect(last.sets.every((x) => x.weightKg === 40 && x.reps === 12 && !x.done)).toBe(true);
    expect(split).toEqual(before);
  });

  it("finalizeSession stamps finishedAt and keeps zero-set exercises as skipped", () => {
    let s = fresh();
    s = markAll(s, ex0(s).id, NOW);
    const f = finalizeSession(s, NOW + 60_000);
    expect(f.finishedAt).toBe(NOW + 60_000);
    expect(f.exercises).toHaveLength(s.exercises.length);
    expect(f.exercises[0].skipped).toBeFalsy();
    for (const e of f.exercises.slice(1)) expect(e.skipped).toBe(true);
  });

  it("weightsChanged: only when a completed set's weight differs from the plan", () => {
    let s = fresh();
    const id = ex0(s).id;
    s = completeSet(s, id, 0, NOW);
    expect(weightsChanged(s, split)).toBe(false);
    s = editSet(s, id, 1, { weightKg: (ex0(s).sets[1].weightKg ?? 0) + 2.26796185 }, NOW);
    expect(weightsChanged(s, split)).toBe(true);
    expect(weightsChanged(s, null)).toBe(false);
  });
});
