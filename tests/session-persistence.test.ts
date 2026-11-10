/** An in-progress workout survives a reload; finishing moves it into logs. */
import { normalizeMonthLog } from "../src/data/defaults";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LoadError, getState, initApp, resetForTests, services, setClock } from "../src/data/state";
import { actions } from "../src/data/actions";
import { createMockFlinsh } from "./helpers/mockFlinsh";
import { fromDisplay, stepWeight } from "../src/lib/units";
import type { MonthLog, Session } from "../src/types";

const TUE = new Date(2026, 10, 10, 18, 0); // Tuesday: a workout day in 4-day upper/lower

async function boot(m: ReturnType<typeof createMockFlinsh>, at = TUE) {
  resetForTests();
  setClock(() => new Date(at));
  await initApp({ bridge: m.bridge });
}

afterEach(() => resetForTests());

describe("session persistence (mock bridge store round trip)", () => {
  it("in-progress session survives reload", async () => {
    const m = createMockFlinsh();
    await boot(m);
    actions.completeOnboarding({ name: "Magdalena", units: "lb", template: "upper-lower-4" });
    const st = getState();
    expect(st.profile?.name).toBe("Magdalena");
    const plan = st.splits!.splits.find((s) => s.id === st.splits!.activeId)!.days[2];
    expect(plan.kind).toBe("workout");
    const first = plan.exercises[0];

    // Before starting, Today renders the plan; the first tap creates the session.
    actions.completeSet(first.id, 0);
    let active = getState().active!;
    expect(active).toBeTruthy();
    expect(active.date).toBe("2026-11-10");
    const ex = active.exercises.find((e) => e.planExerciseId === first.id || e.id === first.id)!;
    expect(ex.sets[0].done).toBe(true);
    const newW = stepWeight(ex.sets[1].weightKg, "lb", 5, 1);
    actions.editSet(ex.id, 1, { weightKg: newW });

    await services().store.flush();
    expect((m.storeData.get("active") as Session).exercises.find((e) => e.id === ex.id)!.sets[0].done).toBe(true);

    await boot(m); // reload: same store, fresh memory
    active = getState().active!;
    expect(active).toBeTruthy();
    const back = active.exercises.find((e) => e.id === ex.id)!;
    expect(back.sets[0].done).toBe(true);
    expect(back.sets[1]).toMatchObject({ done: true, weightKg: newW });
    expect(getState().profile?.name).toBe("Magdalena");

    // finish → logs/2026-11, active deleted
    actions.finishWorkout();
    expect(getState().active).toBeNull();
    expect(getState().summary).toBeTruthy();
    await services().store.flush();
    // `active` is deleted only after the log write is acknowledged (actions.retireActive).
    await vi.waitFor(() => expect(m.storeData.has("active")).toBe(false));
    const log: MonthLog = normalizeMonthLog(m.storeData.get("logs/2026-11"), "2026-11");
    expect(log.days["2026-11-10"].finishedAt).toBeTypeOf("number");
    expect(log.days["2026-11-10"].exercises.find((e) => e.id === ex.id)!.sets[1].weightKg).toBeCloseTo(newW!, 3);
    expect(newW).toBeCloseTo(fromDisplay(Math.round(newW! / fromDisplay(1, "lb")), "lb"), 9);
    // the split itself is untouched by the weight change
    const stored = m.storeData.get("splits") as typeof st.splits;
    expect(stored!.splits.find((s) => s.id === stored!.activeId)!.days[2].exercises[0].weightKg).toBe(first.weightKg);
  });

  it("a session from an earlier date is kept at boot (not auto-discarded)", async () => {
    const m = createMockFlinsh();
    await boot(m);
    actions.completeOnboarding({ name: "M", units: "kg", template: "upper-lower-4" });
    const plan = getState().splits!.splits[0].days[2];
    actions.completeSet(plan.exercises[0].id, 0);
    await services().store.flush();
    await boot(m, new Date(2026, 10, 11, 9, 0));
    expect(getState().today).toBe("2026-11-11");
    expect(getState().active?.date).toBe("2026-11-10");
  });

  it("a failed read at boot is a LoadError, never onboarding over her data", async () => {
    const m = createMockFlinsh();
    await boot(m);
    actions.completeOnboarding({ name: "Magdalena", units: "lb", template: "upper-lower-4" });
    await services().store.flush();
    const before = new Map(m.storeData);
    resetForTests();
    setClock(() => new Date(TUE));
    m.failNext("get", 1000, "network down");
    await expect(initApp({ bridge: m.bridge })).rejects.toBeInstanceOf(LoadError);
    expect(getState().profile).toBeNull();
    expect(m.storeData).toEqual(before);
  });

  it("`active` stays in the store until the finished log is saved", async () => {
    const m = createMockFlinsh();
    await boot(m);
    actions.completeOnboarding({ name: "M", units: "kg", template: "upper-lower-4" });
    const plan = getState().splits!.splits[0].days[2];
    actions.completeSet(plan.exercises[0].id, 0);
    await services().store.flush();
    expect(m.storeData.has("active")).toBe(true);
    m.failNext("set", 1, "quota hiccup");
    actions.finishWorkout();
    await services().store.flush();
    // The log write failed: the workout must still be recoverable.
    expect(m.storeData.has("logs/2026-11") && normalizeMonthLog(m.storeData.get("logs/2026-11"), "2026-11").days["2026-11-10"]).toBeFalsy();
    expect(m.storeData.has("active")).toBe(true);
    // The store retries; once the log lands, active goes.
    await vi.waitFor(() => expect(m.storeData.has("active")).toBe(false), { timeout: 4000 });
    expect(normalizeMonthLog(m.storeData.get("logs/2026-11"), "2026-11").days["2026-11-10"].finishedAt).toBeTypeOf("number");
  });

  it("a leftover `active` already in the log is dropped at boot", async () => {
    const m = createMockFlinsh();
    await boot(m);
    actions.completeOnboarding({ name: "M", units: "kg", template: "upper-lower-4" });
    const plan = getState().splits!.splits[0].days[2];
    actions.completeSet(plan.exercises[0].id, 0);
    await services().store.flush();
    const stale = structuredClone(m.storeData.get("active"));
    actions.finishWorkout();
    await vi.waitFor(() => expect(m.storeData.has("active")).toBe(false));
    // Simulate the app closing between the log write and the delete.
    m.storeData.set("active", stale);
    expect(m.backend.get("active")).toBeTruthy();
    await boot(m);
    expect(getState().active).toBeNull();
    expect(getState().logs["2026-11"].days["2026-11-10"].finishedAt).toBeTypeOf("number");
  });

  it("a coach reply that lands after Delete everything writes nothing", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const m = createMockFlinsh({ ai: async () => (await gate, { content: [{ type: "text", text: "Nice work." }], stop_reason: "end_turn" }) });
    await boot(m);
    actions.completeOnboarding({ name: "M", units: "kg", template: "upper-lower-4" });
    const sent = actions.sendCoach("How was my week?");
    await services().store.flush();
    // Her message is saved before the reply arrives.
    expect((m.storeData.get("chat/2026-11-10") as { text: string }[])[0].text).toBe("How was my week?");
    await actions.deleteEverything();
    release();
    await sent;
    await services().store.flush();
    expect([...m.storeData.keys()]).toEqual([]);
    expect(getState().chat).toEqual([]);
  });
});
