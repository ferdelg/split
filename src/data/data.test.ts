import { afterEach, describe, expect, it } from "vitest";
import type { FlinshBridge, MonthLog, Session, SplitsDoc } from "../types";
import { dataUrlBytes, fitJpeg, planEviction } from "../adapters/media";
import { coachErrorMessage } from "../adapters/ai";
import { formatWeight, fromDisplay, parseReps, stepWeight } from "../lib/units";
import { addMonths, formatTime, weekdayOf } from "../lib/date";
import { buildSchedule, dueBanners, defaultReminders } from "../lib/reminders";
import { detectBests, foldSession, rebuildBests, streak, dayStatus, emptyBests } from "./history";
import { applyProposalToSession, completeSet, finalizeSession, sessionFromPlan } from "./session";
import { buildTemplate } from "./templates";
import { normalizeMonthLog } from "./defaults";
import { actions } from "./actions";
import { getState, initApp, resetForTests, services, setClock } from "./state";

const T = Date.UTC(2026, 10, 10, 15);

function sess(date: string, sets: [number, number | null, boolean?][], name = "Back squat"): Session {
  return {
    id: `s-${date}`,
    date,
    title: "Legs",
    from: null,
    startedAt: T,
    finishedAt: T,
    exercises: [{ id: "x", name, reps: { min: 5 }, source: "plan", sets: sets.map(([reps, weightKg, done = true]) => ({ reps, weightKg, done })) }],
  };
}

function logsOf(...ss: Session[]): Record<string, MonthLog> {
  const out: Record<string, MonthLog> = {};
  for (const s of ss) (out[s.date.slice(0, 7)] ??= { month: s.date.slice(0, 7), days: {} }).days[s.date] = s;
  return out;
}

describe("units", () => {
  it("steps on the display grid", () => {
    const kg135 = fromDisplay(135, "lb");
    expect(formatWeight(stepWeight(kg135, "lb", 5, 1), "lb")).toBe("140 lb");
    expect(formatWeight(stepWeight(fromDisplay(132.5, "lb"), "lb", 5, 1), "lb")).toBe("135 lb");
    expect(formatWeight(stepWeight(fromDisplay(132.5, "lb"), "lb", 5, -1), "lb")).toBe("130 lb");
    expect(formatWeight(stepWeight(null, "kg", 2.5, 1), "kg")).toBe("2.5 kg");
    expect(stepWeight(fromDisplay(5, "lb"), "lb", 5, -1)).toBeNull();
    expect(formatWeight(null, "lb")).toBe("bodyweight");
    expect(formatWeight(60, "kg")).toBe("60 kg");
  });
  it("parses reps", () => {
    expect(parseReps("8")).toEqual({ min: 8 });
    expect(parseReps("8-12")).toEqual({ min: 8, max: 12 });
    expect(parseReps("8 to 12")).toEqual({ min: 8, max: 12 });
    expect(parseReps("0")).toBeNull();
    expect(parseReps("abc")).toBeNull();
  });
  it("dates", () => {
    expect(addMonths("2026-01", -1)).toBe("2025-12");
    expect(weekdayOf("2026-11-10")).toBe(2);
    expect(formatTime("17:30", "en-US")).toMatch(/5:30\sPM/);
    expect(formatTime("17:30", "en-GB")).toBe("17:30");
  });
});

describe("reminders", () => {
  it("builds and shows due banners", () => {
    const split = buildTemplate("upper-lower-4", "lb", T);
    const r = defaultReminders();
    r.byWeekday[2] = { on: true, time: "17:30" };
    const sch = buildSchedule(split, r, "en-GB");
    expect(sch).toEqual([{ id: "workout-2", title: "Lower A at 17:30", body: expect.any(String), time: "17:30", weekday: 2 }]);
    const at = new Date(2026, 10, 10, 18, 0);
    expect(dueBanners(at, sch, false, [])).toHaveLength(1);
    expect(dueBanners(at, sch, true, [])).toHaveLength(0);
    expect(dueBanners(at, sch, false, ["workout-2@2026-11-10"])).toHaveLength(0);
    expect(dueBanners(new Date(2026, 10, 10, 17, 0), sch, false, [])).toHaveLength(0);
  });
});

describe("records", () => {
  it("no PBs on the first session; heaviest wins over reps for the same set", () => {
    const a = sess("2026-11-02", [[5, 60], [5, 60]]);
    expect(detectBests(a, emptyBests())).toEqual([]);
    const b1 = foldSession(emptyBests(), a);
    const b = sess("2026-11-05", [[5, 62.5], [6, 60]]);
    const pbs = detectBests(b, b1);
    expect(pbs.map((p) => p.kind).sort()).toEqual(["heaviest", "reps"]);
    expect(pbs.find((p) => p.kind === "reps")).toMatchObject({ weightKg: 60, reps: 6, previous: { reps: 5 } });
    const c = sess("2026-11-05", [[7, 62.5]]);
    expect(detectBests(c, b1).map((p) => p.kind)).toEqual(["heaviest"]);
    expect(rebuildBests([b, a]).records["back squat"].sessions).toBe(2);
  });
  it("bodyweight compares reps only", () => {
    const b1 = foldSession(emptyBests(), sess("2026-11-02", [[10, null]], "Push-up"));
    expect(detectBests(sess("2026-11-04", [[12, null]], "Push-up"), b1)).toEqual([
      { exercise: "Push-up", kind: "reps", weightKg: null, reps: 12, previous: { weightKg: null, reps: 10 } },
    ]);
  });
});

