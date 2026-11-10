/** The test double itself: backend semantics and the canned/scripted AI. */
import { describe, expect, it } from "vitest";
import { createMockFlinsh } from "./helpers/mockFlinsh";
import { CANNED, CANNED_PROPOSAL, aiError, classify, textReply } from "../scripts/harness/canned.mjs";
import type { AIRequest } from "../src/types";

const tools = [{ name: "proposeWorkout", description: "", input_schema: {} }];
const req = (text: string, system = "You are a coach.", withTools = true): AIRequest => ({
  system,
  messages: [{ role: "user", content: text }],
  ...(withTools ? { tools } : {}),
});

describe("mock Flinsh store (backend semantics)", () => {
  it("validates keys like app_data.clean_key", async () => {
    const { bridge } = createMockFlinsh();
    const s = bridge.store;
    for (const bad of ["logs:2026-11", "a..b", "a|b", "/x", "", "é"]) await expect(s.set(bad, 1)).rejects.toThrow();
    await expect(s.set("logs/2026-11", 1)).resolves.toMatchObject({ ok: true });
    await expect(s.set("x".repeat(257), 1)).rejects.toThrow(/longer than 256/);
  });

  it("missing get → null; list sorted by prefix; delete → boolean", async () => {
    const { bridge, storeData } = createMockFlinsh({ seed: { "photo/2": 2, "photo/1": 1, other: 0 } });
    const s = bridge.store;
    expect(await s.get("nope")).toBeNull();
    expect(await s.list("photo/")).toEqual(["photo/1", "photo/2"]);
    expect(await s.delete("photo/1")).toBe(true);
    expect(await s.delete("photo/1")).toBe(false);
    expect(storeData.has("photo/1")).toBe(false);
  });

  it("enforces 256 KB values, 2 MB total and 1,000 keys", async () => {
    const { bridge } = createMockFlinsh();
    const s = bridge.store;
    await expect(s.set("big", "x".repeat(256 * 1024))).rejects.toThrow(/larger than 256 KB/);
    for (let i = 0; i < 8; i++) await s.set(`chunk${i}`, "x".repeat(250 * 1024));
    await expect(s.set("one-more", "x".repeat(100 * 1024))).rejects.toThrow(/quota/);
    await expect(s.set("chunk0", "small")).resolves.toBeTruthy(); // shrinking at quota is fine

    const m2 = createMockFlinsh({ limits: { maxKeys: 3 } });
    for (const k of ["a", "b", "c"]) await m2.bridge.store.set(k, 1);
    await expect(m2.bridge.store.set("d", 1)).rejects.toThrow(/too many keys/);
    await expect(m2.bridge.store.set("a", 2)).resolves.toBeTruthy();
  });

  it("failNext makes the next n calls reject", async () => {
    const m = createMockFlinsh();
    m.failNext("set", 2, "boom");
    await expect(m.bridge.store.set("k", 1)).rejects.toThrow("boom");
    await expect(m.bridge.store.set("k", 1)).rejects.toThrow("boom");
    await expect(m.bridge.store.set("k", 1)).resolves.toBeTruthy();
  });

  it("files is never present; notifications only on request", () => {
    expect(createMockFlinsh().bridge.files).toBeUndefined();
    expect(createMockFlinsh().bridge.notifications).toBeUndefined();
    expect(createMockFlinsh({ notifications: true }).bridge.notifications?.schedule).toBeTypeOf("function");
    expect(createMockFlinsh({ ai: false }).bridge.ai).toBeUndefined();
  });
});

describe("mock ai.chat", () => {
  it("canned: Messages body; short/30 minutes/tired → proposeWorkout tool_use", async () => {
    const m = createMockFlinsh();
    for (const t of ["I only have 30 minutes", "make it short", "I'm tired today"]) {
      const r = (await m.bridge.ai!.chat(req(t) as never)) as Record<string, any>;
      expect(r).toMatchObject({ type: "message", role: "assistant", stop_reason: "tool_use" });
      expect(r.id).toMatch(/^msg_/);
      expect(r.usage.input_tokens).toBeGreaterThan(0);
      const use = r.content.find((b: any) => b.type === "tool_use");
      expect(use.name).toBe("proposeWorkout");
      expect(use.input.exercises).toHaveLength(3);
      expect(use.input.exercises.every((e: any) => e.reps === "8-10")).toBe(true);
      expect(use.input.reason).toBe(CANNED_PROPOSAL.reason);
    }
    const plain = (await m.bridge.ai!.chat(req("what should I eat?") as never)) as Record<string, any>;
    expect(plain.stop_reason).toBe("end_turn");
    expect(plain.content).toEqual([{ type: "text", text: CANNED.chatDefault }]);
    expect(m.calls.ai).toHaveLength(4);
  });

  it("plan-today mode prompt → proposal; no tools offered → text", () => {
    expect(classify(req("hi", "Mode: Plan today. Call proposeWorkout."))).toBe("propose");
    expect(classify(req("hi"))).toBe("chat");
    expect(classify({ system: "", messages: [{ role: "user", content: [{ type: "tool_result", tool_use_id: "t", content: "x" }] }] })).toBe("after-tool");
  });

  it("scripted queue, function, and rejections with err.code", async () => {
    const m = createMockFlinsh({ ai: [textReply("one"), aiError("rate_limited")] });
    expect(((await m.bridge.ai!.chat({})) as any).content[0].text).toBe("one");
    await expect(m.bridge.ai!.chat({})).rejects.toMatchObject({ code: "rate_limited" });
    await expect(m.bridge.ai!.chat({})).rejects.toThrow(/queue empty/);
    m.aiRejects("no_ai_key");
    const err = (await m.bridge.ai!.chat({}).catch((e: unknown) => e)) as Error & { code?: string };
    expect(err).toBeInstanceOf(Error);
    expect(err.code).toBe("no_ai_key");
    m.setAiScript(() => textReply("fn"));
    expect(((await m.bridge.ai!.chat({})) as any).content[0].text).toBe("fn");
    m.failNext("ai", 1, "busy", "ai_budget_exceeded");
    await expect(m.bridge.ai!.chat({})).rejects.toMatchObject({ code: "ai_budget_exceeded" });
  });
});
