import { useEffect, useRef, useState } from "preact/hooks";
import { getState, useApp } from "../../data/state";
import { actions } from "../../data/actions";
import { completedSets, isExerciseComplete, resolveToday } from "../../data/session";
import { lastFor, sessionOn, streak, volumeKg } from "../../data/history";
import { WEEKDAY_NAMES, WEEK_ORDER, weekdayOf } from "../../lib/date";
import { formatReps, formatVolume, parseReps, stepWeight } from "../../lib/units";
import type { DayPlan, ExerciseLog, Session, SplitsDoc, WeightUnit, Weekday } from "../../types";
import { Sheet } from "../components/Sheet";
import { Stepper } from "../components/controls";
import { SetChip } from "../components/SetChip";
import { ExercisePicker } from "../components/ExercisePicker";
import { IconCamera, IconCheck, IconMore } from "../icons";
import { buzz, pop, reducedMotion } from "../motion";
import { headerDate, lastLine, pbLine, plural, w } from "../format";

type SheetState = { kind: "adjust"; exId: string } | { kind: "more"; exId: string } | { kind: "add" } | { kind: "pick" } | null;

/** Plan exercises shown as an unstarted session (ids = plan exercise ids). */
function previewFromPlan(plan: DayPlan): ExerciseLog[] {
  return plan.exercises.map((pe) => ({
    id: pe.id,
    name: pe.name,
    reps: pe.reps,
    sets: Array.from({ length: pe.sets }, () => ({ reps: pe.reps.min, weightKg: pe.weightKg, done: false })),
    source: "plan" as const,
    planExerciseId: pe.id,
  }));
}

/** Today's session must exist before a change; returns the real exercise id for a (possibly preview) id. */
function ensureExerciseId(id: string): string | null {
  const s = getState();
  if (s.active && s.active.date === s.today) return id;
  if (s.active) return null; // a stale session is waiting
  actions.startWorkout();
  const a = getState().active;
  if (!a) return null;
  const ex = a.exercises.find((e) => e.planExerciseId === id) ?? a.exercises.find((e) => e.id === id);
  return ex?.id ?? null;
}

function plannedWeight(ex: ExerciseLog, session: Session | null, splits: SplitsDoc | null): number | null {
  if (session?.from && splits && ex.source === "plan" && ex.planExerciseId) {
    const split = splits.splits.find((s) => s.id === session.from!.splitId);
    const pe = split?.days[session.from.weekday]?.exercises.find((p) => p.id === ex.planExerciseId);
    if (pe) return pe.weightKg;
  }
  return ex.sets[0]?.weightKg ?? null;
}

function liveExercise(id: string): ExerciseLog | null {
  const a = getState().active;
  return a?.exercises.find((e) => e.id === id) ?? null;
}

// ── Exercise row ───────────────────────────────────────────────────────────

function ExerciseRow(props: {
  ex: ExerciseLog;
  unit: WeightUnit;
  plannedKg: number | null;
  last: string | null;
  onAdjust: () => void;
  onMore: () => void;
}) {
  const { ex, unit } = props;
  const complete = isExerciseComplete(ex);
  const total = ex.sets.length;
  return (
    <li class={`ex${complete ? " is-complete" : ""}${ex.skipped ? " is-skipped" : ""}`} data-ex={ex.id}>
      <div class="ex-head">
        <h2 class="ex-name">
          {complete && (
            <span class="ex-check" aria-hidden="true">
              <IconCheck size={18} />
            </span>
          )}
          {ex.name}
          {complete && <span class="sr">, done</span>}
        </h2>
        <div class="ex-tools">
          {!ex.skipped && (
            <button type="button" class="link-btn" aria-label={`Adjust ${ex.name}`} onClick={props.onAdjust}>
              Adjust
            </button>
          )}
          <button type="button" class="icon-btn" aria-label={`More for ${ex.name}`} onClick={props.onMore}>
            <IconMore />
          </button>
        </div>
      </div>
      <p class="ex-meta">
        <span class="num">
          {total} × {formatReps(ex.reps)}
        </span>
        <span class="ex-dot" aria-hidden="true">
          ·
        </span>
        <span class="num">{w(props.plannedKg, unit)}</span>
        {ex.swappedFrom && <span class="ex-tag">instead of {ex.swappedFrom}</span>}
        {ex.source === "added" && <span class="ex-tag">added today</span>}
      </p>
      {props.last && <p class="ex-last num">{props.last}</p>}
      {ex.skipped ? (
        <div class="ex-skipped">
          <span>Skipped for today.</span>
          <button type="button" class="link-btn" onClick={() => actions.skipExercise(ex.id, false)}>
            Bring it back
          </button>
        </div>
      ) : (
        <div class="ex-sets">
          {ex.sets.map((s, i) => (
            <SetChip
              key={i}
              exercise={ex.name}
              index={i}
              total={total}
              set={s}
              unit={unit}
              plannedKg={props.plannedKg}
              onLongPress={props.onAdjust}
              onToggle={(el) => {
                const id = ensureExerciseId(ex.id);
                if (!id) return;
                const cur = liveExercise(id)?.sets[i];
                if (cur?.done) actions.uncompleteSet(id, i);
                else {
                  actions.completeSet(id, i);
                  buzz();
                }
                pop(el);
              }}
            />
          ))}
          {!complete && (
            <button
              type="button"
              class="markall"
              aria-label={`Mark all sets of ${ex.name} done`}
              onClick={() => {
                const id = ensureExerciseId(ex.id);
                if (id) actions.markAll(id);
              }}
            >
              Mark all
            </button>
          )}
        </div>
      )}
    </li>
  );
}

