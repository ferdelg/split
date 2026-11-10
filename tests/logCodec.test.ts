/** logs/* are packed on disk; unpack(pack(x)) must equal x for everything the app reads. */
import { describe, expect, it } from "vitest";
import { packMonthLog, unpackMonthLog } from "../src/data/logCodec";
import { normalizeMonthLog } from "../src/data/defaults";
import { completeSet, editSet, finalizeSession, sessionFromPlan, skipExercise, swapExercise } from "../src/data/session";
import { buildTemplate } from "../src/data/templates";
import { fromDisplay } from "../src/lib/units";
import type { MonthLog, Session } from "../src/types";

function session(): Session {
  const split = buildTemplate("ppl-5", "lb", 0);
  const at = new Date("2026-11-10T18:00").getTime();
  let s = sessionFromPlan("2026-11-10", split.days[2], { splitId: split.id, weekday: 2 }, at);
  const [a, b, c] = s.exercises;
  s = completeSet(s, a.id, 0, at);
  s = completeSet(s, a.id, 1, at);
  s = editSet(s, a.id, 2, { weightKg: fromDisplay(140, "lb"), reps: 6 }, at);
  s = completeSet(s, b.id, 0, at);
  s = skipExercise(s, c.id, true);
  s = swapExercise(s, b.id, "Chest-supported row", fromDisplay(50, "lb"));
  s = finalizeSession(s, at + 3_000_000);
  return { ...s, note: "Felt strong", thumb: "data:image/jpeg;base64,/9j/AAAA", photoId: "2026-11-10-abc", finishLine: "Good one.", coachAdjusted: true, bests: [{ exercise: a.name, kind: "heaviest", weightKg: fromDisplay(140, "lb"), reps: 6, previous: { weightKg: fromDisplay(135, "lb"), reps: 5 } }] };
}

/** What the app keeps after a round trip: per-set doneAt is dropped, kg to 4 decimals. */
function comparable(s: Session) {
  return {
    ...s,
    exercises: s.exercises.map((e) => ({ ...e, sets: e.sets.map((x) => ({ reps: x.reps, weightKg: x.weightKg == null ? null : Math.round(x.weightKg * 1e4) / 1e4, done: x.done })) })),
    bests: s.bests?.map((b) => ({ ...b, weightKg: b.weightKg == null ? null : Math.round(b.weightKg * 1e4) / 1e4, previous: b.previous && { ...b.previous, weightKg: Math.round(b.previous.weightKg! * 1e4) / 1e4 } })),
  };
}

describe("log codec", () => {
  it("keeps an added exercise without a planExerciseId", () => {
    const s = session();
    const added = { ...s.exercises[0], id: "x_added", source: "added" as const };
    delete (added as { planExerciseId?: string }).planExerciseId;
    const log: MonthLog = { month: "2026-11", days: { [s.date]: { ...s, exercises: [...s.exercises, added] } } };
    const back = normalizeMonthLog(packMonthLog(log), "2026-11").days[s.date].exercises.at(-1)!;
    expect(back.id).toBe("x_added");
    expect(back.planExerciseId).toBeUndefined();
  });

  it("round-trips a finished session", () => {
    const s = session();
    const log: MonthLog = { month: "2026-11", days: { [s.date]: s } };
    const back = normalizeMonthLog(packMonthLog(log), "2026-11");
    expect(back.days[s.date]).toEqual(comparable(s));
  });

  it("is much smaller than plain JSON", () => {
    const s = session();
    const log: MonthLog = { month: "2026-11", days: { [s.date]: s } };
    expect(JSON.stringify(packMonthLog(log)).length).toBeLessThan(JSON.stringify(log).length * 0.6);
  });

  it("run-length encodes identical sets and keeps undone ones", () => {
    const sets = [
      { reps: 5, weightKg: 60, done: true },
      { reps: 5, weightKg: 60, done: true },
      { reps: 5, weightKg: 60, done: true },
      { reps: 5, weightKg: 60, done: false },
    ];
    const s: Session = { id: "s", date: "2026-11-02", title: "T", from: null, exercises: [{ id: "e", name: "Squat", reps: { min: 5 }, sets, source: "plan" }], startedAt: 1 };
    const packed = packMonthLog({ month: "2026-11", days: { "2026-11-02": s } });
    expect(packed.d["2026-11-02"].e[0].s).toEqual([[5, 60, 3], [5, 60, 1, 0]]);
    expect(normalizeMonthLog(packed, "2026-11").days["2026-11-02"].exercises[0].sets).toEqual(sets);
  });

  it("still reads old plain logs", () => {
    const s = session();
    const plain = { month: "2026-11", days: { [s.date]: s } };
    expect(unpackMonthLog(plain)).toBe(plain);
    expect(normalizeMonthLog(plain, "2026-11").days[s.date].title).toBe(s.title);
  });
});
