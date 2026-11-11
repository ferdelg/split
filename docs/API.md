# Module exports (build contract)

Exact names and signatures that cross module boundaries. Types come from
`src/types.ts`. If you own a module, implement these exactly (you may add
more exports). If you consume one, use only these. If something is missing,
add it in your own module, or note it in your final report; do not edit
another area's files.

## src/lib/date.ts (data)
```ts
export const WEEK_ORDER: Weekday[];               // [1,2,3,4,5,6,0]
export const WEEKDAY_NAMES: string[];             // index = Weekday: "Sunday"…
export const WEEKDAY_SHORT: string[];             // "Sun"…
export const MONTH_NAMES: string[];               // "January"…
export function todayISO(d?: Date): ISODate;
export function parseISO(iso: ISODate): Date;     // local midnight
export function addDays(iso: ISODate, n: number): ISODate;
export function weekdayOf(iso: ISODate): Weekday;
export function monthOf(iso: ISODate): MonthKey;
export function addMonths(month: MonthKey, n: number): MonthKey;
export function daysInMonth(month: MonthKey): ISODate[];
export function msUntilNextMidnight(d: Date): number;
export function formatLongDate(iso: ISODate): string;   // "Tuesday, November 10"
export function formatTime(t: TimeOfDay, locale?: string): string; // "5:30 PM" or "17:30"
```

## src/lib/units.ts (data)
```ts
export const KG_PER_LB = 0.45359237;
export function toDisplay(kg: number, unit: WeightUnit): number;         // unrounded
export function fromDisplay(value: number, unit: WeightUnit): number;    // → kg
export function roundDisplay(value: number): number;                     // to 0.1
export function formatWeight(kg: number | null, unit: WeightUnit, opts?: { unit?: boolean }): string; // "135 lb", "bodyweight"
export function stepWeight(kg: number | null, unit: WeightUnit, step: number, dir: 1 | -1): number | null; // snaps to grid; null+1 → step; ≤0 → null
export function defaultStep(unit: WeightUnit): number;                   // lb 5, kg 2.5
export function formatReps(r: RepTarget): string;                        // "8" | "8–12"
export function parseReps(s: string): RepTarget | null;                  // "8", "8-12", "8–12", "8 to 12"
export function formatVolume(kg: number, unit: WeightUnit): string;      // "12,340 lb"
```

## src/lib/ids.ts (data)
```ts
export function uid(prefix?: string): string;
```

## src/lib/reminders.ts (data)
```ts
export function buildSchedule(split: Split | null, reminders: ReminderSettings, locale?: string): ScheduledReminder[];
export function dueBanners(now: Date, schedule: ScheduledReminder[], doneToday: boolean, dismissed: string[]): DueBanner[];
export function defaultReminders(): ReminderSettings;   // enabled true, all off, 17:30
```

## src/lib/finishLines.ts (coach)
```ts
export const FINISH_LINES: string[];   // ≥ 40, short, upbeat, varied, no emoji
export function pickFinishLine(recent: string[], rand?: () => number): string; // never one in `recent`
```
`recent` = finishLines of sessions in the last 7 days (the data layer collects them).

## src/data/keys.ts (data)
```ts
export const K: { profile: "profile"; settings: "settings"; splits: "splits"; active: "active"; bests: "bests" };
export function logKey(month: MonthKey): string;   // "logs/2026-11"
export function chatKey(date: ISODate): string;    // "chat/2026-11-10"
export function photoKey(id: string): string;      // "photo/<id>"
```

## src/data/templates.ts (data)
```ts
export const TEMPLATES: { id: TemplateId; name: string; blurb: string }[]; // names = onboarding radio labels
export function buildTemplate(id: TemplateId, units: WeightUnit, now: Timestamp): Split;
```

## src/data/split.ts (data, pure)
```ts
export function emptyWeek(): DayPlan[];
export function renameDay(s: Split, wd: Weekday, name: string, now: Timestamp): Split;
export function setDayKind(s: Split, wd: Weekday, kind: DayPlan["kind"], now: Timestamp): Split;
export function addExercise(s: Split, wd: Weekday, ex: PlannedExercise, now: Timestamp): Split;
export function updateExercise(s: Split, wd: Weekday, id: string, patch: Partial<Omit<PlannedExercise,"id">>, now: Timestamp): Split;
export function moveExercise(s: Split, wd: Weekday, from: number, to: number, now: Timestamp): Split;
export function duplicateExercise(s: Split, wd: Weekday, id: string, now: Timestamp): Split;
export function deleteExercise(s: Split, wd: Weekday, id: string, now: Timestamp): Split;
export function copyDay(s: Split, from: Weekday, to: Weekday, now: Timestamp): Split;      // new ids
export function duplicateSplit(doc: SplitsDoc, id: string, name: string, now: Timestamp): { doc: SplitsDoc; newId: string };
export function activateSplit(doc: SplitsDoc, id: string, today: ISODate, now: Timestamp): SplitsDoc;
export function deleteSplit(doc: SplitsDoc, id: string): SplitsDoc;   // can't delete the active one (returns doc unchanged)
export function activeSplit(doc: SplitsDoc | null): Split | null;
export function dayFromProposal(p: ProposedWorkout, prevName: string): DayPlan;
```

