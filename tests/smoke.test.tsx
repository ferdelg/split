/**
 * End-to-end smoke test in jsdom: boots the real app (the tree src/main.tsx
 * renders) over the mock Flinsh bridge and walks the main flow by the
 * accessible names in docs/PLAN.md ("Accessible names"). The steps share one
 * app instance and run in order; a failing step skips the ones after it.
 */
import { normalizeMonthLog } from "../src/data/defaults";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/preact";
import userEvent from "@testing-library/user-event";
import { createMockFlinsh, type MockFlinsh } from "./helpers/mockFlinsh";
import { getState, initApp, resetForTests, services, setClock } from "../src/data/state";
import { App, applyInitialSettings } from "../src/ui/App";
import { activeSplit } from "../src/data/split";
import { addDays } from "../src/lib/date";
import { formatWeight, stepWeight } from "../src/lib/units";
import { CANNED_PROPOSAL } from "../scripts/harness/canned.mjs";
import type { SplitsDoc } from "../src/types";

// Tuesday 2026-11-10 18:00 local: a workout day in "4-day upper/lower" (Mon, Tue, Thu, Fri).
let clock = new Date(2026, 10, 10, 18, 0, 0);
const TODAY = "2026-11-10";
const T = { timeout: 4000 };

let mock: MockFlinsh;
const user = userEvent.setup();
const flush = () => act(() => services().store.flush());
const button = (name: string | RegExp) => screen.findByRole("button", { name }, T);
const splits = () => mock.storeData.get("splits") as SplitsDoc;

let broken = "";
function step(name: string, fn: () => Promise<void>) {
  it(name, async () => {
    if (broken) throw new Error(`skipped: earlier step "${broken}" failed`);
    try {
      await fn();
    } catch (e) {
      broken = name;
      throw e;
    }
  });
}

async function goTab(name: "Today" | "Split" | "Calendar" | "Coach" | "Me") {
  await user.click(await screen.findByRole("tab", { name }, T));
}

async function closeDialog(name?: string | RegExp) {
  const dlg = name ? await screen.findByRole("dialog", { name }, T) : (await screen.findAllByRole("dialog", undefined, T)).pop()!;
  await user.click(within(dlg).getByRole("button", { name: "Close" }));
  await waitFor(() => expect(dlg.isConnected).toBe(false), T);
}

beforeEach(() => {
  // keep the app clock fixed (tests/setup.ts clears storage between tests)
  setClock(() => new Date(clock));
});

beforeAll(async () => {
  resetForTests();
  setClock(() => new Date(clock));
  mock = createMockFlinsh();
  window.flinsh = mock.bridge;
  // Same boot path as src/main.tsx, with an injected bridge.
  await initApp({ bridge: mock.bridge });
  applyInitialSettings();
  render(<App />);
});

afterAll(() => {
  cleanup();
  resetForTests();
  delete window.flinsh;
});

