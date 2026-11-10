/**
 * Defaults, and normalizers that make stored values safe to use (older
 * shapes, partial writes, junk). Pure.
 */
import { unpackMonthLog } from "./logCodec";
import type {
  BestsDoc, ChatMessage, DayPlan, ExerciseLog, ISODate, MonthKey, MonthLog, PlannedExercise, Profile, ReminderSettings,
  Session, Settings, Split, SplitsDoc, Timestamp, WeightUnit,
} from "../types";
import { DEFAULT_MODEL } from "../adapters/ai";
import { defaultReminders } from "../lib/reminders";
import { defaultStep } from "../lib/units";

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === "string";
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}$/;

export function defaultSettings(units: WeightUnit = "lb"): Settings {
  return {
    theme: "dark",
    reduceMotion: "system",
    textScale: 1,
    weightStep: defaultStep(units),
    model: DEFAULT_MODEL,
    reminders: defaultReminders(),
    dismissedBanners: [],
  };
}

export function defaultProfile(today: ISODate, now: Timestamp): Profile {
  return { name: "", units: "lb", startedOn: today, createdAt: now, updatedAt: now };
}

export function normalizeProfile(raw: unknown, today: ISODate, now: Timestamp): Profile | null {
  if (!isObj(raw)) return null;
  const p = raw as Partial<Profile>;
  const out: Profile = {
    name: isStr(p.name) ? p.name : "",
    units: p.units === "kg" ? "kg" : "lb",
    startedOn: isStr(p.startedOn) && ISO_RE.test(p.startedOn) ? p.startedOn : today,
    createdAt: isNum(p.createdAt) ? p.createdAt : now,
    updatedAt: isNum(p.updatedAt) ? p.updatedAt : now,
  };
  if (isNum(p.heightCm) && p.heightCm > 0) out.heightCm = p.heightCm;
  if (isNum(p.bodyWeightKg) && p.bodyWeightKg > 0) out.bodyWeightKg = p.bodyWeightKg;
  if (p.goal === "muscle" || p.goal === "fat" || p.goal === "consistent") out.goal = p.goal;
  if (isNum(p.onboardedAt)) out.onboardedAt = p.onboardedAt;
  return out;
}

function normalizeReminders(raw: unknown): ReminderSettings {
  const d = defaultReminders();
  if (!isObj(raw)) return d;
  const by = Array.isArray(raw.byWeekday) ? raw.byWeekday : [];
  return {
    enabled: raw.enabled !== false,
    byWeekday: d.byWeekday.map((def, i) => {
      const r = by[i];
      if (!isObj(r)) return def;
      return { on: r.on === true, time: isStr(r.time) && TIME_RE.test(r.time) ? r.time : def.time };
    }),
  };
}

export function normalizeSettings(raw: unknown, units: WeightUnit = "lb"): Settings {
  const d = defaultSettings(units);
  if (!isObj(raw)) return d;
  const s = raw as Partial<Settings>;
  return {
    theme: s.theme === "light" || s.theme === "system" || s.theme === "dark" ? s.theme : d.theme,
    reduceMotion: s.reduceMotion === "reduce" || s.reduceMotion === "full" || s.reduceMotion === "system" ? s.reduceMotion : d.reduceMotion,
    textScale: isNum(s.textScale) && s.textScale >= 1 && s.textScale <= 1.5 ? s.textScale : d.textScale,
    weightStep: isNum(s.weightStep) && s.weightStep > 0 && s.weightStep <= 50 ? s.weightStep : d.weightStep,
    model: isStr(s.model) && s.model.trim() ? s.model.trim() : d.model,
    reminders: normalizeReminders(s.reminders),
    dismissedBanners: Array.isArray(s.dismissedBanners) ? s.dismissedBanners.filter(isStr) : [],
  };
}

function normalizePlanned(raw: unknown, i: number): PlannedExercise | null {
  if (!isObj(raw) || !isStr(raw.name)) return null;
  const reps = isObj(raw.reps) && isNum(raw.reps.min) ? (raw.reps as { min: number; max?: number }) : { min: 8 };
  const ex: PlannedExercise = {
    id: isStr(raw.id) && raw.id ? raw.id : `ex_${i}`,
    name: raw.name,
    sets: isNum(raw.sets) ? Math.min(10, Math.max(1, Math.round(raw.sets))) : 3,
    reps: isNum(reps.max) && reps.max > reps.min ? { min: reps.min, max: reps.max } : { min: reps.min },
    weightKg: isNum(raw.weightKg) && raw.weightKg > 0 ? raw.weightKg : null,
  };
  if (isStr(raw.note) && raw.note) ex.note = raw.note;
  return ex;
}

function normalizeDayPlan(raw: unknown): DayPlan {
  if (!isObj(raw) || raw.kind !== "workout") return { kind: "rest", name: isObj(raw) && isStr(raw.name) && raw.name ? raw.name : "Rest", exercises: [] };
  const list = Array.isArray(raw.exercises) ? raw.exercises : [];
  return {
    kind: "workout",
    name: isStr(raw.name) && raw.name ? raw.name : "Workout",
    exercises: list.map(normalizePlanned).filter((x): x is PlannedExercise => !!x),
  };
}

