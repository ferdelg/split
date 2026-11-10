import { describe, expect, it, vi } from "vitest";
import type { AIAdapter, AIRequest, AIResponse, ChatMessage, CoachContext, DayPlan, Session, Split } from "../types";
import { PROPOSE_WORKOUT_TOOL, describeProposal, parseProposeWorkout, parseRepsLoose } from "./tools";
import { historyToMessages, runCoachTurn, trimChat, DEFAULT_PROPOSAL_TEXT, MAX_CALLS } from "./coach";
import { buildSystemPrompt, QUICK_PROMPTS } from "./prompt";
import { KG_PER_LB } from "../lib/units";

const lb = (n: number) => n * KG_PER_LB;

// ── fixtures ──────────────────────────────────────────────────────────────

const rest = (): DayPlan => ({ kind: "rest", name: "Rest", exercises: [] });
const ex = (id: string, name: string, sets: number, min: number, max: number | undefined, w: number | null) => ({
  id,
  name,
  sets,
  reps: max ? { min, max } : { min },
  weightKg: w,
});

function split(): Split {
  const days: DayPlan[] = [rest(), rest(), rest(), rest(), rest(), rest(), rest()];
  days[1] = { kind: "workout", name: "Push", exercises: [ex("a", "Bench press", 4, 6, 8, lb(135)), ex("b", "Lateral raise", 3, 12, 15, lb(15)), ex("c", "Triceps pushdown", 3, 10, 12, lb(50))] };
  days[2] = { kind: "workout", name: "Legs", exercises: [ex("d", "Back squat", 4, 5, undefined, lb(135)), ex("e", "Romanian deadlift", 3, 8, 10, lb(115)), ex("f", "Leg press", 3, 10, 12, lb(270)), ex("g", "Plank", 3, 45, undefined, null)] };
  days[3] = { kind: "workout", name: "Pull", exercises: [ex("h", "Lat pulldown", 4, 8, 10, lb(100)), ex("i", "Seated cable row", 3, 10, 12, lb(90)), ex("j", "Dumbbell curl", 3, 10, 12, lb(25))] };
  days[4] = { kind: "workout", name: "Glutes", exercises: [ex("k", "Hip thrust", 4, 8, 10, lb(185)), ex("l", "Bulgarian split squat", 3, 8, 10, lb(30)), ex("m", "Cable kickback", 3, 12, 15, lb(20))] };
  days[5] = { kind: "workout", name: "Upper", exercises: [ex("n", "Overhead press", 4, 6, 8, lb(75)), ex("o", "Incline dumbbell press", 3, 8, 10, lb(40)), ex("p", "Face pull", 3, 15, undefined, lb(40))] };
  return { id: "s1", name: "5-day PPL", days, createdAt: 1, updatedAt: 1 };
}

function session(date: string, title: string, note?: string): Session {
  return {
    id: "x" + date,
    date,
    title,
    from: { splitId: "s1", weekday: 1 },
    exercises: [
      { id: "1", name: "Bench press", reps: { min: 6, max: 8 }, source: "plan", sets: [
        { reps: 8, weightKg: lb(135), done: true },
        { reps: 8, weightKg: lb(135), done: true },
        { reps: 6, weightKg: lb(140), done: true },
        { reps: 6, weightKg: lb(140), done: false },
      ] },
      { id: "2", name: "Lateral raise", reps: { min: 12 }, source: "plan", sets: [{ reps: 12, weightKg: lb(15), done: false }] },
    ],
    startedAt: 1_000_000,
    finishedAt: 1_000_000 + 52 * 60000,
    ...(note ? { note } : {}),
    thumb: "data:image/jpeg;base64,AAAA",
  };
}

function ctx(over: Partial<CoachContext> = {}): CoachContext {
  const s = split();
  return {
    today: "2026-11-10",
    weekday: 2,
    profile: { name: "Magdalena", units: "lb", heightCm: 168, bodyWeightKg: 63, goal: "muscle" },
    activeSplit: s,
    todayPlan: s.days[2],
    active: null,
    recent: [session("2026-11-09", "Push", "Felt strong"), session("2026-11-06", "Upper"), session("2026-11-05", "Glutes"), session("2026-11-04", "Pull"), session("2026-11-03", "Legs"), session("2026-11-02", "Push"), session("2026-10-30", "Upper"), session("2026-10-29", "Glutes"), session("2026-10-28", "Pull"), session("2026-10-27", "Legs")],
    ...over,
  };
}