// ── Sheets ─────────────────────────────────────────────────────────────────

function AdjustSheet({ exId, unit, step, onClose }: { exId: string; unit: WeightUnit; step: number; onClose: () => void }) {
  const ex = useApp((s) => s.active?.exercises.find((e) => e.id === exId) ?? null);
  if (!ex) return null;
  return (
    <Sheet title={ex.name} onClose={onClose} footer={<button type="button" class="btn btn--primary btn--block" onClick={onClose}>Done</button>}>
      <p class="muted">
        Target <span class="num">{formatReps(ex.reps)}</span> reps. Changes apply to today only.
      </p>
      <ol class="adjust-list">
        {ex.sets.map((s, i) => (
          <li key={i} class={`adjust-row${s.done ? " is-done" : ""}`}>
            <div class="adjust-set">
              <span class="adjust-n num">Set {i + 1}</span>
              <span class="adjust-state">{s.done ? "Done" : "Not done"}</span>
            </div>
            <div class="adjust-steppers">
              <Stepper
                compact
                label="Reps"
                noun="reps"
                suffix={`, set ${i + 1}`}
                value={s.reps}
                canDecrease={s.reps > 0}
                canIncrease={s.reps < 100}
                onStep={(d) => actions.editSet(ex.id, i, { reps: Math.max(0, Math.min(100, s.reps + d)), done: s.done })}
              />
              <Stepper
                compact
                label={`Weight, ${unit}`}
                noun="weight"
                suffix={`, set ${i + 1}`}
                value={s.weightKg == null ? "BW" : w(s.weightKg, unit).replace(` ${unit}`, "")}
                canDecrease={s.weightKg != null}
                onStep={(d) => actions.editSet(ex.id, i, { weightKg: stepWeight(s.weightKg, unit, step, d), done: s.done })}
              />
            </div>
          </li>
        ))}
      </ol>
    </Sheet>
  );
}

function MoreSheet({ exId, onClose }: { exId: string; onClose: () => void }) {
  const ex = useApp((s) => s.active?.exercises.find((e) => e.id === exId) ?? null);
  const [swapping, setSwapping] = useState(false);
  const [name, setName] = useState("");
  if (!ex) return null;
  const doSwap = () => {
    const n = name.trim();
    if (!n) return;
    actions.swapExercise(ex.id, n);
    actions.toast(`Swapped ${ex.name} for ${n}, today only`, "info");
    onClose();
  };
  return (
    <Sheet title={ex.name} label={`More for ${ex.name}`} onClose={onClose}>
      {swapping ? (
        <form
          class="stack"
          onSubmit={(e) => {
            e.preventDefault();
            doSwap();
          }}
        >
          <p class="muted">Swap {ex.name} for something else, today only. Your split stays the same.</p>
          <ExercisePicker value={name} onChange={setName} autofocus onSubmit={doSwap} />
          <div class="row-actions">
            <button type="button" class="btn btn--quiet" onClick={() => setSwapping(false)}>
              Back
            </button>
            <button type="submit" class="btn btn--primary btn--grow" aria-disabled={name.trim() ? undefined : "true"}>
              Swap
            </button>
          </div>
        </form>
      ) : (
        <ul class="menu">
          <li>
            <button type="button" class="menu-item" onClick={() => setSwapping(true)}>
              Swap for today
            </button>
          </li>
          <li>
            <button
              type="button"
              class="menu-item"
              onClick={() => {
                actions.skipExercise(ex.id, !ex.skipped);
                onClose();
              }}
            >
              {ex.skipped ? "Bring it back" : "Skip for today"}
            </button>
          </li>
          <li>
            <button
              type="button"
              class="menu-item"
              onClick={() => {
                actions.addSet(ex.id);
                onClose();
              }}
            >
              Add a set
            </button>
          </li>
          <li>
            <button
              type="button"
              class="menu-item"
              aria-disabled={ex.sets.length <= 1 ? "true" : undefined}
              onClick={() => {
                if (ex.sets.length <= 1) return;
                actions.removeSet(ex.id);
                onClose();
              }}
            >
              Remove a set
            </button>
          </li>
        </ul>
      )}
    </Sheet>
  );
}

