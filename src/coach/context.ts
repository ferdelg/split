/**
 * AppState → CoachContext: everything the coach may see, nothing more
 * (never the API key, photos, thumbs, or anything older than 14 days).
 */
import type { AppState, CoachContext, Session, Weekday } from "../types";
import { resolveToday } from "../data/session";
import { allSessions } from "../data/history";
import { activeSplit } from "../data/split";
import { addDays, weekdayOf } from "../lib/date";

export const RECENT_DAYS = 14;

/** A session without photo data (the coach never sees photos). */
function stripMedia(s: Session): Session {
  const { photoId: _p, thumb: _t, ...rest } = s;
  void _p;
  void _t;
  return rest;
}

export function buildCoachContext(state: AppState): CoachContext {
  const today = state.today;
  const active = state.active ?? null;
  // An active session fixes the plan it came from; before starting, her pick (if any).
  const picked: Weekday | null = active ? (active.from?.weekday ?? null) : state.pickedWeekday ?? null;
  const resolved = resolveToday(today, state.splits, picked);
  const split = activeSplit(state.splits);

  const p = state.profile;
  const profile: CoachContext["profile"] = p
    ? {
        name: p.name,
        units: p.units,
        ...(p.heightCm != null ? { heightCm: p.heightCm } : {}),
        ...(p.bodyWeightKg != null ? { bodyWeightKg: p.bodyWeightKg } : {}),
        ...(p.goal ? { goal: p.goal } : {}),
      }
    : null;

  const from = addDays(today, -RECENT_DAYS);
  const recent = allSessions(state.logs ?? {})
    .filter((s) => s.date >= from && s.date <= today && !(active && s.id === active.id))
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : (b.finishedAt ?? 0) - (a.finishedAt ?? 0)))
    .map(stripMedia);

  return {
    today,
    weekday: weekdayOf(today),
    profile,
    activeSplit: split,
    todayPlan: active && !active.from ? null : resolved.plan,
    active: active ? stripMedia(active) : null,
    recent,
  };
}
