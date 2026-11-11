/**
 * Split: the shared contract.
 *
 * Every module codes against these types. Change them only in the main
 * thread, never inside one module, so the data layer, the coach and the UI
 * can't drift apart. Store keys and value shapes are listed in docs/PLAN.md
 * ("Data model"); key builders live in src/data/keys.ts.
 *
 * Units: every weight is STORED in kilograms (full precision, never rounded
 * on write) and converted for display. Reps are integers.
 */

// ── Primitives ─────────────────────────────────────────────────────────────

/** Local calendar date, `YYYY-MM-DD`, in the device's time zone. */
export type ISODate = string;
/** Local month, `YYYY-MM`. */
export type MonthKey = string;
/** Wall-clock time, `HH:MM`, 24 h, local. */
export type TimeOfDay = string;
/** 0 = Sunday … 6 = Saturday (same as Date#getDay). */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;
/** Epoch milliseconds. */
export type Timestamp = number;

export type WeightUnit = "lb" | "kg";
export type Goal = "muscle" | "fat" | "consistent";

/** Reps target: a number (`{min: 8}`) or a range (`{min: 8, max: 12}`, max > min). */
export interface RepTarget {
  min: number;
  max?: number;
}

// ── The plan (store key "splits") ──────────────────────────────────────────

export interface PlannedExercise {
  id: string;
  name: string;
  /** 1…10. */
  sets: number;
  reps: RepTarget;
  /** Working weight in kg; null = bodyweight / no load. */
  weightKg: number | null;
  note?: string;
}

export interface DayPlan {
  kind: "workout" | "rest";
  /** "Legs", "Back and biceps"; "Rest" for rest days. */
  name: string;
  /** Always [] for rest days. */
  exercises: PlannedExercise[];
}

export interface Split {
  id: string;
  name: string;
  /** Exactly 7, indexed by Weekday (0 = Sunday). The UI lists Monday first. */
  days: DayPlan[];
  createdAt: Timestamp;
  updatedAt: Timestamp;
  /** Set when it stopped being active; absent on the active split. */
  archivedAt?: Timestamp;
}

/** Which split was active from which date; lets the calendar judge past days. */
export interface ActivePeriod {
  splitId: string;
  from: ISODate;
}

export interface SplitsDoc {
  activeId: string;
  splits: Split[];
  /** Ascending by `from`. The last entry is the current active split. */
  history: ActivePeriod[];
}

// ── A workout session (store "active" while in progress, then logs/YYYY-MM) ─

export interface SetLog {
  reps: number;
  /** kg; null = bodyweight. */
  weightKg: number | null;
  done: boolean;
  doneAt?: Timestamp;
}

export type ExerciseSource = "plan" | "added" | "swapped" | "coach";

export interface ExerciseLog {
  id: string;
  name: string;
  /** Target reps from the plan (for display: "3 × 8–12"). */
  reps: RepTarget;
  /** One entry per planned set, prefilled with planned reps (reps.min… see PLAN) and weight. */
  sets: SetLog[];
  source: ExerciseSource;
  /** For a swap: the planned exercise's name it replaced. */
  swappedFrom?: string;
  /** Skipped for today only. */
  skipped?: boolean;
  note?: string;
  /** The planned exercise id this came from (plan or swapped), for "save to split". */
  planExerciseId?: string;
}

export type PBKind = "heaviest" | "reps";

export interface PersonalBest {
  exercise: string;
  kind: PBKind;
  weightKg: number | null;
  reps: number;
  /** Previous record, for "was 60 kg". Absent if none at that weight. */
  previous?: { weightKg: number | null; reps: number };
}

export interface Session {
  id: string;
  date: ISODate;
  /** "Legs". For an extra workout on a rest day: whatever she named it ("Extra workout" by default). */
  title: string;
  /**
   * The split day this came from. `weekday` may differ from the date's
   * weekday when she does another day's workout. null = extra/free workout.
   */
  from: { splitId: string; weekday: Weekday } | null;
  /** True when a coach proposal replaced the plan for today. */
  coachAdjusted?: boolean;
  exercises: ExerciseLog[];
  startedAt: Timestamp;
  finishedAt?: Timestamp;
  /** One line, ≤ 140 chars. */
  note?: string;
  /** Full photo id (photo/<id> or a flinsh.files id); may be evicted later. */
  photoId?: string;
  /** 48 px JPEG data URL; kept even after the full photo is evicted. */
  thumb?: string;
  /** The finish line shown on the summary (never the same twice in 7 days). */
  finishLine?: string;
  /** Records set in this session, computed at finish. */
  bests?: PersonalBest[];
}

