import { describe, expect, it } from "vitest";
import { buildSchedule, defaultReminders, dueBanners } from "../src/lib/reminders";
import { formatTime } from "../src/lib/date";
import type { DayPlan, ReminderSettings, Split, Weekday } from "../src/types";

const rest = (): DayPlan => ({ kind: "rest", name: "Rest", exercises: [] });
const work = (name: string): DayPlan => ({
  kind: "workout",
  name,
  exercises: [{ id: `x-${name}`, name: "Squat", sets: 3, reps: { min: 5 }, weightKg: 60 }],
});

// Mon Upper, Tue Legs, Thu Push, Sat Full; Sun/Wed/Fri rest.
const split: Split = {
  id: "sp1",
  name: "Mine",
  days: [rest(), work("Upper"), work("Legs"), rest(), work("Push"), rest(), work("Full")],
  createdAt: 0,
  updatedAt: 0,
};

function reminders(on: Partial<Record<Weekday, string>>, enabled = true): ReminderSettings {
  const r = defaultReminders();
  r.enabled = enabled;
  for (const [wd, time] of Object.entries(on)) r.byWeekday[Number(wd)] = { on: true, time: time! };
  return r;
}

describe("defaultReminders", () => {
  it("enabled, seven days all off at 17:30", () => {
    const r = defaultReminders();
    expect(r.enabled).toBe(true);
    expect(r.byWeekday).toHaveLength(7);
    for (const d of r.byWeekday) expect(d).toEqual({ on: false, time: "17:30" });
  });
});

describe("buildSchedule", () => {
  it("only workout days whose reminder is on", () => {
    // Tue (workout, on), Wed (rest, on), Thu (workout, on), Mon (workout, off)
    const list = buildSchedule(split, reminders({ 2: "17:30", 3: "18:00", 4: "07:15" }), "en-US");
    expect(list.map((r) => r.weekday)).toEqual([2, 4]);
    expect(list.map((r) => r.id)).toEqual(["workout-2", "workout-4"]);
  });

  it('title is "<Name> at <time>", with weekday and time', () => {
    const [legs] = buildSchedule(split, reminders({ 2: "17:30" }), "en-US");
    expect(legs.title).toBe(`Legs at ${formatTime("17:30", "en-US")}`);
    expect(legs.title).toMatch(/^Legs at 5:30\s?PM$/);
    expect(legs.time).toBe("17:30");
    expect(legs.weekday).toBe(2);
    expect(legs.body.trim().length).toBeGreaterThan(0);
    const [legs24] = buildSchedule(split, reminders({ 2: "17:30" }), "en-GB");
    expect(legs24.title).toBe("Legs at 17:30");
  });

  it("Sunday (weekday 0) works and ids are stable", () => {
    const s: Split = { ...split, days: split.days.map((d, i) => (i === 0 ? work("Sunday run") : d)) };
    const list = buildSchedule(s, reminders({ 0: "09:00" }), "en-GB");
    expect(list).toEqual([expect.objectContaining({ id: "workout-0", weekday: 0, title: `Sunday run at ${formatTime("09:00", "en-GB")}` })]);
  });

  it("nothing when the master switch is off or there is no split", () => {
    expect(buildSchedule(split, reminders({ 2: "17:30" }, false))).toEqual([]);
    expect(buildSchedule(null, reminders({ 2: "17:30" }))).toEqual([]);
  });
});

describe("dueBanners", () => {
  const schedule = buildSchedule(split, reminders({ 2: "17:30", 4: "07:15" }), "en-US");
  const tue = (h: number, m = 0) => new Date(2026, 10, 10, h, m); // Tue Nov 10 2026

  it("today's reminder once its time has passed", () => {
    expect(dueBanners(tue(17, 29), schedule, false, [])).toEqual([]);
    const due = dueBanners(tue(17, 30), schedule, false, []);
    expect(due).toHaveLength(1);
    expect(due[0]).toMatchObject({ id: "workout-2", title: schedule[0].title });
    expect(dueBanners(tue(22), schedule, false, [])).toHaveLength(1);
  });

  it("not if a workout is done today, or it was dismissed today", () => {
    expect(dueBanners(tue(18), schedule, true, [])).toEqual([]);
    expect(dueBanners(tue(18), schedule, false, ["workout-2@2026-11-10"])).toEqual([]);
    // dismissed last week doesn't count
    expect(dueBanners(tue(18), schedule, false, ["workout-2@2026-11-03"])).toHaveLength(1);
  });

  it("other weekdays' reminders are not due", () => {
    const wed = new Date(2026, 10, 11, 20, 0);
    expect(dueBanners(wed, schedule, false, [])).toEqual([]);
  });
});
