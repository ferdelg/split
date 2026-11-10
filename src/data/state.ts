/**
 * The app store: one in-memory AppState, a tiny subscribe/selector hook, the
 * app clock, the adapters (services) and initApp(), which wires everything
 * per PLAN "Boot". Only actions.ts writes app data to the store; this module
 * writes only housekeeping (chat pruning, bests rebuild, thumb compaction).
 */
import { useLayoutEffect, useReducer, useRef } from "preact/hooks";
import type {
  AIAdapter, AppState, BestsDoc, Capabilities, ChatMessage, FlinshBridge, MediaAdapter, MonthKey, MonthLog, NotificationsAdapter,
  Session, Settings, StoreAdapter, Toast,
} from "../types";
import { createAIAdapter } from "../adapters/ai";
import { safeLocal, waitForBridge } from "../adapters/env";
import { createMediaAdapter } from "../adapters/media";
import { createNotificationsAdapter } from "../adapters/notifications";
import { createStoreAdapter, flinshRaw, installBackgroundFlush, localRaw, memoryRaw } from "../adapters/store";
import { createWakeLock, wakeLockSupported } from "../adapters/wakeLock";
import { addDays, addMonths, monthOf, msUntilNextMidnight, todayISO } from "../lib/date";
import { uid } from "../lib/ids";
import { buildSchedule, dueBanners } from "../lib/reminders";
import { normalizeBests, normalizeChat, normalizeMonthLog, normalizeProfile, normalizeSession, normalizeSettings, normalizeSplits, defaultSettings } from "./defaults";
import { allSessions, compactOldThumbs, emptyBests, rebuildBests, sessionOn } from "./history";
import { CHAT_KEEP_DAYS, DISMISSED_KEEP_DAYS, K, chatKey, logKey } from "./keys";
import { activeSplit } from "./split";

export interface Services {
  store: StoreAdapter & { rawList?(prefix: string): Promise<string[]> };
  ai: AIAdapter;
  notifications: NotificationsAdapter;
  media: MediaAdapter;
  bridge: FlinshBridge | null;
  wakeLock: { acquire(): Promise<void>; release(): Promise<void> };
}

// ── clock ──────────────────────────────────────────────────────────────────

let clock: (() => Date) | undefined;

/** The app clock. Every timestamp and date goes through this. */
export function now(): Date {
  return clock?.() ?? new Date();
}

export function setClock(fn: (() => Date) | undefined): void {
  clock = fn;
}

// ── store ──────────────────────────────────────────────────────────────────

function baseCaps(): Capabilities {
  return { inFlinsh: false, store: "memory", ai: "none", notifications: "in-app", photos: "inline", wakeLock: wakeLockSupported() };
}

export function initialState(): AppState {
  return {
    ready: false,
    today: todayISO(now()),
    caps: baseCaps(),
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
    toasts: [],
    storeStatus: { pending: 0 },
    banners: [],
    tab: "today",
  };
}

let state: AppState = initialState();
const listeners = new Set<(s: AppState) => void>();

export function getState(): AppState {
  return state;
}

export function setState(patch: Partial<AppState> | ((s: AppState) => Partial<AppState>)): void {
  const p = typeof patch === "function" ? patch(state) : patch;
  state = { ...state, ...p };
  for (const l of [...listeners]) {
    try {
      l(state);
    } catch (e) {
      console.error("[split] state listener failed", e);
    }
  }
}

