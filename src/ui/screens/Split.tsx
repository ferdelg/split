import { useEffect, useRef, useState } from "preact/hooks";
import { getState, useApp } from "../../data/state";
import { actions } from "../../data/actions";
import { activeSplit } from "../../data/split";
import { WEEKDAY_NAMES, WEEKDAY_SHORT, WEEK_ORDER, todayISO, weekdayOf } from "../../lib/date";
import { formatReps, parseReps, stepWeight } from "../../lib/units";
import type { DayPlan, PlannedExercise, RepTarget, Split, WeightUnit, Weekday } from "../../types";
import { Sheet } from "../components/Sheet";
import { Segmented, Stepper } from "../components/controls";
import { ExercisePicker } from "../components/ExercisePicker";
import { IconCopy, IconDown, IconGrip, IconTrash, IconUp } from "../icons";
import { plural, shortDate, w } from "../format";

// ── Exercise form ──────────────────────────────────────────────────────────

function shiftReps(r: RepTarget, d: number): RepTarget {
  const min = Math.max(1, Math.min(100, r.min + d));
  if (r.max == null) return { min };
  return { min, max: Math.max(min + 1, Math.min(100, r.max + d)) };
}

function ExerciseForm(props: { initial: PlannedExercise | null; unit: WeightUnit; step: number; onSave: (ex: Omit<PlannedExercise, "id">) => void; onCancel: () => void }) {
  const init = props.initial;
  const [name, setName] = useState(init?.name ?? "");
  const [sets, setSets] = useState(init?.sets ?? 3);
  const [reps, setReps] = useState(init ? formatReps(init.reps).replace("–", "-") : "8-12");
  const [weightKg, setWeightKg] = useState<number | null>(init?.weightKg ?? null);
  const [note, setNote] = useState(init?.note ?? "");
  const [err, setErr] = useState("");
  const { unit } = props;

  const submit = (e: Event) => {
    e.preventDefault();
    const n = name.trim();
    const r = parseReps(reps);
    if (!n) return setErr("Give the exercise a name.");
    if (!r) return setErr("Reps can be a number like 8 or a range like 8-12.");
    const out: Omit<PlannedExercise, "id"> = { name: n, sets, reps: r, weightKg };
    if (note.trim()) out.note = note.trim();
    props.onSave(out);
  };
  const parsed = parseReps(reps);

  return (
    <form class="stack" onSubmit={submit} noValidate>
      <ExercisePicker value={name} onChange={(v) => (setName(v), setErr(""))} autofocus={!init} />
      <div class="steppers-2">
        <Stepper label="Sets" noun="sets" value={sets} canDecrease={sets > 1} canIncrease={sets < 10} onStep={(d) => setSets(Math.max(1, Math.min(10, sets + d)))} />
        <Stepper
          label={`Weight, ${unit}`}
          noun="weight"
          value={weightKg == null ? "BW" : w(weightKg, unit).replace(` ${unit}`, "")}
          canDecrease={weightKg != null}
          onStep={(d) => setWeightKg(stepWeight(weightKg, unit, props.step, d))}
        />
      </div>
      <div class="field">
        <label class="field-label" for="exf-reps">
          Reps
        </label>
        <div class="reps-row">
          <button type="button" class="stepper-btn" aria-label="Decrease reps" onClick={() => parsed && setReps(formatReps(shiftReps(parsed, -1)).replace("–", "-"))}>
            −
          </button>
          <input
            id="exf-reps"
            class="input num reps-input"
            type="text"
            value={reps}
            aria-describedby="exf-reps-hint"
            onInput={(e) => (setReps((e.currentTarget as HTMLInputElement).value), setErr(""))}
          />
          <button type="button" class="stepper-btn" aria-label="Increase reps" onClick={() => parsed && setReps(formatReps(shiftReps(parsed, 1)).replace("–", "-"))}>
            +
          </button>
        </div>
        <p id="exf-reps-hint" class="field-hint">
          A number like 8, or a range like 8-12.
        </p>
      </div>
      <div class="field">
        <label class="field-label" for="exf-note">
          Note <span class="field-opt">optional</span>
        </label>
        <input id="exf-note" class="input" type="text" maxLength={80} placeholder="Seat 4, pause at the bottom" value={note} onInput={(e) => setNote((e.currentTarget as HTMLInputElement).value)} />
      </div>
      {err && (
        <p class="field-error" role="alert">
          {err}
        </p>
      )}
      <div class="row-actions">
        <button type="button" class="btn btn--quiet" onClick={props.onCancel}>
          Cancel
        </button>
        <button type="submit" class="btn btn--primary btn--grow">
          Save exercise
        </button>
      </div>
    </form>
  );
}

