/**
 * CoachContext → system prompt. Pure and deterministic (the only date is
 * ctx.today), so Me → What the coach sees can show the exact string.
 */
import type { CoachContext, CoachMode, DayPlan, ExerciseLog, Goal, PlannedExercise, Session, SetLog, WeightUnit } from "../types";
import { formatReps, formatWeight } from "../lib/units";
import { WEEK_ORDER, WEEKDAY_NAMES, WEEKDAY_SHORT, weekdayOf } from "../lib/date";
import { MUSCLE_GROUPS, exercisesIn } from "./library";

const GOALS: Record<Goal, string> = {
  muscle: "build muscle",
  fat: "lose fat",
  consistent: "stay consistent",
};

const PERSONA = `You are the coach inside Split, a gym planner and log. You talk to {name} like an encouraging friend who lifts: warm, direct, practical.

Rules:
- Keep replies under 80 words unless she asks for more. Plain sentences or a short list; no headings or tables.
- Be specific: use her exercise names, sets, reps and weights from the notes below. Weights are in {unit}; always answer in {unit}.
- Pain, injury, dizziness or anything medical: tell her to stop and check with a doctor or physio. Nothing more on that topic.
- No extreme dieting: no crash diets, no very-low-calorie targets, no "earning" food.
- Calories: always give a range and call it a "rough estimate".
- To change today's workout (shorter, longer, a different focus, swaps), call the proposeWorkout tool with the whole workout for today, then add one short sentence. The app shows it as a card and she decides; never say you changed her plan or split.
- If equipment is taken, suggest a swap that trains the same muscles with what's likely free (dumbbells, cables, a machine, bodyweight). If it changes today's workout, propose it with proposeWorkout.
- Use common gym exercise names. Keep her weights unless there's a reason; small jumps only (5 lb / 2.5 kg) where she hit every rep last time.`;

const MODE_GUIDANCE: Record<CoachMode, string> = {
  chat: "",
  "plan-today": `Mode: plan today. Call proposeWorkout now with today's workout: her plan, adjusted to what she says (time, energy, equipment) and to her recent sessions. Keep her exercise names unless swapping. Then one or two sentences on what you changed and why.`,
  suggest: `Mode: suggest exercises. Suggest 3–5 exercises for the muscle group she asks about, one line each with sets×reps (and a starting weight in {unit} if her history gives a clue). Prefer names from the library below. Only call proposeWorkout if she asks to put them into today's workout.`,
  calories: `Mode: calories. Estimate the calories her workout today burned (or the one she asks about) as a range, e.g. "about 200–300 kcal (rough estimate)", plus one line on the basis: duration, kind of training, body weight (say what you assumed if it's missing). No diet plan.`,
};

const fmtW = (kg: number | null, unit: WeightUnit) => (kg == null ? "BW" : formatWeight(kg, unit, { unit: false }));

function plannedLine(e: PlannedExercise, unit: WeightUnit): string {
  return `${e.name} ${e.sets}×${formatReps(e.reps)}${e.weightKg != null ? ` @${formatWeight(e.weightKg, unit)}` : ""}`;
}

function dayLine(d: DayPlan | undefined, unit: WeightUnit): string {
  if (!d || d.kind === "rest") return d && d.name && d.name !== "Rest" ? `Rest (${d.name})` : "Rest";
  const ex = d.exercises.map((e) => plannedLine(e, unit)).join("; ");
  return ex ? `${d.name}: ${ex}` : `${d.name}: (no exercises yet)`;
}

/** "135×5,5 140×4" grouping consecutive sets at the same weight. */
function setsText(sets: SetLog[], unit: WeightUnit): string {
  const groups: { w: string; reps: number[] }[] = [];
  for (const s of sets) {
    const w = fmtW(s.weightKg, unit);
    const last = groups[groups.length - 1];
    if (last && last.w === w) last.reps.push(s.reps);
    else groups.push({ w, reps: [s.reps] });
  }
  return groups.map((g) => `${g.w}×${g.reps.join(",")}`).join(" ");
}

function exerciseLogText(e: ExerciseLog, unit: WeightUnit, inProgress: boolean): string {
  const done = e.sets.filter((s) => s.done);
  const swapped = e.swappedFrom ? ` (swapped from ${e.swappedFrom})` : "";
  if (e.skipped) return `${e.name}${swapped} skipped`;
  if (inProgress) {
    const target = `${e.sets.length}×${formatReps(e.reps)}`;
    const w = e.sets.length ? ` @${fmtW(e.sets[0].weightKg, unit)}` : "";
    return done.length
      ? `${e.name}${swapped} ${target}${w}, done ${setsText(done, unit)}`
      : `${e.name}${swapped} ${target}${w}, not started`;
  }
  return done.length ? `${e.name}${swapped} ${setsText(done, unit)}` : `${e.name}${swapped} skipped`;
}

