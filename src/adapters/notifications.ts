/**
 * Reminders: flinsh.notifications.schedule (proposed, not on the web bridge
 * today) → "in-app" mode, where the app shows due banners itself
 * (lib/reminders.ts dueBanners, refreshed by data/state.ts).
 */
import type { FlinshBridge, NotificationsAdapter, ScheduledReminder } from "../types";

/** Every id this app can schedule, so the first sync also clears a previous run's. */
const ALL_IDS = Array.from({ length: 7 }, (_, wd) => `workout-${wd}`);

export function createNotificationsAdapter(bridge: FlinshBridge | null): NotificationsAdapter {
  const api = bridge?.notifications;
  if (!api || typeof api.schedule !== "function") {
    return { mode: "in-app", sync: async () => {}, cancelAll: async () => {} };
  }
  let previous: string[] = ALL_IDS;
  const cancel = async (ids: string[]) => {
    if (!ids.length || typeof api.cancel !== "function") return;
    try {
      await api.cancel(ids);
    } catch (e) {
      // Cancelling ids that aren't scheduled may reject; scheduling still goes ahead.
      console.warn("[split] notifications.cancel failed", e);
    }
  };
  return {
    mode: "live",
    async sync(list: ScheduledReminder[]) {
      await cancel(previous);
      try {
        if (list.length) await api.schedule!(list);
        previous = list.map((r) => r.id);
      } catch (e) {
        console.warn("[split] notifications.schedule failed", e);
      }
    },
    async cancelAll() {
      await cancel([...new Set([...previous, ...ALL_IDS])]);
      previous = [];
    },
  };
}