function AddSheet({ unit, step, extra, onClose }: { unit: WeightUnit; step: number; extra: boolean; onClose: () => void }) {
  const bests = useApp((s) => s.bests);
  const [name, setName] = useState("");
  const [sets, setSets] = useState(3);
  const [reps, setReps] = useState("8-12");
  const [weightKg, setWeightKg] = useState<number | null>(null);
  const [touchedWeight, setTouchedWeight] = useState(false);
  const [err, setErr] = useState("");

  // Prefill the weight from her records when the name matches one.
  useEffect(() => {
    if (touchedWeight) return;
    const last = name.trim() ? lastFor(name, bests) : null;
    setWeightKg(last?.sets[0]?.weightKg ?? null);
  }, [name]);

  const submit = (e: Event) => {
    e.preventDefault();
    const n = name.trim();
    const r = parseReps(reps);
    if (!n) return setErr("Give the exercise a name.");
    if (!r) return setErr("Reps can be a number like 8 or a range like 8-12.");
    const s = getState();
    if (!s.active) actions.startWorkout(extra ? { extra: true } : undefined);
    actions.addTodayExercise(n, sets, r, weightKg);
    onClose();
  };

  return (
    <Sheet title="Add exercise for today" onClose={onClose}>
      <form class="stack" onSubmit={submit} noValidate>
        <ExercisePicker value={name} onChange={(v) => (setName(v), setErr(""))} autofocus />
        <div class="steppers-2">
          <Stepper label="Sets" noun="sets" value={sets} canDecrease={sets > 1} canIncrease={sets < 10} onStep={(d) => setSets(Math.max(1, Math.min(10, sets + d)))} />
          <Stepper
            label={`Weight, ${unit}`}
            noun="weight"
            value={weightKg == null ? "BW" : w(weightKg, unit).replace(` ${unit}`, "")}
            canDecrease={weightKg != null}
            onStep={(d) => (setTouchedWeight(true), setWeightKg(stepWeight(weightKg, unit, step, d)))}
          />
        </div>
        <div class="field">
          <label class="field-label" for="add-reps">
            Reps
          </label>
          <input id="add-reps" class="input num" type="text" inputMode="text" value={reps} onInput={(e) => (setReps((e.currentTarget as HTMLInputElement).value), setErr(""))} />
          <p class="field-hint">A number like 8, or a range like 8-12.</p>
        </div>
        {err && (
          <p class="field-error" role="alert">
            {err}
          </p>
        )}
        <button type="submit" class="btn btn--primary btn--block">
          Add to today
        </button>
      </form>
    </Sheet>
  );
}