function okText(text: string): AIResponse {
  return { ok: true, text, toolCalls: [], content: [{ type: "text", text }], stopReason: "end_turn" };
}
function okTool(name: string, input: Record<string, unknown>, text = ""): AIResponse {
  const call = { id: "tu_" + name, name, input };
  return {
    ok: true,
    text,
    toolCalls: [call],
    content: [...(text ? [{ type: "text", text }] : []), { type: "tool_use", ...call }],
    stopReason: "tool_use",
  };
}
function mockAI(...responses: AIResponse[]) {
  const chat = vi.fn(async (_req: AIRequest) => responses.shift() ?? okText("ok"));
  const ai: AIAdapter = { mode: () => "flinsh", chat };
  return { ai, chat };
}
const deps = (ai: AIAdapter) => ({ ai, unit: "lb" as const, now: () => 1_700_000_000_000 });

// ── tools ─────────────────────────────────────────────────────────────────

describe("parseProposeWorkout", () => {
  it("parses a valid proposal and converts weight to kg", () => {
    const p = parseProposeWorkout(
      { title: "Short legs", reason: "Less time today.", exercises: [{ name: "Back squat", sets: 3, reps: "5", weight: 135 }, { name: "Plank", sets: 2, reps: "45" }] },
      "lb",
    )!;
    expect(p.title).toBe("Short legs");
    expect(p.reason).toBe("Less time today.");
    expect(p.exercises[0]).toEqual({ name: "Back squat", sets: 3, reps: { min: 5 }, weightKg: lb(135) });
    expect(p.exercises[1].weightKg).toBeUndefined();
    expect(parseProposeWorkout({ reason: "", exercises: [{ name: "Squat", sets: 3, reps: 5, weight: 60 }] }, "kg")!.exercises[0].weightKg).toBe(60);
  });

  it("accepts strings and ranges in every spelling", () => {
    const reps = ["8-12", "8–12", "8—12", "8 to 12", "8-12 reps", " 8 - 12 "];
    for (const r of reps) expect(parseRepsLoose(r), r).toEqual({ min: 8, max: 12 });
    expect(parseRepsLoose("12-8")).toEqual({ min: 8, max: 12 });
    expect(parseRepsLoose("10-10")).toEqual({ min: 10 });
    expect(parseRepsLoose(8.4)).toEqual({ min: 8 });
    expect(parseRepsLoose("AMRAP")).toBeNull();
    const p = parseProposeWorkout({ reason: "x", exercises: [{ name: "Leg press", sets: "4", reps: "10 to 12", weight: "270" }] }, "lb")!;
    expect(p.exercises[0]).toEqual({ name: "Leg press", sets: 4, reps: { min: 10, max: 12 }, weightKg: lb(270) });
  });

  it("clamps sets, reps, names, reason and the exercise count", () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ name: `Move ${i}`, sets: 3, reps: "10" }));
    const p = parseProposeWorkout({ reason: "r".repeat(500), exercises: many }, "lb")!;
    expect(p.exercises).toHaveLength(12);
    expect(p.reason.length).toBe(200);
    const q = parseProposeWorkout({ reason: "x", title: "t".repeat(90), exercises: [{ name: "  " + "N".repeat(100) + "  ", sets: 50, reps: "500" }, { name: "A", sets: 0, reps: 0 }] }, "lb")!;
    expect(q.exercises[0].name).toHaveLength(60);
    expect(q.exercises[0].sets).toBe(10);
    expect(q.exercises[0].reps).toEqual({ min: 100 });
    expect(q.exercises[1].sets).toBe(3); // default for unusable sets
    expect(q.exercises[1].reps).toEqual({ min: 1 });
    expect(q.title).toHaveLength(60);
  });

  it("drops junk and returns null with no usable exercise", () => {
    expect(parseProposeWorkout(null, "lb")).toBeNull();
    expect(parseProposeWorkout("nope", "lb")).toBeNull();
    expect(parseProposeWorkout({ reason: "x" }, "lb")).toBeNull();
    expect(parseProposeWorkout({ reason: "x", exercises: [] }, "lb")).toBeNull();
    expect(parseProposeWorkout({ reason: "x", exercises: [{ name: "", sets: 3, reps: "8" }, { name: "Squat", sets: 3, reps: "lots" }, 7, null] }, "lb")).toBeNull();
    const p = parseProposeWorkout({ exercises: [{ name: "Squat", sets: 3, reps: "8", weight: -5 }, "junk"] }, "lb")!;
    expect(p.exercises).toHaveLength(1);
    expect(p.exercises[0].weightKg).toBeUndefined();
    expect(p.reason).toBe("");
    // exercises sent as a JSON string
    expect(parseProposeWorkout({ reason: "x", exercises: JSON.stringify([{ name: "Squat", sets: 3, reps: "8" }]) }, "lb")!.exercises).toHaveLength(1);
  });

  it("describes a proposal in her unit", () => {
    const p = parseProposeWorkout({ title: "Short legs", reason: "x", exercises: [{ name: "Back squat", sets: 3, reps: "5", weight: 135 }, { name: "Plank", sets: 3, reps: "30-45" }] }, "lb")!;
    expect(describeProposal(p, "lb")).toBe("Short legs: Back squat 3×5 @ 135 lb, Plank 3×30–45");
  });

  it("tool definition matches the plan", () => {
    expect(PROPOSE_WORKOUT_TOOL.name).toBe("proposeWorkout");
    expect((PROPOSE_WORKOUT_TOOL.input_schema as { required: string[] }).required).toEqual(["exercises", "reason"]);
  });
});

