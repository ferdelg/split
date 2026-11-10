import { describe, expect, it } from "vitest";
import {
  activateSplit,
  activeSplit,
  addExercise,
  copyDay,
  dayFromProposal,
  deleteExercise,
  deleteSplit,
  duplicateExercise,
  duplicateSplit,
  emptyWeek,
  moveExercise,
  renameDay,
  setDayKind,
  updateExercise,
} from "../src/data/split";
import { TEMPLATES, buildTemplate } from "../src/data/templates";
import { toDisplay } from "../src/lib/units";
import type { Split, SplitsDoc, Weekday } from "../src/types";

const T0 = Date.UTC(2026, 10, 1);
const T1 = T0 + 1000;

function ul(): Split {
  return buildTemplate("upper-lower-4", "lb", T0);
}
const ids = (s: Split, wd: Weekday) => s.days[wd].exercises.map((e) => e.id);
const names = (s: Split, wd: Weekday) => s.days[wd].exercises.map((e) => e.name);
function docOf(s: Split): SplitsDoc {
  return { activeId: s.id, splits: [s], history: [{ splitId: s.id, from: "2026-11-01" }] };
}

describe("templates", () => {
  it("onboarding labels", () => {
    expect(TEMPLATES.map((t) => t.name)).toEqual(["3-day full body", "4-day upper/lower", "5-day push/pull/legs", "Start blank"]);
  });

  it("4-day upper/lower: Mon, Tue, Thu, Fri, weights stored in kg", () => {
    const s = ul();
    expect(s.days).toHaveLength(7);
    const work = s.days.map((d, i) => (d.kind === "workout" ? i : -1)).filter((i) => i >= 0);
    expect(work).toEqual([1, 2, 4, 5]);
    for (const d of s.days) if (d.kind === "rest") expect(d.exercises).toEqual([]);
    const loaded = s.days.flatMap((d) => d.exercises).filter((e) => e.weightKg != null);
    expect(loaded.length).toBeGreaterThan(0);
    // lb templates store exact kg of round lb numbers
    for (const e of loaded) {
      const v = toDisplay(e.weightKg!, "lb");
      expect(Math.abs(v / 2.5 - Math.round(v / 2.5)), `${e.name} ${v} lb`).toBeLessThan(1e-6);
    }
    const all = s.days.flatMap((d) => d.exercises.map((e) => e.id));
    expect(new Set(all).size).toBe(all.length);
  });

  it("blank is seven rest days", () => {
    const s = buildTemplate("blank", "kg", T0);
    expect(s.days.every((d) => d.kind === "rest" && d.exercises.length === 0)).toBe(true);
  });
});

describe("pure split editing", () => {
  it("emptyWeek: 7 rest days", () => {
    const w = emptyWeek();
    expect(w).toHaveLength(7);
    expect(w.every((d) => d.kind === "rest" && d.exercises.length === 0)).toBe(true);
  });

  it("renameDay changes one day and updatedAt; the input is not mutated", () => {
    const s = ul();
    const before = structuredClone(s);
    const r = renameDay(s, 1, "Upper A", T1);
    expect(r.days[1].name).toBe("Upper A");
    expect(r.updatedAt).toBe(T1);
    expect(s).toEqual(before);
    expect(r.days[2]).toEqual(s.days[2]);
  });

  it("setDayKind rest empties the exercises; workout can be added back", () => {
    const s = ul();
    const r = setDayKind(s, 1, "rest", T1);
    expect(r.days[1].kind).toBe("rest");
    expect(r.days[1].exercises).toEqual([]);
    const w = setDayKind(r, 3, "workout", T1);
    expect(w.days[3].kind).toBe("workout");
  });

  it("add / update / delete an exercise", () => {
    const s = ul();
    const n = s.days[1].exercises.length;
    const a = addExercise(s, 1, { id: "new1", name: "Face pull", sets: 3, reps: { min: 12, max: 15 }, weightKg: 15 }, T1);
    expect(names(a, 1)).toHaveLength(n + 1);
    expect(names(a, 1)[n]).toBe("Face pull");
    const u = updateExercise(a, 1, "new1", { sets: 4, weightKg: null }, T1);
    expect(u.days[1].exercises[n]).toMatchObject({ id: "new1", name: "Face pull", sets: 4, weightKg: null });
    const d = deleteExercise(u, 1, "new1", T1);
    expect(ids(d, 1)).toEqual(ids(s, 1));
  });

  it("moveExercise reorders; out-of-range moves change nothing", () => {
    const s = ul();
    const [a, b, c] = names(s, 1);
    expect(names(moveExercise(s, 1, 0, 1, T1), 1).slice(0, 3)).toEqual([b, a, c]);
    expect(names(moveExercise(s, 1, 1, 0, T1), 1).slice(0, 3)).toEqual([b, a, c]);
    const last = s.days[1].exercises.length - 1;
    expect(names(moveExercise(s, 1, 0, -1, T1), 1)).toEqual(names(s, 1));
    expect(names(moveExercise(s, 1, last, last + 1, T1), 1)).toEqual(names(s, 1));
  });

  it("duplicateExercise inserts a copy right after, with a new id", () => {
    const s = ul();
    const first = s.days[1].exercises[0];
    const r = duplicateExercise(s, 1, first.id, T1);
    expect(r.days[1].exercises).toHaveLength(s.days[1].exercises.length + 1);
    const copy = r.days[1].exercises[1];
    expect(copy.name).toBe(first.name);
    expect(copy.sets).toBe(first.sets);
    expect(copy.id).not.toBe(first.id);
  });

  it("copyDay copies the plan with new ids", () => {
    const s = ul();
    const r = copyDay(s, 1, 3, T1);
    expect(r.days[3].kind).toBe("workout");
    expect(r.days[3].name).toBe(s.days[1].name);
    expect(names(r, 3)).toEqual(names(s, 1));
    for (const id of ids(r, 3)) expect(ids(s, 1)).not.toContain(id);
    expect(r.days[1]).toEqual(s.days[1]);
  });
});