/** Store key "logs/YYYY-MM": finished sessions of one month. */
export interface MonthLog {
  month: MonthKey;
  days: Record<ISODate, Session>;
}

// ── Records (store key "bests"; derived from logs, cached) ─────────────────

export interface ExerciseRecord {
  /** Display name as last logged. */
  name: string;
  /** Heaviest completed set. */
  heaviest: { weightKg: number | null; reps: number; date: ISODate } | null;
  /** Most reps at a weight. Key = weight in kg rounded to 0.01, as a string ("61.23"); "bw" = bodyweight. */
  repsAt: Record<string, { reps: number; date: ISODate }>;
  /** The most recent session's completed sets, for "last time" on Today. */
  last: { date: ISODate; sets: { reps: number; weightKg: number | null }[] } | null;
  /** Number of sessions that included it. */
  sessions: number;
}

/** Keyed by normalized exercise name (see normalizeName in src/data/history.ts). */
export interface BestsDoc {
  /** Bumped when the derivation changes, to force a rebuild. */
  version: 1;
  /** Latest finished session date folded in. */
  through: ISODate | null;
  records: Record<string, ExerciseRecord>;
}

// ── Profile + settings ─────────────────────────────────────────────────────

export interface Profile {
  name: string;
  units: WeightUnit;
  heightCm?: number;
  /** Body weight, kg. Coach only. */
  bodyWeightKg?: number;
  goal?: Goal;
  /** First day tracked; calendar "missed" and streaks never look before it. */
  startedOn: ISODate;
  /** Absent = show onboarding. */
  onboardedAt?: Timestamp;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export type ThemePref = "dark" | "light" | "system";
export type MotionPref = "system" | "reduce" | "full";

export interface DayReminder {
  on: boolean;
  time: TimeOfDay;
}

export interface ReminderSettings {
  /** Master switch. */
  enabled: boolean;
  /** Index = Weekday. Only workout days of the active split are scheduled. */
  byWeekday: DayReminder[];
}

export interface Settings {
  /** Default "dark". */
  theme: ThemePref;
  reduceMotion: MotionPref;
  /** 1, 1.15, 1.3. */
  textScale: number;
  /** Stepper increment, in DISPLAY units: 2.5 or 5. Default 5 (lb) / 2.5 (kg). */
  weightStep: number;
  /** Anthropic model for the coach. Default "claude-sonnet-5-5". */
  model: string;
  reminders: ReminderSettings;
  /** In-app banners dismissed: `${id}@${date}`, pruned to the last 7 days. */
  dismissedBanners: string[];
}

// ── Coach ──────────────────────────────────────────────────────────────────

export interface ProposedExercise {
  name: string;
  sets: number;
  reps: RepTarget;
  /** kg; absent = keep last/plan weight or bodyweight (resolved on apply). */
  weightKg?: number;
}

export interface ProposedWorkout {
  exercises: ProposedExercise[];
  reason: string;
  /** Optional title ("Short legs"). */
  title?: string;
}

export type ProposalStatus = "pending" | "applied" | "kept" | "saved";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  at: Timestamp;
  /** Assistant only: a proposeWorkout tool call, shown as a preview card. */
  proposal?: ProposedWorkout & { status: ProposalStatus };
  /** Set on an assistant message that is an error/fallback, not model output. */
  error?: boolean;
  /** The flinsh.ai err.code, when there was one. */
  code?: string;
}

export type CoachMode = "chat" | "plan-today" | "suggest" | "calories";

/** What the coach sees. Built by buildCoachContext (src/coach/context.ts). */
export interface CoachContext {
  today: ISODate;
  weekday: Weekday;
  profile: Pick<Profile, "name" | "units" | "heightCm" | "bodyWeightKg" | "goal"> | null;
  activeSplit: Split | null;
  /** Today's plan (from the active split, or a different day's if she chose one). */
  todayPlan: DayPlan | null;
  /** The in-progress session, if any. */
  active: Session | null;
  /** Finished sessions from the last 14 days, newest first. */
  recent: Session[];
}

