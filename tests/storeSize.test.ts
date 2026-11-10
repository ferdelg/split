/**
 * Three-year store projection (docs/PLAN.md "Data model" budget):
 * 3 years × 5 days/week of realistic sessions (6 exercises × 4 sets, notes,
 * a ~1.2 KB thumb on a third of days) grouped as MonthLog values, plus
 * profile/settings/splits (3 splits), bests for 60 exercises, 20 photos at
 * the size cap and 30 chat days at the chat cap (worst case). Bytes = utf-8 of key + JSON, like the backend.
 */
import { describe, expect, it } from "vitest";
import { entryBytes, KB, MB } from "../scripts/harness/canned.mjs";
import { completeSet, editSet, finalizeSession, sessionFromPlan } from "../src/data/session";
import { buildTemplate } from "../src/data/templates";
import { compactOldThumbs, emptyBests, foldSession, normalizeName } from "../src/data/history";
import { packMonthLog } from "../src/data/logCodec";
import { PHOTO_KEEP, PHOTO_MAX_BYTES } from "../src/adapters/media";
import { CHAT_MAX_BYTES } from "../src/coach/coach";
import { chatKey, K, logKey, photoKey } from "../src/data/keys";
import { addDays, monthOf, weekdayOf } from "../src/lib/date";
import { defaultReminders } from "../src/lib/reminders";
import { fromDisplay } from "../src/lib/units";
import type { BestsDoc, ChatMessage, MonthLog, PlannedExercise, Profile, Settings, Split, SplitsDoc, StoredPhoto } from "../src/types";