export function subscribe(fn: (s: AppState) => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function useApp<T>(selector: (s: AppState) => T): T {
  const [, force] = useReducer((n: number) => n + 1, 0);
  const sel = useRef(selector);
  sel.current = selector;
  const value = selector(state);
  const last = useRef(value);
  last.current = value;
  useLayoutEffect(() => {
    const check = (s: AppState) => {
      const v = sel.current(s);
      if (!Object.is(v, last.current)) {
        last.current = v;
        force(0);
      }
    };
    const off = subscribe(check);
    check(state); // changed between render and subscribe
    return off;
  }, []);
  return value;
}

// ── services ───────────────────────────────────────────────────────────────

let svc: Services | null = null;

function fallbackServices(): Services {
  const store = createStoreAdapter(memoryRaw(), "memory");
  return {
    store,
    ai: createAIAdapter({ getModel: () => state.settings.model, bridge: null }),
    notifications: createNotificationsAdapter(null),
    media: createMediaAdapter(null, store),
    bridge: null,
    wakeLock: createWakeLock(),
  };
}

export function services(): Services {
  if (!svc) svc = fallbackServices();
  return svc;
}

function capsFor(s: Services): Capabilities {
  let ai: Capabilities["ai"] = "none";
  try {
    ai = s.ai.mode();
  } catch {
    /* keep none */
  }
  return {
    inFlinsh: !!s.bridge,
    store: s.store.backend,
    ai,
    notifications: s.notifications.mode,
    photos: s.media.mode,
    wakeLock: wakeLockSupported(),
  };
}

/** Re-read adapter modes (e.g. after the standalone API key changes). */
export function refreshCaps(): void {
  setState({ caps: capsFor(services()) });
}

// ── toasts ─────────────────────────────────────────────────────────────────

const toastTimers = new Map<string, ReturnType<typeof setTimeout>>();

export function pushToast(t: Omit<Toast, "id">): string {
  const id = uid("t");
  const ttl = t.ttl ?? (t.action ? 8000 : 4000);
  setState((s) => ({ toasts: [...s.toasts, { ...t, id, ttl }] }));
  toastTimers.set(id, setTimeout(() => removeToast(id), ttl));
  return id;
}

export function removeToast(id: string): void {
  const timer = toastTimers.get(id);
  if (timer) clearTimeout(timer);
  toastTimers.delete(id);
  if (state.toasts.some((t) => t.id === id)) setState((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
}

// ── reminders ──────────────────────────────────────────────────────────────

function locale(): string | undefined {
  try {
    return typeof navigator !== "undefined" ? navigator.language : undefined;
  } catch {
    return undefined;
  }
}

/** Push the current schedule to the notifications adapter (live mode). */
export function syncReminders(): void {
  const s = getState();
  const schedule = s.profile?.onboardedAt ? buildSchedule(activeSplit(s.splits), s.settings.reminders, locale()) : [];
  void services().notifications.sync(schedule).catch(() => {});
}

/** Recompute in-app banners (in-app mode only). */
export function refreshBanners(): void {
  const s = getState();
  if (services().notifications.mode !== "in-app" || !s.profile?.onboardedAt) {
    if (s.banners.length) setState({ banners: [] });
    return;
  }
  const schedule = buildSchedule(activeSplit(s.splits), s.settings.reminders, locale());
  const hasDone = (x: Session | null) => !!x && x.exercises.some((e) => !e.skipped && e.sets.some((set) => set.done));
  // Mid-workout counts as done: no nagging at the gym.
  const doneToday = hasDone(sessionOn(s.today, s.logs)) || (s.active?.date === s.today && hasDone(s.active));
  const banners = dueBanners(now(), schedule, doneToday, s.settings.dismissedBanners);
  const sig = (b: { id: string; title: string }[]) => b.map((x) => `${x.id}|${x.title}`).join(",");
  if (sig(banners) !== sig(s.banners)) setState({ banners });
}

/** Dismissed-banner entries (`id@date`) from the last 7 days. */
export function pruneDismissed(list: string[], today: string): string[] {
  const from = addDays(today, -DISMISSED_KEEP_DAYS);
  return list.filter((x) => {
    const d = x.split("@")[1] ?? "";
    return d >= from;
  });
}

// ── logs ───────────────────────────────────────────────────────────────────

/** Merge loaded months under the in-memory ones (memory is newer). */
function mergeLogs(loaded: Record<MonthKey, MonthLog>): void {
  setState((s) => ({ logs: { ...loaded, ...s.logs } }));
}

/** Load months not yet in state. */
export async function ensureMonths(months: MonthKey[]): Promise<void> {
  const missing = months.filter((m) => !getState().logs[m]);
  if (!missing.length) return;
  const vals = await services().store.loadMany<unknown>(missing.map(logKey));
  const out: Record<MonthKey, MonthLog> = {};
  for (const m of missing) out[m] = normalizeMonthLog(vals[logKey(m)], m);
  mergeLogs(out);
}

// ── day rollover ───────────────────────────────────────────────────────────

const cleanups: (() => void)[] = [];
let rolling: Promise<void> | null = null;

/** Load the new day if the calendar date changed (midnight, or app resumed). */
export function checkRollover(): Promise<void> {
  const t = todayISO(now());
  if (t === state.today) return rolling ?? Promise.resolve();
  if (rolling) return rolling;
  rolling = (async () => {
    try {
      const m = monthOf(t);
      await ensureMonths([m, addMonths(m, -1)]);
      const chat = normalizeChat(await services().store.load<unknown>(chatKey(t)));
      setState((s) => ({
        today: t,
        chat,
        coachError: null,
        pickedWeekday: null,
        settings: { ...s.settings, dismissedBanners: pruneDismissed(s.settings.dismissedBanners, t) },
      }));
      refreshBanners();
    } catch (e) {
      console.warn("[split] rollover failed", e);
    } finally {
      rolling = null;
    }
  })();
  return rolling;
}

function scheduleMidnight(): void {
  const timer = setTimeout(() => {
    void checkRollover().finally(scheduleMidnight);
  }, msUntilNextMidnight(now()) + 50);
  cleanups.push(() => clearTimeout(timer));
}

// ── housekeeping (after first paint) ───────────────────────────────────────

/** Rough store budget before thumbs of months older than a year are dropped. */
const COMPACT_ABOVE_BYTES = 1_500_000;

export async function housekeeping(): Promise<void> {
  const { store } = services();
  const today = state.today;
  // 1. Chats older than 30 days.
  try {
    const cutoff = chatKey(addDays(today, -CHAT_KEEP_DAYS));
    const old = (await store.list("chat/")).filter((k) => k < cutoff);
    await Promise.all(old.map((k) => store.delete(k)));
  } catch (e) {
    console.warn("[split] chat pruning failed", e);
  }
  // 2. Every month log (the streak and exercise history look back further than two months).
  try {
    const months = (await store.list("logs/")).map((k) => k.slice("logs/".length)).filter((m) => /^\d{4}-\d{2}$/.test(m));
    await ensureMonths(months);
  } catch (e) {
    console.warn("[split] loading logs failed", e);
  }
  // 3. Bests: rebuild when missing, from another version, or not through the latest session.
  try {
    const sessions = allSessions(state.logs);
    const latest = sessions.length ? sessions[sessions.length - 1].date : null;
    const stored = normalizeBests(store.peek<unknown>(K.bests));
    if (!stored || stored.through !== latest) {
      const bests: BestsDoc = rebuildBests(sessions);
      setState({ bests });
      store.set(K.bests, bests);
    }
  } catch (e) {
    console.warn("[split] bests rebuild failed", e);
  }
  // 4. Space: drop thumbs from months older than a year if the cache is getting big.
  try {
    if (store.cachedBytes() > COMPACT_ABOVE_BYTES) {
      const yearAgo = addMonths(monthOf(today), -12);
      const logs = { ...state.logs };
      for (const [m, log] of Object.entries(logs)) {
        if (m >= yearAgo) continue;
        const c = compactOldThumbs(log);
        if (c !== log) {
          logs[m] = c;
          store.set(logKey(m), c);
        }
      }
      setState({ logs });
    }
  } catch (e) {
    console.warn("[split] compaction failed", e);
  }
}

// ── init ───────────────────────────────────────────────────────────────────

let lastSaveToast = -Infinity;

function pickStore(bridge: FlinshBridge | null): Services["store"] {
  const today = () => todayISO(now());
  if (bridge?.store) return createStoreAdapter(flinshRaw(bridge.store), "flinsh", { today });
  if (safeLocal.available()) return createStoreAdapter(localRaw("split/"), "local", { today });
  return createStoreAdapter(memoryRaw(), "memory", { today });
}

/**
 * Boot (PLAN "Boot"). main.tsx should call installInsetListener() before this
 * and flinsh.ready() after the first render. `bridge` lets tests inject a
 * mock (null = standalone); when undefined, waits for window.flinsh.
 */
export async function initApp(opts: { bridge?: FlinshBridge | null; bridgeTimeoutMs?: number; fetchImpl?: typeof fetch } = {}): Promise<void> {
  try {
    const bridge = opts.bridge !== undefined ? opts.bridge : await waitForBridge(opts.bridgeTimeoutMs ?? 400);
    const store = pickStore(bridge);
    svc = {
      store,
      ai: createAIAdapter({ getModel: () => getState().settings.model, fetchImpl: opts.fetchImpl, bridge }),
      notifications: createNotificationsAdapter(bridge),
      media: createMediaAdapter(bridge, store),
      bridge,
      wakeLock: createWakeLock(),
    };
    setState({ caps: capsFor(svc) });

    cleanups.push(installBackgroundFlush(store));
    cleanups.push(
      store.onStatus((s) => {
        setState({ storeStatus: s });
        if (s.error && Date.now() - lastSaveToast >= 30_000) {
          lastSaveToast = Date.now();
          pushToast({ text: "Couldn't save; will retry.", kind: "error" });
        }
      }),
    );

    const today = todayISO(now());
    const month = monthOf(today);
    const months = [month, addMonths(month, -1)];
    await store.init([K.profile, K.settings, K.splits, K.active, K.bests, ...months.map(logKey), chatKey(today)]);

    const t = now().getTime();
    const profile = normalizeProfile(store.peek<unknown>(K.profile), today, t);
    const settings: Settings = normalizeSettings(store.peek<unknown>(K.settings), profile?.units ?? "lb");
    settings.dismissedBanners = pruneDismissed(settings.dismissedBanners, today);
    const logs: Record<MonthKey, MonthLog> = {};
    for (const m of months) logs[m] = normalizeMonthLog(store.peek<unknown>(logKey(m)), m);
    // A stale active session (earlier date) is kept: Today offers "Finish it" or "Discard".
    const active = normalizeSession(store.peek<unknown>(K.active));
    const chat: ChatMessage[] = normalizeChat(store.peek<unknown>(chatKey(today)));
    setState({
      today,
      profile,
      settings,
      splits: normalizeSplits(store.peek<unknown>(K.splits), t),
      active,
      logs,
      bests: normalizeBests(store.peek<unknown>(K.bests)) ?? emptyBests(),
      chat,
    });
    if (active && active.date === today) void svc.wakeLock.acquire();

    syncReminders();
    refreshBanners();
    scheduleMidnight();
    const bannerTimer = setInterval(() => refreshBanners(), 60_000);
    cleanups.push(() => clearInterval(bannerTimer));
    if (typeof document !== "undefined" && typeof window !== "undefined") {
      const onWake = () => {
        if (document.visibilityState === "hidden") return;
        void checkRollover().then(() => {
          refreshCaps();
          refreshBanners();
        });
      };
      document.addEventListener("visibilitychange", onWake);
      window.addEventListener("focus", onWake);
      cleanups.push(() => {
        document.removeEventListener("visibilitychange", onWake);
        window.removeEventListener("focus", onWake);
      });
    }
    setState({ ready: true });
    // After first paint.
    const hk = setTimeout(() => void housekeeping().catch((e) => console.warn("[split] housekeeping failed", e)), 0);
    cleanups.push(() => clearTimeout(hk));
  } catch (e) {
    console.error("[split] init failed", e);
    if (!svc) svc = fallbackServices();
    pushToast({ text: "Something went wrong while loading. Your saved data is untouched; try reopening the app.", kind: "error", ttl: 8000 });
    setState({ ready: true });
  }
}

/** Tests only: drop listeners, timers, services, the clock and state. */
export function resetForTests(): void {
  while (cleanups.length) {
    try {
      cleanups.pop()!();
    } catch {
      /* ignore */
    }
  }
  for (const t of toastTimers.values()) clearTimeout(t);
  toastTimers.clear();
  listeners.clear();
  if (svc) void svc.wakeLock.release().catch(() => {});
  svc = null;
  clock = undefined;
  lastSaveToast = -Infinity;
  rolling = null;
  state = initialState();
}
