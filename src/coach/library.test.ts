import { describe, expect, it } from "vitest";
import { EXERCISES, MUSCLE_GROUPS, groupOf, normalizeQuery, searchExercises } from "./library";
import { FINISH_LINES, pickFinishLine } from "../lib/finishLines";

describe("exercise library", () => {
  it("has ≥ 140 exercises with unique names and valid groups", () => {
    expect(EXERCISES.length).toBeGreaterThanOrEqual(140);
    const names = EXERCISES.map((e) => normalizeQuery(e.name));
    expect(new Set(names).size).toBe(names.length);
    for (const e of EXERCISES) {
      expect(MUSCLE_GROUPS).toContain(e.group);
      expect(e.equipment).toBeTruthy();
      expect(e.name.length).toBeLessThanOrEqual(60);
    }
    for (const g of MUSCLE_GROUPS) expect(EXERCISES.some((e) => e.group === g)).toBe(true);
  });

  it("includes the conventional names", () => {
    for (const n of ["Back squat", "Romanian deadlift", "Bench press", "Incline dumbbell press", "Lat pulldown", "Seated cable row", "Overhead press", "Hip thrust", "Bulgarian split squat", "Leg press", "Dumbbell curl", "Triceps pushdown", "Lateral raise", "Plank", "Cable kickback", "Face pull"]) {
      expect(EXERCISES.find((e) => e.name === n), n).toBeTruthy();
    }
  });

  it("empty query → []", () => {
    expect(searchExercises("")).toEqual([]);
    expect(searchExercises("   ")).toEqual([]);
  });

  it("ranks prefix > word prefix > substring", () => {
    const names = searchExercises("press", 50).map((e) => e.name);
    // No name starts with "press"; word-prefix hits come before pure substrings.
    expect(names[0]).toBe("Leg press");
    const curl = searchExercises("curl", 50).map((e) => e.name);
    expect(curl.indexOf("Dumbbell curl")).toBeGreaterThanOrEqual(0);
    const row = searchExercises("row", 50).map((e) => e.name);
    expect(row[0]).toBe("Rowing machine"); // prefix
    expect(row.indexOf("Barbell row")).toBeGreaterThan(0);
    const lat = searchExercises("lat", 10).map((e) => e.name);
    expect(lat[0]).toBe("Lat pulldown");
    expect(lat).toContain("Lateral raise");
    expect(lat.indexOf("Lateral raise")).toBeLessThan(lat.indexOf("Cable lateral raise"));
  });

  it("is case and diacritic insensitive and respects limit", () => {
    expect(searchExercises("BÉNCH")[0].name).toBe("Bench press");
    expect(searchExercises("hip", 3)).toHaveLength(3);
    expect(searchExercises("pullup")[0].name).toBe("Pull-up");
    expect(searchExercises("pull up")[0].name).toBe("Pull-up");
  });

  it("matches aliases and shorthands", () => {
    expect(searchExercises("rdl")[0].name).toBe("Romanian deadlift");
    expect(searchExercises("OHP")[0].name).toBe("Overhead press");
    expect(searchExercises("db row")[0].name).toBe("Dumbbell row");
    expect(searchExercises("zzzz")).toEqual([]);
  });

  it("groupOf by normalized name", () => {
    expect(groupOf("  hip   THRUST ")).toBe("Glutes");
    expect(groupOf("Romanian deadlift")).toBe("Hamstrings");
    expect(groupOf("rdl")).toBe("Hamstrings");
    expect(groupOf("My weird thing")).toBeNull();
    expect(groupOf("")).toBeNull();
  });
});

describe("finish lines", () => {
  it("≥ 40 unique, short, no emoji, ≤ 1 exclamation", () => {
    expect(FINISH_LINES.length).toBeGreaterThanOrEqual(40);
    expect(new Set(FINISH_LINES).size).toBe(FINISH_LINES.length);
    for (const l of FINISH_LINES) {
      expect(l.length).toBeLessThanOrEqual(60);
      expect((l.match(/!/g) ?? []).length).toBeLessThanOrEqual(1);
      expect(/\p{Extended_Pictographic}/u.test(l)).toBe(false);
      expect(l[0]).toBe(l[0].toUpperCase());
    }
  });

  it("never returns a recent line", () => {
    const recent = FINISH_LINES.slice(0, 7);
    for (let i = 0; i < 200; i++) {
      expect(recent).not.toContain(pickFinishLine(recent, () => i / 200));
    }
    // Only one left
    const one = FINISH_LINES.slice(1);
    expect(pickFinishLine(one, () => 0.99)).toBe(FINISH_LINES[0]);
  });

  it("falls back gracefully when all were used, and tolerates odd rand", () => {
    const all = [...FINISH_LINES];
    const pick = pickFinishLine(all, () => 0.5);
    expect(FINISH_LINES).toContain(pick);
    expect(all.slice(-10)).not.toContain(pick);
    expect(FINISH_LINES).toContain(pickFinishLine([], () => 1));
    expect(FINISH_LINES).toContain(pickFinishLine([], () => NaN));
  });
});