describe("streak + status", () => {
  const split = buildTemplate("full-body-3", "lb", T); // Mon, Wed, Fri
  const doc: SplitsDoc = { activeId: split.id, splits: [split], history: [{ splitId: split.id, from: "2026-10-01" }] };
  it("rest days neither add nor break; a missed day ends it; today not done doesn't break", () => {
    // Mon 11-02, Wed 11-04, Fri 11-06, Mon 11-09 done; today Tue 11-10 (rest)
    const logs = logsOf(...["2026-11-02", "2026-11-04", "2026-11-06", "2026-11-09"].map((d) => sess(d, [[5, 60]])));
    expect(streak("2026-11-10", doc, logs, "2026-11-01")).toBe(4);
    // Wed 11-11 not done yet
    expect(streak("2026-11-11", doc, logs, "2026-11-01")).toBe(4);
    // Fri 11-06 missed
    const gap = logsOf(...["2026-11-02", "2026-11-04", "2026-11-09"].map((d) => sess(d, [[5, 60]])));
    expect(streak("2026-11-10", doc, gap, "2026-11-01")).toBe(1);
    expect(dayStatus("2026-11-06", "2026-11-10", doc, gap, "2026-11-01")).toBe("missed");
    expect(dayStatus("2026-11-07", "2026-11-10", doc, gap, "2026-11-01")).toBe("rest");
    expect(dayStatus("2026-11-13", "2026-11-10", doc, gap, "2026-11-01")).toBe("planned");
    expect(dayStatus("2026-10-30", "2026-11-10", doc, gap, "2026-11-01")).toBe("before-start");
  });
});

describe("session", () => {
  it("proposal keeps completed sets of the same exercise and fills weights", () => {
    const split = buildTemplate("full-body-3", "kg", T);
    let s = sessionFromPlan("2026-11-09", split.days[1], { splitId: split.id, weekday: 1 }, T);
    const squat = s.exercises[0];
    s = completeSet(s, squat.id, 0, T);
    const out = applyProposalToSession(
      "2026-11-09",
      { reason: "short", exercises: [{ name: "back squat", sets: 2, reps: { min: 5 } }, { name: "Goblet squat", sets: 2, reps: { min: 10 } }] },
      s,
      emptyBests(),
      (n) => (n === "Goblet squat" ? 12 : null),
      T,
    );
    expect(out.coachAdjusted).toBe(true);
    expect(out.exercises[0].sets.map((x) => x.done)).toEqual([true, false]);
    expect(out.exercises[1].sets[0].weightKg).toBe(12);
    expect(finalizeSession(out, T).finishedAt).toBe(T);
  });
});

describe("media", () => {
  it("fitJpeg lowers quality, then scale", async () => {
    const calls: [number, number][] = [];
    const url = (n: number) => "data:image/jpeg;base64," + "A".repeat(Math.ceil((n * 4) / 3));
    const out = await fitJpeg(async (q, s) => {
      calls.push([q, s]);
      return url(Math.round(100_000 * q * s * s));
    }, 20_000);
    expect(dataUrlBytes(out)).toBeLessThanOrEqual(20_000);
    expect(calls.slice(0, 5).map((c) => c[0])).toEqual([0.8, 0.7, 0.6, 0.5, 0.4]);
    expect(calls[5]).toEqual([0.4, 0.85]);
  });
  it("planEviction keeps the newest", () => {
    expect(planEviction(["2026-11-03-a", "2026-11-01-b", "2026-11-02-c"], 2)).toEqual(["2026-11-01-b"]);
    expect(planEviction(["a"], 20)).toEqual([]);
  });
  it("dataUrlBytes", () => {
    expect(dataUrlBytes("data:image/jpeg;base64,QUJD")).toBe(3);
    expect(dataUrlBytes("data:image/jpeg;base64,QUI=")).toBe(2);
  });
});

describe("ai copy", () => {
  it("maps codes", () => {
    expect(coachErrorMessage("no_ai_key", "no_key")).toBe("Add your Anthropic key in Flinsh Settings to turn on the coach");
    expect(coachErrorMessage("rate_limited", "rate_limit")).toBe("The coach is catching its breath. Try again in a bit.");
    expect(coachErrorMessage("timeout", "network")).toBe("The coach couldn't answer. Try again. (timeout)");
  });
});

