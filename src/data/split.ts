/**
 * Split editing. Pure: Split → Split (and SplitsDoc → SplitsDoc). Every
 * function returns a new object and bumps `updatedAt` to `now`; invalid
 * input (unknown id, out-of-range index) returns the input unchanged.
 * New ids come from uid() (random, but no store/DOM/clock).
 */
import type { DayPlan, ISODate, PlannedExercise, ProposedWorkout, Split, SplitsDoc, Timestamp, Weekday } from "../types";
import { uid } from "../lib/ids";

export function emptyWeek(): DayPlan[] {
  return Array.from({ length: 7 }, () => ({ kind: "rest" as const, name: "Rest", exercises: [] }));
}

function withDay(s: Split, wd: Weekday, fn: (d: DayPlan) => DayPlan, now: Timestamp): Split {
  const day = s.days[wd];
  if (!day) return s;
  const next = fn(day);
  if (next === day) return s;
  const days = s.days.slice();
  days[wd] = next;
  return { ...s, days, updatedAt: now };
}

const copyEx = (e: PlannedExercise): PlannedExercise => ({ ...e, reps: { ...e.reps }, id: uid("ex") });

export function renameDay(s: Split, wd: Weekday, name: string, now: Timestamp): Split {
  const n = name.trim();
  return n ? withDay(s, wd, (d) => ({ ...d, name: n }), now) : s;
}

/** Rest days have no exercises; turning a rest day into a workout names it "Workout". */
export function setDayKind(s: Split, wd: Weekday, kind: DayPlan["kind"], now: Timestamp): Split {
  return withDay(s, wd, (d) => {
    if (d.kind === kind) return d;
    if (kind === "rest") return { kind: "rest", name: "Rest", exercises: [] };
    return { kind: "workout", name: d.name && d.name !== "Rest" ? d.name : "Workout", exercises: [] };
  }, now);
}

/** Adding to a rest day turns it into a workout day. */
export function addExercise(s: Split, wd: Weekday, ex: PlannedExercise, now: Timestamp): Split {
  return withDay(s, wd, (d) => ({
    kind: "workout",
    name: d.kind === "rest" ? (d.name && d.name !== "Rest" ? d.name : "Workout") : d.name,
    exercises: [...d.exercises, { ...ex, reps: { ...ex.reps } }],
  }), now);
}

export function updateExercise(s: Split, wd: Weekday, id: string, patch: Partial<Omit<PlannedExercise, "id">>, now: Timestamp): Split {
  return withDay(s, wd, (d) => {
    if (!d.exercises.some((e) => e.id === id)) return d;
    return { ...d, exercises: d.exercises.map((e) => (e.id === id ? { ...e, ...patch, id } : e)) };
  }, now);
}

export function moveExercise(s: Split, wd: Weekday, from: number, to: number, now: Timestamp): Split {
  return withDay(s, wd, (d) => {
    const n = d.exercises.length;
    if (from === to || from < 0 || to < 0 || from >= n || to >= n) return d;
    const list = d.exercises.slice();
    const [moved] = list.splice(from, 1);
    list.splice(to, 0, moved);
    return { ...d, exercises: list };
  }, now);
}

/** Inserts the copy right after the original. */
export function duplicateExercise(s: Split, wd: Weekday, id: string, now: Timestamp): Split {
  return withDay(s, wd, (d) => {
    const i = d.exercises.findIndex((e) => e.id === id);
    if (i < 0) return d;
    const list = d.exercises.slice();
    list.splice(i + 1, 0, copyEx(d.exercises[i]));
    return { ...d, exercises: list };
  }, now);
}

export function deleteExercise(s: Split, wd: Weekday, id: string, now: Timestamp): Split {
  return withDay(s, wd, (d) => (d.exercises.some((e) => e.id === id) ? { ...d, exercises: d.exercises.filter((e) => e.id !== id) } : d), now);
}

/** Replaces `to` with a copy of `from` (new exercise ids). */
export function copyDay(s: Split, from: Weekday, to: Weekday, now: Timestamp): Split {
  const src = s.days[from];
  if (!src || from === to) return s;
  return withDay(s, to, () => ({ kind: src.kind, name: src.name, exercises: src.exercises.map(copyEx) }), now);
}

/** Deep copy as a new archived split (new split and exercise ids). */
export function duplicateSplit(doc: SplitsDoc, id: string, name: string, now: Timestamp): { doc: SplitsDoc; newId: string } {
  const src = doc.splits.find((s) => s.id === id);
  if (!src) return { doc, newId: "" };
  const newId = uid("split");
  const copy: Split = {
    id: newId,
    name: name.trim() || `${src.name} copy`,
    days: src.days.map((d) => ({ kind: d.kind, name: d.name, exercises: d.exercises.map(copyEx) })),
    createdAt: now,
    updatedAt: now,
    archivedAt: now,
  };
  return { doc: { ...doc, splits: [...doc.splits, copy] }, newId };
}

/**
 * Makes `id` active from `today`; the previous active split is archived.
 * history gets {splitId, from: today}, replacing an entry with the same `from`.
 */
export function activateSplit(doc: SplitsDoc, id: string, today: ISODate, now: Timestamp): SplitsDoc {
  if (doc.activeId === id || !doc.splits.some((s) => s.id === id)) return doc;
  const splits = doc.splits.map((s) => {
    if (s.id === id) {
      const { archivedAt: _a, ...rest } = s;
      void _a;
      return { ...rest, updatedAt: now };
    }
    if (s.id === doc.activeId) return { ...s, archivedAt: now, updatedAt: now };
    return s;
  });
  const history = [...doc.history.filter((h) => h.from !== today), { splitId: id, from: today }];
  return { activeId: id, splits, history };
}

/** Can't delete the active split (returns doc unchanged). History entries stay (past days then read as unknown). */
export function deleteSplit(doc: SplitsDoc, id: string): SplitsDoc {
  if (id === doc.activeId || !doc.splits.some((s) => s.id === id)) return doc;
  return { ...doc, splits: doc.splits.filter((s) => s.id !== id) };
}

export function activeSplit(doc: SplitsDoc | null): Split | null {
  return doc?.splits.find((s) => s.id === doc.activeId) ?? null;
}

/** A split day from a coach proposal (new ids; missing weights → bodyweight; resolve them first). */
export function dayFromProposal(p: ProposedWorkout, prevName: string): DayPlan {
  const name = p.title?.trim() || (prevName && prevName !== "Rest" ? prevName : "Workout");
  return {
    kind: "workout",
    name,
    exercises: p.exercises.map((e) => ({
      id: uid("ex"),
      name: e.name,
      sets: e.sets,
      reps: { ...e.reps },
      weightKg: e.weightKg != null && e.weightKg > 0 ? e.weightKg : null,
    })),
  };
}
