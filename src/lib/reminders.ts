/** Workout reminders: the native schedule and in-app due banners. Pure. */
import type { DueBanner, ReminderSettings, ScheduledReminder, Split, Weekday } from "../types";
import { WEEK_ORDER, formatTime, minutesOfDay, todayISO } from "./date";

const BODIES = [
  "Your workout is ready when you are.",
  "Shoes on. You've got this.",
  "A good session is waiting.",
  "Time to move. Future you says thanks.",
  "Let's get a few sets in.",
  "Short or long, it all counts.",
  "Your split is calling.",
];

export function defaultReminders(): ReminderSettings {
  return { enabled: true, byWeekday: Array.from({ length: 7 }, () => ({ on: false, time: "17:30" })) };
}

/** One reminder per workout day of the split whose reminder is on (Monday first). */
export function buildSchedule(split: Split | null, reminders: ReminderSettings, locale?: string): ScheduledReminder[] {
  if (!split || !reminders?.enabled) return [];
  const out: ScheduledReminder[] = [];
  for (const wd of WEEK_ORDER) {
    const day = split.days[wd];
    const r = reminders.byWeekday?.[wd];
    if (!day || day.kind !== "workout" || !r?.on) continue;
    const name = day.name.trim() || "Workout";
    out.push({
      id: `workout-${wd}`,
      title: `${name} at ${formatTime(r.time, locale)}`,
      body: BODIES[wd % BODIES.length],
      time: r.time,
      weekday: wd as Weekday,
    });
  }
  return out;
}

/**
 * Today's reminders whose time has passed, unless a workout is done today or
 * the banner was dismissed (`dismissed` holds `${id}@${date}`).
 */
export function dueBanners(now: Date, schedule: ScheduledReminder[], doneToday: boolean, dismissed: string[]): DueBanner[] {
  if (doneToday) return [];
  const today = todayISO(now);
  const wd = now.getDay();
  const nowMin = now.getHours() * 60 + now.getMinutes();
  return schedule
    .filter((r) => (r.weekday === undefined || r.weekday === wd) && nowMin >= minutesOfDay(r.time) && !dismissed.includes(`${r.id}@${today}`))
    .map((r) => ({ id: r.id, title: r.title, body: r.body }));
}
