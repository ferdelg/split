/**
 * Coach: proposeWorkout parsing, the tool loop with a mocked AIAdapter, and
 * apply / keep / save through the real state + actions over a mock bridge.
 */
import { afterEach, describe, expect, it } from "vitest";
import { parseProposeWorkout, PROPOSE_WORKOUT_TOOL } from "../src/coach/tools";
import { runCoachTurn } from "../src/coach/coach";
import { buildSystemPrompt } from "../src/coach/prompt";
import { fromDisplay } from "../src/lib/units";
import { getState, initApp, resetForTests, services, setClock } from "../src/data/state";
import { actions } from "../src/data/actions";
import { activeSplit } from "../src/data/split";
import { createMockFlinsh } from "./helpers/mockFlinsh";
import { CANNED_PROPOSAL, isPlanTodayPrompt, toolReply, textReply } from "../scripts/harness/canned.mjs";
import type { AIAdapter, AIRequest, AIResponse, CoachContext } from "../src/types";

const valid = {
  title: "Short legs",
  exercises: [
    { name: "Goblet squat", sets: 3, reps: "8-10", weight: 40 },
    { name: "Plank", sets: 2, reps: "30" },
  ],
  reason: "Short on time.",
};

describe("parseProposeWorkout", () => {
  it("valid input: reps ranges, weight → kg", () => {
    const p = parseProposeWorkout(valid, "lb")!;
    expect(p.title).toBe("Short legs");
    expect(p.reason).toBe("Short on time.");
    expect(p.exercises[0]).toMatchObject({ name: "Goblet squat", sets: 3, reps: { min: 8, max: 10 } });
    expect(p.exercises[0].weightKg).toBeCloseTo(fromDisplay(40, "lb"), 9);
    expect(p.exercises[1]).toMatchObject({ name: "Plank", sets: 2, reps: { min: 30 } });
    expect(p.exercises[1].weightKg).toBeUndefined();
    expect(parseProposeWorkout(valid, "kg")!.exercises[0].weightKg).toBe(40);
  });

  it("accepts strings for numbers and an en-dash range", () => {
    const p = parseProposeWorkout({ exercises: [{ name: "Row", sets: "4", reps: "10–12", weight: "50" }], reason: "x" }, "kg")!;
    expect(p.exercises[0]).toMatchObject({ sets: 4, reps: { min: 10, max: 12 }, weightKg: 50 });
    const n = parseProposeWorkout({ exercises: [{ name: "Row", sets: 3, reps: 8 }], reason: "x" }, "kg")!;
    expect(n.exercises[0].reps).toEqual({ min: 8 });
  });

  it("clamps sets 1–10, reps 1–100, ≤ 12 exercises, names ≤ 60 chars", () => {
    const p = parseProposeWorkout(
      {
        exercises: [
          { name: "A".repeat(100), sets: 50, reps: "500" },
          { name: "B", sets: 0, reps: "8" },
          ...Array.from({ length: 20 }, (_, i) => ({ name: `Ex ${i}`, sets: 3, reps: "8" })),
        ],
        reason: "r",
      },
      "lb",
    )!;
    expect(p.exercises).toHaveLength(12);
    expect(p.exercises[0].name.length).toBeLessThanOrEqual(60);
    expect(p.exercises[0].sets).toBe(10);
    expect(p.exercises[0].reps.min).toBe(100);
    // sets: 0 is out of range; any in-range value is fine (the parser defaults odd values to 3)
    expect(p.exercises[1].sets).toBeGreaterThanOrEqual(1);
    expect(p.exercises[1].sets).toBeLessThanOrEqual(10);
  });

  it("junk → null", () => {
    for (const junk of [null, undefined, 42, "x", {}, { exercises: [] }, { exercises: "nope" }, { exercises: [{ sets: 3 }] }, { exercises: [{ name: "", sets: 3, reps: "8" }] }]) {
      expect(parseProposeWorkout(junk, "lb"), JSON.stringify(junk)).toBeNull();
    }
  });
});

// ── runCoachTurn with a mocked AIAdapter ─────────────────────────────────────