## src/data/session.ts (data, pure)
```ts
export function resolveToday(date: ISODate, doc: SplitsDoc | null, picked: Weekday | null):
  { weekday: Weekday; planWeekday: Weekday; split: Split | null; plan: DayPlan | null };
export function sessionFromPlan(date: ISODate, plan: DayPlan, from: Session["from"], now: Timestamp): Session;
export function extraSession(date: ISODate, title: string, now: Timestamp): Session;
export function completeSet(s: Session, exId: string, i: number, now: Timestamp): Session;
export function uncompleteSet(s: Session, exId: string, i: number): Session;
export function editSet(s: Session, exId: string, i: number, patch: { reps?: number; weightKg?: number | null; done?: boolean }, now: Timestamp): Session;
export function markAll(s: Session, exId: string, now: Timestamp): Session;
export function addSet(s: Session, exId: string): Session;      // copies the last set's reps/weight, not done
export function removeSet(s: Session, exId: string): Session;   // keeps ≥ 1
export function skipExercise(s: Session, exId: string, skipped: boolean): Session;
export function swapExercise(s: Session, exId: string, newName: string, lastWeightKg: number | null): Session;
export function addTodayExercise(s: Session, name: string, sets: number, reps: RepTarget, weightKg: number | null): Session;
export function isExerciseComplete(ex: ExerciseLog): boolean;   // all sets done (and not skipped)
export function completedSets(s: Session): number;
export function applyProposalToSession(date: ISODate, p: ProposedWorkout, base: Session | null, bests: BestsDoc, splitWeightFor: (name: string) => number | null, now: Timestamp): Session;
export function finalizeSession(s: Session, now: Timestamp): Session; // finishedAt; zero-set exercises → skipped
export function weightsChanged(s: Session, split: Split | null): boolean;
```

## src/data/history.ts (data, pure)
```ts
export function normalizeName(name: string): string;
export function emptyBests(): BestsDoc;
export function detectBests(s: Session, bests: BestsDoc): PersonalBest[];
export function foldSession(bests: BestsDoc, s: Session): BestsDoc;
export function rebuildBests(sessions: Session[]): BestsDoc;
export function lastFor(name: string, bests: BestsDoc): ExerciseRecord["last"];
export function volumeKg(s: Session): number;
export function summarize(s: Session, bests: PersonalBest[], finishLine: string, weightsChanged: boolean): FinishSummary;
export function allSessions(logs: Record<MonthKey, MonthLog>): Session[];          // sorted by date ascending
export function sessionOn(date: ISODate, logs: Record<MonthKey, MonthLog>): Session | null;
export function plannedOn(date: ISODate, doc: SplitsDoc | null): DayPlan | null;
export function dayStatus(date: ISODate, today: ISODate, doc: SplitsDoc | null, logs: Record<MonthKey, MonthLog>, startedOn: ISODate): DayStatus;
export function streak(today: ISODate, doc: SplitsDoc | null, logs: Record<MonthKey, MonthLog>, startedOn: ISODate): number;
export function gymDaysInMonth(month: MonthKey, logs: Record<MonthKey, MonthLog>): number;
export function exerciseHistory(name: string, logs: Record<MonthKey, MonthLog>): ExerciseHistoryPoint[]; // ascending
export function loggedExerciseNames(logs: Record<MonthKey, MonthLog>): string[];   // most recent first, unique by normalizeName
export function recentFinishLines(today: ISODate, logs: Record<MonthKey, MonthLog>): string[]; // last 7 days
export function compactOldThumbs(log: MonthLog): MonthLog;
```

## src/data/state.ts (data)
```ts
export function getState(): AppState;
export function setState(patch: Partial<AppState> | ((s: AppState) => Partial<AppState>)): void;
export function subscribe(fn: (s: AppState) => void): () => void;
export function useApp<T>(selector: (s: AppState) => T): T;
export function now(): Date;                       // the app clock
export function setClock(fn: (() => Date) | undefined): void;   // tests
export function services(): { store: StoreAdapter; ai: AIAdapter; notifications: NotificationsAdapter; media: MediaAdapter; bridge: FlinshBridge | null };
export function initApp(opts?: { bridge?: FlinshBridge | null; bridgeTimeoutMs?: number; fetchImpl?: typeof fetch }): Promise<void>;
export function resetForTests(): void;
```

## src/data/actions.ts (data)
```ts
export const actions: AppActions;
```