// ── history ───────────────────────────────────────────────────────────────

const msg = (id: string, role: ChatMessage["role"], text: string, extra: Partial<ChatMessage> = {}): ChatMessage => ({ id, role, text, at: 1, ...extra });

describe("historyToMessages", () => {
  it("alternates roles, starts with user, skips errors, merges neighbours", () => {
    const h: ChatMessage[] = [
      msg("1", "assistant", "Hi there"),
      msg("2", "user", "Plan today"),
      msg("3", "assistant", "The coach couldn't answer.", { error: true, code: "rate_limited" }),
      msg("4", "user", "Plan today please"),
      msg("5", "assistant", "Sure"),
      msg("6", "assistant", "Also this"),
      msg("7", "user", "Thanks"),
    ];
    const out = historyToMessages(h, "lb");
    expect(out.map((m) => m.role)).toEqual(["user", "assistant", "user"]);
    expect(out[0].content).toBe("Plan today\n\nPlan today please");
    expect(out[1].content).toBe("Sure\n\nAlso this");
    for (let i = 1; i < out.length; i++) expect(out[i].role).not.toBe(out[i - 1].role);
  });

  it("replays proposals as text with her choice", () => {
    const proposal = { exercises: [{ name: "Back squat", sets: 3, reps: { min: 5 }, weightKg: lb(135) }], reason: "Short", status: "applied" as const };
    const h = [msg("1", "user", "Shorter?"), msg("2", "assistant", "Here you go.", { proposal })];
    const out = historyToMessages(h, "lb");
    expect(out[1].content).toBe("Here you go.\n[Proposed for today: Back squat 3×5 @ 135 lb; she chose: use for today]");
    const kept = historyToMessages([h[0], msg("2", "assistant", "", { proposal: { ...proposal, status: "pending" } })], "lb");
    expect(kept[1].content).toContain("she chose: hasn't decided");
    expect(historyToMessages([h[0], msg("2", "assistant", "x", { proposal: { ...proposal, status: "kept" } })], "lb")[1].content).toContain("kept her plan");
    expect(historyToMessages([h[0], msg("2", "assistant", "x", { proposal: { ...proposal, status: "saved" } })], "lb")[1].content).toContain("saved to split");
  });

  it("keeps at most `max` and still starts with user", () => {
    const h = Array.from({ length: 30 }, (_, i) => msg(String(i), i % 2 ? "assistant" : "user", `m${i}`));
    const out = historyToMessages(h, "lb", 12);
    expect(out.length).toBeLessThanOrEqual(12);
    expect(out[0].role).toBe("user");
    expect(out[out.length - 1].content).toBe("m29");
  });
});

describe("trimChat", () => {
  it("keeps the last 40 and under 24 KB", () => {
    const h = Array.from({ length: 60 }, (_, i) => msg(String(i), "user", `m${i}`));
    const t = trimChat(h);
    expect(t).toHaveLength(40);
    expect(t[39].id).toBe("59");
    const big = Array.from({ length: 30 }, (_, i) => msg(String(i), "assistant", "x".repeat(2000)));
    const tb = trimChat(big);
    expect(new TextEncoder().encode(JSON.stringify(tb)).length).toBeLessThanOrEqual(24 * 1024);
    expect(tb[tb.length - 1].id).toBe("29");
    expect(trimChat([msg("1", "user", "x".repeat(30000))])).toHaveLength(1);
  });
});

// ── runCoachTurn ──────────────────────────────────────────────────────────

