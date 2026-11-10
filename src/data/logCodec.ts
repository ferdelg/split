/**
 * Compact on-disk form for `logs/YYYY-MM` (finished sessions).
 *
 * A finished Session as plain JSON is ~1.9–3 KB, mostly long key names,
 * full-precision kilograms (61.234969950000004) and a doneAt per set. Three
 * years of five-day weeks then overflow the 2 MB user quota. This packs a
 * session to roughly a third of that, losslessly for everything the app uses:
 *
 * - weights are kept to 0.0001 kg (0.0002 lb), far below display precision;
 * - per-set doneAt is dropped (nothing reads it after a session is finished);
 * - consecutive identical sets are run-length encoded: [reps, kg, count];
 * - an exercise's planExerciseId is omitted when it equals its id, and
 *   packed as "" when the exercise has none (added or coach exercises).
 *
 * Only logs use it. `active` (the in-progress session) stays plain JSON, and
 * in memory everything is a normal Session. Old, unpacked months still load:
 * unpackMonthLog returns the raw value unchanged when it isn't packed, and the
 * normalizers take it from there.
 */
import type { ExerciseLog, ExerciseSource, MonthLog, PersonalBest, Session } from "../types";

export const LOG_CODEC_VERSION = 2;

const SRC: Record<ExerciseSource, string> = { plan: "", added: "a", swapped: "s", coach: "c" };
const SRC_BACK: Record<string, ExerciseSource> = { a: "added", s: "swapped", c: "coach" };

/** kg → 4 decimals; null (bodyweight) stays null. */
const kg = (v: number | null): number | null => (v == null ? null : Math.round(v * 10_000) / 10_000);

type PackedSet = [number, number | null] | [number, number | null, number] | [number, number | null, number, 0];

interface PackedExercise {
  i: string;
  n: string;
  r: [number] | [number, number];
  s: PackedSet[];
  o?: string; // source
  w?: string; // swappedFrom
  k?: 1; // skipped
  t?: string; // note
  p?: string; // planExerciseId when ≠ id; "" = none
}

interface PackedSession {
  i: string;
  t: string;
  f?: [string, number];
  c?: 1;
  e: PackedExercise[];
  a: number;
  z?: number;
  n?: string;
  ph?: string;
  th?: string;
  fl?: string;
  b?: [string, 0 | 1, number | null, number, (number | null)?, number?][];
}

export interface PackedMonthLog {
  v: typeof LOG_CODEC_VERSION;
  m: string;
  d: Record<string, PackedSession>;
}

function packSets(sets: ExerciseLog["sets"]): PackedSet[] {
  const out: PackedSet[] = [];
  let i = 0;
  while (i < sets.length) {
    const s = sets[i];
    const w = kg(s.weightKg);
    let n = 1;
    while (i + n < sets.length && sets[i + n].done === s.done && sets[i + n].reps === s.reps && kg(sets[i + n].weightKg) === w) n++;
    if (!s.done) out.push([s.reps, w, n, 0]);
    else out.push(n > 1 ? [s.reps, w, n] : [s.reps, w]);
    i += n;
  }
  return out;
}

function unpackSets(packed: unknown): ExerciseLog["sets"] {
  const out: ExerciseLog["sets"] = [];
  if (!Array.isArray(packed)) return out;
  for (const p of packed) {
    if (!Array.isArray(p)) continue;
    const reps = typeof p[0] === "number" ? p[0] : 0;
    const weightKg = typeof p[1] === "number" && p[1] > 0 ? p[1] : null;
    const count = typeof p[2] === "number" && p[2] >= 1 ? Math.min(50, Math.floor(p[2])) : 1;
    const done = p[3] !== 0;
    for (let k = 0; k < count; k++) out.push({ reps, weightKg, done });
  }
  return out;
}

