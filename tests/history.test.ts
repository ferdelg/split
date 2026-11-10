import { describe, expect, it } from "vitest";
import {
  allSessions,
  compactOldThumbs,
  dayStatus,
  detectBests,
  emptyBests,
  exerciseHistory,
  foldSession,
  gymDaysInMonth,
  lastFor,
  loggedExerciseNames,
  normalizeName,
  plannedOn,
  rebuildBests,
  recentFinishLines,
  sessionOn,
  streak,
  summarize,
} from "../src/data/history";
import type { BestsDoc, DayPlan, ISODate, MonthLog, Session, Split, SplitsDoc } from "../src/types";

type SetSpec = [reps: number, kg: number | null, done?: boolean];
let seq = 0;
function sess(date: ISODate, exs: Record<string, SetSpec[]>, extra: Partial<Session> = {}): Session {
  return {
    id: `s${++seq}`,
    date,
    title: "Workout",
    from: { splitId: "A", weekday: new Date(date + "T12:00").getDay() as 0 },
    startedAt: 0,
    finishedAt: 1,
    exercises: Object.entries(exs).map(([name, sets], i) => ({
      id: `e${seq}-${i}`,
      name,
      reps: { min: 5 },
      source: "plan" as const,
      sets: sets.map(([reps, weightKg, done = true]) => ({ reps, weightKg, done })),
    })),
    ...extra,
  };
}
function logsOf(...ss: Session[]): Record<string, MonthLog> {
  const out: Record<string, MonthLog> = {};
  for (const s of ss) {
    const m = s.date.slice(0, 7);
    (out[m] ??= { month: m, days: {} }).days[s.date] = s;
  }
  return out;
}
const fold = (...ss: Session[]): BestsDoc => ss.reduce((b, s) => foldSession(b, s), emptyBests());

describe("normalizeName", () => {
  it("lowercases, trims, collapses whitespace; keeps a trailing s", () => {
    expect(normalizeName("  Bench   Press ")).toBe("bench press");
    expect(normalizeName("Squats")).toBe("squats");
    expect(normalizeName("Squats")).not.toBe(normalizeName("Squat"));
  });
});

describe("personal bests", () => {
  it("first session of an exercise: no PBs", () => {
    expect(detectBests(sess("2026-11-02", { Squat: [[5, 100]] }), emptyBests())).toEqual([]);
    const b = fold(sess("2026-11-02", { Squat: [[5, 100]] }));
    expect(detectBests(sess("2026-11-03", { Squat: [[5, 105]], Deadlift: [[5, 140]] }), b).map((p) => p.exercise)).toEqual(["Squat"]);
  });

  it("heaviest: weight above the record (0.01 tolerance), with previous", () => {
    const b = fold(sess("2026-11-02", { Squat: [[5, 100], [5, 100]] }));
    const pbs = detectBests(sess("2026-11-05", { Squat: [[5, 100], [3, 105], [2, 102.5]] }), b);
    expect(pbs).toEqual([expect.objectContaining({ exercise: "Squat", kind: "heaviest", weightKg: 105, reps: 3, previous: { weightKg: 100, reps: 5 } })]);
    expect(detectBests(sess("2026-11-05", { Squat: [[5, 100.005]] }), b)).toEqual([]);
  });

  it("reps at the same weight", () => {
    const b = fold(sess("2026-11-02", { Squat: [[5, 100]] }));
    const pbs = detectBests(sess("2026-11-05", { Squat: [[6, 100], [7, 100], [4, 90]] }), b);
    expect(pbs).toEqual([expect.objectContaining({ kind: "reps", weightKg: 100, reps: 7, previous: { weightKg: 100, reps: 5 } })]);
  });

  it("one PB per kind per exercise: heaviest and reps from different sets", () => {
    const b = fold(sess("2026-11-02", { Squat: [[5, 100]] }));
    const pbs = detectBests(sess("2026-11-05", { Squat: [[3, 110], [8, 100], [2, 107.5]] }), b);
    expect(pbs.map((p) => [p.kind, p.weightKg, p.reps]).sort()).toEqual([
      ["heaviest", 110, 3],
      ["reps", 100, 8],
    ]);
  });

  it("names match by normalizeName", () => {
    const b = fold(sess("2026-11-02", { "Bench Press": [[5, 60]] }));
    expect(detectBests(sess("2026-11-05", { " bench  press": [[5, 62.5]] }), b)).toHaveLength(1);
  });

  it("bodyweight sets compare reps only", () => {
    const b = fold(sess("2026-11-02", { "Pull-up": [[8, null]] }));
    const pbs = detectBests(sess("2026-11-05", { "Pull-up": [[10, null], [6, null]] }), b);
    expect(pbs).toEqual([expect.objectContaining({ kind: "reps", weightKg: null, reps: 10 })]);
    expect(pbs.some((p) => p.kind === "heaviest")).toBe(false);
    expect(detectBests(sess("2026-11-06", { "Pull-up": [[8, null]] }), b)).toEqual([]);
  });

  it("undone and skipped sets don't count", () => {
    const b = fold(sess("2026-11-02", { Squat: [[5, 100]] }));
    expect(detectBests(sess("2026-11-05", { Squat: [[5, 120, false]] }), b)).toEqual([]);
  });

  it("foldSession tracks last, sessions and through; rebuildBests matches folding", () => {
    const s1 = sess("2026-11-02", { Squat: [[5, 100], [5, 100, false]] });
    const s2 = sess("2026-11-05", { Squat: [[5, 102.5], [4, 102.5]] });
    const b = fold(s1, s2);
    const rec = b.records[normalizeName("Squat")];
    expect(rec.sessions).toBe(2);
    expect(rec.heaviest).toMatchObject({ weightKg: 102.5, reps: 5, date: "2026-11-05" });
    expect(rec.last).toEqual({ date: "2026-11-05", sets: [{ reps: 5, weightKg: 102.5 }, { reps: 4, weightKg: 102.5 }] });
    expect(lastFor("squat", b)).toEqual(rec.last);
    expect(lastFor("nothing", b)).toBeNull();
    expect(b.through).toBe("2026-11-05");
    expect(rebuildBests([s2, s1])).toEqual(b);
  });
});