function fakeAI(responses: AIResponse[]) {
  const reqs: AIRequest[] = [];
  const ai: AIAdapter = {
    mode: () => "flinsh",
    chat: async (req) => {
      reqs.push(structuredClone(req));
      const r = responses.shift();
      if (!r) throw new Error("no more responses");
      return r;
    },
  };
  return { ai, reqs };
}
const ok = (text: string, toolCalls: { id: string; name: string; input: Record<string, unknown> }[] = []): AIResponse => ({
  ok: true,
  text,
  toolCalls,
  content: [...(text ? [{ type: "text" as const, text }] : []), ...toolCalls.map((c) => ({ type: "tool_use" as const, ...c }))],
  stopReason: toolCalls.length ? "tool_use" : "end_turn",
});
const ctx: CoachContext = { today: "2026-11-10", weekday: 2, profile: { name: "Magdalena", units: "lb" }, activeSplit: null, todayPlan: null, active: null, recent: [] };
const deps = (ai: AIAdapter) => ({ ai, unit: "lb" as const, now: () => 1_000 });

describe("runCoachTurn", () => {
  it("text only: one call with the tool offered", async () => {
    const f = fakeAI([ok("Looks good, go lift.")]);
    const r = await runCoachTurn(deps(f.ai), ctx, [], "Is my plan ok?", "chat");
    expect(r.error).toBeUndefined();
    expect(r.reply).toMatchObject({ role: "assistant", text: "Looks good, go lift." });
    expect(r.reply.proposal).toBeUndefined();
    expect(f.reqs).toHaveLength(1);
    expect(f.reqs[0].tools?.map((t) => t.name)).toEqual([PROPOSE_WORKOUT_TOOL.name]);
    const last = f.reqs[0].messages[f.reqs[0].messages.length - 1];
    expect(last.role).toBe("user");
    expect(JSON.stringify(last.content)).toContain("Is my plan ok?");
  });

  it("proposal: pending card, and no second call", async () => {
    const f = fakeAI([ok("Here you go.", [{ id: "t1", name: "proposeWorkout", input: valid }])]);
    const r = await runCoachTurn(deps(f.ai), ctx, [], "I only have 30 minutes", "chat");
    expect(f.reqs).toHaveLength(1);
    expect(r.reply.proposal?.status).toBe("pending");
    expect(r.reply.proposal?.exercises.map((e) => e.name)).toEqual(["Goblet squat", "Plank"]);
  });

  it("unknown tool: is_error tool_result and one more call", async () => {
    const f = fakeAI([ok("", [{ id: "t9", name: "logFood", input: {} }]), ok("Sorry, here's text.")]);
    const r = await runCoachTurn(deps(f.ai), ctx, [], "hi", "chat");
    expect(f.reqs).toHaveLength(2);
    const second = f.reqs[1].messages;
    const res = second[second.length - 1].content as { type: string; tool_use_id?: string; is_error?: boolean }[];
    expect(res[0]).toMatchObject({ type: "tool_result", tool_use_id: "t9", is_error: true });
    expect(r.reply.text).toBe("Sorry, here's text.");
  });

  it("at most 3 calls per turn", async () => {
    const f = fakeAI(Array.from({ length: 6 }, (_, i) => ok("", [{ id: `t${i}`, name: "nope", input: {} }])));
    const r = await runCoachTurn(deps(f.ai), ctx, [], "hi", "chat");
    expect(f.reqs).toHaveLength(3);
    expect(r.reply.text.length).toBeGreaterThan(0);
  });

  it("error codes become an inline error bubble", async () => {
    const f = fakeAI([{ ok: false, reason: "auth", message: "Add your Anthropic key in Flinsh Settings to turn on the coach", code: "no_ai_key" }]);
    const r = await runCoachTurn(deps(f.ai), ctx, [], "hi", "chat");
    expect(r.error?.code).toBe("no_ai_key");
    expect(r.reply).toMatchObject({ error: true, code: "no_ai_key" });
    expect(r.reply.text).toContain("Add your Anthropic key in Flinsh Settings to turn on the coach");
  });

  it("plan-today mode prompt is recognised by the canned harness AI", () => {
    expect(isPlanTodayPrompt(buildSystemPrompt(ctx, "plan-today"))).toBe(true);
    for (const m of ["chat", "suggest", "calories"] as const) expect(isPlanTodayPrompt(buildSystemPrompt(ctx, m)), m).toBe(false);
  });
});

// ── through state + actions with a mock bridge ───────────────────────────────

const TUE = new Date(2026, 10, 10, 18, 0); // a workout day in 4-day upper/lower
const settle = async () => {
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
};

afterEach(() => resetForTests());

