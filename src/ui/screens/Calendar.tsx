import { useEffect, useState } from "preact/hooks";
import { services, useApp } from "../../data/state";
import { actions } from "../../data/actions";
import { dayStatus, exerciseHistory, gymDaysInMonth, loggedExerciseNames, plannedOn, sessionOn, streak, volumeKg } from "../../data/history";
import { completedSets } from "../../data/session";
import { MONTH_NAMES, addMonths, daysInMonth, formatLongDate, monthOf, parseISO, weekdayOf } from "../../lib/date";
import { formatVolume } from "../../lib/units";
import type { DayStatus, ISODate, Session, WeightUnit } from "../../types";
import { Sheet } from "../components/Sheet";
import { LineChart } from "../components/LineChart";
import { IconLeft, IconRight } from "../icons";
import { pbLine, plural, shortDate, wn } from "../format";

const HEAD = ["M", "T", "W", "T", "F", "S", "S"];
const HEAD_FULL = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

function statusWord(s: DayStatus): string {
  return s === "before-start" ? "before you started" : s;
}

function setsLine(sets: { reps: number; weightKg: number | null }[], unit: WeightUnit): string {
  if (sets.length === 0) return "";
  const same = sets.every((s) => (s.weightKg ?? -1).toFixed(2) === (sets[0].weightKg ?? -1).toFixed(2));
  if (same) {
    const head = sets[0].weightKg == null ? "BW" : `${wn(sets[0].weightKg, unit)} ${unit}`;
    return `${head} × ${sets.map((s) => s.reps).join(", ")}`;
  }
  return sets.map((s) => `${s.weightKg == null ? "BW" : wn(s.weightKg, unit)} × ${s.reps}`).join(", ");
}

// ── Day sheet ──────────────────────────────────────────────────────────────

function Photo({ session }: { session: Session }) {
  const [url, setUrl] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    if (!session.photoId) {
      setUrl(null);
      return;
    }
    services()
      .media.loadPhoto(session.photoId)
      .then((u) => live && setUrl(u))
      .catch(() => live && setUrl(null));
    return () => {
      live = false;
    };
  }, [session.photoId]);
  if (url === undefined) return session.thumb ? <img class="photo-thumb" src={session.thumb} alt="" width={56} height={56} /> : null;
  if (url) return <img class="photo-full" src={url} alt={`Photo from ${formatLongDate(session.date)}`} />;
  if (!session.thumb) return null;
  return (
    <div class="photo-row">
      <img class="photo-thumb" src={session.thumb} alt={`Small photo from ${formatLongDate(session.date)}`} width={56} height={56} />
      {session.photoId && <p class="muted">Full photo removed to save space</p>}
    </div>
  );
}

function LoggedNote({ session }: { session: Session }) {
  const [draft, setDraft] = useState(session.note ?? "");
  useEffect(() => setDraft(session.note ?? ""), [session.date, session.note]);
  const save = () => {
    const v = draft.trim().slice(0, 140);
    if (v !== (session.note ?? "")) {
      actions.setLoggedNote(session.date, v);
      actions.toast("Note saved", "success");
    }
  };
  return (
    <div class="field">
      <label class="field-label" for="cal-note">
        Note
      </label>
      <input
        id="cal-note"
        class="input"
        type="text"
        maxLength={140}
        placeholder="One line about this day"
        enterKeyHint="done"
        value={draft}
        onInput={(e) => setDraft((e.currentTarget as HTMLInputElement).value)}
        onBlur={save}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            (e.currentTarget as HTMLInputElement).blur();
          }
        }}
      />
    </div>
  );
}

