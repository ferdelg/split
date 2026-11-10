/**
 * Records, streaks, calendar status, exercise history, volume. Pure: "today"
 * is always a parameter.
 */
import type {
  BestsDoc, DayPlan, DayStatus, ExerciseHistoryPoint, ExerciseRecord, FinishSummary, ISODate, MonthKey, MonthLog, PersonalBest, Session,
  SplitsDoc,
} from "../types";
import { addDays, monthOf, weekdayOf } from "../lib/date";

const KG_EPS = 0.01;
/** Safety bound for the streak walk (≈ 10 years). */
const MAX_STREAK_DAYS = 3660;

type DoneSet = { reps: number; weightKg: number | null };

/** Lowercased, trimmed, inner whitespace collapsed. Trailing "s" is kept (names are hers). */
export function normalizeName(name: string): string {
  return String(name ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

export function emptyBests(): BestsDoc {
  return { version: 1, through: null, records: {} };
}

/** repsAt key: kg rounded to 0.01 ("61.23"), "bw" for bodyweight. */
export function weightKey(kg: number | null): string {
  return kg == null ? "bw" : String(Math.round(kg * 100) / 100);
}

/** Completed sets of a session grouped by normalized name (skipped exercises excluded). */
function doneByName(s: Session): Map<string, { name: string; sets: DoneSet[] }> {
  const out = new Map<string, { name: string; sets: DoneSet[] }>();
  for (const e of s.exercises) {
    if (e.skipped) continue;
    const sets = e.sets.filter((x) => x.done).map((x) => ({ reps: x.reps, weightKg: x.weightKg }));
    if (!sets.length) continue;
    const key = normalizeName(e.name);
    if (!key) continue;
    const cur = out.get(key);
    if (cur) cur.sets.push(...sets);
    else out.set(key, { name: e.name.trim(), sets });
  }
  return out;
}

/** a is a heavier set than b (bodyweight is lightest; ties → more reps). */
function heavier(a: DoneSet, b: DoneSet | null): boolean {
  if (!b) return true;
  const wa = a.weightKg ?? -1;
  const wb = b.weightKg ?? -1;
  if (Math.abs(wa - wb) > KG_EPS) return wa > wb;
  return a.reps > b.reps;
}

/**
 * Records this session sets against `bests` (call BEFORE folding it in).
 * - No PBs for an exercise's first session.
 * - heaviest: a loaded set heavier than the record (+0.01 kg tolerance).
 * - reps: more reps than the record at the same weight (bodyweight: reps only).
 * - One per exercise per kind (the best set); heaviest wins for the same set.
 */
export function detectBests(s: Session, bests: BestsDoc): PersonalBest[] {
  const out: PersonalBest[] = [];
  for (const [key, { name, sets }] of doneByName(s)) {
    const rec = bests.records[key];
    if (!rec || rec.sessions < 1) continue;

    let heavySet: DoneSet | null = null;
    for (const x of sets) if (x.weightKg != null && heavier(x, heavySet)) heavySet = x;
    let heavyPB: DoneSet | null = null;
    if (heavySet && heavySet.weightKg != null) {
      const prev = rec.heaviest;
      if (!prev || prev.weightKg == null || heavySet.weightKg > prev.weightKg + KG_EPS) {
        heavyPB = heavySet;
        const pb: PersonalBest = { exercise: name, kind: "heaviest", weightKg: heavySet.weightKg, reps: heavySet.reps };
        if (prev) pb.previous = { weightKg: prev.weightKg, reps: prev.reps };
        out.push(pb);
      }
    }

    let repsPB: { set: DoneSet; prev: number } | null = null;
    for (const x of sets) {
      if (x === heavyPB) continue;
      const prev = rec.repsAt[weightKey(x.weightKg)];
      if (!prev || x.reps <= prev.reps) continue;
      if (!repsPB || heavier(x, repsPB.set)) repsPB = { set: x, prev: prev.reps };
    }
    if (repsPB) {
      out.push({
        exercise: name,
        kind: "reps",
        weightKg: repsPB.set.weightKg,
        reps: repsPB.set.reps,
        previous: { weightKg: repsPB.set.weightKg, reps: repsPB.prev },
      });
    }
  }
  return out;
}

/** Fold one finished session into the records (fold in date order). */
export function foldSession(bests: BestsDoc, s: Session): BestsDoc {
  const groups = doneByName(s);
  if (!groups.size) return bests;
  const records = { ...bests.records };
  for (const [key, { name, sets }] of groups) {
    const old = records[key];
    const rec: ExerciseRecord = old
      ? { ...old, repsAt: { ...old.repsAt } }
      : { name, heaviest: null, repsAt: {}, last: null, sessions: 0 };
    rec.name = name;
    for (const x of sets) {
      const cur = rec.heaviest ? { reps: rec.heaviest.reps, weightKg: rec.heaviest.weightKg } : null;
      if (heavier(x, cur)) rec.heaviest = { weightKg: x.weightKg, reps: x.reps, date: s.date };
      const wk = weightKey(x.weightKg);
      if (!rec.repsAt[wk] || x.reps > rec.repsAt[wk].reps) rec.repsAt[wk] = { reps: x.reps, date: s.date };
    }
    if (!rec.last || rec.last.date <= s.date) rec.last = { date: s.date, sets: sets.map((x) => ({ ...x })) };
    rec.sessions += 1;
    records[key] = rec;
  }
  const through = bests.through && bests.through > s.date ? bests.through : s.date;
  return { version: 1, through, records };
}

export function rebuildBests(sessions: Session[]): BestsDoc {
  return [...sessions].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0)).reduce(foldSession, emptyBests());
}