describe("Split smoke flow (mock Flinsh)", () => {
  let firstEx = "";
  let firstPlanW: number | null = null;
  let newW: number | null = null;
  let splitsBeforeCoach: SplitsDoc | null = null;

  step("onboarding: name, lb, 4-day upper/lower → Today", async () => {
    await user.type(await screen.findByRole("textbox", { name: "Your name" }, T), "Magdalena");
    await user.click(await button("Continue"));
    await user.click(await screen.findByRole("radio", { name: "lb" }, T));
    await user.click(await button("Continue"));
    await user.click(await screen.findByRole("radio", { name: "4-day upper/lower" }, T));
    await user.click(await button("Start training"));
    await screen.findByRole("tablist", undefined, T);
    for (const t of ["Today", "Split", "Calendar", "Coach", "Me"]) expect(screen.getByRole("tab", { name: t })).toBeTruthy();
    await flush();
    expect((mock.storeData.get("profile") as { name: string; units: string })).toMatchObject({ name: "Magdalena", units: "lb" });
    const day = activeSplit(splits())!.days[2];
    expect(day.kind).toBe("workout");
    firstEx = day.exercises[0].name;
    firstPlanW = day.exercises[0].weightKg;
  });

  step("split: rename Tuesday in the day editor", async () => {
    await goTab("Split");
    await user.click(await button("Edit Tuesday"));
    const dlg = await screen.findByRole("dialog", undefined, T);
    const name = within(dlg).getByRole("textbox", { name: "Day name" });
    await user.clear(name);
    await user.type(name, "Leg day");
    await closeDialog();
    await flush();
    expect(activeSplit(splits())!.days[2].name).toBe("Leg day");
  });

  step("today: tap a set chip, Adjust → Increase weight, set 1", async () => {
    await goTab("Today");
    await screen.findByText("Leg day", undefined, T);
    const chip1 = await screen.findByRole("button", { name: new RegExp(`^${firstEx}, set 1 of \\d+, not done$`) }, T);
    await user.click(chip1);
    await screen.findByRole("button", { name: new RegExp(`^${firstEx}, set 1 of \\d+, done, \\d+ reps at `) }, T);
    await user.click(await button(`Adjust ${firstEx}`));
    const dlg = await screen.findByRole("dialog", undefined, T);
    await user.click(within(dlg).getByRole("button", { name: "Increase weight, set 1" }));
    await user.click(within(dlg).getByRole("button", { name: "Done" }));
    newW = stepWeight(firstPlanW, "lb", 5, 1);
    const ex = getState().active!.exercises.find((e) => e.name === firstEx)!;
    expect(ex.sets[0].done).toBe(true);
    expect(formatWeight(ex.sets[0].weightKg, "lb")).toBe(formatWeight(newW, "lb"));
    await screen.findByRole("button", { name: new RegExp(`^${firstEx}, set 1 of \\d+, done, \\d+ reps at ${formatWeight(newW, "lb")}$`) }, T);
    await flush();
    expect(mock.storeData.has("active")).toBe(true);
  });

  step("finish workout → summary → Done", async () => {
    await user.click(await button("Finish workout"));
    const dlg = await screen.findByRole("dialog", { name: "Workout summary" }, T);
    await user.click(within(dlg).getByRole("button", { name: "Done" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Workout summary" })).toBeNull(), T);
    await flush();
    expect(mock.storeData.has("active")).toBe(false);
    const log = normalizeMonthLog(mock.storeData.get("logs/2026-11"), "2026-11");
    expect(log.days[TODAY].finishedAt).toBeTypeOf("number");
  });

  step('calendar shows "November 10, done"', async () => {
    await goTab("Calendar");
    await button("November 10, done");
  });

  step('a week later Today shows "Last: …" with the changed weight', async () => {
    clock = new Date(2026, 10, 17, 18, 0, 0);
    setClock(() => new Date(clock));
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      document.dispatchEvent(new Event("visibilitychange"));
      await new Promise((r) => setTimeout(r, 50));
    });
    await waitFor(() => expect(getState().today).toBe(addDays(TODAY, 7)), T);
    await goTab("Today");
    const shown = formatWeight(newW, "lb", { unit: false });
    await waitFor(() => {
      const last = screen.getAllByText(/Last:/).map((n) => n.textContent ?? "");
      expect(last.some((t) => t.includes(shown)), `Last lines: ${last.join(" | ")}`).toBe(true);
    }, T);
  });

  step("coach proposes a shorter workout → Use for today (split unchanged)", async () => {
    await flush();
    splitsBeforeCoach = structuredClone(splits());
    await goTab("Coach");
    const box = await screen.findByRole("textbox", { name: "Message the coach" }, T);
    await user.type(box, "I only have 30 minutes today");
    await user.click(await button("Send"));
    await user.click(await button("Use for today"));
    await waitFor(() => expect(getState().active?.coachAdjusted).toBe(true), T);
    expect(getState().active!.exercises.map((e) => e.name)).toEqual(CANNED_PROPOSAL.exercises.map((e) => e.name));
    await button("Save to my split"); // offered after applying
    await flush();
    expect(splits()).toEqual(splitsBeforeCoach);
    await goTab("Today");
    for (const e of CANNED_PROPOSAL.exercises) await screen.findAllByRole("button", { name: new RegExp(`^${e.name}, set 1 of 3, `) }, T);
  });

  step("store: valid keys only, no API key, AI called", async () => {
    await flush();
    for (const k of mock.storeData.keys()) expect(k, k).not.toContain(":");
    expect(mock.calls.ai.length).toBeGreaterThanOrEqual(1);
    expect(mock.calls.ready).toBeGreaterThanOrEqual(0);
    fireEvent(window, new Event("pagehide"));
  });
});