// ── Reorderable list (up/down buttons are the accessible path; the grip drags) ─

function ExerciseList(props: { wd: Weekday; day: DayPlan; unit: WeightUnit; readOnly: boolean; onEdit: (id: string) => void }) {
  const { wd, day, unit, readOnly } = props;
  const [drag, setDrag] = useState<{ from: number; dy: number; h: number } | null>(null);
  const startY = useRef(0);

  const target = (d: { from: number; dy: number; h: number }) => Math.max(0, Math.min(day.exercises.length - 1, d.from + Math.round(d.dy / d.h)));

  const remove = (ex: PlannedExercise, idx: number) => {
    actions.deleteExercise(wd, ex.id);
    actions.toast(`Deleted ${ex.name}`, "info", {
      label: "Undo",
      run: () => {
        const { id: _id, ...rest } = ex;
        void _id;
        actions.addExercise(wd, rest);
        const len = activeSplit(getState().splits)?.days[wd].exercises.length ?? 0;
        if (len > 0 && idx < len - 1) actions.moveExercise(wd, len - 1, idx);
      },
    });
  };

  if (day.exercises.length === 0) return <p class="empty">Nothing here yet. Add the first exercise.</p>;
  const to = drag ? target(drag) : -1;
  return (
    <ol class="edit-list">
      {day.exercises.map((ex, i) => {
        let shift = 0;
        if (drag && i !== drag.from) {
          if (drag.from < i && i <= to) shift = -drag.h;
          if (drag.from > i && i >= to) shift = drag.h;
        }
        const style = drag ? (i === drag.from ? `transform: translateY(${drag.dy}px)` : `transform: translateY(${shift}px)`) : undefined;
        return (
          <li key={ex.id} class={`edit-row${drag?.from === i ? " is-dragging" : ""}`} style={style}>
            {!readOnly && (
              <span
                class="grip"
                aria-hidden="true"
                onPointerDown={(e) => {
                  const row = (e.currentTarget as HTMLElement).closest("li") as HTMLElement;
                  (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
                  startY.current = e.clientY;
                  setDrag({ from: i, dy: 0, h: row.getBoundingClientRect().height });
                }}
                onPointerMove={(e) => drag && setDrag({ ...drag, dy: e.clientY - startY.current })}
                onPointerUp={() => {
                  if (drag) {
                    const t = target(drag);
                    if (t !== drag.from) actions.moveExercise(wd, drag.from, t);
                  }
                  setDrag(null);
                }}
                onPointerCancel={() => setDrag(null)}
              >
                <IconGrip />
              </span>
            )}
            <button type="button" class="edit-main" aria-label={readOnly ? undefined : `Edit ${ex.name}`} onClick={() => !readOnly && props.onEdit(ex.id)} disabled={readOnly}>
              <span class="edit-name">{ex.name}</span>
              <span class="edit-meta num">
                {ex.sets} × {formatReps(ex.reps)} · {w(ex.weightKg, unit)}
              </span>
              {ex.note && <span class="edit-note">{ex.note}</span>}
            </button>
            {!readOnly && (
              <div class="edit-tools">
                <button type="button" class="icon-btn" aria-label={`Move ${ex.name} up`} aria-disabled={i === 0 ? "true" : undefined} onClick={() => i > 0 && actions.moveExercise(wd, i, i - 1)}>
                  <IconUp />
                </button>
                <button
                  type="button"
                  class="icon-btn"
                  aria-label={`Move ${ex.name} down`}
                  aria-disabled={i === day.exercises.length - 1 ? "true" : undefined}
                  onClick={() => i < day.exercises.length - 1 && actions.moveExercise(wd, i, i + 1)}
                >
                  <IconDown />
                </button>
                <button type="button" class="icon-btn" aria-label={`Duplicate ${ex.name}`} onClick={() => actions.duplicateExercise(wd, ex.id)}>
                  <IconCopy />
                </button>
                <button type="button" class="icon-btn" aria-label={`Delete ${ex.name}`} onClick={() => remove(ex, i)}>
                  <IconTrash />
                </button>
              </div>
            )}
          </li>
        );
      })}
    </ol>
  );
}

// ── Day editor ─────────────────────────────────────────────────────────────

type EditorMode = { kind: "list" } | { kind: "form"; exId: string | null } | { kind: "copy" };

function DayEditor(props: { split: Split; wd: Weekday; readOnly: boolean; unit: WeightUnit; step: number; onClose: () => void }) {
  const { split, wd, readOnly, unit } = props;
  const day = split.days[wd];
  const [mode, setMode] = useState<EditorMode>({ kind: "list" });
  const [name, setName] = useState(day.name);
  useEffect(() => setName(day.name), [day.name]);
  const saveName = () => {
    const n = name.trim();
    if (n && n !== day.name) actions.renameDay(wd, n);
    else setName(day.name);
  };

  let body;
  if (mode.kind === "form") {
    const ex = mode.exId ? day.exercises.find((e) => e.id === mode.exId) ?? null : null;
    body = (
      <>
        <h3 class="section-label">{ex ? `Edit ${ex.name}` : "New exercise"}</h3>
        <ExerciseForm
          initial={ex}
          unit={unit}
          step={props.step}
          onCancel={() => setMode({ kind: "list" })}
          onSave={(out) => {
            if (ex) actions.updateExercise(wd, ex.id, out);
            else actions.addExercise(wd, out);
            setMode({ kind: "list" });
          }}
        />
      </>
    );
  } else if (mode.kind === "copy") {
    body = (
      <>
        <h3 class="section-label">Copy {WEEKDAY_NAMES[wd]} to…</h3>
        <p class="muted">This replaces that day's plan with a copy of {day.name}.</p>
        <ul class="daylist">
          {WEEK_ORDER.filter((d) => d !== wd).map((d) => (
            <li key={d}>
              <button
                type="button"
                class="daylist-item"
                onClick={() => {
                  actions.copyDay(wd, d);
                  actions.toast(`Copied ${WEEKDAY_NAMES[wd]} to ${WEEKDAY_NAMES[d]}`, "success");
                  setMode({ kind: "list" });
                }}
              >
                <span class="daylist-day">{WEEKDAY_NAMES[d]}</span>
                <span class="daylist-name">{split.days[d].kind === "rest" ? "Rest" : split.days[d].name}</span>
              </button>
            </li>
          ))}
        </ul>
        <button type="button" class="btn btn--quiet" onClick={() => setMode({ kind: "list" })}>
          Back
        </button>
      </>
    );
  } else {
    body = (
      <>
        {readOnly ? (
          <p class="muted">{day.kind === "rest" ? "Rest day." : day.name}</p>
        ) : (
          <>
            <div class="field">
              <label class="field-label" for="day-name">
                Day name
              </label>
              <input
                id="day-name"
                class="input input--title"
                type="text"
                maxLength={40}
                enterKeyHint="done"
                value={name}
                onInput={(e) => {
                  // Save as she types: closing the sheet doesn't always blur
                  // the field first (WebKit), and writes are coalesced anyway.
                  const v = (e.currentTarget as HTMLInputElement).value;
                  setName(v);
                  if (v.trim() && v.trim() !== day.name) actions.renameDay(wd, v.trim());
                }}
                onBlur={saveName}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    (e.currentTarget as HTMLInputElement).blur();
                  }
                }}
              />
            </div>
            <Segmented
              label="Day type"
              value={day.kind}
              options={[
                { value: "workout", label: "Workout" },
                { value: "rest", label: "Rest" },
              ]}
              onChange={(k) => actions.setDayKind(wd, k)}
            />
          </>
        )}
        {day.kind === "rest" && !readOnly && <p class="note-line">A rest day. Switch to Workout to plan exercises.</p>}
        {day.kind === "workout" && (
          <>
            <h3 class="section-label">{plural(day.exercises.length, "exercise")}</h3>
            <ExerciseList wd={wd} day={day} unit={unit} readOnly={readOnly} onEdit={(id) => setMode({ kind: "form", exId: id })} />
          </>
        )}
        {!readOnly && (
          <div class="stack-tight">
            {day.kind === "workout" && (
              <button type="button" class="btn btn--dashed btn--block" onClick={() => setMode({ kind: "form", exId: null })}>
                Add exercise
              </button>
            )}
            <button type="button" class="btn btn--quiet btn--block" onClick={() => setMode({ kind: "copy" })}>
              Copy this day to…
            </button>
          </div>
        )}
      </>
    );
  }

  return (
    <Sheet title={WEEKDAY_NAMES[wd]} onClose={props.onClose} full>
      <div class="stack">{body}</div>
    </Sheet>
  );
}