function mockBridge(): FlinshBridge & { data: Map<string, unknown> } {
  const data = new Map<string, unknown>();
  return {
    data,
    store: {
      get: async (k) => (data.has(k) ? structuredClone(data.get(k)) : null),
      set: async (k, v) => void data.set(k, structuredClone(v)),
      delete: async (k) => data.delete(k),
      list: async (p) => [...data.keys()].filter((k) => k.startsWith(p ?? "")),
    },
  };
}

describe("actions flow", () => {
  afterEach(() => resetForTests());

  it("onboard → complete sets → finish → reload", async () => {
    const bridge = mockBridge();
    setClock(() => new Date(2026, 10, 9, 18, 0)); // Monday
    await initApp({ bridge });
    expect(getState().caps).toMatchObject({ inFlinsh: true, store: "flinsh", ai: "none", notifications: "in-app", photos: "inline" });
    actions.completeOnboarding({ name: "Mags", units: "lb", template: "full-body-3" });
    actions.finishWorkout(); // no session: no-op
    const plan = getState().splits!.splits[0].days[1];
    const exId = plan.exercises[0].id;
    actions.completeSet(exId, 0);
    expect(getState().active?.from).toMatchObject({ weekday: 1 });
    expect(getState().celebration).toMatchObject({ kind: "set" });
    actions.markAll(exId);
    expect(getState().celebration).toMatchObject({ kind: "exercise" });
    actions.editSet(exId, 1, { weightKg: fromDisplay(100, "lb") });
    actions.finishWorkout();
    const st = getState();
    expect(st.active).toBeNull();
    expect(st.summary).toMatchObject({ totalSets: 3, weightsChanged: true });
    expect(st.celebration).toMatchObject({ kind: "finish", pb: false });
    actions.saveWeightsToSplit();
    expect(formatWeight(getState().splits!.splits[0].days[1].exercises[0].weightKg, "lb")).toBe("100 lb");
    await services().store.flush();
    expect(bridge.data.has("active")).toBe(false);
    expect(normalizeMonthLog(bridge.data.get("logs/2026-11"), "2026-11").days["2026-11-09"].exercises[0].sets.every((s) => s.done)).toBe(true);
    expect([...bridge.data.keys()].some((k) => k.includes(":"))).toBe(false);

    resetForTests();
    setClock(() => new Date(2026, 10, 16, 9, 0));
    await initApp({ bridge });
    expect(getState().profile?.name).toBe("Mags");
    expect(getState().bests.records["back squat"].sessions).toBe(1);
  });

  it("finish needs a set; deleteEverything clears every key", async () => {
    const bridge = mockBridge();
    setClock(() => new Date(2026, 10, 10, 18, 0));
    await initApp({ bridge });
    actions.completeOnboarding({ name: "M", units: "kg", template: "blank" });
    actions.startWorkout({ extra: true });
    actions.finishWorkout();
    expect(getState().toasts.at(-1)?.text).toBe("Complete a set first, or discard.");
    actions.discardWorkout();
    await actions.deleteEverything();
    expect(bridge.data.size).toBe(0);
    expect(getState().profile).toBeNull();
  });
});

describe("coach through actions", () => {
  afterEach(() => resetForTests());

  it("propose → apply (split untouched) → save to split; error codes", async () => {
    const bridge = mockBridge();
    let fail: string | null = null;
    bridge.ai = {
      chat: async () => {
        if (fail) throw Object.assign(new Error("x"), { code: fail });
        return {
          stop_reason: "tool_use",
          content: [
            { type: "text", text: "Shorter today." },
            { type: "tool_use", id: "t1", name: "proposeWorkout", input: { title: "Short legs", reason: "Tight on time", exercises: [{ name: "Back squat", sets: 2, reps: "5" }] } },
          ],
        };
      },
    };
    setClock(() => new Date(2026, 10, 9, 18, 0));
    await initApp({ bridge });
    actions.completeOnboarding({ name: "M", units: "lb", template: "full-body-3" });
    const before = JSON.stringify(getState().splits);
    await actions.sendCoach("Plan today", "plan-today");
    const msg = getState().chat.at(-1)!;
    expect(msg.proposal?.status).toBe("pending");
    actions.applyProposal(msg.id);
    expect(getState().active).toMatchObject({ coachAdjusted: true, title: "Short legs" });
    expect(getState().active!.exercises[0].sets[0].weightKg).toBeCloseTo(fromDisplay(95, "lb"));
    expect(JSON.stringify(getState().splits)).toBe(before);
    actions.saveProposalToSplit(msg.id);
    const day = getState().splits!.splits[0].days[1];
    expect(day.name).toBe("Short legs");
    expect(day.exercises).toHaveLength(1);
    expect(getState().chat.at(-1)!.proposal?.status).toBe("saved");

    fail = "no_ai_key";
    await actions.sendCoach("hi");
    expect(getState().coachError?.message).toBe("Add your Anthropic key in Flinsh Settings to turn on the coach");
    expect(getState().chat.at(-1)).toMatchObject({ error: true });
  });
});
