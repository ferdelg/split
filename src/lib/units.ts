/**
 * Weight units and rep targets. Pure.
 *
 * Weights are STORED in kg at full precision and converted for display only.
 * Steppers move on the display grid (multiples of the step in her unit), so
 * 135 lb + 5 shows exactly 140 lb even though the stored kg is irrational.
 */
import type { RepTarget, WeightUnit } from "../types";

export const KG_PER_LB = 0.45359237;

export function toDisplay(kg: number, unit: WeightUnit): number {
  return unit === "lb" ? kg / KG_PER_LB : kg;
}

export function fromDisplay(value: number, unit: WeightUnit): number {
  return unit === "lb" ? value * KG_PER_LB : value;
}

/** To 0.1, without "-0". */
export function roundDisplay(value: number): number {
  const r = Math.round(value * 10) / 10;
  return r === 0 ? 0 : r;
}

/** "135 lb", "132.5 lb", "60 kg"; null → "bodyweight". `opts.unit: false` drops the unit. */
export function formatWeight(kg: number | null, unit: WeightUnit, opts: { unit?: boolean } = {}): string {
  if (kg == null || !Number.isFinite(kg)) return "bodyweight";
  const n = String(roundDisplay(toDisplay(kg, unit)));
  return opts.unit === false ? n : `${n} ${unit}`;
}

/**
 * One stepper tap. Snaps to the grid of `step` in display units:
 * on the grid it moves one step; off the grid it moves to the next grid
 * point in that direction. null + 1 → one step; reaching ≤ 0 → null (bodyweight).
 */
export function stepWeight(kg: number | null, unit: WeightUnit, step: number, dir: 1 | -1): number | null {
  const s = step > 0 ? step : defaultStep(unit);
  if (kg == null || !Number.isFinite(kg) || kg <= 0) return dir > 0 ? fromDisplay(s, unit) : null;
  const g = toDisplay(kg, unit) / s;
  const nearest = Math.round(g);
  const onGrid = Math.abs(g - nearest) < 1e-6;
  const next = dir > 0 ? (onGrid ? nearest + 1 : Math.ceil(g)) : onGrid ? nearest - 1 : Math.floor(g);
  const display = next * s;
  return display <= 0 ? null : fromDisplay(display, unit);
}

export function defaultStep(unit: WeightUnit): number {
  return unit === "lb" ? 5 : 2.5;
}

/** "8" or "8–12" (en dash). */
export function formatReps(r: RepTarget): string {
  return r.max != null && r.max > r.min ? `${r.min}–${r.max}` : `${r.min}`;
}

/** Accepts "8", "8-12", "8–12", "8—12", "8 to 12". Returns null for anything else or 0. */
export function parseReps(s: string): RepTarget | null {
  const t = String(s ?? "").trim().toLowerCase();
  const range = /^(\d{1,3})\s*(?:-|–|—|to)\s*(\d{1,3})$/.exec(t);
  if (range) {
    let a = Number(range[1]);
    let b = Number(range[2]);
    if (b < a) [a, b] = [b, a];
    if (a < 1 || b > 100) return null;
    return b > a ? { min: a, max: b } : { min: a };
  }
  const one = /^(\d{1,3})$/.exec(t);
  if (one) {
    const n = Number(one[1]);
    return n >= 1 && n <= 100 ? { min: n } : null;
  }
  return null;
}

/** "12,340 lb": rounded to an integer with thousands separators. */
export function formatVolume(kg: number, unit: WeightUnit): string {
  const n = Math.round(toDisplay(kg, unit));
  return `${n.toLocaleString("en-US")} ${unit}`;
}