function minutes(s: Session): string {
  if (!s.finishedAt || !s.startedAt || s.finishedAt <= s.startedAt) return "";
  const m = Math.round((s.finishedAt - s.startedAt) / 60000);
  return m > 0 && m < 600 ? ` (${m} min)` : "";
}

function sessionLine(s: Session, unit: WeightUnit): string {
  const wd = WEEKDAY_SHORT[weekdayOf(s.date)] ?? "";
  const ex = s.exercises.map((e) => exerciseLogText(e, unit, false)).join("; ");
  const note = s.note?.trim() ? ` Note: "${s.note.trim()}"` : "";
  const coach = s.coachAdjusted ? " [coach-adjusted]" : "";
  return `- ${s.date} ${wd} ${s.title}${minutes(s)}${coach}: ${ex || "nothing logged"}.${note}`;
}

function profileLine(ctx: CoachContext, unit: WeightUnit): string {
  const p = ctx.profile;
  if (!p) return "Her profile: not set up yet.";
  const bits = [p.name || "Her", `units ${unit}`];
  if (p.heightCm) bits.push(`height ${Math.round(p.heightCm)} cm`);
  if (p.bodyWeightKg) bits.push(`body weight ${formatWeight(p.bodyWeightKg, unit)}`);
  if (p.goal) bits.push(`goal: ${GOALS[p.goal]}`);
  return `Her profile: ${bits.join(", ")}.`;
}

function libraryBlock(): string {
  return (
    "Library (common names by group):\n" +
    MUSCLE_GROUPS.map((g) => `${g}: ${exercisesIn(g).map((e) => e.name).join(", ")}`).join("\n")
  );
}

export function buildSystemPrompt(ctx: CoachContext, mode: CoachMode = "chat"): string {
  const unit: WeightUnit = ctx.profile?.units ?? "kg";
  const name = ctx.profile?.name?.trim() || "her";
  const out: string[] = [PERSONA.replace(/\{name\}/g, name).replace(/\{unit\}/g, unit)];

  const guidance = MODE_GUIDANCE[mode] ?? "";
  if (guidance) out.push(guidance.replace(/\{unit\}/g, unit));

  const notes: string[] = [];
  notes.push(`Today: ${WEEKDAY_NAMES[ctx.weekday]} ${ctx.today}.`);
  notes.push(profileLine(ctx, unit));

  const split = ctx.activeSplit;
  if (split) {
    notes.push(`Her split "${split.name}" (Monday first):`);
    for (const wd of WEEK_ORDER) notes.push(`${WEEKDAY_SHORT[wd]} ${dayLine(split.days[wd], unit)}`);
  } else {
    notes.push("Her split: none yet.");
  }

  const a = ctx.active;
  const fromOther = a?.from && a.from.weekday !== ctx.weekday;
  if (a) {
    const stale = a.date !== ctx.today ? ` (unfinished, from ${a.date})` : "";
    const origin = !a.from ? " (extra workout)" : fromOther ? ` (${WEEKDAY_NAMES[a.from.weekday]}'s workout)` : "";
    const ex = a.exercises.map((e) => exerciseLogText(e, unit, true)).join("; ");
    notes.push(
      `In progress now${stale}: ${a.title}${origin}${a.coachAdjusted ? " [coach-adjusted]" : ""}: ${ex || "no exercises yet"}.`,
    );
    if (a.note?.trim()) notes.push(`Her note today: "${a.note.trim()}"`);
  } else if (ctx.todayPlan) {
    const own = split?.days[ctx.weekday];
    const same = !!own && JSON.stringify(own) === JSON.stringify(ctx.todayPlan);
    const planned = same
      ? `${WEEKDAY_SHORT[ctx.weekday]} ${ctx.todayPlan.kind === "rest" ? "Rest" : ctx.todayPlan.name} (as in the split)`
      : dayLine(ctx.todayPlan, unit);
    notes.push(`Today's plan: ${planned}. ${ctx.todayPlan.kind === "rest" ? "Rest day." : "Not started yet."}`);
  } else {
    notes.push("Today's plan: nothing planned.");
  }

  if (ctx.recent.length) {
    notes.push("Last 14 days (newest first; sets as weight×reps, BW = bodyweight):");
    for (const s of ctx.recent) notes.push(sessionLine(s, unit));
  } else {
    notes.push("Last 14 days: no finished workouts logged.");
  }

  out.push(`What you know (weights in ${unit}):\n${notes.join("\n")}`);
  if (mode === "suggest") out.push(libraryBlock());
  return out.join("\n\n");
}

export const QUICK_PROMPTS: { mode: CoachMode; label: string; text: string }[] = [
  { mode: "plan-today", label: "Plan today", text: "Can you plan today's workout for me? Tweak it based on how my last sessions went." },
  { mode: "suggest", label: "Suggest exercises", text: "Can you suggest a few exercises for my shoulders?" },
  { mode: "chat", label: "Swap: equipment taken", text: "The equipment for my next exercise is taken. What can I do instead?" },
  { mode: "calories", label: "Calories for today", text: "Roughly how many calories did I burn in today's workout?" },
];