// ── Capabilities ───────────────────────────────────────────────────────────

export type StoreBackend = "flinsh" | "local" | "memory";
export type AIMode = "flinsh" | "direct" | "none";
export type NotificationsMode = "live" | "in-app";
export type MediaMode = "files" | "inline";

export interface Capabilities {
  inFlinsh: boolean;
  store: StoreBackend;
  ai: AIMode;
  notifications: NotificationsMode;
  photos: MediaMode;
  /** What the last request did: unsupported (no API), untested (no workout yet), on, blocked (refused, e.g. by the frame). */
  wakeLock: "unsupported" | "untested" | "on" | "blocked";
  /** How Export hands over the file: files.save (Flinsh), a browser download (standalone), or the clipboard. */
  export: "files" | "download" | "clipboard";
}

// ── Store adapter (same contract as lose-it) ───────────────────────────────

export interface RawStore {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<unknown>;
  delete(key: string): Promise<boolean>;
  list(prefix: string): Promise<string[]>;
}

export interface StoreStatus {
  pending: number;
  error?: string;
}

export interface StoreAdapter {
  readonly backend: StoreBackend;
  init(preloadKeys: string[]): Promise<void>;
  peek<T>(key: string): T | null;
  load<T>(key: string): Promise<T | null>;
  loadMany<T>(keys: string[]): Promise<Record<string, T | null>>;
  set<T>(key: string, value: T): void;
  delete(key: string): Promise<void>;
  list(prefix: string): Promise<string[]>;
  flush(): Promise<void>;
  /** True if the key's last load FAILED (network, timeout), as opposed to the key being absent. */
  didFail(key: string): boolean;
  onStatus(cb: (s: StoreStatus) => void): () => void;
  cachedBytes(): number;
}

// ── AI adapter (Anthropic Messages shape) ──────────────────────────────────