describe("runCoachTurn", () => {
  it("text-only reply", async () => {
    const { ai, chat } = mockAI(okText("Go for 4×5 at 135 lb today."));
    const r = await runCoachTurn(deps(ai), ctx(), [], "How heavy should I squat?", "chat");
    expect(r.error).toBeUndefined();
    expect(r.reply).toMatchObject({ role: "assistant", text: "Go for 4×5 at 135 lb today.", at: 1_700_000_000_000 });
    expect(r.reply.proposal).toBeUndefined();
    expect(chat).toHaveBeenCalledTimes(1);
    const req = chat.mock.calls[0][0];
    expect(req.tools).toEqual([PROPOSE_WORKOUT_TOOL]);
    expect(req.max_tokens).toBe(700);
    expect(req.messages).toEqual([{ role: "user", content: "How heavy should I squat?" }]);
    expect(req.system).toContain("Back squat 4×5 @135 lb");
  });

  it("proposal: parses, returns a pending card, does not call again", async () => {
    const { ai, chat } = mockAI(
      okTool("proposeWorkout", { title: "Short legs", reason: "45 minutes.", exercises: [{ name: "Back squat", sets: 3, reps: "5", weight: 135 }, { name: "Leg press", sets: "3", reps: "10-12" }] }, "Here's a shorter one."),
    );
    const r = await runCoachTurn(deps(ai), ctx(), [], "Only 45 minutes today", "plan-today");
    expect(chat).toHaveBeenCalledTimes(1);
    expect(r.reply.text).toBe("Here's a shorter one.");
    expect(r.reply.proposal).toMatchObject({ status: "pending", title: "Short legs", reason: "45 minutes." });
    expect(r.reply.proposal!.exercises[1]).toEqual({ name: "Leg press", sets: 3, reps: { min: 10, max: 12 } });
    expect(chat.mock.calls[0][0].system).toContain("Mode: plan today");
  });

  it("proposal without text gets a default line", async () => {
    const { ai } = mockAI(okTool("proposeWorkout", { reason: "x", exercises: [{ name: "Plank", sets: 3, reps: "30" }] }));
    const r = await runCoachTurn(deps(ai), ctx(), [], "Plan today", "plan-today");
    expect(r.reply.text).toBe(DEFAULT_PROPOSAL_TEXT);
    expect(r.reply.proposal).toBeTruthy();
  });

  it("unusable proposal → text only (or a friendly fallback)", async () => {
    const { ai, chat } = mockAI(okTool("proposeWorkout", { reason: "x", exercises: [] }, "Try this."));
    const r = await runCoachTurn(deps(ai), ctx(), [], "Plan today", "plan-today");
    expect(r.reply.text).toBe("Try this.");
    expect(r.reply.proposal).toBeUndefined();
    expect(chat).toHaveBeenCalledTimes(1);
    const { ai: ai2 } = mockAI(okTool("proposeWorkout", { junk: true }));
    const r2 = await runCoachTurn(deps(ai2), ctx(), [], "Plan today", "plan-today");
    expect(r2.reply.text.length).toBeGreaterThan(0);
    expect(r2.reply.error).toBeUndefined();
  });

  it("unknown tool → is_error tool_result and another call (max 3)", async () => {
    const { ai, chat } = mockAI(okTool("logFood", { text: "x" }), okText("Sorry, here's my answer."));
    const r = await runCoachTurn(deps(ai), ctx(), [], "Hi", "chat");
    expect(chat).toHaveBeenCalledTimes(2);
    expect(r.reply.text).toBe("Sorry, here's my answer.");
    const second = chat.mock.calls[1][0];
    expect(second.messages).toHaveLength(3);
    expect(second.messages[1].role).toBe("assistant");
    const results = second.messages[2].content as { type: string; is_error?: boolean; tool_use_id: string }[];
    expect(results[0]).toMatchObject({ type: "tool_result", is_error: true, tool_use_id: "tu_logFood" });

    const loop = mockAI(okTool("a", {}), okTool("b", {}), okTool("c", {}), okText("never"));
    const r2 = await runCoachTurn(deps(loop.ai), ctx(), [], "Hi", "chat");
    expect(loop.chat).toHaveBeenCalledTimes(MAX_CALLS);
    expect(r2.reply.text).not.toBe("never");
    expect(r2.reply.text.length).toBeGreaterThan(0);
  });

  it("no_ai_key error → error bubble and error result", async () => {
    const message = "Add your Anthropic key in Flinsh Settings to turn on the coach";
    const { ai } = mockAI({ ok: false, reason: "not_configured", message, code: "no_ai_key" });
    const r = await runCoachTurn(deps(ai), ctx(), [], "Plan today", "plan-today");
    expect(r.reply).toMatchObject({ role: "assistant", error: true, code: "no_ai_key", text: message });
    expect(r.error).toEqual({ code: "no_ai_key", message });
  });

  it("rate_limited error", async () => {
    const message = "The coach is catching its breath. Try again in a bit.";
    const { ai } = mockAI({ ok: false, reason: "rate_limit", message, code: "rate_limited" });
    const r = await runCoachTurn(deps(ai), ctx(), [], "Hi", "chat");
    expect(r.reply.error).toBe(true);
    expect(r.error).toEqual({ code: "rate_limited", message });
  });

  it("a throwing adapter becomes an error reply", async () => {
    const ai: AIAdapter = { mode: () => "flinsh", chat: async () => { throw Object.assign(new Error("x"), { code: "boom" }); } };
    const r = await runCoachTurn(deps(ai), ctx(), [], "Hi", "chat");
    expect(r.reply.error).toBe(true);
    expect(r.error?.code).toBe("boom");
  });

  it("sends the last history plus the new text, without duplicating it", async () => {
    const { ai, chat } = mockAI(okText("ok"));
    const history = [msg("1", "user", "Hi"), msg("2", "assistant", "Hey"), msg("3", "user", "Plan today")];
    await runCoachTurn(deps(ai), ctx(), history, "Plan today", "plan-today");
    expect(chat.mock.calls[0][0].messages).toEqual([
      { role: "user", content: "Hi" },
      { role: "assistant", content: "Hey" },
      { role: "user", content: "Plan today" },
    ]);
  });
});

