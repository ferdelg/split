/**
 * Every state change the UI can make (AppActions). State updates at once;
 * the store write is coalesced (store.ts). This is the only module that
 * writes app data to the store. The API key is never written here.
 */
import type {
  AppActions, ChatMessage, CoachMode, ExerciseLog, MonthLog, PlannedExercise, ProposedWorkout, Session, Settings, Split, SplitsDoc,
  Timestamp, Toast,
} from "../types";
import { setApiKey } from "../adapters/ai";
import { buildCoachContext } from "../coach/context";
import { runCoachTurn, trimChat } from "../coach/coach";
import { WEEKDAY_NAMES, monthOf, weekdayOf } from "../lib/date";
import { pickFinishLine } from "../lib/finishLines";
import { uid } from "../lib/ids";
import { defaultStep } from "../lib/units";
import { buildExport } from "./exportData";
import { defaultSettings, normalizeMonthLog } from "./defaults";
import { detectBests, emptyBests, foldSession, lastFor, normalizeName, recentFinishLines, sessionOn, summarize } from "./history";
import { K, chatKey, logKey } from "./keys";
import * as S from "./session";
import * as SP from "./split";
import {
  getState, now, pruneDismissed, pushToast, refreshBanners, refreshCaps, removeToast, services, setState, syncReminders,
} from "./state";
import { buildTemplate } from "./templates";

const ts = (): Timestamp => now().getTime();
const store = () => services().store;

// ── helpers ────────────────────────────────────────────────────────────────

function commitSplits(doc: SplitsDoc): void {
  setState({ splits: doc });
  store().set(K.splits, doc);
  syncReminders();
  refreshBanners();
}

/** Edit the active split (archived splits are read-only). */
function editActive(fn: (s: Split, t: Timestamp) => Split): void {
  const doc = getState().splits;
  const split = SP.activeSplit(doc);
  if (!doc || !split) return;
  const next = fn(split, ts());
  if (next === split) return;
  commitSplits({ ...doc, splits: doc.splits.map((x) => (x.id === split.id ? next : x)) });
}

function commitSettings(patch: Partial<Settings>): Settings {
  const settings = { ...getState().settings, ...patch };
  setState({ settings });
  store().set(K.settings, settings);
  return settings;
}

function commitActive(s: Session | null): void {
  setState({ active: s });
  if (s) store().set(K.active, s);
  else void store().delete(K.active);
}

function commitChat(chat: ChatMessage[]): void {
  setState({ chat });
  const key = chatKey(getState().today);
  if (chat.length) store().set(key, chat);
  else void store().delete(key);
}

/** Write a month log (state + store), loading it first if it isn't in memory. */
function updateLog(month: string, fn: (log: MonthLog) => MonthLog): void {
  const apply = (base: MonthLog) => {
    const next = fn(base);
    setState((s) => ({ logs: { ...s.logs, [month]: next } }));
    store().set(logKey(month), next);
  };
  const inMem = getState().logs[month];
  if (inMem) return apply(inMem);
  // Not loaded (e.g. a stale session from an older month): never overwrite unseen data.
  void store()
    .load<unknown>(logKey(month))
    .then((raw) => apply(getState().logs[month] ?? normalizeMonthLog(raw, month)));
}

/** Heaviest weight of her last session of that exercise, or null. */
function lastTopKg(name: string): number | null {
  let top: number | null = null;
  for (const x of lastFor(name, getState().bests)?.sets ?? []) if (x.weightKg != null && (top == null || x.weightKg > top)) top = x.weightKg;
  return top;
}

/** First planned weight for that exercise name anywhere in the active split. */
function splitWeightFor(name: string): number | null {
  const key = normalizeName(name);
  for (const d of SP.activeSplit(getState().splits)?.days ?? []) {
    for (const e of d.exercises) if (normalizeName(e.name) === key && e.weightKg != null) return e.weightKg;
  }
  return null;
}

/** The exercise by session id, or by the planned exercise id it came from. */
function findEx(s: Session, id: string): ExerciseLog | undefined {
  return s.exercises.find((e) => e.id === id) ?? s.exercises.find((e) => e.planExerciseId === id);
}