function normalizeSplit(raw: unknown, now: Timestamp): Split | null {
  if (!isObj(raw) || !isStr(raw.id)) return null;
  const days = Array.isArray(raw.days) ? raw.days : [];
  const s: Split = {
    id: raw.id,
    name: isStr(raw.name) && raw.name ? raw.name : "My split",
    days: Array.from({ length: 7 }, (_, i) => normalizeDayPlan(days[i])),
    createdAt: isNum(raw.createdAt) ? raw.createdAt : now,
    updatedAt: isNum(raw.updatedAt) ? raw.updatedAt : now,
  };
  if (isNum(raw.archivedAt)) s.archivedAt = raw.archivedAt;
  return s;
}

/**
 * A usable SplitsDoc or null. Repairs: an activeId that doesn't exist (first
 * split becomes active) and a missing history (the active split counts from
 * the beginning; profile.startedOn bounds every look-back anyway).
 */
export function normalizeSplits(raw: unknown, now: Timestamp): SplitsDoc | null {
  if (!isObj(raw) || !Array.isArray(raw.splits)) return null;
  const splits = raw.splits.map((s) => normalizeSplit(s, now)).filter((s): s is Split => !!s);
  if (!splits.length) return null;
  let activeId = isStr(raw.activeId) && splits.some((s) => s.id === raw.activeId) ? raw.activeId : splits[0].id;
  const history = (Array.isArray(raw.history) ? raw.history : [])
    .filter((h): h is { splitId: string; from: string } => isObj(h) && isStr(h.splitId) && isStr(h.from) && ISO_RE.test(h.from))
    .map((h) => ({ splitId: h.splitId, from: h.from }))
    .sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0));
  if (!history.length) history.push({ splitId: activeId, from: "1970-01-01" });
  return {
    activeId,
    splits: splits.map((s) => {
      if (s.id === activeId) {
        const { archivedAt: _drop, ...rest } = s;
        void _drop;
        return rest;
      }
      return s.archivedAt ? s : { ...s, archivedAt: s.updatedAt };
    }),
    history,
  };
}

function normalizeExerciseLog(raw: unknown): ExerciseLog | null {
  if (!isObj(raw) || !isStr(raw.id) || !isStr(raw.name) || !Array.isArray(raw.sets)) return null;
  const reps = isObj(raw.reps) && isNum(raw.reps.min) ? (raw.reps as { min: number; max?: number }) : { min: 8 };
  return {
    ...(raw as unknown as ExerciseLog),
    reps,
    sets: raw.sets
      .filter(isObj)
      .map((s) => {
        const set = { reps: isNum(s.reps) ? s.reps : 0, weightKg: isNum(s.weightKg) && s.weightKg > 0 ? s.weightKg : null, done: s.done === true } as ExerciseLog["sets"][number];
        if (isNum(s.doneAt)) set.doneAt = s.doneAt;
        return set;
      }),
    source: raw.source === "added" || raw.source === "swapped" || raw.source === "coach" ? raw.source : "plan",
  };
}

export function normalizeSession(raw: unknown): Session | null {
  if (!isObj(raw) || !isStr(raw.id) || !isStr(raw.date) || !ISO_RE.test(raw.date)) return null;
  const from = isObj(raw.from) && isStr(raw.from.splitId) && isNum(raw.from.weekday) ? (raw.from as Session["from"]) : null;
  return {
    ...(raw as unknown as Session),
    title: isStr(raw.title) ? raw.title : "Workout",
    from,
    exercises: (Array.isArray(raw.exercises) ? raw.exercises : []).map(normalizeExerciseLog).filter((e): e is ExerciseLog => !!e),
    startedAt: isNum(raw.startedAt) ? raw.startedAt : 0,
  };
}

export function normalizeMonthLog(stored: unknown, month: MonthKey): MonthLog {
  const out: MonthLog = { month, days: {} };
  const raw = unpackMonthLog(stored);
  if (!isObj(raw) || !isObj(raw.days)) return out;
  for (const [date, v] of Object.entries(raw.days)) {
    const s = normalizeSession(v);
    if (s && date.startsWith(month)) out.days[date] = { ...s, date };
  }
  return out;
}

/** null when missing or from another derivation version (→ rebuild). */
export function normalizeBests(raw: unknown): BestsDoc | null {
  if (!isObj(raw) || raw.version !== 1 || !isObj(raw.records)) return null;
  return { version: 1, through: isStr(raw.through) ? raw.through : null, records: raw.records as BestsDoc["records"] };
}

export function normalizeChat(raw: unknown): ChatMessage[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((m): m is ChatMessage => isObj(m) && isStr(m.id) && (m.role === "user" || m.role === "assistant") && isStr(m.text));
}
