/**
 * Local-time date helpers. Every ISODate is a local calendar date in the
 * device's time zone. Pure: the current time is always a parameter.
 *
 * Day arithmetic goes through local NOON so it never lands in a DST gap.
 */
import type { ISODate, MonthKey, TimeOfDay, Weekday } from "../types";

/** Monday first, as the UI lists days. */
export const WEEK_ORDER: Weekday[] = [1, 2, 3, 4, 5, 6, 0];
export const WEEKDAY_NAMES: string[] = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
export const WEEKDAY_SHORT: string[] = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export const MONTH_NAMES: string[] = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const pad = (n: number) => String(n).padStart(2, "0");

function ymd(iso: string): [number, number, number] {
  const [y, m, d] = iso.split("-").map(Number);
  return [y || 1970, (m || 1) - 1, d || 1];
}

function toISO(d: Date): ISODate {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function noon(iso: ISODate): Date {
  const [y, m, d] = ymd(iso);
  return new Date(y, m, d, 12, 0, 0, 0);
}

export function todayISO(d: Date = new Date()): ISODate {
  return toISO(d);
}

/** Local midnight at the start of that date. */
export function parseISO(iso: ISODate): Date {
  const [y, m, d] = ymd(iso);
  return new Date(y, m, d, 0, 0, 0, 0);
}

export function addDays(iso: ISODate, n: number): ISODate {
  const d = noon(iso);
  d.setDate(d.getDate() + n);
  return toISO(d);
}

/** b − a in whole calendar days. */
export function diffDays(a: ISODate, b: ISODate): number {
  return Math.round((Date.UTC(...ymd(b)) - Date.UTC(...ymd(a))) / 86_400_000);
}

export function weekdayOf(iso: ISODate): Weekday {
  return noon(iso).getDay() as Weekday;
}

export function monthOf(iso: ISODate): MonthKey {
  return iso.slice(0, 7);
}

export function addMonths(month: MonthKey, n: number): MonthKey {
  const [y, m] = month.split("-").map(Number);
  const total = (y || 1970) * 12 + ((m || 1) - 1) + n;
  return `${Math.floor(total / 12)}-${pad((total % 12) + 1)}`;
}

/** Every date of the month, ascending. */
export function daysInMonth(month: MonthKey): ISODate[] {
  const [y, m] = month.split("-").map(Number);
  const n = new Date(y, m, 0, 12).getDate();
  return Array.from({ length: n }, (_, i) => `${month}-${pad(i + 1)}`);
}

export function msUntilNextMidnight(d: Date): number {
  const next = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1, 0, 0, 0, 0);
  return Math.max(1, next.getTime() - d.getTime());
}

/** "Tuesday, November 10" */
export function formatLongDate(iso: ISODate): string {
  const d = noon(iso);
  return `${WEEKDAY_NAMES[d.getDay()]}, ${MONTH_NAMES[d.getMonth()]} ${d.getDate()}`;
}

/** Minutes since midnight of an "HH:MM" time (0 for junk). */
export function minutesOfDay(t: TimeOfDay): number {
  const [h, m] = String(t).split(":").map(Number);
  return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0);
}

/** "5:30 PM" in 12-hour locales, "17:30" in 24-hour ones. */
export function formatTime(t: TimeOfDay, locale?: string): string {
  const min = minutesOfDay(t);
  const h = Math.floor(min / 60) % 24;
  const m = min % 60;
  try {
    const d = new Date(2000, 0, 1, h, m, 0, 0);
    return new Intl.DateTimeFormat(locale, { hour: "numeric", minute: "2-digit" }).format(d);
  } catch {
    return `${h % 12 || 12}:${pad(m)} ${h < 12 ? "AM" : "PM"}`;
  }
}