function startSession(session: Session): Session {
  commitActive(session);
  void services().wakeLock.acquire().catch(() => {});
  return session;
}

/** The active session, or a new one from today's (or the picked day's) plan. */
function ensureSession(): Session {
  const st = getState();
  if (st.active) return st.active;
  const { planWeekday, split, plan } = S.resolveToday(st.today, st.splits, st.pickedWeekday);
  if (!split || !plan || plan.kind !== "workout") return startSession(S.extraSession(st.today, "Extra workout", ts()));
  return startSession(S.sessionFromPlan(st.today, plan, { splitId: split.id, weekday: planWeekday }, ts()));
}

/** Run a session edit on the exercise `exId` (session started if needed). */
function onExercise(exId: string, fn: (s: Session, id: string) => Session): { before?: ExerciseLog; after?: ExerciseLog } {
  const s = ensureSession();
  const ex = findEx(s, exId);
  if (!ex) return {};
  const next = fn(s, ex.id);
  if (next !== s) commitActive(next);
  return { before: ex, after: next.exercises.find((e) => e.id === ex.id) };
}

/** Celebrate a set that just became done; the exercise if it just completed. */
function celebrate(before: ExerciseLog | undefined, after: ExerciseLog | undefined, setIndex: number): void {
  if (!before || !after) return;
  const at = ts();
  if (S.isExerciseComplete(after) && !S.isExerciseComplete(before)) {
    setState({ celebration: { kind: "exercise", exerciseId: after.id, at } });
  } else if (after.sets[setIndex]?.done && !before.sets[setIndex]?.done) {
    setState({ celebration: { kind: "set", exerciseId: after.id, setIndex, at } });
  }
}

function updateMessage(id: string, fn: (m: ChatMessage) => ChatMessage): ChatMessage | null {
  let found: ChatMessage | null = null;
  const chat = getState().chat.map((m) => {
    if (m.id !== id) return m;
    found = fn(m);
    return found;
  });
  if (found) commitChat(chat);
  return found;
}

/** A proposal with every missing weight resolved (applied session, records, split). */
function resolvedProposal(p: ProposedWorkout): ProposedWorkout {
  const active = getState().active;
  return {
    ...p,
    exercises: p.exercises.map((e) => {
      if (e.weightKg != null && e.weightKg > 0) return e;
      const inSession = active?.exercises.find((x) => normalizeName(x.name) === normalizeName(e.name));
      const w = inSession?.sets.find((x) => x.weightKg != null)?.weightKg ?? lastTopKg(e.name) ?? splitWeightFor(e.name);
      return w != null ? { ...e, weightKg: w } : e;
    }),
  };
}

// ── actions ────────────────────────────────────────────────────────────────