function PickDaySheet({ splits, todayWd, picked, onClose }: { splits: SplitsDoc | null; todayWd: Weekday; picked: Weekday | null; onClose: () => void }) {
  const split = splits ? splits.splits.find((s) => s.id === splits.activeId) ?? null : null;
  const current = picked ?? todayWd;
  return (
    <Sheet title="Do another day's workout" onClose={onClose}>
      <p class="muted">Today only. Your split stays the same, and the calendar logs it on today.</p>
      {split && split.days.every((d) => d.kind === "rest") && <p class="note-line">Your split has no workout days yet. Add one in Split.</p>}
      <ul class="daylist">
        {WEEK_ORDER.map((wd) => {
          const day = split?.days[wd];
          const rest = !day || day.kind === "rest";
          return (
            <li key={wd}>
              <button
                type="button"
                class={`daylist-item${wd === current ? " is-current" : ""}`}
                aria-current={wd === current ? "true" : undefined}
                aria-disabled={rest ? "true" : undefined}
                onClick={() => {
                  if (rest) return;
                  actions.pickWeekday(wd === todayWd ? null : wd);
                  onClose();
                }}
              >
                <span class="daylist-day">{WEEKDAY_NAMES[wd]}</span>
                <span class="daylist-name">
                  {rest ? "Rest" : day!.name}
                  {!rest && <span class="daylist-count num"> · {plural(day!.exercises.length, "exercise")}</span>}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </Sheet>
  );
}

// ── Note + photo ───────────────────────────────────────────────────────────

function NoteAndPhoto({ session }: { session: Session }) {
  const [draft, setDraft] = useState(session.note ?? "");
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  useEffect(() => setDraft(session.note ?? ""), [session.id]);
  const save = () => {
    const v = draft.trim().slice(0, 140);
    if (v !== (session.note ?? "")) actions.setSessionNote(v);
  };
  return (
    <div class="today-extras">
      <div class="field">
        <label class="field-label" for="today-note">
          Note
        </label>
        <input
          id="today-note"
          class="input"
          type="text"
          aria-label="Note for today"
          placeholder="One line about today"
          maxLength={140}
          enterKeyHint="done"
          value={draft}
          onInput={(e) => setDraft((e.currentTarget as HTMLInputElement).value)}
          onBlur={save}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              save();
              (e.currentTarget as HTMLInputElement).blur();
            }
          }}
        />
        {draft.length > 110 && <p class="field-hint num">{140 - draft.length} characters left</p>}
      </div>
      <div class="photo-row">
        {session.thumb && <img class="photo-thumb" src={session.thumb} alt="Today's photo" width={56} height={56} />}
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          capture="environment"
          class="sr"
          tabIndex={-1}
          aria-hidden="true"
          onChange={async (e) => {
            const input = e.currentTarget as HTMLInputElement;
            const file = input.files?.[0];
            input.value = "";
            if (!file) return;
            setBusy(true);
            try {
              await actions.setSessionPhoto(file);
            } catch {
              actions.toast("Couldn't save that photo. Try a different one.", "error");
            } finally {
              setBusy(false);
            }
          }}
        />
        <button type="button" class="btn btn--secondary" aria-busy={busy ? "true" : undefined} onClick={() => fileRef.current?.click()}>
          <IconCamera />
          <span>{busy ? "Saving photo…" : session.thumb ? "Replace photo" : "Add photo"}</span>
        </button>
        {session.thumb && !busy && (
          <button type="button" class="link-btn" onClick={() => void actions.removeSessionPhoto()}>
            Remove
          </button>
        )}
      </div>
    </div>
  );
}

// ── Screen ─────────────────────────────────────────────────────────────────

export function Today() {
  const today = useApp((s) => s.today);
  const splits = useApp((s) => s.splits);
  const active = useApp((s) => s.active);
  const picked = useApp((s) => s.pickedWeekday);
  const bests = useApp((s) => s.bests);
  const logs = useApp((s) => s.logs);
  const profile = useApp((s) => s.profile)!;
  const step = useApp((s) => s.settings.weightStep);
  const [sheet, setSheet] = useState<SheetState>(null);
  const unit = profile.units;

  const stale = active && active.date < today ? active : null;
  const session = active && active.date === today ? active : null;
  const resolved = resolveToday(today, splits, picked);
  const plan = resolved.plan;
  const finished = !session ? sessionOn(today, logs) : null;
  const streakN = streak(today, splits, logs, profile.startedOn);
  const todayWd = weekdayOf(today);

  const isRest = !session && !finished && (!plan || plan.kind === "rest");
  const title = session ? session.title : finished ? finished.title : plan && plan.kind === "workout" ? plan.name : "Rest day";
  const exercises: ExerciseLog[] = session ? session.exercises : !finished && !stale && plan && plan.kind === "workout" ? previewFromPlan(plan) : [];

  const openFor = (kind: "adjust" | "more", id: string) => {
    const real = ensureExerciseId(id);
    if (real) setSheet({ kind, exId: real });
  };

  return (
    <section class="screen today" aria-labelledby="today-title">
      <header class="today-head">
        <div class="today-top">
          <p class="eyebrow">{headerDate(today)}</p>
          {streakN > 0 && (
            <p class="streak" aria-label={`Streak: ${plural(streakN, "workout")}`}>
              <span class="streak-label">Streak</span>
              <span class="streak-n num">{streakN}</span>
            </p>
          )}
        </div>
        <h1 id="today-title" class="display">
          {title}
        </h1>
        {exercises.length > 0 && (
          <p class="today-meta num">
            {plural(exercises.filter((e) => !e.skipped).length, "exercise")} · {plural(exercises.filter((e) => !e.skipped).reduce((n, e) => n + e.sets.length, 0), "set")}
          </p>
        )}
        {session?.coachAdjusted && <p class="today-sub">Adjusted with the coach, today only.</p>}
        {!session && picked != null && plan && (
          <p class="today-sub">
            {WEEKDAY_NAMES[picked]}'s workout, today only.{" "}
            <button type="button" class="link-btn" onClick={() => actions.pickWeekday(null)}>
              Back to {WEEKDAY_NAMES[todayWd]}'s plan
            </button>
          </p>
        )}
        {!session && !finished && !stale && picked == null && plan?.kind === "workout" && (
          <p class="today-sub">
            Not feeling {plan.name}?{" "}
            <button type="button" class="link-btn" onClick={() => setSheet({ kind: "pick" })}>
              Do another day's workout
            </button>
          </p>
        )}
      </header>

      {stale && (
        <div class="card card--note" role="region" aria-label="Unfinished workout">
          <h2 class="card-title">You didn't finish {WEEKDAY_NAMES[weekdayOf(stale.date)]}'s workout</h2>
          <p class="muted">
            {stale.title}: <span class="num">{plural(completedSets(stale), "set")}</span> done. Save it to its own day, or let it go to start today's.
          </p>
          <div class="row-actions">
            <button type="button" class="btn btn--secondary" onClick={() => actions.discardWorkout()}>
              Discard
            </button>
            <button type="button" class="btn btn--primary btn--grow" onClick={() => actions.finishWorkout()}>
              Finish it
            </button>
          </div>
        </div>
      )}

      {finished && (
        <div class="card">
          <h2 class="card-title">Logged for today</h2>
          <p class="stats-line num">
            {plural(finished.exercises.filter((e) => !e.skipped && e.sets.some((s) => s.done)).length, "exercise")} ·{" "}
            {plural(completedSets(finished), "set")} · {formatVolume(volumeKg(finished), unit)}
          </p>
          {finished.finishLine && <p class="muted">{finished.finishLine}</p>}
          <button type="button" class="btn btn--secondary" onClick={() => actions.setTab("calendar")}>
            See it in Calendar
          </button>
        </div>
      )}

      {isRest && !stale && (
        <div class="card rest-card">
          {!plan ? (
            <>
              <h2 class="card-title">No split yet</h2>
              <p class="muted">Set up your week in Split, then today's workout shows here.</p>
              <button type="button" class="btn btn--secondary" onClick={() => actions.setTab("split")}>
                Open Split
              </button>
            </>
          ) : (
            <>
              <p class="rest-line">Rest day. Recovery is part of the plan.</p>
              <div class="stack-tight">
                <button type="button" class="btn btn--secondary btn--block" onClick={() => actions.startWorkout({ extra: true })}>
                  Log an extra workout
                </button>
                <button type="button" class="btn btn--quiet btn--block" onClick={() => setSheet({ kind: "pick" })}>
                  Do another day's workout
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {exercises.length > 0 && (
        <ul class="ex-list">
          {exercises.map((ex) => (
            <ExerciseRow
              key={ex.id}
              ex={ex}
              unit={unit}
              plannedKg={plannedWeight(ex, session, splits)}
              last={lastLine(lastFor(ex.name, bests), unit)}
              onAdjust={() => openFor("adjust", ex.id)}
              onMore={() => openFor("more", ex.id)}
            />
          ))}
        </ul>
      )}

      {session && session.exercises.length === 0 && <p class="empty">Nothing here yet. Add the first exercise.</p>}

      {!stale && !finished && (session || (plan && plan.kind === "workout")) && (
        <button type="button" class="btn btn--dashed btn--block" onClick={() => setSheet({ kind: "add" })}>
          Add exercise for today
        </button>
      )}

      {session && <NoteAndPhoto session={session} />}
      {!session && !finished && !stale && plan?.kind === "workout" && <p class="hint-line">Tap a set when you finish it. Hold it to change reps or weight.</p>}

      {sheet?.kind === "adjust" && <AdjustSheet exId={sheet.exId} unit={unit} step={step} onClose={() => setSheet(null)} />}
      {sheet?.kind === "more" && <MoreSheet exId={sheet.exId} onClose={() => setSheet(null)} />}
      {sheet?.kind === "add" && <AddSheet unit={unit} step={step} extra={!plan || plan.kind === "rest"} onClose={() => setSheet(null)} />}
      {sheet?.kind === "pick" && <PickDaySheet splits={splits} todayWd={todayWd} picked={picked} onClose={() => setSheet(null)} />}
    </section>
  );
}

// ── Sticky finish bar (rendered by the shell above the tab bar) ────────────

export function FinishBar() {
  const active = useApp((s) => s.active);
  const today = useApp((s) => s.today);
  const [confirm, setConfirm] = useState(false);
  useEffect(() => setConfirm(false), [active?.id]);
  if (!active || active.date !== today) return null;
  const done = completedSets(active);
  const total = active.exercises.filter((e) => !e.skipped).reduce((n, e) => n + e.sets.length, 0);
  return (
    <div class="finishbar">
      <div class="finishbar-inner">
        <p class="finishbar-count num" aria-live="polite">
          <span class="finishbar-n">{done}</span>
          <span class="finishbar-of">/{total} sets</span>
        </p>
        {done > 0 ? (
          <button type="button" class="btn btn--primary btn--grow btn--big" onClick={() => actions.finishWorkout()}>
            Finish workout
          </button>
        ) : (
          <button
            type="button"
            class="btn btn--secondary btn--grow btn--big"
            onClick={() => {
              if (!confirm) return setConfirm(true);
              actions.discardWorkout();
            }}
          >
            {confirm ? "Tap again to discard" : "Discard workout"}
          </button>
        )}
      </div>
    </div>
  );
}

// ── Summary ────────────────────────────────────────────────────────────────

export function SummarySheet() {
  const summary = useApp((s) => s.summary);
  const unit = useApp((s) => s.profile?.units ?? "lb");
  const [saved, setSaved] = useState(false);
  const [fade] = useState(() => reducedMotion());
  if (!summary) return null;
  const close = () => actions.dismissSummary();
  return (
    <Sheet
      title={summary.title}
      label="Workout summary"
      onClose={close}
      fade={fade}
      class="summary"
      footer={
        <button type="button" class="btn btn--primary btn--block btn--big" onClick={close} data-autofocus>
          Done
        </button>
      }
    >
      <p class="summary-line">{summary.finishLine}</p>
      <dl class="stats">
        <div class="stat">
          <dt>Exercises</dt>
          <dd class="num">{summary.exercisesDone}</dd>
        </div>
        <div class="stat">
          <dt>Sets</dt>
          <dd class="num">{summary.totalSets}</dd>
        </div>
        <div class="stat stat--wide">
          <dt>Volume</dt>
          <dd class="num">{formatVolume(summary.volumeKg, unit)}</dd>
        </div>
      </dl>
      {summary.bests.length > 0 && (
        <section class="pbs" aria-labelledby="pb-h">
          <h3 id="pb-h" class="section-label">
            {summary.bests.length === 1 ? "Personal best" : `${summary.bests.length} personal bests`}
          </h3>
          <ul>
            {summary.bests.map((pb, i) => (
              <li key={i} class="pb">
                <span class="pb-name">{pb.exercise}</span>
                <span class="pb-what num">{pbLine(pb, unit)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      {summary.weightsChanged &&
        (saved ? (
          <p class="saved-line">
            <IconCheck size={18} /> Saved. Your split uses today's weights now.
          </p>
        ) : (
          <div class="summary-weights">
            <p class="muted">You changed some weights today.</p>
            <button
              type="button"
              class="btn btn--secondary btn--block"
              onClick={() => {
                actions.saveWeightsToSplit();
                setSaved(true);
              }}
            >
              Use today's weights in my split
            </button>
          </div>
        ))}
    </Sheet>
  );
}
