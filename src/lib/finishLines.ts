/**
 * Lines shown on the workout summary. Short, sentence case, no emoji, at most
 * one "!" each. Calm notebook meets a friend who lifts. The data layer passes
 * the lines used in the last 7 days so none repeats within a week.
 */

export const FINISH_LINES: string[] = [
  "That's one more in the book.",
  "Done and logged. Nice work.",
  "Showed up, did the work. That's the whole trick.",
  "Another brick in the wall you're building.",
  "Good session. Go eat something good.",
  "Logged. Future you says thanks.",
  "That counts. Every set of it.",
  "Strong work today.",
  "You did the thing you said you'd do.",
  "Consistency looks a lot like today.",
  "Workout done. The rest of the day is yours.",
  "Quiet progress is still progress.",
  "Today's reps are in the bank.",
  "That's how it adds up.",
  "Solid. Hydrate and stretch a little.",
  "You came, you lifted, you wrote it down.",
  "One more page in the notebook.",
  "Proud of that one.",
  "Nice. Recovery starts now.",
  "The plan worked because you did.",
  "Another day you kept the promise.",
  "Every session makes the next one easier.",
  "Good lifting. See you next time.",
  "Some days are big, some are steady. This one counts.",
  "Look at you, showing up again.",
  "That's a wrap on today.",
  "Stronger than last month, and it shows.",
  "Done. Take the win.",
  "Small steps, heavy plates.",
  "You earned a good night's sleep.",
  "The hard part was starting. You did more than that.",
  "Checked off. Well done.",
  "Steady effort, real results.",
  "That's the kind of day that builds a habit.",
  "Training logged. Feet up later.",
  "Your split, your pace, your progress.",
  "That one goes in the good pile!",
  "Every set you logged is proof.",
  "Good work. Water, food, rest.",
  "Another one for the calendar.",
  "Ticked off with style.",
  "That was time well spent.",
  "Muscles worked, notebook updated.",
  "Way to keep the streak honest.",
  "Not every day is a record. Every day counts.",
];

/**
 * A random line not in `recent`. If every line has been used (only possible
 * with a long `recent`), pick from those not among the newest half of
 * `recent` (assumed oldest first), so the last few days still don't repeat.
 */
export function pickFinishLine(recent: string[], rand: () => number = Math.random): string {
  const list = Array.isArray(recent) ? recent : [];
  const used = new Set(list);
  let pool = FINISH_LINES.filter((l) => !used.has(l));
  if (!pool.length) {
    const newest = new Set(list.slice(-Math.floor(FINISH_LINES.length / 2)));
    pool = FINISH_LINES.filter((l) => !newest.has(l));
  }
  if (!pool.length) pool = FINISH_LINES;
  const r = rand();
  const i = Math.floor((Number.isFinite(r) ? Math.min(Math.max(r, 0), 0.999999) : 0) * pool.length);
  return pool[i];
}