export function lastFor(name: string, bests: BestsDoc): ExerciseRecord["last"] {
  return bests.records[normalizeName(name)]?.last ?? null;
}

/** Σ reps × kg over completed loaded sets. */
export function volumeKg(s: Session): number {
  let v = 0;
  for (const e of s.exercises) {
    if (e.skipped) continue;
    for (const x of e.sets) if (x.done && x.weightKg != null && x.weightKg > 0) v += x.reps * x.weightKg;
  }
  return v;
}

function hasDone(s: Session | null | undefined): boolean {
  return !!s && s.exercises.some((e) => !e.skipped && e.sets.some((x) => x.done));
}

export function summarize(s: Session, bests: PersonalBest[], finishLine: string, weightsChanged: boolean): FinishSummary {
  let exercisesDone = 0;
  let totalSets = 0;
  for (const e of s.exercises) {
    if (e.skipped) continue;
    const n = e.sets.filter((x) => x.done).length;
    if (n) exercisesDone++;
    totalSets += n;
  }
  return { date: s.date, title: s.title, exercisesDone, totalSets, volumeKg: volumeKg(s), bests, finishLine, weightsChanged };
}

/** Every logged session, by date ascending. */
export function allSessions(logs: Record<MonthKey, MonthLog>): Session[] {
  const out: Session[] = [];
  for (const log of Object.values(logs)) if (log?.days) out.push(...Object.values(log.days));
  return out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

export function sessionOn(date: ISODate, logs: Record<MonthKey, MonthLog>): Session | null {
  return logs[monthOf(date)]?.days?.[date] ?? null;
}

/** The DayPlan of the split active on that date (splits.history), or null before tracking began. */
export function plannedOn(date: ISODate, doc: SplitsDoc | null): DayPlan | null {
  if (!doc) return null;
  let splitId: string | null = null;
  for (const h of doc.history) {
    if (h.from <= date) splitId = h.splitId;
    else break;
  }
  if (!splitId) return null;
  return doc.splits.find((s) => s.id === splitId)?.days[weekdayOf(date)] ?? null;
}

export function dayStatus(date: ISODate, today: ISODate, doc: SplitsDoc | null, logs: Record<MonthKey, MonthLog>, startedOn: ISODate): DayStatus {
  if (hasDone(sessionOn(date, logs))) return "done";
  if (date < startedOn) return "before-start";
  if (date === today) return "today";
  const workout = plannedOn(date, doc)?.kind === "workout";
  if (date > today) return workout ? "planned" : "rest";
  return workout ? "missed" : "rest";
}

/**
 * Walk back from today: today counts if done (not done yet doesn't break);
 * a planned workout day with a session adds 1; a rest day neither adds nor
 * breaks (an extra workout on it is a bonus); a missed workout day ends it;
 * stop at startedOn. A done day with no known plan (no split history) adds 1.
 */
export function streak(today: ISODate, doc: SplitsDoc | null, logs: Record<MonthKey, MonthLog>, startedOn: ISODate): number {
  let n = 0;
  let d = today;
  for (let i = 0; i < MAX_STREAK_DAYS && d >= startedOn; i++, d = addDays(d, -1)) {
    const plan = plannedOn(d, doc);
    const done = hasDone(sessionOn(d, logs));
    if (done) {
      if (!plan || plan.kind === "workout") n++;
      continue;
    }
    if (d === today) continue;
    if (plan?.kind === "workout") break;
  }
  return n;
}

/** Dates in the month with a finished session (≥ 1 completed set). */
export function gymDaysInMonth(month: MonthKey, logs: Record<MonthKey, MonthLog>): number {
  const log = logs[month];
  if (!log?.days) return 0;
  return Object.values(log.days).filter(hasDone).length;
}

export function exerciseHistory(name: string, logs: Record<MonthKey, MonthLog>): ExerciseHistoryPoint[] {
  const key = normalizeName(name);
  const out: ExerciseHistoryPoint[] = [];
  for (const s of allSessions(logs)) {
    const g = doneByName(s).get(key);
    if (!g) continue;
    let top: DoneSet | null = null;
    for (const x of g.sets) if (heavier(x, top)) top = x;
    out.push({ date: s.date, topKg: top!.weightKg, reps: top!.reps, sets: g.sets });
  }
  return out;
}

/** Most recent first, unique by normalizeName (display name from the latest session). */
export function loggedExerciseNames(logs: Record<MonthKey, MonthLog>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of allSessions(logs).reverse()) {
    for (const [key, g] of doneByName(s)) {
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(g.name);
    }
  }
  return out;
}

/** Finish lines of sessions in the 7 days before today, and today. */
export function recentFinishLines(today: ISODate, logs: Record<MonthKey, MonthLog>): string[] {
  const from = addDays(today, -7);
  return allSessions(logs)
    .filter((s) => s.date >= from && s.date <= today && typeof s.finishLine === "string" && s.finishLine)
    .map((s) => s.finishLine!);
}

/** Drop the 48 px thumbs of a month (used for months older than a year when space is tight). */
export function compactOldThumbs(log: MonthLog): MonthLog {
  let changed = false;
  const days: Record<ISODate, Session> = {};
  for (const [date, s] of Object.entries(log.days)) {
    if (s.thumb) {
      const { thumb: _t, ...rest } = s;
      void _t;
      days[date] = rest;
      changed = true;
    } else days[date] = s;
  }
  return changed ? { ...log, days } : log;
}
