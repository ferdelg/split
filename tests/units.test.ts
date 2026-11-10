import { describe, expect, it } from "vitest";
import {
  KG_PER_LB,
  defaultStep,
  formatReps,
  formatVolume,
  formatWeight,
  fromDisplay,
  parseReps,
  roundDisplay,
  stepWeight,
  toDisplay,
} from "../src/lib/units";
import { volumeKg } from "../src/data/history";
import type { Session, WeightUnit } from "../src/types";

const lb = (n: number) => fromDisplay(n, "lb");
const shown = (kg: number | null, unit: WeightUnit) => (kg == null ? null : roundDisplay(toDisplay(kg, unit)));

describe("conversions", () => {
  it("uses the exact pound", () => {
    expect(KG_PER_LB).toBe(0.45359237);
    expect(fromDisplay(1, "lb")).toBe(0.45359237);
    expect(fromDisplay(60, "kg")).toBe(60);
    expect(toDisplay(60, "kg")).toBe(60);
  });

  it("round-trips lb ↔ kg without drift (stored kg is never rounded)", () => {
    for (const v of [2.5, 5, 45, 95, 132.5, 135, 225, 315, 405]) {
      const kg = fromDisplay(v, "lb");
      expect(kg).not.toBe(Math.round(kg * 100) / 100); // full precision stored
      expect(toDisplay(kg, "lb")).toBeCloseTo(v, 10);
      expect(roundDisplay(toDisplay(kg, "lb"))).toBe(v);
    }
  });

  it("roundDisplay rounds to 0.1 and never returns -0", () => {
    expect(roundDisplay(132.54)).toBe(132.5);
    expect(roundDisplay(135.04)).toBe(135);
    expect(roundDisplay(61.2349)).toBe(61.2);
    expect(Object.is(roundDisplay(-0.01), -0)).toBe(false);
  });
});

describe("formatWeight", () => {
  it("drops trailing zeros and adds the unit", () => {
    expect(formatWeight(lb(135), "lb")).toBe("135 lb");
    expect(formatWeight(lb(132.5), "lb")).toBe("132.5 lb");
    expect(formatWeight(60, "kg")).toBe("60 kg");
    expect(formatWeight(62.5, "kg")).toBe("62.5 kg");
    expect(formatWeight(lb(135), "lb", { unit: false })).toBe("135");
  });

  it("null is bodyweight", () => {
    expect(formatWeight(null, "lb")).toBe("bodyweight");
    expect(formatWeight(null, "kg")).toBe("bodyweight");
  });
});

describe("stepWeight (display grid)", () => {
  it("135 lb + 5 shows exactly 140 lb; − 5 shows 130 lb", () => {
    const up = stepWeight(lb(135), "lb", 5, 1);
    expect(shown(up, "lb")).toBe(140);
    expect(formatWeight(up, "lb")).toBe("140 lb");
    expect(toDisplay(up!, "lb")).toBeCloseTo(140, 9);
    expect(formatWeight(stepWeight(lb(135), "lb", 5, -1), "lb")).toBe("130 lb");
  });

  it("20 taps from 135 lb land on 235 lb exactly (no drift)", () => {
    let w: number | null = lb(135);
    for (let i = 0; i < 20; i++) w = stepWeight(w, "lb", 5, 1);
    expect(formatWeight(w, "lb")).toBe("235 lb");
    for (let i = 0; i < 20; i++) w = stepWeight(w, "lb", 5, -1);
    expect(formatWeight(w, "lb")).toBe("135 lb");
  });

  it("snaps an off-grid weight to the next grid point in the tap direction", () => {
    expect(formatWeight(stepWeight(lb(137), "lb", 5, 1), "lb")).toBe("140 lb");
    expect(formatWeight(stepWeight(lb(137), "lb", 5, -1), "lb")).toBe("135 lb");
    // a kg-template weight shown in lb (60 kg = 132.3 lb)
    expect(formatWeight(stepWeight(60, "lb", 5, 1), "lb")).toBe("135 lb");
    expect(formatWeight(stepWeight(60, "lb", 5, -1), "lb")).toBe("130 lb");
    expect(formatWeight(stepWeight(lb(132.5), "lb", 2.5, 1), "lb")).toBe("135 lb");
  });

  it("kg moves in 2.5 steps", () => {
    expect(stepWeight(60, "kg", 2.5, 1)).toBe(62.5);
    expect(stepWeight(60, "kg", 2.5, -1)).toBe(57.5);
    expect(stepWeight(61, "kg", 2.5, 1)).toBe(62.5);
    expect(stepWeight(61, "kg", 2.5, -1)).toBe(60);
    let w: number | null = 20;
    for (let i = 0; i < 8; i++) w = stepWeight(w, "kg", 2.5, 1);
    expect(w).toBe(40);
  });

  it("null (bodyweight) + 1 is one step; at the bottom it becomes bodyweight", () => {
    expect(formatWeight(stepWeight(null, "lb", 5, 1), "lb")).toBe("5 lb");
    expect(stepWeight(null, "kg", 2.5, 1)).toBe(2.5);
    expect(stepWeight(null, "lb", 5, -1)).toBeNull();
    expect(stepWeight(lb(5), "lb", 5, -1)).toBeNull();
    expect(stepWeight(2.5, "kg", 2.5, -1)).toBeNull();
  });

  it("defaultStep: lb 5, kg 2.5", () => {
    expect(defaultStep("lb")).toBe(5);
    expect(defaultStep("kg")).toBe(2.5);
  });
});

describe("reps", () => {
  it("formatReps uses an en dash for ranges", () => {
    expect(formatReps({ min: 8 })).toBe("8");
    expect(formatReps({ min: 8, max: 12 })).toBe("8–12");
  });

  it("parseReps accepts a number or a range in several spellings", () => {
    expect(parseReps("8")).toEqual({ min: 8 });
    expect(parseReps(" 10 ")).toEqual({ min: 10 });
    for (const s of ["8-12", "8–12", "8 - 12", "8 to 12"]) expect(parseReps(s), s).toEqual({ min: 8, max: 12 });
  });

  it("parseReps rejects junk", () => {
    for (const s of ["", "abc", "0", "-3", "8-", "x-12", "8.5"]) expect(parseReps(s), JSON.stringify(s)).toBeNull();
  });

  it("formatReps(parseReps(x)) round-trips", () => {
    for (const s of ["5", "8–12", "12–15"]) expect(formatReps(parseReps(s)!)).toBe(s);
  });
});

describe("volume", () => {
  const session = (sets: [number, number | null, boolean][]): Session => ({
    id: "s",
    date: "2026-11-10",
    title: "Legs",
    from: null,
    startedAt: 0,
    exercises: [
      { id: "e1", name: "Squat", reps: { min: 5 }, source: "plan", sets: sets.map(([reps, weightKg, done]) => ({ reps, weightKg, done })) },
    ],
  });

  it("is Σ reps × kg over completed loaded sets", () => {
    const s = session([
      [5, 100, true],
      [5, 100, true],
      [5, 100, false], // not done
      [10, null, true], // bodyweight
    ]);
    expect(volumeKg(s)).toBeCloseTo(1000, 9);
  });

  it("formatVolume converts, rounds and groups thousands", () => {
    expect(formatVolume(lb(12340), "lb")).toBe("12,340 lb");
    expect(formatVolume(1234.4, "kg")).toBe("1,234 kg");
    expect(formatVolume(0, "kg")).toBe("0 kg");
    expect(formatVolume(1000, "lb")).toBe("2,205 lb");
  });
});
