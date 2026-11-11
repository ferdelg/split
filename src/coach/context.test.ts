import { describe, expect, it } from "vitest";
import type { AppState, DayPlan, MonthLog, Session, Split, SplitsDoc } from "../types";
import { buildCoachContext } from "./context";
import { buildSystemPrompt } from "./prompt";

const day = (name: string, ex: string): DayPlan => ({
  kind: "workout",
  name,
  exercises: [{ id: ex, name: ex, sets: 3, reps: { min: 8 }, weightKg: 50 }],
});
const rest = (): DayPlan => ({ kind: "rest", name: "Rest", exercises: [] });

function splitsDoc(): SplitsDoc {
  const days = [rest(), day("Push", "Bench press"), day("Legs", "Back squat"), rest(), day("Pull", "Lat pulldown"), rest(), rest()];
  const s: Split = { id: "s1", name: "Mine", days, createdAt: 1, updatedAt: 1 };
  return { activeId: "s1", splits: [s], history: [{ splitId: "s1", from: "2026-10-01" }] };
}

function sess(date: string, extra: Partial<Session> = {}): Session {
  return {
    id: "id-" + date,
    date,
    title: "W " + date,
    from: { splitId: "s1", weekday: 1 },
    exercises: [{ id: "e", name: "Bench press", reps: { min: 8 }, source: "plan", sets: [{ reps: 8, weightKg: 50, done: true }] }],
    startedAt: 1,
    finishedAt: 2,
    thumb: "data:image/jpeg;base64,AAAA",
    photoId: "p1",
    note: "fine",
    ...extra,
  };
}

function logs(dates: string[]): Record<string, MonthLog> {
  const out: Record<string, MonthLog> = {};
  for (const d of dates) {
    const m = d.slice(0, 7);
    out[m] ??= { month: m, days: {} };
    out[m].days[d] = sess(d);
  }
  return out;
}

function state(over: Partial<AppState> = {}): AppState {
  return {
    ready: true,
    today: "2026-11-10", // Tuesday
    caps: { inFlinsh: true, store: "flinsh", ai: "flinsh", notifications: "live", photos: "inline", wakeLock: "unsupported", export: "files" },
    profile: { name: "Magdalena", units: "lb", bodyWeightKg: 63, goal: "muscle", startedOn: "2026-10-01", createdAt: 1, updatedAt: 1 },
    settings: { theme: "dark", reduceMotion: "system", textScale: 1, weightStep: 5, model: "m", reminders: { enabled: true, byWeekday: [] }, dismissedBanners: [] },
    splits: splitsDoc(),
    active: null,
    logs: logs(["2026-10-20", "2026-10-27", "2026-11-02", "2026-11-09", "2026-10-30"]),
    bests: { version: 1, through: null, records: {} },
    chat: [],
    chatBusy: false,
    coachError: null,
    pickedWeekday: null,
    summary: null,
    celebration: null,
    toasts: [],
    storeStatus: { pending: 0 },
    banners: [],
    tab: "coach",
    ...over,
  };
}

describe("buildCoachContext", () => {
  it("today, profile subset, active split, today's plan", () => {
    const c = buildCoachContext(state());
    expect(c.today).toBe("2026-11-10");
    expect(c.weekday).toBe(2);
    expect(c.profile).toEqual({ name: "Magdalena", units: "lb", bodyWeightKg: 63, goal: "muscle" });
    expect(c.activeSplit?.id).toBe("s1");
    expect(c.todayPlan?.name).toBe("Legs");
    expect(c.active).toBeNull();
  });

  it("recent: last 14 days, newest first, no photos", () => {
    const c = buildCoachContext(state());
    expect(c.recent.map((s) => s.date)).toEqual(["2026-11-09", "2026-11-02", "2026-10-30", "2026-10-27"]);
    for (const s of c.recent) {
      expect(s.thumb).toBeUndefined();
      expect(s.photoId).toBeUndefined();
    }
    const p = buildSystemPrompt(c);
    expect(p).not.toContain("base64");
    expect(p).not.toContain("2026-10-20");
  });

  it("respects the picked weekday and an active session's weekday", () => {
    expect(buildCoachContext(state({ pickedWeekday: 4 })).todayPlan?.name).toBe("Pull");
    const active = sess("2026-11-10", { finishedAt: undefined, from: { splitId: "s1", weekday: 1 } });
    const c = buildCoachContext(state({ active, pickedWeekday: 4 }));
    expect(c.todayPlan?.name).toBe("Push");
    expect(c.active?.id).toBe(active.id);
    expect(c.active?.thumb).toBeUndefined();
  });

  it("works with no profile or split", () => {
    const c = buildCoachContext(state({ profile: null, splits: null, logs: {} }));
    expect(c.profile).toBeNull();
    expect(c.activeSplit).toBeNull();
    expect(c.todayPlan).toBeNull();
    expect(c.recent).toEqual([]);
  });
});