// Split A: workouts Mon, Tue, Thu, Fri. Split B (from Nov 16): workouts Wed only.
const W = (name: string): DayPlan => ({ kind: "workout", name, exercises: [] });
const R = (): DayPlan => ({ kind: "rest", name: "Rest", exercises: [] });
const A: Split = { id: "A", name: "A", days: [R(), W("Upper"), W("Lower"), R(), W("Upper"), W("Lower"), R()], createdAt: 0, updatedAt: 0 };
const B: Split = { id: "B", name: "B", days: [R(), R(), R(), W("Full"), R(), R(), R()], createdAt: 0, updatedAt: 0 };
const docA: SplitsDoc = { activeId: "A", splits: [A], history: [{ splitId: "A", from: "2026-11-02" }] };
const START = "2026-11-02"; // Monday
const done = (d: ISODate, extra: Partial<Session> = {}) => sess(d, { Squat: [[5, 100]] }, extra);
// Nov 2026: 2 Mon, 3 Tue, 4 Wed, 5 Thu, 6 Fri, 7 Sat, 8 Sun, 9 Mon, 10 Tue, 11 Wed, 12 Thu
const WEEK = ["2026-11-02", "2026-11-03", "2026-11-05", "2026-11-06", "2026-11-09"].map((d) => done(d));

describe("calendar status", () => {
  it("plannedOn uses the split active on that date; null before tracking", () => {
    const doc: SplitsDoc = { activeId: "B", splits: [{ ...A, archivedAt: 5 }, B], history: [{ splitId: "A", from: START }, { splitId: "B", from: "2026-11-16" }] };
    expect(plannedOn("2026-11-04", doc)?.kind).toBe("rest");
    expect(plannedOn("2026-11-18", doc)?.name).toBe("Full");
    expect(plannedOn("2026-11-17", doc)?.kind).toBe("rest");
    expect(plannedOn("2026-10-20", doc)).toBeNull();
    // a past Wednesday under A stays "rest" after switching to B
    expect(dayStatus("2026-11-04", "2026-11-20", doc, logsOf(...WEEK), START)).toBe("rest");
  });

  it("dayStatus", () => {
    const logs = logsOf(...WEEK);
    const T = "2026-11-10";
    expect(dayStatus("2026-11-01", T, docA, logs, START)).toBe("before-start");
    expect(dayStatus("2026-11-02", T, docA, logs, START)).toBe("done");
    expect(dayStatus("2026-11-04", T, docA, logs, START)).toBe("rest");
    expect(dayStatus(T, T, docA, logs, START)).toBe("today");
    expect(dayStatus(T, T, docA, logsOf(...WEEK, done(T)), START)).toBe("done");
    expect(dayStatus("2026-11-12", T, docA, logs, START)).toBe("planned");
    expect(dayStatus("2026-11-11", T, docA, logs, START)).toBe("rest");
    expect(dayStatus("2026-11-05", T, docA, logsOf(...WEEK.filter((s) => s.date !== "2026-11-05")), START)).toBe("missed");
  });

  it("a session with zero completed sets isn't done", () => {
    const empty = sess("2026-11-05", { Squat: [[5, 100, false]] });
    const logs = logsOf(...WEEK.filter((s) => s.date !== "2026-11-05"), empty);
    expect(dayStatus("2026-11-05", "2026-11-10", docA, logs, START)).toBe("missed");
  });
});