describe("coach proposals through actions", () => {
  it("apply changes today's session only; keep changes nothing; save writes the split day", async () => {
    const shorter = { ...CANNED_PROPOSAL, title: "Shorter" };
    const m = createMockFlinsh({
      ai: [
        toolReply("proposeWorkout", CANNED_PROPOSAL, "Shorter today."),
        toolReply("proposeWorkout", { ...shorter, exercises: [{ name: "Plank", sets: 2, reps: "30" }] }, "Or just this."),
        textReply("ok"),
      ],
    });
    resetForTests();
    setClock(() => new Date(TUE));
    await initApp({ bridge: m.bridge });
    actions.completeOnboarding({ name: "Magdalena", units: "lb", template: "upper-lower-4" });
    await services().store.flush();
    const splitsBefore = structuredClone(getState().splits);
    const storedBefore = structuredClone(m.storeData.get("splits"));
    expect(storedBefore).toEqual(splitsBefore);

    await actions.sendCoach("I only have 30 minutes");
    const first = getState().chat.find((c) => c.role === "assistant" && c.proposal)!;
    expect(first.proposal!.status).toBe("pending");
    expect(getState().active).toBeNull(); // a proposal alone changes nothing

    actions.applyProposal(first.id);
    const active = getState().active!;
    expect(active.coachAdjusted).toBe(true);
    expect(active.date).toBe("2026-11-10");
    expect(active.exercises.map((e) => e.name)).toEqual(CANNED_PROPOSAL.exercises.map((e) => e.name));
    expect(active.exercises.map((e) => e.sets.length)).toEqual([3, 3, 3]);
    expect(active.exercises[0].sets[0].weightKg).toBeCloseTo(fromDisplay(40, "lb"), 6);
    expect(active.exercises[1].sets[0].weightKg).toBeNull(); // no weight, no record → bodyweight
    expect(getState().chat.find((c) => c.id === first.id)!.proposal!.status).toBe("applied");
    await services().store.flush();
    expect(getState().splits).toEqual(splitsBefore);
    expect(m.storeData.get("splits")).toEqual(storedBefore);
    expect((m.storeData.get("active") as { coachAdjusted?: boolean }).coachAdjusted).toBe(true);

    await actions.sendCoach("make it even shorter");
    const second = [...getState().chat].reverse().find((c) => c.role === "assistant" && c.proposal)!;
    expect(second.id).not.toBe(first.id);
    const activeBefore = structuredClone(getState().active);
    actions.keepPlan(second.id);
    expect(getState().chat.find((c) => c.id === second.id)!.proposal!.status).toBe("kept");
    expect(getState().active).toEqual(activeBefore);
    expect(getState().splits).toEqual(splitsBefore);

    actions.saveProposalToSplit(first.id);
    const day = activeSplit(getState().splits)!.days[2];
    expect(day.kind).toBe("workout");
    expect(day.exercises.map((e) => e.name)).toEqual(CANNED_PROPOSAL.exercises.map((e) => e.name));
    expect(getState().chat.find((c) => c.id === first.id)!.proposal!.status).toBe("saved");
    // other days untouched
    const before = activeSplit(splitsBefore)!;
    for (const wd of [0, 1, 3, 4, 5, 6]) expect(activeSplit(getState().splits)!.days[wd]).toEqual(before.days[wd]);
    await services().store.flush();
    expect(activeSplit(m.storeData.get("splits") as never)!.days[2].exercises.map((e) => e.name)).toEqual(CANNED_PROPOSAL.exercises.map((e) => e.name));
    await settle();
  });

  it("no_ai_key: inline error bubble and coachError; nothing else changes", async () => {
    const m = createMockFlinsh();
    m.aiRejects("no_ai_key");
    resetForTests();
    setClock(() => new Date(TUE));
    await initApp({ bridge: m.bridge });
    actions.completeOnboarding({ name: "Magdalena", units: "lb", template: "upper-lower-4" });
    const splits = structuredClone(getState().splits);
    await actions.sendCoach("hi");
    const last = getState().chat[getState().chat.length - 1];
    expect(last).toMatchObject({ role: "assistant", error: true, code: "no_ai_key" });
    expect(last.text).toContain("Add your Anthropic key in Flinsh Settings to turn on the coach");
    expect(getState().coachError?.code).toBe("no_ai_key");
    expect(getState().splits).toEqual(splits);
    expect(getState().chatBusy).toBe(false);
  });
});