export function packSession(s: Session): PackedSession {
  const out: PackedSession = {
    i: s.id,
    t: s.title,
    e: s.exercises.map((ex) => {
      const pe: PackedExercise = {
        i: ex.id,
        n: ex.name,
        r: ex.reps.max != null ? [ex.reps.min, ex.reps.max] : [ex.reps.min],
        s: packSets(ex.sets),
      };
      if (SRC[ex.source]) pe.o = SRC[ex.source];
      if (ex.swappedFrom) pe.w = ex.swappedFrom;
      if (ex.skipped) pe.k = 1;
      if (ex.note) pe.t = ex.note;
      if (!ex.planExerciseId) pe.p = "";
      else if (ex.planExerciseId !== ex.id) pe.p = ex.planExerciseId;
      return pe;
    }),
    a: s.startedAt,
  };
  if (s.from) out.f = [s.from.splitId, s.from.weekday];
  if (s.coachAdjusted) out.c = 1;
  if (s.finishedAt != null) out.z = s.finishedAt;
  if (s.note) out.n = s.note;
  if (s.photoId) out.ph = s.photoId;
  if (s.thumb) out.th = s.thumb;
  if (s.finishLine) out.fl = s.finishLine;
  if (s.bests?.length) {
    out.b = s.bests.map((b) => {
      const row: NonNullable<PackedSession["b"]>[number] = [b.exercise, b.kind === "heaviest" ? 0 : 1, kg(b.weightKg), b.reps];
      if (b.previous) row.push(kg(b.previous.weightKg), b.previous.reps);
      return row;
    });
  }
  return out;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);

/** A plain Session-shaped object (still passed through normalizeSession by the caller). */
export function unpackSession(p: unknown, date: string): Record<string, unknown> | null {
  if (!isObj(p) || typeof p.i !== "string") return null;
  const exercises = (Array.isArray(p.e) ? p.e : []).filter(isObj).map((e) => {
    const r = Array.isArray(e.r) ? e.r : [];
    const ex: Record<string, unknown> = {
      id: str(e.i) ?? "",
      name: str(e.n) ?? "",
      reps: typeof r[1] === "number" ? { min: r[0], max: r[1] } : { min: typeof r[0] === "number" ? r[0] : 8 },
      sets: unpackSets(e.s),
      source: SRC_BACK[str(e.o) ?? ""] ?? "plan",
    };
    if (e.p !== "") ex.planExerciseId = str(e.p) ?? str(e.i);
    if (e.w) ex.swappedFrom = str(e.w);
    if (e.k) ex.skipped = true;
    if (e.t) ex.note = str(e.t);
    return ex;
  });
  const s: Record<string, unknown> = {
    id: p.i,
    date,
    title: str(p.t) ?? "Workout",
    from: Array.isArray(p.f) && typeof p.f[0] === "string" && typeof p.f[1] === "number" ? { splitId: p.f[0], weekday: p.f[1] } : null,
    exercises,
    startedAt: typeof p.a === "number" ? p.a : 0,
  };
  if (p.c) s.coachAdjusted = true;
  if (typeof p.z === "number") s.finishedAt = p.z;
  if (p.n) s.note = str(p.n);
  if (p.ph) s.photoId = str(p.ph);
  if (p.th) s.thumb = str(p.th);
  if (p.fl) s.finishLine = str(p.fl);
  if (Array.isArray(p.b)) {
    s.bests = p.b.filter(Array.isArray).map((row): PersonalBest => {
      const b: PersonalBest = { exercise: String(row[0]), kind: row[1] === 0 ? "heaviest" : "reps", weightKg: typeof row[2] === "number" ? row[2] : null, reps: Number(row[3]) || 0 };
      if (row.length > 4) b.previous = { weightKg: typeof row[4] === "number" ? row[4] : null, reps: Number(row[5]) || 0 };
      return b;
    });
  }
  return s;
}

export function packMonthLog(log: MonthLog): PackedMonthLog {
  const d: Record<string, PackedSession> = {};
  for (const [date, s] of Object.entries(log.days)) d[date] = packSession(s);
  return { v: LOG_CODEC_VERSION, m: log.month, d };
}

export function isPackedMonthLog(raw: unknown): raw is PackedMonthLog {
  return isObj(raw) && raw.v === LOG_CODEC_VERSION && isObj(raw.d);
}

/** Packed → `{month, days}` of plain session objects; anything else is returned unchanged (legacy plain logs). */
export function unpackMonthLog(raw: unknown): unknown {
  if (!isPackedMonthLog(raw)) return raw;
  const days: Record<string, unknown> = {};
  for (const [date, p] of Object.entries(raw.d)) {
    const s = unpackSession(p, date);
    if (s) days[date] = s;
  }
  return { month: raw.m, days };
}