describe("streak", () => {
  const T = "2026-11-10"; // Tuesday, a workout day

  it("rest days neither add nor break; today not done doesn't break", () => {
    expect(streak(T, docA, logsOf(...WEEK), START)).toBe(5);
  });

  it("today counts once done", () => {
    expect(streak(T, docA, logsOf(...WEEK, done(T)), START)).toBe(6);
  });

  it("a missed workout day ends it", () => {
    const logs = logsOf(...WEEK.filter((s) => s.date !== "2026-11-05"));
    expect(streak(T, docA, logs, START)).toBe(2); // Fri 6 + Mon 9
  });

  it("an extra workout on a rest day doesn't add", () => {
    expect(streak(T, docA, logsOf(...WEEK, done("2026-11-07", { from: null, title: "Extra workout" })), START)).toBe(5);
  });

  it("stops at startedOn", () => {
    expect(streak(T, docA, logsOf(...WEEK), "2026-11-05")).toBe(3);
    expect(streak("2026-11-02", docA, logsOf(), START)).toBe(0);
  });

  it("Tuesday's workout done on Wednesday: Tuesday missed, Wednesday done", () => {
    const wed = "2026-11-11";
    const logs = logsOf(...WEEK, done(wed, { from: { splitId: "A", weekday: 2 }, title: "Lower" }));
    expect(dayStatus("2026-11-10", wed, docA, logs, START)).toBe("missed");
    expect(dayStatus(wed, wed, docA, logs, START)).toBe("done");
    expect(streak(wed, docA, logs, START)).toBeLessThanOrEqual(1);
  });
});

describe("history lists", () => {
  const logs = logsOf(
    sess("2026-10-28", { Squat: [[5, 95], [5, 100]], "Pull-up": [[8, null]] }, { finishLine: "old" }),
    sess("2026-11-05", { squat: [[5, 102.5], [3, 105, false]] }, { finishLine: "a" }),
    sess("2026-11-09", { "Bench press": [[8, 60]] }, { finishLine: "b" }),
  );

  it("allSessions ascending; sessionOn", () => {
    expect(allSessions(logs).map((s) => s.date)).toEqual(["2026-10-28", "2026-11-05", "2026-11-09"]);
    expect(sessionOn("2026-11-05", logs)?.date).toBe("2026-11-05");
    expect(sessionOn("2026-11-06", logs)).toBeNull();
  });

  it("gymDaysInMonth counts dates with a finished session", () => {
    expect(gymDaysInMonth("2026-11", logs)).toBe(2);
    expect(gymDaysInMonth("2026-10", logs)).toBe(1);
    expect(gymDaysInMonth("2026-09", logs)).toBe(0);
  });

  it("exerciseHistory: ascending, top completed set, matched by normalized name", () => {
    const h = exerciseHistory("Squat", logs);
    expect(h.map((p) => [p.date, p.topKg, p.reps])).toEqual([
      ["2026-10-28", 100, 5],
      ["2026-11-05", 102.5, 5],
    ]);
    expect(exerciseHistory("pull-up", logs)).toEqual([expect.objectContaining({ topKg: null, reps: 8 })]);
    expect(exerciseHistory("Deadlift", logs)).toEqual([]);
  });

  it("loggedExerciseNames: most recent first, unique", () => {
    const n = loggedExerciseNames(logs);
    expect(n[0]).toBe("Bench press");
    expect(n.map(normalizeName)).toEqual(["bench press", "squat", "pull-up"]);
  });

  it("recentFinishLines: the last 7 days", () => {
    expect(recentFinishLines("2026-11-10", logs).sort()).toEqual(["a", "b"]);
  });

  it("compactOldThumbs drops thumbs and keeps everything else", () => {
    const m: MonthLog = logsOf(sess("2025-01-06", { Squat: [[5, 100]] }, { thumb: "data:image/jpeg;base64,AAAA", photoId: "p1", note: "n" }))["2025-01"];
    const c = compactOldThumbs(m);
    expect(c.days["2025-01-06"].thumb).toBeUndefined();
    expect(c.days["2025-01-06"]).toMatchObject({ photoId: "p1", note: "n" });
    expect(m.days["2025-01-06"].thumb).toBeDefined(); // pure
  });

  it("summarize", () => {
    const s = sess("2026-11-10", { Squat: [[5, 100], [5, 100]], Row: [[5, 50, false]] });
    const sum = summarize(s, [], "Nice.", true);
    expect(sum).toMatchObject({ date: "2026-11-10", exercisesDone: 1, totalSets: 2, finishLine: "Nice.", weightsChanged: true });
    expect(sum.volumeKg).toBeCloseTo(1000, 9);
  });
});
