/**
 * Today resolution and the session state machine. Pure: Session → Session.
 *
 * A session is a COPY of the plan at the time she starts; nothing here ever
 * touches a Split. Exercises copied from the plan keep the planned exercise's
 * id as their own id (and in planExerciseId), so the UI can render the plan
 * before a session exists and the same ids keep working after the first tap.
 */
import type {
  BestsDoc, DayPlan, ExerciseLog, ISODate, ProposedWorkout, RepTarget, Session, SetLog, Split, SplitsDoc, Timestamp, Weekday,
} from "../types";
import { weekdayOf } from "../lib/date";
import { uid } from "../lib/ids";
import { lastFor, normalizeName } from "./history";
import { activeSplit } from "./split";

const KG_EPS = 0.01;

export function resolveToday(date: ISODate, doc: SplitsDoc | null, picked: Weekday | null): {
  weekday: Weekday;
  planWeekday: Weekday;
  split: Split | null;
  plan: DayPlan | null;
} {
  const weekday = weekdayOf(date);
  const planWeekday = picked ?? weekday;
  const split = activeSplit(doc);
  return { weekday, planWeekday, split, plan: split?.days[planWeekday] ?? null };
}

function freshSets(n: number, reps: RepTarget, weightKg: number | null): SetLog[] {
  return Array.from({ length: Math.max(1, n) }, () => ({ reps: reps.min, weightKg, done: false }));
}

export function sessionFromPlan(date: ISODate, plan: DayPlan, from: Session["from"], now: Timestamp): Session {
  return {
    id: uid("s"),
    date,
    title: plan.kind === "workout" ? plan.name : "Extra workout",
    from,
    exercises:
      plan.kind === "workout"
        ? plan.exercises.map((pe): ExerciseLog => {
            const ex: ExerciseLog = {
              id: pe.id,
              name: pe.name,
              reps: { ...pe.reps },
              sets: freshSets(pe.sets, pe.reps, pe.weightKg),
              source: "plan",
              planExerciseId: pe.id,
            };
            if (pe.note) ex.note = pe.note;
            return ex;
          })
        : [],
    startedAt: now,
  };
}

export function extraSession(date: ISODate, title: string, now: Timestamp): Session {
  return { id: uid("s"), date, title: title.trim() || "Extra workout", from: null, exercises: [], startedAt: now };
}

function withEx(s: Session, exId: string, fn: (e: ExerciseLog) => ExerciseLog): Session {
  let changed = false;
  const exercises = s.exercises.map((e) => {
    if (e.id !== exId) return e;
    const n = fn(e);
    if (n !== e) changed = true;
    return n;
  });
  return changed ? { ...s, exercises } : s;
}

function withSet(s: Session, exId: string, i: number, fn: (set: SetLog) => SetLog): Session {
  return withEx(s, exId, (e) => {
    const set = e.sets[i];
    if (!set) return e;
    const sets = e.sets.slice();
    sets[i] = fn(set);
    return { ...e, sets };
  });
}

export function completeSet(s: Session, exId: string, i: number, now: Timestamp): Session {
  return withSet(s, exId, i, (set) => (set.done ? set : { ...set, done: true, doneAt: now }));
}

export function uncompleteSet(s: Session, exId: string, i: number): Session {
  return withSet(s, exId, i, (set) => {
    if (!set.done) return set;
    const { doneAt: _d, ...rest } = set;
    void _d;
    return { ...rest, done: false };
  });
}

/** Edits reps/weight; marks the set done unless `done: false` is given. */
export function editSet(s: Session, exId: string, i: number, patch: { reps?: number; weightKg?: number | null; done?: boolean }, now: Timestamp): Session {
  return withSet(s, exId, i, (set) => {
    const next: SetLog = { ...set };
    if (patch.reps !== undefined && Number.isFinite(patch.reps)) next.reps = Math.max(0, Math.min(999, Math.round(patch.reps)));
    if (patch.weightKg !== undefined) next.weightKg = patch.weightKg != null && patch.weightKg > 0 ? patch.weightKg : null;
    const done = patch.done ?? true;
    if (done && !set.done) next.doneAt = now;
    if (!done) delete next.doneAt;
    next.done = done;
    return next;
  });
}

/** Completes every remaining set (and un-skips the exercise). */
export function markAll(s: Session, exId: string, now: Timestamp): Session {
  return withEx(s, exId, (e) => {
    const { skipped: _s, ...rest } = e;
    void _s;
    return { ...rest, sets: e.sets.map((set) => (set.done ? set : { ...set, done: true, doneAt: now })) };
  });
}

/** Copies the last set's reps/weight, not done. Max 20 sets. */
export function addSet(s: Session, exId: string): Session {
  return withEx(s, exId, (e) => {
    if (e.sets.length >= 20) return e;
    const last = e.sets[e.sets.length - 1];
    const set: SetLog = last ? { reps: last.reps, weightKg: last.weightKg, done: false } : { reps: e.reps.min, weightKg: null, done: false };
    return { ...e, sets: [...e.sets, set] };
  });
}

/** Removes the last set; keeps ≥ 1. */
export function removeSet(s: Session, exId: string): Session {
  return withEx(s, exId, (e) => (e.sets.length <= 1 ? e : { ...e, sets: e.sets.slice(0, -1) }));
}