let rnd = 42;
const rand = () => ((rnd = (rnd * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
const b64 = (bytes: number) => "/9j/" + "A".repeat(Math.ceil(bytes / 3) * 4 - 4);

const START = "2023-11-13"; // a Monday, three years before
const END = "2026-11-10";
const T0 = new Date(2023, 10, 13).getTime();

function sixByFour(s: Split): Split {
  // 6 exercises × 4 sets on each workout day
  const extra = ["Cable fly", "Face pull", "Hammer curl", "Leg curl", "Calf raise", "Ab wheel"];
  return {
    ...s,
    days: s.days.map((d, wd) => {
      if (d.kind !== "workout") return d;
      const ex: PlannedExercise[] = d.exercises.slice(0, 6).map((e) => ({ ...e, sets: 4 }));
      for (let i = 0; ex.length < 6; i++) ex.push({ id: `x${wd}${i}`, name: extra[(wd + i) % extra.length], sets: 4, reps: { min: 10, max: 12 }, weightKg: fromDisplay(30, "lb") });
      return { ...d, exercises: ex };
    }),
  };
}

function generate() {
  const split = sixByFour(buildTemplate("ppl-5", "lb", T0));
  const logs: Record<string, MonthLog> = {};
  let bests: BestsDoc = emptyBests();
  let sessions = 0;
  let thumbs = 0;
  for (let d = START; d <= END; d = addDays(d, 1)) {
    const wd = weekdayOf(d);
    const plan = split.days[wd];
    if (plan.kind !== "workout") continue;
    const at = new Date(d + "T18:00").getTime();
    let s = sessionFromPlan(d, plan, { splitId: split.id, weekday: wd }, at);
    for (const ex of s.exercises) {
      for (let i = 0; i < ex.sets.length; i++) {
        const w = ex.sets[i].weightKg;
        s = editSet(s, ex.id, i, { reps: ex.sets[i].reps + (rand() < 0.3 ? 1 : 0), weightKg: w == null ? null : w + fromDisplay(5 * Math.floor(rand() * 3), "lb") }, at + i * 90_000);
        s = completeSet(s, ex.id, i, at + i * 90_000);
      }
    }
    s = { ...finalizeSession(s, at + 55 * 60_000), note: "Felt strong today, left hip a bit tight on the last set.", finishLine: "Another one in the book. Nice work." };
    if (sessions % 3 === 0) {
      s.thumb = `data:image/jpeg;base64,${b64(900)}`; // ~1.2 KB as a data URL
      s.photoId = `${d}-abcd1234`;
      thumbs++;
    }
    if (rand() < 0.15) s.bests = [{ exercise: s.exercises[0].name, kind: "heaviest", weightKg: 100.24, reps: 5, previous: { weightKg: 97.97, reps: 5 } }];
    bests = foldSession(bests, s);
    const m = monthOf(d);
    (logs[m] ??= { month: m, days: {} }).days[d] = s;
    sessions++;
  }
  // bests for 60 exercises
  for (let i = Object.keys(bests.records).length; i < 60; i++) {
    const name = `Exercise number ${i}`;
    bests.records[normalizeName(name)] = {
      name,
      heaviest: { weightKg: 61.234969950000004, reps: 8, date: "2026-11-02" },
      repsAt: Object.fromEntries(Array.from({ length: 6 }, (_, j) => [(50 + j * 2.27).toFixed(2), { reps: 8 + j, date: "2026-10-01" }])),
      last: { date: "2026-11-02", sets: Array.from({ length: 4 }, () => ({ reps: 8, weightKg: 61.234969950000004 })) },
      sessions: 40,
    };
  }
  const splitsDoc: SplitsDoc = {
    activeId: split.id,
    splits: [split, { ...sixByFour(buildTemplate("upper-lower-4", "lb", T0)), archivedAt: T0 }, { ...sixByFour(buildTemplate("full-body-3", "lb", T0)), archivedAt: T0 }],
    history: [{ splitId: split.id, from: START }],
  };
  const profile: Profile = { name: "Magdalena", units: "lb", heightCm: 165, bodyWeightKg: 63.5, goal: "muscle", startedOn: START, onboardedAt: T0, createdAt: T0, updatedAt: T0 };
  const settings: Settings = { theme: "dark", reduceMotion: "system", textScale: 1, weightStep: 5, model: "claude-sonnet-5-5", reminders: defaultReminders(), dismissedBanners: [] };
  const photos: Record<string, StoredPhoto> = {};
  for (let i = 0; i < PHOTO_KEEP; i++) {
    const id = `2026-10-${String(i + 1).padStart(2, "0")}-abcd1234`;
    photos[photoKey(id)] = { id, date: id.slice(0, 10), dataUrl: `data:image/jpeg;base64,${b64(PHOTO_MAX_BYTES)}`, bytes: PHOTO_MAX_BYTES }; // every photo at the cap
  }
  const chats: Record<string, ChatMessage[]> = {};
  for (let i = 0; i < 30; i++) {
    const msgs: ChatMessage[] = [];
    while (JSON.stringify(msgs).length < CHAT_MAX_BYTES - 700) msgs.push({ id: `m${msgs.length}`, role: msgs.length % 2 ? "assistant" : "user", text: "Could you swap the bench for something else? The rack is taken. ".repeat(4), at: T0 });
    chats[chatKey(addDays(END, -i))] = msgs;
  }
  return { logs, bests, splitsDoc, profile, settings, photos, chats, sessions, thumbs };
}

function tally(entries: [string, unknown][]) {
  let total = 0;
  let biggest = 0;
  let biggestKey = "";
  for (const [k, v] of entries) {
    const n = entryBytes(k, v);
    total += n;
    const vb = n - k.length;
    if (vb > biggest) [biggest, biggestKey] = [vb, k];
  }
  return { total, biggest, biggestKey, keys: entries.length };
}

describe("three-year store projection", () => {
  const g = generate();
  const yearAgo = monthOf(addDays(END, -365));
  const logEntries = (compact: boolean): [string, unknown][] =>
    // Stored packed (src/data/logCodec.ts), exactly as actions.ts writes them.
    Object.values(g.logs).map((l) => [logKey(l.month), packMonthLog(compact && l.month < yearAgo ? compactOldThumbs(l) : l)]);
  const fixed: [string, unknown][] = [[K.profile, g.profile], [K.settings, g.settings], [K.splits, g.splitsDoc], [K.bests, g.bests]];
  const photos = Object.entries(g.photos);
  const chats = Object.entries(g.chats);

  const raw = tally([...fixed, ...logEntries(false), ...photos, ...chats]);
  const compact = tally([...fixed, ...logEntries(true), ...photos, ...chats]);
  const kb = (n: number) => `${(n / KB).toFixed(1)} KB`;
  const part = (e: [string, unknown][]) => kb(tally(e).total);
  console.log(
    [
      `storeSize: ${g.sessions} sessions in ${Object.keys(g.logs).length} months, ${g.thumbs} thumbs`,
      `  logs ${part(logEntries(false))} (compacted >1y: ${part(logEntries(true))}), avg/session ${(tally(logEntries(false)).total / g.sessions).toFixed(0)} B`,
      `  photos ${part(photos)}, chat ${part(chats)}, profile+settings+splits+bests ${part(fixed)}`,
      `  TOTAL ${kb(raw.total)} (compacted ${kb(compact.total)}) of ${kb(2 * MB)}; ${compact.keys} keys; biggest value ${compact.biggestKey} ${kb(compact.biggest)}`,
    ].join("\n"),
  );

  it("generated what the plan describes", () => {
    expect(Object.keys(g.logs).length).toBeGreaterThanOrEqual(36);
    expect(g.sessions).toBeGreaterThan(3 * 52 * 5 - 10);
    const any = Object.values(Object.values(g.logs)[3].days)[0];
    expect(any.exercises).toHaveLength(6);
    expect(any.exercises.every((e) => e.sets.length === 4 && e.sets.every((s) => s.done))).toBe(true);
  });

  it("every value < 256 KB", () => {
    for (const [k, v] of [...fixed, ...logEntries(false), ...photos, ...chats]) expect(entryBytes(k, v) - k.length, k).toBeLessThan(256 * KB);
  });

  it("< 1,000 keys", () => {
    expect(compact.keys).toBeLessThan(1000);
  });

  it("total < 2 MB (with thumbs compacted in months older than a year)", () => {
    expect(compact.total, `total ${kb(compact.total)}`).toBeLessThan(2 * MB);
  });
});