// ── prompt ────────────────────────────────────────────────────────────────

describe("buildSystemPrompt", () => {
  it("renders persona, split Monday first, today, recent; deterministic", () => {
    const c = ctx();
    const p = buildSystemPrompt(c, "chat");
    expect(p).toBe(buildSystemPrompt(c, "chat"));
    expect(p).toContain("Magdalena");
    expect(p).toContain("80 words");
    expect(p).toContain("rough estimate");
    expect(p).toContain("doctor or physio");
    expect(p).toContain("Today: Tuesday 2026-11-10.");
    expect(p).toContain("body weight 138.9 lb");
    const mon = p.indexOf("Mon Push:");
    const sun = p.indexOf("Sun Rest");
    expect(mon).toBeGreaterThan(0);
    expect(sun).toBeGreaterThan(mon);
    expect(p).toContain("Mon Push: Bench press 4×6–8 @135 lb; Lateral raise 3×12–15 @15 lb");
    expect(p).toContain("Today's plan: Tue Legs (as in the split). Not started yet.");
    const other = buildSystemPrompt(ctx({ todayPlan: split().days[1] }), "chat");
    expect(other).toContain("Today's plan: Push: Bench press 4×6–8 @135 lb");
    expect(p).toContain("Plank 3×45");
    expect(p).toContain('- 2026-11-09 Mon Push (52 min): Bench press 135×8,8 140×6; Lateral raise skipped. Note: "Felt strong"');
    expect(p).not.toContain("base64");
    expect(p).not.toMatch(/apiKey|sk-ant/);
  });

  it("mode guidance", () => {
    expect(buildSystemPrompt(ctx(), "plan-today")).toContain("Call proposeWorkout now");
    const s = buildSystemPrompt(ctx(), "suggest");
    expect(s).toContain("3–5 exercises");
    expect(s).toContain("Glutes: Hip thrust");
    expect(buildSystemPrompt(ctx(), "chat")).not.toContain("Library (");
    expect(buildSystemPrompt(ctx(), "calories")).toMatch(/rough estimate/);
  });

  it("shows an in-progress session and works without profile or split", () => {
    const a = session("2026-11-10", "Legs");
    a.finishedAt = undefined;
    a.from = { splitId: "s1", weekday: 1 };
    const p = buildSystemPrompt(ctx({ active: a }), "chat");
    expect(p).toContain("In progress now: Legs (Monday's workout): Bench press 4×6–8 @135, done 135×8,8 140×6; Lateral raise 1×12 @15, not started.");
    const bare = buildSystemPrompt({ today: "2026-11-10", weekday: 2, profile: null, activeSplit: null, todayPlan: null, active: null, recent: [] });
    expect(bare).toContain("Her split: none yet.");
    expect(bare).toContain("no finished workouts");
  });

  it("stays small for a 5-day split and 14 days", () => {
    const p = buildSystemPrompt(ctx(), "plan-today");
    // ~4 chars per token
    expect(p.length / 4).toBeLessThan(2500);
  });

  it("quick prompts", () => {
    expect(QUICK_PROMPTS.map((q) => q.label)).toEqual(["Plan today", "Suggest exercises", "Swap: equipment taken", "Calories for today"]);
    expect(QUICK_PROMPTS[0].mode).toBe("plan-today");
    for (const q of QUICK_PROMPTS) expect(q.text.length).toBeGreaterThan(10);
  });
});