export function skipExercise(s: Session, exId: string, skipped: boolean): Session {
  return withEx(s, exId, (e) => {
    if (!!e.skipped === skipped) return e;
    if (skipped) return { ...e, skipped: true };
    const { skipped: _s, ...rest } = e;
    void _s;
    return rest;
  });
}

/** Today only: a different exercise in the same slot (same sets/reps; sets reset). */
export function swapExercise(s: Session, exId: string, newName: string, lastWeightKg: number | null): Session {
  const name = newName.trim();
  if (!name) return s;
  return withEx(s, exId, (e) => ({
    ...e,
    name,
    source: "swapped",
    swappedFrom: e.swappedFrom ?? e.name,
    sets: e.sets.map((set) => ({ reps: set.reps, weightKg: lastWeightKg, done: false })),
  }));
}

export function addTodayExercise(s: Session, name: string, sets: number, reps: RepTarget, weightKg: number | null): Session {
  const n = name.trim();
  if (!n) return s;
  const ex: ExerciseLog = {
    id: uid("x"),
    name: n,
    reps: { ...reps },
    sets: freshSets(Math.min(10, Math.max(1, Math.round(sets))), reps, weightKg != null && weightKg > 0 ? weightKg : null),
    source: "added",
  };
  return { ...s, exercises: [...s.exercises, ex] };
}

export function isExerciseComplete(ex: ExerciseLog): boolean {
  return !ex.skipped && ex.sets.length > 0 && ex.sets.every((x) => x.done);
}

/** Completed sets over exercises not skipped. */
export function completedSets(s: Session): number {
  let n = 0;
  for (const e of s.exercises) if (!e.skipped) for (const x of e.sets) if (x.done) n++;
  return n;
}

/** Heaviest weight in a "last time" record, null if none was loaded. */
function lastTopKg(name: string, bests: BestsDoc): number | null {
  const last = lastFor(name, bests);
  let top: number | null = null;
  for (const x of last?.sets ?? []) if (x.weightKg != null && (top == null || x.weightKg > top)) top = x.weightKg;
  return top;
}

/**
 * Today's session from a coach proposal (coachAdjusted). With a session in
 * progress (`base`), completed sets of an exercise with the same name are
 * kept, and exercises with completed sets that the proposal dropped are kept
 * too (logged work is never thrown away). Missing weights: her last weight
 * for that exercise, else the split's (splitWeightFor), else bodyweight.
 */
export function applyProposalToSession(
  date: ISODate,
  p: ProposedWorkout,
  base: Session | null,
  bests: BestsDoc,
  splitWeightFor: (name: string) => number | null,
  now: Timestamp,
): Session {
  const used = new Set<string>();
  const baseEx = base?.exercises ?? [];
  const exercises: ExerciseLog[] = p.exercises.map((pe) => {
    const weightKg = pe.weightKg != null && pe.weightKg > 0 ? pe.weightKg : lastTopKg(pe.name, bests) ?? splitWeightFor(pe.name) ?? null;
    const prev = baseEx.find((e) => !used.has(e.id) && normalizeName(e.name) === normalizeName(pe.name));
    const done = prev && !prev.skipped ? prev.sets.filter((x) => x.done) : [];
    if (prev) used.add(prev.id);
    const sets: SetLog[] = [...done];
    while (sets.length < pe.sets) sets.push({ reps: pe.reps.min, weightKg, done: false });
    const ex: ExerciseLog = { id: prev?.id ?? uid("x"), name: pe.name, reps: { ...pe.reps }, sets, source: prev?.source ?? "coach" };
    if (prev?.planExerciseId) ex.planExerciseId = prev.planExerciseId;
    if (prev?.swappedFrom) ex.swappedFrom = prev.swappedFrom;
    return ex;
  });
  // Work already logged on exercises the proposal dropped stays, first in the list.
  const kept = baseEx
    .filter((e) => !used.has(e.id) && !e.skipped && e.sets.some((x) => x.done))
    .map((e) => ({ ...e, sets: e.sets.filter((x) => x.done) }));
  const all = [...kept, ...exercises];
  if (base) return { ...base, title: p.title?.trim() || base.title, coachAdjusted: true, exercises: all };
  return { id: uid("s"), date, title: p.title?.trim() || "Today's workout", from: null, coachAdjusted: true, exercises: all, startedAt: now };
}

/** Sets finishedAt; exercises with zero completed sets are kept as skipped. */
export function finalizeSession(s: Session, now: Timestamp): Session {
  return {
    ...s,
    finishedAt: now,
    exercises: s.exercises.map((e) => (e.sets.some((x) => x.done) || e.skipped ? e : { ...e, skipped: true })),
  };
}

/** True if a completed set of a plan exercise differs from the split's planned weight. */
export function weightsChanged(s: Session, split: Split | null): boolean {
  if (!s.from || !split || split.id !== s.from.splitId) return false;
  const day = split.days[s.from.weekday];
  if (!day) return false;
  for (const e of s.exercises) {
    if (e.skipped || e.source !== "plan" || !e.planExerciseId) continue;
    const pe = day.exercises.find((x) => x.id === e.planExerciseId);
    if (!pe) continue;
    for (const set of e.sets) {
      if (!set.done) continue;
      const a = set.weightKg;
      const b = pe.weightKg;
      if ((a == null) !== (b == null)) return true;
      if (a != null && b != null && Math.abs(a - b) > KG_EPS) return true;
    }
  }
  return false;
}