export interface AIToolDef {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export interface AIToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export type AIContentBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  | { type: "tool_result"; tool_use_id: string; content: string; is_error?: boolean }
  | { type: string; [k: string]: unknown };

export interface AIMessage {
  role: "user" | "assistant";
  content: string | AIContentBlock[];
}

export interface AIRequest {
  system: string;
  messages: AIMessage[];
  tools?: AIToolDef[];
  max_tokens?: number;
}

export type AIFailure = "not_configured" | "no_key" | "network" | "auth" | "rate_limit" | "refused" | "bad_response" | "error";

export type AIResponse =
  | { ok: true; text: string; toolCalls: AIToolCall[]; content: AIContentBlock[]; stopReason: string }
  | { ok: false; reason: AIFailure; message: string; code?: string };

export interface AIAdapter {
  mode(): AIMode;
  chat(req: AIRequest): Promise<AIResponse>;
}

// ── Notifications ──────────────────────────────────────────────────────────

export interface ScheduledReminder {
  id: string;
  title: string;
  body: string;
  time: TimeOfDay;
  /** Absent = every day. */
  weekday?: Weekday;
}

export interface NotificationsAdapter {
  readonly mode: NotificationsMode;
  /** Replace every reminder this app scheduled with `list`. */
  sync(list: ScheduledReminder[]): Promise<void>;
  cancelAll(): Promise<void>;
}

/** An in-app banner for a reminder whose time has passed today. */
export interface DueBanner {
  id: string;
  title: string;
  body: string;
}

// ── Photos ─────────────────────────────────────────────────────────────────

/** Store key "photo/<id>" in inline mode. id = `${date}-${rand}`, so ids sort by date. */
export interface StoredPhoto {
  id: string;
  date: ISODate;
  /** image/jpeg data URL, ≤ PHOTO_MAX_BYTES of base64 payload. */
  dataUrl: string;
  bytes: number;
}

export interface SavedPhoto {
  photoId: string;
  /** 48 px JPEG data URL. */
  thumb: string;
  /** Ids evicted to stay in budget (their logs keep the thumb). */
  evicted: string[];
}

export interface MediaAdapter {
  readonly mode: MediaMode;
  /** Resize, strip EXIF (canvas re-encode), store; evicts oldest beyond the budget. */
  savePhoto(date: ISODate, file: Blob): Promise<SavedPhoto>;
  /** A displayable URL (data: or blob:), or null if evicted/missing. */
  loadPhoto(photoId: string): Promise<string | null>;
  deletePhoto(photoId: string): Promise<void>;
}

// ── window.flinsh (exists: store, ready, ai, files incl. save; proposed: notifications) ─

export interface FlinshStoreApi {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<unknown>;
  delete(key: string): Promise<unknown>;
  list(prefix?: string): Promise<unknown>;
}

/** flinsh.files (exists with "files:user"; see ../Flinch/docs/flinsh-tool-skill.md §10). */
export interface FlinshFilesApi {
  /** Upload to private storage. Accepted: image/jpeg, png, webp, heic (≤ 25 MB). */
  put(blob: Blob, opts: { name: string; mime: string }): Promise<{ id: string; size: number; name: string; mime: string }>;
  /** A short-lived (~10 min) signed URL for <img>; never store it. */
  get(id: string): Promise<string>;
  list?(prefix?: string): Promise<{ id: string; name: string; mime: string; size: number; created_at: string }[]>;
  delete(id: string): Promise<boolean>;
  /** The user-facing save (needs "downloads"): a download on the web, the share sheet in the phone app. */
  save?(blob: Blob, filename: string): Promise<unknown>;
}

export interface FlinshBridge {
  input?: Record<string, unknown>;
  ready?: () => void;
  done?: (r: unknown) => void;
  resize?: (h: number) => void;
  store: FlinshStoreApi;
  ai?: { chat(request: Record<string, unknown>): Promise<unknown> };
  notifications?: {
    schedule?: (list: ScheduledReminder[]) => Promise<unknown>;
    cancel?: (ids: string[]) => Promise<unknown>;
    list?: () => Promise<unknown>;
  };
  files?: FlinshFilesApi;
}

declare global {
  interface Window {
    flinsh?: FlinshBridge;
  }
}

// ── UI-facing state ────────────────────────────────────────────────────────

export type TabId = "today" | "split" | "calendar" | "coach" | "me";

export interface Toast {
  id: string;
  text: string;
  kind: "info" | "error" | "success";
  action?: { label: string; run: () => void };
  ttl?: number;
}

/** A celebration the UI should play (consumed by the UI, then cleared). */
export type Celebration =
  | { kind: "set"; exerciseId: string; setIndex: number; at: Timestamp }
  | { kind: "exercise"; exerciseId: string; at: Timestamp }
  | { kind: "finish"; pb: boolean; at: Timestamp };

/** Per-day calendar status. "missed" is shown gently (no red). */
export type DayStatus = "done" | "rest" | "missed" | "planned" | "today" | "before-start";

/** One point on the per-exercise history chart. */
export interface ExerciseHistoryPoint {
  date: ISODate;
  /** Heaviest completed set that day, kg (null = bodyweight only). */
  topKg: number | null;
  /** Reps of that top set. */
  reps: number;
  sets: { reps: number; weightKg: number | null }[];
}

/** The summary shown after "Finish workout". */
export interface FinishSummary {
  date: ISODate;
  title: string;
  exercisesDone: number;
  totalSets: number;
  /** In kg (sum of reps × kg over completed loaded sets). Display converts. */
  volumeKg: number;
  bests: PersonalBest[];
  finishLine: string;
  /** True if any completed set's weight differs from the split's planned weight. */
  weightsChanged: boolean;
}

export interface AppState {
  ready: boolean;
  /** Local date, refreshed at midnight and on focus. */
  today: ISODate;
  caps: Capabilities;
  profile: Profile | null;
  settings: Settings;
  splits: SplitsDoc | null;
  /** The in-progress session (store "active"), or null. */
  active: Session | null;
  /** Loaded months, keyed by MonthKey. At least the current and previous month. */
  logs: Record<MonthKey, MonthLog>;
  bests: BestsDoc;
  /** Today's chat (store chat/<today>). */
  chat: ChatMessage[];
  chatBusy: boolean;
  /** Set when the coach failed with a code (e.g. no_ai_key) so the Coach tab can show the banner. */
  coachError: { code?: string; message: string } | null;
  /**
   * The weekday whose workout she picked to do today, when different from
   * today's (before a session starts). null = today's own plan.
   */
  pickedWeekday: Weekday | null;
  /** Summary after finishing, until dismissed. */
  summary: FinishSummary | null;
  celebration: Celebration | null;
  toasts: Toast[];
  storeStatus: StoreStatus;
  /** Reminder banners due now (in-app mode). */
  banners: DueBanner[];
  tab: TabId;
}

/**
 * Every state change the UI can make. Implemented in src/data/actions.ts and
 * exported as `actions`. All are synchronous for the UI (they update memory
 * and schedule a write) unless they return a Promise.
 */
export interface AppActions {
  // navigation + toasts
  setTab(tab: TabId): void;
  toast(text: string, kind?: Toast["kind"], action?: Toast["action"]): void;
  dismissToast(id: string): void;
  clearCelebration(): void;

