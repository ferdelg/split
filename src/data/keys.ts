/** Store keys (PLAN "Data model"). `/` separates, never `:` (rejected by flinsh.store). */
import type { ISODate, MonthKey } from "../types";

export const K = { profile: "profile", settings: "settings", splits: "splits", active: "active", bests: "bests" } as const;

export function logKey(month: MonthKey): string {
  return `logs/${month}`;
}

export function chatKey(date: ISODate): string {
  return `chat/${date}`;
}

export function photoKey(id: string): string {
  return `photo/${id}`;
}

/** Chats older than this many days are deleted at boot. */
export const CHAT_KEEP_DAYS = 30;
/** Dismissed reminder banners are remembered this many days. */
export const DISMISSED_KEEP_DAYS = 7;