function DaySheet({ date, onClose }: { date: ISODate; onClose: () => void }) {
  const logs = useApp((s) => s.logs);
  const splits = useApp((s) => s.splits);
  const today = useApp((s) => s.today);
  const startedOn = useApp((s) => s.profile?.startedOn ?? s.today);
  const unit = useApp((s) => s.profile?.units ?? "lb");
  const session = sessionOn(date, logs);
  const status = dayStatus(date, today, splits, logs, startedOn);
  const plan = plannedOn(date, splits);
  let body;
  if (session) {
    body = (
      <>
        <p class="eyebrow">{session.title}</p>
        <p class="stats-line num">
          {plural(completedSets(session), "set")} · {formatVolume(volumeKg(session), unit)}
        </p>
        {session.finishLine && <p class="muted">{session.finishLine}</p>}
        <ul class="log-list">
          {session.exercises.map((ex) => {
            const done = ex.sets.filter((s) => s.done);
            return (
              <li key={ex.id} class={`log-row${ex.skipped || done.length === 0 ? " is-skipped" : ""}`}>
                <span class="log-name">{ex.name}</span>
                <span class="log-sets num">{ex.skipped || done.length === 0 ? "skipped" : setsLine(done, unit)}</span>
              </li>
            );
          })}
        </ul>
        {session.bests && session.bests.length > 0 && (
          <div class="pbs">
            <h3 class="section-label">Personal bests</h3>
            <ul>
              {session.bests.map((pb, i) => (
                <li key={i} class="pb">
                  <span class="pb-name">{pb.exercise}</span>
                  <span class="pb-what num">{pbLine(pb, unit)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        <LoggedNote session={session} />
        <Photo session={session} />
      </>
    );
  } else {
    let msg = "";
    if (status === "missed") msg = "No workout logged.";
    else if (status === "rest") msg = "Rest day.";
    else if (status === "planned") msg = plan && plan.kind === "workout" ? `Planned: ${plan.name}.` : "Planned.";
    else if (status === "today") msg = plan && plan.kind === "workout" ? `Today: ${plan.name}. Not logged yet.` : "Rest day.";
    else msg = "Before you started tracking.";
    body = <p class="lead">{msg}</p>;
  }
  return (
    <Sheet title={formatLongDate(date)} onClose={onClose}>
      <div class="stack">{body}</div>
    </Sheet>
  );
}

function ExerciseSheet({ name, onClose }: { name: string; onClose: () => void }) {
  const logs = useApp((s) => s.logs);
  const unit = useApp((s) => s.profile?.units ?? "lb");
  const points = exerciseHistory(name, logs);
  return (
    <Sheet title={name} onClose={onClose}>
      <div class="stack">
        {points.length > 1 ? <LineChart points={points} unit={unit} /> : <p class="muted">One more session and there's a line to show here.</p>}
        <h3 class="section-label">{plural(points.length, "session")}</h3>
        <ul class="log-list">
          {[...points].reverse().map((p) => (
            <li key={p.date} class="log-row">
              <span class="log-name">{shortDate(p.date)}</span>
              <span class="log-sets num">{setsLine(p.sets, unit)}</span>
            </li>
          ))}
        </ul>
      </div>
    </Sheet>
  );
}

// ── Screen ─────────────────────────────────────────────────────────────────

export function CalendarScreen() {
  const today = useApp((s) => s.today);
  const splits = useApp((s) => s.splits);
  const logs = useApp((s) => s.logs);
  const startedOn = useApp((s) => s.profile?.startedOn ?? s.today);
  const [month, setMonth] = useState(monthOf(today));
  const [sheet, setSheet] = useState<{ kind: "day"; date: ISODate } | { kind: "exercise"; name: string } | null>(null);

  useEffect(() => {
    if (!logs[month]) void actions.loadMonth(month);
  }, [month]);

  const days = daysInMonth(month);
  const lead = (weekdayOf(days[0]) + 6) % 7;
  const monthIdx = parseISO(days[0]).getMonth();
  const year = parseISO(days[0]).getFullYear();
  const streakN = streak(today, splits, logs, startedOn);
  const gym = gymDaysInMonth(month, logs);
  const names = loggedExerciseNames(logs);
  const isCurrent = month === monthOf(today);

  return (
    <section class="screen" aria-labelledby="cal-title">
      <header class="screen-head">
        <p class="eyebrow num">{year}</p>
        <div class="head-row">
          <h1 id="cal-title" class="display">
            {MONTH_NAMES[monthIdx]}
          </h1>
          <div class="month-nav">
            <button type="button" class="icon-btn icon-btn--ring" aria-label="Previous month" onClick={() => setMonth(addMonths(month, -1))}>
              <IconLeft />
            </button>
            <button type="button" class="icon-btn icon-btn--ring" aria-label="Next month" onClick={() => setMonth(addMonths(month, 1))}>
              <IconRight />
            </button>
          </div>
        </div>
      </header>

      <dl class="stats stats--2">
        <div class="stat">
          <dt>Streak</dt>
          <dd class="num">{streakN}</dd>
        </div>
        <div class="stat">
          <dt>Gym days {isCurrent ? "this month" : `in ${MONTH_NAMES[monthIdx].slice(0, 3)}`}</dt>
          <dd class="num">{gym}</dd>
        </div>
      </dl>

      <div class="cal" role="group" aria-label={`${MONTH_NAMES[monthIdx]} ${year}`}>
        <div class="cal-head" aria-hidden="true">
          {HEAD.map((h, i) => (
            <span key={i} title={HEAD_FULL[i]}>
              {h}
            </span>
          ))}
        </div>
        <div class="cal-grid">
          {Array.from({ length: lead }, (_, i) => (
            <span key={`pad${i}`} class="cal-pad" />
          ))}
          {days.map((d) => {
            const st = dayStatus(d, today, splits, logs, startedOn);
            const n = parseISO(d).getDate();
            return (
              <button
                key={d}
                type="button"
                class={`cal-day is-${st}${d === today ? " is-today" : ""}`}
                aria-label={`${MONTH_NAMES[monthIdx]} ${n}, ${statusWord(st)}`}
                onClick={() => setSheet({ kind: "day", date: d })}
              >
                <span class="cal-n num">{n}</span>
                <span class="cal-mark" aria-hidden="true" />
              </button>
            );
          })}
        </div>
        <ul class="cal-legend" aria-hidden="true">
          <li>
            <span class="cal-mark is-done" />
            Done
          </li>
          <li>
            <span class="cal-mark is-missed" />
            Missed
          </li>
          <li>
            <span class="cal-mark is-rest" />
            Rest
          </li>
        </ul>
      </div>

      <section class="section" aria-labelledby="ex-h">
        <h2 id="ex-h" class="section-label">
          Exercises
        </h2>
        {names.length === 0 ? (
          <p class="empty">Finish a workout and your exercises show up here, each with its own history.</p>
        ) : (
          <ul class="rule-list">
            {names.map((n) => (
              <li key={n}>
                <button type="button" class="rule-item" onClick={() => setSheet({ kind: "exercise", name: n })}>
                  <span>{n}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {sheet?.kind === "day" && <DaySheet date={sheet.date} onClose={() => setSheet(null)} />}
      {sheet?.kind === "exercise" && <ExerciseSheet name={sheet.name} onClose={() => setSheet(null)} />}
    </section>
  );
}