  // onboarding + profile + settings
  completeOnboarding(input: {
    name: string;
    units: WeightUnit;
    template: TemplateId;
    heightCm?: number;
    bodyWeightKg?: number;
    goal?: Goal;
  }): void;
  updateProfile(patch: Partial<Omit<Profile, "createdAt">>): void;
  updateSettings(patch: Partial<Settings>): void;
  setReminder(weekday: Weekday, patch: Partial<DayReminder>): void;
  dismissBanner(id: string): void;

  // split editing (active split unless splitId given; archived splits are read-only)
  renameDay(weekday: Weekday, name: string): void;
  setDayKind(weekday: Weekday, kind: DayPlan["kind"]): void;
  addExercise(weekday: Weekday, ex: Omit<PlannedExercise, "id">): void;
  updateExercise(weekday: Weekday, exerciseId: string, patch: Partial<Omit<PlannedExercise, "id">>): void;
  moveExercise(weekday: Weekday, from: number, to: number): void;
  duplicateExercise(weekday: Weekday, exerciseId: string): void;
  deleteExercise(weekday: Weekday, exerciseId: string): void;
  copyDay(from: Weekday, to: Weekday): void;
  renameSplit(splitId: string, name: string): void;
  /** Copies a split (active or archived) as a new archived split; returns its id. */
  duplicateSplit(splitId: string, name?: string): string;
  /** Makes it active; the previous active one is archived. Appends to history. */
  activateSplit(splitId: string): void;
  deleteSplit(splitId: string): void;

  // today
  /** Do another day's workout today (before starting). null = back to today's plan. */
  pickWeekday(weekday: Weekday | null): void;
  /** Starts the session from the picked/today plan (no-op if one is active). */
  startWorkout(opts?: { extra?: boolean; title?: string }): void;
  /** Tap: complete with the set's current reps and weight (starts the session if needed). */
  completeSet(exerciseId: string, setIndex: number): void;
  uncompleteSet(exerciseId: string, setIndex: number): void;
  /** Edit reps/weight of a set (also marks it done unless `done: false` given). */
  editSet(exerciseId: string, setIndex: number, patch: { reps?: number; weightKg?: number | null; done?: boolean }): void;
  markAll(exerciseId: string): void;
  addSet(exerciseId: string): void;
  removeSet(exerciseId: string): void;
  /** Today only. */
  skipExercise(exerciseId: string, skipped: boolean): void;
  swapExercise(exerciseId: string, newName: string): void;
  addTodayExercise(name: string, sets?: number, reps?: RepTarget, weightKg?: number | null): void;
  setSessionNote(note: string): void;
  setSessionPhoto(file: Blob): Promise<void>;
  removeSessionPhoto(): Promise<void>;
  finishWorkout(): void;
  discardWorkout(): void;
  dismissSummary(): void;
  /** From the summary: write today's completed weights back into the split. */
  saveWeightsToSplit(): void;
  /** Edit a finished day's note (Calendar). */
  setLoggedNote(date: ISODate, note: string): void;

  // coach
  sendCoach(text: string, mode?: CoachMode): Promise<void>;
  /** Replace today's plan with the proposal (today only). */
  applyProposal(messageId: string): void;
  keepPlan(messageId: string): void;
  /** Also write the proposal into the active split's day for today's weekday. */
  saveProposalToSplit(messageId: string): void;
  clearChat(): void;

  // data
  /** Loads logs for a month (Calendar navigation). */
  loadMonth(month: MonthKey): Promise<void>;
  exportData(): Promise<string>;
  deleteEverything(): Promise<void>;
}

export type TemplateId = "full-body-3" | "upper-lower-4" | "ppl-5" | "blank";