export const actions: AppActions = {
  // navigation + toasts
  setTab(tab) {
    setState({ tab });
  },
  toast(text, kind: Toast["kind"] = "info", action) {
    pushToast(action ? { text, kind, action } : { text, kind });
  },
  dismissToast(id) {
    removeToast(id);
  },
  clearCelebration() {
    if (getState().celebration) setState({ celebration: null });
  },

  // onboarding + profile + settings
  completeOnboarding(input) {
    const t = ts();
    const st = getState();
    const today = st.today;
    const prev = st.profile;
    const profile = {
      name: input.name.trim(),
      units: input.units,
      startedOn: prev?.startedOn ?? today,
      onboardedAt: t,
      createdAt: prev?.createdAt ?? t,
      updatedAt: t,
      ...(input.heightCm && input.heightCm > 0 ? { heightCm: input.heightCm } : {}),
      ...(input.bodyWeightKg && input.bodyWeightKg > 0 ? { bodyWeightKg: input.bodyWeightKg } : {}),
      ...(input.goal ? { goal: input.goal } : {}),
    };
    const split = buildTemplate(input.template, input.units, t);
    const doc: SplitsDoc = st.splits
      ? SP.activateSplit({ ...st.splits, splits: [...st.splits.splits, { ...split, archivedAt: t }] }, split.id, today, t)
      : { activeId: split.id, splits: [split], history: [{ splitId: split.id, from: today }] };
    setState({ profile, tab: "today", pickedWeekday: null });
    store().set(K.profile, profile);
    commitSettings({ weightStep: defaultStep(input.units) });
    commitSplits(doc);
  },
  updateProfile(patch) {
    const p = getState().profile;
    if (!p) return;
    const next = { ...p, ...patch, createdAt: p.createdAt, updatedAt: ts() };
    setState({ profile: next });
    store().set(K.profile, next);
    // Units changed and the step was the old unit's default → use the new unit's default.
    if (patch.units && patch.units !== p.units && getState().settings.weightStep === defaultStep(p.units)) {
      commitSettings({ weightStep: defaultStep(patch.units) });
    }
  },
  updateSettings(patch) {
    commitSettings(patch);
    if (patch.reminders) syncReminders();
    if (patch.reminders || patch.dismissedBanners) refreshBanners();
  },
  setReminder(weekday, patch) {
    const r = getState().settings.reminders;
    const byWeekday = r.byWeekday.map((d, i) => (i === weekday ? { ...d, ...patch } : d));
    actions.updateSettings({ reminders: { ...r, byWeekday } });
  },
  dismissBanner(id) {
    const st = getState();
    const entry = `${id}@${st.today}`;
    const list = pruneDismissed(st.settings.dismissedBanners, st.today).filter((x) => x !== entry);
    commitSettings({ dismissedBanners: [...list, entry] });
    refreshBanners();
  },

  // split editing
  renameDay(weekday, name) {
    editActive((s, t) => SP.renameDay(s, weekday, name, t));
  },
  setDayKind(weekday, kind) {
    editActive((s, t) => SP.setDayKind(s, weekday, kind, t));
  },
  addExercise(weekday, ex) {
    editActive((s, t) => SP.addExercise(s, weekday, { ...ex, id: uid("ex") } as PlannedExercise, t));
  },
  updateExercise(weekday, exerciseId, patch) {
    editActive((s, t) => SP.updateExercise(s, weekday, exerciseId, patch, t));
  },
  moveExercise(weekday, from, to) {
    editActive((s, t) => SP.moveExercise(s, weekday, from, to, t));
  },
  duplicateExercise(weekday, exerciseId) {
    editActive((s, t) => SP.duplicateExercise(s, weekday, exerciseId, t));
  },
  deleteExercise(weekday, exerciseId) {
    editActive((s, t) => SP.deleteExercise(s, weekday, exerciseId, t));
  },
  copyDay(from, to) {
    editActive((s, t) => SP.copyDay(s, from, to, t));
  },
  renameSplit(splitId, name) {
    const doc = getState().splits;
    const n = name.trim();
    if (!doc || !n) return;
    const t = ts();
    commitSplits({ ...doc, splits: doc.splits.map((s) => (s.id === splitId ? { ...s, name: n, updatedAt: t } : s)) });
  },
  duplicateSplit(splitId, name) {
    const doc = getState().splits;
    if (!doc) return "";
    const src = doc.splits.find((s) => s.id === splitId);
    if (!src) return "";
    const r = SP.duplicateSplit(doc, splitId, name ?? `${src.name} copy`, ts());
    commitSplits(r.doc);
    return r.newId;
  },
  activateSplit(splitId) {
    const st = getState();
    if (!st.splits) return;
    const next = SP.activateSplit(st.splits, splitId, st.today, ts());
    if (next !== st.splits) {
      commitSplits(next);
      if (!st.active) setState({ pickedWeekday: null });
    }
  },
  deleteSplit(splitId) {
    const doc = getState().splits;
    if (!doc) return;
    const next = SP.deleteSplit(doc, splitId);
    if (next !== doc) commitSplits(next);
  },

  // today
  pickWeekday(weekday) {
    const st = getState();
    if (st.active) return;
    setState({ pickedWeekday: weekday == null || weekday === weekdayOf(st.today) ? null : weekday });
  },
  startWorkout(opts) {
    const st = getState();
    if (st.active) return;
    if (opts?.extra) {
      startSession(S.extraSession(st.today, opts.title ?? "Extra workout", ts()));
      return;
    }
    const s = ensureSession();
    if (opts?.title && s.from === null) commitActive({ ...s, title: opts.title.trim() || s.title });
  },
  completeSet(exerciseId, setIndex) {
    const r = onExercise(exerciseId, (s, id) => S.completeSet(s, id, setIndex, ts()));
    celebrate(r.before, r.after, setIndex);
  },
  uncompleteSet(exerciseId, setIndex) {
    if (!getState().active) return;
    onExercise(exerciseId, (s, id) => S.uncompleteSet(s, id, setIndex));
  },
  editSet(exerciseId, setIndex, patch) {
    const r = onExercise(exerciseId, (s, id) => S.editSet(s, id, setIndex, patch, ts()));
    celebrate(r.before, r.after, setIndex);
  },
  markAll(exerciseId) {
    const r = onExercise(exerciseId, (s, id) => S.markAll(s, id, ts()));
    if (r.after && r.before && !S.isExerciseComplete(r.before) && S.isExerciseComplete(r.after)) {
      setState({ celebration: { kind: "exercise", exerciseId: r.after.id, at: ts() } });
    }
  },
  addSet(exerciseId) {
    onExercise(exerciseId, (s, id) => S.addSet(s, id));
  },
  removeSet(exerciseId) {
    onExercise(exerciseId, (s, id) => S.removeSet(s, id));
  },
  skipExercise(exerciseId, skipped) {
    onExercise(exerciseId, (s, id) => S.skipExercise(s, id, skipped));
  },
  swapExercise(exerciseId, newName) {
    onExercise(exerciseId, (s, id) => S.swapExercise(s, id, newName, lastTopKg(newName) ?? splitWeightFor(newName)));
  },
  addTodayExercise(name, sets = 3, reps = { min: 10 }, weightKg) {
    const w = weightKg !== undefined ? weightKg : lastTopKg(name) ?? splitWeightFor(name);
    const s = ensureSession();
    const next = S.addTodayExercise(s, name, sets, reps, w);
    if (next !== s) commitActive(next);
  },
  setSessionNote(note) {
    const s = ensureSession();
    const n = note.slice(0, 140);
    const next: Session = { ...s };
    if (n.trim()) next.note = n;
    else delete next.note;
    commitActive(next);
  },
  async setSessionPhoto(file) {
    const s = ensureSession();
    const { media } = services();
    try {
      const saved = await media.savePhoto(s.date, file);
      const cur = getState().active;
      if (!cur || cur.id !== s.id) {
        // The workout was finished or discarded meanwhile: attach to its log, if any.
        const logged = sessionOn(s.date, getState().logs);
        if (logged && logged.id === s.id) {
          updateLog(monthOf(s.date), (log) => ({ ...log, days: { ...log.days, [s.date]: { ...logged, photoId: saved.photoId, thumb: saved.thumb } } }));
        } else void media.deletePhoto(saved.photoId);
        return;
      }
      const old = cur.photoId;
      commitActive({ ...cur, photoId: saved.photoId, thumb: saved.thumb });
      // One photo per day: the new one replaces the old.
      if (old && old !== saved.photoId) void media.deletePhoto(old).catch(() => {});
    } catch (e) {
      console.warn("[split] photo failed", e);
      pushToast({ text: "Couldn't add that photo. Try another one.", kind: "error" });
    }
  },
  async removeSessionPhoto() {
    const s = getState().active;
    if (!s?.photoId && !s?.thumb) return;
    const { photoId: id, thumb: _t, ...rest } = s;
    void _t;
    commitActive(rest);
    if (id) await services().media.deletePhoto(id).catch(() => {});
  },
  finishWorkout() {
    const st = getState();
    const s = st.active;
    if (!s) return;
    if (S.completedSets(s) === 0) {
      pushToast({ text: "Complete a set first, or discard.", kind: "info" });
      return;
    }
    const t = ts();
    let fin = S.finalizeSession(s, t);
    const pbs = detectBests(fin, st.bests);
    const bests = foldSession(st.bests, fin);
    const finishLine = pickFinishLine(recentFinishLines(st.today, st.logs));
    fin = { ...fin, bests: pbs, finishLine };
    const split = st.splits?.splits.find((x) => x.id === s.from?.splitId) ?? null;
    const summary = summarize(fin, pbs, finishLine, S.weightsChanged(fin, split));
    // A stale session from an earlier date goes to ITS month and date.
    updateLog(monthOf(fin.date), (log) => {
      const existing = log.days[fin.date];
      // One session per date: a second one that day is merged into the first.
      const merged: Session = existing
        ? { ...existing, exercises: [...existing.exercises, ...fin.exercises], bests: [...(existing.bests ?? []), ...pbs], finishLine, finishedAt: t, note: fin.note ?? existing.note, photoId: fin.photoId ?? existing.photoId, thumb: fin.thumb ?? existing.thumb }
        : fin;
      return { ...log, days: { ...log.days, [fin.date]: merged } };
    });
    setState({ bests, summary, pickedWeekday: null, celebration: { kind: "finish", pb: pbs.length > 0, at: t } });
    store().set(K.bests, bests);
    commitActive(null);
    void services().wakeLock.release().catch(() => {});
    refreshBanners();
  },
  discardWorkout() {
    const s = getState().active;
    if (!s) return;
    commitActive(null);
    setState({ pickedWeekday: null });
    if (s.photoId) void services().media.deletePhoto(s.photoId).catch(() => {});
    void services().wakeLock.release().catch(() => {});
    refreshBanners();
  },
  dismissSummary() {
    setState({ summary: null });
  },
  saveWeightsToSplit() {
    const st = getState();
    const sum = st.summary;
    if (!sum) return;
    const s = sessionOn(sum.date, st.logs);
    const doc = st.splits;
    const split = SP.activeSplit(doc);
    if (!s?.from || !doc || !split || split.id !== s.from.splitId) {
      pushToast({ text: "That workout isn't from your current split.", kind: "info" });
      return;
    }
    const wd = s.from.weekday;
    let next = split;
    const t = ts();
    for (const e of s.exercises) {
      if (e.skipped || e.source !== "plan" || !e.planExerciseId) continue;
      const done = e.sets.filter((x) => x.done);
      if (!done.length) continue;
      let top: number | null = null;
      for (const x of done) if (x.weightKg != null && (top == null || x.weightKg > top)) top = x.weightKg;
      next = SP.updateExercise(next, wd, e.planExerciseId, { weightKg: top }, t);
    }
    if (next !== split) commitSplits({ ...doc, splits: doc.splits.map((x) => (x.id === split.id ? next : x)) });
    setState({ summary: { ...sum, weightsChanged: false } });
    pushToast({ text: `Saved to ${WEEKDAY_NAMES[wd]} in your split.`, kind: "success" });
  },
  setLoggedNote(date, note) {
    const s = sessionOn(date, getState().logs);
    if (!s) return;
    const n = note.slice(0, 140);
    const next: Session = { ...s };
    if (n.trim()) next.note = n;
    else delete next.note;
    updateLog(monthOf(date), (log) => ({ ...log, days: { ...log.days, [date]: next } }));
  },

  // coach
  async sendCoach(text, mode: CoachMode = "chat") {
    const t = text.trim();
    const st = getState();
    if (!t || st.chatBusy) return;
    const history = st.chat;
    const user: ChatMessage = { id: uid("m"), role: "user", text: t, at: ts() };
    setState({ chat: [...history, user], chatBusy: true });
    const { ai } = services();
    let reply: ChatMessage;
    let error: { code?: string; message: string } | undefined;
    try {
      const r = await runCoachTurn(
        { ai, unit: getState().profile?.units ?? "lb", now: () => now().getTime() },
        buildCoachContext(getState()),
        history,
        t,
        mode,
      );
      reply = r.reply;
      error = r.error;
    } catch (e) {
      console.warn("[split] coach turn failed", e);
      const message = "The coach couldn't answer. Try again.";
      reply = { id: uid("m"), role: "assistant", text: message, at: ts(), error: true };
      error = { message };
    }
    commitChat(trimChat([...getState().chat, reply]));
    setState({ chatBusy: false, coachError: error ?? null });
    refreshCaps();
  },
  applyProposal(messageId) {
    const st = getState();
    const msg = st.chat.find((m) => m.id === messageId);
    if (!msg?.proposal) return;
    if (st.active && st.active.date !== st.today) {
      pushToast({ text: `Finish or discard ${WEEKDAY_NAMES[weekdayOf(st.active.date)]}'s workout first.`, kind: "info" });
      return;
    }
    const { status: _s, ...p } = msg.proposal;
    void _s;
    let session = S.applyProposalToSession(st.today, p, st.active, st.bests, splitWeightFor, ts());
    if (!st.active) {
      // Today's plan was replaced: remember which split day it stood in for.
      const { split, planWeekday } = S.resolveToday(st.today, st.splits, st.pickedWeekday);
      if (split) session = { ...session, from: { splitId: split.id, weekday: planWeekday } };
      startSession(session);
    } else commitActive(session);
    updateMessage(messageId, (m) => ({ ...m, proposal: { ...m.proposal!, status: "applied" } }));
  },
  keepPlan(messageId) {
    updateMessage(messageId, (m) => (m.proposal ? { ...m, proposal: { ...m.proposal, status: "kept" } } : m));
  },
  saveProposalToSplit(messageId) {
    const st = getState();
    const msg = st.chat.find((m) => m.id === messageId);
    const doc = st.splits;
    const split = SP.activeSplit(doc);
    if (!msg?.proposal || !doc || !split) return;
    const wd = weekdayOf(st.today);
    const { status: _s, ...p } = msg.proposal;
    void _s;
    const day = SP.dayFromProposal(resolvedProposal(p), split.days[wd]?.name ?? "");
    const days = split.days.slice();
    days[wd] = day;
    const next: Split = { ...split, days, updatedAt: ts() };
    commitSplits({ ...doc, splits: doc.splits.map((x) => (x.id === split.id ? next : x)) });
    updateMessage(messageId, (m) => ({ ...m, proposal: { ...m.proposal!, status: "saved" } }));
    pushToast({ text: `Saved to ${WEEKDAY_NAMES[wd]} in your split.`, kind: "success" });
  },
  clearChat() {
    commitChat([]);
    setState({ coachError: null });
  },

  // data
  async loadMonth(month) {
    if (getState().logs[month]) return;
    const raw = await store().load<unknown>(logKey(month));
    if (getState().logs[month]) return;
    setState((s) => ({ logs: { ...s.logs, [month]: normalizeMonthLog(raw, month) } }));
  },
  exportData() {
    return buildExport();
  },
  async deleteEverything() {
    const { store: st, notifications, media, wakeLock } = services();
    await st.flush();
    // Full photos in files mode live outside the store.
    if (media.mode === "files") {
      const ids = new Set<string>();
      for (const log of Object.values(getState().logs)) for (const s of Object.values(log.days)) if (s.photoId) ids.add(s.photoId);
      const a = getState().active;
      if (a?.photoId) ids.add(a.photoId);
      await Promise.all([...ids].map((id) => media.deletePhoto(id).catch(() => {})));
    }
    // Every key, including chunk parts (rawList) and photo/*. With the local
    // backend these are the "split/" localStorage keys, so they go too.
    let keys: string[] = [];
    try {
      keys = [...new Set([...(st.rawList ? await st.rawList("") : []), ...(await st.list(""))])];
    } catch {
      keys = await st.list("").catch(() => []);
    }
    for (let i = 0; i < keys.length; i += 20) await Promise.all(keys.slice(i, i + 20).map((k) => st.delete(k)));
    await notifications.cancelAll().catch(() => {});
    await wakeLock.release().catch(() => {});
    // The standalone API key ("split.apiKey") is deliberately KEPT: it's a
    // device credential for the developer's browser, not her data; it's never
    // in the store or the export, and Me → Settings can clear it.
    setState({
      profile: null,
      settings: defaultSettings(),
      splits: null,
      active: null,
      logs: {},
      bests: emptyBests(),
      chat: [],
      chatBusy: false,
      coachError: null,
      pickedWeekday: null,
      summary: null,
      celebration: null,
      banners: [],
      tab: "today",
    });
    await st.flush();
  },
};

// ── extras (not in AppActions) ─────────────────────────────────────────────

/** Standalone only: save or clear the Anthropic key (localStorage) and refresh caps.ai. */
export function saveApiKey(key: string | null): void {
  setApiKey(key);
  refreshCaps();
}