## src/data/exportData.ts (data)
```ts
export function buildExport(): Promise<string>;   // pretty JSON of every key
```

## src/adapters/* (data)
```ts
// env.ts
export function isInFlinsh(): boolean;
export function waitForBridge(timeoutMs?: number): Promise<FlinshBridge | null>;
export const safeLocal: { get; set; remove; available; keys };
// store.ts — same as lose-it
export function createStoreAdapter(raw: RawStore, backend: StoreBackend, opts?): StoreAdapter & { rawList(prefix: string): Promise<string[]> };
export function flinshRaw(api: FlinshStoreApi): RawStore;
export function localRaw(prefix?: string): RawStore;     // default "split/"
export function memoryRaw(seed?: Record<string, unknown>): RawStore & { data: Map<string,string> };
export function installBackgroundFlush(store, win?): () => void;
// ai.ts
export const DEFAULT_MODEL = "claude-sonnet-5-5";
export const API_KEY_STORAGE = "split.apiKey";
export function getApiKey(): string | null;
export function setApiKey(key: string | null): void;
export function createAIAdapter(opts: { getModel: () => string; fetchImpl?: typeof fetch }): AIAdapter;
export function coachErrorMessage(code: string | undefined, reason: AIFailure): string;
// notifications.ts
export function createNotificationsAdapter(bridge: FlinshBridge | null): NotificationsAdapter;
// media.ts
export const PHOTO_MAX_EDGE = 640, PHOTO_MAX_BYTES = 30_000, PHOTO_KEEP = 20, THUMB_EDGE = 48, FILES_MAX_EDGE = 1600;
export function fitJpeg(encode: (quality: number, scale: number) => Promise<string>, maxBytes: number): Promise<string>; // returns data URL
export function dataUrlBytes(dataUrl: string): number;  // decoded payload bytes
export function planEviction(ids: string[], keep: number): string[];  // ids to delete (oldest first)
export function createMediaAdapter(bridge: FlinshBridge | null, store: StoreAdapter): MediaAdapter;
// exportFile.ts
export type ExportMode = "files" | "download" | "clipboard";
export type ExportResult = "saved" | "downloaded" | "copied" | "manual";  // manual = caller shows a select-all box
export function exportModeFor(bridge: FlinshBridge | null): ExportMode;
export function exportJson(json: string, filename: string, bridge: FlinshBridge | null, deps?: { writeClipboard?; download? }): Promise<ExportResult>;  // files.save → clipboard fallback
// insets.ts
export function applyInsets(data: unknown, root?: HTMLElement): string[];
export function installInsetListener(win?: Window): () => void;
// wakeLock.ts
export function wakeLockSupported(): boolean;
export function createWakeLock(): { acquire(): Promise<void>; release(): Promise<void> };  // silent on failure; re-acquires on visibilitychange while held
```

## src/coach/* (coach)
```ts
// library.ts
export type MuscleGroup = "Chest" | "Back" | "Shoulders" | "Biceps" | "Triceps" | "Legs" | "Glutes" | "Hamstrings" | "Calves" | "Core" | "Full body" | "Cardio";
export interface LibraryExercise { name: string; group: MuscleGroup; equipment: "barbell" | "dumbbell" | "machine" | "cable" | "bodyweight" | "kettlebell" | "band" | "other" }
export const MUSCLE_GROUPS: MuscleGroup[];
export const EXERCISES: LibraryExercise[];    // ~150, unique names
export function searchExercises(query: string, limit?: number): LibraryExercise[];   // prefix > word-prefix > substring; empty query → []
export function groupOf(name: string): MuscleGroup | null;
// context.ts
export function buildCoachContext(state: AppState): CoachContext;
// prompt.ts
export function buildSystemPrompt(ctx: CoachContext, mode?: CoachMode): string;
export const QUICK_PROMPTS: { mode: CoachMode; label: string; text: string }[]; // labels: "Plan today", "Suggest exercises", "Swap: equipment taken", "Calories for today"
// tools.ts
export const PROPOSE_WORKOUT_TOOL: AIToolDef;
export function parseProposeWorkout(input: unknown, unit: WeightUnit): ProposedWorkout | null;
export function describeProposal(p: ProposedWorkout, unit: WeightUnit): string;  // one-line text for history replay
// coach.ts
export function historyToMessages(history: ChatMessage[], unit: WeightUnit, max?: number): AIMessage[];
export function trimChat(history: ChatMessage[], maxMessages?: number, maxBytes?: number): ChatMessage[];
export function runCoachTurn(deps: { ai: AIAdapter; unit: WeightUnit; now: () => number }, ctx: CoachContext, history: ChatMessage[], userText: string, mode: CoachMode):
  Promise<{ reply: ChatMessage; error?: { code?: string; message: string } }>;
```