// ── Splits sheet + rename ──────────────────────────────────────────────────

function RenameSheet({ split, onClose }: { split: Split; onClose: () => void }) {
  const [name, setName] = useState(split.name);
  return (
    <Sheet title="Rename split" onClose={onClose}>
      <form
        class="stack"
        onSubmit={(e) => {
          e.preventDefault();
          const n = name.trim();
          if (n) actions.renameSplit(split.id, n);
          onClose();
        }}
      >
        <div class="field">
          <label class="field-label" for="split-name">
            Split name
          </label>
          <input id="split-name" class="input" type="text" maxLength={40} value={name} data-autofocus onInput={(e) => setName((e.currentTarget as HTMLInputElement).value)} />
        </div>
        <button type="submit" class="btn btn--primary btn--block">
          Save
        </button>
      </form>
    </Sheet>
  );
}

function SplitsSheet(props: { onView: (id: string | null) => void; onRename: (id: string) => void; onClose: () => void }) {
  const splits = useApp((s) => s.splits);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  if (!splits) return null;
  const sorted = [...splits.splits].sort((a, b) => (a.id === splits.activeId ? -1 : b.id === splits.activeId ? 1 : (b.archivedAt ?? 0) - (a.archivedAt ?? 0)));
  return (
    <Sheet title="Splits" onClose={props.onClose}>
      <ul class="splits">
        {sorted.map((s) => {
          const isActive = s.id === splits.activeId;
          const workouts = s.days.filter((d) => d.kind === "workout").length;
          return (
            <li key={s.id} class={`split-item${isActive ? " is-active" : ""}`}>
              <div class="split-item-head">
                <h3 class="split-item-name">{s.name}</h3>
                <span class="split-item-tag">{isActive ? "Active" : s.archivedAt ? `Archived ${shortDate(todayISO(new Date(s.archivedAt)))}` : "Archived"}</span>
              </div>
              <p class="muted num">{plural(workouts, "workout day")} a week</p>
              <div class="split-item-actions">
                {!isActive && (
                  <button type="button" class="btn btn--small btn--secondary" onClick={() => (props.onView(s.id), props.onClose())}>
                    View
                  </button>
                )}
                {!isActive && (
                  <button
                    type="button"
                    class="btn btn--small btn--secondary"
                    onClick={() => {
                      actions.activateSplit(s.id);
                      actions.toast(`${s.name} is your split now`, "success");
                      props.onView(null);
                      props.onClose();
                    }}
                  >
                    Use this split
                  </button>
                )}
                <button type="button" class="btn btn--small btn--secondary" onClick={() => props.onRename(s.id)}>
                  Rename
                </button>
                <button
                  type="button"
                  class="btn btn--small btn--secondary"
                  onClick={() => {
                    actions.duplicateSplit(s.id, `${s.name} copy`);
                    actions.toast(`Made a copy of ${s.name}`, "success");
                  }}
                >
                  {isActive ? "New split from this one" : "Duplicate"}
                </button>
                {!isActive && (
                  <button
                    type="button"
                    class={`btn btn--small ${confirmDelete === s.id ? "btn--danger" : "btn--secondary"}`}
                    onClick={() => {
                      if (confirmDelete !== s.id) return setConfirmDelete(s.id);
                      actions.deleteSplit(s.id);
                      setConfirmDelete(null);
                    }}
                  >
                    {confirmDelete === s.id ? "Tap again to delete" : "Delete"}
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </Sheet>
  );
}

// ── Screen ─────────────────────────────────────────────────────────────────

export function SplitScreen() {
  const splits = useApp((s) => s.splits);
  const today = useApp((s) => s.today);
  const unit = useApp((s) => s.profile?.units ?? "lb");
  const step = useApp((s) => s.settings.weightStep);
  const [viewId, setViewId] = useState<string | null>(null);
  const [editDay, setEditDay] = useState<Weekday | null>(null);
  const [sheet, setSheet] = useState<{ kind: "splits" } | { kind: "rename"; id: string } | null>(null);

  const viewed = viewId ? splits?.splits.find((s) => s.id === viewId) ?? null : null;
  const split = viewed ?? activeSplit(splits);
  const readOnly = !!split && split.id !== splits?.activeId;
  const todayWd = weekdayOf(today);
  const renaming = sheet?.kind === "rename" ? splits?.splits.find((s) => s.id === sheet.id) ?? null : null;

  return (
    <section class="screen" aria-labelledby="split-title">
      <header class="screen-head">
        <div class="head-row">
          <p class="eyebrow">{readOnly ? "Archived split" : "Your week"}</p>
          <button type="button" class="link-btn" onClick={() => setSheet({ kind: "splits" })}>
            Splits
          </button>
        </div>
        {split && !readOnly ? (
          <h1 id="split-title" class="display">
            <button type="button" class="title-btn" aria-label={`${split.name}, rename`} onClick={() => setSheet({ kind: "rename", id: split.id })}>
              {split.name}
            </button>
          </h1>
        ) : (
          <h1 id="split-title" class="display">
            {split?.name ?? "No split"}
          </h1>
        )}
      </header>

      {readOnly && split && (
        <div class="card card--note">
          <p>Read-only. This split is archived; your active one is untouched.</p>
          <div class="row-actions">
            <button type="button" class="btn btn--secondary" onClick={() => setViewId(null)}>
              Back to my split
            </button>
            <button
              type="button"
              class="btn btn--primary btn--grow"
              onClick={() => {
                actions.activateSplit(split.id);
                actions.toast(`${split.name} is your split now`, "success");
                setViewId(null);
              }}
            >
              Use this split
            </button>
          </div>
        </div>
      )}

      {split && (
        <ol class="week">
          {WEEK_ORDER.map((wd) => {
            const day = split.days[wd];
            const rest = day.kind === "rest";
            const names = day.exercises.map((e) => e.name);
            return (
              <li key={wd}>
                <button
                  type="button"
                  class={`weekday${rest ? " is-rest" : ""}${wd === todayWd && !readOnly ? " is-today" : ""}`}
                  aria-label={`${readOnly ? "View" : "Edit"} ${WEEKDAY_NAMES[wd]}`}
                  onClick={() => setEditDay(wd)}
                >
                  <span class="weekday-short">{WEEKDAY_SHORT[wd]}</span>
                  <span class="weekday-body">
                    <span class="weekday-name">{rest ? "Rest" : day.name}</span>
                    {!rest && (
                      <span class="weekday-meta">
                        <span class="num">{plural(day.exercises.length, "exercise")}</span>
                        {names.length > 0 && <span class="weekday-list"> · {names.slice(0, 3).join(", ")}{names.length > 3 ? ` +${names.length - 3}` : ""}</span>}
                      </span>
                    )}
                  </span>
                  {wd === todayWd && !readOnly && <span class="weekday-today">Today</span>}
                </button>
              </li>
            );
          })}
        </ol>
      )}

      {split && editDay != null && <DayEditor split={split} wd={editDay} readOnly={readOnly} unit={unit} step={step} onClose={() => setEditDay(null)} />}
      {sheet?.kind === "splits" && <SplitsSheet onView={setViewId} onRename={(id) => setSheet({ kind: "rename", id })} onClose={() => setSheet(null)} />}
      {renaming && <RenameSheet split={renaming} onClose={() => setSheet(null)} />}
    </section>
  );
}
