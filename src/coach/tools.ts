/**
 * The coach's one tool, proposeWorkout, and a forgiving parser for its input.
 * Pure. The proposal is never applied here: the UI shows it as a card.
 */
import type { AIToolDef, ProposedExercise, ProposedWorkout, RepTarget, WeightUnit } from "../types";
import { formatReps, formatWeight, fromDisplay } from "../lib/units";

export const PROPOSE_WORKOUT_TOOL: AIToolDef = {
  name: "proposeWorkout",
  description:
    "Propose an adjusted workout for TODAY ONLY. The app shows it as a preview card with 'Use for today' and 'Keep my plan'. Use it whenever she asks to change, shorten, lengthen or refocus today's workout.",
  input_schema: {
    type: "object",
    properties: {
      title: { type: "string" },
      exercises: {
        type: "array",
        minItems: 1,
        maxItems: 12,
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            sets: { type: "integer", minimum: 1, maximum: 10 },
            reps: { type: "string", description: 'A number like "8" or a range like "8-12"' },
            weight: { type: "number", description: "In her unit (lb or kg). Omit to keep her usual weight." },
          },
          required: ["name", "sets", "reps"],
        },
      },
      reason: { type: "string", description: "One sentence, shown on the card." },
    },
    required: ["exercises", "reason"],
  },
};

export const MAX_EXERCISES = 12;
export const MAX_NAME = 60;
export const MAX_REASON = 200;
const DEFAULT_SETS = 3;

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

function cleanText(v: unknown, max: number): string {
  if (typeof v !== "string") return "";
  const t = v.replace(/\s+/g, " ").trim();
  return t.length > max ? t.slice(0, max).trimEnd() : t;
}

/** A finite number from a number or a numeric-looking string ("4", "4 sets", "135 lb"). */
function toNumber(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string") {
    const m = v.replace(",", ".").match(/-?\d+(?:\.\d+)?/);
    return m ? Number(m[0]) : null;
  }
  return null;
}

/**
 * Reps from 8, "8", "8-12", "8–12", "8—12", "8 to 12", "8-12 reps", "12 each leg".
 * Clamped to 1…100; a max ≤ min is dropped; a reversed range is swapped.
 */
export function parseRepsLoose(v: unknown): RepTarget | null {
  if (typeof v === "number") {
    if (!Number.isFinite(v)) return null;
    return { min: clamp(Math.round(v), 1, 100) };
  }
  if (typeof v !== "string") return null;
  const m = v.match(/(\d+)\s*(?:(?:-|–|—|to)\s*(\d+))?/i);
  if (!m) return null;
  let min = clamp(Number(m[1]), 1, 100);
  let max = m[2] !== undefined ? clamp(Number(m[2]), 1, 100) : undefined;
  if (max !== undefined && max < min) [min, max] = [max, min];
  return max !== undefined && max > min ? { min, max } : { min };
}

function parseExercise(raw: unknown, unit: WeightUnit): ProposedExercise | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const name = cleanText(o.name, MAX_NAME);
  if (!name) return null;
  const reps = parseRepsLoose(o.reps);
  if (!reps) return null;
  const s = toNumber(o.sets);
  const sets = s === null || s < 1 ? DEFAULT_SETS : clamp(Math.round(s), 1, 10);
  const ex: ProposedExercise = { name, sets, reps };
  const w = toNumber(o.weight);
  if (w !== null && w > 0 && w < 2000) ex.weightKg = fromDisplay(w, unit);
  return ex;
}

/**
 * Validate and clamp a proposeWorkout input. Exercises without a name or a
 * readable reps value are dropped (missing/odd sets default to 3). Returns
 * null when no usable exercise remains.
 */
export function parseProposeWorkout(input: unknown, unit: WeightUnit): ProposedWorkout | null {
  if (!input || typeof input !== "object") return null;
  const o = input as Record<string, unknown>;
  let list: unknown = o.exercises;
  if (typeof list === "string") {
    try {
      list = JSON.parse(list);
    } catch {
      return null;
    }
  }
  if (!Array.isArray(list)) return null;
  const exercises: ProposedExercise[] = [];
  for (const raw of list) {
    const ex = parseExercise(raw, unit);
    if (ex) exercises.push(ex);
    if (exercises.length >= MAX_EXERCISES) break;
  }
  if (!exercises.length) return null;
  const p: ProposedWorkout = { exercises, reason: cleanText(o.reason, MAX_REASON) };
  const title = cleanText(o.title, MAX_NAME);
  if (title) p.title = title;
  return p;
}

/** "Short legs: Back squat 3×5 @ 135 lb, Plank 3×30" (for history replay). */
export function describeProposal(p: ProposedWorkout, unit: WeightUnit): string {
  const list = p.exercises
    .map((e) => `${e.name} ${e.sets}×${formatReps(e.reps)}${e.weightKg != null ? ` @ ${formatWeight(e.weightKg, unit)}` : ""}`)
    .join(", ");
  return p.title ? `${p.title}: ${list}` : list;
}
