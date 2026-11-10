/** An in-progress workout survives a reload; finishing moves it into logs. */
import { normalizeMonthLog } from "../src/data/defaults";
import { afterEach, describe, expect, it } from "vitest";
import { getState, initApp, resetForTests, services, setClock } from "../src/data/state";
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
    expect(m.storeData.has("active")).toBe(false);
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
});