describe("splits doc", () => {
  it("duplicateSplit deep-copies with new ids and leaves the active one alone", () => {
    const s = ul();
    const doc = docOf(s);
    const before = structuredClone(doc);
    const { doc: d2, newId } = duplicateSplit(doc, s.id, "Copy", T1);
    expect(doc).toEqual(before);
    expect(d2.activeId).toBe(s.id);
    expect(d2.splits).toHaveLength(2);
    const copy = d2.splits.find((x) => x.id === newId)!;
    expect(copy.name).toBe("Copy");
    expect(copy.id).not.toBe(s.id);
    expect(copy.days.map((d) => d.name)).toEqual(s.days.map((d) => d.name));
    const oldIds = s.days.flatMap((d) => d.exercises.map((e) => e.id));
    for (const e of copy.days.flatMap((d) => d.exercises)) expect(oldIds).not.toContain(e.id);
    // a deep copy: editing it doesn't reach the original
    copy.days[1].exercises[0].name = "changed";
    expect(d2.splits.find((x) => x.id === s.id)!.days[1].exercises[0].name).not.toBe("changed");
  });

  it("activateSplit archives the old one and appends to history (same day replaces)", () => {
    const s = ul();
    const { doc, newId } = duplicateSplit(docOf(s), s.id, "B", T1);
    const a = activateSplit(doc, newId, "2026-11-10", T1);
    expect(a.activeId).toBe(newId);
    expect(a.splits.find((x) => x.id === newId)!.archivedAt).toBeUndefined();
    expect(a.splits.find((x) => x.id === s.id)!.archivedAt).toBe(T1);
    expect(a.history).toEqual([
      { splitId: s.id, from: "2026-11-01" },
      { splitId: newId, from: "2026-11-10" },
    ]);
    expect(activeSplit(a)!.id).toBe(newId);
    const back = activateSplit(a, s.id, "2026-11-10", T1 + 1);
    expect(back.history).toEqual([
      { splitId: s.id, from: "2026-11-01" },
      { splitId: s.id, from: "2026-11-10" },
    ]);
    expect(back.splits.find((x) => x.id === s.id)!.archivedAt).toBeUndefined();
  });

  it("deleteSplit removes an archived split, never the active one", () => {
    const s = ul();
    const { doc, newId } = duplicateSplit(docOf(s), s.id, "B", T1);
    expect(deleteSplit(doc, s.id)).toEqual(doc);
    const d = deleteSplit(doc, newId);
    expect(d.splits.map((x) => x.id)).toEqual([s.id]);
  });

  it("activeSplit(null) is null", () => {
    expect(activeSplit(null)).toBeNull();
  });

  it("dayFromProposal builds a workout day with new ids", () => {
    const d = dayFromProposal(
      { title: "Short legs", reason: "r", exercises: [{ name: "Goblet squat", sets: 3, reps: { min: 8, max: 10 }, weightKg: 18 }, { name: "Plank", sets: 2, reps: { min: 30 } }] },
      "Legs",
    );
    expect(d.kind).toBe("workout");
    expect(d.exercises.map((e) => [e.name, e.sets, e.reps])).toEqual([
      ["Goblet squat", 3, { min: 8, max: 10 }],
      ["Plank", 2, { min: 30 }],
    ]);
    expect(d.exercises[0].weightKg).toBe(18);
    expect(new Set(d.exercises.map((e) => e.id)).size).toBe(2);
    expect(dayFromProposal({ reason: "", exercises: [{ name: "X", sets: 1, reps: { min: 5 } }] }, "Legs").name).toBe("Legs");
  });
});
